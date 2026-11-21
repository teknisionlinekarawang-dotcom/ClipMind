import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractYouTubeVideoId,
  formatTimestamp,
  normalizeYouTubeUrl,
  parseTimestamp,
} from './youtube';
import {
  clampTimestamps,
  safeParseGeminiJson,
  validateClipRange,
} from './validators';
import {
  buildTimedSubtitlesFromScript,
  exportSummaryToMarkdown,
  exportToSrt,
  exportToVtt,
  generateClipSubtitlesFromTranscript,
  getActiveTranscriptSubtitle,
  splitSubtitleText,
} from './subtitles';
import {
  buildCarouselPrompt,
  buildFactCheckWithSearchPrompt,
  buildPodcastPrompt,
  buildPreciseAudioTranscribePrompt,
  buildRetentionAuditPrompt,
  buildSopPrompt,
  buildTranscriptPrompt,
  CAROUSEL_SCHEMA,
  mapGeminiError,
  PODCAST_SCHEMA,
  RETENTION_AUDIT_SCHEMA,
  SOP_SCHEMA,
} from '../server/geminiPrompts';
import { isWavHeaderPresent, wrapPcmToWav } from './audio';
import {
  buildProviderHeaders,
  createDefaultAISettings,
  maskApiKey,
  mergeStoredAISettings,
  validateProviderConfig,
} from './aiProviders';
import { buildZipBytes, crc32 } from './zip';
import {
  exportClipFfmpegGuide,
  exportClipMetadataMarkdown,
  exportSingleClipJson,
  sanitizeFileSlug,
} from './clipExport';
import {
  buildAssSubtitleContent,
  buildAtempoFilters,
  buildVideoFilterChain,
  computeCropPlan,
  computeEffectiveDimensions,
  getDefaultClipEditing,
  getVideoCssPreviewStyle,
  hexToAssColor,
  summarizeClipEdits,
} from './mp4Helpers';
import {
  abortChunkedUpload,
  appendUploadChunk,
  CHUNK_SIZE_BYTES,
  extractLocalAudioSliceMp3,
  initChunkedUpload,
  registerUploadedLocalVideo,
  resolveFfmpegBin,
  resolveFfprobeBin,
  sanitizeLocalFilename,
  UPLOAD_DIR,
} from '../server/localVideo';
import { probeMp4BoxesFromFile } from './mp4Parser';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { VirtualClip } from '../types';

