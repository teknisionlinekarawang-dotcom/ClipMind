import type { VirtualClip } from '../types';
import { base64ToUint8Array, wrapPcmToWav } from './audio';
import {
  buildAtempoFilters,
  buildAudioFadeFilters,
  normalizeClipEditing,
  summarizeClipEdits,
} from './mp4Helpers';
import { exportToSrt, exportToVtt } from './subtitles';
import { renderThumbnailPngBlob } from './thumbnailRenderer';
import { formatTimestamp } from './youtube';
import { buildZipBlob, type ZipEntryInput } from './zip';

export function sanitizeFileSlug(input: string, fallback = 'klip'): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  return cleaned || fallback;
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportClipMetadataMarkdown(
  clip: VirtualClip,
  youtubeUrl: string
): string {
  const lines: string[] = [];
  const duration = Math.max(1, clip.selesai - clip.mulai);
  const ed = normalizeClipEditing(clip.editing);

  lines.push(`# ${clip.judul}`);
  lines.push('');
  lines.push(`- **Sumber Video**: ${youtubeUrl || '-'}`);
  lines.push(
    `- **Rentang Klip**: ${formatTimestamp(clip.mulai)} – ${formatTimestamp(clip.selesai)} (${duration} detik)`
  );
  lines.push(`- **Sumber Pembuatan**: ${clip.sumber}`);
  lines.push(
    `- **Rasio & Fokus Reframe**: ${clip.rasio.rasio} (Fokus X ${clip.rasio.fokusX}%, Y ${ed.fokusY}%, Zoom ${ed.zoom.toFixed(1)}x, Mode ${ed.cropMode})`
  );
  lines.push(`- **Pengaturan Edit**: ${summarizeClipEdits(clip).join(' · ')}`);
  lines.push(
    `- **Gaya Subtitle**: ${clip.subtitleAppearance.preset}, ukuran ${clip.subtitleAppearance.fontSize}px, posisi ${clip.subtitleAppearance.position}`
  );
  lines.push('');

  if (clip.metadata) {
    lines.push('## 3 Opsi Hook 3 Detik Pertama');
    clip.metadata.hooks.forEach((h, i) => lines.push(`${i + 1}. ${h}`));
    lines.push('');
    lines.push('## Judul & Caption Siap Posting');
    lines.push(`### YouTube Shorts\n**${clip.metadata.judul_shorts}**\n${clip.metadata.caption_shorts}\n`);
    lines.push(`### TikTok\n**${clip.metadata.judul_tiktok}**\n${clip.metadata.caption_tiktok}\n`);
    lines.push(`### Instagram Reels\n**${clip.metadata.judul_reels}**\n${clip.metadata.caption_reels}\n`);
    lines.push(`### X / Twitter\n**${clip.metadata.judul_x}**\n${clip.metadata.caption_x}\n`);
    lines.push('## Deskripsi & Hashtag');
    lines.push(clip.metadata.deskripsi);
    lines.push('');
    lines.push(clip.metadata.hashtag.join(' '));
    lines.push('');
  }

  if (clip.naskahVO.naskah.trim()) {
    lines.push('## Naskah Voice Over');
    lines.push(
      `- Nada: ${clip.naskahVO.nada} | Bahasa: ${clip.naskahVO.bahasa} | Suara: ${clip.naskahVO.suara}`
    );
    lines.push('');
    lines.push(clip.naskahVO.naskah.trim());
    lines.push('');
  }

  if (clip.subtitle.length > 0) {
    lines.push('## Daftar Subtitle Klip');
    clip.subtitle.forEach((s) => {
      lines.push(`- [${s.mulai.toFixed(1)}s – ${s.selesai.toFixed(1)}s] ${s.teks}`);
    });
    lines.push('');
  }

  return lines.join('\n');
}

