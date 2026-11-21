import React, { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Edit2,
  Film,
  GripVertical,
  Loader2,
  Play,
  Scissors,
  Trash2,
} from 'lucide-react';
import { useClipMind } from '../context/ClipMindContext';
import { exportLocalClipMp4 } from '../services/geminiService';
import type { VirtualClip } from '../types';
import {
  buildEditedClipZip,
  sanitizeFileSlug,
  triggerBlobDownload,
} from '../utils/clipExport';
import { normalizeClipEditing } from '../utils/mp4Helpers';
import { formatTimestamp } from '../utils/youtube';

export function SavedClipsList() {
  const {
    sourceType,
    localVideoId,
    clips,
    selectedClipId,
    setSelectedClipId,
    setActiveTab,
    playRange,
    playAllClipsReel,
    updateClip,
    deleteClip,
    duplicateClip,
    reorderClips,
    reelQueue,
    youtubeUrl,
    videoId,
    setGlobalError,
  } = useClipMind();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [renderingMp4Id, setRenderingMp4Id] = useState<string | null>(null);

  const handleDownloadClip = async (clip: VirtualClip) => {
    setDownloadingId(clip.id);
    try {
      const zipBlob = await buildEditedClipZip(clip, youtubeUrl, videoId);
      triggerBlobDownload(zipBlob, `clipmind-${sanitizeFileSlug(clip.judul)}.zip`);
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Gagal mengunduh paket klip.'
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDownloadClipMp4 = async (clip: VirtualClip) => {
    if (!localVideoId) return;
    setRenderingMp4Id(clip.id);
    const ed = normalizeClipEditing(clip.editing);
    try {
      const mp4Blob = await exportLocalClipMp4({
        localVideoId,
        clip,
        burnSubtitles: clip.subtitle.length > 0 && ed.burnSubtitles,
        includeVoiceOver: Boolean(clip.naskahVO.audioBase64Pcm) && ed.includeVoiceOver,
      });
      triggerBlobDownload(
        mp4Blob,
        `clipmind-${sanitizeFileSlug(clip.judul)}-siap-upload.mp4`
      );
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Gagal merender klip MP4.'
      );
    } finally {
      setRenderingMp4Id(null);
    }
  };

  const startRename = (id: string, currentTitle: string) => {
    setEditingId(id);
    setDraftTitle(currentTitle);
  };

  const commitRename = (id: string) => {
    if (draftTitle.trim()) {
      updateClip(id, { judul: draftTitle.trim() });
    }
    setEditingId(null);
  };

  return (
    <section
      aria-label="Daftar klip tersimpan"
      className="rounded-xl border border-white/[0.08] bg-[#121620] p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Scissors className="h-4 w-4 text-violet-400" aria-hidden="true" />
          <h3 className="font-display text-sm font-semibold text-white">
            Daftar Klip Tersimpan ({clips.length})
          </h3>
        </div>
        {clips.length > 0 && (
          <button
            type="button"
            onClick={playAllClipsReel}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.14] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="h-3 w-3 fill-current" />
            <span>{reelQueue.length > 0 ? 'Memutar Reel…' : 'Putar semua klip'}</span>
          </button>
        )}
      </div>

      {clips.length === 0 ? (
        <div className="rounded-lg border border-dashed border-white/10 p-5 text-center space-y-1">
          <p className="text-xs font-medium text-slate-300">Belum ada klip virtual tersimpan</p>
          <p className="text-xs text-slate-500">
            Atur rentang di timeline lalu klik Simpan Klip, atau buat langsung dari tab Highlight dan Ringkasan.
          </p>
        </div>
      ) : (
        <ul className="space-y-2 max-h-[300px] overflow-y-auto pr-1" data-testid="saved-clips-list">
          {clips.map((clip, idx) => {
            const isSelected = clip.id === selectedClipId;
            const duration = Math.max(1, clip.selesai - clip.mulai);
            return (
              <li
                key={clip.id}
                draggable
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragIdx !== null) {
                    reorderClips(dragIdx, idx);
                    setDragIdx(null);
                  }
                }}
                className={`group flex items-center justify-between gap-2 rounded-lg border p-2.5 transition-colors ${
                  isSelected
                    ? 'border-violet-500/60 bg-violet-500/10'
                    : 'border-white/[0.06] bg-[#0B0D12]/70 hover:border-white/15'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className="cursor-grab text-slate-500 hover:text-slate-300"
                    title="Seret untuk mengurutkan"
                    aria-hidden="true"
                  >
                    <GripVertical className="h-4 w-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    {editingId === clip.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && commitRename(clip.id)}
                          aria-label="Ubah nama klip"
                          autoFocus
                          className="w-full rounded bg-[#181D2B] px-2 py-0.5 text-xs text-white focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => commitRename(clip.id)}
                          aria-label="Simpan nama klip"
                          className="text-emerald-400 hover:text-emerald-300 cursor-pointer"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedClipId(clip.id);
                          setActiveTab('klip');
                        }}
                        className="block w-full text-left cursor-pointer"
                      >
                        <p className="text-xs font-medium text-white truncate">{clip.judul}</p>
                        <p className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5">
                          {formatTimestamp(clip.mulai)} – {formatTimestamp(clip.selesai)} · {duration}d ·{' '}
                          <span className="font-sans capitalize">{clip.sumber}</span>
                        </p>
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    aria-label={`Putar klip ${clip.judul}`}
                    onClick={() => {
                      const ed = normalizeClipEditing(clip.editing);
                      setSelectedClipId(clip.id);
                      playRange(clip.mulai, clip.selesai, {
                        withVoiceOverPcm: ed.includeVoiceOver
                          ? clip.naskahVO.audioBase64Pcm
                          : undefined,
                        originalVolume:
                          ed.includeVoiceOver && clip.naskahVO.audioBase64Pcm
                            ? clip.naskahVO.originalVolume
                            : Math.min(100, ed.clipVolume),
                        playbackRate: ed.speed,
                        muteOriginal: ed.muteOriginal,
                      });
                    }}
                    className="rounded p-1.5 text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                  {sourceType === 'local' && localVideoId && (
                    <button
                      type="button"
                      disabled={renderingMp4Id === clip.id}
                      aria-label={`Unduh MP4 klip ${clip.judul}`}
                      title="Unduh video klip .mp4 siap upload"
                      onClick={() => handleDownloadClipMp4(clip)}
                      className="rounded p-1.5 text-emerald-300 hover:bg-emerald-500/20 hover:text-white disabled:opacity-50 cursor-pointer"
                    >
                      {renderingMp4Id === clip.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Film className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={downloadingId === clip.id}
                    aria-label={`Unduh paket klip ${clip.judul}`}
                    title="Unduh paket hasil edit klip (.zip)"
                    onClick={() => handleDownloadClip(clip)}
                    className="rounded p-1.5 text-violet-300 hover:bg-violet-500/20 hover:text-white disabled:opacity-50 cursor-pointer"
                  >
                    {downloadingId === clip.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`Ubah nama klip ${clip.judul}`}
                    onClick={() => startRename(clip.id, clip.judul)}
                    className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Duplikat klip ${clip.judul}`}
                    onClick={() => duplicateClip(clip.id)}
                    className="rounded p-1.5 text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Hapus klip ${clip.judul}`}
                    onClick={() => deleteClip(clip.id)}
                    className="rounded p-1.5 text-slate-400 hover:bg-rose-500/20 hover:text-rose-300 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
