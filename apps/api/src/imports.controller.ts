import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { OperationType, Prisma, PropertyType } from '@prisma/client';
import { parse } from 'csv-parse/sync';
import { Roles } from './auth';
import { PrismaService } from './prisma.service';
import { TenantId } from './tenant';

/**
 * Importación manual de inventario. El mismo normalizador atiende CSV y Excel:
 * las fuentes automáticas (API, XML/JSON, Google Sheets) reutilizan
 * `normalizeRow` para que todo entre por el mismo `upsert` (spec §14.4).
 */

const MAX_BYTES = 5_000_000;

/** Sinónimos aceptados por columna, en español e inglés. */
const COLUMNS: Record<string, string[]> = {
  externalReference: ['externalreference', 'externalid', 'id', 'referencia', 'clave'],
  title: ['title', 'titulo', 'título', 'nombre'],
  description: ['description', 'descripcion', 'descripción'],
  operationType: ['operationtype', 'operacion', 'operación', 'tipooperacion'],
  propertyType: ['propertytype', 'tipo', 'tipopropiedad'],
  price: ['price', 'precio'],
  currency: ['currency', 'moneda'],
  country: ['country', 'pais', 'país'],
  state: ['state', 'estado'],
  // `location` y `aream2` son los nombres del esquema anterior. Se aceptan
  // para que un archivo exportado antes del cambio no se importe a medias.
  city: ['city', 'ciudad', 'location', 'ubicacion', 'ubicación'],
  neighborhood: ['neighborhood', 'colonia', 'barrio'],
  addressDisplay: ['address', 'addressdisplay', 'direccion', 'dirección'],
  bedrooms: ['bedrooms', 'recamaras', 'recámaras', 'habitaciones', 'dormitorios'],
  bathrooms: ['bathrooms', 'banos', 'baños'],
  parkingSpaces: ['parkingspaces', 'estacionamientos', 'cocheras'],
  constructionM2: ['constructionm2', 'construccion', 'construcción', 'm2construccion', 'aream2', 'areaconstruida'],
  landM2: ['landm2', 'terreno', 'm2terreno', 'superficie'],
  amenities: ['amenities', 'amenidades', 'caracteristicas', 'características'],
  publicUrl: ['publicurl', 'url', 'enlace', 'liga'],
};

const OPERATION_ALIASES: Record<string, OperationType> = {
  sale: 'SALE', venta: 'SALE', vender: 'SALE', compra: 'SALE',
  rent: 'RENT', renta: 'RENT', rentar: 'RENT', alquiler: 'RENT',
};

const TYPE_ALIASES: Record<string, PropertyType> = {
  house: 'HOUSE', casa: 'HOUSE',
  apartment: 'APARTMENT', departamento: 'APARTMENT', depa: 'APARTMENT', depto: 'APARTMENT',
  land: 'LAND', terreno: 'LAND', lote: 'LAND',
  commercial: 'COMMERCIAL', comercial: 'COMMERCIAL', local: 'COMMERCIAL',
  office: 'OFFICE', oficina: 'OFFICE',
  other: 'OTHER', otro: 'OTHER',
};

export interface NormalizedRow {
  data: Prisma.PropertyUncheckedCreateInput;
  error?: string;
}

