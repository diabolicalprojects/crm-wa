import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export interface SendTextInput { providerSessionId: string; chatId: string; text: string }

@Injectable()
export class OpenWaGateway {
  private readonly baseUrl = (process.env.OPENWA_BASE_URL ?? '').replace(/\/$/, '');
  private headers() { return { 'Content-Type': 'application/json', 'X-API-Key': process.env.OPENWA_API_KEY ?? '' }; }
  private async request(path: string, init: RequestInit = {}) {
    if (!this.baseUrl) throw new ServiceUnavailableException('OPENWA_BASE_URL no configurado');
    const response = await fetch(`${this.baseUrl}${path}`, { ...init, headers: { ...this.headers(), ...(init.headers ?? {}) } });
    if (!response.ok) throw new ServiceUnavailableException(`OpenWA respondió ${response.status}`);
    return response.status === 204 ? undefined : response.json();
  }
  createSession(name: string) { return this.request('/sessions', { method: 'POST', body: JSON.stringify({ name }) }); }
  startSession(id: string) { return this.request(`/sessions/${encodeURIComponent(id)}/start`, { method: 'POST' }); }
  getQr(id: string) { return this.request(`/sessions/${encodeURIComponent(id)}/qr`); }
  getStatus(id: string) { return this.request(`/sessions/${encodeURIComponent(id)}/status`); }
  sendText(input: SendTextInput) { return this.request(`/sessions/${encodeURIComponent(input.providerSessionId)}/messages/send-text`, { method: 'POST', body: JSON.stringify({ chatId: input.chatId, text: input.text }) }); }
}
