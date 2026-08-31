'use client';
import {
  createContext, useCallback, useContext, useEffect, useState,
  type FormEvent, type ReactNode,
} from 'react';
import { label as toLabel, tone as toTone, type Tone } from '../lib/format';

/* ------------------------------------------------------------------ iconos */

const PATHS: Record<string, string> = {
  home: 'M3 9.5 10 4l7 5.5V16a1 1 0 0 1-1 1h-3v-4H7v4H4a1 1 0 0 1-1-1z',
  chat: 'M17 9.5c0 3-3.1 5.5-7 5.5-.9 0-1.7-.1-2.5-.4L3 16l1.2-3A5.6 5.6 0 0 1 3 9.5C3 6.5 6.1 4 10 4s7 2.5 7 5.5z',
  users: 'M13 16v-1.5a3 3 0 0 0-3-3H5a3 3 0 0 0-3 3V16M7.5 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 16v-1.5a3 3 0 0 0-2.2-2.9M13.5 3.6a3 3 0 0 1 0 5.8',
  building: 'M4 17V4.5A.5.5 0 0 1 4.5 4h7a.5.5 0 0 1 .5.5V17M12 17h4V9a.5.5 0 0 0-.5-.5H12M2 17h16M6.5 7h3M6.5 10h3M6.5 13h3',
  bot: 'M6 8h8a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zM10 8V5M10 3.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5zM7.5 12h.01M12.5 12h.01',
  phone: 'M15.5 13.4v2a1.3 1.3 0 0 1-1.4 1.3 13 13 0 0 1-5.7-2 12.8 12.8 0 0 1-4-4 13 13 0 0 1-2-5.7A1.3 1.3 0 0 1 3.6 3.6h2a1.3 1.3 0 0 1 1.3 1.1c.1.6.2 1.3.5 1.9a1.3 1.3 0 0 1-.3 1.4l-.8.8a10.4 10.4 0 0 0 4 4l.8-.8a1.3 1.3 0 0 1 1.4-.3c.6.2 1.2.4 1.9.5a1.3 1.3 0 0 1 1.1 1.3z',
  calendar: 'M4 5.5h12a1 1 0 0 1 1 1V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1zM13.5 3.5v4M6.5 3.5v4M3 9.5h14',
  shield: 'M10 17s6-2.7 6-7V5.3L10 3 4 5.3V10c0 4.3 6 7 6 7z',
  settings: 'M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM15.5 12.5a1.3 1.3 0 0 0 .3 1.4l0 .1a1.5 1.5 0 1 1-2.2 2.2l0 0a1.3 1.3 0 0 0-1.4-.3 1.3 1.3 0 0 0-.8 1.2V17a1.5 1.5 0 1 1-3 0v-.1a1.3 1.3 0 0 0-.9-1.2 1.3 1.3 0 0 0-1.4.3l0 0a1.5 1.5 0 1 1-2.2-2.2l0-.1a1.3 1.3 0 0 0 .3-1.4 1.3 1.3 0 0 0-1.2-.8H3a1.5 1.5 0 1 1 0-3h.1a1.3 1.3 0 0 0 1.2-.9 1.3 1.3 0 0 0-.3-1.4l0 0a1.5 1.5 0 1 1 2.2-2.2l.1 0a1.3 1.3 0 0 0 1.4.3h.1a1.3 1.3 0 0 0 .8-1.2V3a1.5 1.5 0 1 1 3 0v.1a1.3 1.3 0 0 0 .8 1.2h.1a1.3 1.3 0 0 0 1.4-.3l0 0a1.5 1.5 0 1 1 2.2 2.2l0 .1a1.3 1.3 0 0 0-.3 1.4v.1a1.3 1.3 0 0 0 1.2.8H17a1.5 1.5 0 1 1 0 3h-.1a1.3 1.3 0 0 0-1.2.8z',
  list: 'M6.5 5.5h10M6.5 10h10M6.5 14.5h10M3.5 5.5h.01M3.5 10h.01M3.5 14.5h.01',
  plus: 'M10 4.5v11M4.5 10h11',
  search: 'M9 15A6 6 0 1 0 9 3a6 6 0 0 0 0 12zM17 17l-3.5-3.5',
  check: 'M4 10.5l4 4 8-9',
  alert: 'M10 6.5v4M10 13.5h.01M8.6 3.6 1.9 15a1.6 1.6 0 0 0 1.4 2.4h13.4a1.6 1.6 0 0 0 1.4-2.4L11.4 3.6a1.6 1.6 0 0 0-2.8 0z',
  info: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM10 13.5v-4M10 6.5h.01',
  x: 'M15 5 5 15M5 5l10 10',
  send: 'M17.5 2.5 9 11M17.5 2.5l-5.4 15-3.1-6.5L2.5 7.9z',
  logout: 'M7.5 17H4.5a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 4.5 3h3M13 14l4-4-4-4M17 10H7.5',
  refresh: 'M17 3.5v5h-5M3 16.5v-5h5M4.6 8a6.5 6.5 0 0 1 10.7-2.4L17 8M3 12l1.7 2.4A6.5 6.5 0 0 0 15.4 12',
  trash: 'M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M15 5.5V16a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V5.5M8.5 9v4.5M11.5 9v4.5',
  qr: 'M3.5 3.5h4v4h-4zM12.5 3.5h4v4h-4zM3.5 12.5h4v4h-4zM12.5 12.5h.01M16.5 12.5h.01M12.5 16.5h.01M16.5 16.5h.01M14.5 14.5h.01',
  upload: 'M10 13V3.5M6.5 7 10 3.5 13.5 7M3.5 13v2.5a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V13',
  menu: 'M3.5 5.5h13M3.5 10h13M3.5 14.5h13',
  inbox: 'M3 11h4l1 2h4l1-2h4M3 11l2-6.5a1 1 0 0 1 1-.7h8a1 1 0 0 1 1 .7L17 11v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  sparkle: 'M10 3l1.8 4.2L16 9l-4.2 1.8L10 15l-1.8-4.2L4 9l4.2-1.8z',
  link: 'M8.5 11.5a3 3 0 0 0 4.3 0l2.4-2.4a3 3 0 0 0-4.3-4.3l-1.3 1.4M11.5 8.5a3 3 0 0 0-4.3 0l-2.4 2.4a3 3 0 0 0 4.3 4.3l1.3-1.4',
};

