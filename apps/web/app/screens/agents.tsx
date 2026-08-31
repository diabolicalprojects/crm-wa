'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Banner, Button, Confirm, DataTable, Empty, FormModal, Modal, PageHeader, useToast,
  type Column,
} from '../components/ui';
import { request, requestList } from '../lib/api';
import { OPERATION_MODES, label, phone, relative } from '../lib/format';

/* ------------------------------------------------------------------ agentes */

export function Agents({ organizationId }: { organizationId?: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>();
  const [assigning, setAssigning] = useState<any>();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [agents, sessionList] = await Promise.all([
        requestList('/agents'),
        requestList('/whatsapp/sessions').catch(() => []),
      ]);
      setRows(agents);
      setSessions(sessionList);
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!organizationId) return;
    requestList(`/organizations/${organizationId}/members`).then(setMembers).catch(() => setMembers([]));
  }, [organizationId]);

  const memberOptions = members.map((member) => ({ value: member.user.id, label: `${member.user.name} · ${label(member.role)}` }));
  const freeSessions = sessions.filter((session) => !session.agentId && session.status !== 'DELETED');

  async function toggle(agent: any) {
    const path = agent.status === 'ACTIVE' ? 'pause' : 'activate';
    try {
      await request(`/agents/${agent.id}/${path}`, { method: 'POST' });
      toast(path === 'pause' ? 'Agente pausado' : 'Agente activado');
      load();
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No fue posible', 'error');
    }
  }

  const columns: Column<any>[] = [
    {
      key: 'agent', head: 'Agente',
      cell: (row) => (<><b>{row.name}</b><span className="cell-sub">{row.description || 'Sin descripción'}</span></>),
    },
    { key: 'owner', head: 'Asesor responsable', cell: (row) => row.responsibleUser?.name || '—' },
    { key: 'mode', head: 'Modo', cell: (row) => <Badge value={row.operationMode} tone="neutral" /> },
    { key: 'status', head: 'Estado', cell: (row) => <Badge value={row.status} /> },
    {
      key: 'channel', head: 'Canal',
      cell: (row) => row.session
        ? <span className="mono">{row.session.phoneNumber ? phone(row.session.phoneNumber) : row.session.name}</span>
        : <span className="muted">Sin canal</span>,
    },
    {
      key: 'actions', head: '', align: 'right',
      cell: (row) => (
        <div className="row-actions">
          <Button size="sm" onClick={(event) => { event.stopPropagation(); setAssigning(row); }}>
            {row.session ? 'Cambiar canal' : 'Asignar canal'}
          </Button>
          <Button size="sm" onClick={(event) => { event.stopPropagation(); toggle(row); }}>
            {row.status === 'ACTIVE' ? 'Pausar' : 'Activar'}
          </Button>
          <Button size="sm" icon="settings" title="Editar" onClick={(event) => { event.stopPropagation(); setEditing(row); }} />
        </div>
      ),
    },
  ];

  const formFields = (agent?: any) => [
    { name: 'name', label: 'Nombre visible', placeholder: 'Andrea — Asesora residencial', defaultValue: agent?.name },
    { name: 'description', label: 'Función en el equipo', required: false, defaultValue: agent?.description ?? '' },
    {
      name: 'responsibleUserId', label: 'Asesor responsable', type: 'select' as const,
      options: memberOptions, defaultValue: agent?.responsibleUserId,
      hint: 'Cada asesor puede representar a un solo agente activo.',
    },
    {
      name: 'operationMode', label: 'Modo de operación', type: 'select' as const,
      options: OPERATION_MODES, defaultValue: agent?.operationMode ?? 'HYBRID',
    },
    { name: 'tone', label: 'Tono', required: false, placeholder: 'profesional, cálido y directo', defaultValue: agent?.tone ?? '' },
    {
      name: 'greetingMessage', label: 'Saludo inicial', required: false, type: 'textarea' as const,
      defaultValue: agent?.greetingMessage ?? '',
      placeholder: 'Hola, soy Andrea del equipo inmobiliario. ¿Buscas comprar o rentar?',
    },
    {
      name: 'systemInstructions', label: 'Instrucciones', required: false, type: 'textarea' as const,
      defaultValue: agent?.systemInstructions ?? '',
      hint: 'Reglas propias de tu agencia. No pueden contradecir las reglas antialucinación del sistema.',
    },
  ];

  return (
    <section className="content">
      <PageHeader
        eyebrow="Automatización"
        title="Agentes de IA"
        description="Cada agente representa a un asesor real, con su identidad, sus reglas y su número."
        actions={
          <Button variant="primary" icon="plus" disabled={!memberOptions.length} onClick={() => setCreating(true)}>
            Nuevo agente
          </Button>
        }
      />

      {error && <Banner>{error}</Banner>}
      {!memberOptions.length && !loading && (
        <Banner kind="warning">
          Para crear un agente primero necesitas un miembro del equipo que lo represente. Agrégalo en <b>Equipo</b>.
        </Banner>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        empty={
          <Empty
            icon="bot"
            title="Todavía no hay agentes"
            text="Un agente es la identidad con la que la IA responde: nombre, tono, reglas y el número de WhatsApp que usa."
          />
        }
      />

      {creating && (
        <FormModal
          wide
          title="Nuevo agente"
          description="Se crea en borrador. Actívalo cuando tenga un canal asignado."
          fields={formFields()}
          onClose={() => setCreating(false)}
          onSubmit={async (values) => {
            await request('/agents', { method: 'POST', body: JSON.stringify(values) });
            toast('Agente creado');
            load();
          }}
        />
      )}

      {editing && (
        <FormModal
          wide
          title={`Editar ${editing.name}`}
          submitLabel="Guardar cambios"
          fields={formFields(editing).map((field) => ({ ...field, required: false }))}
          onClose={() => setEditing(undefined)}
          onSubmit={async (values) => {
            await request(`/agents/${editing.id}`, { method: 'PATCH', body: JSON.stringify(values) });
            toast('Agente actualizado');
            load();
          }}
        />
      )}

      {assigning && (
        <AssignChannel
          agent={assigning}
          sessions={freeSessions}
          onClose={() => setAssigning(undefined)}
          onDone={() => { load(); toast('Canal actualizado'); }}
        />
      )}
    </section>
  );
}

function AssignChannel({ agent, sessions, onClose, onDone }: {
  agent: any; sessions: any[]; onClose: () => void; onDone: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState(sessions[0]?.id ?? '');

  async function save(sessionId: string) {
    setBusy(true);
    try {
      await request(`/agents/${agent.id}/session-assignment`, {
        method: 'PUT',
        body: JSON.stringify({ whatsappSessionId: sessionId }),
      });
      onDone();
      onClose();
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No fue posible', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function unassign() {
    setBusy(true);
    try {
      await request(`/agents/${agent.id}/session-assignment`, { method: 'DELETE' });
      onDone();
      onClose();
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No fue posible', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Canal de ${agent.name}`}
      description="Un agente usa un solo número, y un número atiende a un solo agente."
      onClose={onClose}
      footer={
        <>
          {agent.session && <Button variant="danger" disabled={busy} onClick={unassign}>Quitar canal</Button>}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" disabled={busy || !choice} onClick={() => save(choice)}>
            {busy ? 'Guardando…' : 'Asignar'}
          </Button>
        </>
      }
    >
      {agent.session && (
        <Banner kind="info">
          Ahora usa <b>{agent.session.name}</b>. Quita el canal actual antes de asignar otro.
        </Banner>
      )}
      {sessions.length ? (
        <label className="field">
          <span>Sesión disponible</span>
          <select className="select" value={choice} onChange={(event) => setChoice(event.target.value)}>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.name}{session.phoneNumber ? ` · ${phone(session.phoneNumber)}` : ''} — {label(session.status)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="muted">
          No hay sesiones libres. Crea una en <b>WhatsApp</b> o libera la de otro agente.
        </p>
      )}
    </Modal>
  );
}

/* --------------------------------------------------------------- sesiones */

export function WhatsApp() {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [qrFor, setQrFor] = useState<any>();
  const [removing, setRemoving] = useState<any>();

  const load = useCallback(async () => {
    try {
      setRows(await requestList('/whatsapp/sessions'));
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function refresh(session: any) {
    try {
      const updated = await request(`/whatsapp/sessions/${session.id}/status`);
      toast(`Estado: ${label(updated.status)}`);
      load();
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No fue posible consultar', 'error');
    }
  }

  async function reconnect(session: any) {
    try {
      await request(`/whatsapp/sessions/${session.id}/reconnect`, { method: 'POST' });
      toast('Reconectando…');
      load();
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No fue posible', 'error');
    }
  }

  const columns: Column<any>[] = [
    {
      key: 'session', head: 'Sesión',
      cell: (row) => (<><b>{row.name}</b><span className="cell-sub mono">{row.phoneNumber ? phone(row.phoneNumber) : 'Número pendiente'}</span></>),
    },
    { key: 'status', head: 'Estado', cell: (row) => <Badge value={row.status} /> },
    { key: 'agent', head: 'Agente', cell: (row) => row.agent?.name || <span className="muted">Sin asignar</span> },
    { key: 'seen', head: 'Última señal', cell: (row) => <span className="muted">{relative(row.lastSeenAt) || '—'}</span> },
    {
      key: 'actions', head: '', align: 'right',
      cell: (row) => (
        <div className="row-actions">
          {row.status !== 'CONNECTED' && (
            <Button size="sm" icon="qr" onClick={(event) => { event.stopPropagation(); setQrFor(row); }}>Ver QR</Button>
          )}
          <Button size="sm" icon="refresh" title="Actualizar estado" onClick={(event) => { event.stopPropagation(); refresh(row); }} />
          {row.status === 'DISCONNECTED' && (
            <Button size="sm" onClick={(event) => { event.stopPropagation(); reconnect(row); }}>Reconectar</Button>
          )}
          <Button size="sm" variant="danger" icon="trash" title="Eliminar" onClick={(event) => { event.stopPropagation(); setRemoving(row); }} />
        </div>
      ),
    },
  ];

  const disconnected = rows.filter((row) => row.status === 'DISCONNECTED' || row.status === 'FAILED');

  return (
    <section className="content">
      <PageHeader
        eyebrow="Canales"
        title="WhatsApp"
        description="Números conectados mediante OpenWA. Cada sesión puede atender a un agente."
        actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Nueva sesión</Button>}
      />

      {error && <Banner>{error}</Banner>}
      {disconnected.length > 0 && (
        <Banner kind="warning">
          <b>{disconnected.length} {disconnected.length === 1 ? 'sesión' : 'sesiones'} sin conexión.</b>{' '}
          Mientras esté así, esos números no envían ni reciben mensajes.
        </Banner>
      )}

      <Banner kind="info">
        WhatsApp se conecta con un cliente no oficial. Usa números dedicados, evita envíos masivos
        y ten presente que existe riesgo de restricción de la cuenta.
      </Banner>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        empty={
          <Empty
            icon="phone"
            title="Ningún número conectado"
            text="Crea una sesión y escanea el QR desde el WhatsApp del número que atenderá a los prospectos."
            action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Conectar un número</Button>}
          />
        }
      />

      {creating && (
        <FormModal
          title="Nueva sesión de WhatsApp"
          description="Se crea en OpenWA y queda lista para escanear el QR."
          submitLabel="Crear y generar QR"
          fields={[{
            name: 'name', label: 'Nombre interno', placeholder: 'Ventas residencial',
            hint: 'Solo para identificarla dentro del CRM.',
          }]}
          onClose={() => setCreating(false)}
          onSubmit={async (values) => {
            const session = await request('/whatsapp/sessions', { method: 'POST', body: JSON.stringify(values) });
            toast('Sesión creada');
            await load();
            setQrFor(session);
          }}
        />
      )}

      {qrFor && <QrModal session={qrFor} onClose={() => { setQrFor(undefined); load(); }} />}

      {removing && (
        <Confirm
          danger
          title={`Eliminar ${removing.name}`}
          text="Se desconectará el número en OpenWA. El historial de conversaciones se conserva."
          confirmLabel="Eliminar sesión"
          onClose={() => setRemoving(undefined)}
          onConfirm={async () => {
            await request(`/whatsapp/sessions/${removing.id}`, { method: 'DELETE' });
            toast('Sesión eliminada');
            load();
          }}
        />
      )}
    </section>
  );
}

function QrModal({ session, onClose }: { session: any; onClose: () => void }) {
  const [qr, setQr] = useState('');
  const [status, setStatus] = useState(session.status);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const result = await request(`/whatsapp/sessions/${session.id}/qr`);
        if (!active) return;
        setQr(result.qrCode || '');
        setStatus(result.status);
        setError('');
      } catch (problem) {
        if (active) setError(problem instanceof Error ? problem.message : 'No fue posible obtener el QR');
      }
    }
    poll();
    // El QR de WhatsApp caduca en segundos; se renueva mientras el modal siga
    // abierto para que el usuario no escanee uno vencido.
    const timer = setInterval(poll, 8000);
    return () => { active = false; clearInterval(timer); };
  }, [session.id]);

  const connected = status === 'CONNECTED';

  return (
    <Modal
      title={connected ? 'Número conectado' : 'Escanea el código'}
      description={connected
        ? 'La sesión quedó lista. Asígnala a un agente para que empiece a responder.'
        : 'Abre WhatsApp en el teléfono → Dispositivos vinculados → Vincular dispositivo.'}
      onClose={onClose}
      footer={<Button variant="primary" onClick={onClose}>{connected ? 'Listo' : 'Cerrar'}</Button>}
    >
      {error && <Banner>{error}</Banner>}
      {connected ? (
        <div className="empty" style={{ padding: '24px 0' }}>
          <span className="empty-icon" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>✓</span>
          <b>Conexión establecida</b>
          <p>El número ya puede enviar y recibir mensajes.</p>
        </div>
      ) : qr ? (
        <div className="qr-frame"><img src={qr} alt="Código QR para vincular WhatsApp" /></div>
      ) : (
        <div className="qr-frame"><div className="skel" style={{ width: 236, height: 236 }} /></div>
      )}
      {!connected && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 12, textAlign: 'center' }}>
          El código se renueva solo cada pocos segundos.
        </p>
      )}
    </Modal>
  );
}
