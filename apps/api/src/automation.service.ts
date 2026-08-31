import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { AiGateway, AiMessage, AiResult } from './ai-gateway';
import { AiToolsService, ToolContext } from './ai-tools.service';
import { OpenWaGateway } from './openwa.gateway';
import { PrismaService } from './prisma.service';
import { SecretsService } from './secrets.service';
import { buildSystemPrompt, PROMPT_VERSION } from './prompt';

/**
 * Worker de respuestas automáticas.
 *
 * Garantías que implementa (spec §15):
 * - Un solo trabajo activo por conversación: la cola se particiona usando el
 *   `conversationId` como `jobId`, así que los mensajes que llegan mientras hay
 *   uno pendiente se agrupan en él en vez de disparar respuestas paralelas.
 * - Ventana corta de agrupación, para que tres mensajes seguidos del lead
 *   produzcan una sola respuesta.
 * - Revalidación del estado de control justo antes de enviar: un takeover
 *   humano invalida una respuesta ya generada.
 */

/** Ventana de agrupación de mensajes consecutivos del lead. */
const DEBOUNCE_MS = Number(process.env.AI_DEBOUNCE_MS ?? 4000);
const MAX_TOOL_ITERATIONS = 5;
const HISTORY_WINDOW = 16;

@Injectable()
export class AutomationService implements OnModuleInit, OnModuleDestroy {
  private connection?: IORedis;
  private queue?: Queue;
  private worker?: Worker;
  private readonly log = new Logger(AutomationService.name);

  constructor(
    private db: PrismaService,
    private openwa: OpenWaGateway,
    private secrets: SecretsService,
    private ai: AiGateway,
    private tools: AiToolsService,
  ) {}

