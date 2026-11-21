import React, { useMemo, useState } from 'react';
import { ArrowUpDown, Play, RefreshCw, Scissors, Search } from 'lucide-react';
import { useClipMind } from '../../context/ClipMindContext';
import type { HighlightCategory } from '../../types';
import { formatTimestamp } from '../../utils/youtube';

const CATEGORIES: Array<'Semua' | HighlightCategory> = [
  'Semua',
  'Kutipan kuat',
  'Tips praktis',
  'Plot twist',
  'Momen lucu',
  'Fakta mengejutkan',
  'Emosional',
];

export function HighlightTab() {
  const {
    highlights,
    highlightsError,
    progress,
    regenerateHighlights,
    playRange,
    createClip,
  } = useClipMind();

  const [categoryFilter, setCategoryFilter] = useState<'Semua' | HighlightCategory>('Semua');
  const [sortBy, setSortBy] = useState<'score' | 'time'>('score');
  const [focusQuery, setFocusQuery] = useState('');

  const filtered = useMemo(() => {
    if (!highlights) return [];
    const list =
      categoryFilter === 'Semua'
        ? [...highlights]
        : highlights.filter((h) => h.kategori === categoryFilter);
    return list.sort((a, b) =>
      sortBy === 'score' ? b.skor_viral - a.skor_viral : a.mulai - b.mulai
    );
  }, [highlights, categoryFilter, sortBy]);

  if (progress.highlights === 'loading' && !highlights) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Mencari highlight video">
        <p className="text-xs text-violet-300">Mencari momen highlight paling potensial…</p>
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-32 rounded-xl bg-white/[0.04] animate-pulse" />
        ))}
      </div>
    );
  }

  if (highlightsError && !highlights) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-5 space-y-3">
        <p className="text-sm font-medium text-rose-200">{highlightsError}</p>
        <button
          type="button"
          onClick={() => regenerateHighlights()}
          className="inline-flex items-center gap-2 rounded-lg bg-rose-500/20 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-500/30 cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Coba lagi</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Custom Focus Search */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          regenerateHighlights(focusQuery);
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            aria-label="Fokus pencarian highlight kustom"
            placeholder="Cari lagi dengan fokus… (mis. momen paling lucu, debat sengit)"
            value={focusQuery}
            onChange={(e) => setFocusQuery(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-[#0B0D12] pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={progress.highlights === 'loading'}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${progress.highlights === 'loading' ? 'animate-spin' : ''}`} />
          <span>Cari Highlight</span>
        </button>
      </form>

      {/* Filters & Sort */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
        <div className="flex flex-wrap items-center gap-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                categoryFilter === cat
                  ? 'bg-white/15 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setSortBy((prev) => (prev === 'score' ? 'time' : 'score'))}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-slate-300 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
        >
          <ArrowUpDown className="h-3 w-3" />
          <span>{sortBy === 'score' ? 'Urut: Skor tertinggi' : 'Urut: Kronologis'}</span>
        </button>
      </div>

      {highlightsError && (
        <p className="text-xs text-rose-300">{highlightsError}</p>
      )}

      {/* Highlight Cards */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-400">
          Tidak ada highlight pada kategori ini. Coba pilih kategori lain atau cari dengan fokus kustom.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((hl, idx) => {
            const dur = Math.max(1, hl.selesai - hl.mulai);
            return (
              <article
                key={`${hl.mulai}-${idx}`}
                className="rounded-xl border border-white/[0.08] bg-[#0B0D12]/80 p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="font-medium text-violet-300">{hl.kategori}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-300">
                        {formatTimestamp(hl.mulai)} – {formatTimestamp(hl.selesai)} ({dur}d)
                      </span>
                    </div>
                    <h3 className="font-display text-sm font-semibold text-white">
                      {hl.judul}
                    </h3>
                  </div>

                  <div className="text-right shrink-0 w-24">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
                      <span>Potensi</span>
                      <span className="font-mono font-semibold text-white tabular-nums">
                        {hl.skor_viral}/100
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                      <div
                        style={{ width: `${Math.max(5, Math.min(100, hl.skor_viral))}%` }}
                        className="h-full bg-gradient-to-r from-violet-500 to-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <p className="text-xs leading-relaxed text-slate-300">{hl.alasan}</p>

                {hl.hook_saran && (
                  <p className="text-xs text-slate-400">
                    <span className="font-medium text-slate-300">Saran hook: </span>
                    “{hl.hook_saran}”
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => playRange(hl.mulai, hl.selesai)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.15] cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Play className="h-3 w-3 fill-current" />
                    <span>Pratinjau</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      createClip({
                        judul: hl.judul,
                        mulai: hl.mulai,
                        selesai: hl.selesai,
                        sumber: 'highlight',
                        hook: hl.hook_saran,
                      })
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Scissors className="h-3 w-3" />
                    <span>Buat Klip</span>
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
