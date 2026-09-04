'use client';
import { useEffect, useState } from 'react';
import { Avatar, Badge, Banner, Empty, Icon, PageHeader, Skeleton } from '../components/ui';
import { request } from '../lib/api';
import { dateTime, initials, phone, relative } from '../lib/format';

type Summary = {
  metrics: { conversations: number; leads: number; properties: number; agents: number; sessions: number };
  recent: any[];
  audit: any[];
  scope: string;
};

const CARDS: { key: keyof Summary['metrics']; label: string; foot: string }[] = [
  { key: 'conversations', label: 'Conversaciones', foot: 'Hilos abiertos con prospectos' },
  { key: 'leads', label: 'Prospectos', foot: 'Identificados por teléfono' },
  { key: 'properties', label: 'Propiedades disponibles', foot: 'Lo que la IA puede ofrecer' },
  { key: 'agents', label: 'Agentes activos', foot: 'Con automatización habilitada' },
  { key: 'sessions', label: 'WhatsApp conectados', foot: 'Números en línea' },
];

export function Dashboard({ onOpenSessions }: { onOpenSessions: () => void }) {
  const [data, setData] = useState<Summary>();
  const [error, setError] = useState('');

  useEffect(() => {
    request<Summary>('/dashboard').then(setData).catch((problem) => setError(problem.message));
  }, []);

  if (error) return <section className="content"><Banner>{error}</Banner></section>;

  return (
    <section className="content">
      <PageHeader
        eyebrow="Operación en tiempo real"
        title="Resumen"
        description="Todo lo que ves se calcula directamente sobre la base de datos."
      />

      {!data ? (
        <div className="metrics">
          {CARDS.map((card) => (
            <div className="metric" key={card.key}>
              <div className="skel skel-text" style={{ width: '60%', marginBottom: 10 }} />
              <div className="skel" style={{ height: 26, width: '35%' }} />
            </div>
          ))}
        </div>
      ) : (
        <>
          {data.metrics.sessions === 0 && (
            <Banner kind="warning">
              <b>No hay ningún número de WhatsApp conectado.</b> Sin una sesión activa el CRM no
              puede recibir ni enviar mensajes.{' '}
              <button className="link-btn" style={{ display: 'inline', width: 'auto', padding: 0, color: 'inherit', textDecoration: 'underline' }} onClick={onOpenSessions}>
                Conectar un número
              </button>
            </Banner>
          )}

          <div className="metrics">
            {CARDS.map((card) => (
              <div className="metric" key={card.key}>
                <small>{card.label}</small>
                <strong>{data.metrics[card.key]}</strong>
                <div className="metric-foot">{card.foot}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="stack">
        <div className="card">
          <div className="card-head">
            <div style={{ flex: 1 }}>
              <h2>Conversaciones recientes</h2>
              <p>Última actividad registrada en la bandeja.</p>
            </div>
          </div>
          {!data ? <Skeleton rows={3} /> : data.recent?.length ? (
            <div>
              {data.recent.map((conversation: any) => (
                <div className="conv-item" key={conversation.id} style={{ cursor: 'default' }}>
                  <Avatar text={initials(conversation.lead?.name, '·')} />
                  <span className="conv-copy">
                    <span className="conv-top">
                      <b>{conversation.lead?.name || phone(conversation.lead?.phone)}</b>
                      <span className="conv-time">{relative(conversation.lastMessageAt)}</span>
                    </span>
                    <span className="conv-preview">
                      {conversation.messages?.[0]?.text || 'Sin mensajes todavía'}
                    </span>
                  </span>
                  <Badge value={conversation.mode} />
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon="chat"
              title="Todavía no hay conversaciones"
              text="Aparecerán aquí en cuanto un prospecto escriba al número conectado."
            />
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <div style={{ flex: 1 }}>
              <h2>Actividad del sistema</h2>
              <p>Acciones sensibles registradas en la auditoría.</p>
            </div>
          </div>
          {!data ? <Skeleton rows={3} /> : data.audit?.length ? (
            <div className="table-wrap">
              <table>
                <tbody>
                  {data.audit.map((entry: any) => (
                    <tr key={entry.id}>
                      <td>
                        <span className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                          <Icon name="shield" size={15} />
                          <span><b>{entry.action}</b><span className="cell-sub">{entry.entityType}</span></span>
                        </span>
                      </td>
                      <td data-label="Fecha" className="muted num" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {dateTime(entry.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon="shield" title="Sin actividad registrada" text="Las acciones de los usuarios se irán registrando aquí." />
          )}
        </div>
      </div>
    </section>
  );
}
