import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import { AiProviderKind } from '@prisma/client';

/**
 * Capa común de generación para todos los proveedores (spec §13.0).
 *
 * El dominio del CRM nunca habla el dialecto de un proveedor: define
 * herramientas y mensajes en estos tipos y el adaptador traduce. Añadir un
 * proveedor nuevo es implementar `AiAdapter`, no tocar el worker.
 */

export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON Schema del argumento. */
  parameters: Record<string, unknown>;
}

export interface AiToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AiMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content?: string; toolCalls?: AiToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export interface AiGenerateInput {
  model: string;
  system: string;
  messages: AiMessage[];
  tools?: AiToolDefinition[];
  temperature?: number;
  maxTokens?: number;
}

export interface AiResult {
  text: string;
  toolCalls: AiToolCall[];
  promptTokens?: number;
  completionTokens?: number;
  stopReason?: string;
}

export interface AiCredentials {
  kind: AiProviderKind;
  apiKey: string;
  baseUrl?: string;
}

export interface AiAdapter {
  generate(credentials: AiCredentials, input: AiGenerateInput): Promise<AiResult>;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

/**
 * Usa el SDK oficial. Notas del contrato vigente que afectan a este adaptador:
 * no existe prefill, `budget_tokens` fue removido y el pensamiento es adaptativo
 * por defecto en los modelos actuales.
 */
export class AnthropicAdapter implements AiAdapter {
  async generate(credentials: AiCredentials, input: AiGenerateInput): Promise<AiResult> {
    const client = new Anthropic({
      apiKey: credentials.apiKey,
      ...(credentials.baseUrl ? { baseURL: credentials.baseUrl } : {}),
    });

    const response = await client.messages.create({
      model: input.model,
      max_tokens: input.maxTokens ?? 1024,
      system: input.system,
      messages: this.toMessages(input.messages),
      ...(input.tools?.length
        ? {
            tools: input.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters as Anthropic.Tool.InputSchema,
            })),
          }
        : {}),
    });

    const toolCalls: AiToolCall[] = [];
    let text = '';
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
      else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }

    return {
      text: text.trim(),
      toolCalls,
      promptTokens: response.usage.input_tokens,
      completionTokens: response.usage.output_tokens,
      stopReason: response.stop_reason ?? undefined,
    };
  }

  private toMessages(messages: AiMessage[]): Anthropic.MessageParam[] {
    const result: Anthropic.MessageParam[] = [];
    for (const message of messages) {
      if (message.role === 'user') {
        result.push({ role: 'user', content: message.content });
        continue;
      }
      if (message.role === 'assistant') {
        const content: Anthropic.ContentBlockParam[] = [];
        if (message.content) content.push({ type: 'text', text: message.content });
        for (const call of message.toolCalls ?? []) {
          content.push({ type: 'tool_use', id: call.id, name: call.name, input: call.input });
        }
        if (content.length) result.push({ role: 'assistant', content });
        continue;
      }
      // Los resultados de herramientas viajan como bloques dentro de un turno
      // de usuario; se agrupan con el anterior si ya es de ese rol.
      const block: Anthropic.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: message.toolCallId,
        content: message.content,
      };
      const last = result[result.length - 1];
      if (last?.role === 'user' && Array.isArray(last.content)) {
        (last.content as Anthropic.ContentBlockParam[]).push(block);
      } else {
        result.push({ role: 'user', content: [block] });
      }
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// OpenAI y compatibles (incluye Gemini vía su endpoint compatible)
// ---------------------------------------------------------------------------

export class OpenAiCompatibleAdapter implements AiAdapter {
  async generate(credentials: AiCredentials, input: AiGenerateInput): Promise<AiResult> {
    const base = (credentials.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${credentials.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model,
        temperature: input.temperature ?? 0.3,
        max_tokens: input.maxTokens ?? 1024,
        messages: [
          { role: 'system', content: input.system },
          ...this.toMessages(input.messages),
        ],
        ...(input.tools?.length
          ? {
              tools: input.tools.map((tool) => ({
                type: 'function',
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
            }
          : {}),
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Proveedor respondió ${response.status}: ${detail.slice(0, 300)}`);
    }

    const json: any = await response.json();
    const choice = json.choices?.[0];
    const calls = choice?.message?.tool_calls ?? [];

    return {
      text: String(choice?.message?.content ?? '').trim(),
      toolCalls: calls.map((call: any) => ({
        id: String(call.id),
        name: String(call.function?.name),
        input: this.parseArguments(call.function?.arguments),
      })),
      promptTokens: json.usage?.prompt_tokens,
      completionTokens: json.usage?.completion_tokens,
      stopReason: choice?.finish_reason,
    };
  }

  /** Los argumentos llegan como cadena JSON; nunca compararla como texto. */
  private parseArguments(value: unknown): Record<string, unknown> {
    if (typeof value !== 'string') return (value as Record<string, unknown>) ?? {};
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  private toMessages(messages: AiMessage[]) {
    return messages.map((message) => {
      if (message.role === 'user') return { role: 'user', content: message.content };
      if (message.role === 'assistant') {
        return {
          role: 'assistant',
          content: message.content ?? null,
          ...(message.toolCalls?.length
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: JSON.stringify(call.input) },
                })),
              }
            : {}),
        };
      }
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    });
  }
}

// ---------------------------------------------------------------------------
// Fachada
// ---------------------------------------------------------------------------

@Injectable()
export class AiGateway {
  private readonly log = new Logger(AiGateway.name);
  private readonly anthropic = new AnthropicAdapter();
  private readonly openAiCompatible = new OpenAiCompatibleAdapter();

  adapterFor(kind: AiProviderKind): AiAdapter {
    return kind === 'ANTHROPIC' ? this.anthropic : this.openAiCompatible;
  }

  generate(credentials: AiCredentials, input: AiGenerateInput): Promise<AiResult> {
    return this.adapterFor(credentials.kind).generate(credentials, input);
  }

  /**
   * Verifica que la credencial funciona antes de guardarla, con una llamada
   * mínima. Devuelve el error del proveedor para mostrarlo en la consola.
   */
  async test(credentials: AiCredentials, model: string): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.generate(credentials, {
        model,
        system: 'Responde únicamente con la palabra: listo',
        messages: [{ role: 'user', content: 'Prueba de conexión' }],
        maxTokens: 16,
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error desconocido';
      this.log.warn(`Prueba de proveedor fallida: ${message}`);
      return { ok: false, error: message };
    }
  }
}
