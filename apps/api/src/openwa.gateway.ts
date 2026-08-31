import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Adaptador de la pasarela de WhatsApp.
 *
 * El dominio del CRM habla únicamente estos tipos; los DTO propios de OpenWA no
 * salen de este archivo (spec §10.4 y §28.1). Cambiar de proveedor —por ejemplo
 * a la API oficial de Meta— debe requerir solo una implementación nueva de
 * `WhatsAppGateway`.
 *
 * El contrato de OpenWA está fijado en `docs/openwa-contract.md`.
 */

export type ProviderSessionStatus =
  | 'CREATING'
  | 'QR_REQUIRED'
  | 'STARTING'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'FAILED'
  | 'STOPPED';

export interface ProviderSession {
  providerSessionId: string;
  name?: string;
  status: ProviderSessionStatus;
  phoneNumber?: string;
  engineType?: string;
  rawStatus?: string;
}

export interface QrResult {
  /** Data URL PNG lista para `<img src>`; OpenWA nunca expone la referencia cruda. */
  qrCode?: string;
  status: ProviderSessionStatus;
}

export interface ProviderMessage {
  providerMessageId: string;
  timestamp?: Date;
}

export interface SendTextInput {
  providerSessionId: string;
  chatId: string;
  text: string;
}

export type MediaKind = 'image' | 'video' | 'audio' | 'voice' | 'document' | 'sticker';

export interface SendMediaInput {
  providerSessionId: string;
  chatId: string;
  kind: MediaKind;
  /** URL accesible por OpenWA o data URL, según lo que acepte el motor. */
  media: string;
  caption?: string;
  filename?: string;
}

export interface ConfigureWebhookInput {
  providerSessionId: string;
  url: string;
  secret?: string;
  events?: string[];
}

export interface ProviderWebhook {
  id: string;
  url: string;
  events: string[];
  active?: boolean;
}

export interface WhatsAppGateway {
  createSession(name: string): Promise<ProviderSession>;
  startSession(providerSessionId: string): Promise<void>;
  getQr(providerSessionId: string): Promise<QrResult>;
  getStatus(providerSessionId: string): Promise<ProviderSession>;
  sendText(input: SendTextInput): Promise<ProviderMessage>;
  sendMedia(input: SendMediaInput): Promise<ProviderMessage>;
  configureWebhook(input: ConfigureWebhookInput): Promise<ProviderWebhook>;
  listWebhooks(providerSessionId: string): Promise<ProviderWebhook[]>;
  deleteWebhook(providerSessionId: string, webhookId: string): Promise<void>;
  stopSession(providerSessionId: string): Promise<void>;
  logoutSession(providerSessionId: string): Promise<void>;
  deleteSession(providerSessionId: string): Promise<void>;
  health(): Promise<boolean>;
}

/** Eventos que el CRM necesita para operar (ver `docs/openwa-contract.md`). */
export const CRM_WEBHOOK_EVENTS = [
  'message.received',
  'message.sent',
  'message.ack',
  'message.failed',
  'session.status',
  'session.qr',
  'session.authenticated',
  'session.disconnected',
  'session.restriction',
];

/** Traduce el estado del proveedor al enum `SessionStatus` del CRM. */
export function mapProviderStatus(value: unknown): ProviderSessionStatus {
  const status = String(value ?? '').toLowerCase();
  switch (status) {
    case 'created':
      return 'CREATING';
    case 'initializing':
    case 'authenticating':
      return 'STARTING';
    case 'qr_ready':
    case 'action_required':
      return 'QR_REQUIRED';
    case 'ready':
      return 'CONNECTED';
    case 'disconnected':
      return 'DISCONNECTED';
    case 'failed':
      return 'FAILED';
    case 'stopped':
      return 'STOPPED';
    default:
      // Tolerar valores nuevos del proveedor sin romper: se conserva el crudo
      // en `rawStatus` para diagnóstico (spec §11.5 `last_provider_status`).
      return status.includes('ready') || status.includes('connect')
        ? 'CONNECTED'
        : 'DISCONNECTED';
  }
}

@Injectable()
export class OpenWaGateway implements WhatsAppGateway {
  private readonly log = new Logger(OpenWaGateway.name);

  private get baseUrl() {
    return (process.env.OPENWA_BASE_URL ?? '').replace(/\/$/, '');
  }

