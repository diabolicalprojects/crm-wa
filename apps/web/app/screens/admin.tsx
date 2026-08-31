'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Avatar, Badge, Banner, Button, Confirm, DataTable, Empty, FormModal, PageHeader, Skeleton, useToast,
  type Column,
} from '../components/ui';
import { request, requestList } from '../lib/api';
import { ROLES, dateTime, initials, label } from '../lib/format';
import type { User } from './auth';

/* --------------------------------------------------------------- equipo */

export function Team({ organizationId }: { organizationId?: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<any>();

  const load = useCallback(async () => {
    if (!organizationId) { setLoading(false); return; }
    setLoading(true);
    try {
      setRows(await requestList(`/organizations/${organizationId}/members`));
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => { load(); }, [load]);

  if (!organizationId) {
    return (
      <section className="content">
        <div className="card"><Empty icon="users" title="Selecciona una agencia" text="Elige una agencia en la barra superior para ver su equipo." /></div>
      </section>
    );
  }

  const columns: Column<any>[] = [
    {
      key: 'person', head: 'Persona',
      cell: (row) => (
        <div className="row">
          <Avatar small text={initials(row.user.name)} />
          <span><b>{row.user.name}</b><span className="cell-sub">{row.user.email}</span></span>
        </div>
      ),
    },
    { key: 'role', head: 'Rol', cell: (row) => <Badge value={row.role} tone="neutral" /> },
    { key: 'status', head: 'Estado', cell: (row) => <Badge value={row.status} /> },
    {
      key: 'actions', head: '', align: 'right',
      cell: (row) => (
        <div className="row-actions">
          <Button size="sm" onClick={(event) => { event.stopPropagation(); setResetting(row); }}>Restablecer acceso</Button>
        </div>
      ),
    },
  ];

  return (
    <section className="content">
      <PageHeader
        eyebrow="Organización"
        title="Equipo"
        description="Quién entra al CRM y con qué permisos. Los roles se validan en el servidor."
        actions={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Añadir persona</Button>}
      />

      {error && <Banner>{error}</Banner>}

      <DataTable
        columns={columns} rows={rows} loading={loading}
        empty={<Empty icon="users" title="Sin miembros" text="Agrega a las personas de tu equipo para que puedan atender conversaciones." />}
      />

      {adding && (
        <FormModal
          title="Añadir persona"
          description="Se crea con acceso inmediato usando la contraseña temporal que definas."
          fields={[
            { name: 'name', label: 'Nombre' },
            { name: 'email', label: 'Correo', type: 'email' },
            { name: 'password', label: 'Contraseña temporal', type: 'password', hint: 'Mínimo 8 caracteres.' },
            { name: 'role', label: 'Rol', type: 'select', options: ROLES },
          ]}
          onClose={() => setAdding(false)}
          onSubmit={async (values) => {
            await request(`/organizations/${organizationId}/members`, { method: 'POST', body: JSON.stringify(values) });
            toast('Persona añadida');
            load();
          }}
        />
      )}

      {resetting && (
        <FormModal
          title={`Restablecer acceso de ${resetting.user.name}`}
          submitLabel="Restablecer"
          fields={[{ name: 'password', label: 'Nueva contraseña temporal', type: 'password', hint: 'Mínimo 8 caracteres.' }]}
          onClose={() => setResetting(undefined)}
          onSubmit={async (values) => {
            await request(`/organizations/${organizationId}/members/${resetting.user.id}`, {
              method: 'PATCH', body: JSON.stringify(values),
            });
            toast('Acceso restablecido');
            load();
          }}
        />
      )}
    </section>
  );
}

/* -------------------------------------------------------------- auditoría */

export function Audit() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    requestList('/audit')
      .then(setRows)
      .catch((problem) => setError(problem.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="content">
      <PageHeader eyebrow="Trazabilidad" title="Auditoría" description="Registro de acciones sensibles sobre la operación." />
      {error && <Banner>{error}</Banner>}
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'date', head: 'Fecha', cell: (row: any) => <span className="mono">{dateTime(row.createdAt)}</span> },
          { key: 'action', head: 'Acción', cell: (row: any) => <b>{row.action}</b> },
          { key: 'entity', head: 'Recurso', cell: (row: any) => (<>{row.entityType}<span className="cell-sub mono">{row.entityId || '—'}</span></>) },
        ]}
        empty={<Empty icon="shield" title="Sin registros" text="Las acciones sensibles se irán registrando conforme el equipo opere." />}
      />
    </section>
  );
}

