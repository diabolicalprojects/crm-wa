import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentsController } from './agents.controller';
import { AppointmentsController } from './appointments.controller';
import { AuthUser } from './auth';
import { LeadsController } from './leads.controller';
import { PropertiesController } from './properties.controller';

const owner: AuthUser = {
  id: 'u1',
  email: 'owner@test.com',
  name: 'Owner',
  isSuperAdmin: false,
  role: 'OWNER',
  organizationId: 'org-1',
};
const advisor: AuthUser = { ...owner, id: 'u2', role: 'ADVISOR' };

describe('CRUD del CRM aislado por agencia', () => {
  let db: any;

  beforeEach(() => {
    db = {
      property: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'p1' }),
        update: vi.fn().mockResolvedValue({ id: 'p1' }),
      },
      lead: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: 'l1' }),
        create: vi.fn().mockResolvedValue({ id: 'l1' }),
        update: vi.fn().mockResolvedValue({ id: 'l1' }),
      },
      agent: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'a1' }),
        update: vi.fn().mockResolvedValue({ id: 'a1' }),
      },
      appointment: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'v1' }),
        update: vi.fn().mockResolvedValue({ id: 'v1' }),
      },
      whatsappSession: {
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn().mockResolvedValue({ id: 's1' }),
        updateMany: vi.fn(),
      },
      agentSessionAssignment: { create: vi.fn(), updateMany: vi.fn() },
      conversation: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
      auditLog: { create: vi.fn() },
    };
    db.$transaction = vi.fn((callback: any) =>
      Array.isArray(callback) ? Promise.all(callback) : callback(db),
    );
  });

  it('crea propiedades con enums y tipos convertidos', async () => {
    const controller = new PropertiesController(db);
    await controller.create('org-1', {
      title: 'Casa en el centro',
      operationType: 'SALE',
      propertyType: 'HOUSE',
      price: 2500000,
      city: 'Aguascalientes',
      bedrooms: 3,
      amenities: ['terraza'],
    } as any);
    expect(db.property.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        operationType: 'SALE',
        propertyType: 'HOUSE',
        price: 2500000,
        amenities: ['terraza'],
      }),
    });
  });

  it('pagina propiedades por cursor y devuelve el siguiente', async () => {
    const rows = Array.from({ length: 3 }, (_, index) => ({ id: `p${index}` }));
    db.property.findMany.mockResolvedValue(rows);
    const result = await new PropertiesController(db).list('org-1', { take: 2 } as any);
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe('p1');
    expect(db.property.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: 'org-1' }), take: 3 }),
    );
  });

  it('desactiva propiedades sin borrarlas', async () => {
    await new PropertiesController(db).remove('org-1', 'p1');
    expect(db.property.update).toHaveBeenCalledWith({
      where: { id: 'p1', organizationId: 'org-1' },
      data: { status: 'INACTIVE' },
    });
  });

  it('un asesor solo consulta sus leads; un propietario ve todos', async () => {
    const controller = new LeadsController(db);
    await controller.list(owner, 'org-1', {} as any);
    expect(db.lead.findMany.mock.calls[0][0].where).not.toHaveProperty('OR');

    await controller.list(advisor, 'org-1', {} as any);
    const advisorWhere = db.lead.findMany.mock.calls[1][0].where;
    expect(advisorWhere.OR).toEqual(
      expect.arrayContaining([{ assignedUserId: 'u2' }]),
    );
  });

  it('impide que un asesor represente a dos agentes activos', async () => {
    db.agent.findFirst.mockResolvedValue({ id: 'a0', name: 'Andrea' });
    await expect(
      new AgentsController(db).create('org-1', { name: 'Nuevo', responsibleUserId: 'u9' } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.agent.create).not.toHaveBeenCalled();
  });

  it('crea el agente cuando el asesor está libre', async () => {
    await new AgentsController(db).create('org-1', {
      name: 'Andrea',
      responsibleUserId: 'u9',
    } as any);
    expect(db.agent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org-1', operationMode: 'HYBRID' }),
      }),
    );
  });

  it('responde 409 si la sesión ya pertenece a otro agente en vez de reemplazarla', async () => {
    db.agent.findFirst.mockResolvedValue({ id: 'a1' });
    db.whatsappSession.findFirst.mockResolvedValue({ id: 's1', agentId: 'otro-agente' });
    await expect(
      new AgentsController(db).assign(owner, 'org-1', 'a1', { whatsappSessionId: 's1' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.whatsappSession.update).not.toHaveBeenCalled();
  });

  it('asigna la sesión libre y deja historial y auditoría', async () => {
    db.agent.findFirst.mockResolvedValue({ id: 'a1' });
    db.whatsappSession.findFirst
      .mockResolvedValueOnce({ id: 's1', agentId: null })
      .mockResolvedValueOnce(null);
    await new AgentsController(db).assign(owner, 'org-1', 'a1', { whatsappSessionId: 's1' });
    expect(db.whatsappSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' }, data: { agentId: 'a1' } }),
    );
    expect(db.agentSessionAssignment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ agentId: 'a1', whatsappSessionId: 's1', assignedByUserId: 'u1' }),
    });
    expect(db.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'AGENT_SESSION_ASSIGNED' }),
    });
  });

  /**
   * Una conversación nacida antes de que el canal tuviera agente se quedaba sin
   * él para siempre, y el worker la descartaba en silencio. Asignar el canal
   * debe reincorporarlas sin esperar un mensaje nuevo.
   */
  it('adopta las conversaciones huérfanas del canal al asignarlo', async () => {
    db.agent.findFirst.mockResolvedValue({ id: 'a1' });
    db.whatsappSession.findFirst
      .mockResolvedValueOnce({ id: 's1', agentId: null })
      .mockResolvedValueOnce(null);
    await new AgentsController(db).assign(owner, 'org-1', 'a1', { whatsappSessionId: 's1' });
    expect(db.conversation.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', sessionId: 's1', agentId: null },
      data: { agentId: 'a1' },
    });
  });

  it('falla al desasignar cuando el agente no tiene sesión', async () => {
    db.whatsappSession.findFirst.mockResolvedValue(null);
    await expect(new AgentsController(db).unassign(owner, 'org-1', 'a1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('normaliza fechas de las citas y las marca para sincronizar', async () => {
    const controller = new AppointmentsController(db);
    await controller.create('org-1', {
      leadId: 'l1',
      propertyId: 'p1',
      assignedUserId: 'u1',
      startsAt: '2026-09-01T10:00:00Z',
      endsAt: '2026-09-01T11:00:00Z',
    } as any);
    expect(db.appointment.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: 'org-1',
        startsAt: expect.any(Date),
        status: 'SCHEDULED',
        syncStatus: 'PENDING',
      }),
    });

    await controller.cancel('org-1', 'v1');
    expect(db.appointment.update).toHaveBeenCalledWith({
      where: { id: 'v1', organizationId: 'org-1' },
      data: expect.objectContaining({ status: 'CANCELLED', syncStatus: 'PENDING' }),
    });
  });
});
