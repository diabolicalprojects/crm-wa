import { describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PublicPropertyController, nuevaLlaveDeFicha } from './public-property.controller';

/**
 * La ficha pública es el único endpoint sin sesión del sistema. Lo que se
 * publique aquí queda en internet, así que estas pruebas fijan lo que **no**
 * puede salir y quién puede pedirlo.
 */

const LLAVE = 'a'.repeat(32);

const PROPIEDAD = {
  title: 'Casa en Villa Sur',
  description: 'Tres recámaras',
  operationType: 'SALE',
  propertyType: 'HOUSE',
  status: 'AVAILABLE',
  price: '4250000',
  currency: 'MXN',
  addressDisplay: 'Calle Cerezos 45, interior 2',
  neighborhood: 'Villa Sur',
  city: 'Aguascalientes',
  state: 'Aguascalientes',
  showExactAddress: false,
  bedrooms: 3,
  bathrooms: '2',
  halfBathrooms: 1,
  parkingSpaces: 2,
  constructionM2: '180',
  landM2: '200',
  levels: 2,
  yearBuilt: 2019,
  maintenanceFee: '1200',
  legalStatus: 'ESCRITURADO',
  amenities: ['jardín'],
  videoUrl: null,
  tourUrl: null,
  organization: { name: 'Horizonte Aguascalientes' },
  responsibleUser: { name: 'Andrea Ruiz' },
  media: [{ mediaAssetId: 'media-1', altText: null, isCover: true }],
  // Nada de esto puede salir:
  ownerContactId: 'contacto-1',
  ownerContact: { name: 'Sra. Martínez', phone: '4491112233' },
  commissionPercent: '5.00',
  privateNotes: 'Acepta hasta 4.0 M en efectivo',
  organizationId: 'org-1',
  id: 'prop-1',
};

function armar(property: any) {
  const db = {
    property: { findUnique: vi.fn(async () => property) },
    propertyMedia: { findFirst: vi.fn(async () => null) },
  } as any;
  const media = { read: vi.fn() } as any;
  return { db, media, controller: new PublicPropertyController(db, media) };
}

describe('la ficha pública', () => {
  it('publica lo del inmueble y nada del negocio', async () => {
    const { controller } = armar(PROPIEDAD);
    const ficha: any = await controller.one(LLAVE);
    const texto = JSON.stringify(ficha);

    expect(ficha.title).toBe('Casa en Villa Sur');
    expect(ficha.price).toBe(4250000);
    expect(ficha.agencia).toBe('Horizonte Aguascalientes');

    for (const prohibido of ['ownerContact', 'commissionPercent', 'privateNotes', 'organizationId']) {
      expect(texto, prohibido).not.toContain(prohibido);
    }
    expect(texto).not.toContain('Sra. Martínez');
    expect(texto).not.toContain('Acepta hasta');
  });

  /**
   * Publicar la calle exacta de una casa habitada es una decisión de la
   * agencia, no un valor por omisión.
   */
  it('oculta la calle salvo que la agencia lo haya decidido', async () => {
    const { controller } = armar(PROPIEDAD);
    expect((await controller.one(LLAVE) as any).address).toBeNull();

    const { controller: abierto } = armar({ ...PROPIEDAD, showExactAddress: true });
    expect((await abierto.one(LLAVE) as any).address).toBe('Calle Cerezos 45, interior 2');
  });

  it('la colonia y la ciudad sí salen: sin eso la ficha no sirve', async () => {
    const { controller } = armar(PROPIEDAD);
    const ficha: any = await controller.one(LLAVE);
    expect(ficha.neighborhood).toBe('Villa Sur');
    expect(ficha.city).toBe('Aguascalientes');
  });

  it('una llave corta no llega a consultar la base', async () => {
    const { controller, db } = armar(PROPIEDAD);
    await expect(controller.one('abc')).rejects.toThrow(NotFoundException);
    expect(db.property.findUnique).not.toHaveBeenCalled();
  });

  it('una llave que no existe responde lo mismo que una revocada', async () => {
    const { controller } = armar(null);
    await expect(controller.one(LLAVE)).rejects.toThrow('Ficha no disponible');
  });

  /** El enlace sigue circulando por WhatsApp mucho después de la baja. */
  it('un borrador o una propiedad dada de baja dejan de publicarse', async () => {
    for (const status of ['DRAFT', 'INACTIVE']) {
      const { controller } = armar({ ...PROPIEDAD, status });
      await expect(controller.one(LLAVE), status).rejects.toThrow('Ficha no disponible');
    }
  });

  it('la llave es aleatoria y larga, no derivada del identificador', () => {
    const a = nuevaLlaveDeFicha();
    const b = nuevaLlaveDeFicha();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(30);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('las fotos de la ficha pública', () => {
  const res = () => ({ setHeader: vi.fn(), end: vi.fn() }) as any;

  /**
   * Sin atar la foto a la propiedad de esa llave, cualquier enlace válido
   * serviría para leer la multimedia de toda la instalación.
   */
  it('una foto que no es de esa propiedad no se sirve', async () => {
    const { controller, db, media } = armar(PROPIEDAD);
    db.propertyMedia.findFirst.mockResolvedValue(null);

    await expect(controller.foto(LLAVE, 'media-de-otra', res())).rejects.toThrow(
      'Foto no disponible',
    );
    expect(media.read).not.toHaveBeenCalled();
  });

  it('la consulta exige que la foto cuelgue de la propiedad de la llave', async () => {
    const { controller, db, media } = armar(PROPIEDAD);
    db.propertyMedia.findFirst.mockResolvedValue({ property: { organizationId: 'org-1' } });
    media.read.mockResolvedValue({
      bytes: Buffer.from('foto'),
      mimeType: 'image/jpeg',
      safeMimeType: 'image/jpeg',
    });

    await controller.foto(LLAVE, 'media-1', res());

    expect(db.propertyMedia.findFirst.mock.calls[0][0].where.property).toEqual({
      shareToken: LLAVE,
    });
    expect(media.read).toHaveBeenCalledWith('org-1', 'media-1');
  });

  it('nunca sirve algo que no sea inerte', async () => {
    const { controller, db, media } = armar(PROPIEDAD);
    db.propertyMedia.findFirst.mockResolvedValue({ property: { organizationId: 'org-1' } });
    media.read.mockResolvedValue({
      bytes: Buffer.from('<svg onload=alert(1)>'),
      mimeType: 'image/svg+xml',
      safeMimeType: 'application/octet-stream',
    });

    await expect(controller.foto(LLAVE, 'media-1', res())).rejects.toThrow('Foto no disponible');
  });
});
