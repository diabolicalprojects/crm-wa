import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { GoogleCalendarService, type CalendarEventInput } from './google-calendar.service';
import { PrismaService } from './prisma.service';

/**
 * Sincronización de visitas con Google Calendar (spec §8.7).
 *
 * PostgreSQL es la fuente de verdad: la visita se crea primero ahí y este
 * worker la refleja después en el calendario personal del asesor y en el
 * compartido de la agencia, guardando ambos IDs por separado. Si Google falla,
 * la cita queda en `SYNC_PENDING` y se reintenta; nunca se pierde.
 *
 * Corre por sondeo y no por cola porque la operación es idempotente —se apoya
 * en los IDs de evento ya guardados— y un barrido periódico recupera solo lo
 * que se quedó atrás, incluso tras un reinicio a media sincronización.
 */

const INTERVAL_MS = Number(process.env.CALENDAR_SYNC_INTERVAL_MS ?? 60_000);
const BATCH = 20;

@Injectable()
export class CalendarSyncService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private corriendo = false;
  private readonly log = new Logger(CalendarSyncService.name);

  constructor(
    private db: PrismaService,
    private google: GoogleCalendarService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      this.sweep().catch((error) => this.log.error(`Barrido falló: ${error.message}`));
    }, INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Procesa las citas pendientes. Público para poder dispararlo a mano. */
  async sweep() {
    // Un solo barrido a la vez: dos concurrentes crearían eventos duplicados
    // en la ventana entre leer y guardar el ID. El indicador se levanta antes
    // de cualquier `await`; comprobarlo y activarlo con una espera en medio
    // deja pasar a ambos.
    if (this.corriendo) return { skipped: true, procesadas: 0 };
    this.corriendo = true;

    try {
      if (!(await this.google.client())) return { skipped: true, procesadas: 0 };

      const pendientes = await this.db.appointment.findMany({
        where: { syncStatus: 'PENDING' },
        include: {
          lead: { select: { name: true, phone: true } },
          property: { select: { title: true, addressDisplay: true, city: true } },
          organization: { select: { name: true, timezone: true } },
        },
        orderBy: { updatedAt: 'asc' },
        take: BATCH,
      });

      let procesadas = 0;
      for (const cita of pendientes) {
        try {
          await this.syncOne(cita);
          procesadas++;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'error desconocido';
          await this.db.appointment.update({
            where: { id: cita.id },
            // Queda FAILED, no PENDING: reintentar en bucle un error permanente
            // —permisos revocados, calendario borrado— gastaría cuota sin fin.
            // Cualquier edición de la cita la devuelve a PENDING.
            data: { syncStatus: 'FAILED', lastSyncError: message.slice(0, 400) },
          });
          this.log.warn(`Visita ${cita.id} no se sincronizó: ${message}`);
        }
      }
      return { skipped: false, procesadas };
    } finally {
      this.corriendo = false;
    }
  }

  private async syncOne(cita: any) {
    const conexiones = await this.db.calendarConnection.findMany({
      where: { organizationId: cita.organizationId, status: 'ACTIVE', calendarId: { not: null } },
    });

    const personal = conexiones.find((c) => c.scope === 'PERSONAL' && c.userId === cita.assignedUserId);
    const compartido = conexiones.find((c) => c.scope === 'SHARED');

    if (!personal && !compartido) {
      // Sin ningún calendario vinculado no hay nada que reflejar; marcarla como
      // pendiente para siempre ensuciaría las métricas de sincronización.
      await this.db.appointment.update({
        where: { id: cita.id },
        data: { syncStatus: 'NOT_APPLICABLE', lastSyncError: null },
      });
      return;
    }

    const cancelada = cita.status === 'CANCELLED';
    const evento = this.toEvent(cita);

    const personalEventId = personal
      ? await this.reflejar(personal, cita.personalEventId, evento, cancelada)
      : cita.personalEventId;

    const sharedEventId = compartido
      ? await this.reflejar(compartido, cita.sharedEventId, evento, cancelada)
      : cita.sharedEventId;

    await this.db.appointment.update({
      where: { id: cita.id },
      data: {
        personalEventId,
        sharedEventId,
        syncStatus: 'SYNCED',
        lastSyncedAt: new Date(),
        lastSyncError: null,
      },
    });
  }

  /**
   * Crea, actualiza o borra según corresponda. Devuelve el ID del evento, o
   * `null` si se eliminó — así una cancelación no deja un ID muerto que un
   * barrido posterior intentaría actualizar.
   */
  private async reflejar(
    conexion: any,
    eventId: string | null,
    evento: CalendarEventInput,
    cancelada: boolean,
  ): Promise<string | null> {
    if (cancelada) {
      if (eventId) await this.google.deleteEvent(conexion.id, conexion.calendarId, eventId);
      return null;
    }
    if (eventId) {
      await this.google.updateEvent(conexion.id, conexion.calendarId, eventId, evento);
      return eventId;
    }
    return this.google.createEvent(conexion.id, conexion.calendarId, evento);
  }

  private toEvent(cita: any): CalendarEventInput {
    const prospecto = cita.lead?.name || cita.lead?.phone || 'Prospecto';
    const propiedad = cita.property?.title;
    const solicitada = cita.status === 'REQUESTED';

    return {
      // El prefijo avisa de un vistazo que el asesor todavía no la confirmó.
      summary: `${solicitada ? '[Por confirmar] ' : ''}Visita · ${prospecto}${propiedad ? ` · ${propiedad}` : ''}`,
      description: [
        `Prospecto: ${prospecto}`,
        cita.lead?.phone ? `Teléfono: +${cita.lead.phone}` : null,
        propiedad ? `Propiedad: ${propiedad}` : null,
        cita.notes ? `Notas: ${cita.notes}` : null,
        solicitada ? 'Solicitada por el agente de IA. Falta confirmarla en el CRM.' : null,
      ]
        .filter(Boolean)
        .join('\n'),
      location: cita.property?.addressDisplay ?? cita.property?.city ?? undefined,
      startsAt: cita.startsAt,
      endsAt: cita.endsAt,
      timezone: cita.timezone || cita.organization?.timezone || 'America/Mexico_City',
    };
  }
}
