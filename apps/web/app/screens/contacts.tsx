'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Banner, Button, Confirm, DataTable, Empty, FormModal, Icon, PageHeader, useToast,
  type Column,
} from '../components/ui';
import { request } from '../lib/api';
import { CONTACT_KINDS, label, money, phone } from '../lib/format';

/**
 * La libreta de la agencia.
 *
 * Aquí vive la persona; en Prospectos vive la oportunidad. Están separados
 * porque un propietario, un notario o un colega no tienen una oportunidad que
 * cerrar, y meterlos al embudo lo ensucia con registros que nunca avanzan.
 */

const CAMPOS = [
  { name: 'name', label: 'Nombre' },
  { name: 'kind', label: 'Qué es', type: 'select' as const, options: CONTACT_KINDS, half: true },
  { name: 'phone', label: 'Teléfono', type: 'tel' as const, required: false, half: true, hint: 'Único por agencia: evita dos fichas del mismo dueño.' },
  { name: 'email', label: 'Correo', type: 'email' as const, required: false, half: true },
  { name: 'company', label: 'Empresa', required: false, half: true },
  { name: 'notes', label: 'Notas', type: 'textarea' as const, required: false },
];

export function Contacts() {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>();
  const [deleting, setDeleting] = useState<any>();

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (search) query.set('search', search);
      if (kind) query.set('kind', kind);
      const data = await request(`/contacts${query.toString() ? `?${query}` : ''}`);
      setRows(data.items ?? []);
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [search, kind]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const columns: Column<any>[] = [
    {
      key: 'name', head: 'Contacto',
      cell: (row) => (
        <>
          <b>{row.name}</b>
          <span className="cell-sub">{row.company || phone(row.phone) || row.email || '—'}</span>
        </>
      ),
    },
    { key: 'kind', head: 'Qué es', cell: (row) => <Badge value={row.kind} tone="neutral" /> },
    {
      key: 'contacto', head: 'Contacto',
      cell: (row) => (
        <span className="muted" style={{ fontSize: 12.5 }}>
          {[row.phone && phone(row.phone), row.email].filter(Boolean).join(' · ') || '—'}
        </span>
      ),
    },
    {
      key: 'props', head: 'Inmuebles', align: 'right',
      cell: (row) => (
        <span className="num">{row._count?.ownedProperties ?? 0}</span>
      ),
    },
    {
      key: 'actions', head: '', align: 'right',
      cell: (row) => (
        <div className="row-actions">
          <Button size="sm" icon="settings" title="Editar"
            onClick={(event) => { event.stopPropagation(); setEditing(row); }} />
          <Button size="sm" variant="danger" icon="trash" title="Borrar"
            onClick={(event) => { event.stopPropagation(); setDeleting(row); }} />
        </div>
      ),
    },
  ];

  return (
    <section className="content">
      <PageHeader
        eyebrow="Organización"
        title="Contactos"
        description="Las personas de la agencia: propietarios, notarios, colegas. La oportunidad vive en Prospectos."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
            Nuevo contacto
          </Button>
        }
      />

      {error && <Banner>{error}</Banner>}

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={15} />
          <input
            className="input" placeholder="Buscar por nombre, teléfono o empresa"
            value={search} onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select className="select" style={{ width: 'auto' }} value={kind}
          onChange={(event) => setKind(event.target.value)}>
          <option value="">Todos</option>
          {CONTACT_KINDS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
          {rows.length} {rows.length === 1 ? 'contacto' : 'contactos'}
        </span>
      </div>

      <DataTable
        columns={columns} rows={rows} loading={loading}
        empty={
          <Empty
            icon="users"
            title="La libreta está vacía"
            text="Aquí van los dueños de los inmuebles que traes, y cualquier persona que no es un prospecto."
            action={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Nuevo contacto</Button>}
          />
        }
      />

      {creating && (
        <FormModal
          wide
          title="Nuevo contacto"
          fields={CAMPOS}
          onClose={() => setCreating(false)}
          onSubmit={async (values) => {
            await request('/contacts', { method: 'POST', body: JSON.stringify(values) });
            toast('Contacto creado');
            load();
          }}
        />
      )}

      {editing && (
        <FormModal
          wide
          title={`Editar ${editing.name}`}
          submitLabel="Guardar cambios"
          fields={CAMPOS.map((field) => ({
            ...field, required: false, defaultValue: editing[field.name] ?? '',
          }))}
          onClose={() => setEditing(undefined)}
          onSubmit={async (values) => {
            await request(`/contacts/${editing.id}`, { method: 'PATCH', body: JSON.stringify(values) });
            toast('Contacto actualizado');
            load();
          }}
        />
      )}

      {deleting && (
        <Confirm
          danger
          title={`Borrar a ${deleting.name}`}
          text={
            deleting._count?.ownedProperties
              ? `Es dueño de ${deleting._count.ownedProperties} inmueble(s). Quítalo de sus fichas antes de borrarlo.`
              : 'Se elimina de la libreta. Esta acción no se puede deshacer.'
          }
          confirmLabel="Borrar"
          onClose={() => setDeleting(undefined)}
          onConfirm={async () => {
            try {
              await request(`/contacts/${deleting.id}`, { method: 'DELETE' });
              toast('Contacto borrado');
              load();
            } catch (problem) {
              toast(problem instanceof Error ? problem.message : 'No se pudo borrar', 'error');
            }
          }}
        />
      )}
    </section>
  );
}
