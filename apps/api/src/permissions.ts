import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Put,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { CurrentUser, type AuthUser } from './auth';
import { PrismaService } from './prisma.service';
import { TenantId } from './tenant';

class OverridesDto {
  @IsOptional() @IsArray() @IsString({ each: true }) grant?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) revoke?: string[];
}

/**
 * Permisos por miembro, encima de los cuatro roles (§7.3, montón A5).
 *
 * El rol sigue siendo el punto de partida —nadie configura veinte casillas por
 * persona— y el permiso es la excepción: un supervisor al que se le quita
 * reasignar, un asesor al que se le da ver toda la agencia.
 *
 * **El catálogo solo lista permisos que de verdad se verifican en un endpoint.**
 * Un permiso que no bloquea nada es peor que no tenerlo: le promete al dueño un
 * control que no existe. Por eso no están aquí «editar propiedades de otros» ni
 * «descargar el inventario»: la propiedad todavía no tiene dueño y no hay
 * exportación que gatear. Entran cuando exista lo que gatean.
 */

export const PERMISSIONS = {
  'conversaciones.verTodas': 'Ver las conversaciones de toda la agencia',
  'conversaciones.reasignar': 'Reasignar una conversación a otro asesor',
  'prospectos.verTodos': 'Ver los prospectos de toda la agencia',
  'prospectos.editarDeOtros': 'Editar prospectos asignados a otra persona',
  'inventario.administrar': 'Crear, editar y borrar propiedades',
  'inventario.editarDeOtros': 'Editar propiedades a cargo de otra persona',
  'inventario.verPropietarios': 'Ver el dueño de un inmueble y sus datos',
  'inventario.exportar': 'Descargar el inventario en un archivo',
  'inventario.importar': 'Importar inventario desde CSV o Excel',
  'contactos.administrar': 'Ver y editar la libreta de contactos',
  'agentes.administrar': 'Crear y configurar agentes de IA',
  'canales.administrar': 'Conectar y desconectar números de WhatsApp',
  'equipo.administrar': 'Dar de alta, editar y quitar personas',
  'asignacion.administrar': 'Cambiar las reglas de reparto de prospectos',
  'auditoria.ver': 'Consultar la bitácora de acciones sensibles',
  'ia.verEjecuciones': 'Ver qué consultó la IA en cada conversación',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/**
 * Lo que trae cada rol de fábrica. Es el 95% de los casos: la matriz por
 * persona existe para el 5% restante, no para que alguien la llene entera.
 */
export const ROLE_DEFAULTS: Record<string, Permission[]> = {
  OWNER: ALL_PERMISSIONS,
  // Hoy el administrador tiene lo mismo que el propietario. La diferencia entre
  // los dos no está en los permisos sino en lo que solo el dueño puede hacer
  // estructuralmente —existir sin que nadie lo quite—, y crecerá cuando haya
  // facturación. Igualarlos aquí es más honesto que inventar una diferencia.
  ADMIN: ALL_PERMISSIONS,
  SUPERVISOR: [
    'conversaciones.verTodas',
    'conversaciones.reasignar',
    'prospectos.verTodos',
    'prospectos.editarDeOtros',
    'inventario.administrar',
    'inventario.editarDeOtros',
    'inventario.importar',
    'contactos.administrar',
    'ia.verEjecuciones',
  ],
  /**
   * Un asesor no trae nada de fábrica, y en particular **no** trae
   * `inventario.verPropietarios` ni `inventario.exportar`: son los dos que
   * responden a «el asesor que se va y se lleva la cartera». Concederlos es una
   * decisión consciente de la agencia, persona por persona.
   */
  ADVISOR: [],
};

export interface MemberOverrides {
  /** Permisos que este miembro tiene aunque su rol no los traiga. */
  grant?: string[];
  /** Permisos que su rol trae pero a esta persona se le quitan. */
  revoke?: string[];
}

/**
 * El conjunto efectivo. La resta va después de la suma a propósito: si alguien
 * aparece en las dos listas, gana el retiro. Quitar un permiso debe ser algo
 * que no se pueda deshacer por accidente con un alta en la otra lista.
 */
export function effectivePermissions(
  role: string | undefined,
  overrides: MemberOverrides | null | undefined,
  isSuperAdmin = false,
): Set<Permission> {
  if (isSuperAdmin) return new Set(ALL_PERMISSIONS);

  const base = new Set<Permission>(ROLE_DEFAULTS[role ?? ''] ?? []);
  for (const p of overrides?.grant ?? []) {
    if (isPermission(p)) base.add(p);
  }
  for (const p of overrides?.revoke ?? []) {
    if (isPermission(p)) base.delete(p);
  }
  return base;
}

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && value in PERMISSIONS;
}

/** Normaliza lo que viene de la base, que es JSON libre. */
export function parseOverrides(value: unknown): MemberOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter(isPermission) : []);
  return { grant: lista(raw.grant), revoke: lista(raw.revoke) };
}

export const RequirePermission = (permission: Permission) =>
  SetMetadata('permission', permission);

