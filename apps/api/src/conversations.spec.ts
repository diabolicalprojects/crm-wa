import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationsController } from './conversations.controller';
import { effectivePermissions } from './permissions';
import type { AuthUser } from './auth';

/**
 * Resuelve permisos con la matriz real en vez de un conjunto inventado: así la
 * prueba se rompe si alguien cambia lo que trae un rol de fábrica, que es
 * justo el cambio que hay que notar.
 */
const permisosReales = {
  of: async (user: AuthUser) => effectivePermissions(user.role, null, user.isSuperAdmin),
} as any;

const OWNER: AuthUser = {
  id: 'u-owner', email: 'owner@test.com', name: 'Owner',
  isSuperAdmin: false, role: 'OWNER', organizationId: 'org-1',
};
const SUPERVISOR: AuthUser = { ...OWNER, id: 'u-sup', role: 'SUPERVISOR' };
const ADMIN: AuthUser = { ...OWNER, id: 'u-adm', role: 'ADMIN' };
const ADVISOR: AuthUser = { ...OWNER, id: 'u-adv', role: 'ADVISOR' };

describe('filtro de canal en la bandeja', () => {
  let db: any;
  let controller: ConversationsController;

  beforeEach(() => {
    db = { conversation: { findMany: vi.fn().mockResolvedValue([]) } };
    controller = new ConversationsController(db, {} as any, permisosReales);
  });

  const where = () => db.conversation.findMany.mock.calls[0][0].where;

  it('propietario, administrador y supervisor pueden acotar por canal', async () => {
    for (const user of [OWNER, ADMIN, SUPERVISOR]) {
      db.conversation.findMany.mockClear();
      await controller.list(user, 'org-1', { sessionId: 'sess-2' } as any);
      expect(where()).toMatchObject({ organizationId: 'org-1', sessionId: 'sess-2' });
      // Sin restricción por rol: ven toda la agencia.
      expect(where().OR).toBeUndefined();
    }
  });

  it('sin canal elegido devuelve todos los de la agencia', async () => {
    await controller.list(OWNER, 'org-1', {} as any);
    expect(where().sessionId).toBeUndefined();
  });

  /**
   * Lo que realmente importa: el filtro es una comodidad de lectura, no una
   * vía para ampliar lo que alguien ve. Un asesor que pida el canal de otro
   * sigue acotado a lo suyo, porque el alcance por rol se aplica igual.
   */
  /**
   * Un asesor con el permiso concedido a mano sí ve toda la agencia, sin
   * cambiarle el rol. Es la razón de existir de la matriz.
   */
  it('un asesor con el permiso concedido ve toda la agencia', async () => {
    const conPermiso = {
      of: async () => effectivePermissions('ADVISOR', { grant: ['conversaciones.verTodas'] }),
    } as any;
    const suyo = new ConversationsController(db, {} as any, conPermiso);

    await suyo.list(ADVISOR, 'org-1', {} as any);

    expect(where().OR).toBeUndefined();
  });

  /** Y a un supervisor se le puede quitar sin degradarlo. */
  it('un supervisor con el permiso retirado queda acotado a lo suyo', async () => {
    const sinPermiso = {
      of: async () => effectivePermissions('SUPERVISOR', { revoke: ['conversaciones.verTodas'] }),
    } as any;
    const suyo = new ConversationsController(db, {} as any, sinPermiso);

    await suyo.list(SUPERVISOR, 'org-1', {} as any);

    expect(where().OR).toEqual([
      { assignedUserId: 'u-sup' },
      { agent: { responsibleUserId: 'u-sup' } },
    ]);
  });

  it('un asesor no ve más aunque pida el canal de otro agente', async () => {
    await controller.list(ADVISOR, 'org-1', { sessionId: 'canal-ajeno' } as any);

    const filtro = where();
    expect(filtro.sessionId).toBe('canal-ajeno');
    // El acotamiento por rol sigue presente y manda.
    expect(filtro.OR).toEqual([
      { assignedUserId: 'u-adv' },
      { agent: { responsibleUserId: 'u-adv' } },
    ]);
  });

  it('el asesor conserva su alcance también sin filtro', async () => {
    await controller.list(ADVISOR, 'org-1', {} as any);
    expect(where().OR).toHaveLength(2);
  });

  it('el canal se combina con el estado sin perder ninguno', async () => {
    await controller.list(SUPERVISOR, 'org-1', { sessionId: 'sess-1', status: 'OPEN' } as any);
    expect(where()).toMatchObject({ sessionId: 'sess-1', status: 'OPEN', organizationId: 'org-1' });
  });

  it('trae el canal y el agente de cada conversación para poder distinguirlas', async () => {
    await controller.list(OWNER, 'org-1', {} as any);
    const include = db.conversation.findMany.mock.calls[0][0].include;
    expect(include.session.select).toMatchObject({ name: true, phoneNumber: true });
    expect(include.agent.select).toMatchObject({ name: true });
  });
});
