import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Plus,
  Scissors,
  Square,
} from 'lucide-react';
import { useClipMind, type YTPlayerInstance } from '../context/ClipMindContext';
import {
  getVideoCssPreviewStyle,
  normalizeClipEditing,
  summarizeClipEdits,
} from '../utils/mp4Helpers';
import { formatTimestamp, parseTimestamp } from '../utils/youtube';

declare global {
  interface Window {
    YT?: {
      Player: new (
        element: HTMLElement | string,
        options: {
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (event: { target: YTPlayerInstance }) => void;
            onStateChange?: (event: { data: number; target: YTPlayerInstance }) => void;
          };
        }
      ) => YTPlayerInstance;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

const CHAPTER_COLORS = [
  'bg-violet-500/70',
  'bg-blue-500/70',
  'bg-indigo-500/70',
  'bg-cyan-500/70',
  'bg-fuchsia-500/70',
];

export function YouTubePlayerPanel() {
  const {
    sourceType,
    localVideoId,
    localVideoObjectUrl,
    videoId,
    videoTitle,
    videoAuthor,
    durationSec,
    setDurationSec,
    currentTime,
    isPlaying,
    setIsPlaying,
    playerRef,
    trimStart,
    trimEnd,
    setTrimStart,
    setTrimEnd,
    trimError,
    rangePlayback,
    playRange,
    stopRangePlayback,
    togglePlayPause,
    nudgeTime,
    seekTo,
    createClip,
    summary,
    highlights,
    selectedClip,
    showTranscriptSubtitles,
    transcript,
    activeSubtitleText,
    activeSubtitleKaraokeWords,
  } = useClipMind();

  const playerHostRef = useRef<HTMLDivElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | null>(null);
  const [startText, setStartText] = useState(formatTimestamp(trimStart));
  const [endText, setEndText] = useState(formatTimestamp(trimEnd));
  const [clipTitleInput, setClipTitleInput] = useState('');

  useEffect(() => {
    setStartText(formatTimestamp(trimStart));
  }, [trimStart]);

  useEffect(() => {
    setEndText(formatTimestamp(trimEnd));
  }, [trimEnd]);

  // Mount native <video> adapter when sourceType === 'local'
  useEffect(() => {
    if (sourceType !== 'local' || !videoId) return;
    const videoEl = localVideoRef.current;
    if (!videoEl) return;

    try {
      playerRef.current?.destroy();
    } catch {
      // ignore
    }

    const adapter: YTPlayerInstance = {
      seekTo: (seconds: number) => {
        videoEl.currentTime = Math.max(0, seconds);
      },
      playVideo: () => {
        videoEl.play().catch(() => {});
      },
      pauseVideo: () => {
        videoEl.pause();
      },
      getCurrentTime: () => videoEl.currentTime || 0,
      getDuration: () =>
        Number.isFinite(videoEl.duration) && videoEl.duration > 0
          ? videoEl.duration
          : durationSec,
      getPlayerState: () => {
        if (videoEl.ended) return 0;
        return videoEl.paused ? 2 : 1;
      },
      setVolume: (vol: number) => {
        videoEl.volume = Math.max(0, Math.min(1, vol / 100));
      },
      getVolume: () => Math.round(videoEl.volume * 100),
      setPlaybackRate: (rate: number) => {
        videoEl.playbackRate = Math.max(0.25, Math.min(4, rate));
      },
      setMuted: (muted: boolean) => {
        videoEl.muted = muted;
      },
      destroy: () => {
        videoEl.pause();
      },
    };

    playerRef.current = adapter;

    const onLoadedMetadata = () => {
      if (Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
        setDurationSec(Math.floor(videoEl.duration));
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    videoEl.addEventListener('loadedmetadata', onLoadedMetadata);
    videoEl.addEventListener('play', onPlay);
    videoEl.addEventListener('pause', onPause);
    videoEl.addEventListener('ended', onEnded);

    return () => {
      videoEl.removeEventListener('loadedmetadata', onLoadedMetadata);
      videoEl.removeEventListener('play', onPlay);
      videoEl.removeEventListener('pause', onPause);
      videoEl.removeEventListener('ended', onEnded);
      setIsPlaying(false);
    };
  }, [sourceType, videoId, localVideoObjectUrl, durationSec, playerRef, setDurationSec, setIsPlaying]);

  // Mount / update YouTube IFrame Player API when sourceType === 'youtube'
  useEffect(() => {
    if (sourceType !== 'youtube' || !videoId || !playerHostRef.current) return;

    let destroyed = false;

    const initPlayer = () => {
      if (destroyed || !playerHostRef.current || !window.YT?.Player) return;
      if (playerRef.current) {
        try {
          playerRef.current.destroy();
        } catch {
          // ignore
        }
        playerRef.current = null;
      }

      playerHostRef.current.innerHTML = '';
      const mountEl = document.createElement('div');
      mountEl.className = 'w-full h-full';
      playerHostRef.current.appendChild(mountEl);

      new window.YT.Player(mountEl, {
        videoId,
        playerVars: {
          rel: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (evt) => {
            if (destroyed) return;
            playerRef.current = evt.target;
            const d = evt.target.getDuration();
            if (Number.isFinite(d) && d > 0) {
              setDurationSec(Math.floor(d));
            }
          },
          onStateChange: (evt) => {
            if (destroyed) return;
            setIsPlaying(evt.data === 1);
          },
        },
      });
    };

    if (window.YT?.Player) {
      initPlayer();
    } else {
      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prevCallback?.();
        initPlayer();
      };
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        tag.async = true;
        document.head.appendChild(tag);
      }
    }

    return () => {
      destroyed = true;
    };
  }, [sourceType, videoId, playerRef, setDurationSec, setIsPlaying]);

  // Drag timeline handles
  useEffect(() => {
    if (!draggingHandle) return;
    const handleMove = (e: PointerEvent) => {
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect || durationSec <= 0) return;
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const sec = Math.round(ratio * durationSec);
      if (draggingHandle === 'start') {
        setTrimStart(Math.min(sec, Math.max(0, trimEnd - 1)));
      } else {
        setTrimEnd(Math.max(sec, Math.min(durationSec, trimStart + 1)));
      }
    };
    const handleUp = () => setDraggingHandle(null);
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [draggingHandle, durationSec, setTrimEnd, setTrimStart, trimEnd, trimStart]);

  const handleSaveManualClip = () => {
    if (!videoId) return;
    const title =
      clipTitleInput.trim() ||
      `Klip ${formatTimestamp(trimStart)}–${formatTimestamp(trimEnd)}`;
    const created = createClip({
      judul: title,
      mulai: trimStart,
      selesai: trimEnd,
      sumber: 'manual',
    });
    if (created) {
      setClipTitleInput('');
    }
  };

  // Keyboard shortcuts: I = set start, O = set end, Space = play/pause, Left/Right = ±5s, C = save clip
  useEffect(() => {
    if (!videoId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlayPause();
      } else if (key === 'i') {
        e.preventDefault();
        setTrimStart(Math.floor(currentTime));
      } else if (key === 'o') {
        e.preventDefault();
        setTrimEnd(Math.max(Math.floor(currentTime), trimStart + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        nudgeTime(-5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nudgeTime(5);
      } else if (key === 'c' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleSaveManualClip();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Sync live playback speed and mute/volume from active clip editing settings
  const clipEd = normalizeClipEditing(selectedClip?.editing);
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    try {
      p.setPlaybackRate?.(selectedClip ? clipEd.speed : 1);
      if (selectedClip) {
        p.setMuted?.(clipEd.muteOriginal);
        if (!clipEd.muteOriginal) {
          p.setVolume(Math.min(100, clipEd.clipVolume));
        }
      } else {
        p.setMuted?.(false);
        p.setVolume(100);
      }
    } catch {
      // ignore if player not ready
    }
  }, [selectedClip, clipEd.speed, clipEd.muteOriginal, clipEd.clipVolume, playerRef]);

  if (!videoId) return null;

  const safeDur = Math.max(1, durationSec);
  const startPct = Math.max(0, Math.min(100, (trimStart / safeDur) * 100));
  const endPct = Math.max(startPct, Math.min(100, (trimEnd / safeDur) * 100));
  const currentPct = Math.max(0, Math.min(100, (currentTime / safeDur) * 100));

  // Reframe & Pro Edit CSS preview settings when a clip is selected
  const reframeRatio = selectedClip?.rasio.rasio ?? '16:9';
  const focusX = selectedClip?.rasio.fokusX ?? 50;
  const previewStyle = getVideoCssPreviewStyle(selectedClip);
  const activeEditTags = selectedClip ? summarizeClipEdits(selectedClip) : [];

  // Subtle live fade preview only while playing within the clip range
  let liveFadeOpacity = 1;
  if (
    selectedClip &&
    isPlaying &&
    currentTime >= selectedClip.mulai &&
    currentTime <= selectedClip.selesai
  ) {
    const rel = currentTime - selectedClip.mulai;
    const rem = selectedClip.selesai - currentTime;
    if (clipEd.fadeInSec > 0.05 && rel < clipEd.fadeInSec) {
      liveFadeOpacity = Math.max(0.05, rel / clipEd.fadeInSec);
    } else if (clipEd.fadeOutSec > 0.05 && rem < clipEd.fadeOutSec) {
      liveFadeOpacity = Math.max(0.05, rem / clipEd.fadeOutSec);
    }
  }
  const aspectContainerClass =
    reframeRatio === '9:16'
      ? 'aspect-[9/16] max-h-[420px] mx-auto'
      : reframeRatio === '1:1'
      ? 'aspect-square max-h-[380px] mx-auto'
      : reframeRatio === '4:5'
      ? 'aspect-[4/5] max-h-[400px] mx-auto'
      : 'aspect-video w-full';

  const subAppearance = selectedClip?.subtitleAppearance ?? {
    preset: 'kotak' as const,
    fontSize: 18,
    color: '#FFFFFF',
    position: 'bottom' as const,
  };
  const subPosClass =
    subAppearance.position === 'top'
      ? 'top-4'
      : subAppearance.position === 'middle'
      ? 'top-1/2 -translate-y-1/2'
      : 'bottom-5';

  return (
    <section
      aria-label="Pemutar video dan timeline klip"
      className="rounded-xl border border-white/[0.08] bg-[#121620] p-4 space-y-4"
    >
      {/* Video meta header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold text-white truncate">
            {videoTitle || 'Memuat judul video…'}
          </h2>
          <p className="text-xs text-slate-400 truncate mt-0.5">
            {videoAuthor ? `${videoAuthor} · ` : ''}
            <span className="font-mono tabular-nums">
              {formatTimestamp(currentTime)} / {formatTimestamp(durationSec)}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {showTranscriptSubtitles && transcript.length > 0 && (
            <span className="text-[11px] font-medium text-emerald-300 whitespace-nowrap">
              Subtitle Aktif
            </span>
          )}
          {selectedClip && activeEditTags.length > 0 && (
            <span
              data-testid="player-edit-badge"
              className="text-[11px] font-mono text-violet-300 whitespace-nowrap"
            >
              {activeEditTags.slice(0, 4).join(' · ')}
            </span>
          )}
        </div>
      </div>

      {/* Video Player Viewport + Reframe Crop + Transform + Color + Live Subtitle Overlay */}
      <div className="w-full bg-black rounded-lg overflow-hidden border border-white/[0.06]">
        <div className={`relative overflow-hidden bg-black ${aspectContainerClass}`}>
          {sourceType === 'local' ? (
            <div className="absolute inset-0 h-full w-full overflow-hidden">
              <video
                ref={localVideoRef}
                data-testid="local-mp4-video"
                src={
                  localVideoObjectUrl ||
                  (localVideoId ? `/api/local-video/stream/${localVideoId}` : undefined)
                }
                controls
                playsInline
                preload="metadata"
                style={{
                  objectPosition: previewStyle.objectPosition,
                  filter: previewStyle.filter,
                  transform: previewStyle.transform,
                  clipPath: previewStyle.clipPath,
                  opacity: liveFadeOpacity,
                }}
                className={`w-full h-full bg-black transition-[opacity] duration-150 ${
                  previewStyle.objectFit === 'cover' ? 'object-cover' : 'object-contain'
                }`}
              />
            </div>
          ) : (
            <div
              ref={playerHostRef}
              className="absolute inset-0 h-full w-full transition-[opacity] duration-150"
              style={{
                filter: previewStyle.filter,
                clipPath: previewStyle.clipPath,
                opacity: liveFadeOpacity,
                ...(reframeRatio !== '16:9'
                  ? {
                      width: '177.78%',
                      left: `${50 - focusX}%`,
                      transform: `translateX(-22%) ${previewStyle.transform || ''}`.trim(),
                    }
                  : {
                      transform: previewStyle.transform,
                    }),
              }}
            />
          )}

          {/* Live Subtitle Overlay */}
          {activeSubtitleText && subAppearance && (
            <div
              className={`pointer-events-none absolute inset-x-4 flex justify-center text-center z-10 ${subPosClass}`}
            >
              <div
                style={{
                  fontSize: `${Math.max(13, Math.min(34, subAppearance.fontSize))}px`,
                  color: subAppearance.color,
                }}
                className={
                  subAppearance.preset === 'kotak'
                    ? 'rounded-md bg-black/75 px-3 py-1.5 font-medium whitespace-pre-line'
                    : subAppearance.preset === 'bold'
                    ? 'font-display font-extrabold uppercase tracking-tight whitespace-pre-line drop-shadow-[0_2px_6px_rgba(0,0,0,0.95)] [text-shadow:_-2px_-2px_0_#000,_2px_-2px_0_#000,_-2px_2px_0_#000,_2px_2px_0_#000]'
                    : subAppearance.preset === 'karaoke'
                    ? 'rounded-md bg-black/55 px-3 py-1 font-display font-bold whitespace-pre-line'
                    : 'font-medium whitespace-pre-line drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]'
                }
              >
                {subAppearance.preset === 'karaoke' ? (
                  <span className="inline-flex flex-wrap justify-center gap-x-1.5">
                    {activeSubtitleKaraokeWords.map((w, i) => (
                      <span
                        key={i}
                        className={w.active ? 'text-amber-300 scale-105 transition-transform' : 'text-white/75'}
                      >
                        {w.kata}
                      </span>
                    ))}
                  </span>
                ) : (
                  activeSubtitleText
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Interactive Timeline with Chapters, Highlight Dots & Trim Handles */}
      <div className="space-y-2">
        <div
          ref={timelineRef}
          onClick={(e) => {
            if (draggingHandle) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            seekTo(Math.round(ratio * safeDur), isPlaying);
          }}
          role="slider"
          aria-label="Timeline video interaktif"
          aria-valuemin={0}
          aria-valuemax={safeDur}
          aria-valuenow={Math.floor(currentTime)}
          tabIndex={0}
          className="relative h-8 rounded-lg bg-[#0B0D12] border border-white/[0.08] cursor-pointer select-none overflow-hidden"
        >
          {/* Chapter markers */}
          {summary?.bab.map((bab, idx) => {
            const left = (bab.mulai / safeDur) * 100;
            const width = Math.max(1, ((bab.selesai - bab.mulai) / safeDur) * 100);
            return (
              <div
                key={`chap-${idx}`}
                title={`${bab.judul} (${formatTimestamp(bab.mulai)})`}
                style={{ left: `${left}%`, width: `${width}%` }}
                className={`absolute top-0 h-2 ${CHAPTER_COLORS[idx % CHAPTER_COLORS.length]} opacity-70`}
              />
            );
          })}

          {/* Selected Trim Range */}
          <div
            style={{ left: `${startPct}%`, width: `${Math.max(0.5, endPct - startPct)}%` }}
            className="absolute inset-y-0 bg-gradient-to-r from-violet-500/30 to-blue-500/30 border-x border-violet-400"
          />

          {/* Highlight Dots */}
          {highlights?.map((hl, idx) => {
            const left = (hl.mulai / safeDur) * 100;
            return (
              <button
                key={`hldot-${idx}`}
                type="button"
                title={`Highlight: ${hl.judul} (${formatTimestamp(hl.mulai)})`}
                aria-label={`Highlight ${hl.judul}`}
                onClick={(e) => {
                  e.stopPropagation();
                  seekTo(hl.mulai, true);
                }}
                style={{ left: `${left}%` }}
                className="absolute bottom-1 -translate-x-1/2 h-2 w-2 rounded-full bg-amber-400 hover:scale-150 transition-transform"
              />
            );
          })}

          {/* Playhead */}
          <div
            style={{ left: `${currentPct}%` }}
            className="absolute inset-y-0 w-0.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] pointer-events-none"
          />

          {/* Trim Start Handle */}
          <button
            type="button"
            aria-label="Geser waktu mulai klip"
            onPointerDown={(e) => {
              e.stopPropagation();
              setDraggingHandle('start');
            }}
            style={{ left: `${startPct}%` }}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-6 w-3 rounded bg-violet-400 hover:bg-violet-300 cursor-ew-resize shadow"
          />

          {/* Trim End Handle */}
          <button
            type="button"
            aria-label="Geser waktu selesai klip"
            onPointerDown={(e) => {
              e.stopPropagation();
              setDraggingHandle('end');
            }}
            style={{ left: `${endPct}%` }}
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-6 w-3 rounded bg-blue-400 hover:bg-blue-300 cursor-ew-resize shadow"
          />
        </div>

        {/* Transport & Nudge Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={togglePlayPause}
              aria-label={isPlaying ? 'Jeda video' : 'Putar video'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.14] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              <span>{isPlaying ? 'Jeda' : 'Putar'}</span>
            </button>
            <button
              type="button"
              onClick={() => nudgeTime(-5)}
              aria-label="Mundur 5 detik"
              className="rounded-lg bg-white/[0.05] px-2 py-1.5 font-mono text-xs text-slate-300 hover:bg-white/[0.1] cursor-pointer tabular-nums"
            >
              <ChevronLeft className="inline h-3 w-3" />5d
            </button>
            <button
              type="button"
              onClick={() => nudgeTime(-1)}
              aria-label="Mundur 1 detik"
              className="rounded-lg bg-white/[0.05] px-2 py-1.5 font-mono text-xs text-slate-300 hover:bg-white/[0.1] cursor-pointer tabular-nums"
            >
              -1d
            </button>
            <button
              type="button"
              onClick={() => nudgeTime(1)}
              aria-label="Maju 1 detik"
              className="rounded-lg bg-white/[0.05] px-2 py-1.5 font-mono text-xs text-slate-300 hover:bg-white/[0.1] cursor-pointer tabular-nums"
            >
              +1d
            </button>
            <button
              type="button"
              onClick={() => nudgeTime(5)}
              aria-label="Maju 5 detik"
              className="rounded-lg bg-white/[0.05] px-2 py-1.5 font-mono text-xs text-slate-300 hover:bg-white/[0.1] cursor-pointer tabular-nums"
            >
              5d<ChevronRight className="inline h-3 w-3" />
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {rangePlayback ? (
              <button
                type="button"
                onClick={stopRangePlayback}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/30 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Square className="h-3 w-3 fill-current" />
                <span>Hentikan rentang</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={Boolean(trimError)}
                onClick={() => playRange(trimStart, trimEnd)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/20 px-3 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-500/30 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="h-3 w-3 fill-current" />
                <span>Putar rentang</span>
              </button>
            )}
          </div>
        </div>

        {/* Manual Set Start/End + Save Clip Rows */}
        <div className="space-y-2 pt-2 border-t border-white/[0.06]">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setTrimStart(Math.floor(currentTime))}
              title="Shortcut: I"
              className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/[0.1] whitespace-nowrap shrink-0 cursor-pointer"
            >
              [ Set Mulai
            </button>
            <input
              type="text"
              aria-label="Waktu mulai klip (MM:SS)"
              value={startText}
              onChange={(e) => setStartText(e.target.value)}
              onBlur={() => {
                const parsed = parseTimestamp(startText);
                if (parsed !== null) setTrimStart(parsed);
                else setStartText(formatTimestamp(trimStart));
              }}
              className="w-16 rounded-lg border border-white/10 bg-[#0B0D12] px-2 py-1.5 text-center font-mono text-xs text-white tabular-nums focus:border-violet-500 focus:outline-none"
            />
            <span className="text-slate-500 text-xs">–</span>
            <input
              type="text"
              aria-label="Waktu selesai klip (MM:SS)"
              value={endText}
              onChange={(e) => setEndText(e.target.value)}
              onBlur={() => {
                const parsed = parseTimestamp(endText);
                if (parsed !== null) setTrimEnd(parsed);
                else setEndText(formatTimestamp(trimEnd));
              }}
              className="w-16 rounded-lg border border-white/10 bg-[#0B0D12] px-2 py-1.5 text-center font-mono text-xs text-white tabular-nums focus:border-blue-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setTrimEnd(Math.max(Math.floor(currentTime), trimStart + 1))}
              title="Shortcut: O"
              className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-white/[0.1] whitespace-nowrap shrink-0 cursor-pointer"
            >
              Set Selesai ]
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Nama klip baru…"
              aria-label="Nama klip baru"
              value={clipTitleInput}
              onChange={(e) => setClipTitleInput(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
            />
            <button
              type="button"
              disabled={Boolean(trimError)}
              onClick={handleSaveManualClip}
              title="Shortcut: C"
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Scissors className="h-3.5 w-3.5" />
              <span>Simpan Klip</span>
            </button>
          </div>
        </div>

        {trimError && (
          <p className="text-xs text-rose-400" role="alert">
            {trimError}
          </p>
        )}

        <p className="text-[11px] text-slate-500">
          Pintasan: <span className="font-mono text-slate-400">I</span> mulai ·{' '}
          <span className="font-mono text-slate-400">O</span> selesai ·{' '}
          <span className="font-mono text-slate-400">Spasi</span> putar/jeda ·{' '}
          <span className="font-mono text-slate-400">←/→</span> ±5d ·{' '}
          <span className="font-mono text-slate-400">C</span> simpan klip
        </p>
      </div>
    </section>
  );
}
