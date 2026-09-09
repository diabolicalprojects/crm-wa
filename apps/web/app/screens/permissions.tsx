'use client';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Banner, Button, Icon, PageHeader, Skeleton, useToast } from '../components/ui';
import { request } from '../lib/api';

/**
 * La matriz de permisos por persona.
 *
 * El rol es el punto de partida y la matriz la excepción, así que la pantalla
 * enseña de dónde viene cada permiso: «lo trae el rol», «se lo dimos», «se lo
 * quitamos». Sin esa distinción, quien administra no sabe si tocar una casilla
 * es un cambio o dejarla como estaba.
 */

type Miembro = {
  userId: string;
  role: string;
  status: string;
  name: string;
  email: string;
  grant: string[];
  revoke: string[];
  efectivos: string[];
};

type Estado = 'rol' | 'concedido' | 'retirado' | 'no';

export function Permissions() {
  const toast = useToast();
  const [catalogo, setCatalogo] = useState<Record<string, string>>({});
  const [porRol, setPorRol] = useState<Record<string, string[]>>({});
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [abierto, setAbierto] = useState('');
  const [guardando, setGuardando] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [mios, equipo] = await Promise.all([
        request('/permissions'),
        request<Miembro[]>('/permissions/equipo'),
      ]);
      setCatalogo(mios.catalogo ?? {});
      setPorRol(mios.porRol ?? {});
      setMiembros(equipo);
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function estadoDe(miembro: Miembro, permiso: string): Estado {
    if (miembro.revoke.includes(permiso)) return 'retirado';
    if (miembro.grant.includes(permiso)) return 'concedido';
    return (porRol[miembro.role] ?? []).includes(permiso) ? 'rol' : 'no';
  }

  /**
   * Un clic recorre los estados que tienen sentido según de dónde venga el
   * permiso: lo que trae el rol se puede quitar, lo que no trae se puede dar.
   */
  function alternar(miembro: Miembro, permiso: string) {
    const traeElRol = (porRol[miembro.role] ?? []).includes(permiso);
    const estado = estadoDe(miembro, permiso);

    let grant = miembro.grant.filter((p) => p !== permiso);
    let revoke = miembro.revoke.filter((p) => p !== permiso);

    if (traeElRol && estado === 'rol') revoke = [...revoke, permiso];
    else if (!traeElRol && estado === 'no') grant = [...grant, permiso];

    setMiembros((actual) =>
      actual.map((m) => (m.userId === miembro.userId ? { ...m, grant, revoke } : m)),
    );
  }

  async function guardar(miembro: Miembro) {
    setGuardando(miembro.userId);
    try {
      const guardado = await request(`/permissions/equipo/${miembro.userId}`, {
        method: 'PUT',
        body: JSON.stringify({ grant: miembro.grant, revoke: miembro.revoke }),
      });
      setMiembros((actual) =>
        actual.map((m) =>
          m.userId === miembro.userId ? { ...m, efectivos: guardado.efectivos ?? m.efectivos } : m,
        ),
      );
      toast(`Permisos de ${miembro.name || miembro.email} guardados`);
    } catch (problem) {
      toast(problem instanceof Error ? problem.message : 'No se pudo guardar', 'error');
      load();
    } finally {
      setGuardando('');
    }
  }

  if (loading) return <section className="content"><div className="card"><Skeleton /></div></section>;

  const permisos = Object.entries(catalogo);

  return (
    <section className="content">
      <PageHeader
        eyebrow="Organización"
        title="Permisos"
        description="Qué puede hacer cada persona. El rol define lo normal; aquí se ajustan las excepciones."
      />

      {error && <Banner>{error}</Banner>}

      <Banner kind="info">
        <b>Todo esto se verifica en el servidor.</b> Un permiso retirado surte
        efecto de inmediato, sin esperar a que la persona vuelva a entrar.
      </Banner>

      <div className="stack">
        {miembros.map((miembro) => {
          const excepciones = miembro.grant.length + miembro.revoke.length;
          const esPropietario = miembro.role === 'OWNER';
          return (
            <div className="card" key={miembro.userId}>
              <button
                className="card-head perm-head"
                aria-expanded={abierto === miembro.userId}
                onClick={() => setAbierto(abierto === miembro.userId ? '' : miembro.userId)}
              >
                <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <b style={{ display: 'block', fontSize: 15 }}>{miembro.name || miembro.email}</b>
                  <span className="muted" style={{ fontSize: 12.5 }}>{miembro.email}</span>
                </span>
                <Badge value={miembro.role} />
                {excepciones > 0 && (
                  <Badge tone="warning">
                    {excepciones} {excepciones === 1 ? 'excepción' : 'excepciones'}
                  </Badge>
                )}
                <Icon name={abierto === miembro.userId ? 'x' : 'settings'} size={16} />
              </button>

              {abierto === miembro.userId && (
                <div className="card-body">
                  {esPropietario ? (
                    <Banner kind="info">
                      Al propietario no se le pueden quitar permisos. Es la cuenta que
                      garantiza que la agencia siga siendo administrable.
                    </Banner>
                  ) : null}

                  <div className="perm-grid">
                    {permisos.map(([clave, etiqueta]) => {
                      const estado = estadoDe(miembro, clave);
                      const activo = estado === 'rol' || estado === 'concedido';
                      return (
                        <button
                          key={clave}
                          type="button"
                          className={`perm-item perm-${estado}`}
                          disabled={esPropietario}
                          aria-pressed={activo}
                          onClick={() => alternar(miembro, clave)}
                        >
                          <Icon name={activo ? 'check' : 'x'} size={15} />
                          <span>
                            <b>{etiqueta}</b>
                            <small>
                              {estado === 'rol' && 'Lo trae su rol'}
                              {estado === 'concedido' && 'Concedido a esta persona'}
                              {estado === 'retirado' && 'Retirado a esta persona'}
                              {estado === 'no' && 'No lo tiene'}
                            </small>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {!esPropietario && (
                    <div className="row" style={{ marginTop: 14, gap: 8 }}>
                      <Button
                        variant="primary" icon="check"
                        disabled={guardando === miembro.userId}
                        onClick={() => guardar(miembro)}
                      >
                        {guardando === miembro.userId ? 'Guardando…' : 'Guardar'}
                      </Button>
                      <Button onClick={load}>Descartar cambios</Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
