import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAiCompatibleAdapter, type AiMessage } from './ai-gateway';

const CREDENTIALS = {
  kind: 'GEMINI' as const,
  apiKey: 'clave',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
};

function respondWith(body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse(fetchMock.mock.calls[0][1].body);
}

describe('adaptador compatible con OpenAI', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  /**
   * Gemini 3 adjunta una `thought_signature` cifrada a cada llamada de
   * herramienta y exige recibirla de vuelta en el turno siguiente. Si se pierde
   * responde 400 y el ciclo de herramientas se rompe en la segunda vuelta, que
   * es justo donde el agente empieza a buscar propiedades.
   */
  it('conserva la firma de razonamiento que Gemini adjunta a la herramienta', async () => {
    const fetchMock = respondWith({
      choices: [{
        message: {
          content: null,
          tool_calls: [{
            id: 'call_1',
            function: { name: 'searchProperties', arguments: '{"operationType":"RENT"}' },
            extra_content: { google: { thought_signature: 'firma-cifrada-abc' } },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    });

    const adapter = new OpenAiCompatibleAdapter();
    const result = await adapter.generate(CREDENTIALS, {
      model: 'gemini-3.7-flash',
      system: 'eres un asesor',
      messages: [{ role: 'user', content: 'quiero rentar' }],
    });

    expect(result.toolCalls[0].providerMetadata).toEqual({
      extra_content: { google: { thought_signature: 'firma-cifrada-abc' } },
    });

    // Y al continuar la conversación debe regresar intacta.
    const followUp: AiMessage[] = [
      { role: 'user', content: 'quiero rentar' },
      { role: 'assistant', content: '', toolCalls: result.toolCalls },
      { role: 'tool', toolCallId: 'call_1', name: 'searchProperties', content: '{"found":0}' },
    ];
    const second = respondWith({ choices: [{ message: { content: 'Sin coincidencias' } }] });
    await adapter.generate(CREDENTIALS, {
      model: 'gemini-3.7-flash',
      system: 'eres un asesor',
      messages: followUp,
    });

    const assistantTurn = sentBody(second).messages.find((m: any) => m.role === 'assistant');
    expect(assistantTurn.tool_calls[0].extra_content).toEqual({
      google: { thought_signature: 'firma-cifrada-abc' },
    });
  });

  it('no inventa el campo cuando el proveedor no lo envía', async () => {
    respondWith({
      choices: [{
        message: {
          tool_calls: [{ id: 'c1', function: { name: 'qualifyLead', arguments: '{"score":40}' } }],
        },
      }],
    });
    const result = await new OpenAiCompatibleAdapter().generate(CREDENTIALS, {
      model: 'gpt-5.6-terra',
      system: 's',
      messages: [{ role: 'user', content: 'hola' }],
    });
    expect(result.toolCalls[0].providerMetadata).toBeUndefined();
  });

  it('parsea los argumentos como JSON y nunca como texto', async () => {
    respondWith({
      choices: [{
        message: {
          tool_calls: [{
            id: 'c1',
            function: { name: 'searchProperties', arguments: '{"maxPrice":25000,"locations":["Jesús María"]}' },
          }],
        },
      }],
    });
    const result = await new OpenAiCompatibleAdapter().generate(CREDENTIALS, {
      model: 'gemini-3.7-flash',
      system: 's',
      messages: [{ role: 'user', content: 'hola' }],
    });
    expect(result.toolCalls[0].input).toEqual({ maxPrice: 25000, locations: ['Jesús María'] });
  });

  it('propaga el error del proveedor con su código', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('{"error":{"message":"You exceeded your current quota"}}'),
    }));
    await expect(
      new OpenAiCompatibleAdapter().generate(CREDENTIALS, {
        model: 'gemini-3.7-flash',
        system: 's',
        messages: [{ role: 'user', content: 'hola' }],
      }),
    ).rejects.toThrow(/429/);
  });
});
