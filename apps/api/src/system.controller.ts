import { Controller, Get } from '@nestjs/common';
import IORedis from 'ioredis';
import { Roles } from './auth';
import { EventsService } from './events.service';
import { OpenWaGateway } from './openwa.gateway';
import { PrismaService } from './prisma.service';

/**
 * Salud del sistema y métricas operativas (spec §14.1.1 y §19.2).
 *
 * Existe porque diagnosticar una falla obligaba a consultar la base a mano:
 * saber si el webhook está entrando, si la IA falla y por qué, o si un canal se
 * cayó, no debería requerir acceso al servidor.
 */
@Roles('SUPER_ADMIN')
@Controller('admin/system')
export class SystemController {
  constructor(
    private db: PrismaService,
    private openwa: OpenWaGateway,
    private events: EventsService,
  ) {}

  /** Comprobación profunda: no basta con que la API responda. */
  @Get('health')
  async health() {
    const [database, redis, whatsapp] = await Promise.all([
      this.check(() => this.db.$queryRaw`SELECT 1`),
      this.checkRedis(),
      this.check(async () => {
        if (!(await this.openwa.health())) throw new Error('OpenWA no responde');
      }),
    ]);

    const checks = { database, redis, whatsapp };
    const healthy = Object.values(checks).every((item) => item.ok);
    return { status: healthy ? 'ok' : 'degraded', checks, timestamp: new Date().toISOString() };
  }

  /**
   * Métricas de las últimas 24 horas. Responden a las preguntas que en la
   * práctica se hacen cuando algo va mal: ¿están llegando los mensajes?,
   * ¿la IA está fallando?, ¿algún canal se cayó?
   */
  @Get('metrics')
  async metrics() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [sessions, webhooks, messages, aiRuns, colaPendiente, conversaciones] = await Promise.all([
      this.db.whatsappSession.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: { status: { not: 'DELETED' } },
      }),
      this.db.webhookEvent.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: { receivedAt: { gte: since } },
      }),
      this.db.message.groupBy({
        by: ['direction'],
        _count: { _all: true },
        where: { createdAt: { gte: since } },
      }),
      this.db.aiRun.groupBy({
        by: ['status'],
        _count: { _all: true },
        _avg: { latencyMs: true },
        _sum: { promptTokens: true, completionTokens: true },
        where: { createdAt: { gte: since } },
      }),
      // Conversaciones con un mensaje del prospecto más reciente que la última
      // respuesta: si crece, la automatización se está quedando atrás.
      this.db.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) FROM "Conversation"
        WHERE "lastInboundAt" IS NOT NULL
          AND ("lastOutboundAt" IS NULL OR "lastOutboundAt" < "lastInboundAt")
          AND "mode" = 'AI_ACTIVE'`,
      this.db.conversation.groupBy({ by: ['mode'], _count: { _all: true } }),
    ]);

    const fallidas = aiRuns.find((row) => row.status === 'FAILED')?._count._all ?? 0;
    const totalRuns = aiRuns.reduce((sum, row) => sum + row._count._all, 0);

    return {
      ventana: '24h',
      canales: this.tally(sessions, 'status'),
      webhooks: this.tally(webhooks, 'status'),
      mensajes: this.tally(messages, 'direction'),
      conversaciones: this.tally(conversaciones, 'mode'),
      ia: {
        ejecuciones: this.tally(aiRuns, 'status'),
        // Señal más útil que el conteo crudo: si sube, algo se rompió.
        tasaDeError: totalRuns ? Number((fallidas / totalRuns).toFixed(3)) : 0,
        latenciaMediaMs: Math.round(
          aiRuns.reduce((sum, row) => sum + (row._avg.latencyMs ?? 0) * row._count._all, 0) /
            (totalRuns || 1),
        ),
        tokensEntrada: aiRuns.reduce((sum, row) => sum + (row._sum.promptTokens ?? 0), 0),
        tokensSalida: aiRuns.reduce((sum, row) => sum + (row._sum.completionTokens ?? 0), 0),
        ultimoError: await this.ultimoError(since),
      },
      sinResponder: Number(colaPendiente[0]?.count ?? 0),
      clientesEnVivo: this.events.connections(''),
      timestamp: new Date().toISOString(),
    };
  }

  private async ultimoError(since: Date) {
    const run = await this.db.aiRun.findFirst({
      where: { status: 'FAILED', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, model: true, errorMessage: true },
    });
    return run ? { ...run, errorMessage: run.errorMessage?.slice(0, 300) } : null;
  }

  private tally(rows: any[], key: string): Record<string, number> {
    return Object.fromEntries(rows.map((row) => [row[key], row._count._all]));
  }

  private async check(probe: () => Promise<unknown>) {
    const started = Date.now();
    try {
      await probe();
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - started,
        // Sin secretos: el mensaje puede traer cadenas de conexión.
        error: (error instanceof Error ? error.message : 'error').slice(0, 160),
      };
    }
  }

  private checkRedis() {
    return this.check(async () => {
      const url = process.env.REDIS_URL;
      if (!url) throw new Error('REDIS_URL no configurado: la automatización está inactiva');
      const client = new IORedis(url, { maxRetriesPerRequest: 1, lazyConnect: true, connectTimeout: 3000 });
      try {
        await client.connect();
        await client.ping();
      } finally {
        client.disconnect();
      }
    });
  }
}
