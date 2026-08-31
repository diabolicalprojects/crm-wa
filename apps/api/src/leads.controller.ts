import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Query } from '@nestjs/common';
import { LeadStage, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { AuthUser, CurrentUser, Roles } from './auth';
import { PrismaService } from './prisma.service';
import { TenantId } from './tenant';

class CreateLeadDto {
  @IsString() @Matches(/^\d{8,15}$/, { message: 'El teléfono debe tener de 8 a 15 dígitos' })
  phone!: string;
  @IsOptional() @IsString() @Length(1, 150) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsEnum(LeadStage) stage?: LeadStage;
  @IsOptional() @IsString() source?: string;
}

class UpdateLeadDto {
  @IsOptional() @IsString() @Length(1, 150) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsEnum(LeadStage) stage?: LeadStage;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) score?: number;
  @IsOptional() @IsObject() preferences?: Record<string, unknown>;
  @IsOptional() @IsString() assignedUserId?: string;
  @IsOptional() @IsString() aiSummary?: string;
}

class ListLeadsDto {
  @IsOptional() @IsEnum(LeadStage) stage?: LeadStage;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
  @IsOptional() @IsString() cursor?: string;
}

/**
 * Un asesor solo ve lo suyo: los leads que le asignaron y los de las
 * conversaciones que atiende su agente (spec §7.3). Los demás roles ven toda la
 * agencia. El filtro se aplica en el backend porque ocultar botones en el
 * frontend no es autorización (spec §6.1).
 */
export function advisorScope(user: AuthUser): Prisma.LeadWhereInput {
  if (user.isSuperAdmin || user.role !== 'ADVISOR') return {};
  return {
    OR: [
      { assignedUserId: user.id },
      { conversations: { some: { agent: { responsibleUserId: user.id } } } },
      { conversations: { some: { assignedUserId: user.id } } },
    ],
  };
}

@Controller('leads')
export class LeadsController {
  constructor(private db: PrismaService) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Query() query: ListLeadsDto,
  ) {
    const take = query.take ?? 50;
    const items = await this.db.lead.findMany({
      where: {
        organizationId,
        stage: query.stage,
        ...advisorScope(user),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' as const } },
                { phone: { contains: query.search } },
              ],
            }
          : {}),
      },
      include: { _count: { select: { conversations: true } } },
      orderBy: { updatedAt: 'desc' },
      take: take + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > take;
    return { items: hasMore ? items.slice(0, take) : items, nextCursor: hasMore ? items[take - 1].id : null };
  }

  @Get(':id')
  async one(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Param('id') id: string,
  ) {
    const lead = await this.db.lead.findFirst({
      where: { id, organizationId, ...advisorScope(user) },
      include: {
        conversations: { include: { agent: { select: { id: true, name: true } } } },
        matches: {
          include: { property: { select: { id: true, title: true, price: true, currency: true } } },
          orderBy: { shownAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!lead) throw new NotFoundException('Lead no encontrado');
    return lead;
  }

  @Post()
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR', 'ADVISOR')
  create(@TenantId() organizationId: string, @Body() dto: CreateLeadDto) {
    return this.db.lead.create({ data: { ...dto, organizationId } });
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR', 'ADVISOR')
  async update(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto,
  ) {
    await this.assertVisible(user, organizationId, id);
    return this.db.lead.update({
      where: { id, organizationId },
      data: { ...dto, preferences: dto.preferences as Prisma.InputJsonValue | undefined },
    });
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR')
  remove(@TenantId() organizationId: string, @Param('id') id: string) {
    return this.db.lead.update({ where: { id, organizationId }, data: { stage: 'LOST' } });
  }

  private async assertVisible(user: AuthUser, organizationId: string, id: string) {
    const found = await this.db.lead.findFirst({
      where: { id, organizationId, ...advisorScope(user) },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Lead no encontrado');
  }
}
