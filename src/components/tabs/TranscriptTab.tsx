import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  Loader2,
  Mic,
  Pencil,
  Play,
  RefreshCw,
  Scissors,
  Search,
  Sparkles,
  Subtitles,
} from 'lucide-react';
import { useClipMind } from '../../context/ClipMindContext';
import type { GeminiVoiceName, VoiceOverTone } from '../../types';
import { base64ToUint8Array, wrapPcmToWav } from '../../utils/audio';
import { exportToSrt, exportTranscriptToTxt } from '../../utils/subtitles';
import { formatTimestamp } from '../../utils/youtube';
import { TimestampChip } from '../TimestampChip';

const TONES: VoiceOverTone[] = ['Informatif', 'Santai', 'Dramatis', 'Humor', 'Profesional'];
const LANGUAGES = ['Indonesia', 'Inggris', 'Jepang', 'Korea', 'Arab', 'Spanyol'];
const VOICES: Array<{ name: GeminiVoiceName; desc: string }> = [
  { name: 'Kore', desc: 'Tegas & Jernih' },
  { name: 'Puck', desc: 'Ceria & Dinamis' },
  { name: 'Charon', desc: 'Berat & Berwibawa' },
  { name: 'Zephyr', desc: 'Hangat & Natural' },
  { name: 'Fenrir', desc: 'Cepat & Enerjik' },
  { name: 'Aoede', desc: 'Lembut & Ekspresif' },
];

