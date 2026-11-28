import 'dotenv/config';
import { Type } from '@google/genai';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  extractRequestAIContext,
  generateMultiSpeakerPodcastAudio,
  generateTTSWithActiveProvider,
  generateWithActiveProvider,
  generateWithSearchGrounding,
  streamChatWithActiveProvider,
  testAIConnection,
  transcribeLocalAudioWithGemini,
} from './src/server/aiProvider.ts';
import {
  abortChunkedUpload,
  appendUploadChunk,
  extractLocalVideoThumbnail,
  finalizeChunkedUpload,
  getLocalVideoRecord,
  initChunkedUpload,
  registerUploadedLocalVideo,
  renderEditedClipMp4,
  UPLOAD_DIR,
} from './src/server/localVideo.ts';
import {
  buildCarouselPrompt,
  buildClipSubtitlePrompt,
  buildFactCheckWithSearchPrompt,
  buildHighlightsPrompt,
  buildPodcastPrompt,
  buildPreciseAudioTranscribePrompt,
  buildRetentionAuditPrompt,
  buildSopPrompt,
  buildSummaryPrompt,
  buildTranscriptPrompt,
  buildTranslateSubtitlesPrompt,
  buildVoiceOverScriptPrompt,
  CAROUSEL_SCHEMA,
  CLIP_METADATA_SCHEMA,
  COMPARE_SCHEMA,
  CORNELL_SCHEMA,
  HIGHLIGHTS_SCHEMA,
  mapGeminiError,
  MINDMAP_SCHEMA,
  PODCAST_SCHEMA,
  QUOTES_SCHEMA,
  RETENTION_AUDIT_SCHEMA,
  SOP_SCHEMA,
  STUDY_SCHEMA,
  SUBTITLE_SCHEMA,
  SUMMARY_SCHEMA,
  THUMBNAIL_IDEAS_SCHEMA,
  TRANSCRIPT_SCHEMA,
} from './src/server/geminiPrompts.ts';
import {
  clampSingleTimestamp,
  clampTimestamps,
  safeParseGeminiJson,
} from './src/utils/validators.ts';
import {
  ensureYouTubeLocalRecord,
  mapToTranscriptSegments,
  pythonHighlights,
  pythonSummary,
  pythonTranscribe,
  transcriberEnabled,
} from './src/server/transcriber.ts';
import { extractYouTubeVideoId, normalizeYouTubeUrl } from './src/utils/youtube.ts';
import type {
  AIProviderId,
  CarouselDeckData,
  Chapter,
  ClipMetadataData,
  ClipRetentionAuditData,
  CornellNotesData,
  FactCheckItem,
  GeminiVoiceName,
  HighlightItem,
  MindMapNode,
  ModelMode,
  PodcastData,
  QuoteCardItem,
  SopGuideData,
  SummaryData,
  SummaryLength,
  SummaryStyle,
  ThumbnailIdea,
  TranscriptMode,
  TranscriptSegment,
  VideoComparisonData,
  VirtualClip,
  VoiceOverTone,
} from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '30mb' }));

function validateUrlParam(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string') {
    throw new Error('URL YouTube wajib diisi.');
  }
  const videoId = extractYouTubeVideoId(rawUrl);
  if (!videoId) {
    throw new Error('Format URL YouTube tidak valid.');
  }
  return normalizeYouTubeUrl(videoId);
}

function resolveVideoSource(body: {
  youtubeUrl?: unknown;
  localVideoId?: unknown;
}): {
  youtubeUrls: string[];
  localVideoIds: string[];
  localVideoId?: string;
  youtubeUrl?: string;
} {
  if (
    typeof body.localVideoId === 'string' &&
    /^local-[a-zA-Z0-9_-]+$/.test(body.localVideoId)
  ) {
    return {
      youtubeUrls: [],
      localVideoIds: [body.localVideoId],
      localVideoId: body.localVideoId,
    };
  }
  const normalized = validateUrlParam(body.youtubeUrl);
  return {
    youtubeUrls: [normalized],
    localVideoIds: [],
    youtubeUrl: normalized,
  };
}

function getErrorSourceContext(body?: {
  localVideoId?: unknown;
  youtubeUrl?: unknown;
}): { sourceType?: 'youtube' | 'local' } {
  if (
    body &&
    typeof body.localVideoId === 'string' &&
    /^local-[a-zA-Z0-9_-]+$/.test(body.localVideoId)
  ) {
    return { sourceType: 'local' };
  }
  if (body && typeof body.youtubeUrl === 'string' && body.youtubeUrl.trim()) {
    return { sourceType: 'youtube' };
  }
  return {};
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, hasApiKey: Boolean(process.env.GEMINI_API_KEY) });
});

app.post('/api/ai/test', async (req, res) => {
  try {
    const body = req.body as {
      provider?: AIProviderId;
      apiKey?: string;
      model?: string;
      baseUrl?: string;
    };
    const ctx = extractRequestAIContext(req.headers, {
      provider: body.provider,
      apiKey: body.apiKey,
      model: body.model,
      baseUrl: body.baseUrl,
    });
    const result = await testAIConnection(ctx);
    res.json(result);
  } catch (err) {
    const mapped = mapGeminiError(err);
    res.status(mapped.status).json({ error: mapped.message });
  }
});

