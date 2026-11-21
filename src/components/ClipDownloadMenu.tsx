import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  Download,
  FileArchive,
  FileCode2,
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Mic,
  Subtitles,
} from 'lucide-react';
import { useClipMind } from '../context/ClipMindContext';
import { exportLocalClipMp4 } from '../services/geminiService';
import { base64ToUint8Array, wrapPcmToWav } from '../utils/audio';
import {
  buildEditedClipZip,
  exportClipMetadataMarkdown,
  exportSingleClipJson,
  sanitizeFileSlug,
  triggerBlobDownload,
} from '../utils/clipExport';
import { normalizeClipEditing, summarizeClipEdits } from '../utils/mp4Helpers';
import { exportToSrt, exportToVtt } from '../utils/subtitles';
import { renderThumbnailPngBlob } from '../utils/thumbnailRenderer';

export function ClipDownloadMenu() {
  const { sourceType, localVideoId, selectedClip, youtubeUrl, videoId, setGlobalError } =
    useClipMind();
  const [open, setOpen] = useState(false);
  const [renderingMp4, setRenderingMp4] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [downloadingPng, setDownloadingPng] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [open]);

  if (!selectedClip) return null;

  const slug = sanitizeFileSlug(selectedClip.judul);
  const hasSubtitle = selectedClip.subtitle.length > 0;
  const hasVoAudio = Boolean(selectedClip.naskahVO.audioBase64Pcm);
  const isLocalMp4 = sourceType === 'local' && Boolean(localVideoId);

  const ed = normalizeClipEditing(selectedClip.editing);
  const editTags = summarizeClipEdits(selectedClip);

  const handleDownloadMp4 = async () => {
    if (!localVideoId) return;
    setRenderingMp4(true);
    try {
      const mp4Blob = await exportLocalClipMp4({
        localVideoId,
        clip: selectedClip,
        burnSubtitles: hasSubtitle && ed.burnSubtitles,
        includeVoiceOver: hasVoAudio && ed.includeVoiceOver,
      });
      triggerBlobDownload(mp4Blob, `clipmind-${slug}-siap-upload.mp4`);
      setOpen(false);
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Gagal merender klip MP4.'
      );
    } finally {
      setRenderingMp4(false);
    }
  };

  const handleDownloadZip = async () => {
    setDownloadingZip(true);
    try {
      const zipBlob = await buildEditedClipZip(selectedClip, youtubeUrl, videoId);
      triggerBlobDownload(zipBlob, `clipmind-${slug}.zip`);
      setOpen(false);
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Gagal membuat paket ZIP klip.'
      );
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleDownloadThumbnail = async () => {
    setDownloadingPng(true);
    try {
      const pngBlob = await renderThumbnailPngBlob(selectedClip.thumbnail, videoId);
      if (!pngBlob) {
        throw new Error('Gagal merender gambar thumbnail.');
      }
      triggerBlobDownload(pngBlob, `thumbnail-${slug}.png`);
      setOpen(false);
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Gagal mengunduh thumbnail.'
      );
    } finally {
      setDownloadingPng(false);
    }
  };

  const handleDownloadVoWav = () => {
    if (!selectedClip.naskahVO.audioBase64Pcm) return;
    const pcm = base64ToUint8Array(selectedClip.naskahVO.audioBase64Pcm);
    const wavBlob = wrapPcmToWav(pcm, 24000, 1, 16);
    triggerBlobDownload(wavBlob, `voice-over-${slug}.wav`);
    setOpen(false);
  };

  const handleDownloadText = (content: string, filename: string, mime: string) => {
    triggerBlobDownload(new Blob([content], { type: mime }), filename);
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Unduh hasil edit klip"
        onClick={() => setOpen((prev) => !prev)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 transition-all whitespace-nowrap shrink-0 cursor-pointer"
      >
        {renderingMp4 || downloadingZip ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Download className="h-3.5 w-3.5" />
        )}
        <span>{renderingMp4 ? 'Merender MP4…' : 'Unduh Klip'}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Opsi unduhan aset klip"
          className="absolute right-0 mt-2 w-76 rounded-xl border border-white/12 bg-[#141926] p-2 shadow-2xl z-50 space-y-1 text-xs"
        >
          {isLocalMp4 && (
            <button
              type="button"
              role="menuitem"
              disabled={renderingMp4}
              onClick={handleDownloadMp4}
              className="flex w-full items-center justify-between rounded-lg bg-gradient-to-r from-emerald-600/30 to-teal-600/30 border border-emerald-500/50 px-3 py-2 text-left text-white hover:from-emerald-600/40 hover:to-teal-600/40 disabled:opacity-50 cursor-pointer"
            >
              <span className="inline-flex items-center gap-2 font-semibold">
                {renderingMp4 ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-300" />
                ) : (
                  <Film className="h-3.5 w-3.5 text-emerald-300" />
                )}
                <span>
                  {renderingMp4 ? 'Merender Video MP4…' : 'Unduh Video MP4 (Siap Upload)'}
                </span>
              </span>
              <span className="font-mono text-[11px] text-emerald-200">.mp4</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            disabled={downloadingZip}
            onClick={handleDownloadZip}
            className="flex w-full items-center justify-between rounded-lg bg-gradient-to-r from-violet-600/25 to-blue-600/25 border border-violet-500/40 px-3 py-2 text-left text-white hover:from-violet-600/35 hover:to-blue-600/35 disabled:opacity-50 cursor-pointer"
          >
            <span className="inline-flex items-center gap-2 font-semibold">
              {downloadingZip ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-300" />
              ) : (
                <FileArchive className="h-3.5 w-3.5 text-violet-300" />
              )}
              <span>Paket Lengkap Aset</span>
            </span>
            <span className="font-mono text-[11px] text-violet-200">.zip</span>
          </button>

          <div className="my-1 border-t border-white/[0.08]" />

          <button
            type="button"
            role="menuitem"
            disabled={!hasSubtitle}
            onClick={() =>
              handleDownloadText(
                exportToSrt(selectedClip.subtitle),
                `subtitle-${slug}.srt`,
                'text/plain;charset=utf-8'
              )
            }
            className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-slate-200 hover:bg-white/[0.08] disabled:opacity-40 cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              <Subtitles className="h-3.5 w-3.5 text-slate-400" />
              <span>Subtitle Klip</span>
            </span>
            <span className="font-mono text-[11px] text-slate-400">.srt</span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={!hasSubtitle}
            onClick={() =>
              handleDownloadText(
                exportToVtt(selectedClip.subtitle),
                `subtitle-${slug}.vtt`,
                'text/vtt;charset=utf-8'
              )
            }
            className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-slate-200 hover:bg-white/[0.08] disabled:opacity-40 cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              <Subtitles className="h-3.5 w-3.5 text-slate-400" />
              <span>Subtitle WebVTT</span>
            </span>
            <span className="font-mono text-[11px] text-slate-400">.vtt</span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={!hasVoAudio}
            onClick={handleDownloadVoWav}
            className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-slate-200 hover:bg-white/[0.08] disabled:opacity-40 cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              <Mic className="h-3.5 w-3.5 text-slate-400" />
              <span>Audio Voice Over</span>
            </span>
            <span className="font-mono text-[11px] text-slate-400">.wav</span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={downloadingPng}
            onClick={handleDownloadThumbnail}
            className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-slate-200 hover:bg-white/[0.08] disabled:opacity-40 cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              {downloadingPng ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
              ) : (
                <ImageIcon className="h-3.5 w-3.5 text-slate-400" />
              )}
              <span>Thumbnail Teredit</span>
            </span>
            <span className="font-mono text-[11px] text-slate-400">.png</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() =>
              handleDownloadText(
                exportClipMetadataMarkdown(selectedClip, youtubeUrl),
                `metadata-${slug}.md`,
                'text/markdown;charset=utf-8'
              )
            }
            className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-slate-200 hover:bg-white/[0.08] cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-slate-400" />
              <span>Metadata, Hook &amp; Naskah</span>
            </span>
            <span className="font-mono text-[11px] text-slate-400">.md</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() =>
              handleDownloadText(
                exportSingleClipJson(selectedClip, youtubeUrl, videoId),
                `klip-${slug}.json`,
                'application/json;charset=utf-8'
              )
            }
            className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-slate-200 hover:bg-white/[0.08] cursor-pointer"
          >
            <span className="inline-flex items-center gap-2">
              <FileCode2 className="h-3.5 w-3.5 text-slate-400" />
              <span>Konfigurasi Klip</span>
            </span>
            <span className="font-mono text-[11px] text-slate-400">.json</span>
          </button>

          <div className="border-t border-white/[0.08] pt-2 px-1 space-y-1">
            <p className="font-mono text-[10px] text-violet-300 leading-snug">
              Edit aktif: {editTags.join(' · ')}
            </p>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {isLocalMp4
                ? 'Ekspor MP4 menerapkan trim, orientasi, crop/zoom, warna, kecepatan, fade, subtitle, dan voice over dalam format H.264/AAC siap re-upload.'
                : 'Mengunduh aset hasil edit klip (subtitle, voice over, thumbnail, metadata & skrip FFmpeg). Video asli YouTube tidak diunduh untuk menghormati hak cipta.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
