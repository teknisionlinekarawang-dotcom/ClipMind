import type {
  AIProviderEntry,
  AIProviderId,
  AISettingsState,
  CarouselDeckData,
  ClipMetadataData,
  ClipRetentionAuditData,
  CornellNotesData,
  FactCheckItem,
  FactCheckWebSource,
  FlashcardItem,
  GeminiVoiceName,
  HighlightItem,
  LocalVideoInfo,
  MindMapNode,
  ModelMode,
  PodcastData,
  QuizQuestionItem,
  QuoteCardItem,
  SopGuideData,
  SubtitleLine,
  SummaryData,
  SummaryLength,
  SummaryStyle,
  ThumbnailIdea,
  TranscriptMode,
  TranscriptSegment,
  VideoComparisonData,
  VirtualClip,
  VoiceOverTone,
} from '../types';
import {
  buildProviderHeaders,
  createDefaultAISettings,
} from '../utils/aiProviders';

let activeAISettings: AISettingsState = createDefaultAISettings();

export function setActiveAISettings(settings: AISettingsState) {
  activeAISettings = settings;
}

export function getActiveAISettings(): AISettingsState {
  return activeAISettings;
}

async function postJson<T>(
  url: string,
  body: unknown,
  signal?: AbortSignal
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildProviderHeaders(activeAISettings),
    },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || `Permintaan gagal (${res.status}).`
    );
  }
  return data as T;
}

function sendChunkXhr(
  url: string,
  chunkBlob: Blob,
  offset: number,
  totalSize: number,
  onChunkProgress: (loadedInChunk: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.timeout = 90000;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('x-chunk-offset', String(offset));

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        onChunkProgress(evt.loaded);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      if (xhr.status === 413) {
        reject(
          new Error(
            'Potongan unggahan ditolak server (413 Payload Too Large). Coba ulangi unggahan.'
          )
        );
        return;
      }
      try {
        const parsed = JSON.parse(xhr.responseText || '{}') as { error?: string };
        reject(
          new Error(parsed.error || `Gagal mengunggah bagian video (${xhr.status}).`)
        );
      } catch {
        reject(new Error(`Gagal mengunggah bagian video (${xhr.status}).`));
      }
    };

    xhr.ontimeout = () => {
      reject(
        new Error(
          `Waktu habis saat mengirim bagian video (${Math.round((offset / Math.max(1, totalSize)) * 100)}%).`
        )
      );
    };

    xhr.onerror = () => {
      reject(
        new Error(
          `Koneksi terputus saat mengunggah (${Math.round((offset / Math.max(1, totalSize)) * 100)}%).`
        )
      );
    };

    xhr.send(chunkBlob);
  });
}

export async function uploadLocalMp4Video(
  file: File,
  onProgress?: (pct: number) => void
): Promise<LocalVideoInfo> {
  const initRes = await fetch('/api/local-video/upload/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, sizeBytes: file.size }),
  });
  const initData = (await initRes.json().catch(() => ({}))) as {
    localId?: string;
    chunkSize?: number;
    error?: string;
  };
  if (!initRes.ok || !initData.localId) {
    throw new Error(
      initData.error || `Gagal memulai unggahan video (${initRes.status}).`
    );
  }

  const localId = initData.localId;
  const chunkSize = initData.chunkSize || 5 * 1024 * 1024;
  const chunkUrl = `/api/local-video/upload/chunk/${encodeURIComponent(localId)}`;

  try {
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      const end = Math.min(file.size, offset + chunkSize);
      const slice = file.slice(offset, end);

      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await sendChunkXhr(chunkUrl, slice, offset, file.size, (loaded) => {
            const pct = Math.min(
              98,
              Math.round(((offset + loaded) / Math.max(1, file.size)) * 100)
            );
            onProgress?.(pct);
          });
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, (attempt + 1) * 700));
          }
        }
      }
      if (lastErr) {
        throw lastErr;
      }
    }

    const completeRes = await fetch(
      `/api/local-video/upload/complete/${encodeURIComponent(localId)}`,
      { method: 'POST' }
    );
    const completeData = (await completeRes.json().catch(() => ({}))) as LocalVideoInfo & {
      error?: string;
    };
    if (!completeRes.ok || !completeData.localId) {
      throw new Error(
        completeData.error ||
          `Gagal memverifikasi file MP4 (${completeRes.status}).`
      );
    }

    onProgress?.(100);
    return completeData;
  } catch (err) {
    fetch(`/api/local-video/upload/abort/${encodeURIComponent(localId)}`, {
      method: 'POST',
    }).catch(() => {});
    throw err;
  }
}

