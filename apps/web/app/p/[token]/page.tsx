'use client';
import { use, useEffect, useState } from 'react';
import '../../globals.css';
import { label, money } from '../../lib/format';

/**
 * La ficha que el asesor manda por WhatsApp.
 *
 * No lleva la consola: quien la abre es el cliente final, no alguien del
 * equipo. Sin menú, sin sesión y sin nada que invite a entrar a un sistema que
 * no es suyo.
 */

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

type Ficha = {
  title: string;
  description?: string | null;
  operationType: string;
  propertyType: string;
  status: string;
  price: number;
  currency: string;
  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  halfBathrooms?: number | null;
  parkingSpaces?: number | null;
  constructionM2?: number | null;
  landM2?: number | null;
  levels?: number | null;
  yearBuilt?: number | null;
  maintenanceFee?: number | null;
  legalStatus?: string | null;
  amenities: string[];
  videoUrl?: string | null;
  tourUrl?: string | null;
  agencia: string;
  asesor?: string | null;
  fotos: string[];
};

export default function FichaPublica({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [ficha, setFicha] = useState<Ficha>();
  const [estado, setEstado] = useState<'cargando' | 'listo' | 'noExiste'>('cargando');

  useEffect(() => {
    fetch(`${API}/public/properties/${encodeURIComponent(token)}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((data) => { setFicha(data); setEstado('listo'); })
      .catch(() => setEstado('noExiste'));
  }, [token]);

  if (estado === 'cargando') return <div className="loading-screen">Cargando…</div>;

  if (estado === 'noExiste' || !ficha) {
    return (
      <main className="ficha">
        <div className="ficha-vacia">
          <b>Esta ficha ya no está disponible</b>
          <p>El enlace pudo haber cambiado o la propiedad ya no se está promocionando.</p>
        </div>
      </main>
    );
  }

  const datos = [
    ['Recámaras', ficha.bedrooms],
    ['Baños', ficha.bathrooms],
    ['Medios baños', ficha.halfBathrooms],
    ['Estacionamientos', ficha.parkingSpaces],
    ['Construcción', ficha.constructionM2 && `${ficha.constructionM2} m²`],
    ['Terreno', ficha.landM2 && `${ficha.landM2} m²`],
    ['Niveles', ficha.levels],
    ['Año', ficha.yearBuilt],
    ['Mantenimiento', ficha.maintenanceFee && money(ficha.maintenanceFee, ficha.currency)],
    ['Situación jurídica', ficha.legalStatus && label(ficha.legalStatus)],
  ].filter(([, valor]) => valor !== null && valor !== undefined && valor !== '');

  const ubicacion = [ficha.address, ficha.neighborhood, ficha.city, ficha.state]
    .filter(Boolean)
    .join(', ');

  return (
    <main className="ficha">
      <article className="ficha-cuerpo">
        {ficha.fotos.length > 0 && (
          <div className="ficha-fotos">
            {ficha.fotos.map((id) => (
              <img
                key={id}
                src={`${API}/public/properties/${encodeURIComponent(token)}/foto/${id}`}
                alt={ficha.title}
                loading="lazy"
              />
            ))}
          </div>
        )}

        <header className="ficha-head">
          <span className="badge badge-primary badge-plain">{label(ficha.operationType)}</span>
          <h1>{ficha.title}</h1>
          <p className="ficha-precio">{money(ficha.price, ficha.currency)}</p>
          {ubicacion && <p className="ficha-lugar">{ubicacion}</p>}
        </header>

        {datos.length > 0 && (
          <dl className="ficha-datos">
            {datos.map(([etiqueta, valor]) => (
              <div key={String(etiqueta)}>
                <dt>{etiqueta}</dt>
                <dd>{String(valor)}</dd>
              </div>
            ))}
          </dl>
        )}

        {ficha.description && <p className="ficha-texto">{ficha.description}</p>}

        {ficha.amenities.length > 0 && (
          <div className="ficha-amenidades">
            {ficha.amenities.map((amenidad) => (
              <span key={amenidad}>{amenidad}</span>
            ))}
          </div>
        )}

        {(ficha.videoUrl || ficha.tourUrl) && (
          <div className="row row-wrap" style={{ gap: 8 }}>
            {ficha.videoUrl && (
              <a className="btn btn-secondary" href={ficha.videoUrl} target="_blank" rel="noreferrer">
                Ver video
              </a>
            )}
            {ficha.tourUrl && (
              <a className="btn btn-secondary" href={ficha.tourUrl} target="_blank" rel="noreferrer">
                Recorrido virtual
              </a>
            )}
          </div>
        )}

        <footer className="ficha-pie">
          <b>{ficha.agencia}</b>
          {ficha.asesor && <span>Te atiende {ficha.asesor}</span>}
        </footer>
      </article>
    </main>
  );
}
