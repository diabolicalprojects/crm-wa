import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AutomationService } from './automation.service';
import { PrismaService } from './prisma.service';

/**
 * Seguimiento proactivo: la IA vuelve a escribir sola cuando el prospecto dejó
 * de contestar.
 *
 * Es la función que el equipo sabe que no hace —nadie se acuerda de volver a
 * escribirle al que no contestó el martes— y la que ningún competidor de esta
 * categoría tiene encendida hoy.
 *
 * También es la más fácil de convertir en spam, y el costo de equivocarse no es
 * una queja: es que WhatsApp restrinja el número de la agencia. Por eso está
 * apagada por omisión y cada guarda de abajo existe por una razón concreta.
 */

const INTERVAL_MS = Number(process.env.FOLLOW_UP_INTERVAL_MS ?? 5 * 60_000);
const BATCH = 25;

/**
 * Franja en la que nunca se manda un seguimiento, en la zona horaria de la
 * agencia. Es un tope duro por encima del horario del agente: un agente sin
 * horario configurado opera 24/7, y un mensaje automático a las 3 de la
 * mañana es exactamente lo que hace que alguien reporte el número.
 */
const SILENCIO_DESDE = Number(process.env.FOLLOW_UP_QUIET_FROM ?? 21);
const SILENCIO_HASTA = Number(process.env.FOLLOW_UP_QUIET_UNTIL ?? 9);

/**
 * Lo que se lee como «ya no me escriban». Deliberadamente corta y sin
 * ambigüedades: marcar de más deja al prospecto sin atención automática para
 * siempre, así que ante la duda no se marca. Un «ahorita no puedo» no es una
 * baja.
 */
const BAJAS = [
  'no me escriban', 'no me escribas', 'no me contacten', 'no me contactes',
  'dejen de escribirme', 'deja de escribirme', 'ya no me manden', 'ya no me mandes',
  'no me vuelvan a escribir', 'quitenme de', 'quítenme de', 'darme de baja',
  'dar de baja', 'ya no me interesa nada',
];

export function pidioNoSerContactado(texto: string | null | undefined): boolean {
  if (!texto) return false;
  const limpio = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (limpio.trim() === 'stop' || limpio.trim() === 'baja') return true;
  return BAJAS.some((frase) =>
    limpio.includes(frase.normalize('NFD').replace(/[̀-ͯ]/g, '')),
  );
}

/** Hora local de la agencia, 0-23. */
export function horaLocal(timezone: string, now: Date): number {
  const valor = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false,
  }).format(now);
  return Number(valor);
}

export function enSilencio(hora: number): boolean {
  // La franja cruza la medianoche, así que es una unión y no un intervalo.
  return SILENCIO_DESDE > SILENCIO_HASTA
    ? hora >= SILENCIO_DESDE || hora < SILENCIO_HASTA
    : hora >= SILENCIO_DESDE && hora < SILENCIO_HASTA;
}

@Injectable()
export class FollowUpService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private corriendo = false;
  private readonly log = new Logger(FollowUpService.name);

  constructor(
    private db: PrismaService,
    private automation: AutomationService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.sweep().catch((error) => this.log.error(`Barrido falló: ${error.message}`));
    }, INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(now = new Date()) {
    // Antes de cualquier await: dos barridos concurrentes mandarían el mismo
    // seguimiento dos veces, y aquí eso se ve desde el teléfono del prospecto.
    if (this.corriendo) return { encolados: 0, omitido: true };
    this.corriendo = true;
    try {
      const candidatas = await this.candidates(now);
      let encolados = 0;
      for (const conversation of candidatas) {
        if (await this.schedule(conversation, now)) encolados += 1;
      }
      return { encolados, omitido: false };
    } finally {
      this.corriendo = false;
    }
  }

  /**
   * Conversaciones donde la IA habló, el prospecto no contestó, y ya pasó el
   * tiempo que la agencia configuró.
   *
   * El filtro grueso va en la base y el fino en `schedule`: el retraso es por
   * agente, así que no se puede expresar en un solo `where` sin recorrer la
   * tabla entera.
   */
  private async candidates(now: Date) {
    const masViejoPosible = new Date(now.getTime() - 6 * 3600_000);
    return this.db.conversation.findMany({
      where: {
        status: 'OPEN',
        // Si un humano tiene el control, la IA no escribe. Ni siquiera para
        // insistir: sería escribir encima de un asesor que está negociando.
        mode: 'AI_ACTIVE',
        followUpOptOut: false,
        lastOutboundAt: { not: null, lt: masViejoPosible },
        agent: { followUpEnabled: true, status: 'ACTIVE', aiEnabled: true },
      },
      include: {
        agent: {
          select: {
            id: true,
            name: true,
            followUpDelayHours: true,
            followUpMaxAttempts: true,
          },
        },
        organization: { select: { timezone: true } },
        lead: { select: { stage: true } },
      },
      orderBy: { lastOutboundAt: 'asc' },
      take: BATCH,
    });
  }

  private async schedule(conversation: any, now: Date): Promise<boolean> {
    const agent = conversation.agent;

    if (conversation.followUpCount >= agent.followUpMaxAttempts) return false;

    // Un prospecto perdido o ganado no se persigue. Insistirle a quien ya
    // compró es peor que no insistirle a nadie.
    if (conversation.lead?.stage === 'LOST' || conversation.lead?.stage === 'WON') return false;

    // El prospecto contestó después de nuestro último mensaje: la conversación
    // está viva y no hay nada que reactivar.
    if (conversation.lastInboundAt && conversation.lastInboundAt > conversation.lastOutboundAt) {
      return false;
    }

    const espera = Math.max(1, agent.followUpDelayHours) * 3600_000;
    // El reloj corre desde el último seguimiento, no desde el último mensaje:
    // de otro modo el segundo intento saldría inmediatamente después del
    // primero, porque el primero también es un `lastOutboundAt`.
    const referencia = conversation.lastFollowUpAt ?? conversation.lastOutboundAt;
    if (now.getTime() - new Date(referencia).getTime() < espera) return false;

    const timezone = conversation.organization?.timezone ?? 'America/Mexico_City';
    if (enSilencio(horaLocal(timezone, now))) return false;

    // Se marca antes de encolar. Si el trabajo falla, se pierde ese intento;
    // el orden inverso arriesga mandar el mismo seguimiento en cada barrido si
    // algo falla entre encolar y marcar, y de los dos errores este es el
    // barato.
    await this.db.conversation.update({
      where: { id: conversation.id },
      data: { followUpCount: { increment: 1 }, lastFollowUpAt: now },
    });

    await this.automation.enqueue(conversation.id, { followUp: true });
    this.log.log(
      `Seguimiento ${conversation.followUpCount + 1}/${agent.followUpMaxAttempts} ` +
        `encolado para la conversación ${conversation.id}`,
    );
    return true;
  }
}
