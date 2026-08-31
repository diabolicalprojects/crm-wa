import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';
import { Observable } from 'rxjs';

/**
 * Difusión de eventos en vivo hacia la bandeja (spec §9.1 y §20.4).
 *
 * La spec admite WebSocket o Server-Sent Events; se eligió SSE porque el flujo
 * es de una sola dirección —el servidor empuja, el navegador escucha— y atraviesa
 * Traefik sin configuración de upgrade, que es una fuente conocida de fallas en
 * este despliegue.
 *
 * El bus es en memoria a propósito: el webhook, el worker de IA y este endpoint
 * viven en el mismo proceso de Nest, así que basta. **Si algún día se levanta
 * más de una réplica de `crm-api`, hay que cambiarlo por pub/sub de Redis**,
 * porque un evento nacido en una réplica no llegaría a los clientes conectados
 * a las otras.
 */

export type LiveEvent =
  | { type: 'message.created'; conversationId: string; leadId: string }
  | { type: 'conversation.updated'; conversationId: string; mode?: string; status?: string }
  | { type: 'session.updated'; sessionId: string; status: string }
  | { type: 'ping' };

@Injectable()
export class EventsService {
  private readonly bus = new EventEmitter();
  private readonly log = new Logger(EventsService.name);

  constructor() {
    // Cada cliente conectado añade un oyente; el tope por defecto de Node (10)
    // dispararía una advertencia de fuga con pocos asesores en línea.
    this.bus.setMaxListeners(0);
  }

  publish(organizationId: string, event: LiveEvent) {
    if (!organizationId) return;
    this.bus.emit(organizationId, event);
  }

  /** Flujo de eventos de una agencia. Nunca cruza datos entre tenants. */
  stream(organizationId: string): Observable<LiveEvent> {
    return new Observable<LiveEvent>((subscriber) => {
      const onEvent = (event: LiveEvent) => subscriber.next(event);
      this.bus.on(organizationId, onEvent);

      // Latido: mantiene viva la conexión a través de proxies que cierran
      // conexiones ociosas, y permite al navegador detectar una caída.
      const heartbeat = setInterval(() => subscriber.next({ type: 'ping' }), 25000);

      return () => {
        clearInterval(heartbeat);
        this.bus.off(organizationId, onEvent);
      };
    });
  }

  /** Oyentes conectados por agencia, para diagnóstico. */
  connections(organizationId: string) {
    return this.bus.listenerCount(organizationId);
  }
}
