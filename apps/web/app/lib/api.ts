const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * Traduce el cuerpo de error de NestJS a algo que una persona pueda accionar.
 * `class-validator` devuelve `message` como arreglo de fallos por campo.
 */
export function apiErrorMessage(text: string, status: number): string {
  if (!text) return `Error ${status}`;
  try {
    const parsed = JSON.parse(text);
    const message = parsed.message;
    if (Array.isArray(message)) return message.join('. ');
    if (typeof message === 'string') return message;
    return `Error ${status}`;
  } catch {
    // Una respuesta que no es JSON suele ser una ruta inexistente ("Cannot GET
    // /api/v1/…"): se muestra tal cual porque señala el problema real.
    return text.slice(0, 200);
  }
}

export function token() {
  return typeof window === 'undefined' ? '' : localStorage.getItem('crm_token') || '';
}

export function signOut() {
  localStorage.removeItem('crm_token');
  localStorage.removeItem('crm_org');
  location.reload();
}

export async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const jwt = token();
  const organizationId = typeof window === 'undefined' ? '' : localStorage.getItem('crm_org') || '';
  const isForm = options.body instanceof FormData;

  const response = await fetch(API + path, {
    ...options,
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      ...(organizationId ? { 'x-organization-id': organizationId } : {}),
      ...options.headers,
    },
  });

  if (response.status === 401 && jwt) {
    // La sesión venció: devolver al login en vez de dejar la interfaz en un
    // estado a medias donde cada petición falla en silencio.
    signOut();
    throw new ApiError('Tu sesión venció', 401);
  }
  if (!response.ok) {
    throw new ApiError(apiErrorMessage(await response.text(), response.status), response.status);
  }
  return response.status === 204 ? (null as T) : response.json();
}

/** Endpoints paginados devuelven `{items, nextCursor}`; el resto, un arreglo. */
export async function requestList<T = any>(path: string): Promise<T[]> {
  const data = await request<T[] | { items: T[] }>(path);
  return Array.isArray(data) ? data : (data?.items ?? []);
}
