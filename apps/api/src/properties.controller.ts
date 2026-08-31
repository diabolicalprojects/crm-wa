import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { OperationType, PropertyStatus, PropertyType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
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
import { Roles } from './auth';
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
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
  @IsOptional() @IsString() cursor?: string;
}

@Controller('properties')
export class PropertiesController {
  constructor(private db: PrismaService) {}

  @Get()
  async list(@TenantId() organizationId: string, @Query() query: ListPropertiesDto) {
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
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      // Paginación por cursor (spec §14): sin ella la lista crece sin límite.
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > take;
    return { items: hasMore ? items.slice(0, take) : items, nextCursor: hasMore ? items[take - 1].id : null };
  }

  @Get(':id')
  async one(@TenantId() organizationId: string, @Param('id') id: string) {
    const property = await this.db.property.findFirst({
      where: { id, organizationId },
      include: { media: { include: { mediaAsset: true }, orderBy: { position: 'asc' } } },
    });
    if (!property) throw new NotFoundException('Propiedad no encontrada');
    return property;
  }

  @Post()
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR')
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
  update(
    @TenantId() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePropertyDto,
  ) {
    return this.db.property.update({
      where: { id, organizationId },
      data: {
        ...dto,
        availableFrom: dto.availableFrom ? new Date(dto.availableFrom) : undefined,
      },
    });
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  remove(@TenantId() organizationId: string, @Param('id') id: string) {
    // Borrado lógico: el inventario aparece en recomendaciones históricas.
    return this.db.property.update({
      where: { id, organizationId },
      data: { status: 'INACTIVE' },
    });
  }
}
