import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from './auth';
import { loadConfig, webhookUrl } from './config';
import { CRM_WEBHOOK_EVENTS, OpenWaGateway } from './openwa.gateway';
import { PrismaService } from './prisma.service';
import { TenantId } from './tenant';

class CreateSessionDto {
  @IsString()
  @Length(2, 120)
  name!: string;
}

@Controller('whatsapp/sessions')
export class WhatsappController {
  private readonly log = new Logger(WhatsappController.name);

  constructor(
    private openwa: OpenWaGateway,
    private db: PrismaService,
  ) {}

  @Get()
  list(@TenantId() organizationId: string) {
    return this.db.whatsappSession.findMany({
      where: { organizationId, status: { not: 'DELETED' } },
      include: { agent: { select: { id: true, name: true, status: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  async create(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Body() dto: CreateSessionDto,
  ) {
    const config = loadConfig();
    const local = await this.db.whatsappSession.create({
      data: { organizationId, name: dto.name, status: 'CREATING' },
    });

    try {
      const remote = await this.openwa.createSession(local.id);
      const providerSessionId = remote.providerSessionId;

      // Registrar el webhook es obligatorio: sin él la sesión se conecta pero
      // ningún mensaje llega nunca al CRM. Si falla, la sesión queda FAILED con
      // el motivo visible en vez de aparentar estar bien.
      const webhook = await this.openwa.configureWebhook({
        providerSessionId,
        url: webhookUrl(config.publicApiUrl),
        secret: config.openwa.webhookSecret,
        events: CRM_WEBHOOK_EVENTS,
      });

      await this.openwa.startSession(providerSessionId);

      const session = await this.db.whatsappSession.update({
        where: { id: local.id },
        data: {
          providerSessionId,
          status: 'QR_REQUIRED',
          webhookConfiguredAt: new Date(),
          engineType: remote.engineType,
        },
      });

      await this.audit(organizationId, user.id, 'WHATSAPP_SESSION_CREATED', local.id, {
        providerSessionId,
        webhookId: webhook.id,
      });
      return session;
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Error desconocido';
      await this.db.whatsappSession.update({
        where: { id: local.id },
        data: { status: 'FAILED', failureReason: reason.slice(0, 500) },
      });
      this.log.error(`No se pudo crear la sesión ${local.id}: ${reason}`);
      throw error;
    }
  }

  @Post(':id/start')
  @Roles('OWNER', 'ADMIN')
  async start(@TenantId() organizationId: string, @Param('id') id: string) {
    const session = await this.session(organizationId, id);
    await this.openwa.startSession(this.providerId(session));
    return this.db.whatsappSession.update({ where: { id }, data: { status: 'STARTING' } });
  }

  @Post(':id/stop')
  @Roles('OWNER', 'ADMIN')
  async stop(@TenantId() organizationId: string, @Param('id') id: string) {
    const session = await this.session(organizationId, id);
    await this.openwa.stopSession(this.providerId(session));
    return this.db.whatsappSession.update({
      where: { id },
      data: { status: 'STOPPED', disconnectedAt: new Date() },
    });
  }

  @Post(':id/reconnect')
  @Roles('OWNER', 'ADMIN')
  async reconnect(@TenantId() organizationId: string, @Param('id') id: string) {
    const session = await this.session(organizationId, id);
    const providerSessionId = this.providerId(session);
    await this.openwa.stopSession(providerSessionId).catch(() => undefined);
    await this.openwa.startSession(providerSessionId);
    return this.db.whatsappSession.update({
      where: { id },
      data: { status: 'STARTING', failureReason: null },
    });
  }

  @Get(':id/qr')
  async qr(@TenantId() organizationId: string, @Param('id') id: string) {
    const session = await this.session(organizationId, id);
    const result = await this.openwa.getQr(this.providerId(session));
    return { qrCode: result.qrCode, status: result.status };
  }

  @Get(':id/status')
  async status(@TenantId() organizationId: string, @Param('id') id: string) {
    const session = await this.session(organizationId, id);
    const remote = await this.openwa.getStatus(this.providerId(session));
    return this.db.whatsappSession.update({
      where: { id },
      data: {
        status: remote.status,
        lastProviderStatus: remote.rawStatus,
        phoneNumber: remote.phoneNumber ?? undefined,
        lastSeenAt: new Date(),
        ...(remote.status === 'CONNECTED' ? { connectedAt: new Date() } : {}),
      },
    });
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  async remove(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Param('id') id: string,
  ) {
    const session = await this.session(organizationId, id);
    await this.db.whatsappSession.update({ where: { id }, data: { status: 'DELETING' } });
    // El historial de conversaciones permanece: solo se retira el canal.
    await this.openwa.deleteSession(this.providerId(session)).catch((error) => {
      this.log.warn(`OpenWA no pudo borrar ${session.providerSessionId}: ${error.message}`);
    });
    await this.audit(organizationId, user.id, 'WHATSAPP_SESSION_DELETED', id);
    return this.db.whatsappSession.update({
      where: { id },
      data: { status: 'DELETED', agentId: null, disconnectedAt: new Date() },
    });
  }

  private async session(organizationId: string, id: string) {
    const session = await this.db.whatsappSession.findFirst({ where: { id, organizationId } });
    if (!session) throw new NotFoundException('Sesión no encontrada');
    return session;
  }

  private providerId(session: { providerSessionId: string | null; id: string }) {
    if (!session.providerSessionId) {
      throw new BadRequestException('La sesión aún no existe en OpenWA');
    }
    return session.providerSessionId;
  }

  private audit(
    organizationId: string,
    userId: string,
    action: string,
    entityId: string,
    metadata?: object,
  ) {
    return this.db.auditLog.create({
      data: {
        organizationId,
        userId,
        action,
        entityType: 'WhatsappSession',
        entityId,
        metadata: metadata as never,
      },
    });
  }
}
