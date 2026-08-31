'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Avatar, Badge, Banner, Button, DataTable, Empty, FormModal, Icon, PageHeader, useToast,
  type Column,
} from '../components/ui';
import { request, requestList } from '../lib/api';
import { initials, label, phone, relative } from '../lib/format';

const STAGES = [
  { value: 'NEW', label: 'Nuevo' },
  { value: 'CONTACTED', label: 'Contactado' },
  { value: 'QUALIFYING', label: 'Calificando' },
  { value: 'QUALIFIED', label: 'Calificado' },
  { value: 'VISIT_SCHEDULED', label: 'Visita agendada' },
  { value: 'WON', label: 'Ganado' },
  { value: 'LOST', label: 'Perdido' },
];

export function Leads() {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>();
  const [stage, setStage] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (stage) query.set('stage', stage);
      if (search) query.set('search', search);
      setRows(await requestList(`/leads${query.toString() ? `?${query}` : ''}`));
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [stage, search]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const columns: Column<any>[] = [
    {
      key: 'lead', head: 'Prospecto',
      cell: (row) => (
        <div className="row">
          <Avatar small text={initials(row.name, '·')} />
          <span>
            <b>{row.name || 'Sin nombre'}</b>
            <span className="cell-sub mono">{phone(row.phone)}</span>
          </span>
        </div>
      ),
    },
    { key: 'stage', head: 'Etapa', cell: (row) => <Badge value={row.stage} /> },
    {
      key: 'score', head: 'Calificación', align: 'right',
      cell: (row) => <span className="num"><b>{row.score}</b><span className="muted">/100</span></span>,
    },
    {
      key: 'conversations', head: 'Conversaciones', align: 'right',
      cell: (row) => <span className="num">{row._count?.conversations ?? 0}</span>,
    },
    { key: 'updated', head: 'Actividad', align: 'right', cell: (row) => <span className="muted">{relative(row.updatedAt)}</span> },
    {
      key: 'actions', head: '', align: 'right',
      cell: (row) => (
        <div className="row-actions">
          <Button size="sm" icon="settings" title="Editar" onClick={(event) => { event.stopPropagation(); setEditing(row); }} />
        </div>
      ),
    },
  ];

  return (
    <section className="content">
      <PageHeader
        eyebrow="Comercial"
        title="Prospectos"
        description="Personas identificadas por su teléfono, con lo que la IA fue capturando de cada una."
        actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Nuevo prospecto</Button>}
      />

      {error && <Banner>{error}</Banner>}

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={15} />
          <input
            className="input" placeholder="Buscar por nombre o teléfono"
            value={search} onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select className="select" style={{ width: 'auto' }} value={stage} onChange={(event) => setStage(event.target.value)}>
          <option value="">Todas las etapas</option>
          {STAGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
          {rows.length} {rows.length === 1 ? 'prospecto' : 'prospectos'}
        </span>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        empty={
          <Empty
            icon="users"
            title={search || stage ? 'Sin resultados' : 'Todavía no hay prospectos'}
            text={search || stage
              ? 'Prueba con otros criterios.'
              : 'Se crean solos cuando alguien escribe al WhatsApp conectado. También puedes capturarlos a mano.'}
          />
        }
      />

      {creating && (
        <FormModal
          title="Nuevo prospecto"
          fields={[
            { name: 'name', label: 'Nombre', required: false },
            { name: 'phone', label: 'Teléfono', type: 'tel', hint: 'Solo dígitos, con código de país. Ejemplo: 5214490000000' },
            { name: 'email', label: 'Correo', type: 'email', required: false },
          ]}
          onClose={() => setCreating(false)}
          onSubmit={async (values) => {
            await request('/leads', { method: 'POST', body: JSON.stringify(values) });
            toast('Prospecto creado');
            load();
          }}
        />
      )}

      {editing && (
        <FormModal
          title={editing.name || phone(editing.phone)}
          description="Ajusta la etapa y la calificación del prospecto."
          submitLabel="Guardar"
          fields={[
            { name: 'name', label: 'Nombre', required: false, defaultValue: editing.name ?? '' },
            { name: 'email', label: 'Correo', type: 'email', required: false, defaultValue: editing.email ?? '' },
            { name: 'stage', label: 'Etapa', type: 'select', options: STAGES, defaultValue: editing.stage, required: false, half: true },
            { name: 'score', label: 'Calificación', type: 'number', required: false, defaultValue: String(editing.score ?? 0), half: true },
          ]}
          onClose={() => setEditing(undefined)}
          onSubmit={async (values) => {
            const body: Record<string, unknown> = { ...values };
            if (body.score !== undefined) body.score = Number(body.score);
            await request(`/leads/${editing.id}`, { method: 'PATCH', body: JSON.stringify(body) });
            toast('Prospecto actualizado');
            load();
          }}
        />
      )}
    </section>
  );
}
