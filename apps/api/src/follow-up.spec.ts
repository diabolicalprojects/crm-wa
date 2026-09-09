import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FollowUpService,
  enSilencio,
  horaLocal,
  pidioNoSerContactado,
} from './follow-up.service';

/** Miércoles 9 de septiembre de 2026, 15:00 en Ciudad de México. */
const AHORA = new Date('2026-09-09T20:00:00Z');
const HACE_TRES_DIAS = new Date(AHORA.getTime() - 72 * 3600_000);

function conversacion(extra: any = {}) {
  return {
    id: 'conv-1',
    followUpCount: 0,
    lastFollowUpAt: null,
    lastOutboundAt: HACE_TRES_DIAS,
    lastInboundAt: new Date(HACE_TRES_DIAS.getTime() - 60_000),
    agent: { id: 'ag-1', name: 'Andrea', followUpDelayHours: 48, followUpMaxAttempts: 2 },
    organization: { timezone: 'America/Mexico_City' },
    lead: { stage: 'QUALIFYING' },
    ...extra,
  };
}

function armar(candidatas: any[]) {
  const db = {
    conversation: { findMany: vi.fn(async () => candidatas), update: vi.fn(async () => ({})) },
  } as any;
  const automation = { enqueue: vi.fn(async () => ({})) } as any;
  return { db, automation, servicio: new FollowUpService(db, automation) };
}

describe('cuándo se manda un seguimiento', () => {
  it('encola cuando pasó el tiempo y el prospecto sigue callado', async () => {
    const { servicio, automation, db } = armar([conversacion()]);

    const resultado = await servicio.sweep(AHORA);

    expect(resultado.encolados).toBe(1);
    expect(automation.enqueue).toHaveBeenCalledWith('conv-1', { followUp: true });
    // Se marca el intento antes de encolar: si el trabajo falla se pierde ese
    // intento, que es preferible a repetirlo en cada barrido.
    expect(db.conversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { followUpCount: { increment: 1 }, lastFollowUpAt: AHORA },
    });
  });

  it('no insiste antes de tiempo', async () => {
    const reciente = new Date(AHORA.getTime() - 10 * 3600_000);
    const { servicio, automation } = armar([conversacion({ lastOutboundAt: reciente })]);
    await servicio.sweep(AHORA);
    expect(automation.enqueue).not.toHaveBeenCalled();
  });

  /**
   * El primer seguimiento también es un `lastOutboundAt`. Contando desde ahí,
   * el segundo intento saldría inmediatamente después del primero.
   */
  it('el reloj del segundo intento corre desde el primero, no desde el último mensaje', async () => {
    const { servicio, automation } = armar([
      conversacion({
        followUpCount: 1,
        lastOutboundAt: HACE_TRES_DIAS,
        lastFollowUpAt: new Date(AHORA.getTime() - 3 * 3600_000),
      }),
    ]);
    await servicio.sweep(AHORA);
    expect(automation.enqueue).not.toHaveBeenCalled();
  });

  it('respeta el tope de intentos', async () => {
    const { servicio, automation } = armar([conversacion({ followUpCount: 2 })]);
    await servicio.sweep(AHORA);
    expect(automation.enqueue).not.toHaveBeenCalled();
  });

  it('no persigue a quien ya contestó', async () => {
    const { servicio, automation } = armar([
      conversacion({ lastInboundAt: new Date(AHORA.getTime() - 3600_000) }),
    ]);
    await servicio.sweep(AHORA);
    expect(automation.enqueue).not.toHaveBeenCalled();
  });

  it('no persigue a un prospecto ganado ni a uno perdido', async () => {
    for (const stage of ['WON', 'LOST']) {
      const { servicio, automation } = armar([conversacion({ lead: { stage } })]);
      await servicio.sweep(AHORA);
      expect(automation.enqueue).not.toHaveBeenCalled();
    }
  });

  /**
   * Tope duro por encima del horario del agente: un agente sin horario opera
   * 24/7, y un mensaje automático a las 3 de la mañana es lo que hace que
   * alguien reporte el número.
   */
  it('nunca escribe de madrugada', async () => {
    const { servicio, automation } = armar([conversacion()]);
    // 03:00 en Ciudad de México.
    await servicio.sweep(new Date('2026-09-10T08:00:00Z'));
    expect(automation.enqueue).not.toHaveBeenCalled();
  });

  it('el filtro de la base excluye control humano, bajas y agentes apagados', async () => {
    const { servicio, db } = armar([]);
    await servicio.sweep(AHORA);

    const where = db.conversation.findMany.mock.calls[0][0].where;
    expect(where.mode).toBe('AI_ACTIVE');
    expect(where.status).toBe('OPEN');
    expect(where.followUpOptOut).toBe(false);
    expect(where.agent).toMatchObject({ followUpEnabled: true, status: 'ACTIVE', aiEnabled: true });
  });

  it('no corren dos barridos a la vez', async () => {
    const { servicio, db } = armar([]);
    let resolver: (v: any) => void = () => {};
    db.conversation.findMany.mockReturnValue(new Promise((r) => { resolver = r; }));

    const primero = servicio.sweep(AHORA);
    expect((await servicio.sweep(AHORA)).omitido).toBe(true);
    resolver([]);
    await primero;
  });
});

describe('la baja voluntaria', () => {
  it('reconoce las formas inequívocas de pedir que no le escriban', () => {
    for (const frase of [
      'Por favor no me escriban más',
      'ya no me manden mensajes',
      'Dejen de escribirme',
      'quítenme de su lista',
      'STOP',
      'baja',
      'no me vuelvan a escribir',
    ]) {
      expect(pidioNoSerContactado(frase), frase).toBe(true);
    }
  });

  /**
   * Marcar de más deja al prospecto sin atención automática para siempre. Ante
   * la duda no se marca: un «ahorita no puedo» no es una baja.
   */
  it('no confunde una negativa pasajera con una baja', () => {
    for (const frase of [
      'ahorita no puedo, te escribo luego',
      'no me interesa esa casa, ¿tienes otra?',
      'no puedo el sábado',
      'ya no está disponible?',
      'no',
      '',
    ]) {
      expect(pidioNoSerContactado(frase), frase).toBe(false);
    }
  });

  it('funciona sin acentos, que es como se escribe en WhatsApp', () => {
    expect(pidioNoSerContactado('quitenme de su lista')).toBe(true);
    expect(pidioNoSerContactado('QUÍTENME DE SU LISTA')).toBe(true);
  });
});

describe('la franja de silencio', () => {
  it('cruza la medianoche como una sola franja', () => {
    expect(enSilencio(22)).toBe(true);
    expect(enSilencio(3)).toBe(true);
    expect(enSilencio(8)).toBe(true);
    expect(enSilencio(9)).toBe(false);
    expect(enSilencio(15)).toBe(false);
    expect(enSilencio(20)).toBe(false);
  });

  it('la hora se lee en la zona de la agencia, no en la del servidor', () => {
    const utc = new Date('2026-09-10T02:00:00Z');
    expect(horaLocal('America/Mexico_City', utc)).toBe(20);
    expect(horaLocal('UTC', utc)).toBe(2);
  });
});
