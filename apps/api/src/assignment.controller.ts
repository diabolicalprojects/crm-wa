import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import { AssignmentMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { AuthUser, CurrentUser, Roles } from './auth';
import { PrismaService } from './prisma.service';
import { TenantId } from './tenant';

class DutyShiftDto {
  @IsString() userId!: string;

  /** 1 = lunes … 7 = domingo. */
  @IsArray() @ArrayMaxSize(7) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true })
  days!: number[];

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'La hora de inicio debe ser HH:MM' })
  from!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'La hora de fin debe ser HH:MM' })
  to!: string;
}

class AssignmentSettingsDto {
  @IsEnum(AssignmentMode) mode!: AssignmentMode;
  @IsBoolean() stickyAdvisor!: boolean;

  @IsOptional() @IsArray() @ArrayMaxSize(30)
  @ValidateNested({ each: true }) @Type(() => DutyShiftDto)
  duty?: DutyShiftDto[];
}

/** Configuración de cómo se reparten los prospectos nuevos (§14.2). */
@Controller('assignment')
export class AssignmentController {
  constructor(private db: PrismaService) {}

  @Get()
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR')
  async read(@TenantId() organizationId: string) {
    const org = await this.db.organization.findUnique({
      where: { id: organizationId },
      select: {
        assignmentMode: true,
        stickyAdvisor: true,
        dutySchedule: true,
        timezone: true,
        lastAssignedUserId: true,
      },
    });
    const miembros = await this.db.organizationMember.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: { userId: true, role: true, user: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      mode: org?.assignmentMode ?? 'CHANNEL_RESPONSIBLE',
      stickyAdvisor: org?.stickyAdvisor ?? true,
      duty: Array.isArray(org?.dutySchedule) ? org?.dutySchedule : [],
      timezone: org?.timezone,
      lastAssignedUserId: org?.lastAssignedUserId,
      miembros: miembros.map((m) => ({
        userId: m.userId,
        role: m.role,
        name: m.user.name,
        email: m.user.email,
      })),
    };
  }

  @Put()
  @Roles('OWNER', 'ADMIN')
  async save(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Body() dto: AssignmentSettingsDto,
  ) {
    // Un turno con el `userId` de otra agencia dejaría prospectos asignados a
    // alguien que no pertenece aquí. El servicio lo filtraría al resolver, pero
    // guardarlo sería aceptar una configuración que nunca va a funcionar.
    const turnos = dto.duty ?? [];
    if (turnos.length) {
      const propios = await this.db.organizationMember.findMany({
        where: { organizationId, status: 'ACTIVE', userId: { in: turnos.map((t) => t.userId) } },
        select: { userId: true },
      });
      const validos = new Set(propios.map((m) => m.userId));
      for (const turno of turnos) {
        if (!validos.has(turno.userId)) {
          throw new BadRequestException(
            'Un turno apunta a alguien que no es miembro activo de esta agencia',
          );
        }
      }
    }

    const [org] = await this.db.$transaction([
      this.db.organization.update({
        where: { id: organizationId },
        data: {
          assignmentMode: dto.mode,
          stickyAdvisor: dto.stickyAdvisor,
          dutySchedule: turnos.length ? (turnos as any) : undefined,
        },
        select: { assignmentMode: true, stickyAdvisor: true, dutySchedule: true },
      }),
      this.db.auditLog.create({
        data: {
          organizationId,
          userId: user.id,
          action: 'ASSIGNMENT_RULES_UPDATED',
          entityType: 'Organization',
          entityId: organizationId,
        },
      }),
    ]);
    return org;
  }
}
