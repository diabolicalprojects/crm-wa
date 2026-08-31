import { Injectable, Logger } from '@nestjs/common';
import { OperationType, Prisma, PropertyType } from '@prisma/client';
import { AiToolCall, AiToolDefinition } from './ai-gateway';
import { PrismaService } from './prisma.service';

/**
 * Las seis herramientas mínimas del agente inmobiliario (spec §13.3).
 *
 * Regla que gobierna todo este archivo: **el tenant y las identidades nunca
 * vienen del modelo.** `organizationId`, `leadId` y `conversationId` se
 * resuelven desde el contexto del worker; el LLM solo aporta criterios de
 * búsqueda y datos de negocio, que además se validan aquí (spec §13.3 y §17.5).
 */

export interface ToolContext {
  organizationId: string;
  leadId: string;
  conversationId: string;
  agentId?: string | null;
  maxRecommendations: number;
}

export interface ToolOutcome {
  /** Texto que se devuelve al modelo como resultado de la herramienta. */
  result: string;
  /** Señala al worker que debe transferir a un humano. */
  handoff?: { reason: string; priority: string };
  /** IDs recomendados en esta ejecución, para registrar el match. */
  recommendedPropertyIds?: string[];
}

const OPERATION_TYPES = Object.values(OperationType);
const PROPERTY_TYPES = Object.values(PropertyType);

