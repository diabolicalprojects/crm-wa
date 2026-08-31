import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarSyncService } from './calendar-sync.service';

/**
 * Reglas de sincronización de visitas (spec §8.7). PostgreSQL es la fuente de
 * verdad: Google es un reflejo, y este servicio debe poder recorrerse muchas
 * veces sin duplicar eventos ni perder citas.
 */

const CITA = {
  id: 'appt-1',
  organizationId: 'org-1',
  assignedUserId: 'user-1',
  status: 'SCHEDULED',
  startsAt: new Date('2026-09-15T17:30:00Z'),
  endsAt: new Date('2026-09-15T18:30:00Z'),
  timezone: 'America/Mexico_City',
  notes: 'Interesado en el jardín',
  personalEventId: null,
  sharedEventId: null,
  lead: { name: 'Humberto Alonso', phone: '5214490000000' },
  property: { title: 'Casa en Jesús María', addressDisplay: 'Real de Minas 74', city: 'Jesús María' },
  organization: { name: 'Horizonte', timezone: 'America/Mexico_City' },
};

const PERSONAL = { id: 'conn-personal', scope: 'PERSONAL', userId: 'user-1', calendarId: 'primary' };
const COMPARTIDO = { id: 'conn-shared', scope: 'SHARED', userId: null, calendarId: 'agencia@grupo' };

describe('sincronización de visitas con Google Calendar', () => {
  let db: any;
  let google: any;
  let sync: CalendarSyncService;

  beforeEach(() => {
    db = {
      appointment: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() },
      calendarConnection: { findMany: vi.fn().mockResolvedValue([PERSONAL, COMPARTIDO]) },
    };
    google = {
      client: vi.fn().mockResolvedValue({ clientId: 'x' }),
      createEvent: vi.fn().mockResolvedValue('evt-nuevo'),
      updateEvent: vi.fn().mockResolvedValue(undefined),
      deleteEvent: vi.fn().mockResolvedValue(undefined),
    };
    sync = new CalendarSyncService(db, google);
  });

  it('no hace nada si el superadministrador no capturó las credenciales', async () => {
    google.client.mockResolvedValue(null);
    const result = await sync.sweep();
    expect(result.skipped).toBe(true);
    expect(db.appointment.findMany).not.toHaveBeenCalled();
  });

  it('crea el evento en el calendario personal y en el compartido, con IDs separados', async () => {
    db.appointment.findMany.mockResolvedValue([CITA]);
    google.createEvent
      .mockResolvedValueOnce('evt-personal')
      .mockResolvedValueOnce('evt-compartido');

    await sync.sweep();

    expect(google.createEvent).toHaveBeenCalledTimes(2);
    expect(db.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      data: expect.objectContaining({
        personalEventId: 'evt-personal',
        sharedEventId: 'evt-compartido',
        syncStatus: 'SYNCED',
      }),
    });
  });

  /** Recorrer dos veces no debe duplicar: si ya hay ID, se actualiza. */
  it('actualiza el evento existente en vez de crear otro', async () => {
    db.appointment.findMany.mockResolvedValue([
      { ...CITA, personalEventId: 'evt-viejo', sharedEventId: 'evt-viejo-2' },
    ]);

    await sync.sweep();

    expect(google.createEvent).not.toHaveBeenCalled();
    expect(google.updateEvent).toHaveBeenCalledTimes(2);
    expect(db.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      data: expect.objectContaining({ personalEventId: 'evt-viejo', syncStatus: 'SYNCED' }),
    });
  });

  /**
   * Al cancelar hay que borrar el evento **y** limpiar el ID: dejarlo vivo
   * haría que un barrido posterior intentara actualizar algo inexistente.
   */
  it('borra el evento al cancelar la visita y limpia los IDs', async () => {
    db.appointment.findMany.mockResolvedValue([
      { ...CITA, status: 'CANCELLED', personalEventId: 'evt-1', sharedEventId: 'evt-2' },
    ]);

    await sync.sweep();

    expect(google.deleteEvent).toHaveBeenCalledTimes(2);
    expect(db.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      data: expect.objectContaining({ personalEventId: null, sharedEventId: null }),
    });
  });

  it('marca NOT_APPLICABLE cuando la agencia no vinculó ningún calendario', async () => {
    db.appointment.findMany.mockResolvedValue([CITA]);
    db.calendarConnection.findMany.mockResolvedValue([]);

    await sync.sweep();

    // Ni PENDING para siempre —ensuciaría las métricas— ni FAILED, porque no
    // hay ningún error: sencillamente no hay a dónde reflejarla.
    expect(db.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      data: { syncStatus: 'NOT_APPLICABLE', lastSyncError: null },
    });
    expect(google.createEvent).not.toHaveBeenCalled();
  });

  it('refleja solo en el compartido si el asesor no vinculó el suyo', async () => {
    db.appointment.findMany.mockResolvedValue([CITA]);
    db.calendarConnection.findMany.mockResolvedValue([COMPARTIDO]);

    await sync.sweep();

    expect(google.createEvent).toHaveBeenCalledTimes(1);
    expect(google.createEvent).toHaveBeenCalledWith('conn-shared', 'agencia@grupo', expect.anything());
  });

  it('guarda el error sin dejar la cita reintentando en bucle', async () => {
    db.appointment.findMany.mockResolvedValue([CITA]);
    google.createEvent.mockRejectedValue(new Error('403 permisos revocados'));

    const result = await sync.sweep();

    expect(result.procesadas).toBe(0);
    expect(db.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appt-1' },
      data: expect.objectContaining({
        syncStatus: 'FAILED',
        lastSyncError: expect.stringContaining('403'),
      }),
    });
  });

  it('una cita fallida no detiene a las demás del lote', async () => {
    db.appointment.findMany.mockResolvedValue([
      { ...CITA, id: 'rota' },
      { ...CITA, id: 'buena' },
    ]);
    google.createEvent
      .mockRejectedValueOnce(new Error('falla'))
      .mockResolvedValue('evt-ok');

    const result = await sync.sweep();

    expect(result.procesadas).toBe(1);
    expect(db.appointment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'buena' } }),
    );
  });

  /** §13.5: una visita solicitada por la IA no es una visita confirmada. */
  it('marca en el título las visitas que el asesor aún no confirmó', async () => {
    db.appointment.findMany.mockResolvedValue([{ ...CITA, status: 'REQUESTED' }]);

    await sync.sweep();

    const evento = google.createEvent.mock.calls[0][2];
    expect(evento.summary).toMatch(/^\[Por confirmar\]/);
    expect(evento.description).toMatch(/Falta confirmarla en el CRM/);
  });

  it('lleva el contexto del prospecto y la propiedad al evento', async () => {
    db.appointment.findMany.mockResolvedValue([CITA]);

    await sync.sweep();

    const evento = google.createEvent.mock.calls[0][2];
    expect(evento.summary).toContain('Humberto Alonso');
    expect(evento.summary).toContain('Casa en Jesús María');
    expect(evento.description).toContain('5214490000000');
    expect(evento.description).toContain('Interesado en el jardín');
    expect(evento.location).toBe('Real de Minas 74');
    expect(evento.timezone).toBe('America/Mexico_City');
  });

  it('no corre dos barridos a la vez, que duplicarían eventos', async () => {
    let resolver: (value: any) => void = () => {};
    db.appointment.findMany.mockReturnValue(new Promise((resolve) => { resolver = resolve; }));

    const primero = sync.sweep();
    const segundo = await sync.sweep();

    expect(segundo).toEqual({ skipped: true, procesadas: 0 });
    resolver([]);
    await primero;
  });
});
