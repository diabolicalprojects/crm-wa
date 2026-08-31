import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { AgentStatus, OperationMode, Prisma } from '@prisma/client';
import { IsBoolean, IsEnum, IsObject, IsOptional, IsString, Length } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from './auth';
import { PrismaService } from './prisma.service';
import { TenantId } from './tenant';

class AgentBaseDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsString() responsibleUserId?: string;
  @IsOptional() @IsString() @Length(1, 500) description?: string;
  @IsOptional() @IsEnum(OperationMode) operationMode?: OperationMode;
  @IsOptional() @IsEnum(AgentStatus) status?: AgentStatus;
  @IsOptional() @IsString() @Length(1, 10) language?: string;
  @IsOptional() @IsString() @Length(1, 50) tone?: string;
  @IsOptional() @IsString() @Length(1, 1000) greetingMessage?: string;
  @IsOptional() @IsString() systemInstructions?: string;
  @IsOptional() @IsBoolean() aiEnabled?: boolean;
  @IsOptional() @IsString() modelConfigId?: string;
  @IsOptional() @IsObject() businessHours?: Record<string, unknown>;
  @IsOptional() @IsObject() handoffRules?: Record<string, unknown>;
}

class CreateAgentDto extends AgentBaseDto {
  @IsString() @Length(2, 120) declare name: string;
  @IsString() declare responsibleUserId: string;
}

class UpdateAgentDto extends AgentBaseDto {}

class AssignSessionDto {
  @IsString() whatsappSessionId!: string;
}

@Controller('agents')
export class AgentsController {
  constructor(private db: PrismaService) {}

  @Get()
  list(@TenantId() organizationId: string) {
    return this.db.agent.findMany({
      where: { organizationId, status: { not: 'ARCHIVED' } },
      include: {
        responsibleUser: { select: { id: true, name: true, email: true } },
        session: { select: { id: true, name: true, status: true, phoneNumber: true } },
        modelConfig: { select: { id: true, name: true, model: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Get(':id')
  async one(@TenantId() organizationId: string, @Param('id') id: string) {
    const agent = await this.db.agent.findFirst({
      where: { id, organizationId },
      include: { responsibleUser: true, session: true, modelConfig: true },
    });
    if (!agent) throw new NotFoundException('Agente no encontrado');
    return agent;
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  async create(@TenantId() organizationId: string, @Body() dto: CreateAgentDto) {
    await this.assertAdvisorIsFree(organizationId, dto.responsibleUserId);
    try {
      return await this.db.agent.create({
        data: {
          ...dto,
          organizationId,
          operationMode: dto.operationMode ?? 'HYBRID',
          businessHours: dto.businessHours as Prisma.InputJsonValue | undefined,
          handoffRules: dto.handoffRules as Prisma.InputJsonValue | undefined,
        },
        include: { responsibleUser: { select: { id: true, name: true, email: true } } },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new BadRequestException('El usuario responsable no existe');
      }
      throw error;
    }
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  async update(
    @TenantId() organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAgentDto,
  ) {
    if (dto.responsibleUserId) {
      await this.assertAdvisorIsFree(organizationId, dto.responsibleUserId, id);
    }
    return this.db.agent.update({
      where: { id, organizationId },
      data: {
        ...dto,
        businessHours: dto.businessHours as Prisma.InputJsonValue | undefined,
        handoffRules: dto.handoffRules as Prisma.InputJsonValue | undefined,
      },
    });
  }

  @Post(':id/activate')
  @Roles('OWNER', 'ADMIN')
  activate(@TenantId() organizationId: string, @Param('id') id: string) {
    return this.db.agent.update({ where: { id, organizationId }, data: { status: 'ACTIVE' } });
  }

  @Post(':id/pause')
  @Roles('OWNER', 'ADMIN')
  pause(@TenantId() organizationId: string, @Param('id') id: string) {
    // Pausar la IA no desconecta el número: la sesión sigue viva (spec §7.2).
    return this.db.agent.update({
      where: { id, organizationId },
      data: { status: 'PAUSED', aiEnabled: false },
    });
  }

  /**
   * Asigna una sesión. La spec §14.8 es explícita: si la sesión ya está
   * asignada se responde 409 y **no** se reemplaza en silencio, que es lo que
   * hacía la versión anterior.
   */
  @Put(':id/session-assignment')
  @Roles('OWNER', 'ADMIN')
  async assign(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Param('id') agentId: string,
    @Body() dto: AssignSessionDto,
  ) {
    return this.db.$transaction(async (tx) => {
      const agent = await tx.agent.findFirst({ where: { id: agentId, organizationId } });
      if (!agent) throw new NotFoundException('Agente no encontrado');

      const session = await tx.whatsappSession.findFirst({
        where: { id: dto.whatsappSessionId, organizationId },
      });
      if (!session) throw new NotFoundException('Sesión no encontrada');

      if (session.agentId && session.agentId !== agentId) {
        throw new ConflictException('Esa sesión ya está asignada a otro agente');
      }
      const current = await tx.whatsappSession.findFirst({
        where: { organizationId, agentId },
      });
      if (current && current.id !== session.id) {
        throw new ConflictException(
          'Este agente ya tiene una sesión asignada. Retírala antes de asignar otra.',
        );
      }

      const updated = await tx.whatsappSession.update({
        where: { id: session.id },
        data: { agentId },
        include: { agent: { select: { id: true, name: true } } },
      });

      // Historial de asignaciones (spec §11.6): el cambio queda trazado.
      await tx.agentSessionAssignment.create({
        data: {
          organizationId,
          agentId,
          whatsappSessionId: session.id,
          assignedByUserId: user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          userId: user.id,
          action: 'AGENT_SESSION_ASSIGNED',
          entityType: 'Agent',
          entityId: agentId,
          metadata: { whatsappSessionId: session.id },
        },
      });
      return updated;
    });
  }

  @Delete(':id/session-assignment')
  @Roles('OWNER', 'ADMIN')
  async unassign(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Param('id') agentId: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const session = await tx.whatsappSession.findFirst({ where: { organizationId, agentId } });
      if (!session) throw new NotFoundException('El agente no tiene una sesión asignada');

      await tx.whatsappSession.update({ where: { id: session.id }, data: { agentId: null } });
      await tx.agentSessionAssignment.updateMany({
        where: { organizationId, agentId, whatsappSessionId: session.id, unassignedAt: null },
        data: { unassignedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          userId: user.id,
          action: 'AGENT_SESSION_UNASSIGNED',
          entityType: 'Agent',
          entityId: agentId,
          metadata: { whatsappSessionId: session.id },
        },
      });
      return { unassigned: true };
    });
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  remove(@TenantId() organizationId: string, @Param('id') id: string) {
    return this.db.agent.update({
      where: { id, organizationId },
      data: { status: 'ARCHIVED', aiEnabled: false },
    });
  }

  /** Spec §4.1: en esta versión un asesor puede tener un solo agente activo. */
  private async assertAdvisorIsFree(organizationId: string, userId: string, excludeAgentId?: string) {
    const existing = await this.db.agent.findFirst({
      where: {
        organizationId,
        responsibleUserId: userId,
        status: { in: ['DRAFT', 'ACTIVE', 'PAUSED'] },
        ...(excludeAgentId ? { id: { not: excludeAgentId } } : {}),
      },
      select: { id: true, name: true },
    });
    if (existing) {
      throw new ConflictException(`Ese asesor ya representa al agente "${existing.name}"`);
    }
  }
}