test('extractYouTubeVideoId supports watch, youtu.be, shorts, live, and invalid URLs', () => {
  assert.equal(
    extractYouTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s'),
    'dQw4w9WgXcQ'
  );
  assert.equal(extractYouTubeVideoId('https://youtu.be/jNQXAC9IVRw?si=abc'), 'jNQXAC9IVRw');
  assert.equal(
    extractYouTubeVideoId('https://www.youtube.com/shorts/abcDEF12345'),
    'abcDEF12345'
  );
  assert.equal(
    extractYouTubeVideoId('https://youtube.com/live/xyz_9876543?feature=share'),
    'xyz_9876543'
  );
  assert.equal(extractYouTubeVideoId('https://vimeo.com/123456'), null);
  assert.equal(extractYouTubeVideoId('not a url'), null);
  assert.equal(normalizeYouTubeUrl('dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
});

test('formatTimestamp and parseTimestamp handle MM:SS and H:MM:SS', () => {
  assert.equal(formatTimestamp(0), '00:00');
  assert.equal(formatTimestamp(65), '01:05');
  assert.equal(formatTimestamp(3661), '1:01:01');
  assert.equal(parseTimestamp('01:05'), 65);
  assert.equal(parseTimestamp('1:01:01'), 3661);
  assert.equal(parseTimestamp('90'), 90);
  assert.equal(parseTimestamp('01:75'), null);
  assert.equal(parseTimestamp('abc'), null);
});

test('safeParseGeminiJson strips markdown fences and recovers JSON', () => {
  const raw = '```json\n{"judul": "Tes", "durasi": 120}\n```';
  const parsed = safeParseGeminiJson<{ judul: string; durasi: number }>(raw);
  assert.equal(parsed.judul, 'Tes');
  assert.equal(parsed.durasi, 120);

  const wrapped = 'Berikut hasilnya:\n[{"a": 1}]\nSemoga membantu.';
  const arr = safeParseGeminiJson<Array<{ a: number }>>(wrapped);
  assert.equal(arr[0].a, 1);
});

test('clampTimestamps clamps to 0..duration and fixes inverted ranges', () => {
  const items = [
    { mulai: -10, selesai: 400 },
    { mulai: 120, selesai: 80 },
    { mulai: 50, selesai: 50 },
  ];
  const clamped = clampTimestamps(items, 300);
  assert.deepEqual(clamped[0], { mulai: 0, selesai: 300 });
  assert.deepEqual(clamped[1], { mulai: 80, selesai: 120 });
  assert.deepEqual(clamped[2], { mulai: 50, selesai: 51 });
});

test('validateClipRange validates bounds properly', () => {
  assert.equal(validateClipRange(10, 30, 100).valid, true);
  assert.equal(validateClipRange(30, 10, 100).valid, false);
  assert.equal(validateClipRange(10, 120, 100).valid, false);
  assert.equal(validateClipRange(-1, 10, 100).valid, false);
});

test('subtitle splitting and SRT/VTT export format accurately', () => {
  const chunks = splitSubtitleText(
    'Ini adalah contoh kalimat panjang yang harus dipecah menjadi beberapa baris pendek yang nyaman dibaca penonton.',
    42,
    2
  );
  assert.ok(chunks.length >= 2);
  for (const chunk of chunks) {
    const lines = chunk.split('\n');
    assert.ok(lines.length <= 2);
    for (const line of lines) {
      assert.ok(line.length <= 42);
    }
  }

  const subs = generateClipSubtitlesFromTranscript(
    [{ mulai: 10, selesai: 20, pembicara: 'Host', teks: 'Halo semuanya selamat datang di video ini.' }],
    10,
    20
  );
  assert.equal(subs.length, 1);
  assert.equal(subs[0].mulai, 0);

  const srt = exportToSrt([{ id: '1', mulai: 1.5, selesai: 4.25, teks: 'Baris satu' }]);
  assert.match(srt, /00:00:01,500 --> 00:00:04,250/);

  const vtt = exportToVtt([{ id: '1', mulai: 1.5, selesai: 4.25, teks: 'Baris satu' }]);
  assert.match(vtt, /^WEBVTT/);
  assert.match(vtt, /00:00:01\.500 --> 00:00:04\.250/);

  const md = exportSummaryToMarkdown(
    {
      judul: 'Video Demo',
      tldr: 'Ringkasan singkat.',
      poin_penting: [{ teks: 'Poin A', detik: 15 }],
      bab: [{ judul: 'Pembuka', mulai: 0, selesai: 60, ringkasan: 'Intro' }],
      topik: ['AI'],
      durasi_total_detik: 120,
    },
    'https://www.youtube.com/watch?v=abc'
  );
  assert.match(md, /# Video Demo/);
  assert.match(md, /\[00:15\] Poin A/);
});

test('wrapPcmToWav builds valid 44-byte RIFF header around raw PCM bytes', async () => {
  const pcm = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
  const blob = wrapPcmToWav(pcm, 24000, 1, 16);
  const buf = new Uint8Array(await blob.arrayBuffer());
  assert.equal(buf.length, 48);
  assert.equal(isWavHeaderPresent(buf), true);
  const view = new DataView(buf.buffer);
  assert.equal(view.getUint32(4, true), 40); // 36 + 4
  assert.equal(view.getUint32(24, true), 24000); // sampleRate
  assert.equal(view.getUint16(34, true), 16); // bitsPerSample
  assert.equal(view.getUint32(40, true), 4); // dataSize
});

test('aiProviders defaults, merge, validation, masking, and headers work correctly', () => {
  const defaults = createDefaultAISettings();
  assert.equal(defaults.activeProvider, 'gemini');
  assert.equal(defaults.providers.nvidia.baseUrl, 'https://integrate.api.nvidia.com/v1');
  assert.equal(defaults.providers.openai.model, 'gpt-4o-mini');

  const merged = mergeStoredAISettings(
    JSON.stringify({
      activeProvider: 'nvidia',
      providers: {
        nvidia: { apiKey: 'nvapi-secret-1234', model: 'meta/llama-3.3-70b-instruct' },
      },
    })
  );
  assert.equal(merged.activeProvider, 'nvidia');
  assert.equal(merged.providers.nvidia.apiKey, 'nvapi-secret-1234');
  assert.equal(merged.providers.openai.model, 'gpt-4o-mini');

  assert.equal(validateProviderConfig(defaults.providers.gemini).valid, true);
  assert.equal(validateProviderConfig(defaults.providers.openai).valid, false);
  assert.equal(
    validateProviderConfig({
      ...defaults.providers.openai,
      apiKey: 'sk-test-123',
    }).valid,
    true
  );
  assert.equal(
    validateProviderConfig({
      ...defaults.providers.custom,
      apiKey: 'key-1',
      baseUrl: 'ftp://bad-url',
    }).valid,
    false
  );

  assert.equal(maskApiKey(''), 'Belum diisi');
  assert.equal(maskApiKey('sk-proj-abcdef1234'), 'sk-pro••••1234');

  const headers = buildProviderHeaders(merged);
  assert.equal(headers['x-ai-provider'], 'nvidia');
  assert.equal(headers['x-ai-api-key'], 'nvapi-secret-1234');
  assert.equal(headers['x-ai-base-url'], 'https://integrate.api.nvidia.com/v1');
});

test('buildZipBytes produces valid PKZIP headers, CRC32, and entry count', () => {
  const hello = new TextEncoder().encode('Halo ClipMind!');
  assert.equal(crc32(hello) >>> 0, crc32(hello));

  const zipBytes = buildZipBytes([
    { name: 'info.txt', data: 'Halo ClipMind!' },
    { name: 'bin.dat', data: new Uint8Array([1, 2, 3, 4]) },
  ]);

  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  // Local file header signature 0x04034b50
  assert.equal(view.getUint32(0, true), 0x04034b50);
  // End of central directory signature 0x06054b50 at tail - 22
  const eocdOffset = zipBytes.length - 22;
  assert.equal(view.getUint32(eocdOffset, true), 0x06054b50);
  assert.equal(view.getUint16(eocdOffset + 8, true), 2);
  assert.equal(view.getUint16(eocdOffset + 10, true), 2);
});

test('clipExport helpers format slug, markdown, ffmpeg command, and single clip JSON', () => {
  assert.equal(sanitizeFileSlug('Klip Viral #1: AI!'), 'klip-viral-1-ai');

  const sampleClip: VirtualClip = {
    id: 'clip-1',
    judul: 'Hook Utama AI',
    mulai: 12,
    selesai: 42,
    sumber: 'highlight',
    subtitle: [{ id: 'sub-1', mulai: 0, selesai: 3, teks: 'Halo dunia AI.' }],
    subtitleAppearance: {
      preset: 'bold',
      fontSize: 24,
      color: '#FFFFFF',
      position: 'bottom',
    },
    naskahVO: {
      naskah: 'Narasi pembuka singkat.',
      nada: 'Informatif',
      bahasa: 'Indonesia',
      suara: 'Kore',
      gayaBicara: 'Ceria',
      originalVolume: 20,
    },
    rasio: { rasio: '9:16', fokusX: 50 },
    thumbnail: {
      backgroundMode: 'gradient',
      gradientPalette: 'violet-blue',
      text: 'AI BARU',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 54,
      textColor: '#FFFFFF',
      strokeColor: '#0B0D12',
      shadowBlur: 12,
      textX: 0.5,
      textY: 0.78,
      darkOverlay: 0.3,
      sticker: '',
      stickerX: 0.85,
      stickerY: 0.2,
      aspectRatio: '16:9',
      ideas: [],
    },
  };

  const md = exportClipMetadataMarkdown(sampleClip, 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  assert.ok(md.includes('# Hook Utama AI'));
  assert.ok(md.includes('9:16'));
  assert.ok(md.includes('Narasi pembuka singkat.'));

  const ffmpeg = exportClipFfmpegGuide(sampleClip);
  assert.ok(ffmpeg.includes('ffmpeg -ss 12 -to 42'));
  assert.ok(ffmpeg.includes('crop=ih*9/16:ih'));
  assert.ok(ffmpeg.includes('subtitles=subtitle.srt'));

  const json = JSON.parse(
    exportSingleClipJson(sampleClip, 'https://www.youtube.com/watch?v=jNQXAC9IVRw', 'jNQXAC9IVRw')
  );
  assert.equal(json.videoId, 'jNQXAC9IVRw');
  assert.equal(json.clip.judul, 'Hook Utama AI');
});

test('mp4Helpers computes even crop plans, ASS colors, and ASS subtitle events', () => {
  const portraitCrop = computeCropPlan(1920, 1080, '9:16', 50);
  assert.equal(portraitCrop.outW, 1080);
  assert.equal(portraitCrop.outH, 1920);
  assert.equal(portraitCrop.cropH, 1080);
  assert.equal(portraitCrop.cropW % 2, 0);
  assert.ok(portraitCrop.cropW >= 606 && portraitCrop.cropW <= 610);
  assert.ok(portraitCrop.cropX > 600);

  const leftFocus = computeCropPlan(1920, 1080, '9:16', 0);
  assert.equal(leftFocus.cropX, 0);

  const squareCrop = computeCropPlan(1280, 720, '1:1', 100);
  assert.equal(squareCrop.outW, 1080);
  assert.equal(squareCrop.outH, 1080);
  assert.equal(squareCrop.cropW, 720);
  assert.equal(squareCrop.cropH, 720);
  assert.equal(squareCrop.cropX, 1280 - 720);

  assert.equal(hexToAssColor('#FF8800'), '&H000088FF');
  assert.equal(hexToAssColor('invalid'), '&H00FFFFFF');

  const assClip: VirtualClip = {
    id: 'clip-ass',
    judul: 'Sub Test',
    mulai: 2,
    selesai: 8,
    sumber: 'manual',
    subtitle: [
      {
        id: 's1',
        mulai: 0.5,
        selesai: 2.5,
        teks: 'Halo dunia',
        kata: [
          { kata: 'Halo', mulai: 0.5, selesai: 1.2 },
          { kata: 'dunia', mulai: 1.2, selesai: 2.5 },
        ],
      },
    ],
    subtitleAppearance: {
      preset: 'karaoke',
      fontSize: 22,
      color: '#FFFFFF',
      position: 'bottom',
    },
    naskahVO: {
      naskah: '',
      nada: 'Informatif',
      bahasa: 'Indonesia',
      suara: 'Kore',
      gayaBicara: 'Ceria',
      originalVolume: 20,
    },
    rasio: { rasio: '9:16', fokusX: 50 },
    thumbnail: {
      backgroundMode: 'youtube',
      gradientPalette: 'violet-blue',
      text: 'SUB',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 54,
      textColor: '#FFFFFF',
      strokeColor: '#0B0D12',
      shadowBlur: 12,
      textX: 0.5,
      textY: 0.78,
      darkOverlay: 0.3,
      sticker: '',
      stickerX: 0.85,
      stickerY: 0.2,
      aspectRatio: '16:9',
      ideas: [],
    },
  };

  const ass = buildAssSubtitleContent(assClip, 1080, 1920);
  assert.match(ass, /PlayResX: 1080/);
  assert.match(ass, /PlayResY: 1920/);
  assert.match(ass, /Dialogue: 0,0:00:00\.50,0:00:02\.50,Default,,0,0,0,,\{\\kf70\}Halo \{\\kf130\}dunia/);
});

test('chunked local MP4 upload initializes, stitches multi-offset chunks cleanly, and sanitizes filenames', async () => {
  assert.equal(CHUNK_SIZE_BYTES, 5 * 1024 * 1024);
  assert.equal(sanitizeLocalFilename('../../evil/my video (1)?.mp4'), 'my video (1)_.mp4');

  const part1 = Buffer.alloc(1024, 0x41);
  const part2 = Buffer.alloc(1024, 0x42);
  const totalSize = part1.length + part2.length;

  const { localId, chunkSize } = await initChunkedUpload('demo-chunked.mp4', totalSize);
  assert.ok(localId.startsWith('local-'));
  assert.equal(chunkSize, CHUNK_SIZE_BYTES);

  try {
    const r1 = await appendUploadChunk(localId, 0, part1);
    assert.equal(r1.receivedBytes, 1024);
    const r2 = await appendUploadChunk(localId, 1024, part2);
    assert.equal(r2.receivedBytes, 2048);

    const assembled = fs.readFileSync(path.join('/tmp/clipmind-uploads', `${localId}.mp4`));
    assert.equal(assembled.length, 2048);
    assert.deepEqual(assembled.subarray(0, 1024), part1);
    assert.deepEqual(assembled.subarray(1024, 2048), part2);
  } finally {
    await abortChunkedUpload(localId);
  }
});

test('bundled ffmpeg/ffprobe binaries resolve and pure-TS MP4 box parser extracts accurate metadata', async () => {
  const ffmpegBin = resolveFfmpegBin();
  const ffprobeBin = resolveFfprobeBin();
  assert.ok(fs.existsSync(ffmpegBin), `Expected bundled ffmpeg at ${ffmpegBin}`);
  assert.ok(fs.existsSync(ffprobeBin), `Expected bundled ffprobe at ${ffprobeBin}`);

  const tmpMp4 = `/tmp/test-mp4-parser-${Date.now()}.mp4`;
  const tmpBad = `/tmp/test-mp4-bad-${Date.now()}.mp4`;
  try {
    execFileSync(ffmpegBin, [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=24:duration=3',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      tmpMp4,
    ], { stdio: 'ignore' });

    const meta = await probeMp4BoxesFromFile(tmpMp4);
    assert.equal(meta.width, 640);
    assert.equal(meta.height, 360);
    assert.equal(meta.durationSec, 3);
    assert.equal(meta.hasVideo, true);
    assert.equal(meta.hasAudio, true);

    fs.writeFileSync(tmpBad, 'bukan file mp4 sama sekali hanya teks biasa');
    await assert.rejects(() => probeMp4BoxesFromFile(tmpBad));
  } finally {
    fs.promises.unlink(tmpMp4).catch(() => {});
    fs.promises.unlink(tmpBad).catch(() => {});
  }
});

test('narration script auto-converts to timed subtitles, live player captions, and visual narration prompt', () => {
  const script =
    'Kamera menyorot pemandangan pegunungan di pagi hari saat kabut perlahan menghilang dari lembah yang hijau.';
  const lines = buildTimedSubtitlesFromScript(script, 10, true);
  assert.ok(lines.length >= 2);
  assert.equal(lines[0].mulai, 0);
  assert.equal(lines[lines.length - 1].selesai, 10);
  assert.ok(lines[0].kata && lines[0].kata.length > 0);

  const segs = [
    {
      mulai: 0,
      selesai: 10,
      pembicara: 'Narator AI',
      teks: script,
    },
  ];
  const subStart = getActiveTranscriptSubtitle(segs, 1);
  assert.ok(subStart && subStart.text.length > 0);
  assert.ok(subStart.words.some((w) => w.active));

  const subOut = getActiveTranscriptSubtitle(segs, 25);
  assert.equal(subOut, null);

  const prompt = buildTranscriptPrompt(0, 60, 'visual_narration', 'Dramatis', 'Indonesia');
  assert.match(prompt, /Narator AI/);
  assert.match(prompt, /Dramatis/);
  assert.match(prompt, /Indonesia/);
});

test('pro video editing helpers compute orientation, zoom/fit crop, FFmpeg filter graph, and CSS preview', () => {
  assert.deepEqual(computeEffectiveDimensions(1920, 1080, 0), { width: 1920, height: 1080 });
  assert.deepEqual(computeEffectiveDimensions(1920, 1080, 90), { width: 1080, height: 1920 });
  assert.deepEqual(computeEffectiveDimensions(1280, 720, 270), { width: 720, height: 1280 });

  const fitCrop = computeCropPlan(1920, 1080, '9:16', 50, 50, 1, 'fit', '720p');
  assert.equal(fitCrop.outW, 720);
  assert.equal(fitCrop.outH, 1280);
  assert.equal(fitCrop.scaledW, 720);
  assert.equal(fitCrop.scaledH, 404);
  assert.ok(fitCrop.padY > 400);

  const zoomCrop = computeCropPlan(1920, 1080, '16:9', 100, 100, 2, 'fill', '1080p');
  assert.equal(zoomCrop.cropW, 960);
  assert.equal(zoomCrop.cropH, 540);
  assert.equal(zoomCrop.cropX, 960);
  assert.equal(zoomCrop.cropY, 540);

  assert.deepEqual(buildAtempoFilters(1), []);
  assert.deepEqual(buildAtempoFilters(1.5), ['atempo=1.500']);

  const proClip: VirtualClip = {
    id: 'clip-pro',
    judul: 'Klip Pro Edit',
    mulai: 2,
    selesai: 10,
    sumber: 'manual',
    subtitle: [{ id: 's1', mulai: 0, selesai: 3, teks: 'Tes pro edit' }],
    subtitleAppearance: {
      preset: 'bold',
      fontSize: 24,
      color: '#FFFFFF',
      position: 'bottom',
    },
    naskahVO: {
      naskah: '',
      nada: 'Informatif',
      bahasa: 'Indonesia',
      suara: 'Kore',
      gayaBicara: 'Ceria',
      originalVolume: 20,
    },
    rasio: { rasio: '9:16', fokusX: 60 },
    editing: {
      ...getDefaultClipEditing(),
      rotation: 90,
      flipH: true,
      zoom: 1.25,
      fokusY: 40,
      marginTop: 5,
      speed: 1.25,
      colorPreset: 'sinematik',
      brightness: -0.04,
      contrast: 1.18,
      saturation: 0.85,
      fadeInSec: 0.5,
      fadeOutSec: 0.5,
      exportQuality: '720p',
    },
    thumbnail: {
      backgroundMode: 'gradient',
      gradientPalette: 'violet-blue',
      text: 'PRO',
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 54,
      textColor: '#FFFFFF',
      strokeColor: '#0B0D12',
      shadowBlur: 12,
      textX: 0.5,
      textY: 0.78,
      darkOverlay: 0.3,
      sticker: '',
      stickerX: 0.85,
      stickerY: 0.2,
      aspectRatio: '9:16',
      ideas: [],
    },
  };

  const chain = buildVideoFilterChain({
    srcW: 1280,
    srcH: 720,
    clip: proClip,
    clipDurationSec: 8,
    assSubtitlePath: '/tmp/sub.ass',
  });
  const joined = chain.vfFilters.join(',');
  assert.equal(chain.outW, 720);
  assert.equal(chain.outH, 1280);
  assert.equal(chain.outputDurationSec, 6.4);
  assert.match(joined, /transpose=1/);
  assert.match(joined, /hflip/);
  assert.match(joined, /eq=brightness=-0\.04:contrast=1\.18:saturation=0\.85/);
  assert.match(joined, /ass=\/tmp\/sub\.ass/);
  assert.match(joined, /setpts=0\.8000\*PTS/);
  assert.match(joined, /fade=t=in:st=0:d=0\.50/);
  assert.match(joined, /fade=t=out:st=5\.90:d=0\.50/);

  const css = getVideoCssPreviewStyle(proClip);
  assert.match(css.transform || '', /rotate\(90deg\)/);
  assert.match(css.transform || '', /scale\(-1, 1\)/);
  assert.match(css.filter || '', /brightness\(0\.96\)/);
  assert.equal(css.objectPosition, '60% 40%');
  assert.equal(css.clipPath, 'inset(5% 0% 0% 0%)');

  const tags = summarizeClipEdits(proClip);
  assert.ok(tags.includes('Putar 90°'));
  assert.ok(tags.includes('1.25x'));
  assert.ok(tags.includes('720p'));

  const guide = exportClipFfmpegGuide(proClip);
  assert.match(guide, /transpose=1/);
  assert.match(guide, /atempo=1\.250/);
});

test('mapGeminiError never attributes local MP4 or TTS errors to YouTube access restrictions', () => {
  // Regression test: previously "message" matched "age" and returned the YouTube error for local/TTS requests
  const googleJsonErr = new Error(
    '{"error":{"code":400,"message":"Invalid JSON payload received in speechMetadata","status":"INVALID_ARGUMENT"}}'
  );
  const ttsMapped = mapGeminiError(googleJsonErr, { sourceType: 'tts' });
  assert.doesNotMatch(ttsMapped.message, /Video YouTube tidak dapat diakses/i);

  const tts503 = mapGeminiError(new Error('503 UNAVAILABLE'), { sourceType: 'tts' });
  assert.equal(tts503.status, 503);
  assert.doesNotMatch(tts503.message, /YouTube/i);

  const localNotFound = mapGeminiError(new Error('ENOENT file video MP4 lokal tidak ditemukan'), {
    sourceType: 'local',
  });
  assert.equal(localNotFound.status, 404);
  assert.match(localNotFound.message, /MP4 lokal/i);
  assert.doesNotMatch(localNotFound.message, /YouTube/i);

  const localAgeFalsePositive = mapGeminiError(new Error('Invalid language or message payload'), {
    sourceType: 'local',
  });
  assert.doesNotMatch(localAgeFalsePositive.message, /YouTube/i);

  const ytPrivate = mapGeminiError(new Error('Video unavailable or private'), {
    sourceType: 'youtube',
  });
  assert.equal(ytPrivate.status, 422);
  assert.match(ytPrivate.message, /Video YouTube tidak dapat diakses/i);
});

test('new AI feature prompt builders and response schemas define required Indonesian fields', () => {
  const podcastPrompt = buildPodcastPrompt({
    style: 'Santai & Menghibur',
    hostName: 'Raka',
    coHostName: 'Nadia',
  });
  assert.match(podcastPrompt, /Raka/);
  assert.match(podcastPrompt, /Nadia/);
  assert.match(podcastPrompt, /Ko-Host/);
  assert.ok(PODCAST_SCHEMA.required.includes('dialog'));

  const carouselPrompt = buildCarouselPrompt('LinkedIn');
  assert.match(carouselPrompt, /LinkedIn/);
  assert.ok(CAROUSEL_SCHEMA.required.includes('slides'));

  const sopPrompt = buildSopPrompt();
  assert.match(sopPrompt, /SOP Langkah-demi-Langkah/);
  assert.ok(SOP_SCHEMA.required.includes('langkah'));

  const retentionPrompt = buildRetentionAuditPrompt({
    clipTitle: 'Hook AI 2026',
    clipStart: 10,
    clipEnd: 40,
    currentRatio: '9:16',
    subtitleContext: 'Halo guys ini rahasianya.',
  });
  assert.match(retentionPrompt, /Hook AI 2026/);
  assert.match(retentionPrompt, /durasi 30 detik/);
  assert.match(retentionPrompt, /0\.\.30/);
  assert.ok(RETENTION_AUDIT_SCHEMA.required.includes('skor_hook'));
  assert.ok(RETENTION_AUDIT_SCHEMA.required.includes('titik_rawan_skip'));

  const factCheckPrompt = buildFactCheckWithSearchPrompt();
  assert.match(factCheckPrompt, /Google Search/);
  assert.match(factCheckPrompt, /status_web/);

  const preciseAudioPrompt = buildPreciseAudioTranscribePrompt(12, 42, 'Indonesia');
  assert.match(preciseAudioPrompt, /12/);
  assert.match(preciseAudioPrompt, /42/);
  assert.match(preciseAudioPrompt, /Indonesia/);
});

test('extractLocalAudioSliceMp3 extracts trimmed MP3 base64 from local MP4 and rejects silent MP4 cleanly', async () => {
  const ffmpegBin = resolveFfmpegBin();
  const ts = Date.now();
  const audioId = `local-testaudio-${ts}`;
  const silentId = `local-testsilent-${ts}`;
  const audioPath = path.join(UPLOAD_DIR, `${audioId}.mp4`);
  const silentPath = path.join(UPLOAD_DIR, `${silentId}.mp4`);
  const audioMeta = path.join(UPLOAD_DIR, `${audioId}.meta.json`);
  const silentMeta = path.join(UPLOAD_DIR, `${silentId}.meta.json`);

  try {
    execFileSync(
      ffmpegBin,
      [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=3',
        '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
        audioPath,
      ],
      { stdio: 'ignore' }
    );
    execFileSync(
      ffmpegBin,
      [
        '-y',
        '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=24:duration=2',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an',
        silentPath,
      ],
      { stdio: 'ignore' }
    );

    const audioStat = fs.statSync(audioPath);
    const silentStat = fs.statSync(silentPath);

    await registerUploadedLocalVideo({
      localId: audioId,
      filePath: audioPath,
      filename: 'test-audio.mp4',
      sizeBytes: audioStat.size,
    });
    await registerUploadedLocalVideo({
      localId: silentId,
      filePath: silentPath,
      filename: 'test-silent.mp4',
      sizeBytes: silentStat.size,
    });

    const slice = await extractLocalAudioSliceMp3(audioId, 0, 2);
    assert.equal(slice.mimeType, 'audio/mp3');
    assert.equal(slice.actualStart, 0);
    assert.equal(slice.actualEnd, 2);
    assert.ok(Buffer.from(slice.audioBase64, 'base64').length > 256);

    await assert.rejects(
      () => extractLocalAudioSliceMp3(silentId, 0, 2),
      (err: Error) => {
        assert.match(err.message, /tidak memiliki trek audio/i);
        assert.doesNotMatch(err.message, /YouTube/i);
        return true;
      }
    );
  } finally {
    fs.promises.unlink(audioPath).catch(() => {});
    fs.promises.unlink(silentPath).catch(() => {});
    fs.promises.unlink(audioMeta).catch(() => {});
    fs.promises.unlink(silentMeta).catch(() => {});
  }
});
