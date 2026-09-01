'use client';
import { useEffect, useState } from 'react';
import './globals.css';
import { Avatar, Button, Icon, ToastProvider } from './components/ui';
import { request, signOut } from './lib/api';
import { initials, label } from './lib/format';
import { Agents, WhatsApp } from './screens/agents';
import { AiProviders, Audit, Organizations, SystemHealth, Team, Usage } from './screens/admin';
import { Appointments } from './screens/appointments';
import { Calendars, GoogleSetup } from './screens/calendar';
import { Brand, Login, type User } from './screens/auth';
import { Conversations } from './screens/conversations';
import { Dashboard } from './screens/dashboard';
import { Leads } from './screens/leads';
import { Properties } from './screens/properties';

type Nav = { key: string; label: string; icon: string; group: string; superAdmin?: boolean };

const NAV: Nav[] = [
  { key: 'resumen', label: 'Resumen', icon: 'home', group: 'Operación' },
  { key: 'conversaciones', label: 'Conversaciones', icon: 'chat', group: 'Operación' },
  { key: 'prospectos', label: 'Prospectos', icon: 'users', group: 'Operación' },
  { key: 'visitas', label: 'Visitas', icon: 'calendar', group: 'Operación' },

  { key: 'propiedades', label: 'Propiedades', icon: 'building', group: 'Inventario' },

  { key: 'calendarios', label: 'Calendarios', icon: 'calendar', group: 'Configuración' },

  { key: 'agentes', label: 'Agentes de IA', icon: 'bot', group: 'Configuración' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'phone', group: 'Configuración' },
  { key: 'equipo', label: 'Equipo', icon: 'settings', group: 'Configuración' },
  { key: 'auditoria', label: 'Auditoría', icon: 'shield', group: 'Configuración' },

  { key: 'agencias', label: 'Agencias', icon: 'building', group: 'Superadministración', superAdmin: true },
  { key: 'proveedores', label: 'Proveedores de IA', icon: 'sparkle', group: 'Superadministración', superAdmin: true },
  { key: 'consumo', label: 'Consumo', icon: 'list', group: 'Superadministración', superAdmin: true },
  { key: 'salud', label: 'Salud del sistema', icon: 'shield', group: 'Superadministración', superAdmin: true },
  { key: 'google', label: 'Google Calendar', icon: 'link', group: 'Superadministración', superAdmin: true },
];

export default function Home() {
  const [user, setUser] = useState<User>();
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState('resumen');
  const [organizations, setOrganizations] = useState<any[]>([]);
  const [organizationId, setOrganizationId] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('crm_token')) { setChecking(false); return; }
    request<User>('/auth/me')
      .then((current) => {
        setUser(current);
        if (current.organizationId) {
          localStorage.setItem('crm_org', current.organizationId);
          setOrganizationId(current.organizationId);
        }
      })
      .catch(() => {
        localStorage.removeItem('crm_token');
        localStorage.removeItem('crm_org');
      })
      .finally(() => setChecking(false));
  }, []);

  // Un superadministrador no pertenece a una agencia: elige cuál opera, y esa
  // elección viaja en cada petición como `x-organization-id`.
  useEffect(() => {
    if (!user?.isSuperAdmin) return;
    request<any[]>('/organizations')
      .then((items) => {
        setOrganizations(items);
        const stored = localStorage.getItem('crm_org');
        const selected = items.some((item) => item.id === stored) ? stored! : items[0]?.id || '';
        if (selected) localStorage.setItem('crm_org', selected);
        else localStorage.removeItem('crm_org');
        setOrganizationId(selected);
      })
      .catch(() => setOrganizations([]));
  }, [user]);

  function selectOrganization(id: string) {
    if (id) localStorage.setItem('crm_org', id);
    else localStorage.removeItem('crm_org');
    setOrganizationId(id);
  }

  function completeLogin(current: User) {
    setUser(current);
    if (current.organizationId) {
      localStorage.setItem('crm_org', current.organizationId);
      setOrganizationId(current.organizationId);
    } else if (current.isSuperAdmin) {
      setPage('agencias');
    }
  }

  if (checking) return <div className="loading-screen">Cargando…</div>;
  if (!user) return <ToastProvider><Login onLogin={completeLogin} /></ToastProvider>;

  const tenantId = organizationId || user.organizationId;
  const visible = NAV.filter((item) => !item.superAdmin || user.isSuperAdmin);
  const groups = [...new Set(visible.map((item) => item.group))];
  const current = visible.find((item) => item.key === page) ?? visible[0];

  const screens: Record<string, React.ReactNode> = {
    resumen: <Dashboard onOpenSessions={() => setPage('whatsapp')} />,
    conversaciones: <Conversations user={user} />,
    prospectos: <Leads />,
    visitas: <Appointments organizationId={tenantId} />,
    propiedades: <Properties />,
    agentes: <Agents organizationId={tenantId} />,
    whatsapp: <WhatsApp />,
    equipo: <Team organizationId={tenantId} />,
    auditoria: <Audit />,
    agencias: <Organizations />,
    proveedores: <AiProviders />,
    consumo: <Usage />,
    salud: <SystemHealth />,
    google: <GoogleSetup />,
    calendarios: <Calendars />,
  };

  return (
    <ToastProvider>
      <div className="shell">
        <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
          <Brand />
          <nav className="nav">
            {groups.map((group) => (
              <div key={group}>
                <div className="nav-label">{group}</div>
                {visible.filter((item) => item.group === group).map((item) => (
                  <button
                    key={item.key}
                    className={`nav-link ${page === item.key ? 'selected' : ''}`}
                    onClick={() => { setPage(item.key); setMenuOpen(false); }}
                    aria-current={page === item.key ? 'page' : undefined}
                  >
                    <Icon name={item.icon} />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-user">
            <Avatar small text={initials(user.name)} />
            <span className="who">
              <b>{user.name}</b>
              <small>{user.isSuperAdmin ? 'Superadministrador' : label(user.role)}</small>
            </span>
            <Button size="sm" icon="logout" title="Cerrar sesión" onClick={signOut} />
          </div>
        </aside>

        <div className="main">
          <header className="topbar">
            <button className="btn btn-ghost btn-icon menu-btn" onClick={() => setMenuOpen((open) => !open)} aria-label="Menú">
              <Icon name="menu" />
            </button>
            <span className="breadcrumb">{current.group} / <b>{current.label}</b></span>
            <div className="topbar-right">
              {user.isSuperAdmin && organizations.length > 0 && (
                <select
                  className="select" style={{ width: 'auto', minWidth: 170 }}
                  aria-label="Agencia activa"
                  value={organizationId}
                  onChange={(event) => selectOrganization(event.target.value)}
                >
                  <option value="">Sin agencia</option>
                  {organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>{organization.name}</option>
                  ))}
                </select>
              )}
              <span className="muted" style={{ fontSize: 13 }}>{user.email}</span>
            </div>
          </header>

          {/* La clave fuerza el remontaje al cambiar de agencia, para que ninguna
              pantalla conserve datos del tenant anterior. */}
          <div key={`${tenantId || 'global'}-${page}`}>{screens[page]}</div>
        </div>
      </div>
    </ToastProvider>
  );
}
