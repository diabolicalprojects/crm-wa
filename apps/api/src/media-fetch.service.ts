import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MediaStorageService } from './media-storage.service';
import { OpenWaGateway } from './openwa.gateway';
import { PrismaService } from './prisma.service';
import { EventsService } from './events.service';

/**
 * Trae los bytes de la multimedia que el webhook no pudo cargar.
 *
 * El contrato de OpenWA solo incluye el blob en línea hasta 1 MiB
 * (`WEBHOOK_MEDIA_INLINE_MAX_BYTES`); por encima manda un marcador y hay que ir
 * a buscarlo. Una foto de teléfono moderno rebasa ese tope con frecuencia, así
 * que este barrido no es un caso raro: es la ruta normal para la mitad de las
 * imágenes.
 *
 * Por sondeo y no por cola, igual que el de calendario y por la misma razón: la
 * operación es idempotente —o el archivo ya tiene bytes o no— y un reinicio a
 * media descarga se recupera solo en el siguiente barrido.
 */

const INTERVAL_MS = Number(process.env.MEDIA_FETCH_INTERVAL_MS ?? 20_000);
const BATCH = 10;
/** Cuatro intentos y se abandona: hay 404 que no dejan de ser 404. */
const MAX_ATTEMPTS = 4;

@Injectable()
export class MediaFetchService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private corriendo = false;
  private readonly log = new Logger(MediaFetchService.name);

  constructor(
    private db: PrismaService,
    private media: MediaStorageService,
    private openwa: OpenWaGateway,
    private events: EventsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.sweep().catch((error) => this.log.error(`Barrido falló: ${error.message}`));
    }, INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Público para poder dispararlo a mano desde una prueba o la consola. */
  async sweep() {
    // El indicador se levanta antes de cualquier `await`: dos barridos a la vez
    // gastarían el presupuesto de intentos por duplicado sobre los mismos
    // archivos. Es el error exacto que la prueba de concurrencia del
    // sincronizador de calendario encontró en su día.
    if (this.corriendo) return { procesados: 0, omitido: true };
    this.corriendo = true;
    try {
      const pendientes = await this.media.pending(BATCH, MAX_ATTEMPTS);
      let procesados = 0;
      for (const asset of pendientes) {
        if (await this.resolve(asset)) procesados += 1;
      }
      return { procesados, omitido: false };
    } finally {
      this.corriendo = false;
    }
  }

  private async resolve(asset: any) {
    await this.media.countAttempt(asset.id);

    const mensaje = asset.messages?.[0];
    if (!mensaje) {
      // Sin mensaje que lo refiera no hay chat ni id con qué pedirlo. Es
      // basura de una entrega duplicada; no tiene arreglo.
      await this.media.fail(asset.id, 'El archivo no está ligado a ningún mensaje');
      return false;
    }

    const contexto = await this.db.message.findUnique({
      where: { id: mensaje.id },
      select: {
        providerMessageId: true,
        conversationId: true,
        organizationId: true,
        session: { select: { providerSessionId: true } },
        conversation: { select: { lead: { select: { whatsappChatId: true, phone: true } } } },
      },
    });

    const providerSessionId = contexto?.session?.providerSessionId;
    const chatId = contexto?.conversation?.lead?.whatsappChatId;
    const providerMessageId = contexto?.providerMessageId;

    if (!providerSessionId || !chatId || !providerMessageId) {
      await this.media.fail(asset.id, 'Falta el canal, el chat o el id del mensaje');
      return false;
    }

    try {
      const { bytes, mimeType } = await this.openwa.fetchMedia({
        providerSessionId,
        chatId,
        providerMessageId,
      });
      // La pasarela sirve los tipos no inertes como `application/octet-stream`,
      // así que el mimetype que declaró el webhook es mejor dato que el
      // encabezado de la descarga; solo se usa este cuando aquel no existe.
      const tipo =
        asset.mimeType && asset.mimeType !== 'application/octet-stream'
          ? asset.mimeType
          : mimeType;
      await this.media.fulfill(asset.id, bytes, tipo);

      this.events.publish(contexto.organizationId, {
        type: 'message.updated',
        conversationId: contexto.conversationId,
      });
      return true;
    } catch (error) {
      const motivo = error instanceof Error ? error.message : 'Error desconocido';
      // Solo se abandona al agotar los intentos: un 503 pasajero de la pasarela
      // no debe costar la foto para siempre.
      if (asset.attempts + 1 >= MAX_ATTEMPTS) {
        await this.media.fail(asset.id, motivo);
      } else {
        this.log.warn(`Archivo ${asset.id}: ${motivo} (intento ${asset.attempts + 1})`);
      }
      return false;
    }
  }
}
