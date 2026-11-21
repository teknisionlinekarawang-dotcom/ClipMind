import type { AIProviderEntry, AIProviderId, AISettingsState } from '../types';

export interface AIProviderPreset {
  id: AIProviderId;
  label: string;
  shortLabel: string;
  defaultBaseUrl: string;
  defaultModel: string;
  suggestedModels: string[];
  requiresApiKeyInUi: boolean;
  keyPlaceholder: string;
  description: string;
}

export const AI_SETTINGS_STORAGE_KEY = 'clipmind_ai_providers_v1';

export const PROVIDER_PRESETS: Record<AIProviderId, AIProviderPreset> = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    shortLabel: 'Gemini',
    defaultBaseUrl: '',
    defaultModel: 'gemini-4-hydrogen',
    suggestedModels: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
    requiresApiKeyInUi: false,
    keyPlaceholder: 'AIza... (opsional — kosongkan untuk pakai kunci server)',
    description:
      'Mendukung analisis video YouTube langsung (audio + visual), chat streaming, dan Gemini TTS.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    suggestedModels: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    requiresApiKeyInUi: true,
    keyPlaceholder: 'sk-proj-...',
    description:
      'Menggunakan endpoint Chat Completions OpenAI serta dukungan Voice Over TTS-1.',
  },
  nvidia: {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    shortLabel: 'NVIDIA NIM',
    defaultBaseUrl: 'https://integrate.api.nvidia.com/v1',
    defaultModel: 'meta/llama-3.3-70b-instruct',
    suggestedModels: [
      'meta/llama-3.3-70b-instruct',
      'qwen/qwen2.5-72b-instruct',
      'deepseek-ai/deepseek-r1',
    ],
    requiresApiKeyInUi: true,
    keyPlaceholder: 'nvapi-...',
    description:
      'Menjalankan model open-weights berkecepatan tinggi melalui API NVIDIA NIM.',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter',
    shortLabel: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.5-flash',
    suggestedModels: [
      'google/gemini-2.5-flash',
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-sonnet',
    ],
    requiresApiKeyInUi: true,
    keyPlaceholder: 'sk-or-v1-...',
    description:
      'Akses ratusan model lintas vendor lewat satu API key OpenRouter.',
  },
  groq: {
    id: 'groq',
    label: 'Groq',
    shortLabel: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    suggestedModels: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    requiresApiKeyInUi: true,
    keyPlaceholder: 'gsk_...',
    description: 'Inferensi super cepat menggunakan LPU Groq untuk model Llama.',
  },
  custom: {
    id: 'custom',
    label: 'Kustom (OpenAI-Compatible)',
    shortLabel: 'Kustom',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    suggestedModels: [],
    requiresApiKeyInUi: true,
    keyPlaceholder: 'Masukkan API key endpoint kustom…',
    description:
      'Hubungkan endpoint apa pun yang kompatibel dengan API OpenAI (Together, Fireworks, Ollama, dll).',
  },
};

export const PROVIDER_ORDER: AIProviderId[] = [
  'gemini',
  'openai',
  'nvidia',
  'openrouter',
  'groq',
  'custom',
];

export function createDefaultAISettings(): AISettingsState {
  const providers = {} as Record<AIProviderId, AIProviderEntry>;
  for (const id of PROVIDER_ORDER) {
    const preset = PROVIDER_PRESETS[id];
    providers[id] = {
      id,
      apiKey: '',
      model: preset.defaultModel,
      baseUrl: preset.defaultBaseUrl,
      customName: id === 'custom' ? 'Provider Kustom' : undefined,
    };
  }
  return {
    activeProvider: 'gemini',
    providers,
  };
}

export function mergeStoredAISettings(rawJson: string | null): AISettingsState {
  const defaults = createDefaultAISettings();
  if (!rawJson) return defaults;
  try {
    const parsed = JSON.parse(rawJson) as Partial<AISettingsState>;
    const activeProvider: AIProviderId =
      parsed.activeProvider && parsed.activeProvider in defaults.providers
        ? parsed.activeProvider
        : 'gemini';

    const mergedProviders = { ...defaults.providers };
    if (parsed.providers && typeof parsed.providers === 'object') {
      for (const id of PROVIDER_ORDER) {
        const stored = parsed.providers[id];
        if (stored && typeof stored === 'object') {
          mergedProviders[id] = {
            ...defaults.providers[id],
            ...stored,
            id,
          };
        }
      }
    }
    return {
      activeProvider,
      providers: mergedProviders,
    };
  } catch {
    return defaults;
  }
}

export function validateProviderConfig(entry: AIProviderEntry): {
  valid: boolean;
  error?: string;
} {
  const preset = PROVIDER_PRESETS[entry.id];
  if (!entry.model.trim()) {
    return { valid: false, error: 'Nama model wajib diisi.' };
  }
  if (preset.requiresApiKeyInUi && !entry.apiKey.trim()) {
    return {
      valid: false,
      error: `API Key untuk ${preset.label} wajib diisi.`,
    };
  }
  if (entry.id !== 'gemini') {
    const url = entry.baseUrl.trim();
    if (!url || !/^https?:\/\/.+/i.test(url)) {
      return {
        valid: false,
        error: 'Base URL harus diawali http:// atau https://.',
      };
    }
  }
  return { valid: true };
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return 'Belum diisi';
  if (trimmed.length <= 10) return '••••••';
  return `${trimmed.slice(0, 6)}••••${trimmed.slice(-4)}`;
}

export function buildProviderHeaders(
  settings: AISettingsState
): Record<string, string> {
  const active = settings.providers[settings.activeProvider];
  const geminiEntry = settings.providers.gemini;
  const headers: Record<string, string> = {
    'x-ai-provider': active.id,
    'x-ai-model': active.model.trim() || PROVIDER_PRESETS[active.id].defaultModel,
  };
  if (active.apiKey.trim()) {
    headers['x-ai-api-key'] = active.apiKey.trim();
  }
  if (active.baseUrl.trim()) {
    headers['x-ai-base-url'] = active.baseUrl.trim();
  }
  if (geminiEntry?.apiKey.trim()) {
    headers['x-gemini-api-key'] = geminiEntry.apiKey.trim();
  }
  return headers;
}
