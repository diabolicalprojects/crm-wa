import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  PermissionsGuard,
  PermissionsService,
  ROLE_DEFAULTS,
  effectivePermissions,
  parseOverrides,
} from './permissions';

function contexto(user: any) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

const reflector = (permiso?: string) => ({ getAllAndOverride: () => permiso }) as any;

describe('el conjunto efectivo de permisos', () => {
  it('un rol trae lo suyo de fábrica', () => {
    expect(effectivePermissions('ADVISOR', null).size).toBe(0);
    expect(effectivePermissions('SUPERVISOR', null).has('conversaciones.verTodas')).toBe(true);
    expect(effectivePermissions('SUPERVISOR', null).has('equipo.administrar')).toBe(false);
    expect(effectivePermissions('OWNER', null).size).toBe(ALL_PERMISSIONS.length);
  });

  it('el superadministrador los tiene todos sin pertenecer a una agencia', () => {
    expect(effectivePermissions(undefined, null, true).size).toBe(ALL_PERMISSIONS.length);
  });

  it('una concesión suma sin cambiar el rol', () => {
    const permisos = effectivePermissions('ADVISOR', { grant: ['conversaciones.verTodas'] });
    expect(permisos.has('conversaciones.verTodas')).toBe(true);
    expect(permisos.has('equipo.administrar')).toBe(false);
  });

  it('un retiro resta sin degradar el rol', () => {
    const permisos = effectivePermissions('SUPERVISOR', { revoke: ['conversaciones.verTodas'] });
    expect(permisos.has('conversaciones.verTodas')).toBe(false);
    expect(permisos.has('prospectos.verTodos')).toBe(true);
  });

  /**
   * Quitar un permiso no debe poder deshacerse por accidente con un alta en la
   * otra lista: si alguien aparece en las dos, gana el retiro.
   */
  it('el retiro gana sobre la concesión', () => {
    const permisos = effectivePermissions('ADVISOR', {
      grant: ['conversaciones.verTodas'],
      revoke: ['conversaciones.verTodas'],
    });
    expect(permisos.has('conversaciones.verTodas')).toBe(false);
  });

  it('un permiso inventado se ignora en vez de colarse', () => {
    const permisos = effectivePermissions('ADVISOR', { grant: ['borrar.todo', 'admin'] as any });
    expect(permisos.size).toBe(0);
  });

  it('un rol desconocido no hereda nada', () => {
    expect(effectivePermissions('INVENTADO', null).size).toBe(0);
  });

  it('el JSON de la base se normaliza aunque venga con cualquier forma', () => {
    expect(parseOverrides(null)).toEqual({});
    expect(parseOverrides(undefined)).toEqual({});
    expect(parseOverrides('texto')).toEqual({});
    expect(parseOverrides([1, 2])).toEqual({});
    expect(parseOverrides({ grant: 'no es lista' })).toEqual({ grant: [], revoke: [] });
    expect(parseOverrides({ grant: ['auditoria.ver', 'basura'] })).toEqual({
      grant: ['auditoria.ver'],
      revoke: [],
    });
  });
});

describe('el catálogo', () => {
  /**
   * Un permiso que no bloquea nada le promete al dueño un control que no
   * existe. Si aparece uno nuevo aquí, tiene que estar exigido en algún
   * endpoint.
   */
  it('todo permiso del catálogo se exige en al menos un endpoint', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = `${process.cwd()}/apps/api/src`;
    const fuentes = readdirSync(dir)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts') && f !== 'permissions.ts')
      .map((f) => readFileSync(`${dir}/${f}`, 'utf8'))
      .join('\n');

    const sinUsar = ALL_PERMISSIONS.filter((p) => !fuentes.includes(`'${p}'`));
    expect(sinUsar).toEqual([]);
  });

  it('cada permiso tiene una descripción que una persona entiende', () => {
    for (const p of ALL_PERMISSIONS) {
      expect(PERMISSIONS[p].length).toBeGreaterThan(10);
      expect(PERMISSIONS[p]).not.toMatch(/[._]/);
    }
  });

  it('ningún rol declara un permiso que no existe', () => {
    for (const [rol, lista] of Object.entries(ROLE_DEFAULTS)) {
      for (const p of lista) expect(ALL_PERMISSIONS, rol).toContain(p);
    }
  });
});

describe('el guardia', () => {
  const db = (miembro: any) =>
    ({ organizationMember: { findUnique: vi.fn(async () => miembro) } }) as any;

  it('deja pasar cuando el endpoint no exige permiso, sin tocar la base', async () => {
    const base = db(null);
    const guardia = new PermissionsGuard(reflector(undefined), base);
    await expect(guardia.canActivate(contexto({ id: 'u1' }))).resolves.toBe(true);
    expect(base.organizationMember.findUnique).not.toHaveBeenCalled();
  });

  it('el superadministrador pasa siempre', async () => {
    const guardia = new PermissionsGuard(reflector('equipo.administrar'), db(null));
    await expect(guardia.canActivate(contexto({ isSuperAdmin: true }))).resolves.toBe(true);
  });

  it('deja pasar a quien tiene el permiso por su rol', async () => {
    const guardia = new PermissionsGuard(
      reflector('equipo.administrar'),
      db({ role: 'OWNER', status: 'ACTIVE', permissions: null }),
    );
    await expect(
      guardia.canActivate(contexto({ id: 'u1', organizationId: 'org-1' })),
    ).resolves.toBe(true);
  });

  it('bloquea a quien no lo tiene, y el mensaje dice cuál falta', async () => {
    const guardia = new PermissionsGuard(
      reflector('equipo.administrar'),
      db({ role: 'ADVISOR', status: 'ACTIVE', permissions: null }),
    );
    await expect(
      guardia.canActivate(contexto({ id: 'u1', organizationId: 'org-1' })),
    ).rejects.toThrow(/Dar de alta/);
  });

  /**
   * Verificar contra la base y no contra el token es lo que hace que retirar un
   * permiso surta efecto hoy y no en doce horas, cuando caduque la sesión.
   */
  it('un permiso retirado bloquea aunque el token siga diciendo lo contrario', async () => {
    const guardia = new PermissionsGuard(
      reflector('conversaciones.reasignar'),
      db({ role: 'SUPERVISOR', status: 'ACTIVE', permissions: { revoke: ['conversaciones.reasignar'] } }),
    );
    await expect(
      guardia.canActivate(contexto({ id: 'u1', organizationId: 'org-1', role: 'SUPERVISOR' })),
    ).rejects.toThrow(ForbiddenException);
  });

  it('un miembro desactivado no pasa aunque su rol alcance', async () => {
    const guardia = new PermissionsGuard(
      reflector('equipo.administrar'),
      db({ role: 'OWNER', status: 'DISABLED', permissions: null }),
    );
    await expect(
      guardia.canActivate(contexto({ id: 'u1', organizationId: 'org-1' })),
    ).rejects.toThrow(/no está activo/);
  });

  it('sin agencia activa no se resuelve nada', async () => {
    const guardia = new PermissionsGuard(reflector('equipo.administrar'), db(null));
    await expect(guardia.canActivate(contexto({ id: 'u1' }))).rejects.toThrow(/Sin agencia/);
  });
});

describe('resolver permisos fuera del guardia', () => {
  it('quien no pertenece a la agencia no tiene ninguno', async () => {
    const servicio = new PermissionsService({
      organizationMember: { findUnique: vi.fn(async () => null) },
    } as any);
    const permisos = await servicio.of({ id: 'u1', organizationId: 'org-1' } as any);
    expect(permisos.size).toBe(0);
  });
});
