'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Badge, Banner, Button, Confirm, Empty, Icon, Modal, PageHeader, Skeleton, useToast,
} from '../components/ui';
import { request, requestList } from '../lib/api';
import { dateTime } from '../lib/format';

/* ------------------------------------------- credenciales (superadministración) */

/**
 * Las credenciales del cliente OAuth se capturan aquí, no en variables de
 * entorno: rotarlas no debe exigir un redespliegue, y quedan cifradas como
 * cualquier otro secreto del sistema.
 */
export function GoogleSetup() {
  const toast = useToast();
  const [config, setConfig] = useState<any>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    try {
      setConfig(await request('/admin/google/config'));
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const body = Object.fromEntries(new FormData(event.currentTarget) as any);
    try {
      await request('/admin/google/config', { method: 'POST', body: JSON.stringify(body) });
      toast('Credenciales guardadas');
      setEditing(false);
      load();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No fue posible guardar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="content">
      <PageHeader
        eyebrow="Superadministración"
        title="Google Calendar"
        description="Un solo proyecto de Google sirve a todas las agencias. El secreto se cifra y nunca vuelve al navegador."
        actions={
          config && (
            <Button variant={config.configurado ? 'secondary' : 'primary'} icon="settings" onClick={() => setEditing(true)}>
              {config.configurado ? 'Cambiar credenciales' : 'Configurar'}
            </Button>
          )
        }
      />

      {error && <Banner>{error}</Banner>}

      {!config ? <div className="card"><Skeleton rows={3} /></div> : (
        <div className="stack">
          {!config.configurado && (
            <Banner kind="warning">
              <b>Sin configurar, nadie puede vincular su calendario.</b> Las visitas se registran en
              el CRM pero no aparecen en Google.
            </Banner>
          )}

          <div className="card">
            <div className="card-head">
              <div style={{ flex: 1 }}>
                <h2>Estado</h2>
                <p>Credenciales del cliente OAuth de Google Cloud.</p>
              </div>
              <Badge tone={config.configurado ? 'success' : 'warning'}>
                {config.configurado ? 'Configurado' : 'Pendiente'}
              </Badge>
            </div>
            <div className="card-body">
              <dl style={{ margin: 0 }}>
                <div className="kv">
                  <dt>Client ID</dt>
                  <dd className="mono">{config.clientId || '—'}</dd>
                </div>
                <div className="kv">
                  <dt>Client secret</dt>
                  <dd>{config.tieneSecreto ? <Badge tone="success">Cifrado</Badge> : '—'}</dd>
                </div>
                <div className="kv">
                  <dt>URI de redirección</dt>
                  <dd className="mono" style={{ fontSize: 12 }}>{config.redirectUri}</dd>
                </div>
              </dl>
              {config.configurado && (
                <div style={{ marginTop: 14 }}>
                  <Button variant="danger" icon="trash" onClick={() => setRemoving(true)}>
                    Quitar credenciales
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div style={{ flex: 1 }}>
                <h2>Cómo obtenerlas</h2>
                <p>En console.cloud.google.com, una sola vez.</p>
              </div>
            </div>
            <div className="card-body">
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.9, color: 'var(--text-2)' }}>
                <li>Crea un proyecto, o usa uno existente.</li>
                <li>En <b>APIs y servicios → Biblioteca</b>, habilita <b>Google Calendar API</b>.</li>
                <li>
                  En <b>Pantalla de consentimiento</b>, tipo <b>Externo</b>. Agrega los permisos{' '}
                  <code>calendar.events</code> y <code>calendar.readonly</code>.
                </li>
                <li>
                  En <b>Credenciales → Crear → ID de cliente de OAuth</b>, tipo{' '}
                  <b>Aplicación web</b>.
                </li>
                <li>
                  En <b>URIs de redirección autorizados</b> pega exactamente esta:
                  <div
                    className="mono"
                    style={{
                      marginTop: 6, marginBottom: 6, padding: '8px 11px', fontSize: 12,
                      background: 'var(--surface-2)', border: '1px solid var(--border)',
                      borderRadius: 'var(--r-sm)', wordBreak: 'break-all',
                    }}
                  >
                    {config.redirectUriSugerida}
                  </div>
                  <Button
                    size="sm" icon="copy"
                    onClick={() => {
                      navigator.clipboard?.writeText(config.redirectUriSugerida);
                      toast('URI copiada');
                    }}
                  >
                    Copiar
                  </Button>
                </li>
                <li>Copia el <b>Client ID</b> y el <b>Client secret</b> y pégalos aquí.</li>
              </ol>
              <Banner kind="info">
                Mientras la app esté en modo <b>Prueba</b>, solo las cuentas que agregues como
                usuarios de prueba podrán vincular su calendario.
              </Banner>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setEditing(false)}>
          <form className="modal modal-wide" onSubmit={save}>
            <div className="modal-head">
              <h2>Credenciales de Google Cloud</h2>
              <p>Se cifran con AES-GCM. El secreto no vuelve a mostrarse.</p>
            </div>
            <div className="modal-body">
              {error && <Banner>{error}</Banner>}
              <label className="field">
                <span>Client ID</span>
                <input className="input" name="clientId" required defaultValue={config?.clientId ?? ''}
                  placeholder="123456789-abc.apps.googleusercontent.com" />
              </label>
              <label className="field">
                <span>Client secret</span>
                <input className="input" name="clientSecret" type="password" required autoComplete="off"
                  placeholder="••••••••••••" />
              </label>
              <label className="field">
                <span>URI de redirección</span>
                <input className="input" name="redirectUri" required
                  defaultValue={config?.redirectUri ?? config?.redirectUriSugerida ?? ''} />
                <span className="hint">Debe coincidir exactamente con la registrada en Google Cloud.</span>
              </label>
            </div>
            <div className="modal-foot">
              <Button type="button" onClick={() => setEditing(false)}>Cancelar</Button>
              <Button type="submit" variant="primary" disabled={busy}>
                {busy ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </form>
        </div>
      )}

      {removing && (
        <Confirm
          danger
          title="Quitar credenciales de Google"
          text="Las conexiones de calendario existentes dejarán de renovarse y las visitas no se sincronizarán."
          confirmLabel="Quitar"
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            await request('/admin/google/config', { method: 'DELETE' });
            toast('Credenciales eliminadas');
            load();
          }}
        />
      )}
    </section>
  );
}

