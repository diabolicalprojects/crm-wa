import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { randomBytes } from 'node:crypto';
import { Public } from './auth';
import { MediaStorageService } from './media-storage.service';
import { PrismaService } from './prisma.service';

/**
 * La ficha pública de una propiedad (§14.6, montón A7).
 *
 * Es lo que el asesor manda por WhatsApp a su cliente, así que vive detrás de
 * un enlace sin sesión. Eso la convierte en la superficie más expuesta del
 * sistema, y por eso está en su propio archivo con tres reglas explícitas:
 *
 * 1. **Lista blanca, nunca recorte.** Se arma campo por campo. Un `...property`
 *    publicaría al dueño y la comisión en cuanto alguien agregue una columna, y
 *    aquí eso es publicarlo en internet.
 * 2. **La llave no dice nada.** Es aleatoria y no deriva del identificador, así
 *    que tener un enlace no permite adivinar los demás.
 * 3. **La dirección exacta solo si la agencia lo decidió**, propiedad por
 *    propiedad. La colonia siempre; la calle solo con `showExactAddress`.
 *
 * Un enlace se revoca borrando la llave, y desde ese momento responde 404.
 */

export function nuevaLlaveDeFicha() {
  return randomBytes(24).toString('base64url');
}

@Controller('public/properties')
export class PublicPropertyController {
  constructor(
    private db: PrismaService,
    private media: MediaStorageService,
  ) {}

  @Public()
  @Get(':token')
  async one(@Param('token') token: string) {
    // Una llave demasiado corta no puede ser nuestra: se corta antes de
    // consultar, para no convertir el endpoint en un oráculo barato.
    if (!token || token.length < 20) throw new NotFoundException('Ficha no disponible');

    const property = await this.db.property.findUnique({
      where: { shareToken: token },
      include: {
        organization: { select: { name: true } },
        responsibleUser: { select: { name: true } },
        media: {
          where: { mediaAsset: { status: 'STORED' } },
          orderBy: { position: 'asc' },
          take: 12,
          select: { mediaAssetId: true, altText: true, isCover: true },
        },
      },
    });

    // Una propiedad archivada o vendida deja de publicarse aunque el enlace
    // siga circulando por WhatsApp, que es donde estos enlaces viven.
    if (!property || property.status === 'INACTIVE' || property.status === 'DRAFT') {
      throw new NotFoundException('Ficha no disponible');
    }

    return {
      title: property.title,
      description: property.description,
      operationType: property.operationType,
      propertyType: property.propertyType,
      status: property.status,
      price: Number(property.price),
      currency: property.currency,
      // La calle solo si la agencia lo decidió para esta propiedad.
      address: property.showExactAddress ? property.addressDisplay : null,
      neighborhood: property.neighborhood,
      city: property.city,
      state: property.state,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms ? Number(property.bathrooms) : null,
      halfBathrooms: property.halfBathrooms,
      parkingSpaces: property.parkingSpaces,
      constructionM2: property.constructionM2 ? Number(property.constructionM2) : null,
      landM2: property.landM2 ? Number(property.landM2) : null,
      levels: property.levels,
      yearBuilt: property.yearBuilt,
      maintenanceFee: property.maintenanceFee ? Number(property.maintenanceFee) : null,
      legalStatus: property.legalStatus,
      amenities: property.amenities,
      videoUrl: property.videoUrl,
      tourUrl: property.tourUrl,
      agencia: property.organization.name,
      asesor: property.responsibleUser?.name ?? null,
      fotos: property.media.map((m) => m.mediaAssetId),
    };
  }

  /**
   * Las fotos de una ficha pública. Van por su propia ruta y no por la de la
   * consola porque aquella exige sesión y agencia; aquí la autorización es
   * haber presentado una llave válida de *esa* propiedad.
   */
  @Public()
  @Get(':token/foto/:mediaId')
  async foto(
    @Param('token') token: string,
    @Param('mediaId') mediaId: string,
    @Res() res: Response,
  ) {
    if (!token || token.length < 20) throw new NotFoundException('Foto no disponible');

    const vinculo = await this.db.propertyMedia.findFirst({
      where: {
        mediaAssetId: mediaId,
        // La foto tiene que pertenecer a la propiedad de *esa* llave. Sin esta
        // condición, cualquier enlace válido serviría para leer la multimedia
        // de toda la instalación, incluida la de otras agencias.
        property: { shareToken: token },
      },
      select: { property: { select: { organizationId: true } } },
    });
    if (!vinculo) throw new NotFoundException('Foto no disponible');

    const archivo = await this.media.read(vinculo.property.organizationId, mediaId);
    // Solo tipos inertes: una página pública no sirve nada ejecutable.
    if (archivo.safeMimeType === 'application/octet-stream') {
      throw new NotFoundException('Foto no disponible');
    }
    res.setHeader('Content-Type', archivo.safeMimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.end(archivo.bytes);
  }
}