/* ------------------------------------------------------------- agencias */

export function Organizations() {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [invite, setInvite] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await requestList('/organizations'));
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <section className="content">
      <PageHeader
        eyebrow="Superadministración"
        title="Agencias"
        description="Cada agencia es un espacio aislado: sus datos nunca se cruzan con los de otra."
        actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Crear agencia</Button>}
      />

      {error && <Banner>{error}</Banner>}
      {invite && (
        <Banner kind="info">
          <b>Invitación generada.</b> Compártela con el propietario; caduca en 7 días y solo sirve una vez.
          <div className="mono" style={{ marginTop: 6, wordBreak: 'break-all', fontSize: 12 }}>{invite}</div>
        </Banner>
      )}

      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'name', head: 'Agencia', cell: (row: any) => (<><b>{row.name}</b><span className="cell-sub mono">{row.slug}</span></>) },
          { key: 'status', head: 'Estado', cell: (row: any) => <Badge value={row.status} /> },
          { key: 'members', head: 'Miembros', align: 'right', cell: (row: any) => <span className="num">{row._count?.members ?? 0}</span> },
          { key: 'agents', head: 'Agentes', align: 'right', cell: (row: any) => <span className="num">{row._count?.agents ?? 0}</span> },
          { key: 'leads', head: 'Prospectos', align: 'right', cell: (row: any) => <span className="num">{row._count?.leads ?? 0}</span> },
        ]}
        empty={<Empty icon="building" title="Sin agencias" text="Crea la primera agencia y su propietario para empezar." />}
      />

      {creating && (
        <FormModal
          title="Crear agencia"
          description="Si defines una contraseña temporal, el propietario entra de inmediato. Si la dejas vacía, se genera una invitación."
          fields={[
            { name: 'name', label: 'Nombre de la agencia' },
            { name: 'slug', label: 'Identificador', hint: 'Minúsculas, números y guiones. Ejemplo: horizonte-demo' },
            { name: 'ownerEmail', label: 'Correo del propietario', type: 'email' },
            { name: 'ownerName', label: 'Nombre del propietario', required: false },
            { name: 'ownerPassword', label: 'Contraseña temporal', type: 'password', required: false, hint: 'Mínimo 8 caracteres.' },
          ]}
          onClose={() => setCreating(false)}
          onSubmit={async (values) => {
            const result = await request('/organizations', { method: 'POST', body: JSON.stringify(values) });
            toast('Agencia creada');
            if (result.invitationToken) setInvite(result.invitationToken);
            load();
          }}
        />
      )}
    </section>
  );
}

/* ---------------------------------------------------------- proveedores IA */

type CatalogEntry = {
  kind: string; label: string; credentialLabel: string; defaultBaseUrl?: string;
  supportsTools: boolean; notes: string;
  models: { id: string; label: string; context: string; recommended?: boolean }[];
};

