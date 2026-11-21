import {
  GoogleGenAI,
  MediaResolution,
  ThinkingLevel,
  type GenerateContentParameters,
} from '@google/genai';
import type { IncomingHttpHeaders } from 'http';
import type { AIProviderId, ModelMode } from '../types.ts';
import { PROVIDER_PRESETS } from '../utils/aiProviders.ts';
import { extractYouTubeVideoId, formatTimestamp, normalizeYouTubeUrl } from '../utils/youtube.ts';
import { callGeminiWithRetry, shouldUseLowMediaResolution } from './geminiPrompts.ts';
import {
  clearLocalVideoGeminiCache,
  ensureLocalVideoGeminiFile,
  extractLocalAudioSliceMp3,
  getLocalVideoRecord,
} from './localVideo.ts';

export interface RequestAIContext {
  provider: AIProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
  geminiFallbackKey: string;
}

const VALID_PROVIDERS = new Set<AIProviderId>([
  'gemini',
  'openai',
  'nvidia',
  'openrouter',
  'groq',
  'custom',
]);

export function extractRequestAIContext(
  headers: IncomingHttpHeaders,
  override?: Partial<RequestAIContext>
): RequestAIContext {
  const rawProvider = String(override?.provider ?? headers['x-ai-provider'] ?? 'gemini').trim();
  const provider: AIProviderId = VALID_PROVIDERS.has(rawProvider as AIProviderId)
    ? (rawProvider as AIProviderId)
    : 'gemini';

  const preset = PROVIDER_PRESETS[provider];
  const apiKey = String(override?.apiKey ?? headers['x-ai-api-key'] ?? '').trim();
  const model = String(override?.model ?? headers['x-ai-model'] ?? '').trim() || preset.defaultModel;
  const baseUrl =
    String(override?.baseUrl ?? headers['x-ai-base-url'] ?? '').trim() || preset.defaultBaseUrl;
  const geminiFallbackKey = String(
    override?.geminiFallbackKey ?? headers['x-gemini-api-key'] ?? ''
  ).trim();

  return {
    provider,
    apiKey,
    model,
    baseUrl,
    geminiFallbackKey,
  };
}

export function getGeminiClientForContext(
  ctx?: Partial<RequestAIContext>,
  apiVersion?: string
): GoogleGenAI {
  const apiKey =
    ctx?.apiKey?.trim() ||
    ctx?.geminiFallbackKey?.trim() ||
    process.env.GEMINI_API_KEY;

  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    const err = new Error(
      'GEMINI_API_KEY belum dikonfigurasi. Tambahkan API Key Gemini di Pengaturan Provider AI atau Settings > Secrets.'
    );
    (err as Error & { statusCode?: number }).statusCode = 500;
    throw err;
  }

  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

// In-memory short-lived YouTube caption cache for non-Gemini providers
const captionCache = new Map<string, { text: string; expiresAt: number }>();

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n/g, ' ')
    .trim();
}

export async function fetchYouTubeContextForTextProvider(youtubeUrl: string): Promise<string> {
  const videoId = extractYouTubeVideoId(youtubeUrl);
  if (!videoId) return `URL Video: ${youtubeUrl}`;

  const cached = captionCache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.text;
  }

  const normalized = normalizeYouTubeUrl(videoId);
  let title = '';
  let author = '';
  try {
    const oembed = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(normalized)}&format=json`
    );
    if (oembed.ok) {
      const data = (await oembed.json()) as { title?: string; author_name?: string };
      title = data.title || '';
      author = data.author_name || '';
    }
  } catch {
    // ignore oembed failure
  }

  let captionLines: string[] = [];
  try {
    const watchRes = await fetch(normalized, {
      headers: {
        'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      },
    });
    if (watchRes.ok) {
      const html = await watchRes.text();
      const tracksMatch = html.match(/"captionTracks":(\[.*?\])/);
      if (tracksMatch?.[1]) {
        const tracks = JSON.parse(tracksMatch[1]) as Array<{
          baseUrl: string;
          languageCode?: string;
        }>;
        const preferred =
          tracks.find((t) => t.languageCode?.startsWith('id')) ||
          tracks.find((t) => t.languageCode?.startsWith('en')) ||
          tracks[0];
        if (preferred?.baseUrl) {
          const capRes = await fetch(preferred.baseUrl);
          if (capRes.ok) {
            const xml = await capRes.text();
            const textMatches = xml.matchAll(
              /<text start="([\d.]+)"(?: dur="([\d.]+)")?[^>]*>([\s\S]*?)<\/text>/g
            );
            for (const m of textMatches) {
              const startSec = Math.floor(Number(m[1] || 0));
              const content = decodeHtmlEntities(m[3].replace(/<[^>]+>/g, ''));
              if (content) {
                captionLines.push(`[${formatTimestamp(startSec)}] ${content}`);
              }
            }
          }
        }
      }
    }
  } catch {
    // non-fatal if captions cannot be fetched
  }

  const header = [
    `URL YouTube: ${normalized}`,
    title ? `Judul Video: ${title}` : '',
    author ? `Kreator/Channel: ${author}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const transcriptBlock =
    captionLines.length > 0
      ? `\nTranskrip Teks Ber-timestamp dari Video:\n${captionLines.join('\n').slice(0, 32000)}`
      : '\nCatatan: Video ini tidak memiliki teks/subtitle publik yang dapat diekstrak secara otomatis. Analisis sebatas judul dan informasi yang tersedia, serta sampaikan secara jujur bila detail tidak tersedia.';

  const fullText = `${header}${transcriptBlock}`;
  captionCache.set(videoId, { text: fullText, expiresAt: Date.now() + 15 * 60 * 1000 });
  return fullText;
}

