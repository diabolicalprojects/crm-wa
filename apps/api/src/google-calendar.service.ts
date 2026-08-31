import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SecretsService } from './secrets.service';

/**
 * Adaptador de Google Calendar.
 *
 * El dominio del CRM no habla el formato de Google: esta clase traduce. Las
 * credenciales del cliente OAuth viven cifradas en la base y las administra el
 * superadministrador, igual que los proveedores de IA, para que cambiarlas no
 * exija un redespliegue.
 *
 * Se usa la API REST directamente en vez de `googleapis`: sólo hacen falta
 * cuatro llamadas y esa librería pesa decenas de megabytes.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

/** Mínimo indispensable: leer y escribir eventos, y listar calendarios. */
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

export interface CalendarEventInput {
  summary: string;
  description?: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  location?: string;
}

@Injectable()
export class GoogleCalendarService {
  private readonly log = new Logger(GoogleCalendarService.name);

  constructor(
    private db: PrismaService,
    private secrets: SecretsService,
  ) {}

  /** Configuración vigente, o `null` si el superadministrador no la capturó. */
  async client() {
    const client = await this.db.googleOAuthClient.findFirst({
      where: { enabled: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!client) return null;
    return {
      id: client.id,
      clientId: client.clientId,
      clientSecret: this.secrets.decrypt(client.encryptedClientSecret),
      redirectUri: client.redirectUri,
    };
  }

  private async requireClient() {
    const client = await this.client();
    if (!client) {
      throw new BadRequestException(
        'Google Calendar no está configurado. El superadministrador debe capturar las credenciales OAuth.',
      );
    }
    return client;
  }

  /**
   * URL de consentimiento. El `state` viaja firmado con el mismo secreto de
   * sesión: sin eso, cualquiera podría completar el flujo apuntando a otra
   * agencia y quedarse con su calendario.
   */
  async authorizationUrl(state: string) {
    const client = await this.requireClient();
    const params = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: client.redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      // `offline` y `consent` son lo que garantiza un refresh_token: sin él la
      // conexión muere en una hora y hay que reconectar a mano.
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `${AUTH_URL}?${params}`;
  }

  async exchangeCode(code: string) {
    const client = await this.requireClient();
    return this.token({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      grant_type: 'authorization_code',
    });
  }

  async refresh(refreshToken: string) {
    const client = await this.requireClient();
    return this.token({
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: 'refresh_token',
    });
  }

  private async token(body: Record<string, string>) {
    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });
    const json: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Google respondió ${response.status}: ${json.error_description ?? json.error ?? 'error'}`,
      );
    }
    return {
      accessToken: String(json.access_token),
      refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
      expiresAt: new Date(Date.now() + Number(json.expires_in ?? 3600) * 1000),
    };
  }

  /**
   * Devuelve un token válido, renovándolo si hace falta. Se renueva un minuto
   * antes de vencer para que una llamada en curso no falle por el borde.
   */
  async accessTokenFor(connectionId: string): Promise<string> {
    const connection = await this.db.calendarConnection.findUnique({ where: { id: connectionId } });
    if (!connection?.encryptedAccessToken) {
      throw new BadRequestException('La conexión de calendario no está completa');
    }

    const vigente =
      connection.tokenExpiresAt && connection.tokenExpiresAt.getTime() - 60_000 > Date.now();
    if (vigente) return this.secrets.decrypt(connection.encryptedAccessToken);

    if (!connection.encryptedRefreshToken) {
      await this.db.calendarConnection.update({
        where: { id: connectionId },
        data: { status: 'EXPIRED', lastError: 'Sin refresh token: hay que reconectar el calendario' },
      });
      throw new BadRequestException('La conexión venció; vuelve a conectar el calendario');
    }

    const renovado = await this.refresh(this.secrets.decrypt(connection.encryptedRefreshToken));
    await this.db.calendarConnection.update({
      where: { id: connectionId },
      data: {
        encryptedAccessToken: this.secrets.encrypt(renovado.accessToken),
        tokenExpiresAt: renovado.expiresAt,
        status: 'ACTIVE',
        lastError: null,
      },
    });
    return renovado.accessToken;
  }

  private async call(token: string, path: string, init: RequestInit = {}) {
    const response = await fetch(`${CALENDAR_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ServiceUnavailableException(
        `Google Calendar respondió ${response.status}: ${detail.slice(0, 200)}`,
      );
    }
    return response.status === 204 ? undefined : response.json();
  }

  async listCalendars(connectionId: string) {
    const token = await this.accessTokenFor(connectionId);
    const result: any = await this.call(token, '/users/me/calendarList?minAccessRole=writer');
    return (result?.items ?? []).map((item: any) => ({
      id: String(item.id),
      name: String(item.summary ?? item.id),
      primary: Boolean(item.primary),
    }));
  }

  async userInfo(accessToken: string): Promise<string | undefined> {
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json: any = await response.json();
      return json?.email;
    } catch {
      return undefined;
    }
  }

  private toGoogleEvent(input: CalendarEventInput) {
    return {
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: { dateTime: input.startsAt.toISOString(), timeZone: input.timezone },
      end: { dateTime: input.endsAt.toISOString(), timeZone: input.timezone },
    };
  }

  async createEvent(connectionId: string, calendarId: string, input: CalendarEventInput) {
    const token = await this.accessTokenFor(connectionId);
    const event: any = await this.call(token, `/calendars/${encodeURIComponent(calendarId)}/events`, {
      method: 'POST',
      body: JSON.stringify(this.toGoogleEvent(input)),
    });
    return String(event.id);
  }

  async updateEvent(connectionId: string, calendarId: string, eventId: string, input: CalendarEventInput) {
    const token = await this.accessTokenFor(connectionId);
    await this.call(
      token,
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: 'PATCH', body: JSON.stringify(this.toGoogleEvent(input)) },
    );
  }

  /** Borrar un evento ya borrado devuelve 410; no es un fallo real. */
  async deleteEvent(connectionId: string, calendarId: string, eventId: string) {
    const token = await this.accessTokenFor(connectionId);
    try {
      await this.call(
        token,
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
        { method: 'DELETE' },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!/ 4(10|04)/.test(message)) throw error;
      this.log.log(`El evento ${eventId} ya no existía en Google; se ignora`);
    }
  }
}
