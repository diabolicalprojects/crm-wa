import { Injectable, Logger } from '@nestjs/common';
import { NotificationKind } from '@prisma/client';
import { EventsService } from './events.service';
import { OpenWaGateway } from './openwa.gateway';
import { PrismaService } from './prisma.service';

/**
 * Avisos a las personas de la agencia (§14.3).
 *
 * Dos canales, y son los dos que esta infraestructura puede sostener hoy:
 *
 * - **En la consola.** Siempre. El aviso se guarda aunque además salga por otro
 *   lado, porque uno que solo existió como mensaje no se puede volver a leer.
 * - **Por WhatsApp**, al número que la propia persona capturó. Opcional.
 *
 * No hay correo: no hay SMTP en esta infraestructura, y un canal que falla en
 * silencio es peor que uno que no se ofrece.
 */

export type Canal = 'APP' | 'WHATSAPP';

/**
 * Qué recibe cada quien si no ha tocado nada. Se eligió por lo que la gente
 * agradece y no por lo que se puede mandar: el aviso de prospecto nuevo llega
 * por WhatsApp porque es el que hay que ver sin abrir la consola; el resto
 * espera a que alguien la abra.
 */
export const PREFS_POR_OMISION: Record<NotificationKind, Canal[]> = {
  LEAD_NUEVO: ['APP', 'WHATSAPP'],
  HANDOFF: ['APP', 'WHATSAPP'],
  VISITA_SOLICITADA: ['APP'],
  CONVERSACION_ASIGNADA: ['APP'],
  CANAL_CAIDO: ['APP'],
};

export const ETIQUETAS: Record<NotificationKind, string> = {
  LEAD_NUEVO: 'Un prospecto nuevo escribió',
  HANDOFF: 'La IA pidió que tomes una conversación',
  VISITA_SOLICITADA: 'Hay una visita por confirmar',
  CONVERSACION_ASIGNADA: 'Te asignaron una conversación',
  CANAL_CAIDO: 'Un número de WhatsApp se desconectó',
};

export interface AvisoInput {
  organizationId: string;
  /** A quién. Vacío no es error: hay eventos sin destinatario claro. */
  userIds: (string | null | undefined)[];
  kind: NotificationKind;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
  /** Quien provocó el evento: nunca se avisa a sí mismo. */
  actorId?: string | null;
}

export function canalesDe(prefs: unknown, kind: NotificationKind): Canal[] {
  const raw = prefs && typeof prefs === 'object' && !Array.isArray(prefs)
    ? (prefs as Record<string, unknown>)[kind]
    : undefined;
  if (!Array.isArray(raw)) return PREFS_POR_OMISION[kind] ?? ['APP'];
  const validos = raw.filter((c): c is Canal => c === 'APP' || c === 'WHATSAPP');
  return validos;
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);

  constructor(
    private db: PrismaService,
    private events: EventsService,
    private openwa: OpenWaGateway,
  ) {}

  async notify(input: AvisoInput) {
    const destinatarios = [...new Set(input.userIds.filter(Boolean) as string[])].filter(
      (id) => id !== input.actorId,
    );
    if (!destinatarios.length) return { avisados: 0 };

    const miembros = await this.db.organizationMember.findMany({
      where: {
        organizationId: input.organizationId,
        userId: { in: destinatarios },
        status: 'ACTIVE',
      },
      select: {
        userId: true,
        notificationPrefs: true,
        user: { select: { notificationPhone: true } },
      },
    });

    let avisados = 0;
    for (const miembro of miembros) {
      const canales = canalesDe(miembro.notificationPrefs, input.kind);
      if (!canales.length) continue;

      if (canales.includes('APP')) {
        await this.db.notification.create({
          data: {
            organizationId: input.organizationId,
            userId: miembro.userId,
            kind: input.kind,
            title: input.title.slice(0, 200),
            body: input.body?.slice(0, 500),
            entityType: input.entityType,
            entityId: input.entityId,
          },
        });
      }

      if (canales.includes('WHATSAPP') && miembro.user.notificationPhone) {
        // Un fallo al avisar no puede tumbar lo que provocó el aviso: el
        // prospecto ya escribió y su mensaje ya está guardado.
        await this.porWhatsapp(input, miembro.user.notificationPhone).catch((error) =>
          this.log.warn(
            `No se pudo avisar por WhatsApp a ${miembro.userId}: ${
              error instanceof Error ? error.message : error
            }`,
          ),
        );
      }
      avisados += 1;
    }

    // La consola recarga su campana con esto, sin sondear.
    if (avisados) {
      this.events.publish(input.organizationId, { type: 'notification.created' });
    }
    return { avisados };
  }

  /**
   * Sale por cualquier canal conectado de la agencia. No importa cuál: el
   * destinatario es del equipo, no un prospecto, y la conversación con él no
   * vive en el CRM.
   */
  private async porWhatsapp(input: AvisoInput, phone: string) {
    const session = await this.db.whatsappSession.findFirst({
      where: {
        organizationId: input.organizationId,
        status: 'CONNECTED',
        providerSessionId: { not: null },
      },
      select: { providerSessionId: true },
    });
    if (!session?.providerSessionId) return;

    const numero = phone.replace(/\D/g, '');
    if (numero.length < 10) return;

    await this.openwa.sendText({
      providerSessionId: session.providerSessionId,
      chatId: `${numero}@c.us`,
      text: input.body ? `*${input.title}*\n${input.body}` : `*${input.title}*`,
    });
  }
}