async function callOpenAICompatible(params: {
  ctx: RequestAIContext;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  expectJson?: boolean;
}): Promise<string> {
  const { ctx, messages, expectJson } = params;
  if (!ctx.apiKey) {
    throw new Error(
      `API Key untuk ${PROVIDER_PRESETS[ctx.provider].label} belum diisi. Buka Pengaturan Provider AI di header.`
    );
  }
  const url = `${ctx.baseUrl.replace(/\/+$/, '')}/chat/completions`;

  const makeRequest = async (useJsonFormat: boolean) => {
    const body: Record<string, unknown> = {
      model: ctx.model,
      messages,
      temperature: 0.3,
    };
    if (useJsonFormat) {
      body.response_format = { type: 'json_object' };
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctx.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => ({}))) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(
        json.error?.message || `Provider AI mengembalikan status ${res.status}.`
      );
    }
    return json.choices?.[0]?.message?.content ?? '';
  };

  if (expectJson) {
    try {
      return await makeRequest(true);
    } catch {
      // Fallback for endpoints/models that reject response_format
      return await makeRequest(false);
    }
  }
  return await makeRequest(false);
}

export async function generateWithActiveProvider(params: {
  ctx: RequestAIContext;
  mode: ModelMode;
  durationHint?: number;
  youtubeUrls?: string[];
  localVideoIds?: string[];
  transcriptContextText?: string;
  prompt: string;
  systemInstruction?: string;
  responseSchema?: unknown;
  expectJson?: boolean;
}): Promise<string> {
  const {
    ctx,
    mode,
    durationHint,
    youtubeUrls = [],
    localVideoIds = [],
    transcriptContextText,
    prompt,
    systemInstruction,
    responseSchema,
    expectJson,
  } = params;

  if (ctx.provider === 'gemini') {
    const ai = getGeminiClientForContext(ctx);
    const model = ctx.model || 'gemini-4-hydrogen';
    const isThinkingSupported =
      model.startsWith('gemini-4-') || model.startsWith('gemini-3');

    const runGeminiLocalOrRemote = async () => {
      const localParts = await Promise.all(
        localVideoIds.map(async (id) => {
          const fileRef = await ensureLocalVideoGeminiFile(id, ctx);
          return {
            fileData: {
              fileUri: fileRef.fileUri,
              mimeType: fileRef.mimeType,
            },
          };
        })
      );

      const parts: Array<
        { fileData: { fileUri: string; mimeType?: string } } | { text: string }
      > = [
        ...youtubeUrls.map((uri) => ({ fileData: { fileUri: uri } })),
        ...localParts,
        { text: prompt },
      ];

      const config: GenerateContentParameters['config'] = {
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(expectJson ? { responseMimeType: 'application/json' } : {}),
        ...(expectJson && responseSchema ? { responseSchema: responseSchema as never } : {}),
        ...(isThinkingSupported
          ? {
              thinkingConfig: {
                thinkingLevel: mode === 'deep' ? ThinkingLevel.HIGH : ThinkingLevel.LOW,
              },
            }
          : {}),
        ...(shouldUseLowMediaResolution(durationHint)
          ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW }
          : {}),
      };

      const response = await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts }],
          config,
        })
      );
      return response.text ?? '';
    };

    try {
      return await runGeminiLocalOrRemote();
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      if (
        localVideoIds.length > 0 &&
        (msg.includes('403') || msg.includes('404') || msg.includes('permission_denied') || msg.includes('not_found'))
      ) {
        for (const id of localVideoIds) clearLocalVideoGeminiCache(id);
        return await runGeminiLocalOrRemote();
      }
      throw err;
    }
  }

  // OpenAI / NVIDIA NIM / OpenRouter / Groq / Custom OpenAI-compatible
  const ytContexts = await Promise.all(
    youtubeUrls.map((u, idx) =>
      fetchYouTubeContextForTextProvider(u).then((txt) =>
        youtubeUrls.length + localVideoIds.length > 1
          ? `--- VIDEO YOUTUBE ${idx + 1} ---\n${txt}`
          : txt
      )
    )
  );
  const localContexts = localVideoIds.map((id) => {
    const rec = getLocalVideoRecord(id);
    const header = rec
      ? `File Video MP4 Lokal: ${rec.filename} (${rec.width}x${rec.height}, durasi ${rec.durationSec} detik)`
      : `Video MP4 Lokal ID: ${id}`;
    return transcriptContextText
      ? `${header}\n\nTranskrip Video:\n${transcriptContextText.slice(0, 32000)}`
      : `${header}\nCatatan: Analisis visual/audio penuh untuk file MP4 lokal tersedia langsung dengan provider Google Gemini. Untuk provider teks eksternal, gunakan transkrip yang sudah tersedia.`;
  });
  const videoContextText = [...ytContexts, ...localContexts].filter(Boolean).join('\n\n');

  const jsonRule = expectJson
    ? `\n\nWAJIB: Keluarkan HANYA JSON valid tanpa markdown fence (\`\`\`json) atau teks penjelasan apa pun. Ikuti struktur skema berikut:\n${JSON.stringify(responseSchema ?? {})}`
    : '';

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    {
      role: 'system',
      content:
        (systemInstruction ||
          'Anda adalah asisten analisis video berbahasa Indonesia yang akurat dan terstruktur.') +
        jsonRule,
    },
    {
      role: 'user',
      content: `${videoContextText ? `${videoContextText}\n\n` : ''}${prompt}`,
    },
  ];

  return await callGeminiWithRetry(() =>
    callOpenAICompatible({ ctx, messages, expectJson })
  );
}

