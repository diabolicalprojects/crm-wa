import { describe, expect, it, vi } from 'vitest';
import { AiToolsService } from './ai-tools.service';
import { publicar } from './properties.controller';

/**
 * Tres campos de la ficha no son del prospecto ni de cualquiera del equipo:
 * quién es el dueño del inmueble, cuánto cobra la agencia, y lo que el equipo
 * anotó y al cliente no se le dice.
 *
 * Son los tres que responden a «el asesor que se va y se lleva la cartera», y
 * el modo de fallar es siempre el mismo: alguien agrega una columna, propaga el
 * registro con `...property`, y el dato sale sin que nadie lo note. Estas
 * pruebas existen para que ese día falle la corrida y no la agencia.
 */

const PRIVADOS = ['ownerContact', 'ownerContactId', 'commissionPercent', 'privateNotes'];

const PROPIEDAD = {
  id: 'prop-1',
  title: 'Casa en Villa Sur',
  description: 'Tres recámaras, jardín',
  operationType: 'SALE',
  propertyType: 'HOUSE',
  status: 'AVAILABLE',
  price: '4250000',
  currency: 'MXN',
  city: 'Aguascalientes',
  neighborhood: 'Villa Sur',
  addressDisplay: 'Villa Sur 123',
  bedrooms: 3,
  bathrooms: '2',
  halfBathrooms: 1,
  levels: 2,
  yearBuilt: 2019,
  maintenanceFee: '1200',
  legalStatus: 'ESCRITURADO',
  parkingSpaces: 2,
  constructionM2: '180',
  landM2: '200',
  amenities: ['jardín'],
  publicUrl: 'https://ejemplo.mx/villa-sur',
  videoUrl: 'https://ejemplo.mx/video',
  tourUrl: null,
  availableFrom: null,
  // Lo que nunca debe salir:
  ownerContactId: 'contacto-1',
  ownerContact: { id: 'contacto-1', name: 'Sra. Martínez', phone: '4491112233' },
  commissionPercent: '5.00',
  privateNotes: 'La dueña acepta hasta 4.0 M si el cierre es en efectivo',
  responsibleUserId: 'u-ana',
  sharedCommission: '2.50',
};

describe('lo que ve el agente de IA', () => {
  const tools = () =>
    new AiToolsService(
      {
        property: {
          findFirst: vi.fn(async () => PROPIEDAD),
          findMany: vi.fn(async () => [PROPIEDAD]),
        },
        leadPropertyMatch: { createMany: vi.fn() },
      } as any,
    );

  const contexto = {
    organizationId: 'org-1',
    leadId: 'lead-1',
    conversationId: 'conv-1',
    agentId: 'ag-1',
    maxRecommendations: 3,
  } as any;

  it('la ficha completa no lleva al dueño, la comisión ni las notas internas', async () => {
    const salida = await tools().execute(contexto, {
      id: 'c1',
      name: 'getPropertyDetails',
      input: { propertyId: 'prop-1' },
    } as any);

    // Sin esto, la prueba pasaría también sobre un mensaje de error, que es
    // exactamente lo que ocurrió la primera vez que la escribí.
    expect(() => JSON.parse(salida.result)).not.toThrow();

    for (const campo of PRIVADOS) {
      expect(salida.result, campo).not.toContain(campo);
    }
    expect(salida.result).not.toContain('Sra. Martínez');
    expect(salida.result).not.toContain('4491112233');
    expect(salida.result).not.toContain('acepta hasta 4.0 M');
  });

  it('pero sí lleva lo que el prospecto pregunta', async () => {
    const salida = await tools().execute(contexto, {
      id: 'c1',
      name: 'getPropertyDetails',
      input: { propertyId: 'prop-1' },
    } as any);

    const ficha = JSON.parse(salida.result);
    expect(ficha.price).toBe(4250000);
    expect(ficha.halfBathrooms).toBe(1);
    expect(ficha.legalStatus).toBe('ESCRITURADO');
    expect(ficha.maintenanceFee).toBe(1200);
    expect(ficha.videoUrl).toBe('https://ejemplo.mx/video');
  });

  it('los resultados de búsqueda tampoco los llevan', async () => {
    const salida = await tools().execute(contexto, {
      id: 'c2',
      name: 'searchProperties',
      input: { operationType: 'SALE' },
    } as any);

    expect(() => JSON.parse(salida.result)).not.toThrow();
    expect(JSON.parse(salida.result).found).toBe(1);

    for (const campo of PRIVADOS) {
      expect(salida.result, campo).not.toContain(campo);
    }
    expect(salida.result).not.toContain('Sra. Martínez');
  });
});

describe('lo que ve la consola', () => {
  it('sin permiso, la respuesta llega sin el dueño ni la comisión', () => {
    const visto: any = publicar({ ...PROPIEDAD }, new Set());

    expect(visto.title).toBe('Casa en Villa Sur');
    expect(visto.sharedCommission).toBe('2.50');
    for (const campo of PRIVADOS) {
      expect(visto, campo).not.toHaveProperty(campo);
    }
  });

  /**
   * La comisión compartida sí se ve sin permiso: es lo que se le ofrece a quien
   * traiga al comprador, y ocultarla haría inútil la colaboración. La privada
   * —lo que cobra la agencia— es otra cosa.
   */
  it('la comisión compartida no es la privada y no se oculta', () => {
    const visto: any = publicar({ ...PROPIEDAD }, new Set());
    expect(visto).toHaveProperty('sharedCommission');
    expect(visto).not.toHaveProperty('commissionPercent');
  });

  it('con permiso llega completa', () => {
    const visto: any = publicar({ ...PROPIEDAD }, new Set(['inventario.verPropietarios']));
    expect(visto.ownerContact.name).toBe('Sra. Martínez');
    expect(visto.commissionPercent).toBe('5.00');
    expect(visto.privateNotes).toContain('acepta hasta');
  });

  it('recortar no pierde nada de lo operativo', () => {
    const visto: any = publicar({ ...PROPIEDAD }, new Set());
    for (const campo of ['id', 'title', 'price', 'city', 'legalStatus', 'responsibleUserId']) {
      expect(visto, campo).toHaveProperty(campo);
    }
  });
});