function pick(row: Record<string, unknown>, field: string): string | undefined {
  const keys = COLUMNS[field] ?? [field.toLowerCase()];
  for (const [rawKey, value] of Object.entries(row)) {
    const key = rawKey.toLowerCase().replace(/[\s_-]/g, '');
    if (keys.includes(key) && value != null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return undefined;
}

function toNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  // Tolera "1,250,000" y "$2 500 000".
  const parsed = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeRow(
  organizationId: string,
  row: Record<string, unknown>,
): NormalizedRow {
  const title = pick(row, 'title');
  const price = toNumber(pick(row, 'price'));
  const operation = OPERATION_ALIASES[(pick(row, 'operationType') ?? '').toLowerCase()];
  const propertyType = TYPE_ALIASES[(pick(row, 'propertyType') ?? '').toLowerCase()];

  if (!title) return { data: {} as never, error: 'falta el título' };
  if (price === undefined) return { data: {} as never, error: 'precio inválido o ausente' };
  if (!operation) return { data: {} as never, error: 'operación debe ser venta o renta' };
  if (!propertyType) return { data: {} as never, error: 'tipo de propiedad no reconocido' };

  const amenities = (pick(row, 'amenities') ?? '')
    .split(/[|,;]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    data: {
      organizationId,
      externalReference: pick(row, 'externalReference'),
      title,
      description: pick(row, 'description'),
      operationType: operation,
      propertyType,
      price,
      currency: (pick(row, 'currency') ?? 'MXN').toUpperCase().slice(0, 3),
      country: pick(row, 'country') ?? 'México',
      state: pick(row, 'state'),
      city: pick(row, 'city'),
      neighborhood: pick(row, 'neighborhood'),
      addressDisplay: pick(row, 'addressDisplay'),
      bedrooms: toNumber(pick(row, 'bedrooms')),
      bathrooms: toNumber(pick(row, 'bathrooms')),
      parkingSpaces: toNumber(pick(row, 'parkingSpaces')),
      constructionM2: toNumber(pick(row, 'constructionM2')),
      landM2: toNumber(pick(row, 'landM2')),
      amenities,
      publicUrl: pick(row, 'publicUrl'),
    },
  };
}

@Controller('imports')
export class ImportsController {
  constructor(private db: PrismaService) {}

  @Post('properties')
  @Roles('OWNER', 'ADMIN', 'SUPERVISOR')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async properties(
    @TenantId() organizationId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Envía un archivo CSV o Excel');

    const rows = await this.readRows(file);
    if (!rows.length) throw new BadRequestException('El archivo no tiene filas');

    let created = 0;
    let updated = 0;
    const errors: string[] = [];

    for (const [index, row] of rows.entries()) {
      const { data, error } = normalizeRow(organizationId, row);
      if (error) {
        errors.push(`Fila ${index + 2}: ${error}`);
        continue;
      }
      try {
        // Reimportar el mismo archivo actualiza en vez de duplicar.
        if (data.externalReference) {
          const existing = await this.db.property.findFirst({
            where: {
              organizationId,
              externalReference: data.externalReference,
              propertySourceId: null,
            },
            select: { id: true },
          });
          if (existing) {
            await this.db.property.update({ where: { id: existing.id }, data });
            updated++;
            continue;
          }
        }
        await this.db.property.create({ data });
        created++;
      } catch (problem) {
        errors.push(`Fila ${index + 2}: ${problem instanceof Error ? problem.message : 'error'}`);
      }
    }

    return { created, updated, failed: errors.length, errors: errors.slice(0, 50) };
  }

  private async readRows(file: Express.Multer.File): Promise<Record<string, unknown>[]> {
    const name = (file.originalname ?? '').toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) return this.readExcel(file.buffer);
    try {
      return parse(file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
      }) as Record<string, unknown>[];
    } catch (error) {
      throw new BadRequestException(
        `No fue posible leer el CSV: ${error instanceof Error ? error.message : 'formato inválido'}`,
      );
    }
  }

  private async readExcel(buffer: Buffer): Promise<Record<string, unknown>[]> {
    // Carga diferida: solo las agencias que suben Excel pagan el costo.
    const ExcelJS = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('El archivo no tiene hojas');

    const headers: string[] = [];
    sheet.getRow(1).eachCell((cell, column) => {
      headers[column] = String(cell.value ?? '').trim();
    });

    const rows: Record<string, unknown>[] = [];
    sheet.eachRow((row, index) => {
      if (index === 1) return;
      const entry: Record<string, unknown> = {};
      row.eachCell((cell, column) => {
        const header = headers[column];
        if (header) entry[header] = cell.value;
      });
      if (Object.keys(entry).length) rows.push(entry);
    });
    return rows;
  }
}