export function AiProviders() {
  const toast = useToast();
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<any>();

  const load = useCallback(async () => {
    try {
      const [catalogList, providerList, modelList] = await Promise.all([
        requestList<CatalogEntry>('/admin/ai/catalog'),
        requestList('/admin/ai/providers'),
        requestList('/admin/ai/models'),
      ]);
      setCatalog(catalogList);
      setProviders(providerList);
      setModels(modelList);
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function test(provider: any) {
    toast('Probando conexión…', 'info');
    try {
      const result = await request(`/admin/ai/providers/${provider.id}/test`, {
        method: 'POST', body: JSON.stringify({}),
      });
      toast(result.ok ? 'El proveedor respondió correctamente' : `Falló: ${result.error}`, result.ok ? 'success' : 'error');
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No fue posible probar', 'error');
    }
  }

  return (
    <section className="content">
      <PageHeader
        eyebrow="Superadministración"
        title="Proveedores de IA"
        description="Las credenciales se cifran en la base y nunca se devuelven al navegador. Las agencias las consumen sin verlas."
        actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Conectar proveedor</Button>}
      />

      {error && <Banner>{error}</Banner>}
      {!loading && !providers.length && (
        <Banner kind="warning">
          <b>Sin proveedor configurado, la IA no responde.</b> Conecta al menos uno para que los
          agentes puedan atender conversaciones.
        </Banner>
      )}

      <div className="stack">
        <DataTable
          loading={loading}
          rows={providers}
          columns={[
            { key: 'name', head: 'Proveedor', cell: (row: any) => (<><b>{row.name}</b><span className="cell-sub">{label(row.kind)}</span></>) },
            {
              key: 'models', head: 'Modelos', align: 'right',
              cell: (row: any) => <span className="num">{row._count?.modelConfigs ?? 0}</span>,
            },
            {
              key: 'key', head: 'Credencial',
              cell: () => <Badge tone="success">Cifrada</Badge>,
            },
            { key: 'status', head: 'Estado', cell: (row: any) => <Badge value={row.enabled ? 'ACTIVE' : 'DISABLED'} /> },
            {
              key: 'actions', head: '', align: 'right',
              cell: (row: any) => (
                <div className="row-actions">
                  <Button size="sm" icon="link" onClick={(event) => { event.stopPropagation(); test(row); }}>Probar</Button>
                  <Button size="sm" variant="danger" icon="trash" title="Eliminar"
                    onClick={(event) => { event.stopPropagation(); setRemoving(row); }} />
                </div>
              ),
            },
          ]}
          empty={
            <Empty
              icon="sparkle"
              title="Ningún proveedor conectado"
              text="Conecta Anthropic, OpenAI o Gemini. La credencial se valida contra el proveedor antes de guardarse."
              action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Conectar el primero</Button>}
            />
          }
        />

        {models.length > 0 && (
          <div className="card">
            <div className="card-head">
              <div style={{ flex: 1 }}>
                <h2>Configuraciones de modelo</h2>
                <p>Lo que los agentes pueden usar. La marcada por defecto se aplica a quien no tenga una propia.</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Nombre</th><th>Modelo</th><th>Proveedor</th><th>Alcance</th><th style={{ textAlign: 'right' }}>Temp.</th><th></th></tr>
                </thead>
                <tbody>
                  {models.map((model: any) => (
                    <tr key={model.id}>
                      <td><b>{model.name}</b></td>
                      <td className="mono" style={{ fontSize: 12.5 }}>{model.model}</td>
                      <td>{model.provider?.name}</td>
                      <td>{model.organization ? model.organization.name : <span className="muted">Global</span>}</td>
                      <td className="num" style={{ textAlign: 'right' }}>{model.temperature}</td>
                      <td style={{ textAlign: 'right' }}>{model.isDefault && <Badge tone="primary">Predeterminado</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {creating && (
        <ConnectProvider
          catalog={catalog}
          onClose={() => setCreating(false)}
          onDone={() => { load(); toast('Proveedor conectado'); }}
        />
      )}

      {removing && (
        <Confirm
          danger
          title={`Eliminar ${removing.name}`}
          text="Se borrará la credencial y sus configuraciones de modelo. Los agentes que lo usaran dejarán de responder."
          confirmLabel="Eliminar proveedor"
          onClose={() => setRemoving(undefined)}
          onConfirm={async () => {
            await request(`/admin/ai/providers/${removing.id}`, { method: 'DELETE' });
            toast('Proveedor eliminado');
            load();
          }}
        />
      )}
    </section>
  );
}

/**
 * El formulario es dinámico a propósito: al elegir proveedor cambian los
 * modelos disponibles y si la URL base es obligatoria. Un formulario estático
 * obligaría a conocer de memoria los identificadores de cada modelo.
 */
function ConnectProvider({ catalog, onClose, onDone }: {
  catalog: CatalogEntry[]; onClose: () => void; onDone: () => void;
}) {
  const [kind, setKind] = useState(catalog[0]?.kind ?? 'ANTHROPIC');
  const [model, setModel] = useState('');
  const [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [live, setLive] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);

  const entry = catalog.find((item) => item.kind === kind);
  const needsBaseUrl = kind === 'OPENAI_COMPATIBLE';

  useEffect(() => {
    const recommended = entry?.models.find((item) => item.recommended) ?? entry?.models[0];
    setModel(recommended?.id ?? '');
    setCustom(!entry?.models.length);
    setBaseUrl(entry?.defaultBaseUrl ?? '');
    setLive([]);
  }, [kind, entry]);

  /** Los catálogos escritos a mano envejecen; este pregunta al proveedor. */
  async function discover() {
    if (!apiKey) { setError('Captura primero la API key para consultar sus modelos'); return; }
    setDiscovering(true);
    setError('');
    try {
      const result = await request('/admin/ai/providers/discover-models', {
        method: 'POST',
        body: JSON.stringify({ kind, apiKey, baseUrl: baseUrl || undefined }),
      });
      if (!result.ok) { setError(`No fue posible consultar los modelos: ${result.error}`); return; }
      setLive(result.models);
      setCustom(false);
      if (result.models.length && !result.models.includes(model)) setModel(result.models[0]);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No fue posible consultar');
    } finally {
      setDiscovering(false);
    }
  }

  const options = live.length
    ? live.map((id) => ({ id, label: id, context: undefined, recommended: false }))
    : entry?.models ?? [];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = Object.fromEntries(new FormData(event.currentTarget) as any) as Record<string, string>;
    try {
      await request('/admin/ai/providers', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          kind,
          apiKey,
          model: (custom ? form.customModel : model) || undefined,
          baseUrl: baseUrl || undefined,
        }),
      });
      onDone();
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No fue posible conectar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className="modal modal-wide" onSubmit={submit} role="dialog" aria-modal="true" aria-label="Conectar proveedor de IA">
        <div className="modal-head">
          <h2>Conectar proveedor de IA</h2>
          <p>La credencial se prueba contra el proveedor antes de guardarse.</p>
        </div>

        <div className="modal-body">
          {error && <Banner>{error}</Banner>}

          <label className="field">
            <span>Proveedor</span>
            <select className="select" value={kind} onChange={(event) => setKind(event.target.value)}>
              {catalog.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}
            </select>
            {entry && <span className="hint">{entry.notes}</span>}
          </label>

          <label className="field">
            <span>Nombre interno</span>
            <input className="input" name="name" required defaultValue={entry?.label} placeholder="Claude producción" />
          </label>

          <label className="field">
            <span>URL base{needsBaseUrl ? '' : ' · opcional'}</span>
            <input
              className="input" required={needsBaseUrl}
              value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
            />
            <span className="hint">
              {needsBaseUrl
                ? 'Obligatoria para un proveedor compatible con el formato de OpenAI.'
                : 'Déjala como está salvo que uses un proxy o una región distinta.'}
            </span>
          </label>

          <label className="field">
            <span>{entry?.credentialLabel ?? 'API key'}</span>
            <input
              className="input" type="password" required autoComplete="off" placeholder="••••••••••••"
              value={apiKey} onChange={(event) => setApiKey(event.target.value)}
            />
            <span className="hint">Se cifra con AES-GCM y nunca vuelve al navegador.</span>
          </label>

          {!custom && (
            <label className="field">
              <span>Modelo</span>
              <div className="row" style={{ alignItems: 'stretch' }}>
                <select
                  className="select" style={{ flex: 1 }}
                  value={model} onChange={(event) => setModel(event.target.value)}
                >
                  {options.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                      {item.context ? ` · ${item.context} de contexto` : ''}
                      {item.recommended ? ' · recomendado' : ''}
                    </option>
                  ))}
                </select>
                <Button type="button" onClick={discover} disabled={discovering}>
                  {discovering ? 'Consultando…' : 'Consultar al proveedor'}
                </Button>
              </div>
              <span className="hint">
                {live.length
                  ? `${live.length} modelos que tu credencial puede usar realmente.`
                  : 'Lista de respaldo. Consulta al proveedor para ver los que tu credencial admite hoy.'}
                {' · '}
                <button type="button" className="link-btn" style={{ display: 'inline', width: 'auto', padding: 0 }}
                  onClick={() => setCustom(true)}>
                  Escribir otro identificador
                </button>
              </span>
            </label>
          )}

          {custom && (
            <label className="field">
              <span>Identificador del modelo</span>
              <input className="input" name="customModel" required placeholder="claude-opus-5" />
              <span className="hint">
                Acepta cualquier identificador, así que un modelo nuevo no requiere actualizar el CRM.
                {options.length > 0 && (
                  <> · <button type="button" className="link-btn" style={{ display: 'inline', width: 'auto', padding: 0 }}
                    onClick={() => setCustom(false)}>Volver a la lista</button></>
                )}
              </span>
            </label>
          )}
        </div>

        <div className="modal-foot">
          <Button type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Probando credencial…' : 'Probar y conectar'}
          </Button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------- salud del sistema */

/**
 * Existe porque diagnosticar una falla obligaba a consultar la base a mano.
 * Responde de un vistazo: ¿están llegando los mensajes?, ¿la IA está fallando
 * y por qué?, ¿algún canal se cayó? (spec §14.1.1 y §19.2).
 */
export function SystemHealth() {
  const [health, setHealth] = useState<any>();
  const [metrics, setMetrics] = useState<any>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [salud, datos] = await Promise.all([
        request('/admin/system/health'),
        request('/admin/system/metrics'),
      ]);
      setHealth(salud);
      setMetrics(datos);
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  const CHECKS: [string, string][] = [
    ['database', 'Base de datos'],
    ['redis', 'Redis · cola de IA'],
    ['whatsapp', 'OpenWA'],
  ];

  const errorRate = metrics?.ia?.tasaDeError ?? 0;
  const sinResponder = metrics?.sinResponder ?? 0;

  return (
    <section className="content">
      <PageHeader
        eyebrow="Superadministración"
        title="Salud del sistema"
        description="Comprobación profunda de dependencias y métricas de las últimas 24 horas."
        actions={<Button icon="refresh" onClick={load}>Actualizar</Button>}
      />

      {error && <Banner>{error}</Banner>}

      {loading ? <div className="card"><Skeleton rows={4} /></div> : (
        <div className="stack">
          <div className="metrics">
            {CHECKS.map(([key, etiqueta]) => {
              const check = health?.checks?.[key];
              return (
                <div className="metric" key={key}>
                  <small>{etiqueta}</small>
                  <strong style={{ fontSize: 17, color: check?.ok ? 'var(--success)' : 'var(--danger)' }}>
                    {check?.ok ? 'Operativo' : 'Con fallas'}
                  </strong>
                  <div className="metric-foot">
                    {check?.ok ? `${check.latencyMs} ms` : check?.error || 'sin respuesta'}
                  </div>
                </div>
              );
            })}
          </div>

          {errorRate > 0.2 && (
            <Banner kind="warning">
              <b>{Math.round(errorRate * 100)}% de las ejecuciones de IA están fallando.</b>{' '}
              {metrics?.ia?.ultimoError?.errorMessage || 'Revisa el proveedor configurado.'}
            </Banner>
          )}
          {sinResponder > 0 && (
            <Banner kind="warning">
              <b>{sinResponder} {sinResponder === 1 ? 'conversación espera' : 'conversaciones esperan'} respuesta.</b>{' '}
              El prospecto escribió y la IA todavía no contesta.
            </Banner>
          )}

          <div className="metrics">
            <div className="metric">
              <small>Mensajes recibidos · 24 h</small>
              <strong>{metrics?.mensajes?.INBOUND ?? 0}</strong>
            </div>
            <div className="metric">
              <small>Mensajes enviados · 24 h</small>
              <strong>{metrics?.mensajes?.OUTBOUND ?? 0}</strong>
            </div>
            <div className="metric">
              <small>Ejecuciones de IA</small>
              <strong>{metrics?.ia?.ejecuciones?.SUCCESS ?? 0}</strong>
              <div className="metric-foot">{metrics?.ia?.ejecuciones?.FAILED ?? 0} fallidas</div>
            </div>
            <div className="metric">
              <small>Latencia media de IA</small>
              <strong>{((metrics?.ia?.latenciaMediaMs ?? 0) / 1000).toFixed(1)}s</strong>
            </div>
            <div className="metric">
              <small>Tokens · 24 h</small>
              <strong>{((metrics?.ia?.tokensEntrada ?? 0) + (metrics?.ia?.tokensSalida ?? 0)).toLocaleString('es-MX')}</strong>
              <div className="metric-foot">{(metrics?.ia?.tokensEntrada ?? 0).toLocaleString('es-MX')} entrada</div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div style={{ flex: 1 }}>
                <h2>Canales y webhooks</h2>
                <p>Estado de los números y entregas recibidas en las últimas 24 horas.</p>
              </div>
            </div>
            <div className="card-body">
              <div className="row row-wrap" style={{ gap: 8, marginBottom: 14 }}>
                {Object.entries(metrics?.canales ?? {}).map(([estado, cuantos]) => (
                  <Badge key={estado} value={estado}>{`${label(estado)}: ${cuantos}`}</Badge>
                ))}
                {!Object.keys(metrics?.canales ?? {}).length && (
                  <span className="muted">Ningún canal registrado.</span>
                )}
              </div>
              <div className="row row-wrap" style={{ gap: 8 }}>
                {Object.entries(metrics?.webhooks ?? {}).map(([estado, cuantos]) => (
                  <Badge key={estado} tone={estado === 'PROCESSED' ? 'success' : estado === 'FAILED' ? 'danger' : 'neutral'}>
                    {`${estado}: ${cuantos}`}
                  </Badge>
                ))}
                {!Object.keys(metrics?.webhooks ?? {}).length && (
                  <span className="muted">Sin webhooks en las últimas 24 horas.</span>
                )}
              </div>
            </div>
          </div>

          {metrics?.ia?.ultimoError && (
            <div className="card">
              <div className="card-head">
                <div style={{ flex: 1 }}>
                  <h2>Último error de IA</h2>
                  <p>{dateTime(metrics.ia.ultimoError.createdAt)} · {metrics.ia.ultimoError.model}</p>
                </div>
              </div>
              <div className="card-body">
                <p className="mono" style={{ fontSize: 12.5, color: 'var(--danger)', wordBreak: 'break-word' }}>
                  {metrics.ia.ultimoError.errorMessage}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ consumo */

export function Usage() {
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    requestList('/admin/ai/usage').then(setRows).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <section className="content">
      <PageHeader eyebrow="Superadministración" title="Consumo de IA" description="Ejecuciones y tokens por agencia." />
      <DataTable
        loading={loading}
        rows={rows}
        columns={[
          { key: 'org', head: 'Agencia', cell: (row: any) => <b>{row.organization}</b> },
          { key: 'status', head: 'Resultado', cell: (row: any) => <Badge value={row.status === 'SUCCESS' ? 'ACTIVE' : row.status} tone={row.status === 'FAILED' ? 'danger' : 'neutral'}>{row.status}</Badge> },
          { key: 'runs', head: 'Ejecuciones', align: 'right', cell: (row: any) => <span className="num">{row.runs}</span> },
          { key: 'in', head: 'Tokens entrada', align: 'right', cell: (row: any) => <span className="num">{row.promptTokens.toLocaleString('es-MX')}</span> },
          { key: 'out', head: 'Tokens salida', align: 'right', cell: (row: any) => <span className="num">{row.completionTokens.toLocaleString('es-MX')}</span> },
        ]}
        empty={<Empty icon="sparkle" title="Sin consumo registrado" text="Aparecerá en cuanto los agentes empiecen a responder." />}
      />
    </section>
  );
}
