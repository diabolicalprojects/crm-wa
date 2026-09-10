'use client';
import { useState } from 'react';
import { Badge, Button, Modal, useToast } from './ui';
import { request } from '../lib/api';
import { dateTime, label, money } from '../lib/format';

/**
 * Compartir la ficha y el reporte al propietario.
 *
 * Son las dos cosas que el asesor enseña hacia afuera —una al cliente, otra al
 * dueño del inmueble— y las únicas que hacen que el CRM se note fuera del
 * equipo.
 */

export function ShareModal({ property, onClose }: { property: any; onClose: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [ocupado, setOcupado] = useState(false);

  async function generar() {
    setOcupado(true);
    try {
      const data = await request(`/properties/${property.id}/share`, { method: 'POST' });
      setUrl(data.url);
      toast(url ? 'Enlace regenerado. El anterior dejó de servir.' : 'Enlace creado');
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No se pudo generar', 'error');
    } finally {
      setOcupado(false);
    }
  }

  async function revocar() {
    setOcupado(true);
    try {
      await request(`/properties/${property.id}/share`, { method: 'DELETE' });
      setUrl('');
      toast('Enlace revocado');
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No se pudo revocar', 'error');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal
      title="Compartir ficha"
      description="Un enlace público que puedes mandar por WhatsApp. No pide contraseña."
      onClose={onClose}
      footer={<Button onClick={onClose}>Cerrar</Button>}
    >
      <p style={{ fontSize: 13.5, color: 'var(--text-2)', marginBottom: 14 }}>
        La ficha muestra fotos, precio, características y colonia.{' '}
        <b>No muestra al propietario, tu comisión ni tus notas internas.</b>
        {!property.showExactAddress && ' La calle exacta queda oculta.'}
      </p>

      {url ? (
        <>
          <div
            className="mono"
            style={{
              padding: '10px 12px', background: 'var(--surface-2)', fontSize: 12,
              border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
              wordBreak: 'break-all', marginBottom: 12,
            }}
          >
            {url}
          </div>
          <div className="row row-wrap" style={{ gap: 8 }}>
            <Button
              variant="primary" icon="copy"
              onClick={() => { navigator.clipboard?.writeText(url); toast('Enlace copiado'); }}
            >
              Copiar
            </Button>
            <a
              className="btn btn-secondary"
              href={`https://wa.me/?text=${encodeURIComponent(`${property.title}\n${url}`)}`}
              target="_blank" rel="noreferrer"
            >
              Mandar por WhatsApp
            </a>
            <Button icon="refresh" disabled={ocupado} onClick={generar}>Regenerar</Button>
            <Button variant="danger" icon="trash" disabled={ocupado} onClick={revocar}>Revocar</Button>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Regenerar invalida el enlace anterior. Es la única forma de retirar una
            ficha que ya circula.
          </p>
        </>
      ) : (
        <Button variant="primary" icon="link" disabled={ocupado} onClick={generar}>
          {ocupado ? 'Generando…' : 'Generar enlace'}
        </Button>
      )}
    </Modal>
  );
}

export function ReportModal({ property, onClose }: { property: any; onClose: () => void }) {
  const [reporte, setReporte] = useState<any>();
  const [error, setError] = useState('');

  if (!reporte && !error) {
    request(`/properties/${property.id}/reporte`)
      .then(setReporte)
      .catch((problem) => setError(problem?.message ?? 'No se pudo generar'));
  }

  return (
    <Modal
      title="Reporte al propietario"
      description="Lo que el sistema sabe de verdad sobre el avance de esta propiedad."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cerrar</Button>
          <Button variant="primary" icon="upload" onClick={() => window.print()}>
            Imprimir o guardar PDF
          </Button>
        </>
      }
    >
      {error && <p style={{ color: 'var(--danger)', fontSize: 13.5 }}>{error}</p>}
      {!reporte && !error && <div className="skel skel-row" />}

      {reporte && (
        <div className="reporte">
          <div className="reporte-head">
            <b>{reporte.propiedad.title}</b>
            <span>
              {money(reporte.propiedad.price, reporte.propiedad.currency)} ·{' '}
              {label(reporte.propiedad.operationType)}
              {reporte.propiedad.internalCode ? ` · ${reporte.propiedad.internalCode}` : ''}
            </span>
          </div>

          <div className="metrics" style={{ marginBottom: 16 }}>
            <div className="metric">
              <small>Personas interesadas</small>
              <strong>{reporte.interesados}</strong>
              <div className="metric-foot">distintas, no veces</div>
            </div>
            <div className="metric">
              <small>Veces mostrada</small>
              <strong>{reporte.vecesMostrada}</strong>
            </div>
            <div className="metric">
              <small>Visitas registradas</small>
              <strong>{reporte.visitas.length}</strong>
            </div>
          </div>

          <dl style={{ margin: 0 }}>
            <div className="kv">
              <dt>Última vez que se mostró</dt>
              <dd>{reporte.ultimaVez ? dateTime(reporte.ultimaVez) : 'Todavía ninguna'}</dd>
            </div>
            <div className="kv">
              <dt>Estado</dt>
              <dd><Badge value={reporte.propiedad.status} /></dd>
            </div>
            <div className="kv">
              <dt>Asesor a cargo</dt>
              <dd>{reporte.asesor ?? 'Sin asignar'}</dd>
            </div>
          </dl>

          {reporte.visitas.length > 0 && (
            <div className="panel-section" style={{ marginTop: 18, marginBottom: 0 }}>
              <h3>Visitas</h3>
              {reporte.visitas.map((visita: any, index: number) => (
                <div className="kv" key={index}>
                  <dt>{dateTime(visita.startsAt)}</dt>
                  <dd><Badge value={visita.status} /></dd>
                </div>
              ))}
            </div>
          )}

          <p className="muted" style={{ fontSize: 11.5, marginTop: 16 }}>
            {reporte.agencia} · generado el {dateTime(reporte.generado)}
          </p>
        </div>
      )}
    </Modal>
  );
}