export const AI_TOOL_DEFINITIONS: AiToolDefinition[] = [
  {
    name: 'searchProperties',
    description:
      'Busca propiedades disponibles en el inventario real de la agencia. Úsala siempre antes de mencionar cualquier propiedad, precio o característica. Devuelve solo propiedades existentes y disponibles.',
    parameters: {
      type: 'object',
      properties: {
        operationType: { type: 'string', enum: OPERATION_TYPES, description: 'SALE para venta, RENT para renta' },
        propertyTypes: { type: 'array', items: { type: 'string', enum: PROPERTY_TYPES } },
        locations: {
          type: 'array',
          items: { type: 'string' },
          description: 'Ciudades o colonias mencionadas por el prospecto',
        },
        minPrice: { type: 'number', minimum: 0 },
        maxPrice: { type: 'number', minimum: 0 },
        bedroomsMin: { type: 'integer', minimum: 0 },
        bathroomsMin: { type: 'number', minimum: 0 },
        amenities: { type: 'array', items: { type: 'string' } },
        limit: { type: 'integer', minimum: 1, maximum: 10 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'getPropertyDetails',
    description:
      'Obtiene la ficha completa de una propiedad por su ID interno. Usa únicamente IDs devueltos por searchProperties.',
    parameters: {
      type: 'object',
      properties: { propertyId: { type: 'string' } },
      required: ['propertyId'],
      additionalProperties: false,
    },
  },
  {
    name: 'updateLeadPreferences',
    description:
      'Guarda los criterios de búsqueda que el prospecto expresó o confirmó. No infieras datos que no dijo, y nunca registres capacidad crediticia o ingresos sin fundamento.',
    parameters: {
      type: 'object',
      properties: {
        operationType: { type: 'string', enum: OPERATION_TYPES },
        propertyTypes: { type: 'array', items: { type: 'string', enum: PROPERTY_TYPES } },
        budgetMin: { type: 'number', minimum: 0 },
        budgetMax: { type: 'number', minimum: 0 },
        currency: { type: 'string' },
        locations: { type: 'array', items: { type: 'string' } },
        bedroomsMin: { type: 'integer', minimum: 0 },
        bathroomsMin: { type: 'number', minimum: 0 },
        parkingSpacesMin: { type: 'integer', minimum: 0 },
        mustHaveAmenities: { type: 'array', items: { type: 'string' } },
        moveInTimeframe: { type: 'string' },
        financingNeeded: { type: 'boolean' },
        visitIntent: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'qualifyLead',
    description:
      'Actualiza la calificación del prospecto con criterios visibles para el negocio.',
    parameters: {
      type: 'object',
      properties: {
        score: { type: 'integer', minimum: 0, maximum: 100 },
        reasons: { type: 'array', items: { type: 'string' } },
        stage: {
          type: 'string',
          enum: ['NEW', 'CONTACTED', 'QUALIFYING', 'QUALIFIED', 'VISIT_SCHEDULED'],
        },
      },
      required: ['score'],
      additionalProperties: false,
    },
  },
  {
    name: 'requestPropertyVisit',
    description:
      'Registra una SOLICITUD de visita. No confirma la cita: un asesor debe aprobarla. Nunca digas al prospecto que la visita quedó confirmada.',
    parameters: {
      type: 'object',
      properties: {
        propertyId: { type: 'string' },
        preferredDate: { type: 'string', description: 'Fecha ISO, por ejemplo 2026-09-15' },
        preferredTime: { type: 'string', description: 'Hora en formato 24h, por ejemplo 17:30' },
        notes: { type: 'string' },
      },
      required: ['preferredDate'],
      additionalProperties: false,
    },
  },
  {
    name: 'handoffToHuman',
    description:
      'Transfiere la conversación a un asesor humano. Úsala si el prospecto lo pide, si hay negociación de precio, una consulta legal, fiscal o crediticia, un conflicto, o si no puedes resolver con las herramientas disponibles.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
        priority: { type: 'string', enum: ['LOW', 'NORMAL', 'HIGH'] },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
];

@Injectable()
export class AiToolsService {
  private readonly log = new Logger(AiToolsService.name);

  constructor(private db: PrismaService) {}

  definitions(): AiToolDefinition[] {
    return AI_TOOL_DEFINITIONS;
  }

  async execute(context: ToolContext, call: AiToolCall): Promise<ToolOutcome> {
    try {
      switch (call.name) {
        case 'searchProperties':
          return await this.searchProperties(context, call.input);
        case 'getPropertyDetails':
          return await this.getPropertyDetails(context, call.input);
        case 'updateLeadPreferences':
          return await this.updateLeadPreferences(context, call.input);
        case 'qualifyLead':
          return await this.qualifyLead(context, call.input);
        case 'requestPropertyVisit':
          return await this.requestPropertyVisit(context, call.input);
        case 'handoffToHuman':
          return this.handoffToHuman(call.input);
        default:
          return { result: `Herramienta desconocida: ${call.name}` };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'error desconocido';
      this.log.error(`Herramienta ${call.name} falló: ${message}`);
      // El modelo debe poder recuperarse; nunca se le devuelve una traza.
      return { result: `No fue posible ejecutar ${call.name}. Continúa sin ese dato.` };
    }
  }

  // -------------------------------------------------------------------------

  /**
   * SQL primero (spec §13.4): filtros exactos obligatorios, después puntuación.
   * Sin base vectorial: para la demo los filtros estructurados mandan.
   */
  private async searchProperties(context: ToolContext, input: any): Promise<ToolOutcome> {
    const limit = Math.min(Number(input.limit) || context.maxRecommendations, 10);
    const locations: string[] = Array.isArray(input.locations) ? input.locations.filter(Boolean) : [];

    const where: Prisma.PropertyWhereInput = {
      organizationId: context.organizationId,
      status: 'AVAILABLE',
      ...(this.isOperation(input.operationType) ? { operationType: input.operationType } : {}),
      ...(Array.isArray(input.propertyTypes) && input.propertyTypes.length
        ? { propertyType: { in: input.propertyTypes.filter(this.isPropertyType) } }
        : {}),
      ...(Number.isFinite(Number(input.minPrice)) || Number.isFinite(Number(input.maxPrice))
        ? {
            price: {
              ...(Number.isFinite(Number(input.minPrice)) ? { gte: Number(input.minPrice) } : {}),
              ...(Number.isFinite(Number(input.maxPrice)) ? { lte: Number(input.maxPrice) } : {}),
            },
          }
        : {}),
      ...(Number.isFinite(Number(input.bedroomsMin)) ? { bedrooms: { gte: Number(input.bedroomsMin) } } : {}),
      ...(Number.isFinite(Number(input.bathroomsMin)) ? { bathrooms: { gte: Number(input.bathroomsMin) } } : {}),
      ...(locations.length
        ? {
            OR: locations.flatMap((place) => [
              { city: { contains: place, mode: 'insensitive' as const } },
              { neighborhood: { contains: place, mode: 'insensitive' as const } },
              { state: { contains: place, mode: 'insensitive' as const } },
            ]),
          }
        : {}),
    };

    const candidates = await this.db.property.findMany({ where, take: 40 });
    if (!candidates.length) {
      return {
        result:
          'Sin coincidencias con esos criterios. Dile al prospecto que no hay opciones exactas y pregúntale qué criterio puede flexibilizar (presupuesto, zona o características). No inventes alternativas.',
      };
    }

    const wanted: string[] = Array.isArray(input.amenities) ? input.amenities : [];
    const scored = candidates
      .map((property) => {
        const reasons: string[] = [];
        let score = 50;

        // Cercanía al presupuesto: premia estar dentro y penaliza excederse.
        const price = Number(property.price);
        const max = Number(input.maxPrice);
        if (Number.isFinite(max) && max > 0) {
          if (price <= max) {
            score += 25;
            reasons.push('dentro del presupuesto');
          } else {
            score -= Math.min(40, ((price - max) / max) * 100);
          }
        }

        const matched = wanted.filter((amenity) =>
          property.amenities.some((item) => item.toLowerCase().includes(String(amenity).toLowerCase())),
        );
        if (matched.length) {
          score += matched.length * 8;
          reasons.push(`incluye ${matched.join(', ')}`);
        }
        if (locations.length && property.city) reasons.push(`ubicada en ${property.city}`);
        if (input.bedroomsMin && property.bedrooms && property.bedrooms >= Number(input.bedroomsMin)) {
          reasons.push(`${property.bedrooms} recámaras`);
        }

        return { property, score: Math.max(0, Math.round(score)), reasons };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const payload = scored.map(({ property, score, reasons }) => ({
      propertyId: property.id,
      title: property.title,
      operationType: property.operationType,
      propertyType: property.propertyType,
      price: Number(property.price),
      currency: property.currency,
      city: property.city,
      neighborhood: property.neighborhood,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms ? Number(property.bathrooms) : null,
      parkingSpaces: property.parkingSpaces,
      constructionM2: property.constructionM2 ? Number(property.constructionM2) : null,
      amenities: property.amenities,
      publicUrl: property.publicUrl,
      matchScore: score,
      matchReasons: reasons,
    }));

    return {
      result: JSON.stringify({ found: payload.length, properties: payload }),
      recommendedPropertyIds: scored.map((item) => item.property.id),
    };
  }

  private async getPropertyDetails(context: ToolContext, input: any): Promise<ToolOutcome> {
    const property = await this.db.property.findFirst({
      // El filtro por tenant es del contexto, no del argumento del modelo.
      where: { id: String(input.propertyId ?? ''), organizationId: context.organizationId },
    });
    if (!property) {
      return { result: 'Esa propiedad no existe en el inventario. No la menciones al prospecto.' };
    }
    if (property.status !== 'AVAILABLE') {
      return {
        result: `La propiedad "${property.title}" ya no está disponible (estado ${property.status}). Dilo con honestidad y ofrece buscar otras opciones.`,
      };
    }
    return {
      result: JSON.stringify({
        propertyId: property.id,
        title: property.title,
        description: property.description,
        operationType: property.operationType,
        propertyType: property.propertyType,
        price: Number(property.price),
        currency: property.currency,
        address: property.addressDisplay,
        city: property.city,
        neighborhood: property.neighborhood,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms ? Number(property.bathrooms) : null,
        parkingSpaces: property.parkingSpaces,
        constructionM2: property.constructionM2 ? Number(property.constructionM2) : null,
        landM2: property.landM2 ? Number(property.landM2) : null,
        amenities: property.amenities,
        publicUrl: property.publicUrl,
        availableFrom: property.availableFrom,
      }),
    };
  }

  private async updateLeadPreferences(context: ToolContext, input: any): Promise<ToolOutcome> {
    const lead = await this.db.lead.findFirst({
      where: { id: context.leadId, organizationId: context.organizationId },
    });
    if (!lead) return { result: 'No fue posible actualizar el perfil.' };

    // Fusión, no reemplazo: cada mensaje aporta datos parciales.
    const current = (lead.preferences ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const copy = (key: string, value: unknown) => {
      if (value !== undefined && value !== null && value !== '') patch[key] = value;
    };

    copy('operationType', this.isOperation(input.operationType) ? input.operationType : undefined);
    copy(
      'propertyTypes',
      Array.isArray(input.propertyTypes) ? input.propertyTypes.filter(this.isPropertyType) : undefined,
    );
    if (Number.isFinite(Number(input.budgetMin)) || Number.isFinite(Number(input.budgetMax))) {
      patch.budget = {
        ...((current.budget as object) ?? {}),
        ...(Number.isFinite(Number(input.budgetMin)) ? { min: Number(input.budgetMin) } : {}),
        ...(Number.isFinite(Number(input.budgetMax)) ? { max: Number(input.budgetMax) } : {}),
        currency: input.currency ?? (current.budget as any)?.currency ?? 'MXN',
      };
    }
    copy('locations', Array.isArray(input.locations) ? input.locations : undefined);
    copy('bedroomsMin', Number.isFinite(Number(input.bedroomsMin)) ? Number(input.bedroomsMin) : undefined);
    copy('bathroomsMin', Number.isFinite(Number(input.bathroomsMin)) ? Number(input.bathroomsMin) : undefined);
    copy(
      'parkingSpacesMin',
      Number.isFinite(Number(input.parkingSpacesMin)) ? Number(input.parkingSpacesMin) : undefined,
    );
    copy('mustHaveAmenities', Array.isArray(input.mustHaveAmenities) ? input.mustHaveAmenities : undefined);
    copy('moveInTimeframe', input.moveInTimeframe);
    if (typeof input.financingNeeded === 'boolean') patch.financingNeeded = input.financingNeeded;
    if (typeof input.visitIntent === 'boolean') patch.visitIntent = input.visitIntent;

    await this.db.lead.update({
      where: { id: lead.id },
      data: {
        preferences: { ...current, ...patch } as Prisma.InputJsonValue,
        stage: lead.stage === 'NEW' ? 'QUALIFYING' : lead.stage,
      },
    });
    return { result: `Perfil actualizado con: ${Object.keys(patch).join(', ') || 'sin cambios'}` };
  }

  private async qualifyLead(context: ToolContext, input: any): Promise<ToolOutcome> {
    const score = Math.max(0, Math.min(100, Math.round(Number(input.score) || 0)));
    const reasons = Array.isArray(input.reasons) ? input.reasons.map(String) : [];
    const stage = ['NEW', 'CONTACTED', 'QUALIFYING', 'QUALIFIED', 'VISIT_SCHEDULED'].includes(input.stage)
      ? input.stage
      : undefined;

    await this.db.lead.updateMany({
      where: { id: context.leadId, organizationId: context.organizationId },
      data: { score, stage, aiSummary: reasons.join(' · ') || undefined },
    });
    return { result: `Lead calificado con ${score}/100${stage ? ` en etapa ${stage}` : ''}.` };
  }

  private async requestPropertyVisit(context: ToolContext, input: any): Promise<ToolOutcome> {
    const startsAt = this.parseWhen(input.preferredDate, input.preferredTime);
    if (!startsAt) {
      return { result: 'La fecha no es válida. Pregunta al prospecto una fecha y hora concretas.' };
    }

    const propertyId = input.propertyId ? String(input.propertyId) : undefined;
    if (propertyId) {
      const exists = await this.db.property.findFirst({
        where: { id: propertyId, organizationId: context.organizationId },
        select: { id: true },
      });
      if (!exists) return { result: 'Esa propiedad no existe; no puedes agendar sobre ella.' };
    }

    // El asesor responsable del agente es quien atenderá la visita.
    const agent = context.agentId
      ? await this.db.agent.findUnique({
          where: { id: context.agentId },
          select: { responsibleUserId: true },
        })
      : null;
    if (!agent) return { result: 'No hay un asesor asignado para agendar. Transfiere a un humano.' };

    const appointment = await this.db.appointment.create({
      data: {
        organizationId: context.organizationId,
        leadId: context.leadId,
        propertyId,
        assignedUserId: agent.responsibleUserId,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 60 * 60 * 1000),
        // REQUESTED, no SCHEDULED: la spec §13.5 prohíbe afirmar que quedó
        // confirmada cuando solo se creó una solicitud.
        status: 'REQUESTED',
        source: 'AI',
        notes: input.notes ? String(input.notes) : undefined,
      },
    });

    await this.db.lead.updateMany({
      where: { id: context.leadId, organizationId: context.organizationId },
      data: { stage: 'VISIT_SCHEDULED' },
    });

    return {
      result: `Solicitud de visita registrada (${appointment.id}) para ${startsAt.toISOString()}. Avísale al prospecto que un asesor la confirmará; NO afirmes que ya está confirmada.`,
    };
  }

  private handoffToHuman(input: any): ToolOutcome {
    const reason = String(input.reason ?? 'Solicitud del prospecto').slice(0, 300);
    const priority = ['LOW', 'NORMAL', 'HIGH'].includes(input.priority) ? input.priority : 'NORMAL';
    return {
      result: 'Conversación transferida a un asesor humano. Despídete con cortesía y no prometas tiempos.',
      handoff: { reason, priority },
    };
  }

  // -------------------------------------------------------------------------

  private parseWhen(date: unknown, time: unknown): Date | undefined {
    const day = String(date ?? '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
    const clock = /^\d{2}:\d{2}$/.test(String(time ?? '')) ? String(time) : '10:00';
    const parsed = new Date(`${day}T${clock}:00`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private isOperation = (value: unknown): value is OperationType =>
    OPERATION_TYPES.includes(value as OperationType);

  private isPropertyType = (value: unknown): value is PropertyType =>
    PROPERTY_TYPES.includes(value as PropertyType);
}
