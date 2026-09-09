'use client';
import { useEffect, useState } from 'react';
import { fetchBlobUrl } from '../lib/api';
import { Icon } from './ui';

/**
 * Muestra el archivo de un mensaje.
 *
 * Se baja con `fetch` autenticado y no con `<img src>` porque la ruta exige
 * token y agencia en encabezados; ponerlos en la URL los dejaría en el
 * historial del navegador y en los registros del servidor.
 *
 * Los tres estados del archivo son distintos y se ven distinto: llegó y está
 * guardado, todavía se está bajando de la pasarela, o no se pudo traer. Un
 * hueco silencioso es la peor de las tres.
 */

export type MensajeMedia = {
  id: string;
  mimeType: string;
  sizeBytes: number;
  status: 'PENDING' | 'STORED' | 'FAILED' | 'DELETED';
  originalFilename?: string | null;
};

function peso(bytes: number) {
  if (!bytes) return '';
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Media({ media }: { media: MensajeMedia }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  const esImagen = media.mimeType.startsWith('image/');
  const esAudio = media.mimeType.startsWith('audio/');
  const esVideo = media.mimeType.startsWith('video/');
  const visualizable = esImagen || esAudio || esVideo;

  useEffect(() => {
    if (media.status !== 'STORED' || !visualizable) return;
    let vivo = true;
    let creada = '';
    fetchBlobUrl(`/media/${media.id}`)
      .then((blob) => {
        if (!vivo) { URL.revokeObjectURL(blob); return; }
        creada = blob;
        setUrl(blob);
      })
      .catch(() => vivo && setError('No se pudo abrir el archivo'));
    // Sin revocar, cada apertura de la conversación deja en memoria todas las
    // fotos que se hayan mostrado.
    return () => { vivo = false; if (creada) URL.revokeObjectURL(creada); };
  }, [media.id, media.status, visualizable]);

  if (media.status === 'PENDING') {
    return (
      <span className="media-state">
        <span className="skel media-skel" />
        <small>Recibiendo archivo{media.sizeBytes ? ` · ${peso(media.sizeBytes)}` : ''}…</small>
      </span>
    );
  }

  if (media.status === 'FAILED' || media.status === 'DELETED' || error) {
    return (
      <span className="media-state media-failed">
        <Icon name="alert" size={15} />
        <small>{error || 'El archivo no se pudo recuperar de WhatsApp'}</small>
      </span>
    );
  }

  if (esImagen) {
    return url ? (
      <a href={url} target="_blank" rel="noreferrer" className="media-img">
        <img src={url} alt={media.originalFilename || 'Imagen recibida'} />
      </a>
    ) : (
      <span className="skel media-skel" />
    );
  }

  if (esAudio) return url ? <audio className="media-audio" controls src={url} /> : <span className="skel media-skel" />;
  if (esVideo) return url ? <video className="media-video" controls src={url} /> : <span className="skel media-skel" />;

  // Documentos y todo lo demás: descarga explícita, nunca visor. La API los
  // sirve como `application/octet-stream` a propósito.
  return (
    <button
      type="button"
      className="media-file"
      onClick={async () => {
        try {
          const blob = await fetchBlobUrl(`/media/${media.id}`);
          const enlace = document.createElement('a');
          enlace.href = blob;
          enlace.download = media.originalFilename || 'archivo';
          enlace.click();
          setTimeout(() => URL.revokeObjectURL(blob), 10_000);
        } catch {
          setError('No se pudo descargar');
        }
      }}
    >
      <Icon name="upload" size={16} />
      <span>
        <b>{media.originalFilename || 'Documento'}</b>
        <small>{peso(media.sizeBytes)}</small>
      </span>
    </button>
  );
}
