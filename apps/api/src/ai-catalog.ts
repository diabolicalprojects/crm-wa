import { AiProviderKind } from '@prisma/client';

/**
 * Catálogo de respaldo de proveedores y modelos.
 *
 * **No es la fuente de verdad.** La consola consulta al proveedor sus modelos
 * reales (`POST /admin/ai/providers/discover-models`), porque los catálogos
 * cambian varias veces al año y una lista escrita a mano envejece sin avisar.
 * Esto es lo que se ofrece antes de capturar la credencial, y el campo de
 * modelo siempre acepta cualquier identificador.
 *
 * Verificado el 31 de agosto de 2026 contra la documentación de cada proveedor.
 */

export interface ModelOption {
  id: string;
  label: string;
  /** Ventana de contexto aproximada. Se omite cuando el proveedor no la publica. */
  context?: string;
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
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', context: '1M' },
      { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', context: '200K' },
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
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', context: '1M', recommended: true },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', context: '1M' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', context: '1M' },
    ],
    notes: 'Sol para razonamiento complejo, Terra equilibra costo y capacidad, Luna para alto volumen.',
  },
  {
    kind: 'GEMINI',
    label: 'Google Gemini',
    credentialLabel: 'API key de Google AI Studio',
    // Gemini expone un endpoint compatible con OpenAI, así que reutiliza el
    // mismo adaptador y no necesita uno propio. La barra final se recorta al
    // construir la ruta `/chat/completions`.
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    supportsTools: true,
    models: [
      { id: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', recommended: true },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
    notes: 'Suele ser la opción más económica por volumen. Flash 3.7 rinde bien en flujos con herramientas.',
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
