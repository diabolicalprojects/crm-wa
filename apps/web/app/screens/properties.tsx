'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge, Banner, Button, DataTable, Empty, FormModal, Icon, PageHeader, useToast,
  type Column, type FieldSpec,
} from '../components/ui';
import { request, requestList } from '../lib/api';
import { OPERATION_TYPES, PROPERTY_STATUSES, PROPERTY_TYPES, label, location, money } from '../lib/format';

const FIELDS: FieldSpec[] = [
  { name: 'title', label: 'Título', placeholder: 'Casa en Jesús María con patio' },
  { name: 'operationType', label: 'Operación', type: 'select', options: OPERATION_TYPES, half: true },
  { name: 'propertyType', label: 'Tipo', type: 'select', options: PROPERTY_TYPES, half: true },
  { name: 'price', label: 'Precio', type: 'number', half: true },
  { name: 'currency', label: 'Moneda', defaultValue: 'MXN', required: false, half: true },
  { name: 'city', label: 'Ciudad', required: false, half: true },
  { name: 'neighborhood', label: 'Colonia', required: false, half: true },
  { name: 'bedrooms', label: 'Recámaras', type: 'number', required: false, half: true },
  { name: 'bathrooms', label: 'Baños', type: 'number', required: false, half: true },
  { name: 'parkingSpaces', label: 'Estacionamientos', type: 'number', required: false, half: true },
  { name: 'constructionM2', label: 'Construcción (m²)', type: 'number', required: false, half: true },
  { name: 'publicUrl', label: 'Enlace público', type: 'url', required: false, hint: 'La IA puede compartirlo con el prospecto.' },
  { name: 'description', label: 'Descripción', type: 'textarea', required: false },
];

export function Properties() {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<any>();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const query = new URLSearchParams();
      if (status) query.set('status', status);
      if (search) query.set('search', search);
      setRows(await requestList(`/properties${query.toString() ? `?${query}` : ''}`));
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  async function importFile(input: HTMLInputElement) {
    if (!input.files?.[0]) return;
    const form = new FormData();
    form.append('file', input.files[0]);
    try {
      const result = await request('/imports/properties', { method: 'POST', body: form });
      toast(`${result.created} creadas, ${result.updated} actualizadas, ${result.failed} con error`);
      if (result.errors?.length) setError(result.errors.slice(0, 5).join(' · '));
      load();
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No se pudo importar', 'error');
    } finally {
      input.value = '';
    }
  }

  const columns: Column<any>[] = [
    {
      key: 'title', head: 'Propiedad',
      cell: (row) => (<><b>{row.title}</b><span className="cell-sub">{location(row)}</span></>),
    },
    { key: 'operation', head: 'Operación', cell: (row) => <Badge value={row.operationType} tone="neutral" /> },
    { key: 'type', head: 'Tipo', cell: (row) => label(row.propertyType) },
    {
      key: 'features', head: 'Características',
      cell: (row) => (
        <span className="muted" style={{ fontSize: 12.5 }}>
          {[row.bedrooms && `${row.bedrooms} rec`, row.bathrooms && `${row.bathrooms} baños`,
            row.constructionM2 && `${Number(row.constructionM2)} m²`].filter(Boolean).join(' · ') || '—'}
        </span>
      ),
    },
    { key: 'price', head: 'Precio', align: 'right', cell: (row) => <b className="num">{money(row.price, row.currency)}</b> },
    { key: 'status', head: 'Estado', cell: (row) => <Badge value={row.status} /> },
    {
      key: 'actions', head: '', align: 'right',
      cell: (row) => (
        <div className="row-actions">
          <Button size="sm" icon="settings" onClick={(event) => { event.stopPropagation(); setEditing(row); }} title="Editar" />
        </div>
      ),
    },
  ];

  return (
    <section className="content">
      <PageHeader
        eyebrow="Inventario"
        title="Propiedades"
        description="Lo único que el agente de IA puede ofrecer. Si no está aquí, no lo menciona."
        actions={
          <>
            <input
              ref={file} type="file" accept=".csv,.xlsx,.xls" hidden
              onChange={(event) => importFile(event.currentTarget)}
            />
            <Button icon="upload" onClick={() => file.current?.click()}>Importar CSV o Excel</Button>
            <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Nueva propiedad</Button>
          </>
        }
      />

      {error && <Banner>{error}</Banner>}

      <div className="toolbar">
        <div className="search">
          <Icon name="search" size={15} />
          <input
            className="input" placeholder="Buscar por título o colonia"
            value={search} onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select className="select" style={{ width: 'auto' }} value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Todos los estados</option>
          {PROPERTY_STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
          {rows.length} {rows.length === 1 ? 'propiedad' : 'propiedades'}
        </span>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        empty={
          <Empty
            icon="building"
            title={search || status ? 'Sin resultados' : 'Aún no hay inventario'}
            text={search || status
              ? 'Prueba con otros criterios de búsqueda.'
              : 'Carga tus propiedades para que el agente pueda recomendarlas. Puedes importarlas desde un CSV o Excel.'}
            action={!search && !status ? (
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Agregar la primera</Button>
            ) : undefined}
          />
        }
      />

      {creating && (
        <FormModal
          wide
          title="Nueva propiedad"
          description="Los campos de ubicación y características alimentan la búsqueda del agente."
          fields={FIELDS}
          onClose={() => setCreating(false)}
          onSubmit={async (values) => {
            await request('/properties', { method: 'POST', body: JSON.stringify(values) });
            toast('Propiedad creada');
            load();
          }}
        />
      )}

      {editing && (
        <FormModal
          wide
          title="Editar propiedad"
          submitLabel="Guardar cambios"
          fields={[
            ...FIELDS.map((field) => ({ ...field, required: false, defaultValue: editing[field.name] ?? undefined })),
            { name: 'status', label: 'Estado', type: 'select', options: PROPERTY_STATUSES, defaultValue: editing.status, required: false },
          ]}
          onClose={() => setEditing(undefined)}
          onSubmit={async (values) => {
            await request(`/properties/${editing.id}`, { method: 'PATCH', body: JSON.stringify(values) });
            toast('Propiedad actualizada');
            load();
          }}
        />
      )}
    </section>
  );
}
