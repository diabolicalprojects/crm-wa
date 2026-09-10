import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { LegalStatus, OperationType, PropertyStatus, PropertyType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';
import { AuthUser, CurrentUser, Roles } from './auth';
import { PermissionsService, RequirePermission } from './permissions';
import { PrismaService } from './prisma.service';
import { TenantId } from './tenant';

/**
 * Los DTO son la defensa contra asignación masiva: el `ValidationPipe` global
 * corre con `whitelist` y `forbidNonWhitelisted`, así que cualquier campo no
 * declarado aquí —`organizationId` entre ellos— se rechaza en vez de llegar a
 * Prisma. Antes el cuerpo crudo se pasaba a `data` y permitía mover una
 * propiedad a otra agencia (spec §17.1).
 */
class PropertyBaseDto {
  @IsOptional() @IsString() @Length(1, 100) externalReference?: string;
  @IsOptional() @IsString() @Length(1, 200) title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(OperationType) operationType?: OperationType;
  @IsOptional() @IsEnum(PropertyType) propertyType?: PropertyType;
  @IsOptional() @IsEnum(PropertyStatus) status?: PropertyStatus;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) price?: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsOptional() @IsString() @Length(1, 100) country?: string;
  @IsOptional() @IsString() @Length(1, 100) state?: string;
  @IsOptional() @IsString() @Length(1, 100) city?: string;
  @IsOptional() @IsString() @Length(1, 150) neighborhood?: string;
  @IsOptional() @IsString() addressDisplay?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(-180) @Max(180) longitude?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(50) bedrooms?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(50) bathrooms?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(50) parkingSpaces?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) constructionM2?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) landM2?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) amenities?: string[];
  @IsOptional() @IsUrl() publicUrl?: string;
  @IsOptional() @IsISO8601() availableFrom?: string;

  // --- la ficha completa (§14.1) -------------------------------------------
  @IsOptional() @IsString() responsibleUserId?: string;
  @IsOptional() @IsString() ownerContactId?: string;
  @IsOptional() @IsString() @Length(1, 60) internalCode?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(20) halfBathrooms?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) levels?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1800) @Max(2100) yearBuilt?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) maintenanceFee?: number;
  @IsOptional() @IsEnum(LegalStatus) legalStatus?: LegalStatus;
  @IsOptional() @IsUrl() videoUrl?: string;
  @IsOptional() @IsUrl() tourUrl?: string;
  @IsOptional() @IsString() privateNotes?: string;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) commissionPercent?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) sharedCommission?: number;
  @IsOptional() @IsBoolean() exclusivity?: boolean;
  @IsOptional() @IsISO8601() exclusivityUntil?: string;
  @IsOptional() @IsBoolean() showExactAddress?: boolean;
}

class CreatePropertyDto extends PropertyBaseDto {
  @IsString() @Length(1, 200) declare title: string;
  @IsEnum(OperationType) declare operationType: OperationType;
  @IsEnum(PropertyType) declare propertyType: PropertyType;
  @Type(() => Number) @IsNumber() @Min(0) declare price: number;
}

class UpdatePropertyDto extends PropertyBaseDto {}

class ListPropertiesDto {
  @IsOptional() @IsEnum(PropertyStatus) status?: PropertyStatus;
  @IsOptional() @IsEnum(OperationType) operationType?: OperationType;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() responsibleUserId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
  @IsOptional() @IsString() cursor?: string;
}

/**
 * Qué se devuelve de una propiedad según quién pregunta.
 *
 * Tres campos no salen nunca sin permiso, y son los tres que responden a «el
 * asesor que se va y se lleva la cartera»: quién es el dueño del inmueble,
 * cuánto cobra la agencia, y lo que el equipo anotó y al cliente no se le dice.
 *
 * Se recortan aquí, en la respuesta, y no ocultando el campo en la interfaz:
 * esconder un dato que ya viajó al navegador no es ocultarlo.
 */
export function publicar(property: any, permisos: Set<string>) {
  const puedeVerDueno = permisos.has('inventario.verPropietarios');
  if (puedeVerDueno) return property;

  const { ownerContact, ownerContactId, commissionPercent, privateNotes, ...resto } = property;
  return resto;
}