export function TranscriptTab() {
  const {
    videoId,
    sourceType,
    localVideoInfo,
    durationSec,
    currentTime,
    transcript,
    transcriptLoadedUntil,
    transcriptError,
    showTranscriptSubtitles,
    setShowTranscriptSubtitles,
    narrationTone,
    setNarrationTone,
    narrationLanguage,
    setNarrationLanguage,
    narrationVoice,
    setNarrationVoice,
    narrationSpeakingStyle,
    setNarrationSpeakingStyle,
    narrationOriginalVolume,
    setNarrationOriginalVolume,
    narrationAudioPcm,
    narrationAudioLoading,
    narrationError,
    progress,
    loadNextTranscriptChunk,
    generateNarrationTranscript,
    transcribeLocalAudioAccurate,
    updateTranscriptSegment,
    generateNarrationVoiceOver,
    playVideoWithNarration,
    applyNarrationToClipAndEdit,
    seekTo,
  } = useClipMind();

  const [rawSearch, setRawSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [autoFollow, setAutoFollow] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const listRef = useRef<HTMLDivElement | null>(null);
  const hasAutoTriggered = useRef<string | null>(null);

  // Lazy load first 10-minute chunk when Transcript tab opens
  useEffect(() => {
    if (
      videoId &&
      transcript.length === 0 &&
      progress.transcript === 'idle' &&
      hasAutoTriggered.current !== videoId
    ) {
      hasAutoTriggered.current = videoId;
      loadNextTranscriptChunk(true);
    }
  }, [videoId, transcript.length, progress.transcript, loadNextTranscriptChunk]);

  // 250ms debounce search
  useEffect(() => {
    const id = window.setTimeout(() => {
      setDebouncedSearch(rawSearch.trim().toLowerCase());
    }, 250);
    return () => window.clearTimeout(id);
  }, [rawSearch]);

  const narrationWavUrl = useMemo(() => {
    if (!narrationAudioPcm) return null;
    try {
      const pcm = base64ToUint8Array(narrationAudioPcm);
      const blob = wrapPcmToWav(pcm, 24000, 1, 16);
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }, [narrationAudioPcm]);

  useEffect(() => {
    return () => {
      if (narrationWavUrl) URL.revokeObjectURL(narrationWavUrl);
    };
  }, [narrationWavUrl]);

  const filteredSegments = useMemo(() => {
    if (!debouncedSearch) {
      return transcript.map((seg, origIndex) => ({ seg, origIndex }));
    }
    return transcript
      .map((seg, origIndex) => ({ seg, origIndex }))
      .filter(
        ({ seg }) =>
          seg.teks.toLowerCase().includes(debouncedSearch) ||
          seg.pembicara.toLowerCase().includes(debouncedSearch)
      );
  }, [transcript, debouncedSearch]);

  const activeIdx = useMemo(() => {
    return filteredSegments.findIndex(
      ({ seg }) => currentTime >= seg.mulai && currentTime <= seg.selesai
    );
  }, [filteredSegments, currentTime]);

  // Virtualized scrolling calculations (fixed row height estimate 82px)
  const ITEM_HEIGHT = 82;
  const VIEWPORT_HEIGHT = 380;
  const startIdx = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - 3);
  const visibleCount = Math.ceil(VIEWPORT_HEIGHT / ITEM_HEIGHT) + 6;
  const endIdx = Math.min(filteredSegments.length, startIdx + visibleCount);
  const visibleRows = filteredSegments.slice(startIdx, endIdx);

  useEffect(() => {
    if (!autoFollow || activeIdx < 0 || !listRef.current || editingIdx !== null) return;
    const targetTop = activeIdx * ITEM_HEIGHT;
    const currentScroll = listRef.current.scrollTop;
    if (
      targetTop < currentScroll ||
      targetTop > currentScroll + VIEWPORT_HEIGHT - ITEM_HEIGHT
    ) {
      listRef.current.scrollTo({ top: Math.max(0, targetTop - 80), behavior: 'smooth' });
    }
  }, [activeIdx, autoFollow, editingIdx]);

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const renderHighlightedText = (text: string) => {
    if (!debouncedSearch) return text;
    const idx = text.toLowerCase().indexOf(debouncedSearch);
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="rounded bg-amber-400/30 px-0.5 text-amber-200">
          {text.slice(idx, idx + debouncedSearch.length)}
        </mark>
        {text.slice(idx + debouncedSearch.length)}
      </>
    );
  };

  if (!videoId) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-400">
        Muat video YouTube atau impor file MP4 terlebih dahulu untuk membuat transkrip atau narasi AI.
      </div>
    );
  }

  const hasMore = transcriptLoadedUntil < durationSec;
  const isGeneratingTranscript = progress.transcript === 'loading';

  return (
    <div className="space-y-4">
      {/* AI Narrator Panel for Silent / Non-Narrated Videos */}
      <div className="rounded-xl border border-violet-500/25 bg-[#0B0D12] p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-0.5">
            <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold text-white">
              <Sparkles className="h-4 w-4 text-violet-400" />
              <span>Generator Narasi AI (Video Tanpa Narasi)</span>
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Video tanpa suara atau hanya visual? AI akan membaca adegan video, menyusun skrip narasi ber-timestamp, menampilkannya otomatis sebagai subtitle di video, dan menghasilkan Voice Over AI.
            </p>
          </div>

          <label className="inline-flex items-center gap-2 text-xs text-slate-200 cursor-pointer select-none shrink-0 pt-0.5">
            <input
              type="checkbox"
              checked={showTranscriptSubtitles}
              onChange={(e) => setShowTranscriptSubtitles(e.target.checked)}
              className="accent-violet-500"
            />
            <Subtitles className="h-3.5 w-3.5 text-emerald-300" />
            <span>Subtitle di Video</span>
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs min-w-[130px]">
            <span className="block text-slate-400">Nada Narasi</span>
            <select
              aria-label="Nada Narasi AI"
              value={narrationTone}
              onChange={(e) => setNarrationTone(e.target.value as VoiceOverTone)}
              className="w-full rounded-lg border border-white/10 bg-[#121620] px-2.5 py-1.5 text-xs text-white"
            >
              {TONES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs min-w-[130px]">
            <span className="block text-slate-400">Bahasa Narasi</span>
            <select
              aria-label="Bahasa Narasi AI"
              value={narrationLanguage}
              onChange={(e) => setNarrationLanguage(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-[#121620] px-2.5 py-1.5 text-xs text-white"
            >
              {LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={isGeneratingTranscript}
            onClick={() => generateNarrationTranscript()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 disabled:opacity-45 cursor-pointer whitespace-nowrap shrink-0 h-[32px]"
          >
            {isGeneratingTranscript ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span>
              {isGeneratingTranscript ? 'Menyusun Narasi…' : 'Generate Transkrip Narasi'}
            </span>
          </button>

          {sourceType === 'local' && localVideoInfo?.hasAudio && (
            <button
              type="button"
              disabled={isGeneratingTranscript}
              onClick={() => transcribeLocalAudioAccurate()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-slate-100 hover:bg-white/[0.12] disabled:opacity-45 cursor-pointer whitespace-nowrap shrink-0 h-[32px]"
            >
              <Mic className="h-3.5 w-3.5 text-blue-300" />
              <span>Transkrip Audio Presisi</span>
            </button>
          )}
        </div>

        {/* AI Voice Over Generator for Full Narration Script */}
        {transcript.length > 0 && (
          <div className="border-t border-white/[0.08] pt-3 space-y-2.5">
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-1 text-xs min-w-[175px]">
                <span className="block text-slate-400">Suara AI (Voice Over)</span>
                <select
                  aria-label="Pilihan Suara AI Narasi"
                  value={narrationVoice}
                  onChange={(e) => setNarrationVoice(e.target.value as GeminiVoiceName)}
                  className="w-full rounded-lg border border-white/10 bg-[#121620] px-2.5 py-1.5 text-xs text-white"
                >
                  {VOICES.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} — {v.desc}
                    </option>
                  ))}
                </select>
              </label>

              <label className="space-y-1 text-xs flex-1 min-w-[160px]">
                <span className="block text-slate-400">Gaya Bicara</span>
                <input
                  type="text"
                  aria-label="Gaya bicara narasi AI"
                  value={narrationSpeakingStyle}
                  onChange={(e) => setNarrationSpeakingStyle(e.target.value)}
                  placeholder="mis. Jelas, natural, dan ekspresif"
                  className="w-full rounded-lg border border-white/10 bg-[#121620] px-2.5 py-1.5 text-xs text-white focus:border-violet-500 focus:outline-none"
                />
              </label>

              <button
                type="button"
                disabled={narrationAudioLoading}
                onClick={generateNarrationVoiceOver}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/90 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-45 cursor-pointer whitespace-nowrap shrink-0 h-[32px]"
              >
                {narrationAudioLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Mic className="h-3.5 w-3.5" />
                )}
                <span>
                  {narrationAudioLoading
                    ? 'Membuat Suara AI…'
                    : 'Generate Voice Over AI'}
                </span>
              </button>

              <button
                type="button"
                onClick={applyNarrationToClipAndEdit}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/[0.12] cursor-pointer whitespace-nowrap shrink-0 h-[32px]"
              >
                <Scissors className="h-3.5 w-3.5 text-violet-300" />
                <span>Kirim ke Klip &amp; Ekspor</span>
              </button>
            </div>

            {narrationError && (
              <p className="text-xs text-rose-300">{narrationError}</p>
            )}

            {narrationWavUrl && (
              <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-2.5 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium text-emerald-200">
                    Suara Narasi AI siap diputar sinkron dengan subtitle di video
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={playVideoWithNarration}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500 cursor-pointer whitespace-nowrap"
                    >
                      <Play className="h-3 w-3 fill-current" />
                      <span>Putar Video + Narasi AI</span>
                    </button>
                    <a
                      href={narrationWavUrl}
                      download={`narasi-ai-${videoId}.wav`}
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/[0.05] px-2.5 py-1 text-xs text-slate-200 hover:bg-white/[0.12]"
                    >
                      <Download className="h-3 w-3" />
                      <span>.wav</span>
                    </a>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <audio controls src={narrationWavUrl} className="h-8 flex-1 min-w-[200px]" />
                  <label className="flex items-center gap-2 text-[11px] text-slate-300 shrink-0">
                    <span>Vol. video asli ({narrationOriginalVolume}%)</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={narrationOriginalVolume}
                      onChange={(e) => setNarrationOriginalVolume(Number(e.target.value))}
                      className="w-20 accent-emerald-400"
                    />
                  </label>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Search & Export Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
          <input
            type="text"
            aria-label="Cari kata kunci di transkrip"
            placeholder="Cari kata kunci atau pembicara…"
            value={rawSearch}
            onChange={(e) => setRawSearch(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-[#0B0D12] pl-9 pr-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoFollow}
              onChange={(e) => setAutoFollow(e.target.checked)}
              className="accent-violet-500"
            />
            <span>Ikuti video</span>
          </label>

          <button
            type="button"
            disabled={transcript.length === 0}
            onClick={() =>
              downloadFile(
                exportTranscriptToTxt(transcript),
                `transkrip-${videoId}.txt`,
                'text/plain;charset=utf-8'
              )
            }
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/[0.1] disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span>.txt</span>
          </button>
          <button
            type="button"
            disabled={transcript.length === 0}
            onClick={() =>
              downloadFile(
                exportToSrt(
                  transcript.map((s, i) => ({
                    id: `t-${i}`,
                    mulai: s.mulai,
                    selesai: s.selesai,
                    teks: s.teks,
                  }))
                ),
                `transkrip-${videoId}.srt`,
                'text/plain;charset=utf-8'
              )
            }
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/[0.1] disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            <span>.srt</span>
          </button>
        </div>
      </div>

      {transcriptError && (
        <div className="flex items-center justify-between rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          <span>{transcriptError}</span>
          <button
            type="button"
            onClick={() => loadNextTranscriptChunk(transcript.length === 0)}
            className="inline-flex items-center gap-1 underline font-semibold cursor-pointer"
          >
            <RefreshCw className="h-3 w-3" />
            <span>Coba lagi</span>
          </button>
        </div>
      )}

      {/* Virtualized Transcript / Narration List */}
      {isGeneratingTranscript && transcript.length === 0 ? (
        <div className="space-y-2.5" aria-busy="true">
          <p className="text-xs text-violet-300 flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span>{progress.stepText || 'Menyusun transkrip segmen awal…'}</span>
          </p>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-14 rounded-lg bg-white/[0.04] animate-pulse" />
          ))}
        </div>
      ) : filteredSegments.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-400">
          {debouncedSearch
            ? 'Kata kunci tidak ditemukan pada segmen transkrip yang sudah dimuat.'
            : 'Belum ada transkrip yang dimuat. Klik "Generate Transkrip Narasi" untuk membuat narasi otomatis.'}
        </div>
      ) : (
        <div
          ref={listRef}
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          style={{ height: `${VIEWPORT_HEIGHT}px` }}
          className="relative overflow-y-auto rounded-xl border border-white/[0.08] bg-[#0B0D12]/60"
        >
          <div
            style={{
              height: `${filteredSegments.length * ITEM_HEIGHT}px`,
              position: 'relative',
            }}
          >
            {visibleRows.map(({ seg, origIndex }, offset) => {
              const realIdx = startIdx + offset;
              const isActive = realIdx === activeIdx;
              const isEditing = editingIdx === origIndex;

              return (
                <div
                  key={`${seg.mulai}-${origIndex}`}
                  style={{
                    position: 'absolute',
                    top: `${realIdx * ITEM_HEIGHT}px`,
                    left: 0,
                    right: 0,
                    height: `${ITEM_HEIGHT}px`,
                  }}
                  onClick={() => {
                    if (!isEditing) seekTo(seg.mulai, true);
                  }}
                  className={`flex items-start gap-3 px-3.5 py-2.5 border-b border-white/[0.05] cursor-pointer transition-colors ${
                    isActive ? 'bg-violet-500/15' : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="pt-0.5 shrink-0">
                    <TimestampChip seconds={seg.mulai} label={formatTimestamp(seg.mulai)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-medium text-violet-300 truncate">
                        {renderHighlightedText(seg.pembicara)}
                      </p>
                      <button
                        type="button"
                        aria-label={isEditing ? 'Simpan edit narasi' : 'Edit teks segmen'}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (isEditing) {
                            updateTranscriptSegment(origIndex, editingDraft.trim() || seg.teks);
                            setEditingIdx(null);
                          } else {
                            setEditingIdx(origIndex);
                            setEditingDraft(seg.teks);
                          }
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer shrink-0"
                      >
                        {isEditing ? (
                          <Check className="h-3 w-3 text-emerald-300" />
                        ) : (
                          <Pencil className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editingDraft}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEditingDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            updateTranscriptSegment(origIndex, editingDraft.trim() || seg.teks);
                            setEditingIdx(null);
                          } else if (e.key === 'Escape') {
                            setEditingIdx(null);
                          }
                        }}
                        autoFocus
                        className="mt-1 w-full rounded border border-violet-500/50 bg-[#121620] px-2 py-0.5 text-xs text-white focus:outline-none"
                      />
                    ) : (
                      <p className="text-xs leading-snug text-slate-200 line-clamp-2 mt-0.5">
                        {renderHighlightedText(seg.teks)}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Lazy Load Next 10-Min Chunk */}
      {hasMore && (
        <div className="flex items-center justify-between rounded-lg border border-white/[0.08] bg-[#0B0D12] px-3.5 py-2.5">
          <span className="text-xs text-slate-400">
            Dimuat hingga {formatTimestamp(transcriptLoadedUntil)} dari {formatTimestamp(durationSec)}
          </span>
          <button
            type="button"
            disabled={isGeneratingTranscript}
            onClick={() => loadNextTranscriptChunk(false)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.15] disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
          >
            {isGeneratingTranscript && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>Muat 10 menit berikutnya</span>
          </button>
        </div>
      )}
    </div>
  );
}
