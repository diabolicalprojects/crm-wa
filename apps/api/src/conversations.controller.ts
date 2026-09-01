import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ConversationStatus, Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from './auth';
import { OpenWaGateway } from './openwa.gateway';
import { PrismaService } from './prisma.service';
import { TenantId } from './tenant';

class SendMessageDto {
  @IsString() @Length(1, 4096) text!: string;
}

class AssignDto {
  @IsString() userId!: string;
}

class ListConversationsDto {
  @IsOptional() @IsEnum(ConversationStatus) status?: ConversationStatus;
  /**
   * Filtra por canal. Solo tiene sentido para quien ve varias sesiones: un
   * asesor ya está acotado a las suyas por `advisorScope`, y ese filtro manda
   * de todos modos, así que pedir el canal de otro no amplía lo que ve.
   */
  @IsOptional() @IsString() sessionId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
  @IsOptional() @IsString() cursor?: string;
}

/** Un asesor solo ve las conversaciones de su agente o las asignadas (§7.3). */
function advisorScope(user: AuthUser): Prisma.ConversationWhereInput {
  if (user.isSuperAdmin || user.role !== 'ADVISOR') return {};
  return {
    OR: [{ assignedUserId: user.id }, { agent: { responsibleUserId: user.id } }],
  };
}

@Controller('conversations')
export class ConversationsController {
  constructor(
    private db: PrismaService,
    private openwa: OpenWaGateway,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Query() query: ListConversationsDto,
  ) {
    const take = query.take ?? 50;
    const items = await this.db.conversation.findMany({
      where: {
        organizationId,
        status: query.status,
        sessionId: query.sessionId,
        // Se aplica después del canal: acotar por rol nunca es opcional.
        ...advisorScope(user),
      },
      include: {
        lead: true,
        agent: { select: { id: true, name: true, aiEnabled: true } },
        session: { select: { id: true, name: true, status: true, phoneNumber: true } },
        messages: { take: 1, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
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
    const conversation = await this.db.conversation.findFirst({
      where: { id, organizationId, ...advisorScope(user) },
      include: {
        lead: { include: { matches: { include: { property: true }, take: 5, orderBy: { shownAt: 'desc' } } } },
        agent: true,
        session: true,
        assignedUser: { select: { id: true, name: true } },
      },
    });
    if (!conversation) throw new NotFoundException('Conversación no encontrada');
    return conversation;
  }

  @Get(':id/messages')
  async messages(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Param('id') id: string,
    @Query() query: ListConversationsDto,
  ) {
    await this.assertVisible(user, organizationId, id);
    const take = query.take ?? 100;
    return this.db.message.findMany({
      where: { conversationId: id, organizationId },
      include: { sender: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
      take,
    });
  }

  @Post(':id/takeover')
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR', 'ADVISOR')
  async takeover(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Param('id') id: string,
  ) {
    await this.assertVisible(user, organizationId, id);
    const [conversation] = await this.db.$transaction([
      this.db.conversation.update({
        where: { id, organizationId },
        data: { mode: 'HUMAN_ACTIVE', assignedUserId: user.id },
      }),
      this.db.auditLog.create({
        data: {
          organizationId,
          userId: user.id,
          action: 'CONVERSATION_TAKEOVER',
          entityType: 'Conversation',
          entityId: id,
        },
      }),
    ]);
    return conversation;
  }

  @Post(':id/return-to-ai')
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR', 'ADVISOR')
  async returnToAi(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Param('id') id: string,
  ) {
    await this.assertVisible(user, organizationId, id);
    const [conversation] = await this.db.$transaction([
      this.db.conversation.update({
        where: { id, organizationId },
        data: { mode: 'AI_ACTIVE', assignedUserId: null, handoffReason: null },
      }),
      // Nota de sistema para que el modelo sepa que hubo intervención humana.
      this.db.message.create({
        data: {
          organizationId,
          conversationId: id,
          direction: 'OUTBOUND',
          senderType: 'SYSTEM',
          origin: 'SYSTEM',
          type: 'TEXT',
          status: 'SENT',
          text: 'Un asesor humano atendió esta conversación y devolvió el control a la IA.',
        },
      }),
      this.db.auditLog.create({
        data: {
          organizationId,
          userId: user.id,
          action: 'CONVERSATION_RETURNED_TO_AI',
          entityType: 'Conversation',
          entityId: id,
        },
      }),
    ]);
    return conversation;
  }

  @Post(':id/resolve')
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR', 'ADVISOR')
  async resolve(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Param('id') id: string,
  ) {
    await this.assertVisible(user, organizationId, id);
    return this.db.conversation.update({
      where: { id, organizationId },
      data: { status: 'RESOLVED' },
    });
  }

  @Post(':id/assign')
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR')
  async assign(
    @TenantId() organizationId: string,
    @Param('id') id: string,
    @Body() dto: AssignDto,
  ) {
    const member = await this.db.organizationMember.findFirst({
      where: { organizationId, userId: dto.userId, status: 'ACTIVE' },
    });
    if (!member) throw new BadRequestException('El usuario no pertenece a esta agencia');
    return this.db.conversation.update({
      where: { id, organizationId },
      data: { assignedUserId: dto.userId },
    });
  }

  @Post(':id/messages')
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR', 'ADVISOR')
  async send(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Param('id') conversationId: string,
    @Body() dto: SendMessageDto,
  ) {
    const conversation = await this.db.conversation.findFirst({
      where: { id: conversationId, organizationId, ...advisorScope(user) },
      include: { session: true, lead: true },
    });
    if (!conversation) throw new NotFoundException('Conversación no encontrada');
    if (!conversation.session.providerSessionId || conversation.session.status !== 'CONNECTED') {
      throw new BadRequestException('La sesión de WhatsApp no está conectada');
    }

    const sent = await this.openwa.sendText({
      providerSessionId: conversation.session.providerSessionId,
      chatId: conversation.lead.whatsappChatId || conversation.lead.phone,
      text: dto.text,
    });

    const message = await this.db.message.create({
      data: {
        organizationId,
        conversationId,
        sessionId: conversation.sessionId,
        // Guardar el ID del proveedor es lo que permite reconocer el eco
        // `message.sent` como propio y no duplicarlo (spec §15).
        providerMessageId: sent.providerMessageId,
        direction: 'OUTBOUND',
        senderType: 'HUMAN',
        senderUserId: user.id,
        origin: 'CRM',
        type: 'TEXT',
        text: dto.text,
        status: 'SENT',
      },
    });

    const now = new Date();
    await this.db.conversation.update({
      where: { id: conversationId },
      data: {
        // Responder desde el CRM pausa la IA indefinidamente (spec §8.6).
        mode: 'HUMAN_ACTIVE',
        assignedUserId: user.id,
        lastMessageAt: now,
        lastOutboundAt: now,
      },
    });
    return message;
  }

  private async assertVisible(user: AuthUser, organizationId: string, id: string) {
    const found = await this.db.conversation.findFirst({
      where: { id, organizationId, ...advisorScope(user) },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Conversación no encontrada');
  }
}