app.get('/api/youtube/oembed', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '');
    const videoId = extractYouTubeVideoId(rawUrl);
    if (!videoId) {
      res.status(400).json({ error: 'URL YouTube tidak valid.' });
      return;
    }
    const normalized = normalizeYouTubeUrl(videoId);
    const oembedRes = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(normalized)}&format=json`
    );
    if (!oembedRes.ok) {
      res.status(oembedRes.status).json({
        error:
          'Metadata video YouTube tidak dapat diakses (mungkin privat atau tidak tersedia).',
      });
      return;
    }
    const data = (await oembedRes.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    res.json({
      videoId,
      title: data.title || 'Video YouTube',
      author: data.author_name || '',
      thumbnailUrl:
        data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    });
  } catch (err) {
    const mapped = mapGeminiError(err);
    res.status(mapped.status).json({ error: mapped.message });
  }
});

app.get('/api/youtube/thumbnail', async (req, res) => {
  const videoId = String(req.query.videoId || '');
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    res.status(400).json({ error: 'videoId tidak valid.' });
    return;
  }
  const candidates = [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
  ];
  for (const url of candidates) {
    try {
      const upstream = await fetch(url);
      if (upstream.ok) {
        const arrayBuf = await upstream.arrayBuffer();
        res.setHeader(
          'Content-Type',
          upstream.headers.get('content-type') || 'image/jpeg'
        );
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.send(Buffer.from(arrayBuf));
        return;
      }
    } catch {
      // try fallback resolution
    }
  }
  res.status(404).json({ error: 'Thumbnail YouTube tidak ditemukan.' });
});

// Chunked Local MP4 Upload (bypasses Cloud Run 32MB per-request limit)
app.post('/api/local-video/upload/init', async (req, res) => {
  try {
    const { filename, sizeBytes } = req.body as {
      filename?: string;
      sizeBytes?: number;
    };
    const result = await initChunkedUpload(
      String(filename || 'video-lokal.mp4'),
      Number(sizeBytes || 0)
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Gagal memulai unggahan MP4.',
    });
  }
});

app.post('/api/local-video/upload/chunk/:localId', (req, res) => {
  const localId = String(req.params.localId || '');
  const offset = Number(req.headers['x-chunk-offset'] ?? 0);
  const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
  const chunks: Buffer[] = [];
  let chunkBytes = 0;
  let aborted = false;

  req.on('data', (chunk: Buffer) => {
    if (aborted) return;
    chunkBytes += chunk.length;
    if (chunkBytes > MAX_CHUNK_BYTES) {
      aborted = true;
      res.status(413).json({
        error: 'Potongan video melebihi batas maksimal 16 MB per permintaan.',
      });
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });

  req.on('end', async () => {
    if (aborted) return;
    try {
      const buf = Buffer.concat(chunks);
      const out = await appendUploadChunk(localId, offset, buf);
      res.json({ ok: true, receivedBytes: out.receivedBytes });
    } catch (err) {
      res.status(400).json({
        error:
          err instanceof Error ? err.message : 'Gagal menyimpan potongan video MP4.',
      });
    }
  });

  req.on('error', () => {
    if (!aborted && !res.headersSent) {
      res.status(500).json({ error: 'Koneksi terputus saat mengirim potongan video.' });
    }
  });
});

app.post('/api/local-video/upload/complete/:localId', async (req, res) => {
  const localId = String(req.params.localId || '');
  try {
    const record = await finalizeChunkedUpload(localId);
    res.json({
      localId: record.localId,
      filename: record.filename,
      durationSec: record.durationSec,
      width: record.width,
      height: record.height,
      hasAudio: record.hasAudio,
      sizeBytes: record.sizeBytes,
      geminiReady: record.geminiReady,
    });
  } catch (err) {
    await abortChunkedUpload(localId).catch(() => {});
    const mapped = mapGeminiError(err, { sourceType: 'local' });
    res.status(400).json({
      error:
        mapped.message ||
        'File bukan video MP4 yang valid atau tidak dapat dibaca.',
    });
  }
});

app.post('/api/local-video/upload/abort/:localId', async (req, res) => {
  const localId = String(req.params.localId || '');
  await abortChunkedUpload(localId).catch(() => {});
  res.json({ ok: true });
});

// Single-shot fallback Local MP4 Upload (small files / direct clients)
app.post('/api/local-video/upload', async (req, res) => {
  const MAX_BYTES = 300 * 1024 * 1024;
  const rawNameHeader = req.headers['x-file-name'];
  let originalName = 'video-lokal.mp4';
  if (typeof rawNameHeader === 'string' && rawNameHeader.trim()) {
    try {
      originalName = decodeURIComponent(rawNameHeader.trim());
    } catch {
      originalName = rawNameHeader.trim();
    }
  }
  originalName = path.basename(originalName).replace(/[^\w.\-\s()]/g, '_') || 'video-lokal.mp4';

  const localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const filePath = path.join(UPLOAD_DIR, `${localId}.mp4`);
  const writeStream = fs.createWriteStream(filePath);

  let receivedBytes = 0;
  let aborted = false;

  const cleanup = () => {
    fs.promises.unlink(filePath).catch(() => {});
  };

  req.on('data', (chunk: Buffer) => {
    if (aborted) return;
    receivedBytes += chunk.length;
    if (receivedBytes > MAX_BYTES) {
      aborted = true;
      writeStream.destroy();
      cleanup();
      res.status(413).json({
        error: 'Ukuran video MP4 melebihi batas maksimal 300 MB.',
      });
      req.destroy();
      return;
    }
    if (!writeStream.write(chunk)) {
      req.pause();
      writeStream.once('drain', () => req.resume());
    }
  });

  req.on('end', async () => {
    if (aborted) return;
    writeStream.end(async () => {
      try {
        if (receivedBytes < 1024) {
          cleanup();
          res.status(400).json({ error: 'File MP4 kosong atau terlalu kecil.' });
          return;
        }
        const record = await registerUploadedLocalVideo({
          localId,
          filePath,
          filename: originalName,
          sizeBytes: receivedBytes,
        });
        res.json({
          localId: record.localId,
          filename: record.filename,
          durationSec: record.durationSec,
          width: record.width,
          height: record.height,
          hasAudio: record.hasAudio,
          sizeBytes: record.sizeBytes,
          geminiReady: record.geminiReady,
        });
      } catch (err) {
        cleanup();
        const mapped = mapGeminiError(err, { sourceType: 'local' });
        res.status(400).json({
          error:
            mapped.message ||
            'File bukan video MP4 yang valid atau tidak dapat dibaca.',
        });
      }
    });
  });

  req.on('error', () => {
    if (aborted) return;
    aborted = true;
    writeStream.destroy();
    cleanup();
    if (!res.headersSent) {
      res.status(500).json({ error: 'Gagal menerima unggahan file MP4.' });
    }
  });
});

// Stream local MP4 with HTTP Range support for seeking
app.get('/api/local-video/stream/:localId', (req, res) => {
  const localId = String(req.params.localId || '');
  const record = getLocalVideoRecord(localId);
  if (!record || !fs.existsSync(record.filePath)) {
    res.status(404).json({ error: 'Video lokal tidak ditemukan.' });
    return;
  }
  const stat = fs.statSync(record.filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    if (Number.isNaN(start) || start >= fileSize || end >= fileSize) {
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }
    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });
    fs.createReadStream(record.filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(record.filePath).pipe(res);
  }
});

// Extract JPEG thumbnail from local MP4
app.get('/api/local-video/thumbnail/:localId', async (req, res) => {
  try {
    const localId = String(req.params.localId || '');
    const sec = Number(req.query.sec ?? 1);
    const buf = await extractLocalVideoThumbnail(
      localId,
      Number.isFinite(sec) ? sec : 1
    );
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.send(buf);
  } catch (err) {
    res.status(404).json({
      error: err instanceof Error ? err.message : 'Thumbnail lokal tidak tersedia.',
    });
  }
});

// Render & download edited clip as ready-to-reupload MP4
app.post('/api/local-video/export-mp4', async (req, res) => {
  let cleanupFiles: string[] = [];
  try {
    const {
      localVideoId,
      youtubeUrl,
      clip,
      burnSubtitles = true,
      includeVoiceOver = true,
    } = req.body as {
      localVideoId?: string;
      youtubeUrl?: string;
      clip: VirtualClip;
      burnSubtitles?: boolean;
      includeVoiceOver?: boolean;
    };

    // Sumber: video lokal yang sudah diunggah, ATAU URL YouTube (diunduh penuh via Python
    // lalu didaftarkan sbg rekaman lokal) supaya klip YouTube ikut bisa diekspor MP4.
    let sourceId = localVideoId;
    if (!sourceId && youtubeUrl) {
      try {
        const rec = await ensureYouTubeLocalRecord(String(youtubeUrl));
        sourceId = rec.localId;
      } catch (err) {
        res.status(502).json({
          error: `Gagal menyiapkan video YouTube untuk render: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
    }

    if (!sourceId || !clip) {
      res.status(400).json({ error: 'Parameter klip atau sumber video tidak lengkap.' });
      return;
    }

    const rendered = await renderEditedClipMp4({
      localId: sourceId,
      clip,
      burnSubtitles,
      includeVoiceOver,
    });
    cleanupFiles = rendered.cleanupFiles;

    const stat = await fs.promises.stat(rendered.outputPath);
    const safeName =
      (clip.judul || 'klip-clipmind')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'klip-clipmind';

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeName}-siap-upload.mp4"`
    );

    const stream = fs.createReadStream(rendered.outputPath);
    const doCleanup = () => {
      for (const f of cleanupFiles) {
        fs.promises.unlink(f).catch(() => {});
      }
    };
    res.on('finish', doCleanup);
    res.on('close', doCleanup);
    stream.on('error', doCleanup);
    stream.pipe(res);
  } catch (err) {
    for (const f of cleanupFiles) {
      fs.promises.unlink(f).catch(() => {});
    }
    const mapped = mapGeminiError(err, { sourceType: 'local' });
    res.status(mapped.status).json({
      error:
        mapped.message ||
        'Gagal merender video MP4. Periksa rentang waktu dan pengaturan klip.',
    });
  }
});

