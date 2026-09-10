import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiToolsService, type ToolContext } from './ai-tools.service';

const CONTEXT: ToolContext = {
  organizationId: 'org-1',
  leadId: 'lead-1',
  conversationId: 'conv-1',
  agentId: 'agent-1',
  maxRecommendations: 3,
};

function property(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prop-1',
    title: 'Casa en Jesús María',
    operationType: 'RENT',
    propertyType: 'HOUSE',
    status: 'AVAILABLE',
    price: 12500,
    currency: 'MXN',
    city: 'Jesús María',
    neighborhood: 'Real de Haciendas',
    bedrooms: 3,
    bathrooms: 2,
    parkingSpaces: 2,
    constructionM2: 140,
    landM2: 165,
    amenities: ['jardín', 'mascotas'],
    publicUrl: 'https://example.com/p1',
    ...overrides,
  };
}

describe('herramientas del agente inmobiliario', () => {
  let db: any;
  let tools: AiToolsService;

  beforeEach(() => {
    db = {
      property: { findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
      lead: { findFirst: vi.fn().mockResolvedValue({ id: 'lead-1', stage: 'NEW', preferences: {} }), update: vi.fn(), updateMany: vi.fn() },
      agent: { findUnique: vi.fn().mockResolvedValue({ responsibleUserId: 'user-1' }) },
      appointment: { create: vi.fn().mockResolvedValue({ id: 'appt-1' }) },
    };
    // Por omisión, sin agenda visible: es el estado de una agencia que
    // todavía no vinculó calendario, que son casi todas al empezar.
    tools = new AiToolsService(db, { huecos: async () => null } as any);
  });

  /**
   * Las seis de la especificación más `checkVisitAvailability`, que existe para
   * que el agente pueda comprobar un hueco antes de proponerlo en vez de
   * inventarlo. La lista es exacta a propósito: una herramienta nueva le da al
   * modelo una capacidad nueva, y eso se decide, no se hereda.
   */
  it('expone exactamente las herramientas previstas', () => {
    expect(tools.definitions().map((tool) => tool.name).sort()).toEqual([
      'checkVisitAvailability', 'getPropertyDetails', 'handoffToHuman', 'qualifyLead',
      'requestPropertyVisit', 'searchProperties', 'updateLeadPreferences',
    ]);
  });

  /**
   * La regla que sostiene el aislamiento multi-tenant: el `organizationId` sale
   * del contexto del worker, nunca de un argumento generado por el modelo
   * (spec §13.3). Aunque el LLM lo invente, no debe tener efecto.
   */
  it('resuelve la agencia desde el contexto, ignorando lo que diga el modelo', async () => {
    await tools.execute(CONTEXT, {
      id: '1', name: 'searchProperties',
      input: { organizationId: 'otra-agencia', operationType: 'RENT' },
    });
    expect(db.property.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1' }) }),
    );
  });

  it('busca solo propiedades disponibles', async () => {
    await tools.execute(CONTEXT, { id: '1', name: 'searchProperties', input: {} });
    expect(db.property.findMany.mock.calls[0][0].where.status).toBe('AVAILABLE');
  });

  it('sin coincidencias pide flexibilizar en vez de inventar alternativas', async () => {
    const outcome = await tools.execute(CONTEXT, {
      id: '1', name: 'searchProperties', input: { maxPrice: 1 },
    });
    expect(outcome.result).toMatch(/Sin coincidencias/);
    expect(outcome.result).toMatch(/flexibilizar/);
    expect(outcome.recommendedPropertyIds).toBeUndefined();
  });

  it('puntúa mejor lo que cabe en el presupuesto y explica por qué coincide', async () => {
    db.property.findMany.mockResolvedValue([
      property({ id: 'barata', price: 10000 }),
      property({ id: 'cara', price: 40000 }),
    ]);
    const outcome = await tools.execute(CONTEXT, {
      id: '1', name: 'searchProperties',
      input: { maxPrice: 15000, amenities: ['jardín'] },
    });
    const payload = JSON.parse(outcome.result);
    expect(payload.properties[0].propertyId).toBe('barata');
    expect(payload.properties[0].matchReasons).toContain('dentro del presupuesto');
    expect(outcome.recommendedPropertyIds).toContain('barata');
  });

  it('respeta el máximo de recomendaciones por mensaje', async () => {
    db.property.findMany.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => property({ id: `p${i}` })),
    );
    const outcome = await tools.execute(CONTEXT, { id: '1', name: 'searchProperties', input: {} });
    expect(JSON.parse(outcome.result).properties).toHaveLength(3);
  });

  /** Antialucinación §13.5: nunca ofrecer algo que ya no está disponible. */
  it('avisa con honestidad cuando la propiedad dejó de estar disponible', async () => {
    db.property.findFirst.mockResolvedValue(property({ status: 'RENTED' }));
    const outcome = await tools.execute(CONTEXT, {
      id: '1', name: 'getPropertyDetails', input: { propertyId: 'prop-1' },
    });
    expect(outcome.result).toMatch(/ya no está disponible/);
  });

  it('niega una propiedad inexistente en vez de improvisar', async () => {
    const outcome = await tools.execute(CONTEXT, {
      id: '1', name: 'getPropertyDetails', input: { propertyId: 'no-existe' },
    });
    expect(outcome.result).toMatch(/no existe/);
    expect(outcome.result).toMatch(/No la menciones/);
  });

  it('fusiona los criterios del prospecto en vez de reemplazarlos', async () => {
    db.lead.findFirst.mockResolvedValue({
      id: 'lead-1', stage: 'QUALIFYING',
      preferences: { locations: ['Aguascalientes'], budget: { min: 8000, currency: 'MXN' } },
    });
    await tools.execute(CONTEXT, {
      id: '1', name: 'updateLeadPreferences',
      input: { budgetMax: 15000, bedroomsMin: 3 },
    });
    const saved = db.lead.update.mock.calls[0][0].data.preferences;
    // Lo anterior sobrevive y lo nuevo se suma.
    expect(saved.locations).toEqual(['Aguascalientes']);
    expect(saved.budget).toMatchObject({ min: 8000, max: 15000 });
    expect(saved.bedroomsMin).toBe(3);
  });

  it('descarta valores que el modelo invente fuera del catálogo', async () => {
    await tools.execute(CONTEXT, {
      id: '1', name: 'updateLeadPreferences',
      input: { operationType: 'PERMUTA', propertyTypes: ['CASTILLO', 'HOUSE'] },
    });
    const saved = db.lead.update.mock.calls[0][0].data.preferences;
    expect(saved.operationType).toBeUndefined();
    expect(saved.propertyTypes).toEqual(['HOUSE']);
  });

  it('acota la calificación al rango del negocio', async () => {
    await tools.execute(CONTEXT, { id: '1', name: 'qualifyLead', input: { score: 320 } });
    expect(db.lead.updateMany.mock.calls[0][0].data.score).toBe(100);

    await tools.execute(CONTEXT, { id: '2', name: 'qualifyLead', input: { score: -40 } });
    expect(db.lead.updateMany.mock.calls[1][0].data.score).toBe(0);
  });

  /**
   * §13.5 prohíbe afirmar que una visita quedó confirmada cuando solo se creó
   * una solicitud. El estado y el texto devuelto deben decirlo.
   */
  it('registra la visita como SOLICITADA y lo dice explícitamente', async () => {
    db.property.findFirst.mockResolvedValue({ id: 'prop-1' });
    const outcome = await tools.execute(CONTEXT, {
      id: '1', name: 'requestPropertyVisit',
      input: { propertyId: 'prop-1', preferredDate: '2026-09-15', preferredTime: '17:30' },
    });
    expect(db.appointment.create.mock.calls[0][0].data.status).toBe('REQUESTED');
    expect(outcome.result).toMatch(/SOLICITUD/);
    expect(outcome.result).toMatch(/NO está confirmada/);
  });

  /**
   * Confirmar exige las dos cosas a la vez: que la agencia lo autorizara y que
   * la hora se comprobara libre en ese momento. Estas cuatro pruebas cubren las
   * cuatro combinaciones, porque tres de ellas deben acabar en SOLICITUD.
   */
  describe('cuándo la visita queda confirmada', () => {
    const pedir = () =>
      tools.execute(CONTEXT, {
        id: '1', name: 'requestPropertyVisit',
        input: { propertyId: 'prop-1', preferredDate: '2026-09-15', preferredTime: '17:30' },
      } as any);

    const conAgenda = (huecos: any[] | null) =>
      new (tools.constructor as any)(db, { huecos: async () => huecos });

    beforeEach(() => {
      db.property.findFirst.mockResolvedValue({ id: 'prop-1' });
    });

    it('con permiso de la agencia y hueco verificado, queda agendada', async () => {
      db.agent.findUnique.mockResolvedValue({
        responsibleUserId: 'u-ana',
        autoConfirmVisits: true,
        businessHours: null,
        organization: { timezone: 'America/Mexico_City' },
      });
      const inicio = new Date('2026-09-15T17:30:00');
      tools = conAgenda([{ inicio, fin: new Date(inicio.getTime() + 3600_000) }]);

      const outcome = await pedir();

      expect(db.appointment.create.mock.calls[0][0].data.status).toBe('SCHEDULED');
      expect(outcome.result).toMatch(/CONFIRMADA/);
    });

    it('con permiso pero sin agenda visible, sigue siendo solicitud', async () => {
      db.agent.findUnique.mockResolvedValue({
        responsibleUserId: 'u-ana',
        autoConfirmVisits: true,
        businessHours: null,
        organization: { timezone: 'America/Mexico_City' },
      });
      tools = conAgenda(null);

      const outcome = await pedir();

      expect(db.appointment.create.mock.calls[0][0].data.status).toBe('REQUESTED');
      expect(outcome.result).toMatch(/NO está confirmada/);
    });

    it('con permiso y la hora ocupada, sigue siendo solicitud', async () => {
      db.agent.findUnique.mockResolvedValue({
        responsibleUserId: 'u-ana',
        autoConfirmVisits: true,
        businessHours: null,
        organization: { timezone: 'America/Mexico_City' },
      });
      // Hay huecos, pero ninguno empieza a la hora pedida.
      tools = conAgenda([
        { inicio: new Date('2026-09-15T09:00:00'), fin: new Date('2026-09-15T10:00:00') },
      ]);

      const outcome = await pedir();

      expect(db.appointment.create.mock.calls[0][0].data.status).toBe('REQUESTED');
      expect(outcome.result).toMatch(/NO está confirmada/);
    });

    it('sin permiso de la agencia no se consulta la agenda siquiera', async () => {
      db.agent.findUnique.mockResolvedValue({
        responsibleUserId: 'u-ana',
        autoConfirmVisits: false,
        businessHours: null,
        organization: { timezone: 'America/Mexico_City' },
      });
      const huecos = vi.fn(async () => [
        { inicio: new Date('2026-09-15T17:30:00'), fin: new Date('2026-09-15T18:30:00') },
      ]);
      tools = new (tools.constructor as any)(db, { huecos });

      await pedir();

      expect(huecos).not.toHaveBeenCalled();
      expect(db.appointment.create.mock.calls[0][0].data.status).toBe('REQUESTED');
    });
  });

  it('rechaza una fecha inválida en vez de agendar cualquier cosa', async () => {
    const outcome = await tools.execute(CONTEXT, {
      id: '1', name: 'requestPropertyVisit', input: { preferredDate: 'el próximo martes' },
    });
    expect(outcome.result).toMatch(/no es válida/);
    expect(db.appointment.create).not.toHaveBeenCalled();
  });

  it('no agenda sobre una propiedad de otra agencia', async () => {
    db.property.findFirst.mockResolvedValue(null);
    const outcome = await tools.execute(CONTEXT, {
      id: '1', name: 'requestPropertyVisit',
      input: { propertyId: 'de-otra-agencia', preferredDate: '2026-09-15' },
    });
    expect(outcome.result).toMatch(/no existe/);
    expect(db.appointment.create).not.toHaveBeenCalled();
  });

  it('señala el handoff con su motivo y prioridad', async () => {
    const outcome = await tools.execute(CONTEXT, {
      id: '1', name: 'handoffToHuman',
      input: { reason: 'Quiere negociar el precio', priority: 'HIGH' },
    });
    expect(outcome.handoff).toEqual({ reason: 'Quiere negociar el precio', priority: 'HIGH' });
    expect(outcome.result).toMatch(/no prometas tiempos/);
  });

  it('normaliza una prioridad desconocida en vez de propagarla', async () => {
    const outcome = await tools.execute(CONTEXT, {
      id: '1', name: 'handoffToHuman', input: { reason: 'x', priority: 'URGENTÍSIMO' },
    });
    expect(outcome.handoff?.priority).toBe('NORMAL');
  });

  /** Un fallo de herramienta no debe romper la conversación ni filtrar trazas. */
  it('ante un error devuelve algo con lo que el modelo pueda continuar', async () => {
    db.property.findMany.mockRejectedValue(new Error('conexión perdida con la base'));
    const outcome = await tools.execute(CONTEXT, { id: '1', name: 'searchProperties', input: {} });
    expect(outcome.result).toMatch(/Continúa sin ese dato/);
    expect(outcome.result).not.toMatch(/conexión perdida/);
  });

  it('ignora una herramienta que no existe', async () => {
    const outcome = await tools.execute(CONTEXT, { id: '1', name: 'borrarTodo', input: {} });
    expect(outcome.result).toMatch(/desconocida/);
  });
});
