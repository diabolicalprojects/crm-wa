'use client';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Banner, Button, Icon, PageHeader, Skeleton, useToast } from '../components/ui';
import { request } from '../lib/api';

/**
 * Cómo se reparte un prospecto nuevo (§14.2).
 *
 * La pantalla explica qué hace cada modo en vez de nombrarlo y ya: quien la
 * configura es el dueño de una inmobiliaria, no un administrador de sistemas,
 * y elegir mal aquí se siente semanas después como una pelea por comisiones.
 */

type Miembro = { userId: string; role: string; name: string; email: string };
type Turno = { userId: string; days: number[]; from: string; to: string };

const MODOS = [
  {
    value: 'CHANNEL_RESPONSIBLE',
    label: 'Al responsable del canal',
    help: 'Cada número de WhatsApp tiene un agente, y ese agente tiene un asesor responsable. El prospecto llega directo a esa persona.',
  },
  {
    value: 'ROUND_ROBIN',
    label: 'Carrusel',
    help: 'Reparto por turnos entre asesores y supervisores activos, uno tras otro. El propietario y los administradores quedan fuera de la rotación.',
  },
  {
    value: 'ON_DUTY',
    label: 'Por guardia',
    help: 'Según el horario que definas abajo. Fuera de todo turno cae al responsable del canal, para que nadie se quede sin atender.',
  },
  {
    value: 'OWNER',
    label: 'Al propietario',
    help: 'Todo llega al dueño de la agencia, que reparte a mano.',
  },
];

const DIAS = [
  { n: 1, s: 'L' }, { n: 2, s: 'M' }, { n: 3, s: 'M' }, { n: 4, s: 'J' },
  { n: 5, s: 'V' }, { n: 6, s: 'S' }, { n: 7, s: 'D' },
];