app.post('/api/analyze/summary', async (req, res) => {
  try {
    const {
      youtubeUrl,
      localVideoId,
      transcriptContextText,
      style = 'Santai',
      length = 'Sedang',
      mode = 'fast',
      durationHint,
    } = req.body as {
      youtubeUrl?: string;
      localVideoId?: string;
      transcriptContextText?: string;
      style?: SummaryStyle;
      length?: SummaryLength;
      mode?: ModelMode;
      durationHint?: number;
    };

    const src = resolveVideoSource({ youtubeUrl, localVideoId });

    // Jalur utama: ringkasan dibuat DI PYTHON (transkrip Whisper + AI), Node hanya proxy.
    if (transcriberEnabled()) {
      try {
        const summary = await pythonSummary({
          youtubeUrl: src.youtubeUrl,
          localVideoId: src.localVideoId,
          style,
          length,
          durationHint,
        });
        res.json(summary);
      } catch (err) {
        res.status(503).json({
          error: `Ringkasan (Python) gagal: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    // Fallback (hanya bila USE_PY_TRANSCRIBE=false): AI via Node seperti semula.
    const ctx = extractRequestAIContext(req.headers);
    const rawText = await generateWithActiveProvider({
      ctx,
      mode,
      durationHint,
      youtubeUrls: src.youtubeUrls,
      localVideoIds: src.localVideoIds,
      transcriptContextText,
      prompt: buildSummaryPrompt(style, length),
      responseSchema: SUMMARY_SCHEMA,
      expectJson: true,
    });

    const parsed = safeParseGeminiJson<SummaryData>(rawText || '{}');
    const maxDur =
      durationHint && durationHint > 0
        ? durationHint
        : parsed.durasi_total_detik > 0
        ? parsed.durasi_total_detik
        : 86400;

    const cleanSummary: SummaryData = {
      judul: parsed.judul || 'Ringkasan Video',
      tldr: parsed.tldr || '',
      poin_penting: (parsed.poin_penting || []).map((p) => ({
        teks: p.teks,
        detik: clampSingleTimestamp(p.detik, maxDur),
      })),
      bab: clampTimestamps<Chapter>(parsed.bab || [], maxDur),
      topik: Array.isArray(parsed.topik) ? parsed.topik : [],
      durasi_total_detik: parsed.durasi_total_detik || maxDur,
    };

    res.json(cleanSummary);
  } catch (err) {
    const mapped = mapGeminiError(err, getErrorSourceContext(req.body));
    res.status(mapped.status).json({ error: mapped.message });
  }
});

app.post('/api/analyze/highlights', async (req, res) => {
  try {
    const {
      youtubeUrl,
      localVideoId,
      transcriptContextText,
      focusQuery,
      mode = 'fast',
      durationHint,
    } = req.body as {
      youtubeUrl?: string;
      localVideoId?: string;
      transcriptContextText?: string;
      focusQuery?: string;
      mode?: ModelMode;
      durationHint?: number;
    };

    const src = resolveVideoSource({ youtubeUrl, localVideoId });

    // Jalur utama: highlight dicari DI PYTHON (transkrip Whisper + AI), Node hanya proxy.
    if (transcriberEnabled()) {
      try {
        const list = await pythonHighlights({
          youtubeUrl: src.youtubeUrl,
          localVideoId: src.localVideoId,
          focusQuery,
          durationHint,
        });
        res.json(list);
      } catch (err) {
        res.status(503).json({
          error: `Highlight (Python) gagal: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
      return;
    }

    // Fallback (hanya bila USE_PY_TRANSCRIBE=false): AI via Node seperti semula.
    const ctx = extractRequestAIContext(req.headers);
    const rawText = await generateWithActiveProvider({
      ctx,
      mode,
      durationHint,
      youtubeUrls: src.youtubeUrls,
      localVideoIds: src.localVideoIds,
      transcriptContextText,
      prompt: buildHighlightsPrompt(focusQuery),
      responseSchema: HIGHLIGHTS_SCHEMA,
      expectJson: true,
    });

    const parsed = safeParseGeminiJson<
      HighlightItem[] | { highlights?: HighlightItem[]; items?: HighlightItem[] }
    >(rawText || '[]');
    const list = Array.isArray(parsed)
      ? parsed
      : parsed.highlights ?? parsed.items ?? [];
    const maxDur = durationHint && durationHint > 0 ? durationHint : 86400;
    const cleaned = clampTimestamps(list, maxDur).sort(
      (a, b) => b.skor_viral - a.skor_viral
    );

    res.json(cleaned);
  } catch (err) {
    const mapped = mapGeminiError(err, getErrorSourceContext(req.body));
    res.status(mapped.status).json({ error: mapped.message });
  }
});

app.post('/api/analyze/transcript', async (req, res) => {
  try {
    const {
      youtubeUrl,
      localVideoId,
      startSec = 0,
      endSec = 600,
      transcriptMode = 'auto',
      narrationTone = 'Informatif',
      targetLanguage = 'Indonesia',
      mode = 'fast',
      durationHint,
    } = req.body as {
      youtubeUrl?: string;
      localVideoId?: string;
      startSec?: number;
      endSec?: number;
      transcriptMode?: TranscriptMode;
      narrationTone?: VoiceOverTone;
      targetLanguage?: string;
      mode?: ModelMode;
      durationHint?: number;
    };

    const src = resolveVideoSource({ youtubeUrl, localVideoId });

    // Jalur utama: transkripsi lokal via Python (faster-whisper).
    // Mode 'visual_narration' (membuat skrip narasi, bukan transkrip) tetap memakai AI.
    // Transkripsi SELALU via Python (faster-whisper) bila diaktifkan. Tidak ada fallback AI:
    // bila service mati, kembalikan error jelas agar user menyalakannya (bukan senyap ke AI).
    if (transcriberEnabled() && transcriptMode !== 'visual_narration') {
      try {
        const py = await pythonTranscribe({
          youtubeUrl: src.youtubeUrl,
          localVideoId: src.localVideoId,
          startSec,
          endSec,
        });
        const segs = mapToTranscriptSegments(py);
        const maxDur =
          durationHint && durationHint > 0
            ? durationHint
            : py.duration && py.duration > 0
            ? py.duration
            : Math.max(endSec, 86400);
        res.json(clampTimestamps(segs, maxDur));
      } catch (err) {
        const url = process.env.TRANSCRIBER_URL || 'http://127.0.0.1:8790';
        res.status(503).json({
          error:
            `Layanan transkripsi Python tidak dapat dihubungi (${url}). ` +
            `Jalankan: .\\transcriber\\run-transcriber.ps1 — lalu ulangi. ` +
            `(Detail: ${err instanceof Error ? err.message : String(err)})`,
        });
      }
      return;
    }

    const ctx = extractRequestAIContext(req.headers);

    let rawText = '';
    if (transcriptMode === 'precise_audio' && src.localVideoId) {
      rawText = await transcribeLocalAudioWithGemini({
        ctx,
        localVideoId: src.localVideoId,
        startSec,
        endSec,
        prompt: buildPreciseAudioTranscribePrompt(startSec, endSec, targetLanguage),
      });
    } else {
      rawText = await generateWithActiveProvider({
        ctx,
        mode,
        durationHint,
        youtubeUrls: src.youtubeUrls,
        localVideoIds: src.localVideoIds,
        prompt: buildTranscriptPrompt(
          startSec,
          endSec,
          transcriptMode,
          narrationTone,
          targetLanguage
        ),
        responseSchema: TRANSCRIPT_SCHEMA,
        expectJson: true,
      });
    }

    const parsed = safeParseGeminiJson<
      TranscriptSegment[] | { segments?: TranscriptSegment[]; transkrip?: TranscriptSegment[] }
    >(rawText || '[]');
    const list = Array.isArray(parsed)
      ? parsed
      : parsed.segments ?? parsed.transkrip ?? [];
    const maxDur =
      durationHint && durationHint > 0 ? durationHint : Math.max(endSec, 86400);
    const cleaned = clampTimestamps(list, maxDur);
    res.json(cleaned);
  } catch (err) {
    const mapped = mapGeminiError(err, getErrorSourceContext(req.body));
    res.status(mapped.status).json({ error: mapped.message });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const {
      youtubeUrl,
      localVideoId,
      transcriptContextText,
      messages,
      mode = 'fast',
      durationHint,
    } = req.body as {
      youtubeUrl?: string;
      localVideoId?: string;
      transcriptContextText?: string;
      messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      mode?: ModelMode;
      durationHint?: number;
    };

    const src = resolveVideoSource({ youtubeUrl, localVideoId });
    const ctx = extractRequestAIContext(req.headers);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    await streamChatWithActiveProvider({
      ctx,
      mode,
      durationHint,
      youtubeUrl: src.youtubeUrl,
      localVideoId: src.localVideoId,
      transcriptContextText,
      messages,
      systemInstruction:
        'Jawab dalam bahasa Indonesia hanya berdasarkan isi video. Setiap klaim harus disertai timestamp dalam format [MM:SS]. Jika informasi tidak ada di video, katakan terus terang.',
      onChunk: (text) => {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      },
    });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    const mapped = mapGeminiError(err, getErrorSourceContext(req.body));
    if (!res.headersSent) {
      res.status(mapped.status).json({ error: mapped.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: mapped.message })}\n\n`);
      res.end();
    }
  }
});

app.post('/api/clip/subtitles', async (req, res) => {
  try {
    const {
      youtubeUrl,
      localVideoId,
      transcriptContextText,
      clipStart,
      clipEnd,
      targetLanguage = 'Indonesia',
      existingLines,
      mode = 'fast',
      durationHint,
    } = req.body as {
      youtubeUrl?: string;
      localVideoId?: string;
      transcriptContextText?: string;
      clipStart: number;
      clipEnd: number;
      targetLanguage?: string;
      existingLines?: Array<{ id: string; mulai: number; selesai: number; teks: string }>;
      mode?: ModelMode;
      durationHint?: number;
    };

    const ctx = extractRequestAIContext(req.headers);
    const isTranslation = Array.isArray(existingLines) && existingLines.length > 0;
    const src = isTranslation
      ? { youtubeUrls: [], localVideoIds: [] }
      : resolveVideoSource({ youtubeUrl, localVideoId });

    const prompt = isTranslation
      ? buildTranslateSubtitlesPrompt(JSON.stringify(existingLines), targetLanguage)
      : buildClipSubtitlePrompt(clipStart, clipEnd, targetLanguage, true);

    const rawText = await generateWithActiveProvider({
      ctx,
      mode,
      durationHint,
      youtubeUrls: src.youtubeUrls,
      localVideoIds: src.localVideoIds,
      transcriptContextText,
      prompt,
      responseSchema: SUBTITLE_SCHEMA,
      expectJson: true,
    });

    const parsedRaw = safeParseGeminiJson<
      | Array<{
          mulai: number;
          selesai: number;
          teks: string;
          kata?: Array<{ kata: string; mulai: number; selesai: number }>;
        }>
      | {
          subtitles?: Array<{
            mulai: number;
            selesai: number;
            teks: string;
            kata?: Array<{ kata: string; mulai: number; selesai: number }>;
          }>;
        }
    >(rawText || '[]');
    const parsed = Array.isArray(parsedRaw) ? parsedRaw : parsedRaw.subtitles ?? [];

    const clipDur = Math.max(1, clipEnd - clipStart);
    const cleaned = parsed.map((line, i) => ({
      id: `sub-${Date.now()}-${i + 1}`,
      mulai: Math.max(0, Math.min(clipDur, Number(Number(line.mulai).toFixed(2)))),
      selesai: Math.max(
        0.2,
        Math.min(clipDur, Number(Number(line.selesai).toFixed(2)))
      ),
      teks: line.teks,
      kata: line.kata,
    }));

    res.json(cleaned);
  } catch (err) {
    const mapped = mapGeminiError(err, getErrorSourceContext(req.body));
    res.status(mapped.status).json({ error: mapped.message });
  }
});

app.post('/api/clip/voiceover-script', async (req, res) => {
  try {
    const {
      youtubeUrl,
      localVideoId,
      transcriptContextText,
      clipStart,
      clipEnd,
      tone = 'Informatif',
      targetLanguage = 'Indonesia',
      subtitleContext,
      mode = 'fast',
      durationHint,
    } = req.body as {
      youtubeUrl?: string;
      localVideoId?: string;
      transcriptContextText?: string;
      clipStart: number;
      clipEnd: number;
      tone?: VoiceOverTone;
      targetLanguage?: string;
      subtitleContext?: string;
      mode?: ModelMode;
      durationHint?: number;
    };

    const src = resolveVideoSource({ youtubeUrl, localVideoId });
    const ctx = extractRequestAIContext(req.headers);

    const text = await generateWithActiveProvider({
      ctx,
      mode,
      durationHint,
      youtubeUrls: src.youtubeUrls,
      localVideoIds: src.localVideoIds,
      transcriptContextText,
      prompt: buildVoiceOverScriptPrompt(
        clipStart,
        clipEnd,
        tone,
        targetLanguage,
        subtitleContext
      ),
      expectJson: false,
    });

    res.json({ naskah: text.trim() });
  } catch (err) {
    const mapped = mapGeminiError(err, getErrorSourceContext(req.body));
    res.status(mapped.status).json({ error: mapped.message });
  }
});

app.post('/api/clip/voiceover-audio', async (req, res) => {
  try {
    const {
      text,
      voiceName = 'Kore',
      speakingStyle = 'Jelas, ekspresif, dan natural',
    } = req.body as {
      text: string;
      voiceName?: string;
      speakingStyle?: string;
    };

    if (!text || !text.trim()) {
      res.status(400).json({ error: 'Naskah voice over tidak boleh kosong.' });
      return;
    }

    const ctx = extractRequestAIContext(req.headers);
    const result = await generateTTSWithActiveProvider({
      ctx,
      text,
      voiceName,
      speakingStyle,
    });

    res.json({
      pcmBase64: result.pcmBase64,
      sampleRate: 24000,
      channels: 1,
      bitsPerSample: 16,
      usedProvider: result.usedProvider,
    });
  } catch (err) {
    const mapped = mapGeminiError(err, { sourceType: 'tts' });
    res.status(mapped.status).json({ error: mapped.message });
  }
});

app.post('/api/clip/thumbnail-ideas', async (req, res) => {
  try {
    const {
      youtubeUrl,
      localVideoId,
      transcriptContextText,
      clipTitle,
      clipStart,
      clipEnd,
      mode = 'fast',
      durationHint,
    } = req.body as {
      youtubeUrl?: string;
      localVideoId?: string;
      transcriptContextText?: string;
      clipTitle: string;
      clipStart: number;
      clipEnd: number;
      mode?: ModelMode;
      durationHint?: number;
    };

    const src = resolveVideoSource({ youtubeUrl, localVideoId });
    const ctx = extractRequestAIContext(req.headers);

    const rawText = await generateWithActiveProvider({
      ctx,
      mode,
      durationHint,
      youtubeUrls: src.youtubeUrls,
      localVideoIds: src.localVideoIds,
      transcriptContextText,
      prompt: `Buatkan 5 ide judul dan konsep thumbnail dalam Bahasa Indonesia untuk klip "${clipTitle}" (detik ${clipStart}–${clipEnd}).
Aturan:
- "judul_klikbait_sehat": menarik rasa ingin tahu tapi jujur dan akurat terhadap isi klip.
- "teks_thumbnail": maksimal 4 kata singkat, kontras, dan kuat.
- "deskripsi_visual": deskripsi komposisi warna, ekspresi/objek utama, dan latar.
- "emosi": emosi utama yang ditonjolkan (mis. Penasaran, Terkejut, Terinspirasi, Tegas, Humor).`,
      responseSchema: THUMBNAIL_IDEAS_SCHEMA,
      expectJson: true,
    });

    const parsedRaw = safeParseGeminiJson<
      ThumbnailIdea[] | { ideas?: ThumbnailIdea[] }
    >(rawText || '[]');
    const ideas = Array.isArray(parsedRaw) ? parsedRaw : parsedRaw.ideas ?? [];
    res.json(ideas);
  } catch (err) {
    const mapped = mapGeminiError(err, getErrorSourceContext(req.body));
    res.status(mapped.status).json({ error: mapped.message });
  }
});

app.post('/api/clip/metadata', async (req, res) => {
  try {
    const {
      youtubeUrl,
      localVideoId,
      transcriptContextText,
      clipTitle,
      clipStart,
      clipEnd,
      mode = 'fast',
      durationHint,
    } = req.body as {
      youtubeUrl?: string;
      localVideoId?: string;
      transcriptContextText?: string;
      clipTitle: string;
      clipStart: number;
      clipEnd: number;
      mode?: ModelMode;
      durationHint?: number;
    };

    const src = resolveVideoSource({ youtubeUrl, localVideoId });
    const ctx = extractRequestAIContext(req.headers);

    const rawText = await generateWithActiveProvider({
      ctx,
      mode,
      durationHint,
      youtubeUrls: src.youtubeUrls,
      localVideoIds: src.localVideoIds,
      transcriptContextText,
      prompt: `Buatkan metadata lengkap dalam Bahasa Indonesia untuk klip "${clipTitle}" pada detik ${clipStart}–${clipEnd}:
- 3 opsi hook 3 detik pertama (teks pembuka yang langsung menghentikan scroll).
- Judul optimal masing-masing untuk YouTube Shorts, TikTok, Instagram Reels, dan X.
- Deskripsi ringkas klip.
- Tepat 10 hashtag relevan (tanpa spasi, awali dengan #).
- Caption siap posting masing-masing untuk Shorts, TikTok, Reels, dan X.`,
      responseSchema: CLIP_METADATA_SCHEMA,
      expectJson: true,
    });

    const meta = safeParseGeminiJson<ClipMetadataData>(rawText || '{}');
    res.json(meta);
  } catch (err) {
    const mapped = mapGeminiError(err, getErrorSourceContext(req.body));
    res.status(mapped.status).json({ error: mapped.message });
  }
});

app.post('/api/clip/retention-audit', async (req, res) => {
  try {
    const {
      youtubeUrl,
      localVideoId,
      transcriptContextText,
      clipTitle,
      clipStart,
      clipEnd,
      currentRatio = '16:9',
      subtitleContext,
      mode = 'fast',
      durationHint,
    } = req.body as {
      youtubeUrl?: string;
      localVideoId?: string;
      transcriptContextText?: string;
      clipTitle: string;
      clipStart: number;
      clipEnd: number;
      currentRatio?: string;
      subtitleContext?: string;
      mode?: ModelMode;
      durationHint?: number;
    };

    const src = resolveVideoSource({ youtubeUrl, localVideoId });
    const ctx = extractRequestAIContext(req.headers);

    const rawText = await generateWithActiveProvider({
      ctx,
      mode,
      durationHint,
      youtubeUrls: src.youtubeUrls,
      localVideoIds: src.localVideoIds,
      transcriptContextText,
      prompt: buildRetentionAuditPrompt({
        clipTitle,
        clipStart,
        clipEnd,
        currentRatio,
        subtitleContext,
      }),
      responseSchema: RETENTION_AUDIT_SCHEMA,
      expectJson: true,
    });

    const parsed = safeParseGeminiJson<ClipRetentionAuditData>(rawText || '{}');
    const clipDur = Math.max(1, clipEnd - clipStart);
    const cleanAudit: ClipRetentionAuditData = {
      skor_hook: Math.max(0, Math.min(100, Math.round(Number(parsed.skor_hook || 70)))),
      skor_retensi: Math.max(0, Math.min(100, Math.round(Number(parsed.skor_retensi || 70)))),
      skor_kejelasan: Math.max(0, Math.min(100, Math.round(Number(parsed.skor_kejelasan || 75)))),
      ringkasan_audit: parsed.ringkasan_audit || '',
      hook_teks_saran: parsed.hook_teks_saran || '',
      hook_visual_saran: parsed.hook_visual_saran || '',
      titik_rawan_skip: Array.isArray(parsed.titik_rawan_skip)
        ? parsed.titik_rawan_skip.map((item) => ({
            detik_relatif: clampSingleTimestamp(item.detik_relatif, clipDur),
            masalah: item.masalah,
            solusi: item.solusi,
          }))
        : [],
      rekomendasi_rasio: (['9:16', '16:9', '1:1', '4:5'].includes(parsed.rekomendasi_rasio)
        ? parsed.rekomendasi_rasio
        : '9:16') as ClipRetentionAuditData['rekomendasi_rasio'],
      rekomendasi_kecepatan: Math.max(
        0.5,
        Math.min(2, Number(parsed.rekomendasi_kecepatan || 1))
      ),
      cta_penutup: parsed.cta_penutup || '',
    };
    res.json(cleanAudit);
  } catch (err) {
    const mapped = mapGeminiError(err, getErrorSourceContext(req.body));
    res.status(mapped.status).json({ error: mapped.message });
  }
});

app.post('/api/studio/podcast-audio', async (req, res) => {
  try {
    const {
      hostName = 'Raka',
      hostVoice = 'Puck',
      coHostName = 'Sari',
      coHostVoice = 'Kore',
      dialog = [],
    } = req.body as {
      hostName?: string;
      hostVoice?: GeminiVoiceName;
      coHostName?: string;
      coHostVoice?: GeminiVoiceName;
      dialog: Array<{ pembicara: 'Host' | 'Ko-Host'; nama?: string; gaya?: string; teks: string }>;
    };

    const ctx = extractRequestAIContext(req.headers);
    const audio = await generateMultiSpeakerPodcastAudio({
      ctx,
      hostName,
      hostVoice,
      coHostName,
      coHostVoice,
      dialog,
    });

    res.json({
      pcmBase64: audio.pcmBase64,
      sampleRate: 24000,
      channels: 1,
      bitsPerSample: 16,
      usedProvider: audio.usedProvider,
    });
  } catch (err) {
    const mapped = mapGeminiError(err, { sourceType: 'tts' });
    res.status(mapped.status).json({ error: mapped.message });
  }
});

app.post('/api/studio/generate', async (req, res) => {
  try {
    const {
      youtubeUrl,
      localVideoId,
      transcriptContextText,
      type,
      tone = 'Informatif',
      secondUrl,
      hostName = 'Raka',
      hostVoice = 'Puck',
      coHostName = 'Sari',
      coHostVoice = 'Kore',
      platform = 'Instagram & LinkedIn',
      mode = 'fast',
      durationHint,
    } = req.body as {
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
      mode?: ModelMode;
      durationHint?: number;
    };

    const src = resolveVideoSource({ youtubeUrl, localVideoId });
    const ctx = extractRequestAIContext(req.headers);

    if (type === 'article') {
      const markdown = await generateWithActiveProvider({
        ctx,
        mode,
        durationHint,
        youtubeUrls: src.youtubeUrls,
        localVideoIds: src.localVideoIds,
        transcriptContextText,
        prompt: `Ubah isi video ini menjadi artikel blog berbahasa Indonesia yang terstruktur rapi dalam format Markdown.
Nada penulisan: ${tone}.
Struktur wajib: Judul utama (#), Paragraf pengantar (Intro), Subjudul-subjudul pembahasan (##) yang mendalam, dan Kesimpulan yang aplikatif.`,
        expectJson: false,
      });
      res.json({ markdown: markdown.trim() });
      return;
    }

    if (type === 'thread') {
      const rawText = await generateWithActiveProvider({
        ctx,
        mode,
        durationHint,
        youtubeUrls: src.youtubeUrls,
        localVideoIds: src.localVideoIds,
        transcriptContextText,
        prompt: `Buat thread X/Twitter berbahasa Indonesia sebanyak 8–10 tweet berdasarkan isi video ini.
Aturan wajib:
- Setiap tweet MAKSIMAL 260 karakter agar muat batas 280 karakter.
- Tweet pertama harus menjadi hook kuat.
- Kembalikan sebagai JSON array string murni.`,
        responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
        expectJson: true,
      });
      const parsed = safeParseGeminiJson<string[] | { tweets?: string[] }>(rawText || '[]');
      const tweets = Array.isArray(parsed) ? parsed : parsed.tweets ?? [];
      res.json({ tweets });
      return;
    }

    if (type === 'quotes') {
      const rawText = await generateWithActiveProvider({
        ctx,
        mode,
        durationHint,
        youtubeUrls: src.youtubeUrls,
        localVideoIds: src.localVideoIds,
        transcriptContextText,
        prompt: `Pilih 5 kutipan terbaik paling bermakna atau tajam dari video ini dalam Bahasa Indonesia, lengkap dengan nama/label pembicara dan detik (integer) terjadinya kutipan.`,
        responseSchema: QUOTES_SCHEMA,
        expectJson: true,
      });
      const parsed = safeParseGeminiJson<
        QuoteCardItem[] | { quotes?: QuoteCardItem[] }
      >(rawText || '[]');
      const quotes = Array.isArray(parsed) ? parsed : parsed.quotes ?? [];
      res.json({
        quotes: quotes.map((q) => ({
          ...q,
          detik: clampSingleTimestamp(q.detik, durationHint || 86400),
        })),
      });
      return;
    }

    if (type === 'flashcards_quiz') {
      const rawText = await generateWithActiveProvider({
        ctx,
        mode,
        durationHint,
        youtubeUrls: src.youtubeUrls,
        localVideoIds: src.localVideoIds,
        transcriptContextText,
        prompt: `Buat materi belajar dari video ini dalam Bahasa Indonesia:
- 10 flashcard (depan: pertanyaan/istilah singkat, belakang: jawaban jelas).
- 10 soal kuis pilihan ganda (masing-masing 4 pilihan jawaban, indeks jawabanBenar 0..3, dan penjelasan singkat).`,
        responseSchema: STUDY_SCHEMA,
        expectJson: true,
      });
      const study = safeParseGeminiJson(rawText || '{}');
      res.json(study);
      return;
    }

    if (type === 'mindmap') {
      const rawText = await generateWithActiveProvider({
        ctx,
        mode,
        durationHint,
        youtubeUrls: src.youtubeUrls,
        localVideoIds: src.localVideoIds,
        transcriptContextText,
        prompt: `Susun struktur mind map hierarkis (akar topik utama, 4–6 cabang utama, dan 2–4 sub-cabang per cabang) dalam Bahasa Indonesia dari video ini.`,
        responseSchema: MINDMAP_SCHEMA,
        expectJson: true,
      });
      const mindmap = safeParseGeminiJson<MindMapNode>(rawText || '{}');
      res.json({ mindmap });
      return;
    }

    if (type === 'cornell') {
      const rawText = await generateWithActiveProvider({
        ctx,
        mode,
        durationHint,
        youtubeUrls: src.youtubeUrls,
        localVideoIds: src.localVideoIds,
        transcriptContextText,
        prompt: `Buat catatan belajar metode Cornell dalam Bahasa Indonesia dari video ini:
- isyarat: daftar kata kunci / pertanyaan pemantik di kolom kiri (5–8 item).
- catatan: daftar penjelasan utama di kolom kanan yang selaras dengan isyarat.
- rangkuman: paragraf rangkuman sintetis di bagian bawah.`,
        responseSchema: CORNELL_SCHEMA,
        expectJson: true,
      });
      const cornell = safeParseGeminiJson<CornellNotesData>(rawText || '{}');
      res.json({ cornell });
      return;
    }

    if (type === 'factcheck') {
      const grounded = await generateWithSearchGrounding({
        ctx,
        mode,
        durationHint,
        youtubeUrls: src.youtubeUrls,
        localVideoIds: src.localVideoIds,
        transcriptContextText,
        prompt: buildFactCheckWithSearchPrompt(),
      });
      const parsed = safeParseGeminiJson<
        FactCheckItem[] | { factcheck?: FactCheckItem[] }
      >(grounded.text || '[]');
      const factcheck = Array.isArray(parsed) ? parsed : parsed.factcheck ?? [];
      res.json({
        factcheck: factcheck.map((f) => ({
          ...f,
          detik: clampSingleTimestamp(f.detik, durationHint || 86400),
        })),
        factcheckSources: grounded.sources,
      });
      return;
    }

    if (type === 'compare') {
      const normalizedSecond = validateUrlParam(secondUrl);
      const rawText = await generateWithActiveProvider({
        ctx,
        mode,
        durationHint,
        youtubeUrls: [...src.youtubeUrls, normalizedSecond],
        localVideoIds: src.localVideoIds,
        transcriptContextText,
        prompt: `Bandingkan dua video di atas (Video 1 adalah video utama yang sedang dianalisis, Video 2 adalah video pembanding) dalam Bahasa Indonesia.
Sertakan ringkasan perbandingan, kesimpulan video mana yang lebih padat/akurat, dan tabel perbandingan (aspek, video1, video2) minimal 5 aspek penting (Topik & Kedalaman, Kejelasan Penyampaian, Akurasi/Bukti, Gaya & Tempo, Rekomendasi Penonton).`,
        responseSchema: COMPARE_SCHEMA,
        expectJson: true,
      });
      const compare = safeParseGeminiJson<VideoComparisonData>(rawText || '{}');
      res.json({ compare });
      return;
    }

    if (type === 'podcast') {
      const rawText = await generateWithActiveProvider({
        ctx,
        mode,
        durationHint,
        youtubeUrls: src.youtubeUrls,
        localVideoIds: src.localVideoIds,
        transcriptContextText,
        prompt: buildPodcastPrompt({
          style: tone || 'Diskusi Santai & Analitis',
          hostName,
          coHostName,
        }),
        responseSchema: PODCAST_SCHEMA,
        expectJson: true,
      });
      const parsed = safeParseGeminiJson<Partial<PodcastData>>(rawText || '{}');
      const podcast: PodcastData = {
        judul: parsed.judul || 'Diskusi Podcast AI',
        ringkasan: parsed.ringkasan || '',
        gaya_diskusi: tone || 'Diskusi Santai & Analitis',
        hostNama: hostName,
        hostSuara: hostVoice,
        coHostNama: coHostName,
        coHostSuara: coHostVoice,
        dialog: Array.isArray(parsed.dialog)
          ? parsed.dialog.map((d) => ({
              pembicara: d.pembicara === 'Ko-Host' ? 'Ko-Host' : 'Host',
              nama: d.pembicara === 'Ko-Host' ? coHostName : hostName,
              gaya: d.gaya || 'Natural podcast delivery',
              teks: d.teks || '',
            }))
          : [],
      };
      res.json({ podcast });
      return;
    }

    if (type === 'carousel') {
      const rawText = await generateWithActiveProvider({
        ctx,
        mode,
        durationHint,
        youtubeUrls: src.youtubeUrls,
        localVideoIds: src.localVideoIds,
        transcriptContextText,
        prompt: buildCarouselPrompt(platform),
        responseSchema: CAROUSEL_SCHEMA,
        expectJson: true,
      });
      const carousel = safeParseGeminiJson<CarouselDeckData>(rawText || '{}');
      res.json({ carousel });
      return;
    }

    if (type === 'sop') {
      const rawText = await generateWithActiveProvider({
        ctx,
        mode,
        durationHint,
        youtubeUrls: src.youtubeUrls,
        localVideoIds: src.localVideoIds,
        transcriptContextText,
        prompt: buildSopPrompt(),
        responseSchema: SOP_SCHEMA,
        expectJson: true,
      });
      const parsed = safeParseGeminiJson<SopGuideData>(rawText || '{}');
      const sop: SopGuideData = {
        ...parsed,
        langkah: Array.isArray(parsed.langkah)
          ? parsed.langkah.map((step) => ({
              ...step,
              detik: clampSingleTimestamp(step.detik, durationHint || 86400),
            }))
          : [],
      };
      res.json({ sop });
      return;
    }

    res.status(400).json({ error: 'Jenis konten Studio tidak dikenal.' });
  } catch (err) {
    const mapped = mapGeminiError(err, getErrorSourceContext(req.body));
    res.status(mapped.status).json({ error: mapped.message });
  }
});

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`ClipMind server berjalan di http://localhost:${PORT}`);
  });
  server.requestTimeout = 10 * 60 * 1000;
  server.headersTimeout = 60 * 1000;
}

startServer();
