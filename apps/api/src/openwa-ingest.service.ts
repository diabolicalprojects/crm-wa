import { Injectable, Logger } from '@nestjs/common';
import { MessageType, Prisma, SessionStatus } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { AutomationService } from './automation.service';
import { EventsService } from './events.service';
import { mapProviderStatus } from './openwa.gateway';

/**
 * Procesa los eventos de OpenWA ya verificados por el controlador.
 *
 * Reglas del contrato que gobiernan este archivo (`docs/openwa-contract.md`):
 *
 * - La entrega es *at-least-once*: todo manejador es idempotente por
 *   `idempotencyKey`, nunca por optimismo.
 * - `message.received` **no** trae `fromMe`. Los mensajes salientes llegan como
 *   un evento distinto, `message.sent`.
 * - El eco de un envío propio del CRM llega como `message.sent` con el mismo
 *   `data.id` que devolvió `send-text`; correlacionarlo evita duplicar el
 *   mensaje y evita pausar la IA por su propia respuesta (spec §15).
 */

export interface OpenWaEnvelope {
  event: string;
  timestamp?: string;
  sessionId: string;
  idempotencyKey?: string;
  deliveryId?: string;
  data?: Record<string, any>;
}

/** Chats que no representan un prospecto y no deben crear leads. */
const IGNORED_CHAT_KINDS = new Set(['group', 'status', 'broadcast', 'channel']);

const MESSAGE_TYPES: Record<string, MessageType> = {
  text: MessageType.TEXT,
  image: MessageType.IMAGE,
  video: MessageType.VIDEO,
  audio: MessageType.AUDIO,
  voice: MessageType.VOICE,
  document: MessageType.DOCUMENT,
  sticker: MessageType.STICKER,
  location: MessageType.LOCATION,
  contact: MessageType.CONTACT,
  poll: MessageType.POLL,
  call: MessageType.CALL,
  revoked: MessageType.REVOKED,
  masked: MessageType.MASKED,
};

/** `5214490000000@c.us` → `5214490000000`. */
export function normalizePhone(value: unknown): string {
  return String(value ?? '')
    .split('@')[0]
    .replace(/\D/g, '');
}

export function mapMessageType(value: unknown): MessageType {
  return MESSAGE_TYPES[String(value ?? '').toLowerCase()] ?? MessageType.UNKNOWN;
}

/** El proveedor usa epoch en segundos para mensajes. */
export function toDate(epochSeconds: unknown): Date | undefined {
  const value = Number(epochSeconds);
  return Number.isFinite(value) && value > 0 ? new Date(value * 1000) : undefined;
}

@Injectable()
export class OpenWaIngestService {
  private readonly log = new Logger(OpenWaIngestService.name);

  constructor(
    private db: PrismaService,
    private automation: AutomationService,
    private events: EventsService,
  ) {}

  async handle(envelope: OpenWaEnvelope): Promise<{ handled: boolean; reason?: string }> {
    const session = await this.db.whatsappSession.findFirst({
      where: { providerSessionId: String(envelope.sessionId) },
    });
    // Solo se aceptan sesiones previamente registradas (spec §10.3).
    if (!session) return { handled: false, reason: 'sesión desconocida' };

    const data = envelope.data ?? {};
    switch (envelope.event) {
      case 'message.received':
        return this.onInbound(session, data);
      case 'message.sent':
        return this.onOutbound(session, data);
      case 'message.ack':
      case 'message.failed':
        return this.onAck(session, data);
      case 'session.status':
        return this.onSessionStatus(session, data);
      case 'session.qr':
        return this.onSessionState(session, SessionStatus.QR_REQUIRED, data);
      case 'session.authenticated':
        return this.onAuthenticated(session, data);
      case 'session.disconnected':
        return this.onDisconnected(session, data);
      case 'session.restriction':
        return this.onRestriction(session, data);
      default:
        return { handled: false, reason: `evento no manejado: ${envelope.event}` };
    }
  }

  // -------------------------------------------------------------------------
  // Mensajes
  // -------------------------------------------------------------------------

