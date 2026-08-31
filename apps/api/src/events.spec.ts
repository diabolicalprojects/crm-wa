import { describe, expect, it, vi } from 'vitest';
import { firstValueFrom, take, toArray } from 'rxjs';
import { EventsService, type LiveEvent } from './events.service';
import { SystemController } from './system.controller';

describe('difusión de eventos en vivo', () => {
  /**
   * Propiedad de seguridad, no de comodidad: la bandeja de una agencia no debe
   * enterarse jamás de la actividad de otra (spec §17.1).
   */
  it('nunca entrega un evento de una agencia a otra', async () => {
    const events = new EventsService();
    const recibidos: LiveEvent[] = [];
    const ajenos: LiveEvent[] = [];

    const propia = events.stream('org-1').subscribe((event) => recibidos.push(event));
    const otra = events.stream('org-2').subscribe((event) => ajenos.push(event));

    events.publish('org-1', { type: 'message.created', conversationId: 'c1', leadId: 'l1' });

    expect(recibidos).toEqual([{ type: 'message.created', conversationId: 'c1', leadId: 'l1' }]);
    expect(ajenos).toEqual([]);

    propia.unsubscribe();
    otra.unsubscribe();
  });

  it('entrega a todos los asesores conectados de la misma agencia', async () => {
    const events = new EventsService();
    const uno: LiveEvent[] = [];
    const dos: LiveEvent[] = [];
    const a = events.stream('org-1').subscribe((e) => uno.push(e));
    const b = events.stream('org-1').subscribe((e) => dos.push(e));

    events.publish('org-1', { type: 'session.updated', sessionId: 's1', status: 'CONNECTED' });

    expect(uno).toHaveLength(1);
    expect(dos).toHaveLength(1);
    a.unsubscribe();
    b.unsubscribe();
  });

  it('libera el oyente al desconectarse, sin dejar fugas', () => {
    const events = new EventsService();
    const sub = events.stream('org-1').subscribe();
    expect(events.connections('org-1')).toBe(1);
    sub.unsubscribe();
    expect(events.connections('org-1')).toBe(0);
  });

  it('ignora una publicación sin agencia en vez de difundirla a ciegas', () => {
    const events = new EventsService();
    const recibidos: LiveEvent[] = [];
    const sub = events.stream('org-1').subscribe((e) => recibidos.push(e));
    events.publish('', { type: 'message.created', conversationId: 'c1', leadId: 'l1' });
    expect(recibidos).toEqual([]);
    sub.unsubscribe();
  });

  it('emite latidos para que la conexión no muera por inactividad', async () => {
    vi.useFakeTimers();
    const events = new EventsService();
    const promesa = firstValueFrom(events.stream('org-1').pipe(take(1), toArray()));
    vi.advanceTimersByTime(26000);
    expect(await promesa).toEqual([{ type: 'ping' }]);
    vi.useRealTimers();
  });
});

describe('salud del sistema', () => {
  function build(overrides: any = {}) {
    const db = {
      $queryRaw: vi.fn().mockResolvedValue([{ count: 0n }]),
      whatsappSession: { groupBy: vi.fn().mockResolvedValue([]) },
      webhookEvent: { groupBy: vi.fn().mockResolvedValue([]) },
      message: { groupBy: vi.fn().mockResolvedValue([]) },
      conversation: { groupBy: vi.fn().mockResolvedValue([]) },
      aiRun: { groupBy: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
      ...overrides,
    };
    const openwa = { health: vi.fn().mockResolvedValue(true) };
    const events = { connections: vi.fn().mockReturnValue(0) };
    return { db, openwa, controller: new SystemController(db as any, openwa as any, events as any) };
  }

  /** Que la API responda 200 no significa que el sistema funcione. */
  it('reporta degradado si una dependencia falla, no solo si la API vive', async () => {
    delete process.env.REDIS_URL;
    const { controller, openwa } = build();
    openwa.health.mockResolvedValue(false);

    const result = await controller.health();
    expect(result.status).toBe('degraded');
    expect(result.checks.whatsapp.ok).toBe(false);
    expect(result.checks.redis.ok).toBe(false);
    expect(result.checks.redis.error).toMatch(/REDIS_URL/);
  });

  it('no filtra secretos en el mensaje de error de una dependencia', async () => {
    const { controller } = build({
      $queryRaw: vi.fn().mockRejectedValue(
        new Error('connect failed: postgresql://crm:SUPERSECRETO@host:5432/db ' + 'x'.repeat(400)),
      ),
    });
    const result = await controller.health();
    // Truncado: un mensaje de conexión puede traer credenciales completas.
    expect(result.checks.database.error!.length).toBeLessThanOrEqual(160);
  });

  it('calcula la tasa de error de IA, que es la señal de que algo se rompió', async () => {
    const { controller } = build({
      aiRun: {
        groupBy: vi.fn().mockResolvedValue([
          { status: 'SUCCESS', _count: { _all: 3 }, _avg: { latencyMs: 1000 }, _sum: { promptTokens: 300, completionTokens: 60 } },
          { status: 'FAILED', _count: { _all: 1 }, _avg: { latencyMs: 200 }, _sum: { promptTokens: 0, completionTokens: 0 } },
        ]),
        findFirst: vi.fn().mockResolvedValue({
          createdAt: new Date('2026-08-31T17:38:39Z'), model: 'gemini-3.6-flash',
          errorMessage: 'Proveedor respondió 429: quota',
        }),
      },
    });

    const metrics = await controller.metrics();
    expect(metrics.ia.tasaDeError).toBe(0.25);
    expect(metrics.ia.ejecuciones).toEqual({ SUCCESS: 3, FAILED: 1 });
    expect(metrics.ia.tokensEntrada).toBe(300);
    expect(metrics.ia.ultimoError?.errorMessage).toMatch(/429/);
  });

  it('no divide entre cero cuando todavía no hay ejecuciones', async () => {
    const { controller } = build();
    const metrics = await controller.metrics();
    expect(metrics.ia.tasaDeError).toBe(0);
    expect(metrics.ia.latenciaMediaMs).toBe(0);
  });

  it('cuenta las conversaciones que esperan respuesta', async () => {
    const { controller } = build({
      $queryRaw: vi.fn().mockResolvedValue([{ count: 7n }]),
    });
    const metrics = await controller.metrics();
    expect(metrics.sinResponder).toBe(7);
  });
});
