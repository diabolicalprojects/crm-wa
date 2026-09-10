import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Job, Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { AiGateway, AiMessage, AiResult } from './ai-gateway';
import { AiToolsService, ToolContext } from './ai-tools.service';
import { EventsService } from './events.service';
import { OpenWaGateway } from './openwa.gateway';
import { PrismaService } from './prisma.service';
import { NotificationsService } from './notifications.service';
import { SecretsService } from './secrets.service';
import { buildSystemPrompt, PROMPT_VERSION, SUMMARY_INSTRUCTIONS } from './prompt';

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

/**
 * Memoria de la conversación (spec §13.7). La ventana reciente sola no basta:
 * pasada esa cantidad de mensajes el agente olvidaría lo hablado antes. Cuando
 * la conversación crece se condensa lo que queda fuera de la ventana, y se
 * recondensa cada tantos mensajes nuevos para no pagar un resumen por turno.
 */
const SUMMARY_AFTER = HISTORY_WINDOW;
const SUMMARY_EVERY = 10;

/**
 * Qué ve el modelo de un mensaje.
 *
 * Un mensaje que solo trae archivo no tiene texto, y filtrarlo dejaba a la IA
 * sin nada que responder: mandar una foto sin pie equivalía a no escribir. Aquí
 * se convierte en un aviso explícito de que llegó un archivo —nunca en una
 * descripción de su contenido, porque el modelo no lo está viendo—. La regla
 * que se lo prohíbe explícitamente vive en `PRODUCT_RULES`.
 */
export function describeForPrompt(message: {
  text?: string | null;
  type?: string | null;
  direction?: string;
}): string {
  const texto = (message.text ?? '').trim();
  const etiqueta = ADJUNTOS[String(message.type ?? '')];
  if (!etiqueta) return texto;
  const quien = message.direction === 'INBOUND' ? 'El prospecto' : 'El asesor';
  return texto ? `${texto}
[${quien} adjuntó ${etiqueta}]` : `[${quien} envió ${etiqueta}]`;
}

const ADJUNTOS: Record<string, string> = {
  IMAGE: 'una imagen',
  VIDEO: 'un video',
  AUDIO: 'un audio',
  VOICE: 'una nota de voz',
  DOCUMENT: 'un documento',
  STICKER: 'una calcomanía',
  LOCATION: 'una ubicación',
  CONTACT: 'un contacto',
};

/** Palabra con la que el agente declina insistir. */
export const NO_INSISTIR = 'NO_INSISTIR';

/**
 * Qué queda escrito de cada herramienta que ejecutó el agente.
 *
 * Antes se guardaba solo el nombre, y con eso no se puede responder la pregunta
 * que de verdad hace un dueño de agencia: «¿de dónde sacó ese precio?». Se
 * guarda qué se pidió y qué contestó —no el resultado completo, que puede ser
 * largo, sino su forma— para que la conversación sea auditable sin volverse un
 * volcado.
 */
export interface ToolTrace {
  name: string;
  /** Los argumentos con los que el modelo la llamó, recortados. */
  args?: Record<string, unknown>;
  /** Una línea legible de lo que devolvió. */
  detail?: string;
  ok: boolean;
}

const MAX_ARG_CHARS = 120;

export function traceOf(
  call: { name: string; input?: unknown },
  outcome: { result: string; recommendedPropertyIds?: string[] },
): ToolTrace {
  const args =
    call.input && typeof call.input === 'object' && !Array.isArray(call.input)
      ? Object.fromEntries(
          Object.entries(call.input as Record<string, unknown>)
            .filter(([, v]) => v !== undefined && v !== null && v !== '')
            .slice(0, 12)
            .map(([k, v]) => [k, recortar(v)]),
        )
      : undefined;

  // El resultado de una búsqueda es JSON; el de las demás, una frase. Se
  // resume lo primero y se recorta lo segundo.
  let detail: string | undefined;
  let ok = true;
  try {
    const parsed = JSON.parse(outcome.result);
    if (typeof parsed?.found === 'number') {
      detail = `${parsed.found} ${parsed.found === 1 ? 'resultado' : 'resultados'}`;
      ok = parsed.found > 0;
    } else {
      detail = String(outcome.result).slice(0, 160);
    }
  } catch {
    detail = String(outcome.result).slice(0, 160);
    ok = !/^No fue posible|^Herramienta desconocida/.test(detail);
  }

  if (outcome.recommendedPropertyIds?.length) {
    detail = `${detail} · ${outcome.recommendedPropertyIds.length} recomendadas`;
  }
  return { name: call.name, ...(args ? { args } : {}), detail, ok };
}

