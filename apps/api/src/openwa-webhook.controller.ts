import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { Public } from './auth';
import { PrismaService } from './prisma.service';
import { OpenWaIngestService, OpenWaEnvelope } from './openwa-ingest.service';

/**
 * Punto de entrada de los eventos de OpenWA.
 *
 * Responsabilidad acotada: verificar la firma sobre los bytes crudos,
 * deduplicar por `idempotencyKey`, dejar rastro y responder rápido. El
 * procesamiento vive en `OpenWaIngestService` (spec §8.4 y §10.3).
 */
@Public()
@Controller('integrations/openwa')
export class OpenWaWebhookController {
  private readonly log = new Logger(OpenWaWebhookController.name);

  constructor(
    private db: PrismaService,
    private ingest: OpenWaIngestService,
  ) {}

  @Post('webhook')
  @HttpCode(202)
  async receive(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('x-openwa-signature') signature?: string,
    @Headers('x-openwa-idempotency-key') idempotencyHeader?: string,
    @Headers('x-openwa-event') eventHeader?: string,
  ) {
    const raw = request.rawBody;
    const secret = process.env.OPENWA_WEBHOOK_SECRET;

    if (secret) {
      // Sin el cuerpo crudo la firma no se puede verificar: rechazar en vez de
      // validar contra un cuerpo re-serializado, que nunca coincide.
      if (!raw) {
        this.log.error('Falta rawBody; habilita NestFactory.create(app,{rawBody:true})');
        throw new UnauthorizedException('No fue posible verificar la firma');
      }
      this.verify(raw, signature, secret);
    }

    const envelope = request.body as OpenWaEnvelope;
    if (!envelope?.event || !envelope?.sessionId) {
      throw new BadRequestException('Evento sin `event` o `sessionId`');
    }

    // `idempotencyKey` es estable entre reintentos; `deliveryId` cambia en cada
    // uno y no sirve para deduplicar (`docs/openwa-contract.md`).
    const externalEventId = String(
      idempotencyHeader ?? envelope.idempotencyKey ?? envelope.deliveryId ?? '',
    );
    if (!externalEventId) throw new BadRequestException('Evento sin llave de idempotencia');

    const eventType = String(eventHeader ?? envelope.event);
    const record = await this.record(externalEventId, eventType, envelope, !!secret);
    if (!record) return { accepted: true, duplicate: true };

    try {
      const result = await this.ingest.handle(envelope);
      await this.db.webhookEvent.update({
        where: { id: record.id },
        data: {
          status: result.handled ? 'PROCESSED' : 'REJECTED',
          errorMessage: result.reason?.slice(0, 500),
          processedAt: new Date(),
        },
      });
      return { accepted: true, handled: result.handled };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error desconocido';
      await this.db.webhookEvent.update({
        where: { id: record.id },
        data: { status: 'FAILED', errorMessage: message.slice(0, 500), attempts: { increment: 1 } },
      });
      // Un 5xx hace que OpenWA reintente con la misma `idempotencyKey`.
      throw error;
    }
  }

  private verify(raw: Buffer, received: string | undefined, secret: string) {
    if (!received) throw new UnauthorizedException('Falta la firma');
    // OpenWA envía `sha256=<hex>`, no el hex pelado.
    const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(expected);
    const b = Buffer.from(received);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      this.log.warn('Firma de webhook inválida');
      throw new UnauthorizedException('Firma inválida');
    }
  }

  /**
   * Deja rastro del evento y deduplica en el mismo paso. Devuelve `null`
   * cuando ya se había recibido: el índice único sobre
   * `(provider, externalEventId)` es lo que hace la comprobación atómica.
   */
  private async record(
    externalEventId: string,
    eventType: string,
    envelope: OpenWaEnvelope,
    signatureValid: boolean,
  ) {
    try {
      return await this.db.webhookEvent.create({
        data: {
          provider: 'OPENWA',
          externalEventId,
          eventType,
          signatureValid,
          status: 'RECEIVED',
          // Retención acotada: solo lo necesario para diagnosticar (spec §11.17).
          payload: { sessionId: envelope.sessionId, timestamp: envelope.timestamp ?? null },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }
}
