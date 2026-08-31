import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiController } from './ai.controller';
import { AuditController } from './audit.controller';
import { AuthUser } from './auth';
import { ConversationsController } from './conversations.controller';
import { DashboardController } from './dashboard.controller';
import { ImportsController, normalizeRow } from './imports.controller';

const owner: AuthUser = {
  id: 'u1',
  email: 'x@y.com',
  name: 'X',
  isSuperAdmin: false,
  role: 'OWNER',
  organizationId: 'org-1',
};

describe('operación, métricas e importación sin OpenWA', () => {
  let db: any;

  beforeEach(() => {
    db = {
      conversation: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: 'c1' }),
        count: vi.fn().mockResolvedValue(2),
        update: vi.fn().mockResolvedValue({ id: 'c1' }),
      },
      message: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
      lead: { count: vi.fn().mockResolvedValue(3) },
      property: {
        count: vi.fn().mockResolvedValue(4),
        create: vi.fn().mockResolvedValue({ id: 'p1' }),
        findFirst: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
      agent: { count: vi.fn().mockResolvedValue(1) },
      whatsappSession: { count: vi.fn().mockResolvedValue(0) },
      auditLog: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
      aiProvider: {
        findMany: vi.fn().mockResolvedValue([{ id: 'ai1', encryptedApiKey: 'cifrado', name: 'Claude' }]),
        create: vi.fn().mockResolvedValue({ id: 'ai1', encryptedApiKey: 'cifrado', name: 'Claude' }),
        delete: vi.fn(),
      },
      aiModelConfig: { count: vi.fn().mockResolvedValue(0), updateMany: vi.fn() },
    };
    db.$transaction = vi.fn((items: any) =>
      Array.isArray(items) ? Promise.all(items) : items(db),
    );
  });

  it('calcula el dashboard con alcance de la agencia seleccionada', async () => {
    const result = await new DashboardController(db).summary({
      ...owner,
      isSuperAdmin: true,
    });
    expect(result.metrics).toEqual({ conversations: 2, leads: 3, properties: 4, agents: 1, sessions: 0 });
    expect(result.scope).toBe('organization');
  });

  it('cambia takeover y devuelve a la IA sin invocar OpenWA', async () => {
    const controller = new ConversationsController(db, {} as any);
    await controller.takeover(owner, 'org-1', 'c1');
    await controller.returnToAi(owner, 'org-1', 'c1');
    expect(db.conversation.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'c1', organizationId: 'org-1' },
      data: { mode: 'HUMAN_ACTIVE', assignedUserId: 'u1' },
    });
    expect(db.conversation.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'c1', organizationId: 'org-1' },
      data: { mode: 'AI_ACTIVE', assignedUserId: null, handoffReason: null },
    });
    // Devolver el control deja una nota de sistema en el contexto (spec §8.5).
    expect(db.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ senderType: 'SYSTEM', origin: 'SYSTEM' }),
    });
  });

  it('limita la auditoría al tenant', async () => {
    await new AuditController(db).list('org-1');
    expect(db.auditLog.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-1' },
      take: 200,
      orderBy: { createdAt: 'desc' },
    });
  });

  it('normaliza encabezados en español y valida filas incompletas', () => {
    const good = normalizeRow('org-1', {
      Titulo: 'Casa en Jesús María',
      Operacion: 'Venta',
      Tipo: 'Casa',
      Precio: '$2,500,000',
      Ciudad: 'Jesús María',
      Recámaras: '3',
      Amenidades: 'patio|alberca',
    });
    expect(good.error).toBeUndefined();
    expect(good.data).toMatchObject({
      title: 'Casa en Jesús María',
      operationType: 'SALE',
      propertyType: 'HOUSE',
      price: 2500000,
      bedrooms: 3,
      amenities: ['patio', 'alberca'],
    });

    expect(normalizeRow('org-1', { Titulo: 'Sin precio', Operacion: 'Venta', Tipo: 'Casa' }).error)
      .toMatch(/precio/);
    expect(normalizeRow('org-1', { Operacion: 'Venta', Tipo: 'Casa', Precio: '1' }).error)
      .toMatch(/título/);
  });

  it('importa CSV contando creados y errores', async () => {
    const file = {
      originalname: 'inventario.csv',
      buffer: Buffer.from(
        'titulo,operacion,tipo,precio,ciudad\nCasa,Venta,Casa,1000000,Centro\nDepa,Venta,Casa,no-numero,Norte',
      ),
    } as Express.Multer.File;
    const result = await new ImportsController(db).properties('org-1', file);
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(db.property.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: 'org-1', title: 'Casa', price: 1000000 }),
    });
  });

  it('nunca devuelve la credencial cifrada de un proveedor de IA', async () => {
    const secrets: any = { encrypt: vi.fn().mockReturnValue('cifrado') };
    const gateway: any = { test: vi.fn().mockResolvedValue({ ok: true }) };
    const controller = new AiController(db, secrets, gateway);

    // El tipo de retorno ya omite la credencial; se comprueba también en
    // ejecución para que un cambio futuro no la reintroduzca por descuido.
    const listed = await controller.listProviders();
    expect(Object.keys(listed[0])).not.toContain('encryptedApiKey');
    expect(listed[0].hasApiKey).toBe(true);

    const created = await controller.createProvider({
      name: 'Claude',
      kind: 'ANTHROPIC',
      apiKey: 'clave-secreta',
    } as any);
    expect(Object.keys(created)).not.toContain('encryptedApiKey');
    expect(secrets.encrypt).toHaveBeenCalledWith('clave-secreta');
  });

  it('rechaza guardar un proveedor cuya credencial no funciona', async () => {
    const secrets: any = { encrypt: vi.fn() };
    const gateway: any = { test: vi.fn().mockResolvedValue({ ok: false, error: '401 unauthorized' }) };
    await expect(
      new AiController(db, secrets, gateway).createProvider({
        name: 'Claude',
        kind: 'ANTHROPIC',
        apiKey: 'clave-mala',
      } as any),
    ).rejects.toThrow(/rechazó la credencial/);
    expect(db.aiProvider.create).not.toHaveBeenCalled();
  });

  it('usa el modelo recomendado del catálogo cuando no se especifica', async () => {
    const secrets: any = { encrypt: vi.fn().mockReturnValue('cifrado') };
    const gateway: any = { test: vi.fn().mockResolvedValue({ ok: true }) };
    await new AiController(db, secrets, gateway).createProvider({
      name: 'Claude',
      kind: 'ANTHROPIC',
      apiKey: 'clave',
    } as any);
    expect(gateway.test).toHaveBeenCalledWith(expect.anything(), 'claude-opus-5');
  });
});
