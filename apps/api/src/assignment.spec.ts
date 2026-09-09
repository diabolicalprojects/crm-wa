import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssignmentService } from './assignment.service';

const MIEMBROS = [
  { userId: 'u-owner', role: 'OWNER', createdAt: new Date('2026-01-01') },
  { userId: 'u-sup', role: 'SUPERVISOR', createdAt: new Date('2026-01-02') },
  { userId: 'u-ana', role: 'ADVISOR', createdAt: new Date('2026-01-03') },
  { userId: 'u-beto', role: 'ADVISOR', createdAt: new Date('2026-01-04') },
];

function makeDb(org: any, miembros = MIEMBROS) {
  return {
    organization: {
      findUnique: vi.fn(async () => ({
        stickyAdvisor: true,
        dutySchedule: null,
        lastAssignedUserId: null,
        timezone: 'America/Mexico_City',
        ...org,
      })),
      update: vi.fn(async () => ({})),
    },
    organizationMember: { findMany: vi.fn(async () => miembros) },
    lead: { update: vi.fn() },
  } as any;
}

describe('a quién le toca un prospecto nuevo', () => {
  describe('la regla del asesor pegajoso manda sobre todo', () => {
    /**
     * Sin esto, un prospecto ya atendido que vuelve preguntando por otro
     * inmueble le cae a otro asesor. Es una regla de comisión disfrazada de
     * software, y es lo que decide si la agencia adopta el CRM o lo esquiva.
     */
    it('un prospecto que vuelve se queda con quien lo atendió', async () => {
      const db = makeDb({ assignmentMode: 'ROUND_ROBIN' });
      const servicio = new AssignmentService(db);

      const elegido = await servicio.resolve({
        organizationId: 'org-1',
        currentUserId: 'u-ana',
        channelUserId: 'u-beto',
      });

      expect(elegido).toBe('u-ana');
      // Y no se gasta un turno del carrusel en alguien que ya tenía dueño.
      expect(db.organization.update).not.toHaveBeenCalled();
    });

    it('apagada, el modo vuelve a mandar', async () => {
      const db = makeDb({ assignmentMode: 'CHANNEL_RESPONSIBLE', stickyAdvisor: false });
      const elegido = await new AssignmentService(db).resolve({
        organizationId: 'org-1',
        currentUserId: 'u-ana',
        channelUserId: 'u-beto',
      });
      expect(elegido).toBe('u-beto');
    });

    it('no se pega a alguien que ya no está en la agencia', async () => {
      const db = makeDb({ assignmentMode: 'CHANNEL_RESPONSIBLE' });
      const elegido = await new AssignmentService(db).resolve({
        organizationId: 'org-1',
        currentUserId: 'u-quien-se-fue',
        channelUserId: 'u-beto',
      });
      expect(elegido).toBe('u-beto');
    });
  });

  describe('carrusel', () => {
    it('avanza al siguiente y recuerda a quién le tocó', async () => {
      const db = makeDb({ assignmentMode: 'ROUND_ROBIN', lastAssignedUserId: 'u-ana' });
      const elegido = await new AssignmentService(db).resolve({ organizationId: 'org-1' });

      expect(elegido).toBe('u-beto');
      expect(db.organization.update).toHaveBeenCalledWith({
        where: { id: 'org-1' },
        data: { lastAssignedUserId: 'u-beto' },
      });
    });

    it('da la vuelta al llegar al final', async () => {
      const db = makeDb({ assignmentMode: 'ROUND_ROBIN', lastAssignedUserId: 'u-beto' });
      expect(await new AssignmentService(db).resolve({ organizationId: 'org-1' })).toBe('u-sup');
    });

    /** El propietario y los administradores suelen no atender. */
    it('reparte solo entre asesores y supervisores', async () => {
      const db = makeDb({ assignmentMode: 'ROUND_ROBIN', lastAssignedUserId: null });
      expect(await new AssignmentService(db).resolve({ organizationId: 'org-1' })).toBe('u-sup');
    });

    it('si el último asignado ya no está, empieza de nuevo sin atascarse', async () => {
      const db = makeDb({ assignmentMode: 'ROUND_ROBIN', lastAssignedUserId: 'u-fantasma' });
      expect(await new AssignmentService(db).resolve({ organizationId: 'org-1' })).toBe('u-sup');
    });
  });

  describe('guardia', () => {
    const turno = [{ userId: 'u-ana', days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' }];

    it('asigna a quien está de turno a esa hora', async () => {
      const db = makeDb({ assignmentMode: 'ON_DUTY', dutySchedule: turno });
      // Miércoles 10 de septiembre de 2026, 15:00 en Ciudad de México.
      const elegido = await new AssignmentService(db).resolve({
        organizationId: 'org-1',
        now: new Date('2026-09-09T20:00:00Z'),
      });
      expect(elegido).toBe('u-ana');
    });

    it('fuera del turno cae al respaldo, nunca a nadie', async () => {
      const db = makeDb({ assignmentMode: 'ON_DUTY', dutySchedule: turno });
      const elegido = await new AssignmentService(db).resolve({
        organizationId: 'org-1',
        channelUserId: 'u-beto',
        now: new Date('2026-09-10T08:00:00Z'), // 02:00 en México
      });
      expect(elegido).toBe('u-beto');
    });

    /**
     * El turno de noche es justo el que cubre los mensajes que motivan todo
     * esto, y es el que se parte en dos si se compara ingenuamente.
     */
    it('un turno que cruza la medianoche cuenta como uno solo', () => {
      const servicio = new AssignmentService(makeDb({}));
      const noche = [{ userId: 'u-nocturno', days: [3], from: '22:00', to: '06:00' }];

      // Miércoles 23:30 en México: dentro, por el lado del día que empieza.
      expect(servicio.onDuty(noche, 'America/Mexico_City', new Date('2026-09-10T04:30:00Z')))
        .toBe('u-nocturno');
      // Jueves 02:00: sigue siendo el turno del miércoles.
      expect(servicio.onDuty(noche, 'America/Mexico_City', new Date('2026-09-10T07:00:00Z')))
        .toBe('u-nocturno');
      // Miércoles 21:00: todavía no empieza.
      expect(servicio.onDuty(noche, 'America/Mexico_City', new Date('2026-09-10T02:00:00Z')))
        .toBeUndefined();
    });

    it('un horario con forma inesperada se ignora, no rompe la asignación', async () => {
      const db = makeDb({
        assignmentMode: 'ON_DUTY',
        dutySchedule: [{ nada: true }, 'texto', { userId: 'u-ana', from: 'no es hora', to: 'ni esto' }],
      });
      const elegido = await new AssignmentService(db).resolve({
        organizationId: 'org-1',
        channelUserId: 'u-beto',
      });
      expect(elegido).toBe('u-beto');
    });
  });

  describe('respaldo', () => {
    it('sin responsable del canal, va al propietario', async () => {
      const db = makeDb({ assignmentMode: 'CHANNEL_RESPONSIBLE' });
      expect(await new AssignmentService(db).resolve({ organizationId: 'org-1' })).toBe('u-owner');
    });

    it('modo OWNER siempre al propietario', async () => {
      const db = makeDb({ assignmentMode: 'OWNER' });
      const elegido = await new AssignmentService(db).resolve({
        organizationId: 'org-1',
        channelUserId: 'u-beto',
      });
      expect(elegido).toBe('u-owner');
    });

    it('sin miembros activos no se inventa un dueño', async () => {
      const db = makeDb({ assignmentMode: 'ROUND_ROBIN' }, []);
      expect(await new AssignmentService(db).resolve({ organizationId: 'org-1' })).toBeUndefined();
    });
  });
});
