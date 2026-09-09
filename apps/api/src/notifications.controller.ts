import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { NotificationKind } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsObject, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from './auth';
import { ETIQUETAS, PREFS_POR_OMISION, canalesDe } from './notifications.service';
import { PrismaService } from './prisma.service';
import { TenantId } from './tenant';

class ListDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) take?: number;
}

class MarkDto {
  /** Vacío marca todas. Es el gesto que la gente hace con una campana. */
  @IsOptional() @IsArray() @IsString({ each: true }) ids?: string[];
}

class PrefsDto {
  @IsOptional() @IsObject() canales?: Record<string, string[]>;

  /**
   * El número al que avisar. Lo captura la propia persona: mandar avisos a un
   * número que alguien más escribió por ella acaba avisándole a un desconocido.
   */
  @IsOptional() @Matches(/^[\d\s+()-]{0,20}$/, { message: 'El teléfono solo admite dígitos y separadores' })
  phone?: string;
}

@Controller('notifications')
export class NotificationsController {
  constructor(private db: PrismaService) {}

  @Get()
  async list(@CurrentUser() user: AuthUser, @Query() query: ListDto) {
    const [items, sinLeer] = await Promise.all([
      this.db.notification.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: query.take ?? 30,
      }),
      this.db.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);
    return { items, sinLeer };
  }

  @Post('read')
  async read(@CurrentUser() user: AuthUser, @Body() dto: MarkDto) {
    // Siempre acotado al propio usuario: un identificador de otra persona no
    // marca nada, en vez de fallar y decir que existía.
    const { count } = await this.db.notification.updateMany({
      where: {
        userId: user.id,
        readAt: null,
        ...(dto.ids?.length ? { id: { in: dto.ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    return { marcadas: count };
  }

  @Get('preferencias')
  async prefs(@CurrentUser() user: AuthUser, @TenantId() organizationId: string) {
    const [miembro, persona] = await Promise.all([
      this.db.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId: user.id } },
        select: { notificationPrefs: true },
      }),
      this.db.user.findUnique({
        where: { id: user.id },
        select: { notificationPhone: true },
      }),
    ]);

    const canales: Record<string, string[]> = {};
    for (const kind of Object.keys(PREFS_POR_OMISION) as NotificationKind[]) {
      canales[kind] = canalesDe(miembro?.notificationPrefs, kind);
    }
    return { canales, etiquetas: ETIQUETAS, phone: persona?.notificationPhone ?? '' };
  }

  @Put('preferencias')
  async savePrefs(
    @CurrentUser() user: AuthUser,
    @TenantId() organizationId: string,
    @Body() dto: PrefsDto,
  ) {
    const limpio: Record<string, string[]> = {};
    for (const [kind, canales] of Object.entries(dto.canales ?? {})) {
      if (!(kind in PREFS_POR_OMISION)) continue;
      limpio[kind] = (Array.isArray(canales) ? canales : []).filter(
        (c) => c === 'APP' || c === 'WHATSAPP',
      );
    }

    await this.db.$transaction([
      this.db.organizationMember.update({
        where: { organizationId_userId: { organizationId, userId: user.id } },
        data: { notificationPrefs: limpio },
      }),
      this.db.user.update({
        where: { id: user.id },
        data: { notificationPhone: dto.phone?.trim() || null },
      }),
    ]);
    return { canales: limpio, phone: dto.phone?.trim() ?? '' };
  }
}
