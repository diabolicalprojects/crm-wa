import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { MediaSource, MediaStatus } from '@prisma/client';
import { PrismaService } from './prisma.service';

/**
 * Guarda y devuelve los bytes de la multimedia.
 *
 * El backend actual es PostgreSQL (`MediaBlob`). La decisión está razonada en
 * el esquema; lo que importa aquí es que **nadie fuera de esta clase sabe dónde
 * están los bytes**: `storageKey` lleva el prefijo del backend y el resto del
 * CRM solo maneja identificadores de `MediaAsset`. Cambiar a S3 es implementar
 * `put`/`get` de otra forma.
 */

/** Tope por archivo. WhatsApp no entrega más de 16 MB y la base no es un CDN. */
const MAX_BYTES = Number(process.env.MEDIA_MAX_BYTES ?? 16 * 1024 * 1024);

/**
 * Lo que el navegador puede recibir con su tipo real. Todo lo demás se sirve
 * como descarga opaca: un `image/svg+xml` servido con su mimetype es un vector
 * de scripting en el origen de la API.
 */
const INERT_MIME = /^(image\/(jpeg|png|gif|webp|bmp)|video\/(mp4|webm|quicktime)|audio\/(mpeg|mp4|ogg|wav|webm|aac))(;|$)/i;

/** Prisma tipa `Bytes` como `Uint8Array<ArrayBuffer>`, que no admite un Buffer. */
const toBytes = (buffer: Buffer): Uint8Array<ArrayBuffer> =>
  new Uint8Array(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer);

export interface StoredMedia {
  bytes: Buffer;
  mimeType: string;
  filename?: string;
  /** Tipo con el que es seguro servirlo, que no siempre es el declarado. */
  safeMimeType: string;
}

@Injectable()
export class MediaStorageService {
  private readonly log = new Logger(MediaStorageService.name);

  constructor(private db: PrismaService) {}

  /** El tipo declarado solo se respeta cuando es inerte (ver `INERT_MIME`). */
  static safeMimeType(mimeType: string) {
    return INERT_MIME.test(mimeType) ? mimeType : 'application/octet-stream';
  }

  /**
   * Registra un archivo con sus bytes. Deduplica por SHA-256 dentro de la
   * agencia: el mismo catálogo reenviado veinte veces ocupa una sola copia, y
   * nunca cruza agencias aunque el archivo sea idéntico.
   */
  async store(input: {
    organizationId: string;
    bytes: Buffer;
    mimeType: string;
    filename?: string;
    source?: MediaSource;
  }) {
    if (!input.bytes.length) throw new BadRequestException('El archivo está vacío');
    if (input.bytes.length > MAX_BYTES) {
      throw new BadRequestException(
        `El archivo pesa ${Math.round(input.bytes.length / 1024)} KB y el máximo son ${Math.round(MAX_BYTES / 1024)} KB`,
      );
    }

    const sha256 = createHash('sha256').update(input.bytes).digest('hex');
    const existing = await this.db.mediaAsset.findFirst({
      where: { organizationId: input.organizationId, sha256, status: MediaStatus.STORED },
    });
    if (existing) return existing;

    const asset = await this.db.mediaAsset.create({
      data: {
        organizationId: input.organizationId,
        storageKey: '',
        mimeType: input.mimeType || 'application/octet-stream',
        sizeBytes: input.bytes.length,
        sha256,
        originalFilename: input.filename?.slice(0, 255),
        source: input.source ?? MediaSource.UPLOAD,
        status: MediaStatus.STORED,
        blob: { create: { bytes: toBytes(input.bytes) } },
      },
    });
    return this.db.mediaAsset.update({
      where: { id: asset.id },
      data: { storageKey: `db:${asset.id}` },
    });
  }

  /**
   * Reserva el registro de un archivo cuyos bytes todavía no tenemos: el
   * proveedor omite del webhook todo blob mayor a 1 MiB. Sin esto, un asesor
   * vería una conversación donde el prospecto «no dijo nada» cuando en realidad
   * mandó una foto.
   */
  async reserve(input: {
    organizationId: string;
    mimeType?: string;
    filename?: string;
    sizeBytes?: number;
  }) {
    return this.db.mediaAsset.create({
      data: {
        organizationId: input.organizationId,
        storageKey: '',
        mimeType: input.mimeType || 'application/octet-stream',
        sizeBytes: Math.max(0, Math.trunc(input.sizeBytes ?? 0)),
        originalFilename: input.filename?.slice(0, 255),
        source: MediaSource.WHATSAPP,
        status: MediaStatus.PENDING,
      },
    });
  }

  /** Completa una reserva con los bytes que llegaron después. */
  async fulfill(assetId: string, bytes: Buffer, mimeType?: string) {
    if (bytes.length > MAX_BYTES) {
      return this.fail(assetId, `Pesa ${bytes.length} bytes y el máximo son ${MAX_BYTES}`);
    }
    await this.db.mediaAsset.update({
      where: { id: assetId },
      data: {
        storageKey: `db:${assetId}`,
        mimeType: mimeType || undefined,
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        status: MediaStatus.STORED,
        failureReason: null,
        blob: { upsert: { create: { bytes: toBytes(bytes) }, update: { bytes: toBytes(bytes) } } },
      },
    });
    return true;
  }

  /**
   * Deja constancia de por qué no se pudo traer. Un `PENDING` eterno y un
   * archivo que el proveedor nunca va a entregar se ven igual en una tabla;
   * en una conversación no lo son.
   */
  async fail(assetId: string, reason: string) {
    await this.db.mediaAsset.update({
      where: { id: assetId },
      data: { status: MediaStatus.FAILED, failureReason: reason.slice(0, 300) },
    });
    return false;
  }

  /** Lee un archivo, siempre acotado a la agencia que lo pide. */
  async read(organizationId: string, assetId: string): Promise<StoredMedia> {
    const asset = await this.db.mediaAsset.findFirst({
      where: { id: assetId, organizationId },
      include: { blob: true },
    });
    if (!asset || !asset.blob) throw new NotFoundException('Archivo no encontrado');
    return {
      bytes: Buffer.from(asset.blob.bytes),
      mimeType: asset.mimeType,
      filename: asset.originalFilename ?? undefined,
      safeMimeType: MediaStorageService.safeMimeType(asset.mimeType),
    };
  }

  /** Los pendientes que todavía vale la pena reintentar. */
  async pending(limit = 20, maxAttempts = 4) {
    return this.db.mediaAsset.findMany({
      where: { status: MediaStatus.PENDING, attempts: { lt: maxAttempts } },
      orderBy: { createdAt: 'asc' },
      take: limit,
      include: { messages: { take: 1, orderBy: { createdAt: 'asc' } } },
    });
  }

  async countAttempt(assetId: string) {
    await this.db.mediaAsset.update({
      where: { id: assetId },
      data: { attempts: { increment: 1 } },
    });
  }
}
