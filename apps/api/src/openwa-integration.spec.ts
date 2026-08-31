import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OpenWaIngestService } from './openwa-ingest.service';
import { OpenWaWebhookController } from './openwa-webhook.controller';
import {
  messageAck, messageReceived, messageSent,
  sessionAuthenticated, sessionDisconnected, sessionRestriction, sessionStatus,
  sign, type DeliveryEnvelope,
} from './openwa-contract.mock';

/**
 * Integración del webhook con el contrato real de OpenWA (spec §22.2).
 *
 * Recorre el camino completo —firma, deduplicación, ingesta— usando payloads
 * con la forma que el proveedor envía de verdad, no una inventada. Las pruebas
 * anteriores usaban la forma imaginaria del código original, así que pasaban
 * mientras producción no recibía un solo mensaje.
 */

const SECRET = 'secreto-de-integracion';
const SESSION = { id: 'sess-local', organizationId: 'org-1', agentId: 'agent-1', providerSessionId: 'wa-1' };

describe('ingesta de webhooks de OpenWA, de punta a punta', () => {
  let db: any;
  let automation: any;
  let events: any;
  let controller: OpenWaWebhookController;
  const vistos = new Set<string>();

  beforeEach(() => {
    process.env.OPENWA_WEBHOOK_SECRET = SECRET;
    vistos.clear();
    automation = { enqueue: vi.fn() };
    events = { publish: vi.fn() };

    db = {
      // Deduplicación real: el índice único sobre (provider, externalEventId).
      webhookEvent: {
        create: vi.fn(async ({ data }: any) => {
          if (vistos.has(data.externalEventId)) {
            const { Prisma } = await import('@prisma/client');
            throw new Prisma.PrismaClientKnownRequestError('duplicate', {
              code: 'P2002', clientVersion: '6.19.3',
            });
          }
          vistos.add(data.externalEventId);
          return { id: `we-${vistos.size}` };
        }),
        update: vi.fn(),
      },
      whatsappSession: { findFirst: vi.fn().mockResolvedValue(SESSION), update: vi.fn() },
      lead: { upsert: vi.fn().mockResolvedValue({ id: 'lead-1' }) },
      conversation: {
        upsert: vi.fn().mockResolvedValue({ id: 'conv-1', agentId: 'agent-1' }),
        update: vi.fn(),
      },
      message: {
        create: vi.fn().mockResolvedValue({ id: 'msg-1' }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: vi.fn() },
    };

    const ingest = new OpenWaIngestService(db, automation, events);
    controller = new OpenWaWebhookController(db, ingest);
  });

  /** Entrega firmada tal como llega del proveedor. */
  function deliver(envelope: DeliveryEnvelope) {
    const { raw, body, signature, headers } = sign(envelope, SECRET);
    return controller.receive(
      { rawBody: raw, body } as any,
      signature,
      headers['x-openwa-idempotency-key'],
      headers['x-openwa-event'],
    );
  }

  it('acepta un mensaje entrante firmado y lo encola para la IA', async () => {
    const result = await deliver(messageReceived({ body: 'Quiero rentar una casa' }));

    expect(result).toMatchObject({ accepted: true, handled: true });
    expect(db.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: 'INBOUND', senderType: 'LEAD', origin: 'WHATSAPP',
        text: 'Quiero rentar una casa', organizationId: 'org-1',
      }),
    });
    expect(automation.enqueue).toHaveBeenCalledWith('conv-1');
    expect(events.publish).toHaveBeenCalledWith('org-1', expect.objectContaining({ type: 'message.created' }));
  });

  /** La entrega es *at-least-once*: el proveedor reintenta el mismo evento. */
  it('la segunda entrega del mismo evento no duplica nada', async () => {
    const evento = messageReceived({ id: 'wamid-repetido' });
    const primera = await deliver(evento);
    const segunda = await deliver(evento);

    expect(primera).toMatchObject({ accepted: true, handled: true });
    expect(segunda).toEqual({ accepted: true, duplicate: true });
    expect(db.message.create).toHaveBeenCalledTimes(1);
    expect(automation.enqueue).toHaveBeenCalledTimes(1);
  });

  it('rechaza una entrega con firma de otro secreto', async () => {
    const { raw, body } = sign(messageReceived(), 'secreto-equivocado');
    await expect(
      controller.receive({ rawBody: raw, body } as any, 'sha256=falsa', 'k1', 'message.received'),
    ).rejects.toThrow(/Firma inválida/);
    expect(db.message.create).not.toHaveBeenCalled();
  });

  it('descarta eventos de una sesión que el CRM no conoce', async () => {
    db.whatsappSession.findFirst.mockResolvedValue(null);
    const result = await deliver(messageReceived({ sessionId: 'wa-desconocida' }));
    expect(result).toMatchObject({ handled: false });
    expect(db.lead.upsert).not.toHaveBeenCalled();
  });

  it('no crea prospectos desde grupos ni difusión', async () => {
    await deliver(messageReceived({ kind: 'group', isGroup: true, from: '1234@g.us' }));
    await deliver(messageReceived({ kind: 'broadcast', from: 'status@broadcast' }));
    expect(db.lead.upsert).not.toHaveBeenCalled();
  });

  /**
   * El caso que rompía el producto: la respuesta de la IA vuelve como
   * `message.sent`. Sin correlacionarla se duplicaba el mensaje y la
   * conversación quedaba marcada como intervenida, dejando muda a la IA.
   */
  it('reconoce su propio envío y no pausa la IA', async () => {
    db.message.findUnique.mockResolvedValue({ id: 'msg-1', status: 'SENT' });
    const result = await deliver(messageSent({ id: 'wamid-propio' }));

    expect(result).toMatchObject({ handled: true });
    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  /** Y el complementario: el asesor escribió desde su teléfono (spec §8.6). */
  it('detecta al asesor respondiendo desde el teléfono y pausa la IA', async () => {
    db.message.findUnique.mockResolvedValue(null);
    await deliver(messageSent({ id: 'wamid-telefono', body: 'Yo te atiendo' }));

    expect(db.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ senderType: 'HUMAN', origin: 'WHATSAPP_PHONE' }),
    });
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: expect.objectContaining({ mode: 'HUMAN_ACTIVE' }),
    });
  });

  it('propaga los acuses de entrega hasta el estado del mensaje', async () => {
    await deliver(messageAck({ messageId: 'wamid-x', status: 'delivered' }));
    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: { sessionId: 'sess-local', providerMessageId: 'wamid-x' },
      data: expect.objectContaining({ status: 'DELIVERED' }),
    });

    await deliver(messageAck({ messageId: 'wamid-y', status: 'read' }));
    expect(db.message.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'READ' }) }),
    );
  });

  it('registra un envío fallido con su código de error', async () => {
    await deliver(messageAck({ messageId: 'wamid-z', status: 'failed' }));
    expect(db.message.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', errorCode: 'PROVIDER_ACK_FAILED' }),
      }),
    );
  });

  it('traduce el ciclo de vida del canal al enum del CRM', async () => {
    await deliver(sessionStatus('qr_ready'));
    expect(db.whatsappSession.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'QR_REQUIRED' }) }),
    );

    await deliver(sessionAuthenticated());
    expect(db.whatsappSession.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'CONNECTED', phoneNumber: '5218138703134' }),
      }),
    );

    await deliver(sessionDisconnected('conflict'));
    expect(db.whatsappSession.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DISCONNECTED', failureReason: 'conflict' }),
      }),
    );
  });

  /** Riesgo de plataforma §10.5: una restricción debe quedar auditada. */
  it('deja rastro auditable cuando WhatsApp restringe la cuenta', async () => {
    await deliver(sessionRestriction(true));
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'WHATSAPP_RESTRICTION_APPLIED',
        entityType: 'WhatsappSession',
      }),
    });
  });

  it('deja constancia del evento aunque no sepa manejarlo', async () => {
    const desconocido = { ...messageReceived(), event: 'group.join' };
    const result = await deliver(desconocido as any);
    expect(result).toMatchObject({ accepted: true, handled: false });
    // Rechazado para el dominio, pero registrado para diagnóstico.
    expect(db.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
    );
  });
});
