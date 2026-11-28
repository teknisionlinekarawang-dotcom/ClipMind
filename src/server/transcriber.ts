import fs from 'fs';
import path from 'path';
import type { HighlightItem, SummaryData, TranscriptSegment } from '../types.ts';
import {
  getLocalVideoRecord,
  registerUploadedLocalVideo,
  UPLOAD_DIR,
  type LocalVideoRecord,
} from './localVideo.ts';
import { extractYouTubeVideoId } from '../utils/youtube.ts';

const TRANSCRIBER_URL = (process.env.TRANSCRIBER_URL || 'http://127.0.0.1:8790').replace(
  /\/+$/,
  ''
);

/** Activekan pipeline Python? Default ON; matikan dengan USE_PY_TRANSCRIBE=false. */
export function transcriberEnabled(): boolean {
  return String(process.env.USE_PY_TRANSCRIBE || 'true').toLowerCase() !== 'false';
}

export interface PythonTranscribeResponse {
  segments: Array<{
    start: number;
    end: number;
    text: string;
    words?: Array<{ word: string; start: number; end: number }>;
  }>;
  language?: string;
  language_probability?: number;
  duration?: number;
  refined?: boolean;
  cached?: boolean;
}

/** Bangun body sumber (file lokal via path absolut, atau URL YouTube). */
function buildSourceBody(params: {
  youtubeUrl?: string;
  localVideoId?: string;
}): Record<string, unknown> {
  if (params.localVideoId) {
    const rec = getLocalVideoRecord(params.localVideoId);
    if (!rec || !fs.existsSync(rec.filePath)) {
      throw new Error('File video lokal tidak ditemukan di server untuk diproses Python.');
    }
    return { file_path: path.resolve(rec.filePath) };
  }
  if (params.youtubeUrl) {
    return { youtube_url: params.youtubeUrl };
  }
  throw new Error('Sumber video tidak valid untuk transkripsi.');
}

async function callTranscriber<T>(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs = 10 * 60 * 1000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${TRANSCRIBER_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`Layanan Python ${endpoint} gagal (${res.status}). ${txt.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Transkrip via faster-whisper (+ refine ejaan AI bila aktif) di Python. */
export async function pythonTranscribe(params: {
  youtubeUrl?: string;
  localVideoId?: string;
  startSec?: number;
  endSec?: number;
  language?: string;
  timeoutMs?: number;
}): Promise<PythonTranscribeResponse> {
  const body = {
    ...buildSourceBody(params),
    start_sec: params.startSec ?? 0,
    end_sec: params.endSec ?? null,
    language: params.language ?? null,
    word_timestamps: true,
  };
  return callTranscriber<PythonTranscribeResponse>('/transcribe', body, params.timeoutMs);
}

/** Ringkasan dibuat di Python (transkrip + AI). Node hanya proxy. */
export async function pythonSummary(params: {
  youtubeUrl?: string;
  localVideoId?: string;
  style?: string;
  length?: string;
  durationHint?: number;
  timeoutMs?: number;
}): Promise<SummaryData> {
  const body = {
    ...buildSourceBody(params),
    style: params.style || 'Santai',
    length: params.length || 'Sedang',
    duration_hint: params.durationHint ?? null,
  };
  return callTranscriber<SummaryData>('/summary', body, params.timeoutMs);
}

/** Highlight/klip dicari di Python (transkrip + AI). Node hanya proxy. */
export async function pythonHighlights(params: {
  youtubeUrl?: string;
  localVideoId?: string;
  focusQuery?: string;
  durationHint?: number;
  timeoutMs?: number;
}): Promise<HighlightItem[]> {
  const body = {
    ...buildSourceBody(params),
    focus_query: params.focusQuery ?? null,
    duration_hint: params.durationHint ?? null,
  };
  return callTranscriber<HighlightItem[]>('/highlights', body, params.timeoutMs);
}

// Cache: videoId YouTube -> localId rekaman yang sudah diunduh penuh (hindari unduh ulang).
const ytRecordCache = new Map<string, string>();

/**
 * Siapkan rekaman MP4 lokal dari URL YouTube (unduh penuh via Python), agar klip bisa
 * dirender ke MP4 memakai pipeline render yang sama seperti video lokal.
 */
export async function ensureYouTubeLocalRecord(youtubeUrl: string): Promise<LocalVideoRecord> {
  const vid = extractYouTubeVideoId(youtubeUrl);
  if (vid) {
    const cached = ytRecordCache.get(vid);
    if (cached) {
      const existing = getLocalVideoRecord(cached);
      if (existing) return existing;
    }
  }
  const localId = `local-yt-${vid || Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const destPath = path.resolve(path.join(UPLOAD_DIR, `${localId}.mp4`));
  const res = await callTranscriber<{ path: string; sizeBytes: number }>(
    '/download-video',
    { youtube_url: youtubeUrl, dest_path: destPath },
    10 * 60 * 1000
  );
  const filePath = res.path || destPath;
  if (!fs.existsSync(filePath)) {
    throw new Error('Video YouTube hasil unduhan tidak ditemukan di server.');
  }
  const record = await registerUploadedLocalVideo({
    localId,
    filePath,
    filename: `yt-${vid || 'video'}.mp4`,
    sizeBytes: res.sizeBytes || fs.statSync(filePath).size,
  });
  if (vid) ytRecordCache.set(vid, localId);
  return record;
}

/** Petakan hasil Whisper -> TranscriptSegment (kontrak ClipMind). Tanpa label pembicara. */
export function mapToTranscriptSegments(r: PythonTranscribeResponse): TranscriptSegment[] {
  return (r.segments || [])
    .map((s) => {
      const mulai = Math.max(0, Number(s.start) || 0);
      const selesai = Math.max(mulai + 0.2, Number(s.end) || mulai + 0.2);
      return {
        mulai: Number(mulai.toFixed(2)),
        selesai: Number(selesai.toFixed(2)),
        pembicara: '',
        teks: (s.text || '').trim(),
      };
    })
    .filter((s) => s.teks.length > 0);
}

/** Format transkrip jadi teks ber-timestamp (untuk konteks prompt AI di Node). */
export function transcriptToContext(segs: TranscriptSegment[], maxChars = 30000): string {
  const lines: string[] = [];
  let len = 0;
  for (const s of segs) {
    const mm = Math.floor(s.mulai / 60);
    const ss = Math.floor(s.mulai % 60);
    const line = `[${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}] ${s.teks}`;
    len += line.length + 1;
    if (len > maxChars) break;
    lines.push(line);
  }
  return lines.join('\n');
}
