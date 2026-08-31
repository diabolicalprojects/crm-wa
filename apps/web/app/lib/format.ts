/**
 * Etiquetas y formatos de presentación.
 *
 * La API habla en enums (`SALE`, `QR_REQUIRED`, `AI_ACTIVE`); la interfaz habla
 * en español. Centralizarlo evita que cada pantalla invente su propia
 * traducción y que aparezcan `VISIT_SCHEDULED` en pantalla.
 */

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary';

export const OPERATION_TYPES = [
  { value: 'SALE', label: 'Venta' },
  { value: 'RENT', label: 'Renta' },
];

export const PROPERTY_TYPES = [
  { value: 'HOUSE', label: 'Casa' },
  { value: 'APARTMENT', label: 'Departamento' },
  { value: 'LAND', label: 'Terreno' },
  { value: 'COMMERCIAL', label: 'Local comercial' },
  { value: 'OFFICE', label: 'Oficina' },
  { value: 'OTHER', label: 'Otro' },
];

export const PROPERTY_STATUSES = [
  { value: 'DRAFT', label: 'Borrador' },
  { value: 'AVAILABLE', label: 'Disponible' },
  { value: 'RESERVED', label: 'Apartada' },
  { value: 'SOLD', label: 'Vendida' },
  { value: 'RENTED', label: 'Rentada' },
  { value: 'INACTIVE', label: 'Inactiva' },
];

export const OPERATION_MODES = [
  { value: 'HYBRID', label: 'Híbrido — la IA responde y un asesor puede tomar el control' },
  { value: 'AI', label: 'Solo IA' },
  { value: 'HUMAN', label: 'Solo humano' },
];

export const ROLES = [
  { value: 'OWNER', label: 'Propietario' },
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'SUPERVISOR', label: 'Supervisor' },
  { value: 'ADVISOR', label: 'Asesor' },
];

const LABELS: Record<string, string> = {
  // Etapas del lead
  NEW: 'Nuevo', CONTACTED: 'Contactado', QUALIFYING: 'Calificando',
  QUALIFIED: 'Calificado', VISIT_SCHEDULED: 'Visita agendada',
  WON: 'Ganado', LOST: 'Perdido',
  // Sesiones de WhatsApp
  CREATING: 'Creando', QR_REQUIRED: 'Escanea el QR', STARTING: 'Iniciando',
  CONNECTED: 'Conectado', DISCONNECTED: 'Desconectado', FAILED: 'Falló',
  STOPPED: 'Detenida', DELETING: 'Eliminando', DELETED: 'Eliminada',
  // Conversación
  AI_ACTIVE: 'IA respondiendo', AI_PAUSED: 'IA pausada',
  HUMAN_ACTIVE: 'Atiende un asesor', DISABLED: 'Desactivada',
  OPEN: 'Abierta', PENDING: 'Pendiente', RESOLVED: 'Resuelta', ARCHIVED: 'Archivada',
  // Agente
  DRAFT: 'Borrador', ACTIVE: 'Activo', PAUSED: 'Pausado',
  AI: 'Solo IA', HUMAN: 'Solo humano', HYBRID: 'Híbrido',
  // Citas
  REQUESTED: 'Solicitada', SCHEDULED: 'Agendada', CONFIRMED: 'Confirmada',
  COMPLETED: 'Realizada', CANCELLED: 'Cancelada', NO_SHOW: 'No asistió',
  // Propiedades
  SALE: 'Venta', RENT: 'Renta',
  HOUSE: 'Casa', APARTMENT: 'Departamento', LAND: 'Terreno',
  COMMERCIAL: 'Local', OFFICE: 'Oficina', OTHER: 'Otro',
  AVAILABLE: 'Disponible', RESERVED: 'Apartada', SOLD: 'Vendida',
  RENTED: 'Rentada', INACTIVE: 'Inactiva',
  // Usuarios
  INVITED: 'Invitado', OWNER: 'Propietario', ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor', ADVISOR: 'Asesor', SUSPENDED: 'Suspendida',
  // Proveedores de IA
  ANTHROPIC: 'Anthropic', OPENAI: 'OpenAI', GEMINI: 'Google Gemini',
  OPENAI_COMPATIBLE: 'Compatible con OpenAI',
};

export function label(value?: string | null): string {
  if (!value) return '—';
  return LABELS[value] ?? value;
}

const TONES: Record<string, Tone> = {
  CONNECTED: 'success', ACTIVE: 'success', AVAILABLE: 'success',
  QUALIFIED: 'success', WON: 'success', CONFIRMED: 'success', COMPLETED: 'success',
  AI_ACTIVE: 'primary', OPEN: 'primary',
  QR_REQUIRED: 'warning', STARTING: 'warning', CREATING: 'warning',
  PENDING: 'warning', RESERVED: 'warning', PAUSED: 'warning', AI_PAUSED: 'warning',
  REQUESTED: 'warning', SCHEDULED: 'warning', INVITED: 'warning', VISIT_SCHEDULED: 'warning',
  HUMAN_ACTIVE: 'info', CONTACTED: 'info', QUALIFYING: 'info', DRAFT: 'info',
  FAILED: 'danger', DISCONNECTED: 'danger', LOST: 'danger', CANCELLED: 'danger',
  NO_SHOW: 'danger', SUSPENDED: 'danger', DISABLED: 'danger',
};

export function tone(value?: string | null): Tone {
  return (value && TONES[value]) || 'neutral';
}

export function money(amount: unknown, currency = 'MXN'): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: currency || 'MXN',
    maximumFractionDigits: 0,
  }).format(value);
}

export function dateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function dateOnly(value?: string | Date | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** "hace 5 min" — más legible que una marca absoluta en una lista de chats. */
export function relative(value?: string | Date | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'ahora';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d`;
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' });
}

export function initials(name?: string | null, fallback = '?'): string {
  const text = (name || '').trim();
  if (!text) return fallback;
  const parts = text.split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || fallback;
}

/** `5214490000000` → `+52 1 449 000 0000`, para que se pueda leer y copiar. */
export function phone(value?: string | null): string {
  const digits = (value || '').replace(/\D/g, '');
  if (!digits) return '—';
  if (digits.length === 13 && digits.startsWith('52')) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 9)} ${digits.slice(9)}`;
  }
  if (digits.length === 12 && digits.startsWith('52')) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  return `+${digits}`;
}

export function location(property: { city?: string | null; neighborhood?: string | null; state?: string | null }): string {
  return [property.neighborhood, property.city, property.state].filter(Boolean).join(', ') || '—';
}
