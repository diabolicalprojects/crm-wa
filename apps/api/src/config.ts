import { Logger } from '@nestjs/common';

/**
 * Configuración tipada y validada al arrancar.
 *
 * El objetivo es que un despliegue mal configurado falle de inmediato y con un
 * mensaje claro, en vez de arrancar y fallar en silencio más tarde — que es
 * exactamente lo que ocurría cuando `PUBLIC_API_URL` no existía y el registro
 * del webhook se saltaba sin error.
 */

export interface AppConfig {
  port: number;
  publicApiUrl: string;
  corsOrigins: string[];
  jwtSecret: string;
  encryptionKey: string;
  openwa: { baseUrl: string; apiKey: string; webhookSecret?: string };
  redisUrl?: string;
  bootstrapSecret?: string;
}

export class ConfigError extends Error {}

const isProduction = () => process.env.NODE_ENV === 'production';

/**
 * Variables sin las cuales el servicio no puede cumplir su función. En
 * producción faltar una es un error fatal; en desarrollo solo se advierte para
 * no estorbar las pruebas locales.
 */
function required(name: string, value: string | undefined, problems: string[]): string {
  if (value && value.trim()) return value.trim();
  problems.push(`${name} no está configurado`);
  return '';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const problems: string[] = [];
  const log = new Logger('Config');

  const publicApiUrl = required('PUBLIC_API_URL', env.PUBLIC_API_URL, problems).replace(/\/$/, '');
  if (publicApiUrl && !/^https?:\/\//.test(publicApiUrl)) {
    problems.push('PUBLIC_API_URL debe incluir el protocolo (https://…)');
  }

  const jwtSecret = env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    problems.push('JWT_SECRET no está configurado');
  } else if (jwtSecret.length < 32 && isProduction()) {
    problems.push('JWT_SECRET debe tener al menos 32 caracteres en producción');
  }

  const openwaBaseUrl = required('OPENWA_BASE_URL', env.OPENWA_BASE_URL, problems);
  const openwaApiKey = required('OPENWA_API_KEY', env.OPENWA_API_KEY, problems);

  const webhookSecret = env.OPENWA_WEBHOOK_SECRET?.trim();
  if (!webhookSecret) {
    // No es fatal —OpenWA entrega igual— pero sin firma cualquiera puede
    // inyectar eventos si la URL se filtra (spec §10.3).
    const message = 'OPENWA_WEBHOOK_SECRET no está configurado: los webhooks llegarán sin firma';
    if (isProduction()) problems.push(message);
    else log.warn(message);
  }

  if (!env.REDIS_URL?.trim()) {
    const message = 'REDIS_URL no está configurado: la automatización de IA queda inactiva';
    if (isProduction()) problems.push(message);
    else log.warn(message);
  }

  if (isProduction() && !env.BOOTSTRAP_SECRET?.trim()) {
    problems.push('BOOTSTRAP_SECRET es obligatorio en producción');
  }

  if (problems.length) {
    const detail = problems.map((item) => `  · ${item}`).join('\n');
    if (isProduction()) {
      throw new ConfigError(`Configuración inválida:\n${detail}`);
    }
    log.warn(`Configuración incompleta (tolerada fuera de producción):\n${detail}`);
  }

  return {
    port: Number(env.PORT ?? 3001),
    publicApiUrl,
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    jwtSecret: jwtSecret ?? 'local-development-secret-change-me',
    encryptionKey: env.ENCRYPTION_KEY?.trim() || jwtSecret || 'local-development-secret-change-me',
    openwa: { baseUrl: openwaBaseUrl, apiKey: openwaApiKey, webhookSecret },
    redisUrl: env.REDIS_URL?.trim(),
    bootstrapSecret: env.BOOTSTRAP_SECRET?.trim(),
  };
}

/** URL a la que OpenWA entregará los eventos de una sesión. */
export function webhookUrl(publicApiUrl: string): string {
  return `${publicApiUrl.replace(/\/$/, '')}/api/v1/integrations/openwa/webhook`;
}
