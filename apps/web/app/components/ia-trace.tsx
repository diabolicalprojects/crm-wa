'use client';
import { useEffect, useState } from 'react';
import { Badge, Icon } from './ui';
import { request } from '../lib/api';
import { dateTime, money } from '../lib/format';

/**
 * Qué consultó la IA en esta conversación.
 *
 * Es la respuesta a la pregunta que hace todo dueño antes de encender esto:
 * «¿cómo sé que no está inventando?». La respuesta útil no es «confía», es
 * enseñar la consulta: qué herramienta corrió, con qué la llamó y qué
 * devolvió. Una propiedad mencionada que no aparezca aquí sería la señal de
 * alarma.
 */

type Herramienta = {
  name: string;
  args?: Record<string, unknown>;
  detail?: string;
  ok?: boolean;
};

type Ejecucion = {
  id: string;
  status: string;
  model?: string | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  toolsInvoked?: Herramienta[] | string[] | null;
  errorMessage?: string | null;
  createdAt: string;
};

type Mostrada = {
  shownAt: string;
  property: { id: string; title: string; price: string; currency: string; status: string };
};

/** El registro viejo guardaba solo nombres; el nuevo, objetos. Se leen los dos. */
function normalizar(tools: Ejecucion['toolsInvoked']): Herramienta[] {
  if (!Array.isArray(tools)) return [];
  return tools.map((t) => (typeof t === 'string' ? { name: t, ok: true } : t));
}

export function IaTrace({ conversationId }: { conversationId: string }) {
  const [runs, setRuns] = useState<Ejecucion[]>([]);
  const [mostradas, setMostradas] = useState<Mostrada[]>([]);
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'sinPermiso' | 'error'>('cargando');

  useEffect(() => {
    let vivo = true;
    setEstado('cargando');
    request(`/conversations/${conversationId}/ai-runs`)
      .then((data) => {
        if (!vivo) return;
        setRuns(data.runs ?? []);
        setMostradas(data.mostradas ?? []);
        setEstado('listo');
      })
      .catch((problem) => {
        if (!vivo) return;
        setEstado(problem?.status === 403 ? 'sinPermiso' : 'error');
      });
    return () => { vivo = false; };
  }, [conversationId]);

  if (estado === 'cargando') return <span className="skel skel-row" />;
  if (estado === 'sinPermiso') {
    return (
      <p className="muted" style={{ fontSize: 12.5 }}>
        Te falta el permiso para ver qué consultó la IA.
      </p>
    );
  }
  if (estado === 'error') {
    return <p className="muted" style={{ fontSize: 12.5 }}>No se pudo cargar el registro.</p>;
  }

  if (!runs.length) {
    return (
      <p className="muted" style={{ fontSize: 12.5 }}>
        La IA todavía no ha respondido en esta conversación.
      </p>
    );
  }

  return (
    <>
      {mostradas.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <p className="muted" style={{ fontSize: 12, marginBottom: 7 }}>
            Propiedades que la IA llegó a mostrar. Todas salieron de una consulta al
            inventario, no del modelo.
          </p>
          {mostradas.map((m) => (
            <span className="prop-mini" key={`${m.property.id}-${m.shownAt}`}>
              <b>{m.property.title}</b>
              <small>
                {money(m.property.price, m.property.currency)} · {dateTime(m.shownAt)}
              </small>
            </span>
          ))}
        </div>
      )}

      {runs.map((run) => {
        const tools = normalizar(run.toolsInvoked);
        return (
          <div className="ia-run" key={run.id}>
            <div className="ia-run-top">
              <Badge tone={run.status === 'SUCCESS' ? 'success' : run.status === 'FAILED' ? 'danger' : 'neutral'}>
                {run.status === 'SUCCESS' ? 'Respondió' : run.status === 'FAILED' ? 'Falló' : 'Sin enviar'}
              </Badge>
              {run.model && <span className="muted mono" style={{ fontSize: 11 }}>{run.model}</span>}
              <time>{dateTime(run.createdAt)}</time>
            </div>

            {run.errorMessage && (
              <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 5, wordBreak: 'break-word' }}>
                {run.errorMessage}
              </p>
            )}

            {tools.length === 0 ? (
              <p className="muted" style={{ fontSize: 12, marginTop: 5 }}>
                Sin consultas al inventario: este turno no afirmó nada de una propiedad.
              </p>
            ) : (
              tools.map((tool, index) => (
                <div className={`ia-tool ${tool.ok === false ? 'fallo' : ''}`} key={`${tool.name}-${index}`}>
                  <Icon name={tool.ok === false ? 'alert' : 'search'} size={13} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <b>{tool.name}</b>
                    {tool.detail ? ` · ${tool.detail}` : ''}
                    {tool.args && Object.keys(tool.args).length > 0 && (
                      <span className="ia-args mono">
                        {Object.entries(tool.args)
                          .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
                          .join(' · ')}
                      </span>
                    )}
                  </span>
                </div>
              ))
            )}

            {(run.promptTokens || run.latencyMs) && (
              <p className="muted mono" style={{ fontSize: 11, marginTop: 5 }}>
                {run.latencyMs ? `${(run.latencyMs / 1000).toFixed(1)} s` : ''}
                {run.latencyMs && run.promptTokens ? ' · ' : ''}
                {run.promptTokens
                  ? `${(run.promptTokens + (run.completionTokens ?? 0)).toLocaleString('es-MX')} tokens`
                  : ''}
              </p>
            )}
          </div>
        );
      })}
    </>
  );
}
