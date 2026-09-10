import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AvailabilityService } from './availability.service';

/**
 * Prometer una hora que el asesor ya tiene ocupada le cuesta a la agencia una
 * disculpa y un cliente. Estas pruebas fijan la regla que lo impide: solo se
 * ofrece lo que se pudo verificar, y **no poder ver la agenda nunca equivale a
 * que esté libre**.
 */

/** Miércoles 9 de septiembre de 2026, 08:00 en Ciudad de México. */
const AHORA = new Date('2026-09-09T13:00:00Z');
const MANANA = new Date('2026-09-10T13:00:00Z');
const PASADO = new Date('2026-09-11T13:00:00Z');

function armar(conexion: any, ocupado: any[] = [], citas: any[] = []) {
  const db = {
    calendarConnection: { findFirst: vi.fn(async () => conexion) },
    appointment: { findMany: vi.fn(async () => citas) },
  } as any;
  const google = { freeBusy: vi.fn(async () => ocupado) } as any;
  return { db, google, servicio: new AvailabilityService(db, google) };
}

const CONEXION = { id: 'cal-1', calendarId: 'ana@agencia.mx' };

const pedir = (servicio: AvailabilityService) =>
  servicio.huecos({
    organizationId: 'org-1',
    userId: 'u-ana',
    desde: MANANA,
    hasta: PASADO,
    horario: null,
    timezone: 'America/Mexico_City',
  });

describe('huecos reales en la agenda', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
  });

  it('devuelve huecos alineados a la hora en punto', async () => {
    const { servicio } = armar(CONEXION);
    const huecos = await pedir(servicio);

    expect(huecos).not.toBeNull();
    expect(huecos!.length).toBeGreaterThan(0);
    for (const hueco of huecos!) {
      expect(hueco.inicio.getMinutes()).toBe(0);
    }
  });

  /**
   * La diferencia entre «no sé» y «está lleno» decide qué le dice el agente al
   * prospecto, así que son valores distintos y no una lista vacía compartida.
   */
  it('sin calendario vinculado devuelve nulo, no una lista vacía', async () => {
    const { servicio, google } = armar(null);
    await expect(pedir(servicio)).resolves.toBeNull();
    expect(google.freeBusy).not.toHaveBeenCalled();
  });

  it('si Google falla devuelve nulo: un error no es disponibilidad', async () => {
    const { servicio, google } = armar(CONEXION);
    google.freeBusy.mockRejectedValue(new Error('403 insufficientPermissions'));
    await expect(pedir(servicio)).resolves.toBeNull();
  });

  it('lo ocupado en Google no se ofrece', async () => {
    const inicio = new Date('2026-09-10T16:00:00Z'); // 10:00 en México
    const { servicio } = armar(CONEXION, [
      { inicio, fin: new Date(inicio.getTime() + 3600_000) },
    ]);

    const huecos = await pedir(servicio);
    expect(huecos!.some((h) => h.inicio.getTime() === inicio.getTime())).toBe(false);
  });

  /**
   * Entre crear una cita y que el barrido la lleve al calendario pasa un
   * minuto. En esa ventana, la agenda de Google todavía la da por libre.
   */
  it('las citas del propio CRM también ocupan, aunque no estén en Google', async () => {
    const inicio = new Date('2026-09-10T17:00:00Z');
    const { servicio } = armar(CONEXION, [], [
      { startsAt: inicio, endsAt: new Date(inicio.getTime() + 3600_000) },
    ]);

    const huecos = await pedir(servicio);
    expect(huecos!.some((h) => h.inicio.getTime() === inicio.getTime())).toBe(false);
  });

  it('cuenta como ocupadas las solicitudes, no solo las confirmadas', async () => {
    const { servicio, db } = armar(CONEXION);
    await pedir(servicio);

    const estados = db.appointment.findMany.mock.calls[0][0].where.status.in;
    expect(estados).toContain('REQUESTED');
    expect(estados).toContain('SCHEDULED');
    expect(estados).toContain('CONFIRMED');
  });

  it('no ofrece nada dentro del margen mínimo: nadie agenda para dentro de un rato', async () => {
    const { servicio } = armar(CONEXION);
    const huecos = await servicio.huecos({
      organizationId: 'org-1',
      userId: 'u-ana',
      desde: AHORA,
      hasta: new Date(AHORA.getTime() + 6 * 3600_000),
      horario: null,
      timezone: 'America/Mexico_City',
    });

    for (const hueco of huecos ?? []) {
      expect(hueco.inicio.getTime()).toBeGreaterThanOrEqual(AHORA.getTime() + 2 * 3600_000);
    }
  });

  describe('el horario', () => {
    it('sin configurar, no ofrece de madrugada ni en domingo', async () => {
      const { servicio } = armar(CONEXION);
      const huecos = await servicio.huecos({
        organizationId: 'org-1',
        userId: 'u-ana',
        desde: new Date('2026-09-12T06:00:00Z'),
        hasta: new Date('2026-09-14T06:00:00Z'),
        horario: null,
        timezone: 'America/Mexico_City',
      });

      for (const hueco of huecos ?? []) {
        const partes = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'America/Mexico_City',
          weekday: 'short',
          hour: '2-digit',
          hour12: false,
        }).formatToParts(hueco.inicio);
        const dia = partes.find((p) => p.type === 'weekday')!.value;
        const hora = Number(partes.find((p) => p.type === 'hour')!.value);

        expect(dia).not.toBe('Sun');
        expect(hora).toBeGreaterThanOrEqual(9);
        expect(hora).toBeLessThan(19);
      }
    });

    it('respeta el horario del agente cuando existe', async () => {
      const { servicio } = armar(CONEXION);
      const huecos = await servicio.huecos({
        organizationId: 'org-1',
        userId: 'u-ana',
        desde: MANANA,
        hasta: PASADO,
        horario: { thu: ['10:00', '13:00'] },
        timezone: 'America/Mexico_City',
      });

      for (const hueco of huecos ?? []) {
        const hora = Number(
          new Intl.DateTimeFormat('en-GB', {
            timeZone: 'America/Mexico_City',
            hour: '2-digit',
            hour12: false,
          }).format(hueco.inicio),
        );
        expect(hora).toBeGreaterThanOrEqual(10);
        expect(hora).toBeLessThan(13);
      }
    });
  });
});