  private async request<T = any>(path: string, init: RequestInit = {}): Promise<T | undefined> {
    if (!this.baseUrl) throw new ServiceUnavailableException('OPENWA_BASE_URL no configurado');
    const apiKey = process.env.OPENWA_API_KEY;
    if (!apiKey) throw new ServiceUnavailableException('OPENWA_API_KEY no configurado');

    const timeout = Number(process.env.OPENWA_TIMEOUT_MS ?? 15000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey,
          ...(init.headers ?? {}),
        },
      });
      if (!response.ok) {
        // El cuerpo de error de OpenWA es `{message,error,statusCode}` y nunca
        // debe incluir la clave; se registra solo el mensaje (spec §10.2).
        const detail = await response.text().catch(() => '');
        const message = this.safeMessage(detail) ?? `OpenWA respondió ${response.status}`;
        this.log.warn(`${init.method ?? 'GET'} ${path} → ${response.status}: ${message}`);
        throw new ServiceUnavailableException(message);
      }
      return response.status === 204 ? undefined : ((await response.json()) as T);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ServiceUnavailableException(`OpenWA no respondió en ${timeout} ms`);
      }
      throw new ServiceUnavailableException(
        error instanceof Error ? error.message : 'OpenWA no disponible',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private safeMessage(body: string): string | undefined {
    try {
      const parsed = JSON.parse(body);
      const message = parsed?.message;
      return Array.isArray(message) ? message.join(', ') : message;
    } catch {
      return undefined;
    }
  }

  private toSession(raw: any, fallbackId: string): ProviderSession {
    const rawStatus = raw?.status ?? raw?.state;
    return {
      providerSessionId: String(raw?.id ?? raw?.sessionId ?? fallbackId),
      name: raw?.name,
      status: mapProviderStatus(rawStatus),
      phoneNumber: raw?.phone ?? raw?.phoneNumber ?? undefined,
      engineType: raw?.engine ?? raw?.engineType ?? undefined,
      rawStatus: rawStatus == null ? undefined : String(rawStatus),
    };
  }

  async createSession(name: string): Promise<ProviderSession> {
    const raw = await this.request('/sessions', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    return this.toSession(raw, name);
  }

  async startSession(providerSessionId: string): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(providerSessionId)}/start`, {
      method: 'POST',
    });
  }

  async stopSession(providerSessionId: string): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(providerSessionId)}/stop`, {
      method: 'POST',
    });
  }

  async logoutSession(providerSessionId: string): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(providerSessionId)}/logout`, {
      method: 'POST',
    });
  }

  async deleteSession(providerSessionId: string): Promise<void> {
    await this.request(`/sessions/${encodeURIComponent(providerSessionId)}`, {
      method: 'DELETE',
    });
  }

  async getQr(providerSessionId: string): Promise<QrResult> {
    const raw = await this.request(`/sessions/${encodeURIComponent(providerSessionId)}/qr`);
    return {
      qrCode: raw?.qrCode ?? raw?.qr ?? undefined,
      status: mapProviderStatus(raw?.status),
    };
  }

  async getStatus(providerSessionId: string): Promise<ProviderSession> {
    const raw = await this.request(`/sessions/${encodeURIComponent(providerSessionId)}`);
    return this.toSession(raw, providerSessionId);
  }

  async sendText(input: SendTextInput): Promise<ProviderMessage> {
    const raw = await this.request(
      `/sessions/${encodeURIComponent(input.providerSessionId)}/messages/send-text`,
      { method: 'POST', body: JSON.stringify({ chatId: input.chatId, text: input.text }) },
    );
    return this.toMessage(raw);
  }

  async sendMedia(input: SendMediaInput): Promise<ProviderMessage> {
    const raw = await this.request(
      `/sessions/${encodeURIComponent(input.providerSessionId)}/messages/send-${input.kind}`,
      {
        method: 'POST',
        body: JSON.stringify({
          chatId: input.chatId,
          media: input.media,
          caption: input.caption,
          filename: input.filename,
        }),
      },
    );
    return this.toMessage(raw);
  }

  private toMessage(raw: any): ProviderMessage {
    const id = raw?.id ?? raw?.messageId ?? raw?.data?.id;
    if (!id) throw new ServiceUnavailableException('OpenWA no devolvió el ID del mensaje');
    const seconds = raw?.timestamp ?? raw?.data?.timestamp;
    return {
      providerMessageId: String(id),
      // El proveedor usa epoch en segundos para mensajes.
      timestamp: typeof seconds === 'number' ? new Date(seconds * 1000) : undefined,
    };
  }

  async configureWebhook(input: ConfigureWebhookInput): Promise<ProviderWebhook> {
    const raw = await this.request(
      `/sessions/${encodeURIComponent(input.providerSessionId)}/webhooks`,
      {
        method: 'POST',
        body: JSON.stringify({
          url: input.url,
          events: input.events ?? CRM_WEBHOOK_EVENTS,
          // `secret` es de solo escritura: OpenWA nunca lo devuelve. Sin él las
          // entregas llegan sin `X-OpenWA-Signature`.
          ...(input.secret ? { secret: input.secret } : {}),
        }),
      },
    );
    return {
      id: String(raw?.id ?? ''),
      url: raw?.url ?? input.url,
      events: raw?.events ?? input.events ?? CRM_WEBHOOK_EVENTS,
      active: raw?.active,
    };
  }

  async listWebhooks(providerSessionId: string): Promise<ProviderWebhook[]> {
    const raw = await this.request(
      `/sessions/${encodeURIComponent(providerSessionId)}/webhooks`,
    );
    const items = Array.isArray(raw) ? raw : (raw?.items ?? []);
    return items.map((item: any) => ({
      id: String(item?.id ?? ''),
      url: item?.url,
      events: item?.events ?? [],
      active: item?.active,
    }));
  }

  async deleteWebhook(providerSessionId: string, webhookId: string): Promise<void> {
    await this.request(
      `/sessions/${encodeURIComponent(providerSessionId)}/webhooks/${encodeURIComponent(webhookId)}`,
      { method: 'DELETE' },
    );
  }

  async health(): Promise<boolean> {
    try {
      const raw = await this.request('/health');
      return raw?.status === 'ok';
    } catch {
      return false;
    }
  }
}