/** Escapa una celda para CSV; Excel en español lee bien las comillas dobles. */
function celdaCsv(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  const texto = String(valor);
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

@Controller('properties')
export class PropertiesController {
  constructor(
    private db: PrismaService,
    private permisos: PermissionsService,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Query() query: ListPropertiesDto,
  ) {
    const permisos = await this.permisos.of(user);
    const take = query.take ?? 50;
    const items = await this.db.property.findMany({
      where: {
        organizationId,
        status: query.status,
        operationType: query.operationType,
        city: query.city ? { equals: query.city, mode: 'insensitive' } : undefined,
        ...(query.search
          ? {
              OR: [
                { title: { contains: query.search, mode: 'insensitive' as const } },
                { neighborhood: { contains: query.search, mode: 'insensitive' as const } },
                { internalCode: { contains: query.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
        responsibleUserId: query.responsibleUserId,
      },
      orderBy: { createdAt: 'desc' },
      // Paginación por cursor (spec §14): sin ella la lista crece sin límite.
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > take;
    const visibles = (hasMore ? items.slice(0, take) : items).map((p) => publicar(p, permisos));
    return { items: visibles, nextCursor: hasMore ? items[take - 1].id : null };
  }

  @Get(':id')
  async one(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Param('id') id: string,
  ) {
    const property = await this.db.property.findFirst({
      where: { id, organizationId },
      include: {
        media: { include: { mediaAsset: true }, orderBy: { position: 'asc' } },
        ownerContact: true,
        responsibleUser: { select: { id: true, name: true } },
      },
    });
    if (!property) throw new NotFoundException('Propiedad no encontrada');
    return publicar(property, await this.permisos.of(user));
  }

  /**
   * Descarga del inventario.
   *
   * Va detrás de su propio permiso porque bajarse el catálogo completo es
   * exactamente lo que hace un asesor el día antes de irse. El archivo lleva lo
   * operativo; el dueño del inmueble y la comisión solo si además tiene permiso
   * para verlos.
   */
  @Get('export')
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR')
  @RequirePermission('inventario.exportar')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="inventario.csv"')
  async export(@CurrentUser() user: AuthUser, @TenantId() organizationId: string) {
    const permisos = await this.permisos.of(user);
    const conDueno = permisos.has('inventario.verPropietarios');

    const propiedades = await this.db.property.findMany({
      where: { organizationId, status: { not: 'INACTIVE' } },
      include: conDueno ? { ownerContact: true } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 5000,
    });

    const columnas = [
      'Clave interna', 'Título', 'Operación', 'Tipo', 'Estado', 'Precio', 'Moneda',
      'Estado/Provincia', 'Ciudad', 'Colonia', 'Recámaras', 'Baños', 'Medios baños',
      'Estacionamientos', 'Construcción m2', 'Terreno m2', 'Niveles', 'Año',
      'Mantenimiento', 'Situación jurídica', 'Exclusiva', 'Comisión compartida',
      ...(conDueno ? ['Propietario', 'Teléfono del propietario', 'Comisión'] : []),
    ];

    const filas = propiedades.map((p: any) => [
      p.internalCode, p.title, p.operationType, p.propertyType, p.status,
      p.price, p.currency, p.state, p.city, p.neighborhood,
      p.bedrooms, p.bathrooms, p.halfBathrooms, p.parkingSpaces,
      p.constructionM2, p.landM2, p.levels, p.yearBuilt,
      p.maintenanceFee, p.legalStatus, p.exclusivity ? 'Sí' : 'No', p.sharedCommission,
      ...(conDueno
        ? [p.ownerContact?.name, p.ownerContact?.phone, p.commissionPercent]
        : []),
    ]);

    await this.db.auditLog.create({
      data: {
        organizationId,
        userId: user.id,
        action: 'INVENTORY_EXPORTED',
        entityType: 'Property',
        // Sin esto, una descarga del catálogo completo no deja rastro, que es
        // justo la acción sobre la que después alguien va a preguntar.
        metadata: { filas: filas.length, conPropietarios: conDueno },
      },
    });

    return [columnas, ...filas].map((fila) => fila.map(celdaCsv).join(',')).join('\r\n');
  }

  @Post()
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR')
  @RequirePermission('inventario.administrar')
  create(@TenantId() organizationId: string, @Body() dto: CreatePropertyDto) {
    return this.db.property.create({
      data: {
        ...dto,
        organizationId,
        amenities: dto.amenities ?? [],
        availableFrom: dto.availableFrom ? new Date(dto.availableFrom) : undefined,
      },
    });
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR')
  @RequirePermission('inventario.administrar')
  async update(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    await this.assertPuedeEditar(user, organizationId, id);
    return this.db.property.update({
      where: { id, organizationId },
      data: {
        ...dto,
        availableFrom: dto.availableFrom ? new Date(dto.availableFrom) : undefined,
        exclusivityUntil: dto.exclusivityUntil ? new Date(dto.exclusivityUntil) : undefined,
      },
    });
  }

  /**
   * Editar la propiedad de otro asesor es un permiso aparte de poder editar.
   * Una propiedad sin responsable es de la agencia y la edita cualquiera que
   * administre inventario: no tiene a quién pertenecer.
   */
  private async assertPuedeEditar(user: AuthUser, organizationId: string, id: string) {
    const permisos = await this.permisos.of(user);
    if (permisos.has('inventario.editarDeOtros')) return;

    const propiedad = await this.db.property.findFirst({
      where: { id, organizationId },
      select: { responsibleUserId: true },
    });
    if (!propiedad) throw new NotFoundException('Propiedad no encontrada');
    if (propiedad.responsibleUserId && propiedad.responsibleUserId !== user.id) {
      throw new ForbiddenException('Esta propiedad está a cargo de otra persona');
    }
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  @RequirePermission('inventario.administrar')
  remove(@TenantId() organizationId: string, @Param('id') id: string) {
    // Borrado lógico: el inventario aparece en recomendaciones históricas.
    return this.db.property.update({
      where: { id, organizationId },
      data: { status: 'INACTIVE' },
    });
  }
}