export async function streamChatWithActiveProvider(params: {
  ctx: RequestAIContext;
  mode: ModelMode;
  durationHint?: number;
  youtubeUrl?: string;
  localVideoId?: string;
  transcriptContextText?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  systemInstruction: string;
  onChunk: (text: string) => void;
}): Promise<void> {
  const {
    ctx,
    mode,
    durationHint,
    youtubeUrl,
    localVideoId,
    transcriptContextText,
    messages,
    systemInstruction,
    onChunk,
  } = params;

  if (ctx.provider === 'gemini') {
    const ai = getGeminiClientForContext(ctx);
    const model = ctx.model || 'gemini-4-hydrogen';
    const isThinkingSupported =
      model.startsWith('gemini-4-') || model.startsWith('gemini-3');

    const filePart = localVideoId
      ? {
          fileData: await ensureLocalVideoGeminiFile(localVideoId, ctx),
        }
      : {
          fileData: { fileUri: youtubeUrl || '' },
        };

    const contents = messages.map((msg, idx) => {
      const role = msg.role === 'assistant' ? 'model' : 'user';
      if (idx === 0 && role === 'user') {
        return {
          role: 'user' as const,
          parts: [filePart, { text: msg.content }],
        };
      }
      return { role, parts: [{ text: msg.content }] };
    });

    const stream = await callGeminiWithRetry(() =>
      ai.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction,
          ...(isThinkingSupported
            ? {
                thinkingConfig: {
                  thinkingLevel: mode === 'deep' ? ThinkingLevel.HIGH : ThinkingLevel.LOW,
                },
              }
            : {}),
          ...(shouldUseLowMediaResolution(durationHint)
            ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW }
            : {}),
        },
      })
    );

    for await (const chunk of stream) {
      if (chunk.text) onChunk(chunk.text);
    }
    return;
  }

  // OpenAI-compatible SSE stream
  if (!ctx.apiKey) {
    throw new Error(
      `API Key untuk ${PROVIDER_PRESETS[ctx.provider].label} belum diisi.`
    );
  }
  const videoContext = localVideoId
    ? (() => {
        const rec = getLocalVideoRecord(localVideoId);
        const info = rec
          ? `File MP4 Lokal: ${rec.filename} (${rec.width}x${rec.height}, ${rec.durationSec} detik)`
          : `Video MP4 Lokal: ${localVideoId}`;
        return transcriptContextText
          ? `${info}\n\nTranskrip:\n${transcriptContextText.slice(0, 32000)}`
          : info;
      })()
    : await fetchYouTubeContextForTextProvider(youtubeUrl || '');
  const openAIMessages = [
    {
      role: 'system' as const,
      content: `${systemInstruction}\n\nKonteks Video:\n${videoContext}`,
    },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const url = `${ctx.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const upstream = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ctx.apiKey}`,
    },
    body: JSON.stringify({
      model: ctx.model,
      messages: openAIMessages,
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errBody = (await upstream.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(
      errBody.error?.message || `Streaming gagal (${upstream.status}).`
    );
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (dataStr === '[DONE]') return;
      try {
        const parsed = JSON.parse(dataStr) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) onChunk(delta);
      } catch {
        // ignore partial SSE chunks
      }
    }
  }
}