export async function exportLocalClipMp4(params: {
  localVideoId: string;
  clip: VirtualClip;
  burnSubtitles?: boolean;
  includeVoiceOver?: boolean;
}): Promise<Blob> {
  const res = await fetch('/api/local-video/export-mp4', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { error?: string }).error || `Gagal merender MP4 (${res.status}).`
    );
  }
  return await res.blob();
}

export async function testProviderConnection(entry: AIProviderEntry): Promise<{
  ok: boolean;
  provider: AIProviderId;
  model: string;
  latencyMs: number;
  reply: string;
}> {
  const res = await fetch('/api/ai/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: entry.id,
      apiKey: entry.apiKey,
      model: entry.model,
      baseUrl: entry.baseUrl,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || `Uji koneksi gagal (${res.status}).`
    );
  }
  return data;
}

export async function fetchYouTubeOembed(url: string): Promise<{
  videoId: string;
  title: string;
  author: string;
  thumbnailUrl: string;
}> {
  const res = await fetch(`/api/youtube/oembed?url=${encodeURIComponent(url)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (data as { error?: string }).error || 'Gagal membaca metadata YouTube.'
    );
  }
  return data;
}

export function analyzeSummary(params: {
  youtubeUrl?: string;
  localVideoId?: string;
  transcriptContextText?: string;
  style: SummaryStyle;
  length: SummaryLength;
  mode: ModelMode;
  durationHint?: number;
  signal?: AbortSignal;
}): Promise<SummaryData> {
  const { signal, ...payload } = params;
  return postJson<SummaryData>('/api/analyze/summary', payload, signal);
}

export function analyzeHighlights(params: {
  youtubeUrl?: string;
  localVideoId?: string;
  transcriptContextText?: string;
  focusQuery?: string;
  mode: ModelMode;
  durationHint?: number;
  signal?: AbortSignal;
}): Promise<HighlightItem[]> {
  const { signal, ...payload } = params;
  return postJson<HighlightItem[]>('/api/analyze/highlights', payload, signal);
}

export function analyzeTranscriptChunk(params: {
  youtubeUrl?: string;
  localVideoId?: string;
  startSec: number;
  endSec: number;
  transcriptMode?: TranscriptMode;
  narrationTone?: VoiceOverTone;
  targetLanguage?: string;
  mode: ModelMode;
  durationHint?: number;
  signal?: AbortSignal;
}): Promise<TranscriptSegment[]> {
  const { signal, ...payload } = params;
  return postJson<TranscriptSegment[]>('/api/analyze/transcript', payload, signal);
}

export async function streamChatWithVideo(params: {
  youtubeUrl?: string;
  localVideoId?: string;
  transcriptContextText?: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  mode: ModelMode;
  durationHint?: number;
  onChunk: (chunkText: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { signal, onChunk, ...payload } = params;
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...buildProviderHeaders(activeAISettings),
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(
      (data as { error?: string }).error || `Gagal terhubung ke chat (${res.status}).`
    );
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('Browser tidak mendukung streaming respons.');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const evt of events) {
      const line = evt.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const payloadStr = line.slice(6).trim();
      if (payloadStr === '[DONE]') return;
      const parsed = JSON.parse(payloadStr) as { text?: string; error?: string };
      if (parsed.error) {
        throw new Error(parsed.error);
      }
      if (parsed.text) {
        onChunk(parsed.text);
      }
    }
  }
}

export function generateOrTranslateSubtitles(params: {
  youtubeUrl?: string;
  localVideoId?: string;
  transcriptContextText?: string;
  clipStart: number;
  clipEnd: number;
  targetLanguage?: string;
  existingLines?: SubtitleLine[];
  mode: ModelMode;
  durationHint?: number;
}): Promise<SubtitleLine[]> {
  return postJson<SubtitleLine[]>('/api/clip/subtitles', params);
}

export function generateVoiceOverScript(params: {
  youtubeUrl?: string;
  localVideoId?: string;
  transcriptContextText?: string;
  clipStart: number;
  clipEnd: number;
  tone: VoiceOverTone;
  targetLanguage: string;
  subtitleContext?: string;
  mode: ModelMode;
  durationHint?: number;
}): Promise<{ naskah: string }> {
  return postJson<{ naskah: string }>('/api/clip/voiceover-script', params);
}

export function generateVoiceOverAudio(params: {
  text: string;
  voiceName: string;
  speakingStyle: string;
}): Promise<{
  pcmBase64: string;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
}> {
  return postJson('/api/clip/voiceover-audio', params);
}

export function generateThumbnailIdeas(params: {
  youtubeUrl?: string;
  localVideoId?: string;
  transcriptContextText?: string;
  clipTitle: string;
  clipStart: number;
  clipEnd: number;
  mode: ModelMode;
  durationHint?: number;
}): Promise<ThumbnailIdea[]> {
  return postJson<ThumbnailIdea[]>('/api/clip/thumbnail-ideas', params);
}

export function generateClipMetadata(params: {
  youtubeUrl?: string;
  localVideoId?: string;
  transcriptContextText?: string;
  clipTitle: string;
  clipStart: number;
  clipEnd: number;
  mode: ModelMode;
  durationHint?: number;
}): Promise<ClipMetadataData> {
  return postJson<ClipMetadataData>('/api/clip/metadata', params);
}

export function auditClipRetention(params: {
  youtubeUrl?: string;
  localVideoId?: string;
  transcriptContextText?: string;
  clipTitle: string;
  clipStart: number;
  clipEnd: number;
  currentRatio?: string;
  subtitleContext?: string;
  mode: ModelMode;
  durationHint?: number;
}): Promise<ClipRetentionAuditData> {
  return postJson<ClipRetentionAuditData>('/api/clip/retention-audit', params);
}

export function generatePodcastAudio(params: {
  hostName: string;
  hostVoice: GeminiVoiceName;
  coHostName: string;
  coHostVoice: GeminiVoiceName;
  dialog: Array<{ pembicara: 'Host' | 'Ko-Host'; nama?: string; gaya?: string; teks: string }>;
}): Promise<{
  pcmBase64: string;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  usedProvider?: string;
}> {
  return postJson('/api/studio/podcast-audio', params);
}

export function generateStudioContent(params: {
  youtubeUrl?: string;
  localVideoId?: string;
  transcriptContextText?: string;
  type:
    | 'article'
    | 'thread'
    | 'quotes'
    | 'flashcards_quiz'
    | 'mindmap'
    | 'cornell'
    | 'factcheck'
    | 'compare'
    | 'podcast'
    | 'carousel'
    | 'sop';
  tone?: string;
  secondUrl?: string;
  hostName?: string;
  hostVoice?: GeminiVoiceName;
  coHostName?: string;
  coHostVoice?: GeminiVoiceName;
  platform?: string;
  mode: ModelMode;
  durationHint?: number;
}): Promise<{
  markdown?: string;
  tweets?: string[];
  quotes?: QuoteCardItem[];
  flashcards?: FlashcardItem[];
  kuis?: QuizQuestionItem[];
  mindmap?: MindMapNode;
  cornell?: CornellNotesData;
  factcheck?: FactCheckItem[];
  factcheckSources?: FactCheckWebSource[];
  compare?: VideoComparisonData;
  podcast?: PodcastData;
  carousel?: CarouselDeckData;
  sop?: SopGuideData;
}> {
  return postJson('/api/studio/generate', params);
}
