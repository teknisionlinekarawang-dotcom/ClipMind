import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Play,
  RefreshCw,
  Scissors,
} from 'lucide-react';
import { useClipMind } from '../../context/ClipMindContext';
import type { SummaryLength, SummaryStyle } from '../../types';
import { formatTimestamp } from '../../utils/youtube';
import { exportSummaryToMarkdown } from '../../utils/subtitles';
import { TimestampChip } from '../TimestampChip';

const STYLES: SummaryStyle[] = ['Santai', 'Akademis', 'Bahan Presentasi', 'Untuk Anak SMA'];
const LENGTHS: SummaryLength[] = ['Singkat', 'Sedang', 'Detail'];

export function SummaryTab() {
  const {
    youtubeUrl,
    summary,
    summaryStyle,
    summaryLength,
    summaryError,
    progress,
    currentTime,
    regenerateSummary,
    playRange,
    createClip,
  } = useClipMind();

  const [followVideo, setFollowVideo] = useState(true);
  const [openChapters, setOpenChapters] = useState<Record<number, boolean>>({ 0: true });
  const [copied, setCopied] = useState(false);
  const chapterRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const activeChapterIdx =
    summary?.bab.findIndex(
      (b) => currentTime >= b.mulai && currentTime <= b.selesai
    ) ?? -1;

  useEffect(() => {
    if (!followVideo || activeChapterIdx < 0) return;
    setOpenChapters((prev) => ({ ...prev, [activeChapterIdx]: true }));
    chapterRefs.current[activeChapterIdx]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [activeChapterIdx, followVideo]);

  const toggleChapter = (idx: number) => {
    setOpenChapters((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const handleCopyMarkdown = () => {
    if (!summary) return;
    const md = exportSummaryToMarkdown(summary, youtubeUrl);
    navigator.clipboard.writeText(md);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadMarkdown = () => {
    if (!summary) return;
    const md = exportSummaryToMarkdown(summary, youtubeUrl);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ringkasan-${summary.judul.slice(0, 30).replace(/[^a-z0-9]/gi, '-')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (progress.summary === 'loading' && !summary) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Memuat ringkasan video">
        <p className="text-xs text-slate-400">Menyusun TL;DR, poin penting, dan bab pembahasan…</p>
        <div className="h-24 rounded-xl bg-white/[0.04] animate-pulse" />
        <div className="h-36 rounded-xl bg-white/[0.04] animate-pulse" />
        <div className="h-44 rounded-xl bg-white/[0.04] animate-pulse" />
      </div>
    );
  }

  if (summaryError && !summary) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 space-y-3">
        <p className="text-sm font-medium text-rose-200">{summaryError}</p>
        <button
          type="button"
          onClick={() => regenerateSummary()}
          className="inline-flex items-center gap-2 rounded-lg bg-rose-500/20 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500/30 cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Coba lagi</span>
        </button>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-400">
        Tempel URL YouTube di atas lalu klik Analisis Video untuk melihat ringkasan, poin penting, dan bab video.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Live sync "Sedang menonton" banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-[#0B0D12] px-3.5 py-2.5">
        <div className="min-w-0 flex-1">
          <span className="text-[11px] font-medium text-slate-400">Sedang menonton: </span>
          <span className="text-xs font-semibold text-white truncate">
            {activeChapterIdx >= 0
              ? summary.bab[activeChapterIdx].judul
              : 'Di luar segmen bab'}
          </span>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={followVideo}
            onChange={(e) => setFollowVideo(e.target.checked)}
            className="accent-violet-500 rounded"
          />
          <span>Ikuti video</span>
        </label>
      </div>

      {/* Style & Length Controls + Export Markdown */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            aria-label="Gaya ringkasan"
            className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-[#0B0D12] p-1 border border-white/[0.08]"
          >
            {STYLES.map((st) => (
              <button
                key={st}
                type="button"
                disabled={progress.summary === 'loading'}
                onClick={() => regenerateSummary(st, summaryLength)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  summaryStyle === st
                    ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <div
            role="group"
            aria-label="Panjang ringkasan"
            className="inline-flex items-center gap-1 rounded-lg bg-[#0B0D12] p-1 border border-white/[0.08]"
          >
            {LENGTHS.map((len) => (
              <button
                key={len}
                type="button"
                disabled={progress.summary === 'loading'}
                onClick={() => regenerateSummary(summaryStyle, len)}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  summaryLength === len
                    ? 'bg-white/15 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {len}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopyMarkdown}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/[0.1] whitespace-nowrap shrink-0 cursor-pointer"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            <span>{copied ? 'Tersalin' : 'Salin .md'}</span>
          </button>
          <button
            type="button"
            onClick={handleDownloadMarkdown}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/[0.1] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Unduh .md</span>
          </button>
        </div>
      </div>

      {progress.summary === 'loading' && (
        <p className="text-xs text-violet-300">{progress.stepText}</p>
      )}
      {summaryError && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          <span>{summaryError}</span>
          <button
            type="button"
            onClick={() => regenerateSummary()}
            className="underline font-semibold cursor-pointer"
          >
            Coba lagi
          </button>
        </div>
      )}

      {/* TL;DR Card */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0B0D12]/80 p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-display text-sm font-semibold text-white">Ringkasan Inti (TL;DR)</h3>
          <span className="text-xs text-slate-400 truncate">
            {summary.topik.slice(0, 5).join(' · ')}
          </span>
        </div>
        <p className="text-sm leading-relaxed text-slate-200">{summary.tldr}</p>
      </div>

      {/* Key Points */}
      <div className="space-y-2.5">
        <h3 className="font-display text-sm font-semibold text-white">Poin Penting</h3>
        <ul className="space-y-2">
          {summary.poin_penting.map((poin, idx) => (
            <li
              key={idx}
              className="flex items-start gap-2.5 rounded-lg border border-white/[0.06] bg-[#0B0D12]/50 p-3 text-sm text-slate-200"
            >
              <TimestampChip seconds={poin.detik} />
              <span className="leading-relaxed">{poin.teks}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Chapter Accordion */}
      <div className="space-y-2.5">
        <h3 className="font-display text-sm font-semibold text-white">
          Bab Pembahasan ({summary.bab.length})
        </h3>
        <div className="space-y-2">
          {summary.bab.map((bab, idx) => {
            const isActive = idx === activeChapterIdx;
            const isOpen = Boolean(openChapters[idx]);
            return (
              <div
                key={idx}
                ref={(el) => {
                  chapterRefs.current[idx] = el;
                }}
                className={`rounded-xl border transition-colors ${
                  isActive
                    ? 'border-violet-500/60 bg-violet-500/10'
                    : 'border-white/[0.07] bg-[#0B0D12]/60'
                }`}
              >
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => toggleChapter(idx)}
                  className="flex w-full items-center justify-between gap-3 p-3.5 text-left cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-violet-300 tabular-nums whitespace-nowrap">
                        {formatTimestamp(bab.mulai)} – {formatTimestamp(bab.selesai)}
                      </span>
                      <span className="text-sm font-semibold text-white truncate">
                        {bab.judul}
                      </span>
                    </div>
                  </div>
                  {isOpen ? (
                    <ChevronUp className="h-4 w-4 text-slate-400 shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
                  )}
                </button>

                {isOpen && (
                  <div className="px-3.5 pb-3.5 pt-1 space-y-3 border-t border-white/[0.06]">
                    <p className="text-sm leading-relaxed text-slate-300">{bab.ringkasan}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => playRange(bab.mulai, bab.selesai)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.15] cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Play className="h-3 w-3 fill-current" />
                        <span>Putar bab</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          createClip({
                            judul: bab.judul,
                            mulai: bab.mulai,
                            selesai: bab.selesai,
                            sumber: 'bab',
                          })
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600/80 to-blue-600/80 px-3 py-1.5 text-xs font-medium text-white hover:from-violet-500 hover:to-blue-500 cursor-pointer whitespace-nowrap shrink-0"
                      >
                        <Scissors className="h-3 w-3" />
                        <span>Jadikan klip</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