export function Icon({ name, size = 17 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? PATHS.info} />
    </svg>
  );
}

/* ------------------------------------------------------------------- avisos */

type Toast = { id: number; text: string; kind: 'success' | 'error' | 'info' };
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'success') => {
    const id = Date.now() + Math.random();
    setItems((current) => [...current, { id, text, kind }]);
    setTimeout(() => setItems((current) => current.filter((item) => item.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {items.map((item) => (
          <div key={item.id} className={`toast toast-${item.kind}`}>
            <Icon name={item.kind === 'error' ? 'alert' : item.kind === 'info' ? 'info' : 'check'} />
            <span>{item.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------------------------------------------------------- controles */

type ButtonProps = {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: string;
  children?: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({ variant = 'secondary', size = 'md', icon, children, className = '', ...rest }: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant} ${size === 'sm' ? 'btn-sm' : ''} ${!children ? 'btn-icon' : ''} ${className}`}
      {...rest}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 16} />}
      {children}
    </button>
  );
}

export function Badge({ value, children, tone: forced }: { value?: string | null; children?: ReactNode; tone?: Tone }) {
  const kind = forced ?? toTone(value);
  return <span className={`badge badge-${kind}`}>{children ?? toLabel(value)}</span>;
}

export function Avatar({ text, small }: { text: string; small?: boolean }) {
  return <span className={`avatar ${small ? 'avatar-sm' : ''}`} aria-hidden="true">{text}</span>;
}

export function Banner({ kind = 'danger', children }: { kind?: 'danger' | 'warning' | 'info'; children: ReactNode }) {
  return (
    <div className={`banner banner-${kind}`}>
      <Icon name={kind === 'info' ? 'info' : 'alert'} />
      <div className="banner-body">{children}</div>
    </div>
  );
}

export function Empty({ title, text, icon = 'inbox', action }: { title: string; text: string; icon?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={21} /></span>
      <b>{title}</b>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div style={{ padding: 2 }} aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }, (_, index) => <div key={index} className="skel skel-row" />)}
    </div>
  );
}

/* ------------------------------------------------------------------ campos */

export type FieldSpec = {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'textarea' | 'select' | 'date' | 'time' | 'datetime-local' | 'tel' | 'url';
  required?: boolean;
  options?: { value: string; label: string }[];
  hint?: string;
  placeholder?: string;
  defaultValue?: string;
  half?: boolean;
};

export function Field({ spec }: { spec: FieldSpec }) {
  const required = spec.required !== false;
  const common = {
    name: spec.name,
    required,
    defaultValue: spec.defaultValue,
    placeholder: spec.placeholder,
    'aria-label': spec.label,
  };
  return (
    <label className="field">
      <span>{spec.label}{!required && <span className="muted" style={{ fontWeight: 400 }}> · opcional</span>}</span>
      {spec.type === 'textarea' ? (
        <textarea className="textarea" rows={5} {...common} />
      ) : spec.type === 'select' ? (
        <select className="select" {...common}>
          {!required && <option value="">Sin seleccionar</option>}
          {spec.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      ) : (
        <input className="input" type={spec.type || 'text'} {...common} />
      )}
      {spec.hint && <span className="hint">{spec.hint}</span>}
    </label>
  );
}

/* ------------------------------------------------------------------ modales */

export function Modal({
  title, description, children, footer, onClose, wide,
}: {
  title: string; description?: string; children: ReactNode;
  footer?: ReactNode; onClose: () => void; wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function FormModal({
  title, description, fields, submitLabel = 'Guardar', onClose, onSubmit, wide,
}: {
  title: string; description?: string; fields: FieldSpec[];
  submitLabel?: string; onClose: () => void; wide?: boolean;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const raw = Object.fromEntries(new FormData(event.currentTarget) as any) as Record<string, string>;
    // Un campo opcional vacío no debe viajar: el backend rechaza cadenas vacías
    // donde espera un enum o una URL.
    const values = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== ''));
    try {
      await onSubmit(values);
      onClose();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No fue posible guardar');
    } finally {
      setBusy(false);
    }
  }

  const halves = fields.filter((field) => field.half);
  const fulls = fields.filter((field) => !field.half);

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <form className={`modal ${wide ? 'modal-wide' : ''}`} onSubmit={submit} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <div className="modal-body">
          {error && <Banner>{error}</Banner>}
          {halves.length > 0 && (
            <div className="grid-2">{halves.map((field) => <Field key={field.name} spec={field} />)}</div>
          )}
          {fulls.map((field) => <Field key={field.name} spec={field} />)}
        </div>
        <div className="modal-foot">
          <Button type="button" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? 'Guardando…' : submitLabel}</Button>
        </div>
      </form>
    </div>
  );
}

export function Confirm({
  title, text, confirmLabel = 'Confirmar', danger, onClose, onConfirm,
}: {
  title: string; text: string; confirmLabel?: string; danger?: boolean;
  onClose: () => void; onConfirm: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={busy}
            onClick={async () => { setBusy(true); try { await onConfirm(); onClose(); } finally { setBusy(false); } }}
          >
            {busy ? 'Procesando…' : confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ color: 'var(--text-2)' }}>{text}</p>
    </Modal>
  );
}

/* ------------------------------------------------------------------- tabla */

export type Column<T> = { key: string; head: string; cell: (row: T) => ReactNode; align?: 'right' };

export function DataTable<T extends { id?: string }>({
  columns, rows, loading, empty, onRowClick,
}: {
  columns: Column<T>[]; rows: T[]; loading?: boolean;
  empty: ReactNode; onRowClick?: (row: T) => void;
}) {
  if (loading) return <div className="card"><Skeleton /></div>;
  if (!rows.length) return <div className="card">{empty}</div>;
  return (
    <div className="card">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>{columns.map((column) => (
              <th key={column.key} style={column.align === 'right' ? { textAlign: 'right' } : undefined}>{column.head}</th>
            ))}</tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.id ?? index}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} style={column.align === 'right' ? { textAlign: 'right' } : undefined}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function PageHeader({
  eyebrow, title, description, actions,
}: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </div>
  );
}