  private async onInbound(session: any, data: Record<string, any>) {
    if (IGNORED_CHAT_KINDS.has(String(data.kind ?? '').toLowerCase()) || data.isGroup) {
      return { handled: false, reason: 'chat no individual' };
    }
    const providerMessageId = data.id ? String(data.id) : undefined;
    if (!providerMessageId) return { handled: false, reason: 'mensaje sin id' };

    // `senderPhone` aparece cuando el remitente se identifica con un `@lid`.
    const phone = normalizePhone(data.senderPhone ?? data.from);
    if (!phone) return { handled: false, reason: 'remitente sin teléfono' };

    const organizationId = session.organizationId;
    const chatId = String(data.from ?? '');
    const contactName = data.contact?.name ?? data.contact?.pushName ?? undefined;

    const lead = await this.db.lead.upsert({
      where: { organizationId_phone: { organizationId, phone } },
      create: { organizationId, phone, whatsappChatId: chatId, name: contactName },
      // Nunca sobreescribir con vacío un nombre ya capturado por un asesor.
      update: { whatsappChatId: chatId, lastContactAt: new Date() },
    });

    const conversation = await this.db.conversation.upsert({
      where: {
        organizationId_leadId_sessionId: { organizationId, leadId: lead.id, sessionId: session.id },
      },
      create: {
        organizationId,
        leadId: lead.id,
        sessionId: session.id,
        agentId: session.agentId,
      },
      update: {},
    });

    // Una conversación creada antes de que el canal tuviera agente se quedaba
    // sin él para siempre, y el worker exige un agente activo para responder.
    // Adoptar el del canal la reincorpora en cuanto se asigna uno.
    if (!conversation.agentId && session.agentId) {
      await this.db.conversation.update({
        where: { id: conversation.id },
        data: { agentId: session.agentId },
      });
      conversation.agentId = session.agentId;
    }

    const created = await this.createMessageOnce({
      organizationId,
      conversationId: conversation.id,
      sessionId: session.id,
      providerMessageId,
      direction: 'INBOUND',
      senderType: 'LEAD',
      origin: 'WHATSAPP',
      type: mapMessageType(data.type),
      text: data.body ? String(data.body) : undefined,
      status: 'RECEIVED',
      providerTimestamp: toDate(data.timestamp),
      metadata: this.messageMetadata(data),
    });

    if (!created) return { handled: true, reason: 'mensaje duplicado' };

    const now = new Date();
    await this.db.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now, lastInboundAt: now, status: 'OPEN' },
    });

    this.events.publish(organizationId, {
      type: 'message.created',
      conversationId: conversation.id,
      leadId: lead.id,
    });

    // La generación de la respuesta ocurre fuera del ciclo HTTP (spec §28.3).
    await this.automation.enqueue(conversation.id);
    return { handled: true };
  }

  /**
   * `message.sent` cubre dos casos distintos que hay que separar:
   *
   * 1. **Eco de un envío del CRM.** El mensaje ya existe con ese
   *    `providerMessageId`; solo se confirma el estado. Marcar la conversación
   *    como intervenida aquí dejaría a la IA muda tras su primera respuesta.
   * 2. **El asesor respondió desde su teléfono.** No hay mensaje previo: se
   *    registra como humano y la IA queda pausada indefinidamente hasta un
   *    "Devolver a IA" explícito (spec §8.6).
   */
  private async onOutbound(session: any, data: Record<string, any>) {
    const providerMessageId = data.id ? String(data.id) : undefined;
    if (!providerMessageId) return { handled: false, reason: 'mensaje sin id' };

    const existing = await this.db.message.findUnique({
      where: {
        sessionId_providerMessageId: { sessionId: session.id, providerMessageId },
      },
    });

    if (existing) {
      if (existing.status === 'QUEUED' || existing.status === 'GENERATING') {
        await this.db.message.update({
          where: { id: existing.id },
          data: { status: 'SENT' },
        });
      }
      return { handled: true, reason: 'eco del CRM' };
    }

    if (IGNORED_CHAT_KINDS.has(String(data.kind ?? '').toLowerCase()) || data.isGroup) {
      return { handled: false, reason: 'chat no individual' };
    }

    const phone = normalizePhone(data.to);
    if (!phone) return { handled: false, reason: 'destinatario sin teléfono' };

    const organizationId = session.organizationId;
    const lead = await this.db.lead.upsert({
      where: { organizationId_phone: { organizationId, phone } },
      create: { organizationId, phone, whatsappChatId: String(data.to ?? '') },
      update: { lastContactAt: new Date() },
    });

    const conversation = await this.db.conversation.upsert({
      where: {
        organizationId_leadId_sessionId: { organizationId, leadId: lead.id, sessionId: session.id },
      },
      create: { organizationId, leadId: lead.id, sessionId: session.id, agentId: session.agentId },
      update: {},
    });

    await this.createMessageOnce({
      organizationId,
      conversationId: conversation.id,
      sessionId: session.id,
      providerMessageId,
      direction: 'OUTBOUND',
      senderType: 'HUMAN',
      origin: 'WHATSAPP_PHONE',
      type: mapMessageType(data.type),
      text: data.body ? String(data.body) : undefined,
      status: 'SENT',
      providerTimestamp: toDate(data.timestamp),
      metadata: this.messageMetadata(data),
    });

    const now = new Date();
    await this.db.conversation.update({
      where: { id: conversation.id },
      data: {
        mode: 'HUMAN_ACTIVE',
        handoffReason: 'El asesor respondió desde WhatsApp',
        lastMessageAt: now,
        lastOutboundAt: now,
      },
    });
    this.events.publish(organizationId, {
      type: 'conversation.updated',
      conversationId: conversation.id,
      mode: 'HUMAN_ACTIVE',
    });
    this.log.log(`Control humano desde teléfono en la conversación ${conversation.id}`);
    return { handled: true, reason: 'toma de control desde el teléfono' };
  }

  private async onAck(session: any, data: Record<string, any>) {
    const providerMessageId = String(data.messageId ?? data.id ?? '');
    if (!providerMessageId) return { handled: false, reason: 'acuse sin id' };

    const status = this.ackStatus(data.status);
    if (!status) return { handled: false, reason: `estado desconocido: ${data.status}` };

    const result = await this.db.message.updateMany({
      where: { sessionId: session.id, providerMessageId },
      data: {
        status,
        ...(status === 'FAILED' ? { errorCode: 'PROVIDER_ACK_FAILED' } : {}),
      },
    });
    return result.count
      ? { handled: true }
      : { handled: false, reason: 'mensaje no encontrado para el acuse' };
  }

  /** No degradar el estado: un `sent` posterior a un `read` no debe retroceder. */
  private ackStatus(value: unknown) {
    const order = { pending: 0, sent: 1, delivered: 2, read: 3 } as const;
    const key = String(value ?? '').toLowerCase();
    if (key === 'failed') return 'FAILED' as const;
    if (!(key in order)) return undefined;
    return (
      { pending: 'QUEUED', sent: 'SENT', delivered: 'DELIVERED', read: 'READ' } as const
    )[key as keyof typeof order];
  }

  // -------------------------------------------------------------------------
  // Sesión
  // -------------------------------------------------------------------------

  private async onSessionStatus(session: any, data: Record<string, any>) {
    const status = mapProviderStatus(data.status) as SessionStatus;
    return this.onSessionState(session, status, data);
  }

  private async onSessionState(
    session: any,
    status: SessionStatus,
    data: Record<string, any>,
  ) {
    await this.db.whatsappSession.update({
      where: { id: session.id },
      data: {
        status,
        lastProviderStatus: data.status ? String(data.status) : undefined,
        lastSeenAt: new Date(),
        ...(status === 'CONNECTED' ? { connectedAt: new Date(), failureReason: null } : {}),
        ...(status === 'DISCONNECTED' ? { disconnectedAt: new Date() } : {}),
      },
    });
    this.events.publish(session.organizationId, {
      type: 'session.updated',
      sessionId: session.id,
      status,
    });
    return { handled: true };
  }

  private async onAuthenticated(session: any, data: Record<string, any>) {
    await this.db.whatsappSession.update({
      where: { id: session.id },
      data: {
        status: SessionStatus.CONNECTED,
        phoneNumber: data.phone ? normalizePhone(data.phone) : undefined,
        waAccountId: data.pushName ? String(data.pushName) : undefined,
        connectedAt: new Date(),
        lastSeenAt: new Date(),
        failureReason: null,
      },
    });
    return { handled: true };
  }

  private async onDisconnected(session: any, data: Record<string, any>) {
    await this.db.whatsappSession.update({
      where: { id: session.id },
      data: {
        status: SessionStatus.DISCONNECTED,
        disconnectedAt: new Date(),
        failureReason: data.reason ? String(data.reason).slice(0, 500) : undefined,
      },
    });
    return { handled: true };
  }

  /** Riesgo de plataforma documentado en la spec §10.5: se audita, no se oculta. */
  private async onRestriction(session: any, data: Record<string, any>) {
    await this.db.auditLog.create({
      data: {
        organizationId: session.organizationId,
        action: data.active ? 'WHATSAPP_RESTRICTION_APPLIED' : 'WHATSAPP_RESTRICTION_LIFTED',
        entityType: 'WhatsappSession',
        entityId: session.id,
        metadata: {
          kind: data.kind ?? null,
          code: data.code ?? null,
          expiresAt: data.expiresAt ?? null,
        },
      },
    });
    this.log.warn(
      `Restricción de WhatsApp en la sesión ${session.id}: ${data.kind ?? 'desconocida'}`,
    );
    return { handled: true };
  }

  // -------------------------------------------------------------------------
  // Utilidades
  // -------------------------------------------------------------------------

  /**
   * Inserta el mensaje solo si su `providerMessageId` no existe todavía.
   * La comprobación es atómica: se apoya en el índice único
   * `(sessionId, providerMessageId)` y no en un `findFirst` previo, que en
   * entregas simultáneas deja pasar duplicados.
   */
  private async createMessageOnce(data: Prisma.MessageUncheckedCreateInput): Promise<boolean> {
    try {
      await this.db.message.create({ data });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }
  }

  /** Metadata mínima: el contrato pide retención acotada (spec §11.9). */
  private messageMetadata(data: Record<string, any>) {
    return {
      kind: data.kind ?? null,
      hasMedia: data.hasMedia ?? false,
      ...(data.media?.omitted ? { mediaOmitted: true, mediaSize: data.media.sizeBytes } : {}),
    } as Prisma.InputJsonValue;
  }
}
