import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { normalizeRow } from './imports.controller';

/**
 * El inventario de demostración se importa en cada montaje de la demo, así que
 * un cambio en el normalizador que lo rompa debe fallar aquí y no delante de
 * un cliente.
 */
const CSV = join(__dirname, '../../../scripts/seed/inventario-demo.csv');

describe('inventario de demostración', () => {
  const rows = parse(readFileSync(CSV), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  }) as Record<string, string>[];

  it('trae al menos 20 propiedades', () => {
    expect(rows.length).toBeGreaterThanOrEqual(20);
  });

  it('todas las filas se normalizan sin error', () => {
    const failures = rows
      .map((row, index) => ({ index, ...normalizeRow('org-demo', row) }))
      .filter((result) => result.error)
      .map((result) => `fila ${result.index + 2}: ${result.error}`);
    expect(failures).toEqual([]);
  });

  it('cubre ambas operaciones y los seis tipos de propiedad', () => {
    const parsed = rows.map((row) => normalizeRow('org-demo', row).data);
    const operations = new Set(parsed.map((property) => property.operationType));
    const types = new Set(parsed.map((property) => property.propertyType));

    expect(operations).toEqual(new Set(['SALE', 'RENT']));
    expect(types).toEqual(new Set(['HOUSE', 'APARTMENT', 'LAND', 'COMMERCIAL', 'OFFICE', 'OTHER']));
  });

  it('convierte precios, medidas y amenidades a los tipos correctos', () => {
    const first = normalizeRow('org-demo', rows[0]).data;
    expect(typeof first.price).toBe('number');
    expect(first.price).toBeGreaterThan(0);
    expect(Array.isArray(first.amenities)).toBe(true);
    expect((first.amenities as string[]).length).toBeGreaterThan(0);
    expect(first.city).toBeTruthy();
    expect(first.externalReference).toMatch(/^HZ-\d{3}$/);
  });

  it('acepta los encabezados del esquema anterior', () => {
    const legacy = normalizeRow('org-demo', {
      titulo: 'Casa heredada',
      operacion: 'SALE',
      tipo: 'HOUSE',
      precio: '1000000',
      location: 'Aguascalientes',
      areaM2: '120',
      url: 'https://example.com/x',
    });
    expect(legacy.error).toBeUndefined();
    expect(legacy.data).toMatchObject({
      city: 'Aguascalientes',
      constructionM2: 120,
      publicUrl: 'https://example.com/x',
    });
  });
});
