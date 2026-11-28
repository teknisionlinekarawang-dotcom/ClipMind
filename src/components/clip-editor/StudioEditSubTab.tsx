import React, { useEffect, useState } from 'react';
import {
  Download,
  Film,
  FlipHorizontal2,
  FlipVertical2,
  Loader2,
  Play,
  RotateCcw,
  RotateCw,
  Scissors,
  SlidersHorizontal,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useClipMind } from '../../context/ClipMindContext';
import { exportLocalClipMp4 } from '../../services/geminiService';
import type {
  AspectRatioPreset,
  ClipEditingSettings,
  VideoColorPreset,
  VideoRotationDeg,
} from '../../types';
import {
  buildEditedClipZip,
  sanitizeFileSlug,
  triggerBlobDownload,
} from '../../utils/clipExport';
import {
  COLOR_PRESET_VALUES,
  getDefaultClipEditing,
  normalizeClipEditing,
  summarizeClipEdits,
} from '../../utils/mp4Helpers';
import { validateClipRange } from '../../utils/validators';
import { formatTimestamp, parseTimestamp } from '../../utils/youtube';

const RATIOS: Array<{ key: AspectRatioPreset; desc: string }> = [
  { key: '16:9', desc: 'YouTube Lanskap' },
  { key: '9:16', desc: 'Shorts / TikTok / Reels' },
  { key: '1:1', desc: 'Feed Persegi' },
  { key: '4:5', desc: 'Feed Potret' },
];

const ROTATIONS: VideoRotationDeg[] = [0, 90, 180, 270];
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const COLOR_PRESETS: VideoColorPreset[] = [
  'normal',
  'sinematik',
  'vibrant',
  'hangat',
  'sejuk',
  'bw',
];

