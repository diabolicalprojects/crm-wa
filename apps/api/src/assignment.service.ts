import { Injectable, Logger } from '@nestjs/common';
import { AssignmentMode } from '@prisma/client';
import { PrismaService } from './prisma.service';

/**
 * A quién le toca un prospecto nuevo (§14.2).
 *
 * El orden de las reglas importa más que las reglas mismas:
 *
 * 1. **Asesor pegajoso.** Si el prospecto ya fue atendido, se queda con quien
 *    lo atendió. Manda sobre todos los modos. Es una regla de comisión
 *    disfrazada de software: sin ella, un prospecto que vuelve preguntando por
 *    otro inmueble le cae a otro asesor y la agencia tiene un conflicto interno
 *    cada semana. Es lo que decide si el equipo usa el CRM o lo esquiva.
 * 2. **El modo configurado.**
 * 3. **Respaldo.** Responsable del canal, y si no, el propietario. Un prospecto
 *    sin dueño es un prospecto que nadie atiende.
 */

export interface AssignmentInput {
  organizationId: string;
  /** El asesor que ya lo atendió antes, si lo hay. */
  currentUserId?: string | null;
  /** El responsable del agente que atiende el canal por el que entró. */
  channelUserId?: string | null;
  /** Solo para poder fijar la hora en las pruebas. */
  now?: Date;
}

interface DutyShift {
  userId: string;
  /** 1 = lunes … 7 = domingo, como ISO-8601. */
  days: number[];
  from: string;
  to: string;
}

@Injectable()
export class AssignmentService {
  private readonly log = new Logger(AssignmentService.name);

  constructor(private db: PrismaService) {}

  async resolve(input: AssignmentInput): Promise<string | undefined> {
    const org = await this.db.organization.findUnique({
      where: { id: input.organizationId },
      select: {
        assignmentMode: true,
        stickyAdvisor: true,
        dutySchedule: true,
        lastAssignedUserId: true,
        timezone: true,
      },
    });
    if (!org) return undefined;

    const activos = await this.activeMembers(input.organizationId);
    if (!activos.length) return undefined;
    const esActivo = (id?: string | null) => (id && activos.some((m) => m.userId === id) ? id : undefined);

    // 1. El prospecto se queda con quien ya lo atendió.
    if (org.stickyAdvisor) {
      const pegado = esActivo(input.currentUserId);
      if (pegado) return pegado;
    }

    // 2. El modo configurado.
    const porModo = await this.byMode(org, activos, input, esActivo);
    if (porModo) return porModo;

    // 3. Respaldo: nadie se queda sin dueño por una configuración a medias.
    return esActivo(input.channelUserId) ?? this.owner(activos);
  }

  private async byMode(
    org: { assignmentMode: AssignmentMode; dutySchedule: unknown; lastAssignedUserId: string | null; timezone: string },
    activos: { userId: string; role: string }[],
    input: AssignmentInput,
    esActivo: (id?: string | null) => string | undefined,
  ): Promise<string | undefined> {
    switch (org.assignmentMode) {
      case 'OWNER':
        return this.owner(activos);

      case 'ROUND_ROBIN':
        return this.nextInTurn(input.organizationId, activos, org.lastAssignedUserId);

      case 'ON_DUTY': {
        const deGuardia = this.onDuty(org.dutySchedule, org.timezone, input.now ?? new Date());
        // Fuera de todo turno cae al respaldo a propósito: dejar sin asignar a
        // quien escribe de madrugada es exactamente lo que hay que evitar.
        return esActivo(deGuardia);
      }

      case 'CHANNEL_RESPONSIBLE':
      default:
        return esActivo(input.channelUserId);
    }
  }

  /** Los que pueden recibir prospectos: miembros activos de la agencia. */
  private async activeMembers(organizationId: string) {
    const miembros = await this.db.organizationMember.findMany({
      where: { organizationId, status: 'ACTIVE' },
      select: { userId: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return miembros.map((m) => ({ userId: m.userId, role: String(m.role) }));
  }

  private owner(activos: { userId: string; role: string }[]) {
    return activos.find((m) => m.role === 'OWNER')?.userId ?? activos[0]?.userId;
  }

  /**
   * El siguiente del carrusel. Reparte entre asesores y supervisores: el
   * propietario y los administradores suelen no atender, y meterlos en la
   * rotación es la forma más rápida de que la agencia lo apague.
   */
  private async nextInTurn(
    organizationId: string,
    activos: { userId: string; role: string }[],
    lastAssignedUserId: string | null,
  ) {
    const rotacion = activos.filter((m) => m.role === 'ADVISOR' || m.role === 'SUPERVISOR');
    const rueda = rotacion.length ? rotacion : activos;

    const anterior = rueda.findIndex((m) => m.userId === lastAssignedUserId);
    // Si el último ya no está, se empieza de nuevo en vez de quedarse atascado.
    const elegido = rueda[(anterior + 1) % rueda.length].userId;

    await this.db.organization.update({
      where: { id: organizationId },
      data: { lastAssignedUserId: elegido },
    });
    return elegido;
  }

  /**
   * Quién está de guardia ahora, en la zona horaria de la agencia. Un turno que
   * cruza la medianoche (22:00 → 06:00) cuenta como un solo turno continuo, que
   * es justo el que cubre los mensajes de la noche.
   */
  onDuty(schedule: unknown, timezone: string, now: Date): string | undefined {
    const turnos = this.parseShifts(schedule);
    if (!turnos.length) return undefined;

    const local = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(now);

    const parte = (tipo: string) => local.find((p) => p.type === tipo)?.value ?? '';
    const DIAS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const dia = DIAS[parte('weekday')] ?? 0;
    const minutos = Number(parte('hour')) * 60 + Number(parte('minute'));

    for (const turno of turnos) {
      const desde = toMinutes(turno.from);
      const hasta = toMinutes(turno.to);
      if (desde === undefined || hasta === undefined) continue;

      if (desde <= hasta) {
        if (turno.days.includes(dia) && minutos >= desde && minutos < hasta) return turno.userId;
      } else {
        // Cruza la medianoche: cuenta el día en que empezó el turno.
        const ayer = dia === 1 ? 7 : dia - 1;
        if (turno.days.includes(dia) && minutos >= desde) return turno.userId;
        if (turno.days.includes(ayer) && minutos < hasta) return turno.userId;
      }
    }
    return undefined;
  }

  /**
   * El horario se captura desde la consola y llega como JSON libre: se tolera
   * cualquier forma inesperada ignorándola, nunca rompiendo la asignación.
   */
  private parseShifts(schedule: unknown): DutyShift[] {
    if (!Array.isArray(schedule)) return [];
    return schedule.flatMap((raw: any) => {
      if (!raw || typeof raw.userId !== 'string') return [];
      const days = Array.isArray(raw.days)
        ? raw.days.map(Number).filter((d: number) => d >= 1 && d <= 7)
        : [1, 2, 3, 4, 5, 6, 7];
      if (!days.length) return [];
      return [{ userId: raw.userId, days, from: String(raw.from ?? ''), to: String(raw.to ?? '') }];
    });
  }
}

/** `"09:30"` → 570. Devuelve `undefined` si no es una hora. */
function toMinutes(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const horas = Number(match[1]);
  const minutos = Number(match[2]);
  if (horas > 23 || minutos > 59) return undefined;
  return horas * 60 + minutos;
}
