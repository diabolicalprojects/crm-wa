'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from './ui';
import { request } from '../lib/api';
import { useLiveEvents } from '../lib/live';
import { relative } from '../lib/format';

/**
 * La campana de avisos.
 *
 * Se recarga por el mismo canal en vivo que la bandeja, no sondeando: un aviso
 * que tarda treinta segundos en aparecer no sirve para lo único que sirve un
 * aviso.
 */

type Aviso = {
  id: string;
  kind: string;
  title: string;
  body?: string | null;
  readAt?: string | null;
  createdAt: string;
};

const ICONO: Record<string, string> = {
  LEAD_NUEVO: 'chat',
  HANDOFF: 'users',
  VISITA_SOLICITADA: 'calendar',
  CONVERSACION_ASIGNADA: 'inbox',
  CANAL_CAIDO: 'alert',
};

export function Bell({ onOpenConversations }: { onOpenConversations?: () => void }) {
  const [items, setItems] = useState<Aviso[]>([]);
  const [sinLeer, setSinLeer] = useState(0);
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    request('/notifications?take=20')
      .then((data) => {
        setItems(data.items ?? []);
        setSinLeer(data.sinLeer ?? 0);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => { load(); }, [load]);

  useLiveEvents((evento) => {
    if (evento.type === 'notification.created') load();
  });

  // Cerrar al tocar fuera y con Escape: sin esto el panel se queda abierto
  // encima de la pantalla y hay que adivinar cómo quitarlo.
  useEffect(() => {
    if (!abierto) return;
    const fuera = (event: MouseEvent) => {
      if (caja.current && !caja.current.contains(event.target as Node)) setAbierto(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    window.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', fuera);
      window.removeEventListener('keydown', escape);
    };
  }, [abierto]);

  async function marcarTodo() {
    try {
      await request('/notifications/read', { method: 'POST', body: JSON.stringify({}) });
      load();
    } catch {
      // Marcar como leído no es una acción que valga interrumpir a nadie.
    }
  }

  return (
    <div className="bell" ref={caja}>
      <button
        className="btn btn-ghost btn-icon"
        aria-label={sinLeer ? `Avisos, ${sinLeer} sin leer` : 'Avisos'}
        aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)}
      >
        <Icon name="alert" />
        {sinLeer > 0 && <span className="bell-count">{sinLeer > 9 ? '9+' : sinLeer}</span>}
      </button>

      {abierto && (
        <div className="bell-panel" role="dialog" aria-label="Avisos">
          <div className="bell-head">
            <b>Avisos</b>
            {sinLeer > 0 && (
              <button type="button" className="link-btn bell-clear" onClick={marcarTodo}>
                Marcar todo como leído
              </button>
            )}
          </div>

          <div className="bell-list">
            {!items.length && (
              <p className="muted" style={{ padding: '18px 14px', fontSize: 13, textAlign: 'center' }}>
                Sin avisos todavía.
              </p>
            )}
            {items.map((aviso) => (
              <button
                key={aviso.id}
                className={`bell-item ${aviso.readAt ? '' : 'sin-leer'}`}
                onClick={() => {
                  setAbierto(false);
                  onOpenConversations?.();
                  request('/notifications/read', {
                    method: 'POST',
                    body: JSON.stringify({ ids: [aviso.id] }),
                  }).then(load).catch(() => undefined);
                }}
              >
                <Icon name={ICONO[aviso.kind] ?? 'info'} size={16} />
                <span>
                  <b>{aviso.title}</b>
                  {aviso.body && <small>{aviso.body}</small>}
                  <time>{relative(aviso.createdAt)}</time>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
