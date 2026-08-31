import { AiProviderKind } from '@prisma/client';

/**
 * Catálogo de proveedores y modelos que la consola de superadministración
 * ofrece como selectores.
 *
 * La lista es una comodidad, no una restricción: el campo `model` acepta
 * cualquier identificador, así que un modelo nuevo se puede usar sin tocar el
 * código. `defaultBaseUrl` es lo que el adaptador usa si no se captura otro.
 */

export interface ModelOption {
  id: string;
  label: string;
  /** Ventana de contexto aproximada, para mostrarla en la interfaz. */
  context: string;
  recommended?: boolean;
}

export interface ProviderOption {
  kind: AiProviderKind;
  label: string;
  /** Cómo se llama la credencial en la consola del proveedor. */
  credentialLabel: string;
  defaultBaseUrl?: string;
  supportsTools: boolean;
  models: ModelOption[];
  notes: string;
}

export const AI_PROVIDER_CATALOG: ProviderOption[] = [
  {
    kind: 'ANTHROPIC',
    label: 'Anthropic (Claude)',
    credentialLabel: 'API key de console.anthropic.com',
    supportsTools: true,
    models: [
      { id: 'claude-opus-5', label: 'Claude Opus 5', context: '1M', recommended: true },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', context: '1M' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', context: '200K' },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', context: '1M' },
    ],
    notes:
      'Mejor manejo de herramientas para las seis funciones del CRM. Usa el SDK oficial de Anthropic.',
  },
  {
    kind: 'OPENAI',
    label: 'OpenAI',
    credentialLabel: 'API key de platform.openai.com',
    defaultBaseUrl: 'https://api.openai.com/v1',
    supportsTools: true,
    models: [
      { id: 'gpt-4o', label: 'GPT-4o', context: '128K', recommended: true },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini', context: '128K' },
      { id: 'gpt-4.1', label: 'GPT-4.1', context: '1M' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini', context: '1M' },
    ],
    notes: 'Compatible con el formato estándar de chat completions.',
  },
  {
    kind: 'GEMINI',
    label: 'Google Gemini',
    credentialLabel: 'API key de Google AI Studio',
    // Gemini expone un endpoint compatible con OpenAI, así que reutiliza el
    // mismo adaptador y no necesita uno propio.
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    supportsTools: true,
    models: [
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', context: '1M', recommended: true },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', context: '1M' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', context: '1M' },
    ],
    notes: 'Suele ser la opción más económica por volumen.',
  },
  {
    kind: 'OPENAI_COMPATIBLE',
    label: 'Otro compatible con OpenAI',
    credentialLabel: 'API key del proveedor',
    supportsTools: true,
    models: [],
    notes:
      'Para Groq, Together, OpenRouter, Ollama o cualquier endpoint que hable el formato de OpenAI. Requiere capturar la URL base.',
  },
];

/** Modelo sugerido cuando se elige un proveedor sin especificar uno. */
export function defaultModelFor(kind: AiProviderKind): string | undefined {
  const provider = AI_PROVIDER_CATALOG.find((item) => item.kind === kind);
  return provider?.models.find((model) => model.recommended)?.id ?? provider?.models[0]?.id;
}

export function defaultBaseUrlFor(kind: AiProviderKind): string | undefined {
  return AI_PROVIDER_CATALOG.find((item) => item.kind === kind)?.defaultBaseUrl;
}