export function Assignment() {
  const toast = useToast();
  const [mode, setMode] = useState('CHANNEL_RESPONSIBLE');
  const [sticky, setSticky] = useState(true);
  const [duty, setDuty] = useState<Turno[]>([]);
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [timezone, setTimezone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await request('/assignment');
      setMode(data.mode);
      setSticky(data.stickyAdvisor);
      setDuty(Array.isArray(data.duty) ? data.duty : []);
      setMiembros(data.miembros ?? []);
      setTimezone(data.timezone ?? '');
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      await request('/assignment', {
        method: 'PUT',
        body: JSON.stringify({ mode, stickyAdvisor: sticky, duty }),
      });
      toast('Reglas de asignación guardadas');
      await load();
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  function editarTurno(index: number, cambio: Partial<Turno>) {
    setDuty((actual) => actual.map((t, i) => (i === index ? { ...t, ...cambio } : t)));
  }

  const rotacion = miembros.filter((m) => m.role === 'ADVISOR' || m.role === 'SUPERVISOR');

  if (loading) return <section className="content"><div className="card"><Skeleton /></div></section>;

  return (
    <section className="content">
      <PageHeader
        eyebrow="Operación"
        title="Asignación de prospectos"
        description="A quién le toca atender cuando entra un mensaje de alguien nuevo."
        actions={
          <Button variant="primary" icon="check" disabled={saving} onClick={save}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </Button>
        }
      />

      {error && <Banner>{error}</Banner>}

      <div className="stack">
        {/* La regla que manda sobre todo va primero, no enterrada abajo. */}
        <div className="card">
          <div className="card-head">
            <div style={{ flex: 1 }}>
              <h2>El prospecto se queda con su asesor</h2>
              <p>Manda sobre cualquier modo que elijas abajo.</p>
            </div>
            <Badge tone={sticky ? 'success' : 'neutral'}>{sticky ? 'Activa' : 'Apagada'}</Badge>
          </div>
          <div className="card-body">
            <label className="row" style={{ alignItems: 'flex-start', gap: 11 }}>
              <input
                type="checkbox" checked={sticky} style={{ marginTop: 4 }}
                onChange={(event) => setSticky(event.target.checked)}
              />
              <span>
                <b style={{ display: 'block', fontSize: 13.5 }}>
                  Mantener al primer asesor que lo atendió
                </b>
                <span className="muted" style={{ fontSize: 13 }}>
                  Si alguien ya atendido vuelve a escribir preguntando por otra propiedad, la
                  conversación le toca a la misma persona. Apagarla hace que cada mensaje se reparta
                  de cero, y eso suele terminar en discusiones por comisión.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div style={{ flex: 1 }}>
              <h2>Cuando el prospecto es nuevo</h2>
              <p>Elige cómo se reparte a quien escribe por primera vez.</p>
            </div>
          </div>
          <div className="card-body stack">
            {MODOS.map((opcion) => (
              <label
                key={opcion.value}
                className="row"
                style={{
                  alignItems: 'flex-start', gap: 11, padding: '11px 13px',
                  border: `1px solid var(--${mode === opcion.value ? 'primary-border' : 'border'})`,
                  background: mode === opcion.value ? 'var(--primary-soft)' : 'transparent',
                  borderRadius: 'var(--r)', cursor: 'pointer',
                }}
              >
                <input
                  type="radio" name="modo" value={opcion.value} checked={mode === opcion.value}
                  style={{ marginTop: 4 }}
                  onChange={() => setMode(opcion.value)}
                />
                <span>
                  <b style={{ display: 'block', fontSize: 13.5 }}>{opcion.label}</b>
                  <span className="muted" style={{ fontSize: 13 }}>{opcion.help}</span>
                </span>
              </label>
            ))}

            {mode === 'ROUND_ROBIN' && !rotacion.length && (
              <Banner kind="warning">
                No hay asesores ni supervisores activos, así que el carrusel repartiría entre todos
                los miembros. Agrega tu equipo en <b>Equipo</b>.
              </Banner>
            )}
          </div>
        </div>

        {mode === 'ON_DUTY' && (
          <div className="card">
            <div className="card-head">
              <div style={{ flex: 1 }}>
                <h2>Horario de guardia</h2>
                <p>
                  En la zona horaria de la agencia{timezone ? ` (${timezone})` : ''}. Un turno que
                  cruza la medianoche —de 22:00 a 06:00— cuenta como uno solo.
                </p>
              </div>
              <Button
                icon="plus"
                onClick={() =>
                  setDuty((actual) => [
                    ...actual,
                    { userId: miembros[0]?.userId ?? '', days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' },
                  ])
                }
              >
                Añadir turno
              </Button>
            </div>
            <div className="card-body stack">
              {!duty.length && (
                <p className="muted" style={{ fontSize: 13 }}>
                  Sin turnos, todo cae al responsable del canal.
                </p>
              )}

              {duty.map((turno, index) => (
                <div
                  key={index}
                  className="stack"
                  style={{
                    gap: 10, padding: '13px', border: '1px solid var(--border)',
                    borderRadius: 'var(--r)',
                  }}
                >
                  <div className="row row-wrap" style={{ gap: 8 }}>
                    <select
                      className="select" style={{ flex: 1, minWidth: 180 }}
                      aria-label="Asesor de guardia"
                      value={turno.userId}
                      onChange={(event) => editarTurno(index, { userId: event.target.value })}
                    >
                      {miembros.map((m) => (
                        <option key={m.userId} value={m.userId}>{m.name || m.email}</option>
                      ))}
                    </select>
                    <input
                      className="input" type="time" style={{ width: 120 }} aria-label="Desde"
                      value={turno.from}
                      onChange={(event) => editarTurno(index, { from: event.target.value })}
                    />
                    <input
                      className="input" type="time" style={{ width: 120 }} aria-label="Hasta"
                      value={turno.to}
                      onChange={(event) => editarTurno(index, { to: event.target.value })}
                    />
                    <Button
                      icon="trash" variant="danger" title="Quitar turno"
                      onClick={() => setDuty((actual) => actual.filter((_, i) => i !== index))}
                    />
                  </div>
                  <div className="row row-wrap" style={{ gap: 5 }}>
                    {DIAS.map((dia) => {
                      const activo = turno.days.includes(dia.n);
                      return (
                        <button
                          key={dia.n}
                          type="button"
                          className={`btn btn-sm ${activo ? 'btn-primary' : 'btn-ghost'}`}
                          style={{ minWidth: 34 }}
                          aria-pressed={activo}
                          onClick={() =>
                            editarTurno(index, {
                              days: activo
                                ? turno.days.filter((d) => d !== dia.n)
                                : [...turno.days, dia.n].sort(),
                            })
                          }
                        >
                          {dia.s}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-head">
            <div style={{ flex: 1 }}>
              <h2>Quién puede recibir</h2>
              <p>Miembros activos de la agencia.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Persona</th><th>Rol</th><th>En el carrusel</th></tr>
              </thead>
              <tbody>
                {miembros.map((m) => (
                  <tr key={m.userId}>
                    <td data-label="Persona"><b>{m.name || m.email}</b><span className="cell-sub">{m.email}</span></td>
                    <td data-label="Rol"><Badge value={m.role} /></td>
                    <td data-label="En el carrusel">
                      {m.role === 'ADVISOR' || m.role === 'SUPERVISOR' ? (
                        <span className="row" style={{ gap: 6, color: 'var(--success)' }}>
                          <Icon name="check" size={15} /> Sí
                        </span>
                      ) : (
                        <span className="muted">No</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
