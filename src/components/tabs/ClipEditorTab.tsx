import React from 'react';
import {
  FileText,
  Image as ImageIcon,
  Mic,
  Play,
  Scissors,
  SlidersHorizontal,
  Subtitles,
} from 'lucide-react';
import { useClipMind } from '../../context/ClipMindContext';
import type { ClipEditorSubTab } from '../../types';
import { normalizeClipEditing } from '../../utils/mp4Helpers';
import { formatTimestamp } from '../../utils/youtube';
import { SubtitleSubTab } from '../clip-editor/SubtitleSubTab';
import { VoiceOverSubTab } from '../clip-editor/VoiceOverSubTab';
import { ThumbnailSubTab } from '../clip-editor/ThumbnailSubTab';
import { MetadataSubTab } from '../clip-editor/MetadataReframeSubTab';
import { StudioEditSubTab } from '../clip-editor/StudioEditSubTab';
import { ClipDownloadMenu } from '../ClipDownloadMenu';

const SUBTABS: Array<{ key: ClipEditorSubTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: 'reframe', label: 'Trim, Crop & Edit', icon: SlidersHorizontal },
  { key: 'subtitle', label: 'Subtitle', icon: Subtitles },
  { key: 'vo', label: 'Voice Over', icon: Mic },
  { key: 'thumbnail', label: 'Thumbnail & Judul', icon: ImageIcon },
  { key: 'metadata', label: 'Metadata & Hook', icon: FileText },
];

export function ClipEditorTab() {
  const {
    videoId,
    selectedClip,
    activeEditorSubTab,
    setActiveEditorSubTab,
    trimStart,
    trimEnd,
    createClip,
    playRange,
  } = useClipMind();

  if (!videoId) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-400">
        Muat video YouTube terlebih dahulu untuk membuat dan mengedit klip virtual.
      </div>
    );
  }

  if (!selectedClip) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-8 text-center space-y-3">
        <Scissors className="h-8 w-8 text-violet-400 mx-auto" />
        <div className="space-y-1">
          <h3 className="font-display text-sm font-semibold text-white">
            Belum ada klip yang dipilih
          </h3>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Pilih klip dari Daftar Klip di sebelah kiri, klik &ldquo;Buat Klip&rdquo; pada Highlight/Bab, atau langsung buat dari rentang timeline aktif.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            createClip({
              judul: `Klip ${formatTimestamp(trimStart)}–${formatTimestamp(trimEnd)}`,
              mulai: trimStart,
              selesai: trimEnd,
              sumber: 'manual',
            })
          }
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 cursor-pointer"
        >
          <Scissors className="h-3.5 w-3.5" />
          <span>Buat Klip dari Timeline ({formatTimestamp(trimStart)} – {formatTimestamp(trimEnd)})</span>
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Selected Clip Banner */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#0B0D12] px-4 py-3">
        <div className="min-w-0">
          <h3 className="font-display text-sm font-semibold text-white truncate">
            {selectedClip.judul}
          </h3>
          <p className="font-mono text-xs text-violet-300 tabular-nums mt-0.5">
            {formatTimestamp(selectedClip.mulai)} – {formatTimestamp(selectedClip.selesai)} (
            {Math.max(1, selectedClip.selesai - selectedClip.mulai)} detik)
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ClipDownloadMenu />
          <button
            type="button"
            onClick={() => {
              const ed = normalizeClipEditing(selectedClip.editing);
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
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.15] cursor-pointer whitespace-nowrap shrink-0"
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>Putar Klip</span>
          </button>
        </div>
      </div>

      {/* Editor Sub-Tabs */}
      <div
        role="tablist"
        aria-label="Sub-tab editor klip"
        className="flex flex-wrap items-center gap-1 rounded-lg border border-white/[0.08] bg-[#0B0D12] p-1"
      >
        {SUBTABS.map((t) => {
          const Icon = t.icon;
          const isActive = activeEditorSubTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveEditorSubTab(t.key)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                isActive
                  ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Sub-Tab Body */}
      <div>
        {activeEditorSubTab === 'subtitle' && <SubtitleSubTab />}
        {activeEditorSubTab === 'vo' && <VoiceOverSubTab />}
        {activeEditorSubTab === 'thumbnail' && <ThumbnailSubTab />}
        {activeEditorSubTab === 'metadata' && <MetadataSubTab />}
        {activeEditorSubTab === 'reframe' && <StudioEditSubTab />}
      </div>
    </div>
  );
}
