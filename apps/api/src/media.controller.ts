import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthUser, CurrentUser, Roles } from './auth';
import { MediaStorageService } from './media-storage.service';
import { OpenWaGateway, type MediaKind } from './openwa.gateway';
import { PrismaService } from './prisma.service';
import { TenantId } from './tenant';
import { EventsService } from './events.service';

const MAX_BYTES = Number(process.env.MEDIA_MAX_BYTES ?? 16 * 1024 * 1024);

/** Qué ruta de envío usa cada tipo de archivo. */
function kindFor(mimeType: string): MediaKind {
  const tipo = mimeType.toLowerCase();
  if (tipo.startsWith('image/')) return tipo.includes('webp') ? 'sticker' : 'image';
  if (tipo.startsWith('video/')) return 'video';
  if (tipo.startsWith('audio/')) return 'audio';
  return 'document';
}

/** Con qué se muestra en la bandeja. */
function messageTypeFor(mimeType: string) {
  const tipo = mimeType.toLowerCase();
  if (tipo.startsWith('image/')) return 'IMAGE' as const;
  if (tipo.startsWith('video/')) return 'VIDEO' as const;
  if (tipo.startsWith('audio/')) return 'AUDIO' as const;
  return 'DOCUMENT' as const;
}

@Controller()
export class MediaController {
  constructor(
    private db: PrismaService,
    private media: MediaStorageService,
    private openwa: OpenWaGateway,
    private events: EventsService,
  ) {}

  /**
   * Sirve un archivo. Va acotado a la agencia del usuario: un identificador
   * adivinado de otra agencia responde 404, no el archivo.
   */
  @Get('media/:id')
  async download(
    @TenantId() organizationId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const archivo = await this.media.read(organizationId, id);
    res.setHeader('Content-Type', archivo.safeMimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', String(archivo.bytes.length));
    // Los tipos que no son inertes se descargan; nunca se ejecutan en el
    // origen de la API. Un `image/svg+xml` servido con su tipo real sería un
    // vector de scripting contra la propia consola.
    res.setHeader(
      'Content-Disposition',
      archivo.safeMimeType === 'application/octet-stream'
        ? `attachment; filename="${(archivo.filename ?? 'archivo').replace(/[^\w.\-]/g, '_')}"`
        : 'inline',
    );
    // Inmutable: el contenido de un id nunca cambia, y sin esto cada apertura
    // de la conversación vuelve a bajar todas las fotos.
    res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
    res.end(archivo.bytes);
  }

  /**
   * Manda un archivo por la conversación. El asesor adjunta, el CRM lo guarda,
   * lo envía por el mismo canal por el que entró la conversación y lo registra
   * como mensaje humano —lo que pausa la IA, igual que responder con texto.
   */
  @Post('conversations/:id/media')
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR', 'ADVISOR')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async send(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Param('id') conversationId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('No se recibió ningún archivo');

    const conversation = await this.db.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId,
        // Un asesor solo puede escribir en lo suyo, igual que en texto.
        ...(user.isSuperAdmin || user.role !== 'ADVISOR'
          ? {}
          : { OR: [{ assignedUserId: user.id }, { agent: { responsibleUserId: user.id } }] }),
      },
      include: { session: true, lead: true },
    });
    if (!conversation) throw new NotFoundException('Conversación no encontrada');
    if (!conversation.session.providerSessionId || conversation.session.status !== 'CONNECTED') {
      throw new BadRequestException('La sesión de WhatsApp no está conectada');
    }

    const mimeType = file.mimetype || 'application/octet-stream';
    const asset = await this.media.store({
      organizationId,
      bytes: file.buffer,
      mimeType,
      filename: file.originalname,
      source: 'UPLOAD',
    });

    // Se envía en base64 y no por URL a propósito: un envío por URL hace que la
    // pasarela descargue en el momento y no conserve nada, así que el archivo
    // dejaría de poder recuperarse por la ruta de blob.
    const sent = await this.openwa.sendMedia({
      providerSessionId: conversation.session.providerSessionId,
      chatId: conversation.lead.whatsappChatId || conversation.lead.phone,
      kind: kindFor(mimeType),
      base64: file.buffer.toString('base64'),
      mimeType,
      filename: file.originalname,
    });

    const message = await this.db.message.create({
      data: {
        organizationId,
        conversationId,
        sessionId: conversation.sessionId,
        // Guardar el id del proveedor es lo que permite reconocer el eco
        // `message.sent` como propio y no duplicarlo (spec §15).
        providerMessageId: sent.providerMessageId,
        direction: 'OUTBOUND',
        senderType: 'HUMAN',
        senderUserId: user.id,
        origin: 'CRM',
        type: messageTypeFor(mimeType),
        mediaId: asset.id,
        status: 'SENT',
      },
    });

    const now = new Date();
    await this.db.conversation.update({
      where: { id: conversationId },
      data: {
        // Mandar un archivo es intervenir, igual que mandar texto (spec §8.6).
        mode: 'HUMAN_ACTIVE',
        assignedUserId: user.id,
        lastMessageAt: now,
        lastOutboundAt: now,
      },
    });

    this.events.publish(organizationId, {
      type: 'message.created',
      conversationId,
      leadId: conversation.leadId,
    });
    return message;
  }
}
