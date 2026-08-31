import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { IsEnum, IsISO8601, IsOptional, IsString, Length } from 'class-validator';
import { Roles } from './auth';
import { PrismaService } from './prisma.service';
import { TenantId } from './tenant';

class CreateAppointmentDto {
  @IsString() leadId!: string;
  @IsOptional() @IsString() propertyId?: string;
  @IsString() assignedUserId!: string;
  @IsISO8601() startsAt!: string;
  @IsISO8601() endsAt!: string;
  @IsOptional() @IsString() @Length(1, 1000) notes?: string;
  @IsOptional() @IsString() timezone?: string;
}

class UpdateAppointmentDto {
  @IsOptional() @IsISO8601() startsAt?: string;
  @IsOptional() @IsISO8601() endsAt?: string;
  @IsOptional() @IsEnum(AppointmentStatus) status?: AppointmentStatus;
  @IsOptional() @IsString() @Length(1, 1000) notes?: string;
  @IsOptional() @IsString() assignedUserId?: string;
}

class ListAppointmentsDto {
  @IsOptional() @IsEnum(AppointmentStatus) status?: AppointmentStatus;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
}

/**
 * Visitas a propiedades. PostgreSQL es la fuente de verdad; la sincronización
 * con Google Calendar la hace un worker aparte y por eso cada cambio deja la
 * cita en `syncStatus: PENDING` (spec §8.7).
 */
@Controller('appointments')
export class AppointmentsController {
  constructor(private db: PrismaService) {}

  @Get()
  list(@TenantId() organizationId: string, @Query() query: ListAppointmentsDto) {
    return this.db.appointment.findMany({
      where: {
        organizationId,
        status: query.status,
        ...(query.from || query.to
          ? {
              startsAt: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      include: {
        assignedUser: { select: { id: true, name: true, email: true } },
        lead: { select: { id: true, name: true, phone: true } },
        property: { select: { id: true, title: true, addressDisplay: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  @Post()
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR', 'ADVISOR')
  create(@TenantId() organizationId: string, @Body() dto: CreateAppointmentDto) {
    return this.db.appointment.create({
      data: {
        organizationId,
        leadId: dto.leadId,
        propertyId: dto.propertyId,
        assignedUserId: dto.assignedUserId,
        startsAt: new Date(dto.startsAt),
        endsAt: new Date(dto.endsAt),
        timezone: dto.timezone,
        notes: dto.notes,
        status: 'SCHEDULED',
        syncStatus: 'PENDING',
      },
    });
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR', 'ADVISOR')
  update(
    @TenantId() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentDto,
  ) {
    return this.db.appointment.update({
      where: { id, organizationId },
      data: {
        ...dto,
        startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
        // Cualquier cambio debe replicarse al calendario externo.
        syncStatus: 'PENDING',
        syncVersion: { increment: 1 },
      },
    });
  }

  @Post(':id/confirm')
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR', 'ADVISOR')
  confirm(@TenantId() organizationId: string, @Param('id') id: string) {
    return this.db.appointment.update({
      where: { id, organizationId },
      data: { status: 'CONFIRMED', syncStatus: 'PENDING', syncVersion: { increment: 1 } },
    });
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR', 'ADVISOR')
  cancel(@TenantId() organizationId: string, @Param('id') id: string) {
    return this.db.appointment.update({
      where: { id, organizationId },
      data: { status: 'CANCELLED', syncStatus: 'PENDING', syncVersion: { increment: 1 } },
    });
  }
}
