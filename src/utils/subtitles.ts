import type { SubtitleLine, SummaryData, TranscriptSegment } from '../types';
import { formatTimestamp } from './youtube';

export function splitSubtitleText(
  text: string,
  maxCharsPerLine = 42,
  maxLines = 2
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const chunks: string[] = [];
  let currentLines: string[] = [];
  let currentLine = '';

  const flushChunk = () => {
    if (currentLine) {
      currentLines.push(currentLine);
      currentLine = '';
    }
    if (currentLines.length > 0) {
      chunks.push(currentLines.join('\n'));
      currentLines = [];
    }
  };

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      currentLine = candidate;
    } else {
      if (currentLine) {
        currentLines.push(currentLine);
      }
      if (currentLines.length >= maxLines) {
        currentLine = '';
        chunks.push(currentLines.join('\n'));
        currentLines = [];
        currentLine = word;
      } else {
        currentLine = word;
      }
    }
  }
  flushChunk();

  return chunks;
}

export function generateClipSubtitlesFromTranscript(
  segments: TranscriptSegment[],
  clipStart: number,
  clipEnd: number
): SubtitleLine[] {
  const overlapping = segments.filter(
    (seg) => seg.selesai > clipStart && seg.mulai < clipEnd
  );
  const result: SubtitleLine[] = [];
  let idx = 1;

  for (const seg of overlapping) {
    const segStart = Math.max(clipStart, seg.mulai) - clipStart;
    const segEnd = Math.min(clipEnd, seg.selesai) - clipStart;
    const duration = Math.max(0.5, segEnd - segStart);
    const chunks = splitSubtitleText(seg.teks, 42, 2);

    if (chunks.length === 0) continue;
    const totalChars = chunks.reduce((acc, c) => acc + c.length, 0) || 1;
    let cursor = segStart;

    for (const chunk of chunks) {
      const share = (chunk.length / totalChars) * duration;
      const chunkEnd = Math.min(segEnd, Number((cursor + share).toFixed(2)));
      result.push({
        id: `sub-${idx++}`,
        mulai: Number(cursor.toFixed(2)),
        selesai: Math.max(Number((cursor + 0.4).toFixed(2)), chunkEnd),
        teks: chunk,
      });
      cursor = chunkEnd;
    }
  }

  return result;
}

function formatSrtTime(seconds: number, separator: ',' | '.'): string {
  const safe = Math.max(0, seconds);
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  const ms = Math.round((safe - Math.floor(safe)) * 1000) % 1000;
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');
  return `${pad2(hrs)}:${pad2(mins)}:${pad2(secs)}${separator}${pad3(ms)}`;
}

export function exportToSrt(lines: SubtitleLine[]): string {
  return lines
    .map((line, idx) => {
      return `${idx + 1}\n${formatSrtTime(line.mulai, ',')} --> ${formatSrtTime(line.selesai, ',')}\n${line.teks}`;
    })
    .join('\n\n');
}

export function exportToVtt(lines: SubtitleLine[]): string {
  const body = lines
    .map((line) => {
      return `${formatSrtTime(line.mulai, '.')} --> ${formatSrtTime(line.selesai, '.')}\n${line.teks}`;
    })
    .join('\n\n');
  return `WEBVTT\n\n${body}`;
}

export function exportTranscriptToTxt(segments: TranscriptSegment[]): string {
  return segments
    .map(
      (s) =>
        `[${formatTimestamp(s.mulai)} - ${formatTimestamp(s.selesai)}] ${s.pembicara}: ${s.teks}`
    )
    .join('\n');
}

export function exportSummaryToMarkdown(summary: SummaryData, videoUrl: string): string {
  const lines: string[] = [
    `# ${summary.judul}`,
    '',
    `Sumber: ${videoUrl}`,
    `Topik: ${summary.topik.join(', ')}`,
    '',
    '## TL;DR',
    summary.tldr,
    '',
    '## Poin Penting',
    ...summary.poin_penting.map((p) => `- [${formatTimestamp(p.detik)}] ${p.teks}`),
    '',
    '## Bab Pembahasan',
    ...summary.bab.flatMap((b) => [
      `### ${b.judul} (${formatTimestamp(b.mulai)} - ${formatTimestamp(b.selesai)})`,
      b.ringkasan,
      '',
    ]),
  ];
  return lines.join('\n');
}

export function buildTimedSubtitlesFromScript(
  script: string,
  clipDurationSec: number,
  includeWordTimings = true
): SubtitleLine[] {
  const clean = script.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const totalDur = Math.max(1, clipDurationSec);
  const chunks = splitSubtitleText(clean, 42, 2);
  if (chunks.length === 0) return [];

  const totalChars = chunks.reduce((acc, c) => acc + c.replace(/\s+/g, '').length, 0) || 1;
  const result: SubtitleLine[] = [];
  let cursor = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const weight = chunk.replace(/\s+/g, '').length || 1;
    const share = i === chunks.length - 1 ? totalDur - cursor : (weight / totalChars) * totalDur;
    const start = Number(cursor.toFixed(2));
    const end = Number(Math.min(totalDur, Math.max(start + 0.35, cursor + share)).toFixed(2));

    let kata: SubtitleLine['kata'];
    if (includeWordTimings) {
      const words = chunk.replace(/\n/g, ' ').split(/\s+/).filter(Boolean);
      const span = Math.max(0.2, end - start);
      const wordWeightSum = words.reduce((acc, w) => acc + w.length, 0) || 1;
      let wCursor = start;
      kata = words.map((w, wIdx) => {
        const wShare =
          wIdx === words.length - 1 ? end - wCursor : (w.length / wordWeightSum) * span;
        const wStart = Number(wCursor.toFixed(2));
        const wEnd = Number(Math.min(end, Math.max(wStart + 0.08, wCursor + wShare)).toFixed(2));
        wCursor = wEnd;
        return { kata: w, mulai: wStart, selesai: wEnd };
      });
    }

    result.push({
      id: `sub-nar-${i + 1}-${Date.now()}`,
      mulai: start,
      selesai: end,
      teks: chunk,
      ...(kata ? { kata } : {}),
    });
    cursor = end;
  }

  return result;
}

export function getActiveTranscriptSubtitle(
  segments: TranscriptSegment[],
  currentTimeSec: number
): { text: string; words: Array<{ kata: string; active: boolean }> } | null {
  if (!segments.length) return null;
  const seg = segments.find(
    (s) => currentTimeSec >= s.mulai && currentTimeSec <= s.selesai
  );
  if (!seg || !seg.teks.trim()) return null;

  const chunks = splitSubtitleText(seg.teks, 46, 2);
  if (chunks.length === 0) return null;

  const segDur = Math.max(0.5, seg.selesai - seg.mulai);
  const progress = Math.max(0, Math.min(0.999, (currentTimeSec - seg.mulai) / segDur));
  const chunkIdx = Math.min(chunks.length - 1, Math.floor(progress * chunks.length));
  const activeChunk = chunks[chunkIdx];

  const words = activeChunk.replace(/\n/g, ' ').split(/\s+/).filter(Boolean);
  const chunkStartRatio = chunkIdx / chunks.length;
  const chunkSpanRatio = 1 / chunks.length;
  const localRatio = Math.max(
    0,
    Math.min(1, (progress - chunkStartRatio) / Math.max(0.01, chunkSpanRatio))
  );
  const activeWordIdx = Math.min(words.length - 1, Math.floor(localRatio * words.length));

  return {
    text: activeChunk,
    words: words.map((w, i) => ({
      kata: w,
      active: i <= activeWordIdx,
    })),
  };
}

