'use client';
import { useState, type FormEvent } from 'react';
import { Banner, Button, Field } from '../components/ui';
import { request } from '../lib/api';

export type User = {
  id: string; name: string; email: string;
  isSuperAdmin: boolean; organizationId?: string; role?: string;
};

export function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="brand">
      <span className="brand-mark">H</span>
      {!compact && (
        <span>
          <b>Horizonte</b>
          <small>CRM inmobiliario</small>
        </span>
      )}
    </div>
  );
}

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'bootstrap'>('login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const bootstrapping = mode === 'bootstrap';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const body = Object.fromEntries(new FormData(event.currentTarget) as any);
    try {
      if (bootstrapping) {
        await request('/auth/bootstrap', { method: 'POST', body: JSON.stringify(body) });
        setMode('login');
        setError('');
        return;
      }
      const data = await request('/auth/login', { method: 'POST', body: JSON.stringify(body) });
      localStorage.setItem('crm_token', data.accessToken);
      onLogin(data.user);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'No fue posible entrar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <Brand />
        <h1>{bootstrapping ? 'Crear superusuario' : 'Iniciar sesión'}</h1>
        <p>
          {bootstrapping
            ? 'Solo disponible mientras no exista ningún superadministrador.'
            : 'Accede a la operación de tu agencia.'}
        </p>

        {error && <Banner>{error}</Banner>}

        {bootstrapping && <Field spec={{ name: 'name', label: 'Nombre' }} />}
        <Field spec={{ name: 'email', label: 'Correo', type: 'email', placeholder: 'tu@agencia.com' }} />
        <Field spec={{ name: 'password', label: 'Contraseña', type: 'password' }} />
        {bootstrapping && (
          <Field spec={{
            name: 'bootstrapSecret', label: 'Secreto de instalación', type: 'password',
            hint: 'Es el valor de BOOTSTRAP_SECRET en las variables de la API.',
          }} />
        )}

        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Un momento…' : bootstrapping ? 'Crear acceso' : 'Entrar'}
        </Button>
        <button type="button" className="link-btn" onClick={() => { setMode(bootstrapping ? 'login' : 'bootstrap'); setError(''); }}>
          {bootstrapping ? 'Volver a iniciar sesión' : 'Configurar la primera cuenta'}
        </button>
      </form>
    </main>
  );
}
