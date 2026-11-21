import React, { useMemo, useState } from 'react';
import {
  Download,
  Languages,
  Loader2,
  Merge,
  Plus,
  Sparkles,
  Split,
  Trash2,
} from 'lucide-react';
import { serializeTranscriptContext, useClipMind } from '../../context/ClipMindContext';
import { generateOrTranslateSubtitles } from '../../services/geminiService';
import type { SubtitleLine, SubtitlePosition, SubtitleStylePreset } from '../../types';
import {
  exportToSrt,
  exportToVtt,
  generateClipSubtitlesFromTranscript,
} from '../../utils/subtitles';

const TARGET_LANGS = ['Indonesia', 'Inggris', 'Jepang', 'Korea', 'Arab', 'Spanyol'];
const PRESETS: Array<{ key: SubtitleStylePreset; label: string }> = [
  { key: 'minimalis', label: 'Minimalis' },
  { key: 'bold', label: 'Bold Shorts/TikTok' },
  { key: 'karaoke', label: 'Karaoke' },
  { key: 'kotak', label: 'Kotak Hitam' },
];

export function SubtitleSubTab() {
  const {
    youtubeUrl,
    localVideoId,
    modelMode,
    durationSec,
    transcript,
    selectedClip,
    updateClip,
    playRange,
  } = useClipMind();

  const [loading, setLoading] = useState(false);
  const [translatingLang, setTranslatingLang] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clipDur = useMemo(
    () => (selectedClip ? Math.max(1, selectedClip.selesai - selectedClip.mulai) : 1),
    [selectedClip]
  );

  if (!selectedClip) return null;

  const setLines = (lines: SubtitleLine[]) => {
    updateClip(selectedClip.id, { subtitle: lines });
  };

  const handleGenerateSubtitles = async (forceGemini = false) => {
    setError(null);
    // Use cached transcript if it covers this clip and user didn't force AI word-level timing
    if (!forceGemini && transcript.length > 0) {
      const fromCache = generateClipSubtitlesFromTranscript(
        transcript,
        selectedClip.mulai,
        selectedClip.selesai
      );
      if (fromCache.length > 0) {
        setLines(fromCache);
        return;
      }
    }

    setLoading(true);
    try {
      const lines = await generateOrTranslateSubtitles({
        youtubeUrl: youtubeUrl || undefined,
        localVideoId: localVideoId || undefined,
        transcriptContextText: serializeTranscriptContext(transcript),
        clipStart: selectedClip.mulai,
        clipEnd: selectedClip.selesai,
        targetLanguage: 'Indonesia',
        mode: modelMode,
        durationHint: durationSec,
      });
      setLines(lines);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat subtitle.');
    } finally {
      setLoading(false);
    }
  };

  const handleTranslate = async (lang: string) => {
    if (selectedClip.subtitle.length === 0) return;
    setError(null);
    setTranslatingLang(lang);
    try {
      const translated = await generateOrTranslateSubtitles({
        youtubeUrl: youtubeUrl || undefined,
        localVideoId: localVideoId || undefined,
        clipStart: selectedClip.mulai,
        clipEnd: selectedClip.selesai,
        targetLanguage: lang,
        existingLines: selectedClip.subtitle,
        mode: modelMode,
        durationHint: durationSec,
      });
      setLines(translated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menerjemahkan subtitle.');
    } finally {
      setTranslatingLang(null);
    }
  };

  const updateRow = (idx: number, patch: Partial<SubtitleLine>) => {
    const next = selectedClip.subtitle.map((line, i) =>
      i === idx ? { ...line, ...patch } : line
    );
    setLines(next);
  };

  const splitRow = (idx: number) => {
    const line = selectedClip.subtitle[idx];
    const midTime = Number(((line.mulai + line.selesai) / 2).toFixed(2));
    const words = line.teks.trim().split(/\s+/);
    const half = Math.max(1, Math.ceil(words.length / 2));
    const firstText = words.slice(0, half).join(' ');
    const secondText = words.slice(half).join(' ') || firstText;
    const copy = [...selectedClip.subtitle];
    copy.splice(
      idx,
      1,
      { id: `${line.id}-a`, mulai: line.mulai, selesai: midTime, teks: firstText },
      { id: `${line.id}-b`, mulai: midTime, selesai: line.selesai, teks: secondText }
    );
    setLines(copy);
  };

  const mergeWithNext = (idx: number) => {
    if (idx >= selectedClip.subtitle.length - 1) return;
    const curr = selectedClip.subtitle[idx];
    const next = selectedClip.subtitle[idx + 1];
    const copy = [...selectedClip.subtitle];
    copy.splice(idx, 2, {
      id: curr.id,
      mulai: curr.mulai,
      selesai: next.selesai,
      teks: `${curr.teks.replace(/\n/g, ' ')} ${next.teks.replace(/\n/g, ' ')}`.trim(),
    });
    setLines(copy);
  };

  const downloadSub = (format: 'srt' | 'vtt') => {
    const text =
      format === 'srt'
        ? exportToSrt(selectedClip.subtitle)
        : exportToVtt(selectedClip.subtitle);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedClip.judul.slice(0, 24).replace(/[^a-z0-9]/gi, '-')}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const app = selectedClip.subtitleAppearance;

  return (
    <div className="space-y-4">
      {/* Top Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => handleGenerateSubtitles(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            <span>Buat subtitle AI (Karaoke)</span>
          </button>

          {transcript.length > 0 && (
            <button
              type="button"
              onClick={() => handleGenerateSubtitles(false)}
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-200 hover:bg-white/[0.1] cursor-pointer whitespace-nowrap shrink-0"
            >
              Ambil dari Transkrip
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={selectedClip.subtitle.length === 0}
            onClick={() => downloadSub('srt')}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/[0.1] disabled:opacity-40 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span>.srt</span>
          </button>
          <button
            type="button"
            disabled={selectedClip.subtitle.length === 0}
            onClick={() => downloadSub('vtt')}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/[0.1] disabled:opacity-40 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span>.vtt</span>
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      )}

      {/* 1-Click Translation */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#0B0D12] p-2.5">
        <span className="inline-flex items-center gap-1 text-xs text-slate-400 mr-1">
          <Languages className="h-3.5 w-3.5" />
          <span>Terjemah 1 klik:</span>
        </span>
        {TARGET_LANGS.map((lang) => (
          <button
            key={lang}
            type="button"
            disabled={selectedClip.subtitle.length === 0 || Boolean(translatingLang)}
            onClick={() => handleTranslate(lang)}
            className="rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-200 hover:bg-white/[0.12] disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
          >
            {translatingLang === lang ? `${lang}…` : lang}
          </button>
        ))}
      </div>

      {/* Live Overlay Appearance Controls */}
      <div className="rounded-xl border border-white/[0.07] bg-[#0B0D12] p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-white">Gaya Overlay di Player</span>
          <button
            type="button"
            onClick={() => playRange(selectedClip.mulai, selectedClip.selesai)}
            className="text-xs font-medium text-violet-300 hover:text-violet-200 cursor-pointer"
          >
            Pratinjau klip dengan subtitle →
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() =>
                updateClip(selectedClip.id, {
                  subtitleAppearance: { ...app, preset: p.key },
                })
              }
              className={`rounded-md px-2.5 py-1 text-xs font-medium cursor-pointer whitespace-nowrap shrink-0 ${
                app.preset === p.key
                  ? 'bg-violet-600 text-white'
                  : 'bg-white/[0.05] text-slate-300 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <label className="space-y-1">
            <span className="block text-slate-400">Ukuran font ({app.fontSize}px)</span>
            <input
              type="range"
              min={14}
              max={34}
              value={app.fontSize}
              onChange={(e) =>
                updateClip(selectedClip.id, {
                  subtitleAppearance: { ...app, fontSize: Number(e.target.value) },
                })
              }
              className="w-full accent-violet-500"
            />
          </label>

          <label className="space-y-1">
            <span className="block text-slate-400">Warna teks</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={app.color}
                onChange={(e) =>
                  updateClip(selectedClip.id, {
                    subtitleAppearance: { ...app, color: e.target.value },
                  })
                }
                className="h-7 w-10 rounded bg-transparent cursor-pointer"
              />
              <span className="font-mono text-slate-300">{app.color}</span>
            </div>
          </label>

          <label className="space-y-1">
            <span className="block text-slate-400">Posisi</span>
            <select
              value={app.position}
              onChange={(e) =>
                updateClip(selectedClip.id, {
                  subtitleAppearance: {
                    ...app,
                    position: e.target.value as SubtitlePosition,
                  },
                })
              }
              className="w-full rounded-lg border border-white/10 bg-[#121620] px-2.5 py-1.5 text-xs text-white"
            >
              <option value="top">Atas</option>
              <option value="middle">Tengah</option>
              <option value="bottom">Bawah</option>
            </select>
          </label>
        </div>
      </div>

      {/* Subtitle Table Editor */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-white">
            Editor Baris Subtitle ({selectedClip.subtitle.length})
          </h4>
          <button
            type="button"
            onClick={() =>
              setLines([
                ...selectedClip.subtitle,
                {
                  id: `sub-${Date.now()}`,
                  mulai: 0,
                  selesai: Math.min(3, clipDur),
                  teks: 'Baris subtitle baru',
                },
              ])
            }
            className="inline-flex items-center gap-1 text-xs text-violet-300 hover:text-violet-200 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Tambah baris</span>
          </button>
        </div>

        {selectedClip.subtitle.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/10 p-4 text-center text-xs text-slate-400">
            Belum ada subtitle. Klik &ldquo;Buat subtitle AI (Karaoke)&rdquo; untuk membuat otomatis dari klip ini.
          </p>
        ) : (
          <div className="max-h-[260px] overflow-y-auto space-y-2 pr-1">
            {selectedClip.subtitle.map((line, idx) => (
              <div
                key={line.id}
                className="flex flex-wrap sm:flex-nowrap items-start gap-2 rounded-lg border border-white/[0.06] bg-[#0B0D12] p-2.5"
              >
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    max={clipDur}
                    aria-label={`Mulai baris ${idx + 1}`}
                    value={line.mulai}
                    onChange={(e) =>
                      updateRow(idx, { mulai: Math.max(0, Number(e.target.value)) })
                    }
                    className="w-14 rounded border border-white/10 bg-[#121620] px-1.5 py-1 font-mono text-xs text-white tabular-nums"
                  />
                  <span className="text-slate-500 text-xs">–</span>
                  <input
                    type="number"
                    step="0.5"
                    min={0}
                    max={clipDur}
                    aria-label={`Selesai baris ${idx + 1}`}
                    value={line.selesai}
                    onChange={(e) =>
                      updateRow(idx, { selesai: Math.min(clipDur, Number(e.target.value)) })
                    }
                    className="w-14 rounded border border-white/10 bg-[#121620] px-1.5 py-1 font-mono text-xs text-white tabular-nums"
                  />
                </div>

                <textarea
                  rows={2}
                  aria-label={`Teks subtitle baris ${idx + 1}`}
                  value={line.teks}
                  onChange={(e) => updateRow(idx, { teks: e.target.value })}
                  className="min-w-0 flex-1 rounded border border-white/10 bg-[#121620] px-2.5 py-1 text-xs text-white focus:border-violet-500 focus:outline-none"
                />

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    title="Pecah baris"
                    aria-label="Pecah baris"
                    onClick={() => splitRow(idx)}
                    className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer"
                  >
                    <Split className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Gabung dengan baris berikutnya"
                    aria-label="Gabung dengan baris berikutnya"
                    disabled={idx >= selectedClip.subtitle.length - 1}
                    onClick={() => mergeWithNext(idx)}
                    className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white disabled:opacity-30 cursor-pointer"
                  >
                    <Merge className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Hapus baris"
                    aria-label="Hapus baris"
                    onClick={() =>
                      setLines(selectedClip.subtitle.filter((_, i) => i !== idx))
                    }
                    className="rounded p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
