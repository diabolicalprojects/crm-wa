import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ContactKind, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { AuthUser, CurrentUser, Roles } from './auth';
import { RequirePermission } from './permissions';
import { PrismaService } from './prisma.service';
import { TenantId } from './tenant';

/**
 * La libreta de la agencia (§14.5, montón A6).
 *
 * Aquí vive **la persona**; en `Lead` vive **la oportunidad**. Están separados a
 * propósito: fusionarlos obliga a inventarle una oportunidad a quien no la
 * tiene —el dueño de una casa, un notario, el colega de otra inmobiliaria— y
 * ensucia el embudo con registros que nunca van a cerrar.
 */

class ContactBaseDto {
  @IsOptional() @IsString() @Length(2, 150) name?: string;
  @IsOptional() @Matches(/^[\d\s+()-]{7,20}$/, { message: 'El teléfono solo admite dígitos y separadores' })
  phone?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsEnum(ContactKind) kind?: ContactKind;
  @IsOptional() @IsString() @Length(1, 150) company?: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}

class CreateContactDto extends ContactBaseDto {
  @IsString() @Length(2, 150) declare name: string;
}

class ListContactsDto {
  @IsOptional() @IsEnum(ContactKind) kind?: ContactKind;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
  @IsOptional() @IsString() cursor?: string;
}

@Controller('contacts')
@Roles('OWNER', 'ADMIN', 'SUPERVISOR')
@RequirePermission('contactos.administrar')
export class ContactsController {
  constructor(private db: PrismaService) {}

  @Get()
  async list(@TenantId() organizationId: string, @Query() query: ListContactsDto) {
    const take = query.take ?? 50;
    const items = await this.db.contact.findMany({
      where: {
        organizationId,
        kind: query.kind,
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' as const } },
                { phone: { contains: query.search } },
                { email: { contains: query.search, mode: 'insensitive' as const } },
                { company: { contains: query.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: { _count: { select: { ownedProperties: true } } },
      orderBy: { name: 'asc' },
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > take;
    return {
      items: hasMore ? items.slice(0, take) : items,
      nextCursor: hasMore ? items[take - 1].id : null,
    };
  }

  @Get(':id')
  async one(@TenantId() organizationId: string, @Param('id') id: string) {
    const contact = await this.db.contact.findFirst({
      where: { id, organizationId },
      include: {
        ownedProperties: {
          select: { id: true, title: true, status: true, price: true, currency: true },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!contact) throw new NotFoundException('Contacto no encontrado');
    return contact;
  }

  @Post()
  async create(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Body() dto: CreateContactDto,
  ) {
    try {
      return await this.db.contact.create({
        data: { ...dto, organizationId, createdById: user.id },
      });
    } catch (error) {
      throw this.duplicado(error);
    }
  }

  @Patch(':id')
  async update(
    @TenantId() organizationId: string,
    @Param('id') id: string,
    @Body() dto: ContactBaseDto,
  ) {
    const existe = await this.db.contact.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!existe) throw new NotFoundException('Contacto no encontrado');
    try {
      return await this.db.contact.update({ where: { id }, data: dto });
    } catch (error) {
      throw this.duplicado(error);
    }
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  async remove(@TenantId() organizationId: string, @Param('id') id: string) {
    const contact = await this.db.contact.findFirst({
      where: { id, organizationId },
      include: { _count: { select: { ownedProperties: true } } },
    });
    if (!contact) throw new NotFoundException('Contacto no encontrado');

    // Borrar al propietario de un inmueble activo dejaría la ficha sin dueño y
    // sin forma de recuperarlo. Se pide desligarlo antes, a propósito.
    if (contact._count.ownedProperties > 0) {
      throw new BadRequestException(
        `Es dueño de ${contact._count.ownedProperties} ${
          contact._count.ownedProperties === 1 ? 'propiedad' : 'propiedades'
        }. Quítalo de sus fichas antes de borrarlo.`,
      );
    }
    await this.db.contact.delete({ where: { id } });
    return { borrado: true };
  }

  /** El teléfono es único por agencia: dos fichas del mismo dueño son un error. */
  private duplicado(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new BadRequestException('Ya existe un contacto con ese teléfono en esta agencia');
    }
    return error;
  }
}