export function exportClipFfmpegGuide(clip: VirtualClip): string {
  const start = clip.mulai;
  const end = clip.selesai;
  const clipDuration = Math.max(0.5, end - start);
  const slug = sanitizeFileSlug(clip.judul);
  const ratio = clip.rasio.rasio;
  const focusXRatio = (clip.rasio.fokusX / 100).toFixed(2);
  const focusYRatio = (normalizeClipEditing(clip.editing).fokusY / 100).toFixed(2);
  const ed = normalizeClipEditing(clip.editing);

  const vfParts: string[] = [];

  if (ed.rotation === 90) vfParts.push('transpose=1');
  else if (ed.rotation === 180) vfParts.push('hflip,vflip');
  else if (ed.rotation === 270) vfParts.push('transpose=2');
  if (ed.flipH) vfParts.push('hflip');
  if (ed.flipV) vfParts.push('vflip');

  if (ed.marginTop > 0 || ed.marginBottom > 0 || ed.marginLeft > 0 || ed.marginRight > 0) {
    const wFrac = Math.max(0.3, 1 - (ed.marginLeft + ed.marginRight) / 100).toFixed(2);
    const hFrac = Math.max(0.3, 1 - (ed.marginTop + ed.marginBottom) / 100).toFixed(2);
    const xFrac = (ed.marginLeft / 100).toFixed(2);
    const yFrac = (ed.marginTop / 100).toFixed(2);
    vfParts.push(`crop=iw*${wFrac}:ih*${hFrac}:iw*${xFrac}:ih*${yFrac}`);
  }

  const outLong = ed.exportQuality === '720p' ? 1280 : 1920;
  const outShort = ed.exportQuality === '720p' ? 720 : 1080;
  const outFourFiveH = ed.exportQuality === '720p' ? 900 : 1350;

  if (ratio === '9:16') {
    if (ed.cropMode === 'fit') {
      vfParts.push(`scale=${outShort}:${outLong}:force_original_aspect_ratio=decrease,pad=${outShort}:${outLong}:(ow-iw)/2:(oh-ih)/2`);
    } else {
      vfParts.push(`crop=ih*9/16:ih:(iw-ih*9/16)*${focusXRatio}:0,scale=${outShort}:${outLong}`);
    }
  } else if (ratio === '1:1') {
    if (ed.cropMode === 'fit') {
      vfParts.push(`scale=${outShort}:${outShort}:force_original_aspect_ratio=decrease,pad=${outShort}:${outShort}:(ow-iw)/2:(oh-ih)/2`);
    } else {
      vfParts.push(`crop=ih:ih:(iw-ih)*${focusXRatio}:0,scale=${outShort}:${outShort}`);
    }
  } else if (ratio === '4:5') {
    if (ed.cropMode === 'fit') {
      vfParts.push(`scale=${outShort}:${outFourFiveH}:force_original_aspect_ratio=decrease,pad=${outShort}:${outFourFiveH}:(ow-iw)/2:(oh-ih)/2`);
    } else {
      vfParts.push(`crop=ih*4/5:ih:(iw-ih*4/5)*${focusXRatio}:0,scale=${outShort}:${outFourFiveH}`);
    }
  } else if (ed.zoom > 1.01) {
    const z = ed.zoom.toFixed(2);
    vfParts.push(`crop=iw/${z}:ih/${z}:(iw-iw/${z})*${focusXRatio}:(ih-ih/${z})*${focusYRatio},scale=${outLong}:${outShort}`);
  }

  if (Math.abs(ed.brightness) > 0.005 || Math.abs(ed.contrast - 1) > 0.005 || Math.abs(ed.saturation - 1) > 0.005) {
    vfParts.push(`eq=brightness=${ed.brightness.toFixed(2)}:contrast=${ed.contrast.toFixed(2)}:saturation=${ed.saturation.toFixed(2)}`);
  }

  if (ed.burnSubtitles && clip.subtitle.length > 0) {
    vfParts.push('subtitles=subtitle.srt');
  }

  const outDuration = clipDuration / ed.speed;
  if (Math.abs(ed.speed - 1) > 0.005) {
    vfParts.push(`setpts=${(1 / ed.speed).toFixed(4)}*PTS`);
  }
  if (ed.fadeInSec > 0.05) {
    vfParts.push(`fade=t=in:st=0:d=${ed.fadeInSec.toFixed(2)}`);
  }
  if (ed.fadeOutSec > 0.05) {
    vfParts.push(`fade=t=out:st=${Math.max(0, outDuration - ed.fadeOutSec).toFixed(2)}:d=${ed.fadeOutSec.toFixed(2)}`);
  }

  const vfArg = vfParts.length > 0 ? ` -vf "${vfParts.join(',')}"` : '';

  const hasVo = Boolean(ed.includeVoiceOver && clip.naskahVO.audioBase64Pcm);
  const atempoParts = buildAtempoFilters(ed.speed);
  const afadeParts = buildAudioFadeFilters(outDuration, ed.fadeInSec, ed.fadeOutSec);
  const origVol = hasVo
    ? ((clip.naskahVO.originalVolume / 100) * (ed.clipVolume / 100)).toFixed(2)
    : (ed.clipVolume / 100).toFixed(2);

  let cmd: string;
  if (ed.muteOriginal && !hasVo) {
    cmd = `ffmpeg -ss ${start} -to ${end} -i input.mp4${vfArg} -an -c:v libx264 ${slug}.mp4`;
  } else if (hasVo) {
    const a0Parts = [`volume=${origVol}`, ...atempoParts].join(',');
    cmd = `ffmpeg -ss ${start} -to ${end} -i input.mp4 -i voice-over.wav -filter_complex "[0:a]${a0Parts}[a0];[a0][1:a]amix=inputs=2:duration=first[aout]"${vfArg} -map 0:v -map "[aout]" -c:v libx264 -c:a aac ${slug}.mp4`;
  } else {
    const afList = [
      ...(Math.abs(Number(origVol) - 1) > 0.01 ? [`volume=${origVol}`] : []),
      ...atempoParts,
      ...afadeParts,
    ];
    const afArg = afList.length > 0 ? ` -af "${afList.join(',')}"` : '';
    cmd = `ffmpeg -ss ${start} -to ${end} -i input.mp4${vfArg}${afArg} -c:v libx264 -c:a aac ${slug}.mp4`;
  }

  return [
    `# Panduan Render Lokal FFmpeg untuk Klip "${clip.judul}"`,
    '# Gunakan hanya pada file video lokal milik Anda sendiri (input.mp4).',
    '# Pastikan file subtitle.srt / voice-over.wav dari paket ZIP berada di folder yang sama.',
    '',
    cmd,
    '',
  ].join('\n');
}