function mapOpenAIVoice(geminiVoice: string): string {
  const mapping: Record<string, string> = {
    Kore: 'nova',
    Puck: 'fable',
    Charon: 'onyx',
    Zephyr: 'alloy',
    Fenrir: 'echo',
    Aoede: 'shimmer',
  };
  return mapping[geminiVoice] || 'alloy';
}

function splitTtsText(text: string, maxLen = 1100): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  const sentences = clean.match(/[^.!?]+[.!?]*\s*/g) ?? [clean];
  const chunks: string[] = [];
  let current = '';

  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;
    if ((current ? `${current} ${sentence}` : sentence).length <= maxLen) {
      current = current ? `${current} ${sentence}` : sentence;
    } else {
      if (current) chunks.push(current);
      if (sentence.length <= maxLen) {
        current = sentence;
      } else {
        // Hard-split very long run-on sentences by words
        const words = sentence.split(/\s+/);
        let part = '';
        for (const w of words) {
          if ((part ? `${part} ${w}` : w).length <= maxLen) {
            part = part ? `${part} ${w}` : w;
          } else {
            if (part) chunks.push(part);
            part = w;
          }
        }
        current = part;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export async function generateTTSWithActiveProvider(params: {
  ctx: RequestAIContext;
  text: string;
  voiceName: string;
  speakingStyle: string;
}): Promise<{ pcmBase64: string; usedProvider: 'gemini' | 'openai' }> {
  const { ctx, text, voiceName, speakingStyle } = params;
  const textChunks = splitTtsText(text, 1100);
  if (textChunks.length === 0) {
    throw new Error('Naskah voice over tidak boleh kosong.');
  }

  if (ctx.provider === 'openai' && ctx.apiKey) {
    const url = `${ctx.baseUrl.replace(/\/+$/, '')}/audio/speech`;
    const allPcm: Buffer[] = [];
    for (const chunkText of textChunks) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ctx.apiKey}`,
        },
        body: JSON.stringify({
          model: 'tts-1',
          input: chunkText,
          voice: mapOpenAIVoice(voiceName),
          response_format: 'pcm',
        }),
      });
      if (!res.ok) {
        const errJson = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        throw new Error(
          errJson.error?.message || `OpenAI TTS gagal (${res.status}).`
        );
      }
      allPcm.push(Buffer.from(await res.arrayBuffer()));
    }
    return { pcmBase64: Buffer.concat(allPcm).toString('base64'), usedProvider: 'openai' };
  }

  // Use Gemini TTS (uses user's Gemini key if saved, or server GEMINI_API_KEY).
  // Gemini 3.8 TTS speechConfig/speechMetadata requires v1beta in @google/genai >= 3.4.0.
  const ai = getGeminiClientForContext(
    {
      apiKey: ctx.provider === 'gemini' ? ctx.apiKey : ctx.geminiFallbackKey,
      geminiFallbackKey: ctx.geminiFallbackKey,
    },
    'v1beta'
  );

  const pcmChunks: Buffer[] = [];
  for (const chunkText of textChunks) {
    const responseStream = await callGeminiWithRetry(() =>
      ai.models.generateContentStream({
        model: 'gemini-3.8-flash-lite-tts',
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: chunkText,
                speechMetadata: {
                  style: speakingStyle.trim() || 'Clear and natural',
                },
              },
            ],
          },
        ],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName },
            },
          },
        },
      })
    );

    for await (const chunk of responseStream) {
      const data = chunk.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (data) {
        let buf = Buffer.from(data, 'base64');
        // Strip 44-byte RIFF/WAV header if upstream ever sends WAV framing
        if (
          buf.length > 44 &&
          buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
          buf.subarray(8, 12).toString('ascii') === 'WAVE'
        ) {
          buf = buf.subarray(44);
        }
        if (buf.length > 0) {
          pcmChunks.push(buf);
        }
      }
    }
  }

  if (pcmChunks.length === 0) {
    throw new Error('Gemini TTS tidak menghasilkan audio. Coba lagi.');
  }
  return {
    pcmBase64: Buffer.concat(pcmChunks).toString('base64'),
    usedProvider: 'gemini',
  };
}

function stripWavHeaderIfPresent(buf: Buffer): Buffer {
  if (
    buf.length > 44 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WAVE'
  ) {
    return buf.subarray(44);
  }
  return buf;
}

export async function generateMultiSpeakerPodcastAudio(params: {
  ctx: RequestAIContext;
  hostName: string;
  hostVoice: string;
  coHostName: string;
  coHostVoice: string;
  dialog: Array<{ pembicara: 'Host' | 'Ko-Host'; nama?: string; gaya?: string; teks: string }>;
}): Promise<{ pcmBase64: string; usedProvider: 'gemini' }> {
  const { ctx, hostName, hostVoice, coHostName, coHostVoice, dialog } = params;
  const cleanHost = (hostName || 'Host').trim() || 'Host';
  const cleanCoHost =
    (coHostName || 'Ko-Host').trim() === cleanHost
      ? 'Ko-Host'
      : (coHostName || 'Ko-Host').trim() || 'Ko-Host';

  const validLines = dialog
    .map((d) => ({
      ...d,
      teks: String(d.teks || '').replace(/\s+/g, ' ').trim(),
    }))
    .filter((d) => d.teks.length > 0);

  if (validLines.length === 0) {
    throw new Error('Naskah dialog podcast tidak boleh kosong.');
  }

  // Gemini 3.8 TTS requires v1beta in @google/genai >= 3.4.0
  const ai = getGeminiClientForContext(
    {
      apiKey: ctx.provider === 'gemini' ? ctx.apiKey : ctx.geminiFallbackKey,
      geminiFallbackKey: ctx.geminiFallbackKey,
    },
    'v1beta'
  );

  // Batch into manageable groups (~6 turns per request) so long scripts stay under audio duration caps
  const batchSize = 6;
  const pcmChunks: Buffer[] = [];
  for (let i = 0; i < validLines.length; i += batchSize) {
    const slice = validLines.slice(i, i + batchSize);
    const parts = slice.map((line) => {
      const speakerLabel = line.pembicara === 'Ko-Host' ? cleanCoHost : cleanHost;
      return {
        text: `${speakerLabel}: ${line.teks}`,
        speechMetadata: {
          speaker: speakerLabel,
          style:
            (line.gaya || '').trim() ||
            (line.pembicara === 'Ko-Host'
              ? 'Thoughtful, engaging co-host'
              : 'Enthusiastic, warm podcast host'),
        },
      };
    });

    const response = await callGeminiWithRetry(() =>
      ai.models.generateContent({
        model: 'gemini-3.8-flash-tts',
        contents: [{ role: 'user', parts }],
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: [
                {
                  speaker: cleanHost,
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: hostVoice || 'Puck' } },
                },
                {
                  speaker: cleanCoHost,
                  voiceConfig: { prebuiltVoiceConfig: { voiceName: coHostVoice || 'Kore' } },
                },
              ],
            },
          },
        },
      })
    );

    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (data) {
      const pcm = stripWavHeaderIfPresent(Buffer.from(data, 'base64'));
      if (pcm.length > 0) pcmChunks.push(pcm);
    }
  }

  if (pcmChunks.length === 0) {
    throw new Error('Gemini Podcast TTS tidak menghasilkan audio. Coba lagi.');
  }

  return {
    pcmBase64: Buffer.concat(pcmChunks).toString('base64'),
    usedProvider: 'gemini',
  };
}

export async function generateWithSearchGrounding(params: {
  ctx: RequestAIContext;
  mode: ModelMode;
  durationHint?: number;
  youtubeUrls?: string[];
  localVideoIds?: string[];
  transcriptContextText?: string;
  prompt: string;
}): Promise<{ text: string; sources: Array<{ title: string; url: string }> }> {
  const {
    ctx,
    mode,
    durationHint,
    youtubeUrls = [],
    localVideoIds = [],
    transcriptContextText,
    prompt,
  } = params;

  if (ctx.provider !== 'gemini') {
    const text = await generateWithActiveProvider({
      ctx,
      mode,
      durationHint,
      youtubeUrls,
      localVideoIds,
      transcriptContextText,
      prompt,
      expectJson: true,
    });
    return { text, sources: [] };
  }

  const ai = getGeminiClientForContext(ctx);
  const model = ctx.model || 'gemini-4-hydrogen';
  const isThinkingSupported =
    model.startsWith('gemini-4-') || model.startsWith('gemini-3');

  const runGrounded = async () => {
    const localParts = await Promise.all(
      localVideoIds.map(async (id) => {
        const fileRef = await ensureLocalVideoGeminiFile(id, ctx);
        return {
          fileData: {
            fileUri: fileRef.fileUri,
            mimeType: fileRef.mimeType,
          },
        };
      })
    );
    const parts: Array<
      { fileData: { fileUri: string; mimeType?: string } } | { text: string }
    > = [
      ...youtubeUrls.map((uri) => ({ fileData: { fileUri: uri } })),
      ...localParts,
      { text: prompt },
    ];

    const response = await callGeminiWithRetry(() =>
      ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          tools: [{ googleSearch: {} }],
          ...(isThinkingSupported
            ? {
                thinkingConfig: {
                  thinkingLevel: mode === 'deep' ? ThinkingLevel.HIGH : ThinkingLevel.LOW,
                },
              }
            : {}),
          ...(shouldUseLowMediaResolution(durationHint)
            ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW }
            : {}),
        },
      })
    );

    const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const seen = new Set<string>();
    const sources: Array<{ title: string; url: string }> = [];
    for (const c of rawChunks) {
      const uri = c.web?.uri;
      if (uri && !seen.has(uri)) {
        seen.add(uri);
        sources.push({
          title: c.web?.title || uri,
          url: uri,
        });
      }
    }

    return {
      text: response.text ?? '',
      sources: sources.slice(0, 12),
    };
  };

  try {
    return await runGrounded();
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (
      localVideoIds.length > 0 &&
      (msg.includes('403') || msg.includes('404') || msg.includes('permission_denied') || msg.includes('not_found'))
    ) {
      for (const id of localVideoIds) clearLocalVideoGeminiCache(id);
      return await runGrounded();
    }
    throw err;
  }
}

export async function transcribeLocalAudioWithGemini(params: {
  ctx: RequestAIContext;
  localVideoId: string;
  startSec: number;
  endSec: number;
  prompt: string;
}): Promise<string> {
  const { ctx, localVideoId, startSec, endSec, prompt } = params;
  const slice = await extractLocalAudioSliceMp3(localVideoId, startSec, endSec);
  const ai = getGeminiClientForContext({
    apiKey: ctx.provider === 'gemini' ? ctx.apiKey : ctx.geminiFallbackKey,
    geminiFallbackKey: ctx.geminiFallbackKey,
  });

  const response = await callGeminiWithRetry(() =>
    ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: slice.mimeType,
              data: slice.audioBase64,
            },
          },
          { text: prompt },
        ],
      },
    })
  );

  return response.text ?? '';
}

export async function testAIConnection(ctx: RequestAIContext): Promise<{
  ok: boolean;
  provider: AIProviderId;
  model: string;
  latencyMs: number;
  reply: string;
}> {
  const started = Date.now();
  const reply = await generateWithActiveProvider({
    ctx,
    mode: 'fast',
    prompt: 'Balas dengan singkat: Koneksi berhasil.',
    expectJson: false,
  });
  return {
    ok: true,
    provider: ctx.provider,
    model: ctx.model,
    latencyMs: Date.now() - started,
    reply: reply.trim().slice(0, 80),
  };
}
