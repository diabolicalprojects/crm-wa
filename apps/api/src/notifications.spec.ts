import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationsService, PREFS_POR_OMISION, canalesDe } from './notifications.service';

function armar(miembros: any[]) {
  const db = {
    organizationMember: { findMany: vi.fn(async () => miembros) },
    notification: { create: vi.fn(async () => ({})) },
    whatsappSession: { findFirst: vi.fn(async () => ({ providerSessionId: 'sess-1' })) },
  } as any;
  const events = { publish: vi.fn() } as any;
  const openwa = { sendText: vi.fn(async () => ({ providerMessageId: 'wa-1' })) } as any;
  return { db, events, openwa, servicio: new NotificationsService(db, events, openwa) };
}

const miembro = (userId: string, extra: any = {}) => ({
  userId,
  notificationPrefs: null,
  user: { notificationPhone: null },
  ...extra,
});

const aviso = (extra: any = {}) => ({
  organizationId: 'org-1',
  userIds: ['u-ana'],
  kind: 'LEAD_NUEVO' as const,
  title: 'Alguien escribió',
  ...extra,
});

describe('a quién se avisa', () => {
  it('guarda el aviso y despierta la campana de la consola', async () => {
    const { servicio, db, events } = armar([miembro('u-ana')]);

    const resultado = await servicio.notify(aviso({ body: 'Hola, vi la casa' }));

    expect(resultado.avisados).toBe(1);
    expect(db.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        userId: 'u-ana',
        kind: 'LEAD_NUEVO',
        title: 'Alguien escribió',
        body: 'Hola, vi la casa',
      }),
    });
    expect(events.publish).toHaveBeenCalledWith('org-1', { type: 'notification.created' });
  });

  /** Avisarle a alguien de lo que acaba de hacer es ruido puro. */
  it('nunca se avisa a quien provocó el evento', async () => {
    const { servicio, db } = armar([miembro('u-ana')]);
    const resultado = await servicio.notify(aviso({ userIds: ['u-ana'], actorId: 'u-ana' }));

    expect(resultado.avisados).toBe(0);
    expect(db.organizationMember.findMany).not.toHaveBeenCalled();
  });

  it('el mismo destinatario repetido recibe un solo aviso', async () => {
    const { servicio, db } = armar([miembro('u-ana')]);
    await servicio.notify(aviso({ userIds: ['u-ana', 'u-ana', null, undefined] }));

    expect(db.organizationMember.findMany.mock.calls[0][0].where.userId.in).toEqual(['u-ana']);
    expect(db.notification.create).toHaveBeenCalledTimes(1);
  });

  it('quien ya no está activo en la agencia no recibe nada', async () => {
    const { servicio, db } = armar([]);
    await servicio.notify(aviso());

    expect(db.organizationMember.findMany.mock.calls[0][0].where.status).toBe('ACTIVE');
    expect(db.notification.create).not.toHaveBeenCalled();
  });

  it('sin destinatarios no se consulta nada', async () => {
    const { servicio, db, events } = armar([miembro('u-ana')]);
    await servicio.notify(aviso({ userIds: [null, undefined] }));

    expect(db.organizationMember.findMany).not.toHaveBeenCalled();
    expect(events.publish).not.toHaveBeenCalled();
  });
});

describe('el aviso por WhatsApp', () => {
  it('sale al número que la persona capturó', async () => {
    const { servicio, openwa } = armar([
      miembro('u-ana', { user: { notificationPhone: '+52 449 118 2244' } }),
    ]);

    await servicio.notify(aviso({ body: 'Preguntó por Villa Sur' }));

    expect(openwa.sendText).toHaveBeenCalledWith({
      providerSessionId: 'sess-1',
      chatId: '524491182244@c.us',
      text: '*Alguien escribió*\nPreguntó por Villa Sur',
    });
  });

  /**
   * Mandar avisos a un número que otra persona escribió acaba avisándole a un
   * desconocido, así que sin número capturado el canal simplemente no aplica.
   */
  it('sin número capturado no se manda nada, y el aviso en la consola sigue', async () => {
    const { servicio, openwa, db } = armar([miembro('u-ana')]);
    await servicio.notify(aviso());

    expect(openwa.sendText).not.toHaveBeenCalled();
    expect(db.notification.create).toHaveBeenCalled();
  });

  it('un número imposible se descarta en vez de mandarse', async () => {
    const { servicio, openwa } = armar([
      miembro('u-ana', { user: { notificationPhone: '449' } }),
    ]);
    await servicio.notify(aviso());
    expect(openwa.sendText).not.toHaveBeenCalled();
  });

  /**
   * El prospecto ya escribió y su mensaje ya está guardado: que falle el aviso
   * no puede tumbar lo que lo provocó.
   */
  it('si el envío falla, el aviso en la consola se conserva', async () => {
    const { servicio, openwa, db } = armar([
      miembro('u-ana', { user: { notificationPhone: '4491182244' } }),
    ]);
    openwa.sendText.mockRejectedValue(new Error('canal caído'));

    await expect(servicio.notify(aviso())).resolves.toEqual({ avisados: 1 });
    expect(db.notification.create).toHaveBeenCalled();
  });

  it('sin ningún canal conectado no se intenta enviar', async () => {
    const { servicio, db, openwa } = armar([
      miembro('u-ana', { user: { notificationPhone: '4491182244' } }),
    ]);
    db.whatsappSession.findFirst.mockResolvedValue(null);

    await servicio.notify(aviso());
    expect(openwa.sendText).not.toHaveBeenCalled();
  });
});

describe('las preferencias', () => {
  it('sin configurar, cada evento trae sus canales de omisión', () => {
    expect(canalesDe(null, 'LEAD_NUEVO')).toEqual(PREFS_POR_OMISION.LEAD_NUEVO);
    expect(canalesDe(undefined, 'VISITA_SOLICITADA')).toEqual(['APP']);
  });

  it('una preferencia vacía silencia ese evento por completo', async () => {
    const { servicio, db, openwa } = armar([
      miembro('u-ana', {
        notificationPrefs: { LEAD_NUEVO: [] },
        user: { notificationPhone: '4491182244' },
      }),
    ]);

    const resultado = await servicio.notify(aviso());

    expect(resultado.avisados).toBe(0);
    expect(db.notification.create).not.toHaveBeenCalled();
    expect(openwa.sendText).not.toHaveBeenCalled();
  });

  it('se puede dejar solo WhatsApp, sin registro en la consola', async () => {
    const { servicio, db, openwa } = armar([
      miembro('u-ana', {
        notificationPrefs: { LEAD_NUEVO: ['WHATSAPP'] },
        user: { notificationPhone: '4491182244' },
      }),
    ]);

    await servicio.notify(aviso());

    expect(db.notification.create).not.toHaveBeenCalled();
    expect(openwa.sendText).toHaveBeenCalled();
  });

  it('un canal inventado se ignora en vez de colarse', () => {
    expect(canalesDe({ LEAD_NUEVO: ['APP', 'TELEGRAMA', 42] }, 'LEAD_NUEVO')).toEqual(['APP']);
  });

  it('una preferencia con forma inesperada cae en la de omisión', () => {
    expect(canalesDe('texto', 'HANDOFF')).toEqual(PREFS_POR_OMISION.HANDOFF);
    expect(canalesDe({ HANDOFF: 'APP' }, 'HANDOFF')).toEqual(PREFS_POR_OMISION.HANDOFF);
  });
});