/**
 * Verifica el permiso contra la base, no contra el token.
 *
 * Meterlo en el JWT sería gratis por petición, pero un permiso retirado
 * seguiría valiendo hasta que la sesión caducara —doce horas—, y el caso de uso
 * de esto es precisamente quitarle acceso a alguien hoy. Solo pagan la consulta
 * los endpoints que declaran un permiso; el resto no toca la base.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private db: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext) {
    const permiso = this.reflector.getAllAndOverride<Permission>('permission', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!permiso) return true;

    const user = ctx.switchToHttp().getRequest().user as AuthUser;
    if (user?.isSuperAdmin) return true;
    if (!user?.organizationId) throw new ForbiddenException('Sin agencia activa');

    const miembro = await this.db.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: user.organizationId, userId: user.id },
      },
      select: { role: true, status: true, permissions: true },
    });
    if (!miembro || miembro.status !== 'ACTIVE') {
      throw new ForbiddenException('Tu acceso a esta agencia no está activo');
    }

    const efectivos = effectivePermissions(miembro.role, parseOverrides(miembro.permissions));
    if (!efectivos.has(permiso)) {
      // El mensaje nombra el permiso: «No tienes permiso» obliga a adivinar qué
      // pedirle al administrador.
      throw new ForbiddenException(`Te falta el permiso: ${PERMISSIONS[permiso]}`);
    }
    return true;
  }
}

/**
 * Resuelve permisos fuera de un guardia, para los controladores que no
 * *bloquean* por permiso sino que *acotan* por él: la bandeja no le niega el
 * acceso a un asesor, le enseña menos.
 */
@Injectable()
export class PermissionsService {
  constructor(private db: PrismaService) {}

  async of(user: AuthUser): Promise<Set<Permission>> {
    if (user.isSuperAdmin) return new Set(ALL_PERMISSIONS);
    if (!user.organizationId || !user.id) return new Set();

    const miembro = await this.db.organizationMember.findUnique({
      where: {
        organizationId_userId: { organizationId: user.organizationId, userId: user.id },
      },
      select: { role: true, status: true, permissions: true },
    });
    if (!miembro || miembro.status !== 'ACTIVE') return new Set();
    return effectivePermissions(miembro.role, parseOverrides(miembro.permissions));
  }
}

/**
 * Consulta y edición de la matriz.
 *
 * `GET /permissions` sirve para dos cosas distintas: que la consola sepa qué
 * esconder, y que un administrador vea qué tiene cada quien. Esconder un botón
 * nunca es autorización —eso lo hace el guardia— pero enseñar botones que
 * fallan al pulsarlos es una interfaz que miente.
 */
@Controller('permissions')
export class PermissionsController {
  constructor(
    private db: PrismaService,
    private permisos: PermissionsService,
  ) {}

  @Get()
  async mine(@CurrentUser() user: AuthUser) {
    return {
      catalogo: PERMISSIONS,
      mios: [...(await this.permisos.of(user))],
      porRol: ROLE_DEFAULTS,
    };
  }

  @Get('equipo')
  @RequirePermission('equipo.administrar')
  async team(@TenantId() organizationId: string) {
    const miembros = await this.db.organizationMember.findMany({
      where: { organizationId },
      select: {
        userId: true,
        role: true,
        status: true,
        permissions: true,
        user: { select: { name: true, email: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return miembros.map((m) => {
      const overrides = parseOverrides(m.permissions);
      return {
        userId: m.userId,
        role: m.role,
        status: m.status,
        name: m.user.name,
        email: m.user.email,
        grant: overrides.grant ?? [],
        revoke: overrides.revoke ?? [],
        efectivos: [...effectivePermissions(m.role, overrides)],
      };
    });
  }

  @Put('equipo/:userId')
  @RequirePermission('equipo.administrar')
  async save(
    @CurrentUser() actor: AuthUser,
    @TenantId() organizationId: string,
    @Param('userId') userId: string,
    @Body() dto: OverridesDto,
  ) {
    const miembro = await this.db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });
    if (!miembro) throw new NotFoundException('Esa persona no pertenece a esta agencia');

    // El propietario no se puede recortar. Es la única cuenta que garantiza que
    // la agencia sigue siendo administrable: sin esta regla, un administrador
    // puede dejar a todos —incluido el dueño— sin poder administrar el equipo,
    // y nadie puede deshacerlo desde la consola.
    if (miembro.role === 'OWNER' && dto.revoke?.length) {
      throw new BadRequestException('Al propietario no se le pueden quitar permisos');
    }

    const [actualizado] = await this.db.$transaction([
      this.db.organizationMember.update({
        where: { organizationId_userId: { organizationId, userId } },
        data: {
          permissions: {
            grant: (dto.grant ?? []).filter(isPermission),
            revoke: (dto.revoke ?? []).filter(isPermission),
          },
        },
        select: { permissions: true, role: true },
      }),
      this.db.auditLog.create({
        data: {
          organizationId,
          userId: actor.id,
          action: 'MEMBER_PERMISSIONS_UPDATED',
          entityType: 'User',
          entityId: userId,
        },
      }),
    ]);

    const overrides = parseOverrides(actualizado.permissions);
    return { ...overrides, efectivos: [...effectivePermissions(actualizado.role, overrides)] };
  }
}