export function StudioEditSubTab() {
  const {
    sourceType,
    localVideoId,
    youtubeUrl,
    videoId,
    durationSec,
    currentTime,
    selectedClip,
    updateClip,
    playRange,
    setGlobalError,
  } = useClipMind();

  const [startDraft, setStartDraft] = useState('00:00');
  const [endDraft, setEndDraft] = useState('00:30');
  const [trimWarn, setTrimWarn] = useState<string | null>(null);
  const [showMargins, setShowMargins] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!selectedClip) return;
    setStartDraft(formatTimestamp(selectedClip.mulai));
    setEndDraft(formatTimestamp(selectedClip.selesai));
    setTrimWarn(null);
  }, [selectedClip?.id, selectedClip?.mulai, selectedClip?.selesai]);

  if (!selectedClip) return null;

  const ed = normalizeClipEditing(selectedClip.editing);
  const editSummary = summarizeClipEdits(selectedClip);

  const patchEditing = (patch: Partial<ClipEditingSettings>) => {
    updateClip(selectedClip.id, {
      editing: { ...ed, ...patch },
    });
  };

  const applyTrimBounds = (nextStart: number, nextEnd: number) => {
    const check = validateClipRange(nextStart, nextEnd, durationSec);
    if (!check.valid) {
      setTrimWarn(check.error || 'Rentang waktu trim tidak valid.');
      return;
    }
    setTrimWarn(null);
    updateClip(selectedClip.id, { mulai: nextStart, selesai: nextEnd });
  };

  const handleStepStart = (delta: number) => {
    const nextStart = Math.max(0, Math.min(selectedClip.selesai - 1, selectedClip.mulai + delta));
    applyTrimBounds(nextStart, selectedClip.selesai);
  };

  const handleStepEnd = (delta: number) => {
    const maxD = durationSec > 0 ? durationSec : 86400;
    const nextEnd = Math.min(maxD, Math.max(selectedClip.mulai + 1, selectedClip.selesai + delta));
    applyTrimBounds(selectedClip.mulai, nextEnd);
  };

  const handleRotateStep = (delta: 90 | -90) => {
    const next = (((ed.rotation + delta) % 360) + 360) % 360;
    patchEditing({ rotation: next as VideoRotationDeg });
  };

  const handleColorPreset = (preset: VideoColorPreset) => {
    const val = COLOR_PRESET_VALUES[preset];
    patchEditing({
      colorPreset: preset,
      brightness: val.brightness,
      contrast: val.contrast,
      saturation: val.saturation,
    });
  };

  const handleResetAll = () => {
    updateClip(selectedClip.id, {
      rasio: { rasio: '16:9', fokusX: 50 },
      editing: getDefaultClipEditing(),
    });
  };

  const handlePlayPreview = () => {
    playRange(selectedClip.mulai, selectedClip.selesai, {
      withVoiceOverPcm: ed.includeVoiceOver
        ? selectedClip.naskahVO.audioBase64Pcm
        : undefined,
      originalVolume:
        ed.includeVoiceOver && selectedClip.naskahVO.audioBase64Pcm
          ? selectedClip.naskahVO.originalVolume
          : Math.min(100, ed.clipVolume),
      playbackRate: ed.speed,
      muteOriginal: ed.muteOriginal,
    });
  };

  const handleDirectExport = async () => {
    const slug = sanitizeFileSlug(selectedClip.judul);
    setExporting(true);
    try {
      const canMp4 =
        (sourceType === 'local' && Boolean(localVideoId)) ||
        (sourceType === 'youtube' && Boolean(youtubeUrl));
      if (canMp4) {
        const mp4Blob = await exportLocalClipMp4({
          localVideoId: sourceType === 'local' ? localVideoId || undefined : undefined,
          youtubeUrl: sourceType === 'youtube' ? youtubeUrl || undefined : undefined,
          clip: selectedClip,
          burnSubtitles: ed.burnSubtitles && selectedClip.subtitle.length > 0,
          includeVoiceOver:
            ed.includeVoiceOver && Boolean(selectedClip.naskahVO.audioBase64Pcm),
        });
        triggerBlobDownload(mp4Blob, `clipmind-${slug}-siap-upload.mp4`);
      } else {
        const zipBlob = await buildEditedClipZip(selectedClip, youtubeUrl, videoId);
        triggerBlobDownload(zipBlob, `clipmind-${slug}.zip`);
      }
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Gagal mengekspor hasil edit klip.'
      );
    } finally {
      setExporting(false);
    }
  };

  const rawDuration = Math.max(1, selectedClip.selesai - selectedClip.mulai);
  const outputDuration = rawDuration / ed.speed;

  return (
    <div className="space-y-4">
      {/* Studio Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#0B0D12] px-3.5 py-2.5">
        <div className="min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
            <SlidersHorizontal className="h-3.5 w-3.5 text-violet-400" />
            <span>Studio Edit Pra-Render</span>
          </div>
          <p className="font-mono text-[11px] text-violet-300 truncate">
            {editSummary.join(' · ')}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handlePlayPreview}
            className="inline-flex items-center gap-1 rounded-lg bg-violet-600/25 border border-violet-500/40 px-2.5 py-1.5 text-xs font-medium text-violet-200 hover:bg-violet-600/35 cursor-pointer"
          >
            <Play className="h-3 w-3 fill-current" />
            <span>Putar Pratinjau</span>
          </button>
          <button
            type="button"
            onClick={handleResetAll}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/[0.1] hover:text-white cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* 1. Trim Presisi */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0B0D12] p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Scissors className="h-3.5 w-3.5 text-violet-400" />
            <h4 className="text-xs font-semibold text-white">1. Trim Presisi</h4>
          </div>
          <span className="font-mono text-[11px] text-slate-400 tabular-nums">
            Durasi: <strong className="text-white">{rawDuration}d</strong>
            {Math.abs(ed.speed - 1) > 0.01 && (
              <span className="text-emerald-300">
                {' '}
                → Ekspor {outputDuration.toFixed(1)}d ({ed.speed}x)
              </span>
            )}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Start Time */}
          <div className="space-y-1.5 rounded-lg border border-white/[0.06] bg-[#121620]/80 p-2.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Waktu Mulai</span>
              <button
                type="button"
                onClick={() => applyTrimBounds(Math.floor(currentTime), selectedClip.selesai)}
                className="text-violet-300 hover:text-violet-200 underline cursor-pointer"
              >
                Gunakan Posisi ({formatTimestamp(currentTime)})
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Kurangi mulai 1 detik"
                onClick={() => handleStepStart(-1)}
                className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-xs text-slate-300 hover:bg-white/[0.1] cursor-pointer"
              >
                -1d
              </button>
              <input
                type="text"
                aria-label="Trim mulai klip (MM:SS)"
                value={startDraft}
                onChange={(e) => setStartDraft(e.target.value)}
                onBlur={() => {
                  const parsed = parseTimestamp(startDraft);
                  if (parsed !== null) applyTrimBounds(parsed, selectedClip.selesai);
                  else setStartDraft(formatTimestamp(selectedClip.mulai));
                }}
                className="min-w-0 flex-1 rounded border border-white/10 bg-[#0B0D12] px-2 py-1 text-center font-mono text-xs text-white tabular-nums focus:border-violet-500 focus:outline-none"
              />
              <button
                type="button"
                aria-label="Tambah mulai 1 detik"
                onClick={() => handleStepStart(1)}
                className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-xs text-slate-300 hover:bg-white/[0.1] cursor-pointer"
              >
                +1d
              </button>
            </div>
          </div>

          {/* End Time */}
          <div className="space-y-1.5 rounded-lg border border-white/[0.06] bg-[#121620]/80 p-2.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Waktu Selesai</span>
              <button
                type="button"
                onClick={() =>
                  applyTrimBounds(
                    selectedClip.mulai,
                    Math.max(selectedClip.mulai + 1, Math.floor(currentTime))
                  )
                }
                className="text-blue-300 hover:text-blue-200 underline cursor-pointer"
              >
                Gunakan Posisi ({formatTimestamp(currentTime)})
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Kurangi selesai 1 detik"
                onClick={() => handleStepEnd(-1)}
                className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-xs text-slate-300 hover:bg-white/[0.1] cursor-pointer"
              >
                -1d
              </button>
              <input
                type="text"
                aria-label="Trim selesai klip (MM:SS)"
                value={endDraft}
                onChange={(e) => setEndDraft(e.target.value)}
                onBlur={() => {
                  const parsed = parseTimestamp(endDraft);
                  if (parsed !== null) applyTrimBounds(selectedClip.mulai, parsed);
                  else setEndDraft(formatTimestamp(selectedClip.selesai));
                }}
                className="min-w-0 flex-1 rounded border border-white/10 bg-[#0B0D12] px-2 py-1 text-center font-mono text-xs text-white tabular-nums focus:border-blue-500 focus:outline-none"
              />
              <button
                type="button"
                aria-label="Tambah selesai 1 detik"
                onClick={() => handleStepEnd(1)}
                className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-xs text-slate-300 hover:bg-white/[0.1] cursor-pointer"
              >
                +1d
              </button>
            </div>
          </div>
        </div>
        {trimWarn && (
          <p className="text-xs text-rose-400" role="alert">
            {trimWarn}
          </p>
        )}
      </div>

      {/* 2. Orientasi & Transformasi */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0B0D12] p-4 space-y-3">
        <h4 className="text-xs font-semibold text-white">2. Orientasi &amp; Balik Video</h4>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => handleRotateStep(-90)}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/[0.1] cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>-90°</span>
          </button>
          <button
            type="button"
            onClick={() => handleRotateStep(90)}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-slate-200 hover:bg-white/[0.1] cursor-pointer"
          >
            <RotateCw className="h-3.5 w-3.5" />
            <span>+90°</span>
          </button>

          <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#121620] p-0.5">
            {ROTATIONS.map((deg) => (
              <button
                key={deg}
                type="button"
                onClick={() => patchEditing({ rotation: deg })}
                className={`rounded-md px-2 py-1 font-mono text-xs transition-colors cursor-pointer ${
                  ed.rotation === deg
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {deg}°
              </button>
            ))}
          </div>

          <button
            type="button"
            aria-pressed={ed.flipH}
            onClick={() => patchEditing({ flipH: !ed.flipH })}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors cursor-pointer ${
              ed.flipH
                ? 'border-violet-500 bg-violet-500/20 text-white'
                : 'border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.1]'
            }`}
          >
            <FlipHorizontal2 className="h-3.5 w-3.5" />
            <span>Balik Horizontal</span>
          </button>

          <button
            type="button"
            aria-pressed={ed.flipV}
            onClick={() => patchEditing({ flipV: !ed.flipV })}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors cursor-pointer ${
              ed.flipV
                ? 'border-violet-500 bg-violet-500/20 text-white'
                : 'border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/[0.1]'
            }`}
          >
            <FlipVertical2 className="h-3.5 w-3.5" />
            <span>Balik Vertikal</span>
          </button>
        </div>
      </div>

      {/* 3. Crop, Rasio & Zoom */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0B0D12] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-white">3. Crop, Aspek Rasio &amp; Zoom</h4>
          <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#121620] p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => patchEditing({ cropMode: 'fill' })}
              className={`rounded px-2 py-1 cursor-pointer ${
                ed.cropMode === 'fill'
                  ? 'bg-violet-600 text-white font-medium'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Potong Isi (Fill)
            </button>
            <button
              type="button"
              onClick={() => patchEditing({ cropMode: 'fit' })}
              className={`rounded px-2 py-1 cursor-pointer ${
                ed.cropMode === 'fit'
                  ? 'bg-violet-600 text-white font-medium'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Pas Utuh (Fit)
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {RATIOS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() =>
                updateClip(selectedClip.id, {
                  rasio: { ...selectedClip.rasio, rasio: item.key },
                })
              }
              className={`rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
                selectedClip.rasio.rasio === item.key
                  ? 'border-violet-500 bg-violet-500/15 text-white'
                  : 'border-white/[0.08] bg-[#121620] text-slate-300 hover:border-white/20'
              }`}
            >
              <div className="font-mono text-sm font-bold">{item.key}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">{item.desc}</div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-300">Zoom Crop</span>
              <span className="font-mono text-violet-300 tabular-nums">
                {ed.zoom.toFixed(2)}x
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={2.5}
              step={0.05}
              aria-label="Zoom crop video"
              value={ed.zoom}
              onChange={(e) => patchEditing({ zoom: Number(e.target.value) })}
              className="w-full accent-violet-500"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-300">Fokus Horizontal (X)</span>
              <span className="font-mono text-violet-300 tabular-nums">
                {selectedClip.rasio.fokusX}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              aria-label="Posisi fokus horizontal"
              value={selectedClip.rasio.fokusX}
              onChange={(e) =>
                updateClip(selectedClip.id, {
                  rasio: { ...selectedClip.rasio, fokusX: Number(e.target.value) },
                })
              }
              className="w-full accent-violet-500"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-300">Fokus Vertikal (Y)</span>
              <span className="font-mono text-violet-300 tabular-nums">{ed.fokusY}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              aria-label="Posisi fokus vertikal"
              value={ed.fokusY}
              onChange={(e) => patchEditing({ fokusY: Number(e.target.value) })}
              className="w-full accent-violet-500"
            />
          </div>
        </div>

        {/* Custom Edge Margins */}
        <div className="pt-1 border-t border-white/[0.06]">
          <button
            type="button"
            onClick={() => setShowMargins((prev) => !prev)}
            className="text-[11px] font-medium text-violet-300 hover:text-violet-200 cursor-pointer"
          >
            {showMargins
              ? '▾ Sembunyikan Pangkas Tepi Kustom (%)'
              : '▸ Pangkas Tepi Kustom (Hapus bar hitam / logo sudut)'}
          </button>
          {showMargins && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2.5">
              {(
                [
                  { key: 'marginTop', label: 'Atas' },
                  { key: 'marginBottom', label: 'Bawah' },
                  { key: 'marginLeft', label: 'Kiri' },
                  { key: 'marginRight', label: 'Kanan' },
                ] as const
              ).map((m) => (
                <div key={m.key} className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-400">{m.label}</span>
                    <span className="font-mono text-slate-200 tabular-nums">
                      {ed[m.key]}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    aria-label={`Pangkas tepi ${m.label}`}
                    value={ed[m.key]}
                    onChange={(e) => patchEditing({ [m.key]: Number(e.target.value) })}
                    className="w-full accent-blue-500"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 4. Kecepatan Putar & Koreksi Warna */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0B0D12] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-white">4. Kecepatan Putar &amp; Warna</h4>
          <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#121620] p-0.5">
            {SPEEDS.map((spd) => (
              <button
                key={spd}
                type="button"
                onClick={() => patchEditing({ speed: spd })}
                className={`rounded-md px-2 py-1 font-mono text-[11px] transition-colors cursor-pointer ${
                  Math.abs(ed.speed - spd) < 0.01
                    ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {spd}x
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {COLOR_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => handleColorPreset(preset)}
              className={`rounded-lg border px-2.5 py-1 text-xs transition-colors cursor-pointer ${
                ed.colorPreset === preset
                  ? 'border-violet-500 bg-violet-500/20 text-white font-medium'
                  : 'border-white/[0.08] bg-[#121620] text-slate-300 hover:border-white/20'
              }`}
            >
              {COLOR_PRESET_VALUES[preset].label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-300">Kecerahan</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {ed.brightness > 0 ? `+${ed.brightness.toFixed(2)}` : ed.brightness.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={-0.3}
              max={0.3}
              step={0.02}
              aria-label="Kecerahan video"
              value={ed.brightness}
              onChange={(e) => patchEditing({ brightness: Number(e.target.value) })}
              className="w-full accent-violet-500"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-300">Kontras</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {ed.contrast.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.5}
              max={1.8}
              step={0.02}
              aria-label="Kontras video"
              value={ed.contrast}
              onChange={(e) => patchEditing({ contrast: Number(e.target.value) })}
              className="w-full accent-violet-500"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-300">Saturasi</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {ed.saturation.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              aria-label="Saturasi warna video"
              value={ed.saturation}
              onChange={(e) => patchEditing({ saturation: Number(e.target.value) })}
              className="w-full accent-violet-500"
            />
          </div>
        </div>
      </div>

      {/* 5. Transisi, Audio & Pengaturan Ekspor */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0B0D12] p-4 space-y-3">
        <h4 className="text-xs font-semibold text-white">5. Transisi, Audio &amp; Pengaturan Render</h4>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-300">Fade In (Masuk)</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {ed.fadeInSec.toFixed(1)}d
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              aria-label="Durasi fade in"
              value={ed.fadeInSec}
              onChange={(e) => patchEditing({ fadeInSec: Number(e.target.value) })}
              className="w-full accent-emerald-500"
            />
          </div>

          <div className="space-y-1">
            <div className="flex justify-between text-[11px]">
              <span className="text-slate-300">Fade Out (Keluar)</span>
              <span className="font-mono text-slate-200 tabular-nums">
                {ed.fadeOutSec.toFixed(1)}d
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              aria-label="Durasi fade out"
              value={ed.fadeOutSec}
              onChange={(e) => patchEditing({ fadeOutSec: Number(e.target.value) })}
              className="w-full accent-emerald-500"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300">Volume Asli Klip</span>
              <button
                type="button"
                onClick={() => patchEditing({ muteOriginal: !ed.muteOriginal })}
                className={`inline-flex items-center gap-1 font-mono cursor-pointer ${
                  ed.muteOriginal ? 'text-rose-300' : 'text-slate-200'
                }`}
              >
                {ed.muteOriginal ? (
                  <VolumeX className="h-3 w-3" />
                ) : (
                  <Volume2 className="h-3 w-3" />
                )}
                <span>{ed.muteOriginal ? 'Bisu' : `${ed.clipVolume}%`}</span>
              </button>
            </div>
            <input
              type="range"
              min={0}
              max={150}
              step={5}
              disabled={ed.muteOriginal}
              aria-label="Volume audio asli klip"
              value={ed.clipVolume}
              onChange={(e) => patchEditing({ clipVolume: Number(e.target.value) })}
              className="w-full accent-violet-500 disabled:opacity-40"
            />
          </div>
        </div>

        {/* Quality & Burn Options + Direct Render CTA */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/[0.06]">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#121620] p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => patchEditing({ exportQuality: '720p' })}
                className={`rounded px-2 py-1 font-mono cursor-pointer ${
                  ed.exportQuality === '720p'
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                720p HD
              </button>
              <button
                type="button"
                onClick={() => patchEditing({ exportQuality: '1080p' })}
                className={`rounded px-2 py-1 font-mono cursor-pointer ${
                  ed.exportQuality === '1080p'
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                1080p Full HD
              </button>
            </div>

            <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={ed.burnSubtitles}
                onChange={(e) => patchEditing({ burnSubtitles: e.target.checked })}
                className="rounded accent-violet-500"
              />
              <span>Bakar Subtitle</span>
            </label>

            <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={ed.includeVoiceOver}
                onChange={(e) => patchEditing({ includeVoiceOver: e.target.checked })}
                className="rounded accent-violet-500"
              />
              <span>Gabung Voice Over</span>
            </label>
          </div>

          <button
            type="button"
            disabled={exporting}
            onClick={handleDirectExport}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-3.5 py-2 text-xs font-semibold text-white hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 cursor-pointer whitespace-nowrap shrink-0"
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : sourceType === 'local' && localVideoId ? (
              <Film className="h-3.5 w-3.5" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            <span>
              {exporting
                ? 'Merender Video…'
                : sourceType === 'local' && localVideoId
                ? 'Render & Unduh MP4'
                : 'Unduh Paket ZIP + FFmpeg'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