function recortar(value: unknown) {
  const texto = typeof value === 'string' ? value : JSON.stringify(value);
  return texto && texto.length > MAX_ARG_CHARS ? `${texto.slice(0, MAX_ARG_CHARS)}…` : value;
}

/**
 * Lo que se le añade al contexto cuando el turno es un seguimiento proactivo y
 * no una respuesta.
 *
 * Dos cosas importan aquí. Que el agente sepa que **nadie le escribió** —de
 * otro modo responde a un mensaje que no existe— y que pueda negarse. Sin la
 * salida de escape, un seguimiento se manda siempre, tenga o no algo que decir,
 * y eso es exactamente lo que se siente como spam.
 */
export const FOLLOW_UP_INSTRUCTIONS = `

SEGUIMIENTO PROACTIVO
Este turno NO responde a un mensaje nuevo: el prospecto lleva días sin contestar
y la agencia configuró que le escribas de nuevo.

- Escribe UN solo mensaje, corto, retomando algo concreto de lo ya hablado.
- No repitas lo que ya dijiste con otras palabras. Aporta algo: una opción que
  no habías mostrado, una pregunta que ayude a acotar, o una facilidad real.
- No reproches el silencio ni presiones. Una sola pregunta, fácil de contestar.
- Si no tienes nada útil que aportar, o el prospecto ya dijo que no le
  interesa, responde exactamente ${NO_INSISTIR} y nada más. No se enviará
  ningún mensaje, y eso es preferible a insistir por insistir.`;

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
    private events: EventsService,
    private notifications: NotificationsService,
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
  async enqueue(conversationId: string, opts: { followUp?: boolean } = {}) {
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
      { conversationId, followUp: opts.followUp ?? false },
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

  private async process(job: Job<{ conversationId: string; followUp?: boolean }>) {
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
      const outcome = await this.generate(
        conversation,
        agent,
        modelConfig,
        run.id,
        Boolean(job.data.followUp),
      );
      await this.db.aiRun.update({
        where: { id: run.id },
        data: {
          status: outcome.sent ? 'SUCCESS' : 'SKIPPED',
          latencyMs: Date.now() - startedAt,
          promptTokens: outcome.promptTokens,
          completionTokens: outcome.completionTokens,
          toolsInvoked: outcome.toolsInvoked as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      // Después de responder, no antes: condensar la memoria no debe retrasar
      // la respuesta al prospecto.
      await this.refreshSummary(conversation, modelConfig).catch((error) =>
        this.log.warn(`No se pudo condensar la memoria de ${conversationId}: ${error.message}`),
      );
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

  private async generate(
    conversation: any,
    agent: any,
    modelConfig: any,
    runId: string,
    seguimientoPedido = false,
  ) {
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
      .map((message: any) => ({
        role: message.direction === 'INBOUND' ? ('user' as const) : ('assistant' as const),
        content: describeForPrompt(message),
      }))
      .filter((message) => message.content.length > 0);
    if (!messages.length) return { sent: false, toolsInvoked: [] as ToolTrace[], lastSeenMessageId };

    // La marca puede haber quedado obsoleta: el `jobId` es la conversación, así
    // que un mensaje que llegó entre encolar y procesar comparte trabajo con el
    // seguimiento. Si el prospecto ya escribió, esto es una respuesta normal.
    const esSeguimiento = seguimientoPedido && history[0]?.direction !== 'INBOUND';

    const system =
      buildSystemPrompt({
        organization: conversation.organization,
        agent,
        lead: conversation.lead,
        summary: conversation.summary,
      }) + (esSeguimiento ? FOLLOW_UP_INSTRUCTIONS : '');

    const toolsInvoked: ToolTrace[] = [];
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
        const outcome = await this.tools.execute(context, call);
        toolsInvoked.push(traceOf(call, outcome));
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

    // El agente puede negarse a insistir. Es deliberado: un seguimiento que no
    // aporta nada se siente como spam, y quien mejor puede juzgarlo es quien
    // acaba de leer la conversación completa.
    if (esSeguimiento && text.toUpperCase().includes(NO_INSISTIR)) {
      this.log.log(`Seguimiento descartado por el agente en la conversación ${conversation.id}`);
      return { sent: false, toolsInvoked, promptTokens, completionTokens, lastSeenMessageId };
    }

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

    this.events.publish(conversation.organizationId, {
      type: 'message.created',
      conversationId: conversation.id,
      leadId: conversation.leadId,
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

      // Un handoff que nadie ve deja al prospecto esperando a un humano que no
      // sabe que lo esperan: es el peor estado posible de esta conversación.
      await this.notifications.notify({
        organizationId: conversation.organizationId,
        userIds: [conversation.assignedUserId, agent.responsibleUserId],
        kind: 'HANDOFF',
        title: `${conversation.lead.name || conversation.lead.phone} necesita a una persona`,
        body: handoff.reason,
        entityType: 'Conversation',
        entityId: conversation.id,
      });
    }

    return { sent: true, toolsInvoked, promptTokens, completionTokens, lastSeenMessageId };
  }

  /**
   * Condensa lo que quedó fuera de la ventana reciente y lo guarda en la
   * conversación, que es de donde `buildSystemPrompt` lo lee. Sin esto el
   * agente olvidaba todo lo hablado más allá de los últimos mensajes: el campo
   * `summary` se leía pero nunca se escribía.
   */
  private async refreshSummary(conversation: any, modelConfig: any) {
    const total = await this.db.message.count({ where: { conversationId: conversation.id } });
    if (total <= SUMMARY_AFTER) return;

    // Recondensar solo cada cierto número de mensajes nuevos: un resumen por
    // turno multiplicaría el costo sin aportar memoria adicional.
    if (conversation.summaryUpdatedAt) {
      const nuevos = await this.db.message.count({
        where: { conversationId: conversation.id, createdAt: { gt: conversation.summaryUpdatedAt } },
      });
      if (nuevos < SUMMARY_EVERY) return;
    }

    // Solo lo que cae fuera de la ventana: lo reciente ya viaja completo.
    const previos = await this.db.message.findMany({
      where: { conversationId: conversation.id, text: { not: null } },
      orderBy: { createdAt: 'desc' },
      skip: HISTORY_WINDOW,
      take: 60,
      select: { direction: true, senderType: true, text: true },
    });
    if (!previos.length) return;

    const transcripcion = previos
      .reverse()
      .map((m) => `${m.direction === 'INBOUND' ? 'Prospecto' : m.senderType === 'AI' ? 'Agente' : 'Asesor'}: ${describeForPrompt(m)}`)
      .join('\n');

    const result = await this.ai.generate(
      {
        kind: modelConfig.provider.kind,
        apiKey: this.secrets.decrypt(modelConfig.provider.encryptedApiKey),
        baseUrl: modelConfig.provider.baseUrl ?? undefined,
      },
      {
        model: modelConfig.model,
        system: SUMMARY_INSTRUCTIONS,
        messages: [
          {
            role: 'user',
            content: `${conversation.summary ? `Resumen previo:\n${conversation.summary}\n\n` : ''}Conversación a condensar:\n${transcripcion}`,
          },
        ],
        maxTokens: 600,
      },
    );

    if (!result.text) return;
    await this.db.conversation.update({
      where: { id: conversation.id },
      data: { summary: result.text, summaryUpdatedAt: new Date() },
    });
    this.log.log(`Memoria condensada en la conversación ${conversation.id}`);
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
