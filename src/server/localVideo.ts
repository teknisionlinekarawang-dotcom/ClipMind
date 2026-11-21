import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { promisify } from 'util';
import type { LocalVideoInfo, VirtualClip } from '../types.ts';
import { wrapPcmToWav } from '../utils/audio.ts';
import {
  buildAssSubtitleContent,
  buildAtempoFilters,
  buildAudioFadeFilters,
  buildVideoFilterChain,
  normalizeClipEditing,
} from '../utils/mp4Helpers.ts';
import { probeMp4BoxesFromFile } from '../utils/mp4Parser.ts';
import { getGeminiClientForContext, type RequestAIContext } from './aiProvider.ts';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

export function resolveFfmpegBin(): string {
  try {
    const p = require('ffmpeg-static') as string | null;
    if (p && fs.existsSync(p)) {
      try {
        fs.chmodSync(p, 0o755);
      } catch {
        // ignore chmod errors on read-only fs
      }
      return p;
    }
  } catch {
    // fallback to system PATH
  }
  return 'ffmpeg';
}

export function resolveFfprobeBin(): string {
  try {
    const mod = require('ffprobe-static') as { path?: string } | null;
    if (mod?.path && fs.existsSync(mod.path)) {
      try {
        fs.chmodSync(mod.path, 0o755);
      } catch {
        // ignore chmod errors on read-only fs
      }
      return mod.path;
    }
  } catch {
    // fallback to system PATH
  }
  return 'ffprobe';
}

export const UPLOAD_DIR = '/tmp/clipmind-uploads';
export const EXPORT_DIR = '/tmp/clipmind-exports';
export const CHUNK_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB per chunk (safe for Cloud Run 32 MB proxy cap)
export const MAX_UPLOAD_BYTES = 300 * 1024 * 1024; // 300 MB total
const MAX_LOCAL_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(EXPORT_DIR, { recursive: true });

export interface LocalVideoRecord extends LocalVideoInfo {
  filePath: string;
  createdAt: number;
  geminiFileUri?: string;
  geminiFileName?: string;
  geminiKeyHash?: string;
}

interface PendingUploadMeta {
  localId: string;
  filePath: string;
  metaPath: string;
  filename: string;
  sizeBytes: number;
  receivedBytes: number;
  createdAt: number;
}

const localVideoStore = new Map<string, LocalVideoRecord>();
const pendingUploads = new Map<string, PendingUploadMeta>();

function pruneStaleDirFiles(dir: string, cutoff: number) {
  fs.promises
    .readdir(dir)
    .then(async (entries) => {
      for (const name of entries) {
        const full = path.join(dir, name);
        try {
          const stat = await fs.promises.stat(full);
          if (stat.mtimeMs < cutoff) {
            await fs.promises.unlink(full).catch(() => {});
          }
        } catch {
          // ignore race
        }
      }
    })
    .catch(() => {});
}

export function cleanupExpiredLocalVideos() {
  const cutoff = Date.now() - MAX_LOCAL_TTL_MS;
  for (const [id, record] of localVideoStore.entries()) {
    if (record.createdAt < cutoff) {
      localVideoStore.delete(id);
      fs.promises.unlink(record.filePath).catch(() => {});
      fs.promises.unlink(path.join(UPLOAD_DIR, `${id}.meta.json`)).catch(() => {});
    }
  }
  for (const [id, pending] of pendingUploads.entries()) {
    if (pending.createdAt < cutoff) {
      pendingUploads.delete(id);
      fs.promises.unlink(pending.filePath).catch(() => {});
      fs.promises.unlink(pending.metaPath).catch(() => {});
    }
  }
  pruneStaleDirFiles(UPLOAD_DIR, cutoff);
  pruneStaleDirFiles(EXPORT_DIR, cutoff);
}

export function sanitizeLocalFilename(rawName: string): string {
  return path.basename(rawName || '').replace(/[^\w.\-\s()]/g, '_') || 'video-lokal.mp4';
}

