import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapProviderStatus } from './openwa.gateway';
import {
  OpenWaIngestService,
  mapMessageType,
  normalizePhone,
  toDate,
} from './openwa-ingest.service';
import { OpenWaWebhookController } from './openwa-webhook.controller';

const SECRET = 'secreto-de-prueba';
const session = { id: 's1', organizationId: 'org-1', agentId: 'a1', providerSessionId: 'wa-1' };

function envelope(event: string, data: Record<string, unknown>) {
  return { event, sessionId: 'wa-1', idempotencyKey: `key-${event}`, data };
}

describe('normalización del contrato de OpenWA', () => {
  it('extrae el teléfono de cualquier sufijo de chat', () => {
    expect(normalizePhone('5214490000000@c.us')).toBe('5214490000000');
    expect(normalizePhone('5214490000000@s.whatsapp.net')).toBe('5214490000000');
    expect(normalizePhone(undefined)).toBe('');
  });

  it('traduce los tipos del proveedor y tolera los desconocidos', () => {
    expect(mapMessageType('text')).toBe('TEXT');
    expect(mapMessageType('voice')).toBe('VOICE');
    expect(mapMessageType('algo-nuevo')).toBe('UNKNOWN');
  });

  it('interpreta el timestamp como epoch en segundos', () => {
    expect(toDate(1770000000)?.toISOString()).toBe(new Date(1770000000000).toISOString());
    expect(toDate(0)).toBeUndefined();
  });

  it('mapea los estados de sesión del proveedor al enum del CRM', () => {
    expect(mapProviderStatus('ready')).toBe('CONNECTED');
    expect(mapProviderStatus('qr_ready')).toBe('QR_REQUIRED');
    expect(mapProviderStatus('action_required')).toBe('QR_REQUIRED');
    expect(mapProviderStatus('initializing')).toBe('STARTING');
    expect(mapProviderStatus('failed')).toBe('FAILED');
  });
});

