'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Avatar, Badge, Banner, Button, Empty, Icon, PageHeader, Skeleton, useToast } from '../components/ui';
import { request, requestList } from '../lib/api';
import { dateTime, initials, label, money, phone, relative } from '../lib/format';

const FILTERS = [
  { value: '', label: 'Todas' },
  { value: 'OPEN', label: 'Abiertas' },
  { value: 'PENDING', label: 'Pendientes' },
  { value: 'RESOLVED', label: 'Resueltas' },
];

export function Conversations() {
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [detail, setDetail] = useState<any>();
  const [messages, setMessages] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const list = await requestList(`/conversations${status ? `?status=${status}` : ''}`);
      setItems(list);
      setSelectedId((current) => current || list[0]?.id || '');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  // Sondeo corto: la bandeja debe reflejar lo que llega por WhatsApp sin que
  // el asesor tenga que recargar (spec §20.4).
  useEffect(() => {
    const timer = setInterval(load, 12000);
    return () => clearInterval(timer);
  }, [load]);

  const loadThread = useCallback(async (id: string) => {
    if (!id) return;
    const [one, thread] = await Promise.all([
      request(`/conversations/${id}`),
      request(`/conversations/${id}/messages`),
    ]);
    setDetail(one);
    setMessages(thread);
  }, []);

  useEffect(() => { loadThread(selectedId).catch(() => {}); }, [selectedId, loadThread]);
  useEffect(() => {
    const timer = setInterval(() => loadThread(selectedId).catch(() => {}), 8000);
    return () => clearInterval(timer);
  }, [selectedId, loadThread]);

  useEffect(() => { bottom.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);

  async function act(path: string, done: string) {
    try {
      await request(`/conversations/${selectedId}/${path}`, { method: 'POST' });
      toast(done);
      await Promise.all([load(), loadThread(selectedId)]);
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No fue posible', 'error');
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem('text') as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;
    setSending(true);
    try {
      await request(`/conversations/${selectedId}/messages`, { method: 'POST', body: JSON.stringify({ text }) });
      input.value = '';
      await Promise.all([loadThread(selectedId), load()]);
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No se pudo enviar', 'error');
    } finally {
      setSending(false);
    }
  }

  const visible = items.filter((item) => {
    if (!search) return true;
    const needle = search.toLowerCase();
    return (item.lead?.name || '').toLowerCase().includes(needle) || (item.lead?.phone || '').includes(needle);
  });

  const humanControl = detail?.mode === 'HUMAN_ACTIVE';
  const lead = detail?.lead;

  return (
    <section className="content">
      <PageHeader
        eyebrow="Bandeja"
        title="Conversaciones"
        description="Mensajes de WhatsApp, control de la IA y contexto del prospecto."
      />

      {error && <Banner>{error}</Banner>}

      {!loading && !items.length ? (
        <div className="card">
          <Empty
            icon="chat"
            title="La bandeja está vacía"
            text="Conecta un número de WhatsApp y asígnalo a un agente. Cuando un prospecto escriba, la conversación aparecerá aquí."
          />
        </div>
      ) : (
        <div className="inbox">
          {/* Columna 1 — filtros y lista */}
          <div className="inbox-col list-col">
            <div className="inbox-head">
              <div className="search" style={{ marginBottom: 8 }}>
                <Icon name="search" size={15} />
                <input
                  className="input" placeholder="Buscar por nombre o teléfono"
                  value={search} onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <div className="row row-wrap" style={{ gap: 5 }}>
                {FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    className={`btn btn-sm ${status === filter.value ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setStatus(filter.value)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="inbox-list">
              {loading ? <Skeleton rows={6} /> : visible.map((item) => (
                <button
                  key={item.id}
                  className={`conv-item ${selectedId === item.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <Avatar text={initials(item.lead?.name, '·')} />
                  <span className="conv-copy">
                    <span className="conv-top">
                      <b>{item.lead?.name || phone(item.lead?.phone)}</b>
                      <span className="conv-time">{relative(item.lastMessageAt)}</span>
                    </span>
                    <span className="conv-preview">{item.messages?.[0]?.text || 'Sin mensajes'}</span>
                    <span style={{ marginTop: 5, display: 'inline-block' }}>
                      <Badge value={item.mode} />
                    </span>
                  </span>
                </button>
              ))}
              {!loading && !visible.length && (
                <div style={{ padding: 24, textAlign: 'center' }} className="muted">Sin resultados</div>
              )}
            </div>
          </div>

          {/* Columna 2 — hilo y compositor */}
          <div className="inbox-col">
            {!detail ? <Skeleton rows={8} /> : (
              <>
                <div className="chat-head">
                  <Avatar text={initials(lead?.name, '·')} />
                  <div className="who">
                    <b>{lead?.name || phone(lead?.phone)}</b>
                    <span className="cell-sub">{phone(lead?.phone)} · {detail.agent?.name || 'Sin agente'}</span>
                  </div>
                  <div className="chat-actions">
                    {humanControl ? (
                      <Button icon="bot" onClick={() => act('return-to-ai', 'La IA retomó la conversación')}>
                        Devolver a la IA
                      </Button>
                    ) : (
                      <Button icon="users" onClick={() => act('takeover', 'Tomaste la conversación')}>
                        Tomar control
                      </Button>
                    )}
                    <Button icon="check" onClick={() => act('resolve', 'Conversación resuelta')} title="Marcar como resuelta" />
                  </div>
                </div>

                {humanControl && (
                  <div style={{ padding: '10px 16px 0' }}>
                    <Banner kind="info">
                      <b>Control humano.</b> La IA no responderá hasta que la reactives.
                      {detail.handoffReason ? ` Motivo: ${detail.handoffReason}` : ''}
                    </Banner>
                  </div>
                )}

                <div className="chat-body">
                  {messages.map((message) => {
                    if (message.senderType === 'SYSTEM') {
                      return <div className="msg msg-system" key={message.id}>{message.text}</div>;
                    }
                    const inbound = message.direction === 'INBOUND';
                    const kind = inbound ? 'msg-in' : message.senderType === 'AI' ? 'msg-ai' : 'msg-human';
                    return (
                      <div className={`msg ${kind}`} key={message.id}>
                        {!inbound && (
                          <div className="msg-author">
                            {message.senderType === 'AI' ? 'IA' : message.sender?.name || 'Asesor'}
                            {message.origin === 'WHATSAPP_PHONE' ? ' · desde el teléfono' : ''}
                          </div>
                        )}
                        {message.text || <em className="muted">Mensaje multimedia</em>}
                        <time>{dateTime(message.createdAt)}</time>
                      </div>
                    );
                  })}
                  <div ref={bottom} />
                </div>

                <div className="composer">
                  <form onSubmit={send}>
                    <input className="input" name="text" placeholder="Escribe un mensaje…" autoComplete="off" />
                    <Button type="submit" variant="primary" icon="send" disabled={sending}>
                      {sending ? 'Enviando…' : 'Enviar'}
                    </Button>
                  </form>
                  <p className="muted" style={{ fontSize: 12, marginTop: 7 }}>
                    Al responder desde aquí, la IA queda pausada hasta que la devuelvas.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Columna 3 — panel del prospecto */}
          <div className="inbox-col lead-col">
            <div className="inbox-head"><b style={{ fontSize: 13 }}>Prospecto</b></div>
            <div className="lead-panel">
              {!lead ? <Skeleton rows={4} /> : (
                <>
                  <div className="panel-section">
                    <h3>Datos</h3>
                    <dl style={{ margin: 0 }}>
                      <div className="kv"><dt>Nombre</dt><dd>{lead.name || 'Sin capturar'}</dd></div>
                      <div className="kv"><dt>Teléfono</dt><dd className="mono">{phone(lead.phone)}</dd></div>
                      <div className="kv"><dt>Etapa</dt><dd><Badge value={lead.stage} /></dd></div>
                      <div className="kv"><dt>Calificación</dt><dd className="mono">{lead.score}/100</dd></div>
                    </dl>
                  </div>

                  {lead.aiSummary && (
                    <div className="panel-section">
                      <h3>Resumen de la IA</h3>
                      <p style={{ fontSize: 13, color: 'var(--text-2)' }}>{lead.aiSummary}</p>
                    </div>
                  )}

                  <div className="panel-section">
                    <h3>Criterios de búsqueda</h3>
                    {lead.preferences && Object.keys(lead.preferences).length ? (
                      <dl style={{ margin: 0 }}>
                        {lead.preferences.operationType && (
                          <div className="kv"><dt>Operación</dt><dd>{label(lead.preferences.operationType)}</dd></div>
                        )}
                        {lead.preferences.budget && (
                          <div className="kv">
                            <dt>Presupuesto</dt>
                            <dd className="mono">
                              {money(lead.preferences.budget.min, lead.preferences.budget.currency)} – {money(lead.preferences.budget.max, lead.preferences.budget.currency)}
                            </dd>
                          </div>
                        )}
                        {lead.preferences.locations?.length > 0 && (
                          <div className="kv"><dt>Zonas</dt><dd>{lead.preferences.locations.join(', ')}</dd></div>
                        )}
                        {lead.preferences.bedroomsMin != null && (
                          <div className="kv"><dt>Recámaras</dt><dd className="mono">{lead.preferences.bedroomsMin}+</dd></div>
                        )}
                        {lead.preferences.mustHaveAmenities?.length > 0 && (
                          <div className="kv"><dt>Debe tener</dt><dd>{lead.preferences.mustHaveAmenities.join(', ')}</dd></div>
                        )}
                      </dl>
                    ) : (
                      <p className="muted" style={{ fontSize: 12.5 }}>
                        La IA los irá capturando conforme el prospecto los exprese.
                      </p>
                    )}
                  </div>

                  <div className="panel-section">
                    <h3>Propiedades mostradas</h3>
                    {lead.matches?.length ? lead.matches.map((match: any) => (
                      <div className="prop-mini" key={match.id}>
                        <b>{match.property?.title}</b>
                        <small>{money(match.property?.price, match.property?.currency)}</small>
                      </div>
                    )) : (
                      <p className="muted" style={{ fontSize: 12.5 }}>Todavía no se recomendó ninguna.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
