import {
  BadRequestException, Body, Controller, Delete, Get, NotFoundException,
  Param, Patch, Post, Query, Res,
} from '@nestjs/common';
import { CalendarScope } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUrl, Length } from 'class-validator';
import { sign, verify } from 'jsonwebtoken';
import type { Response } from 'express';
import { AuthUser, CurrentUser, Public, Roles } from './auth';
import { loadConfig } from './config';
import { GoogleCalendarService } from './google-calendar.service';
import { PrismaService } from './prisma.service';
import { SecretsService } from './secrets.service';
import { TenantId } from './tenant';

class GoogleClientDto {
  @IsString() @Length(10, 200) clientId!: string;
  @IsString() @Length(10, 200) clientSecret!: string;
  @IsUrl({ require_tld: false }) redirectUri!: string;
}

class StartDto {
  @IsEnum(CalendarScope) scope!: CalendarScope;
}

class SelectCalendarDto {
  @IsString() calendarId!: string;
}

/* ------------------------------------------------- credenciales del cliente */

/**
 * Credenciales OAuth de Google, una por despliegue.
 *
 * Viven aquí y no en variables de entorno para que capturarlas o rotarlas no
 * exija un redespliegue, y para que queden cifradas como cualquier otro
 * secreto del sistema.
 */
@Roles('SUPER_ADMIN')
@Controller('admin/google')
export class GoogleClientController {
  constructor(
    private db: PrismaService,
    private secrets: SecretsService,
    private google: GoogleCalendarService,
  ) {}

  /** La URI de redirección debe coincidir exactamente con la de Google Cloud. */
  @Get('config')
  async config() {
    const client = await this.db.googleOAuthClient.findFirst({ orderBy: { createdAt: 'desc' } });
    const sugerida = `${loadConfig().publicApiUrl}/api/v1/calendar-connections/google/callback`;
    return {
      configurado: Boolean(client),
      clientId: client?.clientId ?? null,
      redirectUri: client?.redirectUri ?? sugerida,
      redirectUriSugerida: sugerida,
      enabled: client?.enabled ?? false,
      // El secreto nunca vuelve al navegador.
      tieneSecreto: Boolean(client),
    };
  }

  @Post('config')
  async save(@Body() dto: GoogleClientDto) {
    const existente = await this.db.googleOAuthClient.findFirst({ orderBy: { createdAt: 'desc' } });
    const data = {
      clientId: dto.clientId.trim(),
      encryptedClientSecret: this.secrets.encrypt(dto.clientSecret.trim()),
      redirectUri: dto.redirectUri.trim(),
      enabled: true,
    };
    const client = existente
      ? await this.db.googleOAuthClient.update({ where: { id: existente.id }, data })
      : await this.db.googleOAuthClient.create({ data });
    return { id: client.id, clientId: client.clientId, redirectUri: client.redirectUri };
  }

  @Delete('config')
  async remove() {
    await this.db.googleOAuthClient.deleteMany({});
    return { removed: true };
  }
}

/* ----------------------------------------------------- conexiones por usuario */

@Controller('calendar-connections')
export class CalendarController {
  constructor(
    private db: PrismaService,
    private secrets: SecretsService,
    private google: GoogleCalendarService,
  ) {}

  @Get()
  async list(@TenantId() organizationId: string) {
    const connections = await this.db.calendarConnection.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
    // Los tokens nunca salen del backend (spec §11.14.1).
    return connections.map(({ encryptedAccessToken, encryptedRefreshToken, ...rest }) => ({
      ...rest,
      conectado: Boolean(encryptedAccessToken),
    }));
  }

  /**
   * Inicia el consentimiento. El `state` va firmado: sin eso alguien podría
   * completar el flujo con su propia cuenta apuntando a otra agencia.
   */
  @Post('google/start')
  async start(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Body() dto: StartDto,
  ) {
    const state = sign(
      { organizationId, userId: user.id, scope: dto.scope },
      loadConfig().jwtSecret,
      { expiresIn: '10m' },
    );
    return { url: await this.google.authorizationUrl(state) };
  }

  /**
   * Google redirige aquí con el código. Es público por necesidad —el navegador
   * llega sin encabezados— y por eso todo el contexto viaja en el `state`
   * firmado, que se verifica antes de tocar nada.
   */
  @Public()
  @Get('google/callback')
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response) {
    const config = loadConfig();
    const volverA = config.corsOrigins[0] ?? '/';

    try {
      if (!code || !state) throw new BadRequestException('Falta el código o el estado');
      const payload = verify(state, config.jwtSecret) as {
        organizationId: string; userId: string; scope: CalendarScope;
      };

      const tokens = await this.google.exchangeCode(code);
      const email = await this.google.userInfo(tokens.accessToken);
      // En un calendario compartido el dueño es la agencia, no la persona.
      const userId = payload.scope === 'SHARED' ? null : payload.userId;

      const existente = await this.db.calendarConnection.findFirst({
        where: { organizationId: payload.organizationId, userId, scope: payload.scope },
      });

      const data = {
        organizationId: payload.organizationId,
        userId,
        scope: payload.scope,
        externalAccountEmail: email,
        encryptedAccessToken: this.secrets.encrypt(tokens.accessToken),
        // Google solo entrega refresh_token la primera vez: conservar el
        // anterior evita perder la conexión al reconectar.
        ...(tokens.refreshToken
          ? { encryptedRefreshToken: this.secrets.encrypt(tokens.refreshToken) }
          : {}),
        tokenExpiresAt: tokens.expiresAt,
        status: 'ACTIVE' as const,
        lastError: null,
      };

      const connection = existente
        ? await this.db.calendarConnection.update({ where: { id: existente.id }, data })
        : await this.db.calendarConnection.create({ data });

      await this.db.auditLog.create({
        data: {
          organizationId: payload.organizationId,
          userId: payload.userId,
          action: 'CALENDAR_CONNECTED',
          entityType: 'CalendarConnection',
          entityId: connection.id,
          metadata: { scope: payload.scope, cuenta: email ?? null },
        },
      });

      return res.redirect(`${volverA}?calendario=conectado`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      return res.redirect(`${volverA}?calendario=error&detalle=${encodeURIComponent(message.slice(0, 120))}`);
    }
  }

  @Get(':id/calendars')
  async calendars(@TenantId() organizationId: string, @Param('id') id: string) {
    await this.assertOwn(organizationId, id);
    return this.google.listCalendars(id);
  }

  @Patch(':id')
  async select(
    @TenantId() organizationId: string,
    @Param('id') id: string,
    @Body() dto: SelectCalendarDto,
  ) {
    await this.assertOwn(organizationId, id);
    return this.db.calendarConnection.update({
      where: { id },
      data: { calendarId: dto.calendarId },
      select: { id: true, calendarId: true, scope: true, status: true },
    });
  }

  @Delete(':id')
  async disconnect(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Param('id') id: string,
  ) {
    await this.assertOwn(organizationId, id);
    await this.db.calendarConnection.delete({ where: { id } });
    await this.db.auditLog.create({
      data: {
        organizationId,
        userId: user.id,
        action: 'CALENDAR_DISCONNECTED',
        entityType: 'CalendarConnection',
        entityId: id,
      },
    });
    return { disconnected: true };
  }

  private async assertOwn(organizationId: string, id: string) {
    const found = await this.db.calendarConnection.findFirst({
      where: { id, organizationId },
      select: { id: true },
    });
    if (!found) throw new NotFoundException('Conexión de calendario no encontrada');
  }
}