describe('verificación de firma del webhook', () => {
  let db: any;
  let controller: OpenWaWebhookController;
  const ingest: any = { handle: vi.fn().mockResolvedValue({ handled: true }) };

  beforeEach(() => {
    process.env.OPENWA_WEBHOOK_SECRET = SECRET;
    db = {
      webhookEvent: {
        create: vi.fn().mockResolvedValue({ id: 'we1' }),
        update: vi.fn(),
      },
    };
    controller = new OpenWaWebhookController(db, ingest);
  });

  function request(raw: Buffer, body: unknown) {
    return { rawBody: raw, body } as any;
  }

  it('acepta la firma calculada sobre los bytes crudos con prefijo sha256=', async () => {
    const body = envelope('message.received', { id: 'm1' });
    const raw = Buffer.from(JSON.stringify(body));
    const signature = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');

    const result = await controller.receive(request(raw, body), signature, 'key-1', 'message.received');
    expect(result).toMatchObject({ accepted: true });
    expect(ingest.handle).toHaveBeenCalled();
  });

  it('rechaza una firma sin el prefijo del proveedor', async () => {
    const body = envelope('message.received', { id: 'm1' });
    const raw = Buffer.from(JSON.stringify(body));
    const hexOnly = createHmac('sha256', SECRET).update(raw).digest('hex');

    await expect(
      controller.receive(request(raw, body), hexOnly, 'key-2', 'message.received'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rechaza cuando falta el cuerpo crudo en vez de firmar sobre uno re-serializado', async () => {
    const body = envelope('message.received', { id: 'm1' });
    await expect(
      controller.receive({ body } as any, 'sha256=lo-que-sea', 'key-3', 'message.received'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('trata un evento repetido como duplicado sin volver a procesarlo', async () => {
    const body = envelope('message.received', { id: 'm1' });
    const raw = Buffer.from(JSON.stringify(body));
    const signature = 'sha256=' + createHmac('sha256', SECRET).update(raw).digest('hex');
    db.webhookEvent.create.mockRejectedValue(
      Object.assign(new Error('duplicate'), { code: 'P2002', name: 'PrismaClientKnownRequestError' }),
    );
    // El índice único sobre (provider, externalEventId) es lo que deduplica.
    const { Prisma } = await import('@prisma/client');
    db.webhookEvent.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );

    const result = await controller.receive(request(raw, body), signature, 'key-1', 'message.received');
    expect(result).toEqual({ accepted: true, duplicate: true });
  });
});

describe('ingesta de eventos', () => {
  let db: any;
  let automation: any;
  let ingest: OpenWaIngestService;

  beforeEach(() => {
    automation = { enqueue: vi.fn() };
    db = {
      whatsappSession: { findFirst: vi.fn().mockResolvedValue(session), update: vi.fn() },
      lead: { upsert: vi.fn().mockResolvedValue({ id: 'l1' }) },
      conversation: { upsert: vi.fn().mockResolvedValue({ id: 'c1', mode: 'AI_ACTIVE' }), update: vi.fn() },
      message: {
        create: vi.fn().mockResolvedValue({ id: 'm1' }),
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { create: vi.fn() },
    };
    ingest = new OpenWaIngestService(db, automation);
  });

  it('registra un mensaje entrante y encola la respuesta de la IA', async () => {
    const result = await ingest.handle(
      envelope('message.received', {
        id: 'wamid-1',
        from: '5214490000000@c.us',
        body: 'Hola, busco casa',
        type: 'text',
        kind: 'individual',
        timestamp: 1770000000,
        contact: { pushName: 'Ana' },
      }),
    );
    expect(result.handled).toBe(true);
    expect(db.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        direction: 'INBOUND',
        senderType: 'LEAD',
        origin: 'WHATSAPP',
        providerMessageId: 'wamid-1',
      }),
    });
    expect(automation.enqueue).toHaveBeenCalledWith('c1');
  });

  it('ignora mensajes de grupos y difusión: no crean leads', async () => {
    const result = await ingest.handle(
      envelope('message.received', { id: 'g1', from: '123@g.us', kind: 'group', isGroup: true }),
    );
    expect(result.handled).toBe(false);
    expect(db.lead.upsert).not.toHaveBeenCalled();
  });

  /**
   * Este es el caso que dejaba muda a la IA: su propia respuesta vuelve como
   * `message.sent` y, si no se correlaciona, se guardaba de nuevo y marcaba la
   * conversación como intervenida por un humano.
   */
  it('reconoce el eco de un envío del CRM y no pausa la IA', async () => {
    db.message.findUnique.mockResolvedValue({ id: 'm1', status: 'SENT' });
    const result = await ingest.handle(
      envelope('message.sent', { id: 'wamid-crm', to: '5214490000000@c.us', body: 'Hola', type: 'text' }),
    );
    expect(result).toMatchObject({ handled: true, reason: 'eco del CRM' });
    expect(db.message.create).not.toHaveBeenCalled();
    expect(db.conversation.update).not.toHaveBeenCalled();
  });

  it('registra la respuesta del asesor desde el teléfono y pausa la IA', async () => {
    db.message.findUnique.mockResolvedValue(null);
    await ingest.handle(
      envelope('message.sent', {
        id: 'wamid-phone',
        to: '5214490000000@c.us',
        body: 'Yo te atiendo',
        type: 'text',
        kind: 'individual',
      }),
    );
    expect(db.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ senderType: 'HUMAN', origin: 'WHATSAPP_PHONE' }),
    });
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: expect.objectContaining({ mode: 'HUMAN_ACTIVE' }),
    });
  });

  it('actualiza el estado de entrega con message.ack', async () => {
    await ingest.handle(envelope('message.ack', { messageId: 'wamid-1', status: 'read' }));
    expect(db.message.updateMany).toHaveBeenCalledWith({
      where: { sessionId: 's1', providerMessageId: 'wamid-1' },
      data: expect.objectContaining({ status: 'READ' }),
    });
  });

  it('marca la sesión conectada al autenticarse', async () => {
    await ingest.handle(envelope('session.authenticated', { phone: '5214490000000', pushName: 'Ventas' }));
    expect(db.whatsappSession.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: expect.objectContaining({ status: 'CONNECTED', phoneNumber: '5214490000000' }),
    });
  });

  it('deja rastro auditable cuando WhatsApp restringe la cuenta', async () => {
    await ingest.handle(envelope('session.restriction', { active: true, kind: 'SPAM', code: 'X1' }));
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'WHATSAPP_RESTRICTION_APPLIED' }),
    });
  });

  it('descarta eventos de sesiones no registradas', async () => {
    db.whatsappSession.findFirst.mockResolvedValue(null);
    const result = await ingest.handle(envelope('message.received', { id: 'x' }));
    expect(result).toMatchObject({ handled: false, reason: 'sesión desconocida' });
  });
});