export async function initChunkedUpload(
  rawFilename: string,
  sizeBytes: number
): Promise<{ localId: string; chunkSize: number }> {
  cleanupExpiredLocalVideos();
  if (!Number.isFinite(sizeBytes) || sizeBytes < 1024) {
    throw new Error('File MP4 kosong atau terlalu kecil.');
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    throw new Error('Ukuran video MP4 melebihi batas maksimal 300 MB.');
  }
  const filename = sanitizeLocalFilename(rawFilename);
  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const filePath = path.join(UPLOAD_DIR, `${localId}.mp4`);
  const metaPath = path.join(UPLOAD_DIR, `${localId}.upload.json`);

  await fs.promises.writeFile(filePath, Buffer.alloc(0));
  const meta: PendingUploadMeta = {
    localId,
    filePath,
    metaPath,
    filename,
    sizeBytes,
    receivedBytes: 0,
    createdAt: Date.now(),
  };
  pendingUploads.set(localId, meta);
  await fs.promises.writeFile(metaPath, JSON.stringify(meta), 'utf-8');

  return { localId, chunkSize: CHUNK_SIZE_BYTES };
}

async function getPendingUpload(localId: string): Promise<PendingUploadMeta | null> {
  if (!/^local-[a-zA-Z0-9_-]+$/.test(localId)) return null;
  const cached = pendingUploads.get(localId);
  if (cached) return cached;

  const metaPath = path.join(UPLOAD_DIR, `${localId}.upload.json`);
  try {
    const raw = await fs.promises.readFile(metaPath, 'utf-8');
    const parsed = JSON.parse(raw) as PendingUploadMeta;
    pendingUploads.set(localId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function appendUploadChunk(
  localId: string,
  offset: number,
  chunk: Buffer
): Promise<{ receivedBytes: number }> {
  const meta = await getPendingUpload(localId);
  if (!meta) {
    throw new Error('Sesi unggahan tidak ditemukan atau sudah kedaluwarsa.');
  }
  if (!Number.isFinite(offset) || offset < 0 || offset + chunk.length > MAX_UPLOAD_BYTES) {
    throw new Error('Offset potongan file tidak valid atau melebihi batas 300 MB.');
  }

  const handle = await fs.promises.open(meta.filePath, 'r+');
  try {
    await handle.write(chunk, 0, chunk.length, offset);
  } finally {
    await handle.close();
  }

  meta.receivedBytes = Math.max(meta.receivedBytes, offset + chunk.length);
  await fs.promises.writeFile(meta.metaPath, JSON.stringify(meta), 'utf-8').catch(() => {});
  return { receivedBytes: meta.receivedBytes };
}

export async function finalizeChunkedUpload(localId: string): Promise<LocalVideoRecord> {
  const meta = await getPendingUpload(localId);
  if (!meta || !fs.existsSync(meta.filePath)) {
    throw new Error('Berkas video MP4 belum selesai diunggah.');
  }
  pendingUploads.delete(localId);
  await fs.promises.unlink(meta.metaPath).catch(() => {});

  const stat = await fs.promises.stat(meta.filePath);
  if (stat.size < 1024) {
    await fs.promises.unlink(meta.filePath).catch(() => {});
    throw new Error('File MP4 kosong atau rusak.');
  }

  try {
    return await registerUploadedLocalVideo({
      localId: meta.localId,
      filePath: meta.filePath,
      filename: meta.filename,
      sizeBytes: stat.size,
    });
  } catch (err) {
    await fs.promises.unlink(meta.filePath).catch(() => {});
    throw err;
  }
}

export async function abortChunkedUpload(localId: string): Promise<void> {
  const meta = await getPendingUpload(localId);
  if (!meta) return;
  pendingUploads.delete(localId);
  await fs.promises.unlink(meta.filePath).catch(() => {});
  await fs.promises.unlink(meta.metaPath).catch(() => {});
}

export function getLocalVideoRecord(localId: string): LocalVideoRecord | undefined {
  if (!/^local-[a-zA-Z0-9_-]+$/.test(localId)) return undefined;
  const cached = localVideoStore.get(localId);
  if (cached) return cached;

  const metaPath = path.join(UPLOAD_DIR, `${localId}.meta.json`);
  try {
    if (fs.existsSync(metaPath)) {
      const parsed = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as LocalVideoRecord;
      if (parsed.filePath && fs.existsSync(parsed.filePath)) {
        localVideoStore.set(localId, parsed);
        return parsed;
      }
    }
  } catch {
    // ignore disk cache miss
  }
  return undefined;
}

export async function probeVideoFile(filePath: string): Promise<{
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
}> {
  try {
    const ffprobeBin = resolveFfprobeBin();
    const { stdout } = await execFileAsync(ffprobeBin, [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ]);
    const data = JSON.parse(stdout || '{}') as {
      format?: { duration?: string };
      streams?: Array<{
        codec_type?: string;
        width?: number;
        height?: number;
      }>;
    };
    const videoStream = data.streams?.find((s) => s.codec_type === 'video');
    const audioStream = data.streams?.find((s) => s.codec_type === 'audio');
    const durationNum = Number(data.format?.duration || 0);
    if (!videoStream) {
      throw new Error('File yang diunggah tidak memiliki stream video yang valid.');
    }
    return {
      durationSec: Math.max(1, Math.round(Number.isFinite(durationNum) ? durationNum : 1)),
      width: videoStream.width || 1280,
      height: videoStream.height || 720,
      hasAudio: Boolean(audioStream),
    };
  } catch (ffprobeErr) {
    // Fallback to pure-TS MP4 box parser if ffprobe binary is missing/unexecutable or returns no streams
    try {
      const boxMeta = await probeMp4BoxesFromFile(filePath);
      return {
        durationSec: boxMeta.durationSec,
        width: boxMeta.width,
        height: boxMeta.height,
        hasAudio: boxMeta.hasAudio,
      };
    } catch {
      throw ffprobeErr instanceof Error
        ? ffprobeErr
        : new Error('File yang diunggah tidak memiliki stream video MP4 yang valid.');
    }
  }
}

export async function registerUploadedLocalVideo(params: {
  localId: string;
  filePath: string;
  filename: string;
  sizeBytes: number;
}): Promise<LocalVideoRecord> {
  cleanupExpiredLocalVideos();
  const meta = await probeVideoFile(params.filePath);
  const record: LocalVideoRecord = {
    localId: params.localId,
    filePath: params.filePath,
    filename: params.filename,
    durationSec: meta.durationSec,
    width: meta.width,
    height: meta.height,
    hasAudio: meta.hasAudio,
    sizeBytes: params.sizeBytes,
    geminiReady: false,
    createdAt: Date.now(),
  };
  localVideoStore.set(params.localId, record);
  await fs.promises
    .writeFile(
      path.join(UPLOAD_DIR, `${params.localId}.meta.json`),
      JSON.stringify(record),
      'utf-8'
    )
    .catch(() => {});
  return record;
}

const inFlightGeminiUploads = new Map<
  string,
  Promise<{ fileUri: string; mimeType: string }>
>();

export function clearLocalVideoGeminiCache(localId: string): void {
  const record = getLocalVideoRecord(localId);
  if (record) {
    record.geminiFileUri = undefined;
    record.geminiFileName = undefined;
    record.geminiKeyHash = undefined;
    record.geminiReady = false;
  }
}

export async function ensureLocalVideoGeminiFile(
  localId: string,
  ctx?: Partial<RequestAIContext>
): Promise<{ fileUri: string; mimeType: string }> {
  const record = getLocalVideoRecord(localId);
  if (!record || !fs.existsSync(record.filePath)) {
    throw new Error(
      'File video MP4 lokal tidak ditemukan atau sesi telah berakhir. Silakan unggah ulang video MP4 Anda.'
    );
  }

  const effectiveKey =
    ctx?.apiKey?.trim() ||
    ctx?.geminiFallbackKey?.trim() ||
    process.env.GEMINI_API_KEY ||
    '';
  const keyHash = crypto.createHash('sha256').update(effectiveKey).digest('hex').slice(0, 12);

  if (record.geminiFileUri && record.geminiKeyHash === keyHash) {
    return { fileUri: record.geminiFileUri, mimeType: 'video/mp4' };
  }

  const flightKey = `${localId}:${keyHash}`;
  const existingFlight = inFlightGeminiUploads.get(flightKey);
  if (existingFlight) {
    return existingFlight;
  }

  const uploadPromise = (async () => {
    const ai = getGeminiClientForContext(ctx);
    const uploaded = await ai.files.upload({
      file: record.filePath,
      config: {
        mimeType: 'video/mp4',
        displayName: record.filename,
      },
    });

    if (!uploaded.name) {
      throw new Error('Gagal mengunggah video MP4 ke Gemini File API.');
    }

    let current = uploaded;
    const started = Date.now();
    while (current.state === 'PROCESSING') {
      if (Date.now() - started > 300000) {
        throw new Error('Pemrosesan file video oleh Gemini memakan waktu terlalu lama.');
      }
      await new Promise((r) => setTimeout(r, 2000));
      current = await ai.files.get({ name: uploaded.name });
    }

    if (current.state === 'FAILED' || !current.uri) {
      throw new Error('Gemini gagal memproses file video MP4 ini.');
    }

    record.geminiFileUri = current.uri;
    record.geminiFileName = current.name;
    record.geminiKeyHash = keyHash;
    record.geminiReady = true;

    return { fileUri: current.uri, mimeType: current.mimeType || 'video/mp4' };
  })();

  inFlightGeminiUploads.set(flightKey, uploadPromise);
  try {
    return await uploadPromise;
  } finally {
    inFlightGeminiUploads.delete(flightKey);
  }
}

export async function extractLocalVideoThumbnail(
  localId: string,
  atSec = 1
): Promise<Buffer> {
  const record = getLocalVideoRecord(localId);
  if (!record || !fs.existsSync(record.filePath)) {
    throw new Error('Video lokal tidak ditemukan.');
  }
  const safeSec = Math.max(0, Math.min(Math.max(0, record.durationSec - 1), atSec));
  const outPath = path.join(EXPORT_DIR, `thumb-${localId}-${Date.now()}.jpg`);
  try {
    await execFileAsync(resolveFfmpegBin(), [
      '-y',
      '-ss',
      String(safeSec),
      '-i',
      record.filePath,
      '-vframes',
      '1',
      '-q:v',
      '2',
      outPath,
    ]);
    return await fs.promises.readFile(outPath);
  } finally {
    fs.promises.unlink(outPath).catch(() => {});
  }
}

export async function extractLocalAudioSliceMp3(
  localId: string,
  startSec = 0,
  endSec = 600
): Promise<{ audioBase64: string; mimeType: string; actualStart: number; actualEnd: number }> {
  const record = getLocalVideoRecord(localId);
  if (!record || !fs.existsSync(record.filePath)) {
    throw new Error(
      'File video MP4 lokal tidak ditemukan di server. Silakan unggah ulang video MP4 Anda.'
    );
  }
  if (!record.hasAudio) {
    throw new Error(
      'Video MP4 ini tidak memiliki trek audio. Gunakan mode "Generate Transkrip Narasi" untuk membuat narasi otomatis dari visual.'
    );
  }

  const actualStart = Math.max(0, Math.floor(startSec));
  const actualEnd = Math.max(actualStart + 1, Math.min(record.durationSec, Math.ceil(endSec)));
  const span = Math.max(1, actualEnd - actualStart);
  const outPath = path.join(EXPORT_DIR, `audio-${localId}-${Date.now()}.mp3`);

  try {
    await execFileAsync(
      resolveFfmpegBin(),
      [
        '-y',
        '-ss',
        String(actualStart),
        '-t',
        String(span),
        '-i',
        record.filePath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-b:a',
        '48k',
        outPath,
      ],
      { timeout: 120000 }
    );
    const buf = await fs.promises.readFile(outPath);
    if (buf.length < 256) {
      throw new Error('Trek audio pada segmen ini kosong atau tidak dapat diekstrak.');
    }
    return {
      audioBase64: buf.toString('base64'),
      mimeType: 'audio/mp3',
      actualStart,
      actualEnd,
    };
  } finally {
    fs.promises.unlink(outPath).catch(() => {});
  }
}

export async function renderEditedClipMp4(params: {
  localId: string;
  clip: VirtualClip;
  burnSubtitles?: boolean;
  includeVoiceOver?: boolean;
}): Promise<{ outputPath: string; cleanupFiles: string[] }> {
  const { localId, clip, burnSubtitles = true, includeVoiceOver = true } = params;
  const record = getLocalVideoRecord(localId);
  if (!record || !fs.existsSync(record.filePath)) {
    throw new Error(
      'File video MP4 lokal tidak ditemukan di server. Silakan unggah ulang video MP4 Anda.'
    );
  }

  const jobId = `${localId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const outputPath = path.join(EXPORT_DIR, `clip-${jobId}.mp4`);
  const cleanupFiles: string[] = [outputPath];

  const startSec = Math.max(0, clip.mulai);
  const endSec = Math.max(startSec + 0.5, clip.selesai);
  const clipDuration = endSec - startSec;
  const ed = normalizeClipEditing(clip.editing);

  const initialPlan = buildVideoFilterChain({
    srcW: record.width,
    srcH: record.height,
    clip,
    clipDurationSec: clipDuration,
  });

  const shouldBurnSubs = burnSubtitles && ed.burnSubtitles && clip.subtitle.length > 0;
  let assPath: string | undefined;
  if (shouldBurnSubs) {
    assPath = path.join(EXPORT_DIR, `sub-${jobId}.ass`);
    const assContent = buildAssSubtitleContent(clip, initialPlan.outW, initialPlan.outH);
    await fs.promises.writeFile(assPath, assContent, 'utf-8');
    cleanupFiles.push(assPath);
  }

  const finalPlan = assPath
    ? buildVideoFilterChain({
        srcW: record.width,
        srcH: record.height,
        clip,
        clipDurationSec: clipDuration,
        assSubtitlePath: assPath,
      })
    : initialPlan;

  const vfStr = finalPlan.vfFilters.join(',');

  const hasVo = Boolean(
    includeVoiceOver && ed.includeVoiceOver && clip.naskahVO.audioBase64Pcm
  );
  let voPath: string | null = null;
  if (hasVo && clip.naskahVO.audioBase64Pcm) {
    voPath = path.join(EXPORT_DIR, `vo-${jobId}.wav`);
    const pcmBytes = Uint8Array.from(
      Buffer.from(clip.naskahVO.audioBase64Pcm, 'base64')
    );
    const wavBlob = wrapPcmToWav(pcmBytes, 24000, 1, 16);
    const wavBuf = Buffer.from(await wavBlob.arrayBuffer());
    await fs.promises.writeFile(voPath, wavBuf);
    cleanupFiles.push(voPath);
  }

  const hasOrigAudio = record.hasAudio && !ed.muteOriginal && ed.clipVolume > 0;
  const origFilters: string[] = [];
  if (hasOrigAudio) {
    const origVol = hasVo
      ? (Math.max(0, Math.min(100, clip.naskahVO.originalVolume ?? 20)) / 100) *
        (ed.clipVolume / 100)
      : ed.clipVolume / 100;
    if (Math.abs(origVol - 1) > 0.01) {
      origFilters.push(`volume=${origVol.toFixed(2)}`);
    }
    origFilters.push(...buildAtempoFilters(ed.speed));
  }
  const afades = buildAudioFadeFilters(
    finalPlan.outputDurationSec,
    ed.fadeInSec,
    ed.fadeOutSec
  );

  const args: string[] = [
    '-y',
    '-ss',
    String(startSec),
    '-t',
    String(clipDuration),
    '-i',
    record.filePath,
  ];

  if (voPath) {
    args.push('-i', voPath);
  }

  const outDurStr = Math.max(0.5, finalPlan.outputDurationSec).toFixed(2);

  if (voPath && hasOrigAudio) {
    const a0Chain = origFilters.length > 0 ? origFilters.join(',') : 'anull';
    const mixFilter =
      afades.length > 0
        ? `[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amixed];[amixed]${afades.join(',')}[aout]`
        : `[a0][a1]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`;
    args.push(
      '-filter_complex',
      `[0:v]${vfStr}[vout];[0:a]${a0Chain}[a0];[1:a]aresample=async=1,apad,atrim=0:${outDurStr}[a1];${mixFilter}`,
      '-map',
      '[vout]',
      '-map',
      '[aout]'
    );
  } else if (voPath && !hasOrigAudio) {
    const voChain =
      afades.length > 0
        ? `aresample=async=1,apad,atrim=0:${outDurStr},${afades.join(',')}`
        : `aresample=async=1,apad,atrim=0:${outDurStr}`;
    args.push(
      '-filter_complex',
      `[0:v]${vfStr}[vout];[1:a]${voChain}[aout]`,
      '-map',
      '[vout]',
      '-map',
      '[aout]'
    );
  } else if (!hasOrigAudio) {
    args.push('-vf', vfStr, '-an');
  } else {
    args.push('-vf', vfStr);
    const allAudioFilters = [...origFilters, ...afades];
    if (allAudioFilters.length > 0) {
      args.push('-af', allAudioFilters.join(','));
    }
  }

  const crf = ed.exportQuality === '1080p' ? '20' : '23';
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    crf,
    '-pix_fmt',
    'yuv420p'
  );

  if (voPath || hasOrigAudio) {
    args.push('-c:a', 'aac', '-b:a', '192k');
  }

  args.push('-movflags', '+faststart', outputPath);

  try {
    await execFileAsync(resolveFfmpegBin(), args, { timeout: 240000 });
    return { outputPath, cleanupFiles };
  } catch (err) {
    for (const f of cleanupFiles) {
      fs.promises.unlink(f).catch(() => {});
    }
    throw err;
  }
}
