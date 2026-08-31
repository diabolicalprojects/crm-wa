import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoogleCalendarService } from './google-calendar.service';
import { SecretsService } from './secrets.service';

/**
 * Ciclo de vida del token de Google.
 *
 * Es donde un error rompe la sincronización en silencio: si no se renueva, la
 * conexión muere en una hora; si se renueva de más, se gasta cuota; y si se
 * pierde el `refresh_token`, hay que reconectar a mano sin que nadie avise.
 */
describe('adaptador de Google Calendar', () => {
  const secrets = new SecretsService();
  let db: any;
  let google: GoogleCalendarService;

  const CLIENT = {
    id: 'gc-1',
    clientId: 'cliente.apps.googleusercontent.com',
    encryptedClientSecret: secrets.encrypt('secreto-de-google'),
    redirectUri: 'https://crm.example.com/api/v1/calendar-connections/google/callback',
    enabled: true,
  };

  beforeEach(() => {
    db = {
      googleOAuthClient: { findFirst: vi.fn().mockResolvedValue(CLIENT) },
      calendarConnection: { findUnique: vi.fn(), update: vi.fn() },
    };
    google = new GoogleCalendarService(db, secrets);
  });

  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('descifra el secreto solo del lado del servidor', async () => {
    const client = await google.client();
    expect(client?.clientSecret).toBe('secreto-de-google');
    // Y lo guardado nunca es el texto plano.
    expect(CLIENT.encryptedClientSecret).not.toContain('secreto-de-google');
  });

  it('avisa con claridad cuando nadie configuró las credenciales', async () => {
    db.googleOAuthClient.findFirst.mockResolvedValue(null);
    expect(await google.client()).toBeNull();
    await expect(google.authorizationUrl('estado')).rejects.toThrow(/no está configurado/);
  });

  /**
   * `access_type=offline` y `prompt=consent` son lo que garantiza un
   * refresh_token. Sin él la conexión muere en una hora.
   */
  it('pide consentimiento con acceso sin conexión para obtener refresh token', async () => {
    const url = new URL(await google.authorizationUrl('mi-estado-firmado'));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('mi-estado-firmado');
    expect(url.searchParams.get('redirect_uri')).toBe(CLIENT.redirectUri);
    expect(url.searchParams.get('scope')).toContain('calendar.events');
  });

  it('reutiliza el token vigente en vez de renovarlo cada vez', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    db.calendarConnection.findUnique.mockResolvedValue({
      id: 'conn-1',
      encryptedAccessToken: secrets.encrypt('token-vigente'),
      encryptedRefreshToken: secrets.encrypt('refresh-1'),
      tokenExpiresAt: new Date(Date.now() + 30 * 60_000),
    });

    expect(await google.accessTokenFor('conn-1')).toBe('token-vigente');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** Se renueva un minuto antes de vencer para que no falle por el borde. */
  it('renueva el token a punto de vencer y guarda el nuevo cifrado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ access_token: 'token-nuevo', expires_in: 3600 }),
    }));
    db.calendarConnection.findUnique.mockResolvedValue({
      id: 'conn-1',
      encryptedAccessToken: secrets.encrypt('token-viejo'),
      encryptedRefreshToken: secrets.encrypt('refresh-1'),
      // Vence en 30 segundos: dentro del margen.
      tokenExpiresAt: new Date(Date.now() + 30_000),
    });

    expect(await google.accessTokenFor('conn-1')).toBe('token-nuevo');

    const guardado = db.calendarConnection.update.mock.calls[0][0].data;
    expect(guardado.status).toBe('ACTIVE');
    expect(guardado.encryptedAccessToken).not.toContain('token-nuevo');
    expect(secrets.decrypt(guardado.encryptedAccessToken)).toBe('token-nuevo');
  });

  it('marca la conexión como vencida si no hay refresh token que usar', async () => {
    db.calendarConnection.findUnique.mockResolvedValue({
      id: 'conn-1',
      encryptedAccessToken: secrets.encrypt('token-viejo'),
      encryptedRefreshToken: null,
      tokenExpiresAt: new Date(Date.now() - 1000),
    });

    await expect(google.accessTokenFor('conn-1')).rejects.toBeInstanceOf(BadRequestException);
    // Queda registrado para que la interfaz pueda pedir reconectar.
    expect(db.calendarConnection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: expect.objectContaining({ status: 'EXPIRED' }),
    });
  });

  it('propaga el motivo cuando Google rechaza la renovación', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'invalid_grant', error_description: 'Token revocado' }),
    }));
    db.calendarConnection.findUnique.mockResolvedValue({
      id: 'conn-1',
      encryptedAccessToken: secrets.encrypt('viejo'),
      encryptedRefreshToken: secrets.encrypt('refresh-revocado'),
      tokenExpiresAt: new Date(Date.now() - 1000),
    });

    await expect(google.accessTokenFor('conn-1')).rejects.toThrow(/Token revocado/);
  });

  /** Borrar algo ya borrado no es un fallo: Google responde 410. */
  it('tolera borrar un evento que ya no existe', async () => {
    db.calendarConnection.findUnique.mockResolvedValue({
      id: 'conn-1',
      encryptedAccessToken: secrets.encrypt('token'),
      tokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 410, text: () => Promise.resolve('Resource has been deleted'),
    }));

    await expect(google.deleteEvent('conn-1', 'primary', 'evt-1')).resolves.toBeUndefined();
  });

  it('sí propaga un error real al borrar', async () => {
    db.calendarConnection.findUnique.mockResolvedValue({
      id: 'conn-1',
      encryptedAccessToken: secrets.encrypt('token'),
      tokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403, text: () => Promise.resolve('Insufficient permissions'),
    }));

    await expect(google.deleteEvent('conn-1', 'primary', 'evt-1')).rejects.toThrow(/403/);
  });

  it('traduce la cita al formato de Google con su zona horaria', async () => {
    db.calendarConnection.findUnique.mockResolvedValue({
      id: 'conn-1',
      encryptedAccessToken: secrets.encrypt('token'),
      tokenExpiresAt: new Date(Date.now() + 60 * 60_000),
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({ id: 'evt-creado' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const id = await google.createEvent('conn-1', 'primary', {
      summary: 'Visita · Humberto',
      startsAt: new Date('2026-09-15T17:30:00Z'),
      endsAt: new Date('2026-09-15T18:30:00Z'),
      timezone: 'America/Mexico_City',
    });

    expect(id).toBe('evt-creado');
    const enviado = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(enviado.start).toEqual({
      dateTime: '2026-09-15T17:30:00.000Z',
      timeZone: 'America/Mexico_City',
    });
  });
});
