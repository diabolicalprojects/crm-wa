import { Injectable, Logger } from '@nestjs/common';
import { GoogleCalendarService } from './google-calendar.service';
import { PrismaService } from './prisma.service';

/**
 * Huecos reales en la agenda de un asesor (§13.5, montón B2).
 *
 * Es lo que convierte «te agendo el sábado» en una cita que existe. Y es
 * exactamente donde una IA puede hacer el daño más caro: prometer una hora que
 * el asesor ya tiene ocupada le cuesta a la agencia una disculpa y un cliente.
 *
 * Por eso la regla es la misma que rige todo el agente: **solo se ofrece lo que
 * se pudo verificar**. Si no hay calendario vinculado no se inventa
 * disponibilidad, se dice que no se puede ver la agenda y se vuelve al camino
 * de siempre —solicitar y que un humano confirme—.
 */

export interface Hueco {
  inicio: Date;
  fin: Date;
}

/** Duración de una visita. Una hora es lo que dura enseñar una casa. */
const DURACION_MIN = Number(process.env.VISIT_DURATION_MINUTES ?? 60);
/** No se ofrece nada antes de este margen: nadie agenda para dentro de diez minutos. */
const MARGEN_MIN = Number(process.env.VISIT_LEAD_TIME_MINUTES ?? 120);

@Injectable()
export class AvailabilityService {
  private readonly log = new Logger(AvailabilityService.name);

  constructor(
    private db: PrismaService,
    private google: GoogleCalendarService,
  ) {}

  /**
   * Devuelve `null` —no una lista vacía— cuando no se puede consultar la
   * agenda. La diferencia importa: vacío significa «está lleno» y nulo
   * significa «no sé», y al prospecto se le dice algo distinto en cada caso.
   */
  async huecos(input: {
    organizationId: string;
    userId: string;
    desde: Date;
    hasta: Date;
    horario?: unknown;
    timezone: string;
  }): Promise<Hueco[] | null> {
    const conexion = await this.db.calendarConnection.findFirst({
      where: {
        organizationId: input.organizationId,
        userId: input.userId,
        status: 'ACTIVE',
        calendarId: { not: null },
      },
      select: { id: true, calendarId: true },
    });
    if (!conexion?.calendarId) return null;

    let ocupado: Hueco[];
    try {
      ocupado = await this.google.freeBusy(
        conexion.id,
        conexion.calendarId,
        input.desde,
        input.hasta,
      );
    } catch (error) {
      // Un fallo de Google no puede convertirse en «está libre»: eso es
      // justamente prometer una hora ocupada.
      this.log.warn(
        `No se pudo leer la agenda de ${input.userId}: ${
          error instanceof Error ? error.message : error
        }`,
      );
      return null;
    }

    // Las citas del propio CRM cuentan como ocupado aunque todavía no hayan
    // llegado al calendario: entre crearlas y sincronizarlas pasa un barrido.
    const citas = await this.db.appointment.findMany({
      where: {
        organizationId: input.organizationId,
        assignedUserId: input.userId,
        status: { in: ['REQUESTED', 'SCHEDULED', 'CONFIRMED'] },
        startsAt: { gte: input.desde, lte: input.hasta },
      },
      select: { startsAt: true, endsAt: true },
    });
    ocupado = ocupado.concat(
      citas.map((c) => ({ inicio: c.startsAt, fin: c.endsAt ?? c.startsAt })),
    );

    return this.librosEn(input.desde, input.hasta, ocupado, input.horario, input.timezone);
  }

  /** Corta la ventana en huecos de una hora que no pisen nada ocupado. */
  private librosEn(
    desde: Date,
    hasta: Date,
    ocupado: Hueco[],
    horario: unknown,
    timezone: string,
  ): Hueco[] {
    const paso = DURACION_MIN * 60_000;
    const minimo = Date.now() + MARGEN_MIN * 60_000;
    const libres: Hueco[] = [];

    // Se avanza en bloques alineados a la hora en punto: proponerle a alguien
    // «el sábado a las 11:17» delata a un robot.
    const primero = new Date(Math.max(desde.getTime(), minimo));
    primero.setMinutes(0, 0, 0);
    if (primero.getTime() < minimo) primero.setTime(primero.getTime() + paso);

    for (let t = primero.getTime(); t + paso <= hasta.getTime(); t += paso) {
      const inicio = new Date(t);
      const fin = new Date(t + paso);

      if (!this.dentroDelHorario(inicio, horario, timezone)) continue;
      const choca = ocupado.some((o) => inicio < o.fin && fin > o.inicio);
      if (choca) continue;

      libres.push({ inicio, fin });
      if (libres.length >= 12) break;
    }
    return libres;
  }

  /**
   * El horario del agente, con la misma forma que ya usa el worker:
   * `{ mon: ["09:00","18:00"], ... }`. Sin horario configurado se asume una
   * jornada normal en vez de 24 horas: ofrecer las 3 de la mañana sería peor
   * que no ofrecer nada.
   */
  private dentroDelHorario(momento: Date, horario: unknown, timezone: string): boolean {
    const partes = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(momento);
    const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
    const dia = valor('weekday').toLowerCase();
    const minutos = Number(valor('hour')) * 60 + Number(valor('minute'));

    const tabla = horario && typeof horario === 'object' ? (horario as Record<string, unknown>) : {};
    const franja = tabla[dia];

    if (!Array.isArray(franja) || franja.length < 2) {
      // Domingo fuera, y de nueve a siete el resto.
      if (dia === 'sun') return false;
      return minutos >= 9 * 60 && minutos + DURACION_MIN <= 19 * 60;
    }
    const abre = toMinutos(String(franja[0]));
    const cierra = toMinutos(String(franja[1]));
    if (abre === undefined || cierra === undefined) return false;
    return minutos >= abre && minutos + DURACION_MIN <= cierra;
  }
}

function toMinutos(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  return Number(match[1]) * 60 + Number(match[2]);
}