  onModuleInit() {
    const url = process.env.REDIS_URL;
    if (!url) {
      this.log.warn('REDIS_URL no configurado; automatización pausada');
      return;
    }
    this.connection = new IORedis(url, { maxRetriesPerRequest: null });
    this.connection.on('error', (error) => this.log.warn(`Redis no disponible: ${error.message}`));
    this.queue = new Queue('conversation-ai', { connection: this.connection });
    this.worker = new Worker('conversation-ai', (job) => this.process(job), {
      connection: this.connection,
      concurrency: Number(process.env.AI_CONCURRENCY ?? 4),
    });
    this.worker.on('failed', (job, error) =>
      this.log.error(`Trabajo ${job?.id} falló: ${error.message}`),
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
    this.connection?.disconnect();
  }

  /**
   * El `jobId` es el `conversationId`: BullMQ ignora un alta duplicada mientras
   * el trabajo sigue pendiente, que es justo la partición por conversación que
   * pide la spec. Antes se usaba `conversationId + Date.now()`, lo que creaba un
   * trabajo por mensaje y producía respuestas encimadas.
   *
   * `removeOnFail` debe ser `true` por la misma razón: un trabajo fallido que
   * se conserva mantiene ocupado su `jobId`, y entonces BullMQ descarta en
   * silencio toda alta posterior. Una sola falla del proveedor dejaba la
   * conversación muda para siempre. El historial de fallos vive en `AiRun`,
   * que además guarda el error y los tokens.
   */
  async enqueue(conversationId: string) {
    if (!this.queue) return undefined;

    // Un trabajo que ya terminó —bien o mal— conserva su `jobId` hasta que se
    // elimina, y mientras tanto BullMQ descarta en silencio cualquier alta con
    // ese mismo id. Retirarlo aquí repara además las conversaciones que
    // quedaron atascadas por una falla anterior, sin tocar Redis a mano.
    try {
      const previous = await this.queue.getJob(conversationId);
      if (previous) {
        const state = await previous.getState();
        if (state === 'completed' || state === 'failed') await previous.remove();
      }
    } catch (error) {
      this.log.warn(
        `No se pudo revisar el trabajo previo de ${conversationId}: ${
          error instanceof Error ? error.message : 'error'
        }`,
      );
    }

    return this.queue.add(
      'reply',
      { conversationId },
      {
        jobId: conversationId,
        delay: DEBOUNCE_MS,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  private async process(job: Job<{ conversationId: string }>) {
    const conversationId = job.data.conversationId;
    const conversation = await this.db.conversation.findUnique({
      where: { id: conversationId },
      include: {
        lead: true,
        agent: { include: { modelConfig: { include: { provider: true } } } },
        // El agente del canal es el respaldo cuando la conversación nació
        // antes de que ese canal tuviera uno asignado.
        session: { include: { agent: { include: { modelConfig: { include: { provider: true } } } } } },
        organization: true,
        messages: { orderBy: { createdAt: 'desc' }, take: HISTORY_WINDOW },
      },
    });

    if (!conversation) return;
    const agent = conversation.agent ?? conversation.session?.agent;

    const blocker = this.blockedReason(conversation, agent);
    if (blocker || !agent) {
      // Registrar el motivo es lo que evita tener que salir a inspeccionar la
      // base para entender por qué un mensaje no obtuvo respuesta.
      this.log.log(`Conversación ${conversationId} sin respuesta automática: ${blocker}`);
      return;
    }

    // La conversación adopta el agente del canal para que la bandeja deje de
    // mostrarla como "sin agente" y las siguientes vueltas no lo re-resuelvan.
    if (!conversation.agentId) {
      await this.db.conversation.update({
        where: { id: conversation.id },
        data: { agentId: agent.id },
      });
    }

    const modelConfig =
      agent.modelConfig ??
      (await this.db.aiModelConfig.findFirst({
        where: {
          enabled: true,
          provider: { enabled: true },
          OR: [{ organizationId: conversation.organizationId }, { organizationId: null }],
        },
        include: { provider: true },
        orderBy: [{ organizationId: 'desc' }, { isDefault: 'desc' }],
      }));

    if (!modelConfig?.provider) {
      this.log.warn(`Conversación ${conversationId} sin respuesta: no hay ningún proveedor de IA habilitado para la agencia ${conversation.organizationId}`);
      return;
    }

    const startedAt = Date.now();
    const run = await this.db.aiRun.create({
      data: {
        organizationId: conversation.organizationId,
        conversationId,
        agentId: agent.id,
        triggerMessageId: conversation.messages[0]?.id,
        aiProviderId: modelConfig.provider.id,
        aiModelConfigId: modelConfig.id,
        model: modelConfig.model,
        status: 'RUNNING',
        instructionsVersion: PROMPT_VERSION,
      },
    });

    try {
      const outcome = await this.generate(conversation, agent, modelConfig, run.id);
      await this.db.aiRun.update({
        where: { id: run.id },
        data: {
          status: outcome.sent ? 'SUCCESS' : 'SKIPPED',
          latencyMs: Date.now() - startedAt,
          promptTokens: outcome.promptTokens,
          completionTokens: outcome.completionTokens,
          toolsInvoked: outcome.toolsInvoked,
          finishedAt: new Date(),
        },
      });
      await this.requeueIfNewer(conversationId, outcome.lastSeenMessageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error desconocido';
      await this.db.aiRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          latencyMs: Date.now() - startedAt,
          errorMessage: message.slice(0, 500),
          finishedAt: new Date(),
        },
      });
      throw error;
    }
  }

  /** Devuelve el motivo por el que no se puede responder, o `null` si sí. */
  private blockedReason(conversation: any, agent: any): string | null {
    if (conversation.mode !== 'AI_ACTIVE') {
      return `la conversación está en ${conversation.mode}`;
    }
    if (!agent) {
      return 'ni la conversación ni su canal tienen un agente asignado';
    }
    if (agent.status !== 'ACTIVE') {
      return `el agente "${agent.name}" está en ${agent.status}, no ACTIVE`;
    }
    if (!agent.aiEnabled) {
      return `el agente "${agent.name}" tiene la IA deshabilitada`;
    }
    if (agent.operationMode === 'HUMAN') {
      return `el agente "${agent.name}" opera en modo solo humano`;
    }
    if (!conversation.session?.providerSessionId) {
      return 'el canal no existe en OpenWA';
    }
    if (conversation.session.status !== 'CONNECTED') {
      return `el canal está en ${conversation.session.status}, no CONNECTED`;
    }
    if (!this.withinBusinessHours(agent.businessHours)) {
      return 'está fuera del horario configurado del agente';
    }
    return null;
  }

  /** `businessHours` es `{ timezone?, days: {mon:[["09:00","18:00"]], …} }`. */
  private withinBusinessHours(businessHours: any): boolean {
    if (!businessHours?.days) return true;
    const now = new Date();
    const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getDay()];
    const ranges = businessHours.days[day];
    if (!Array.isArray(ranges) || !ranges.length) return false;
    const minutes = now.getHours() * 60 + now.getMinutes();
    return ranges.some(([from, to]: [string, string]) => {
      const [fh, fm] = String(from).split(':').map(Number);
      const [th, tm] = String(to).split(':').map(Number);
      return minutes >= fh * 60 + fm && minutes <= th * 60 + tm;
    });
  }

  private async generate(conversation: any, agent: any, modelConfig: any, runId: string) {
    const credentials = {
      kind: modelConfig.provider.kind,
      apiKey: this.secrets.decrypt(modelConfig.provider.encryptedApiKey),
      baseUrl: modelConfig.provider.baseUrl ?? undefined,
    };

    const history = [...conversation.messages].reverse();
    const lastSeenMessageId = history[history.length - 1]?.id;

    const context: ToolContext = {
      organizationId: conversation.organizationId,
      leadId: conversation.leadId,
      conversationId: conversation.id,
      agentId: agent.id,
      maxRecommendations: 3,
    };

    const messages: AiMessage[] = history
      .filter((message: any) => message.text)
      .map((message: any) => ({
        role: message.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const),
        content: message.text as string,
      }));
    if (!messages.length) return { sent: false, toolsInvoked: [], lastSeenMessageId };

    const system = buildSystemPrompt({
      organization: conversation.organization,
      agent,
      lead: conversation.lead,
      summary: conversation.summary,
    });

    const toolsInvoked: string[] = [];
    const recommended = new Set<string>();
    let handoff: { reason: string; priority: string } | undefined;
    let result: AiResult | undefined;
    let promptTokens = 0;
    let completionTokens = 0;

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      result = await this.ai.generate(credentials, {
        model: modelConfig.model,
        system,
        messages,
        tools: this.tools.definitions(),
        temperature: modelConfig.temperature,
        maxTokens: modelConfig.maxTokens,
      });
      promptTokens += result.promptTokens ?? 0;
      completionTokens += result.completionTokens ?? 0;

      if (!result.toolCalls.length) break;

      messages.push({ role: 'assistant', content: result.text, toolCalls: result.toolCalls });
      for (const call of result.toolCalls) {
        toolsInvoked.push(call.name);
        const outcome = await this.tools.execute(context, call);
        outcome.recommendedPropertyIds?.forEach((id) => recommended.add(id));
        if (outcome.handoff) handoff = outcome.handoff;
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          name: call.name,
          content: outcome.result,
        });
      }
    }

    const text = result?.text?.trim();
    if (!text) return { sent: false, toolsInvoked, promptTokens, completionTokens, lastSeenMessageId };

    // Revalidar justo antes de enviar: un humano pudo tomar la conversación
    // mientras el modelo generaba (spec §15).
    const fresh = await this.db.conversation.findUnique({
      where: { id: conversation.id },
      select: { mode: true },
    });
    if (fresh?.mode !== 'AI_ACTIVE') {
      this.log.log(`Respuesta descartada: la conversación ${conversation.id} pasó a control humano`);
      return { sent: false, toolsInvoked, promptTokens, completionTokens, lastSeenMessageId };
    }

    const sent = await this.openwa.sendText({
      providerSessionId: conversation.session.providerSessionId,
      chatId: conversation.lead.whatsappChatId || conversation.lead.phone,
      text,
    });

    const message = await this.db.message.create({
      data: {
        organizationId: conversation.organizationId,
        conversationId: conversation.id,
        sessionId: conversation.sessionId,
        providerMessageId: sent.providerMessageId,
        direction: 'OUTBOUND',
        senderType: 'AI',
        origin: 'CRM',
        type: 'TEXT',
        text,
        status: 'SENT',
      },
    });

    const now = new Date();
    await this.db.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: now,
        lastOutboundAt: now,
        ...(handoff
          ? { mode: 'HUMAN_ACTIVE' as const, status: 'PENDING' as const, handoffReason: handoff.reason }
          : {}),
      },
    });

    if (recommended.size) await this.recordMatches(context, message.id, [...recommended]);
    if (handoff) {
      await this.db.auditLog.create({
        data: {
          organizationId: conversation.organizationId,
          action: 'CONVERSATION_HANDOFF_AI',
          entityType: 'Conversation',
          entityId: conversation.id,
          metadata: handoff,
        },
      });
    }

    return { sent: true, toolsInvoked, promptTokens, completionTokens, lastSeenMessageId };
  }

  /** Deja constancia de qué recomendó la IA y por qué (spec §11.13). */
  private async recordMatches(context: ToolContext, messageId: string, propertyIds: string[]) {
    await this.db.leadPropertyMatch.createMany({
      data: propertyIds.map((propertyId) => ({
        organizationId: context.organizationId,
        leadId: context.leadId,
        propertyId,
        conversationId: context.conversationId,
        messageId,
      })),
      skipDuplicates: true,
    });
  }

  /**
   * Si llegaron mensajes nuevos mientras se generaba la respuesta, se reencola:
   * el `jobId` por conversación evita paralelismo, no la pérdida de un mensaje
   * que entró justo después de leer el historial.
   */
  private async requeueIfNewer(conversationId: string, lastSeenMessageId?: string) {
    if (!lastSeenMessageId) return;
    const newer = await this.db.message.findFirst({
      where: {
        conversationId,
        direction: 'INBOUND',
        createdAt: { gt: (await this.messageDate(lastSeenMessageId)) ?? new Date(0) },
      },
      select: { id: true },
    });
    if (newer) await this.enqueue(conversationId);
  }

  private async messageDate(id: string) {
    const message = await this.db.message.findUnique({
      where: { id },
      select: { createdAt: true },
    });
    return message?.createdAt;
  }
}
