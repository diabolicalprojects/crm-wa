'use client';
import { useEffect, useRef } from 'react';
import { token } from './api';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export type LiveEvent =
  | { type: 'message.created'; conversationId: string; leadId: string }
  | { type: 'conversation.updated'; conversationId: string; mode?: string; status?: string }
  | { type: 'session.updated'; sessionId: string; status: string }
  | { type: 'ping' };

/**
 * Suscripción al flujo de eventos del servidor.
 *
 * Se lee con `fetch` en vez de `EventSource` porque esa API no admite
 * encabezados, y la alternativa sería mandar el token en la URL, donde queda
 * en logs de proxy e historial del navegador.
 *
 * Reconecta sola con espera creciente: la conexión se cae en cada despliegue y
 * la bandeja debe recuperarse sin que el asesor recargue.
 */
export function useLiveEvents(onEvent: (event: LiveEvent) => void, enabled = true) {
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const controller = new AbortController();
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;
    let closed = false;

    async function connect() {
      try {
        const organizationId = localStorage.getItem('crm_org') || '';
        const response = await fetch(`${API}/events/stream`, {
          signal: controller.signal,
          headers: {
            Accept: 'text/event-stream',
            Authorization: `Bearer ${token()}`,
            ...(organizationId ? { 'x-organization-id': organizationId } : {}),
          },
        });
        if (!response.ok || !response.body) throw new Error(`stream ${response.status}`);

        retry = 0;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!closed) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Los eventos SSE se separan por línea en blanco; puede llegar más de
          // uno en el mismo trozo, o uno partido entre dos.
          const chunks = buffer.split('\n\n');
          buffer = chunks.pop() ?? '';
          for (const chunk of chunks) {
            const line = chunk.split('\n').find((item) => item.startsWith('data:'));
            if (!line) continue;
            try {
              const event = JSON.parse(line.slice(5).trim()) as LiveEvent;
              if (event.type !== 'ping') handler.current(event);
            } catch {
              // Un trozo mal formado no debe tumbar la suscripción.
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted || closed) return;
      }

      if (closed) return;
      // Espera creciente hasta 30 s para no martillar un servidor que reinicia.
      retry = Math.min(retry + 1, 6);
      timer = setTimeout(connect, Math.min(1000 * 2 ** retry, 30000));
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled]);
}