export function exportSingleClipJson(
  clip: VirtualClip,
  youtubeUrl: string,
  videoId: string | null
): string {
  const { audioBase64Pcm: _omitPcm, ...voWithoutRawPcm } = clip.naskahVO;
  return JSON.stringify(
    {
      videoId,
      youtubeUrl,
      exportedAt: new Date().toISOString(),
      clip: {
        ...clip,
        naskahVO: {
          ...voWithoutRawPcm,
          hasVoiceOverAudio: Boolean(clip.naskahVO.audioBase64Pcm),
        },
      },
    },
    null,
    2
  );
}

export async function buildEditedClipZip(
  clip: VirtualClip,
  youtubeUrl: string,
  videoId: string | null
): Promise<Blob> {
  const entries: ZipEntryInput[] = [
    {
      name: 'klip-info.json',
      data: exportSingleClipJson(clip, youtubeUrl, videoId),
    },
    {
      name: 'ringkasan-klip.md',
      data: exportClipMetadataMarkdown(clip, youtubeUrl),
    },
    {
      name: 'perintah-ffmpeg.txt',
      data: exportClipFfmpegGuide(clip),
    },
  ];

  if (clip.subtitle.length > 0) {
    entries.push({
      name: 'subtitle.srt',
      data: exportToSrt(clip.subtitle),
    });
    entries.push({
      name: 'subtitle.vtt',
      data: exportToVtt(clip.subtitle),
    });
  }

  if (clip.naskahVO.audioBase64Pcm) {
    const pcmBytes = base64ToUint8Array(clip.naskahVO.audioBase64Pcm);
    const wavBlob = wrapPcmToWav(pcmBytes, 24000, 1, 16);
    const wavBytes = new Uint8Array(await wavBlob.arrayBuffer());
    entries.push({
      name: 'voice-over.wav',
      data: wavBytes,
    });
  }

  const thumbBlob = await renderThumbnailPngBlob(clip.thumbnail, videoId);
  if (thumbBlob) {
    const pngBytes = new Uint8Array(await thumbBlob.arrayBuffer());
    entries.push({
      name: 'thumbnail.png',
      data: pngBytes,
    });
  }

  return buildZipBlob(entries);
}
