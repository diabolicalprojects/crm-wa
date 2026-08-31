import { Controller, Sse } from '@nestjs/common';
import { map, type Observable } from 'rxjs';
import { EventsService, type LiveEvent } from './events.service';
import { TenantId } from './tenant';

/**
 * Flujo de eventos en vivo para la bandeja.
 *
 * El navegador se conecta con `fetch` y lee el cuerpo como flujo, en vez de
 * `EventSource`: esa API no permite enviar encabezados, y la alternativa sería
 * pasar el token por la URL, donde queda registrado en logs e historial.
 */
@Controller('events')
export class EventsController {
  constructor(private events: EventsService) {}

  @Sse('stream')
  stream(@TenantId() organizationId: string): Observable<{ data: LiveEvent }> {
    return this.events.stream(organizationId).pipe(map((event) => ({ data: event })));
  }
}
