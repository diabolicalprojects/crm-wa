'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Badge, Banner, Button, Confirm, DataTable, Empty, FormModal, PageHeader, useToast,
  type Column,
} from '../components/ui';
import { request, requestList } from '../lib/api';
import { dateTime, phone } from '../lib/format';

export function Appointments({ organizationId }: { organizationId?: string }) {
  const toast = useToast();
  const [rows, setRows] = useState<any[]>([]);
  const [leads, setLeads] = useState<any[]>([]);
  const [properties, setProperties] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState<any>();

  const load = useCallback(async () => {
    try {
      setRows(await requestList('/appointments'));
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    requestList('/leads').then(setLeads).catch(() => {});
    requestList('/properties?status=AVAILABLE').then(setProperties).catch(() => {});
    if (organizationId) {
      requestList(`/organizations/${organizationId}/members`).then(setMembers).catch(() => {});
    }
  }, [organizationId]);

  async function confirm(row: any) {
    try {
      await request(`/appointments/${row.id}/confirm`, { method: 'POST' });
      toast('Visita confirmada');
      load();
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No fue posible', 'error');
    }
  }

  const pending = rows.filter((row) => row.status === 'REQUESTED');

  const columns: Column<any>[] = [
    {
      key: 'when', head: 'Cuándo',
      cell: (row) => (<><b>{dateTime(row.startsAt)}</b><span className="cell-sub">hasta {dateTime(row.endsAt)}</span></>),
    },
    {
      key: 'lead', head: 'Prospecto',
      cell: (row) => (<><b>{row.lead?.name || 'Sin nombre'}</b><span className="cell-sub mono">{phone(row.lead?.phone)}</span></>),
    },
    { key: 'property', head: 'Propiedad', cell: (row) => row.property?.title || <span className="muted">Sin propiedad</span> },
    { key: 'advisor', head: 'Asesor', cell: (row) => row.assignedUser?.name || '—' },
    { key: 'status', head: 'Estado', cell: (row) => <Badge value={row.status} /> },
    {
      key: 'actions', head: '', align: 'right',
      cell: (row) => (
        <div className="row-actions">
          {row.status === 'REQUESTED' && (
            <Button size="sm" variant="primary" onClick={(event) => { event.stopPropagation(); confirm(row); }}>Confirmar</Button>
          )}
          {row.status !== 'CANCELLED' && (
            <Button size="sm" variant="danger" onClick={(event) => { event.stopPropagation(); setCancelling(row); }}>Cancelar</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <section className="content">
      <PageHeader
        eyebrow="Agenda"
        title="Visitas"
        description="Las que solicita la IA llegan como pendientes: un asesor las confirma."
        actions={<Button variant="primary" icon="plus" onClick={() => setCreating(true)}>Agendar visita</Button>}
      />

      {error && <Banner>{error}</Banner>}
      {pending.length > 0 && (
        <Banner kind="warning">
          <b>{pending.length} {pending.length === 1 ? 'visita solicitada' : 'visitas solicitadas'} sin confirmar.</b>{' '}
          El prospecto ya sabe que un asesor le confirmará.
        </Banner>
      )}

      <DataTable
        columns={columns}
        rows={rows}
        loading={loading}
        empty={
          <Empty
            icon="calendar"
            title="No hay visitas agendadas"
            text="Cuando un prospecto muestre intención, la IA registrará la solicitud aquí para que la confirmes."
          />
        }
      />

      {creating && (
        <FormModal
          wide
          title="Agendar visita"
          fields={[
            {
              name: 'leadId', label: 'Prospecto', type: 'select',
              options: leads.map((lead) => ({ value: lead.id, label: lead.name || phone(lead.phone) })),
            },
            {
              name: 'propertyId', label: 'Propiedad', type: 'select', required: false,
              options: properties.map((property) => ({ value: property.id, label: property.title })),
            },
            {
              name: 'assignedUserId', label: 'Asesor', type: 'select',
              options: members.map((member) => ({ value: member.user.id, label: member.user.name })),
            },
            { name: 'startsAt', label: 'Inicio', type: 'datetime-local', half: true },
            { name: 'endsAt', label: 'Fin', type: 'datetime-local', half: true },
            { name: 'notes', label: 'Notas', type: 'textarea', required: false },
          ]}
          onClose={() => setCreating(false)}
          onSubmit={async (values) => {
            await request('/appointments', {
              method: 'POST',
              body: JSON.stringify({
                ...values,
                startsAt: new Date(values.startsAt).toISOString(),
                endsAt: new Date(values.endsAt).toISOString(),
              }),
            });
            toast('Visita agendada');
            load();
          }}
        />
      )}

      {cancelling && (
        <Confirm
          danger
          title="Cancelar visita"
          text="La visita quedará marcada como cancelada. Avisa al prospecto por su cuenta."
          confirmLabel="Cancelar visita"
          onClose={() => setCancelling(undefined)}
          onConfirm={async () => {
            await request(`/appointments/${cancelling.id}`, { method: 'DELETE' });
            toast('Visita cancelada');
            load();
          }}
        />
      )}
    </section>
  );
}