/* ----------------------------------------------- conexiones de la agencia */

export function Calendars() {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [choosing, setChoosing] = useState<any>();
  const [removing, setRemoving] = useState<any>();

  const load = useCallback(async () => {
    try {
      setRows(await requestList('/calendar-connections'));
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Google devuelve al frontend tras el consentimiento; el resultado viaja en
  // la URL para poder avisar sin que el usuario tenga que recargar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const estado = params.get('calendario');
    if (!estado) return;
    if (estado === 'conectado') toast('Calendario vinculado');
    else toast(params.get('detalle') || 'No fue posible vincular el calendario', 'error');
    window.history.replaceState({}, '', window.location.pathname);
    load();
  }, [load, toast]);

  async function connect(scope: 'PERSONAL' | 'SHARED') {
    try {
      const { url } = await request('/calendar-connections/google/start', {
        method: 'POST', body: JSON.stringify({ scope }),
      });
      window.location.href = url;
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No fue posible iniciar', 'error');
    }
  }

  const personal = rows.find((row) => row.scope === 'PERSONAL');
  const compartido = rows.find((row) => row.scope === 'SHARED');

  return (
    <section className="content">
      <PageHeader
        eyebrow="Agenda"
        title="Calendarios"
        description="Las visitas se registran en el CRM y se reflejan en Google: el calendario personal del asesor y el compartido de la agencia."
      />

      {error && <Banner>{error}</Banner>}

      {loading ? <div className="card"><Skeleton rows={3} /></div> : (
        <div className="stack">
          {rows.some((row) => row.status !== 'ACTIVE') && (
            <Banner kind="warning">
              Hay una conexión vencida o con error. Vuelve a vincularla para que las visitas
              sigan sincronizándose.
            </Banner>
          )}

          {[
            { scope: 'PERSONAL' as const, row: personal, titulo: 'Mi calendario',
              texto: 'Tus visitas asignadas aparecen en tu calendario personal.' },
            { scope: 'SHARED' as const, row: compartido, titulo: 'Calendario de la agencia',
              texto: 'Todas las visitas del equipo, en un calendario compartido.' },
          ].map(({ scope, row, titulo, texto }) => (
            <div className="card" key={scope}>
              <div className="card-head">
                <div style={{ flex: 1 }}>
                  <h2>{titulo}</h2>
                  <p>{texto}</p>
                </div>
                {row ? <Badge value={row.status} /> : <Badge tone="neutral">Sin vincular</Badge>}
              </div>
              <div className="card-body">
                {row ? (
                  <>
                    <dl style={{ margin: 0 }}>
                      <div className="kv"><dt>Cuenta</dt><dd>{row.externalAccountEmail || '—'}</dd></div>
                      <div className="kv">
                        <dt>Calendario</dt>
                        <dd className="mono" style={{ fontSize: 12 }}>
                          {row.calendarId || <span className="muted">Falta elegir</span>}
                        </dd>
                      </div>
                      <div className="kv">
                        <dt>Última sincronización</dt>
                        <dd>{row.lastSyncedAt ? dateTime(row.lastSyncedAt) : 'Todavía ninguna'}</dd>
                      </div>
                    </dl>
                    {!row.calendarId && (
                      <Banner kind="warning">
                        Elige un calendario para que las visitas empiecen a reflejarse.
                      </Banner>
                    )}
                    <div className="row" style={{ marginTop: 14, gap: 8 }}>
                      <Button icon="calendar" onClick={() => setChoosing(row)}>
                        {row.calendarId ? 'Cambiar calendario' : 'Elegir calendario'}
                      </Button>
                      <Button onClick={() => connect(scope)}>Volver a vincular</Button>
                      <Button variant="danger" icon="trash" onClick={() => setRemoving(row)}>Desvincular</Button>
                    </div>
                  </>
                ) : (
                  <Empty
                    icon="calendar"
                    title="Sin vincular"
                    text={texto}
                    action={<Button variant="primary" icon="link" onClick={() => connect(scope)}>Vincular con Google</Button>}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {choosing && <PickCalendar connection={choosing} onClose={() => setChoosing(undefined)} onDone={load} />}

      {removing && (
        <Confirm
          danger
          title="Desvincular calendario"
          text="Las visitas dejarán de reflejarse en Google. Los eventos ya creados permanecen."
          confirmLabel="Desvincular"
          onClose={() => setRemoving(undefined)}
          onConfirm={async () => {
            await request(`/calendar-connections/${removing.id}`, { method: 'DELETE' });
            toast('Calendario desvinculado');
            load();
          }}
        />
      )}
    </section>
  );
}

function PickCalendar({ connection, onClose, onDone }: {
  connection: any; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [items, setItems] = useState<any[]>();
  const [choice, setChoice] = useState(connection.calendarId ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    request(`/calendar-connections/${connection.id}/calendars`)
      .then((list: any[]) => {
        setItems(list);
        if (!connection.calendarId) {
          setChoice(list.find((item) => item.primary)?.id ?? list[0]?.id ?? '');
        }
      })
      .catch((problem) => setError(problem.message));
  }, [connection]);

  return (
    <Modal
      title="Elegir calendario"
      description="Solo se listan aquellos donde tu cuenta puede crear eventos."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary" disabled={busy || !choice}
            onClick={async () => {
              setBusy(true);
              try {
                await request(`/calendar-connections/${connection.id}`, {
                  method: 'PATCH', body: JSON.stringify({ calendarId: choice }),
                });
                toast('Calendario seleccionado');
                onDone();
                onClose();
              } catch (problem) {
                setError(problem instanceof Error ? problem.message : 'No fue posible');
              } finally {
                setBusy(false);
              }
            }}
          >
            Guardar
          </Button>
        </>
      }
    >
      {error && <Banner>{error}</Banner>}
      {!items ? <Skeleton rows={3} /> : items.length ? (
        <label className="field">
          <span>Calendario</span>
          <select className="select" value={choice} onChange={(event) => setChoice(event.target.value)}>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}{item.primary ? ' · principal' : ''}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="muted">Esa cuenta no tiene calendarios con permiso de escritura.</p>
      )}
    </Modal>
  );
}
