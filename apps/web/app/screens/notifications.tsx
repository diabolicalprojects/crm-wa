'use client';
import { useCallback, useEffect, useState } from 'react';
import { Banner, Button, PageHeader, Skeleton, useToast } from '../components/ui';
import { request } from '../lib/api';

/**
 * Qué avisos quiere cada quien y por dónde.
 *
 * Es una preferencia personal, no una configuración de la agencia: cada quien
 * la suya, incluso dentro del mismo equipo.
 */

const CANALES = [
  { value: 'APP', label: 'En la consola', help: 'Aparece en la campana.' },
  { value: 'WHATSAPP', label: 'Por WhatsApp', help: 'Llega a tu número desde el de la agencia.' },
];

export function Notifications() {
  const toast = useToast();
  const [canales, setCanales] = useState<Record<string, string[]>>({});
  const [etiquetas, setEtiquetas] = useState<Record<string, string>>({});
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await request('/notifications/preferencias');
      setCanales(data.canales ?? {});
      setEtiquetas(data.etiquetas ?? {});
      setPhone(data.phone ?? '');
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function alternar(kind: string, canal: string) {
    setCanales((actual) => {
      const activos = actual[kind] ?? [];
      return {
        ...actual,
        [kind]: activos.includes(canal)
          ? activos.filter((c) => c !== canal)
          : [...activos, canal],
      };
    });
  }

  async function guardar() {
    setSaving(true);
    try {
      await request('/notifications/preferencias', {
        method: 'PUT',
        body: JSON.stringify({ canales, phone }),
      });
      toast('Preferencias guardadas');
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No se pudo guardar', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <section className="content"><div className="card"><Skeleton /></div></section>;

  const quiereWhatsapp = Object.values(canales).some((lista) => lista.includes('WHATSAPP'));

  return (
    <section className="content">
      <PageHeader
        eyebrow="Tu cuenta"
        title="Avisos"
        description="De qué quieres enterarte y por dónde. Es tu preferencia, no la de la agencia."
        actions={
          <Button variant="primary" icon="check" disabled={saving} onClick={guardar}>
            {saving ? 'Guardando…' : 'Guardar'}
          </Button>
        }
      />

      {error && <Banner>{error}</Banner>}

      <div className="stack">
        <div className="card">
          <div className="card-head">
            <div style={{ flex: 1 }}>
              <h2>Tu número de WhatsApp</h2>
              <p>Adónde mandarte los avisos que elijas recibir por ahí.</p>
            </div>
          </div>
          <div className="card-body">
            <label className="field" style={{ marginBottom: 0, maxWidth: 320 }}>
              <span>Teléfono</span>
              <input
                className="input" type="tel" placeholder="+52 449 118 2244"
                value={phone} onChange={(event) => setPhone(event.target.value)}
              />
              <span className="hint">
                Lo capturas tú y solo se usa para avisarte. Los avisos salen desde el número
                de la agencia.
              </span>
            </label>

            {quiereWhatsapp && !phone.trim() && (
              <div style={{ marginTop: 14 }}>
                <Banner kind="warning">
                  Pediste avisos por WhatsApp pero no hay número. Esos avisos no van a llegar
                  hasta que lo captures.
                </Banner>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div style={{ flex: 1 }}>
              <h2>Qué te avisamos</h2>
              <p>Dejar un evento sin ningún canal lo silencia por completo.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Evento</th>
                  {CANALES.map((c) => <th key={c.value}>{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {Object.entries(etiquetas).map(([kind, etiqueta]) => (
                  <tr key={kind}>
                    <td data-label="Evento"><b>{etiqueta}</b></td>
                    {CANALES.map((canal) => (
                      <td data-label={canal.label} key={canal.value}>
                        <label className="row" style={{ gap: 7 }}>
                          <input
                            type="checkbox"
                            checked={(canales[kind] ?? []).includes(canal.value)}
                            onChange={() => alternar(kind, canal.value)}
                          />
                          <span className="muted" style={{ fontSize: 12 }}>{canal.help}</span>
                        </label>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="muted" style={{ fontSize: 12.5 }}>
          Todavía no hay avisos por correo: esta instalación no tiene servidor de correo
          configurado, y un canal que falla en silencio es peor que uno que no se ofrece.
        </p>
      </div>
    </section>
  );
}
