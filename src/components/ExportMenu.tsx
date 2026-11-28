import React, { useRef, useState } from 'react';
import { ChevronDown, Download, Loader2, Upload } from 'lucide-react';
import { useClipMind } from '../context/ClipMindContext';
import { exportLocalClipMp4 } from '../services/geminiService';
import {
  buildEditedClipZip,
  exportClipMetadataMarkdown,
  sanitizeFileSlug,
  triggerBlobDownload,
} from '../utils/clipExport';
import { normalizeClipEditing } from '../utils/mp4Helpers';
import { exportSummaryToMarkdown, exportToSrt, exportTranscriptToTxt } from '../utils/subtitles';

export function ExportMenu() {
  const {
    sourceType,
    localVideoId,
    videoId,
    youtubeUrl,
    summary,
    transcript,
    selectedClip,
    exportProjectJson,
    importProjectJson,
    setGlobalError,
  } = useClipMind();

  const [open, setOpen] = useState(false);
  const [downloadingClipZip, setDownloadingClipZip] = useState(false);
  const [renderingClipMp4, setRenderingClipMp4] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const downloadBlob = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const res = importProjectJson(reader.result);
        if (!res.ok && res.error) {
          setGlobalError(res.error);
        }
      }
      setOpen(false);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/[0.1] whitespace-nowrap shrink-0 cursor-pointer"
      >
        <Download className="h-3.5 w-3.5" />
        <span>Ekspor / Proyek</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-60 rounded-xl border border-white/10 bg-[#141926] p-1.5 shadow-2xl z-50 space-y-1 text-xs"
        >
          <button
            type="button"
            role="menuitem"
            disabled={!videoId}
            onClick={() =>
              downloadBlob(
                exportProjectJson(),
                `clipmind-proyek-${videoId || 'baru'}.json`,
                'application/json;charset=utf-8'
              )
            }
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-white/[0.08] disabled:opacity-40 cursor-pointer"
          >
            <span>Ekspor Proyek</span>
            <span className="font-mono text-[11px] text-slate-400">.json</span>
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => fileRef.current?.click()}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-white/[0.08] cursor-pointer"
          >
            <span className="inline-flex items-center gap-1.5">
              <Upload className="h-3.5 w-3.5 text-violet-400" />
              <span>Impor Proyek</span>
            </span>
            <span className="font-mono text-[11px] text-slate-400">.json</span>
          </button>

          <div className="my-1 border-t border-white/[0.08]" />

          <button
            type="button"
            role="menuitem"
            disabled={!summary}
            onClick={() =>
              summary &&
              downloadBlob(
                exportSummaryToMarkdown(summary, youtubeUrl),
                `ringkasan-${videoId}.md`,
                'text/markdown;charset=utf-8'
              )
            }
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-white/[0.08] disabled:opacity-40 cursor-pointer"
          >
            <span>Unduh Ringkasan</span>
            <span className="font-mono text-[11px] text-slate-400">.md</span>
          </button>

          {((sourceType === 'local' && localVideoId) ||
            (sourceType === 'youtube' && youtubeUrl)) && (
            <button
              type="button"
              role="menuitem"
              disabled={!selectedClip || renderingClipMp4}
              onClick={async () => {
                if (!selectedClip) return;
                setRenderingClipMp4(true);
                const ed = normalizeClipEditing(selectedClip.editing);
                try {
                  const mp4Blob = await exportLocalClipMp4({
                    localVideoId: sourceType === 'local' ? localVideoId || undefined : undefined,
                    youtubeUrl: sourceType === 'youtube' ? youtubeUrl || undefined : undefined,
                    clip: selectedClip,
                    burnSubtitles: selectedClip.subtitle.length > 0 && ed.burnSubtitles,
                    includeVoiceOver:
                      Boolean(selectedClip.naskahVO.audioBase64Pcm) && ed.includeVoiceOver,
                  });
                  triggerBlobDownload(
                    mp4Blob,
                    `clipmind-${sanitizeFileSlug(selectedClip.judul)}-siap-upload.mp4`
                  );
                  setOpen(false);
                } catch (err) {
                  setGlobalError(
                    err instanceof Error ? err.message : 'Gagal merender klip MP4.'
                  );
                } finally {
                  setRenderingClipMp4(false);
                }
              }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-emerald-200 hover:bg-emerald-500/15 disabled:opacity-40 cursor-pointer"
            >
              <span className="inline-flex items-center gap-1.5 font-medium">
                {renderingClipMp4 && <Loader2 className="h-3 w-3 animate-spin" />}
                <span>{renderingClipMp4 ? 'Merender MP4…' : 'Video Klip Aktif'}</span>
              </span>
              <span className="font-mono text-[11px] text-emerald-300">.mp4</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            disabled={!selectedClip || downloadingClipZip}
            onClick={async () => {
              if (!selectedClip) return;
              setDownloadingClipZip(true);
              try {
                const zipBlob = await buildEditedClipZip(selectedClip, youtubeUrl, videoId);
                triggerBlobDownload(
                  zipBlob,
                  `clipmind-${sanitizeFileSlug(selectedClip.judul)}.zip`
                );
                setOpen(false);
              } catch (err) {
                setGlobalError(
                  err instanceof Error ? err.message : 'Gagal membuat paket ZIP klip.'
                );
              } finally {
                setDownloadingClipZip(false);
              }
            }}
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-white/[0.08] disabled:opacity-40 cursor-pointer"
          >
            <span className="inline-flex items-center gap-1.5">
              {downloadingClipZip && <Loader2 className="h-3 w-3 animate-spin" />}
              <span>Paket Klip Aktif</span>
            </span>
            <span className="font-mono text-[11px] text-violet-300">.zip</span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={!selectedClip}
            onClick={() =>
              selectedClip &&
              downloadBlob(
                exportClipMetadataMarkdown(selectedClip, youtubeUrl),
                `metadata-${sanitizeFileSlug(selectedClip.judul)}.md`,
                'text/markdown;charset=utf-8'
              )
            }
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-white/[0.08] disabled:opacity-40 cursor-pointer"
          >
            <span>Metadata Klip Aktif</span>
            <span className="font-mono text-[11px] text-slate-400">.md</span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={!selectedClip || selectedClip.subtitle.length === 0}
            onClick={() =>
              selectedClip &&
              downloadBlob(
                exportToSrt(selectedClip.subtitle),
                `subtitle-klip-${videoId}.srt`,
                'text/plain;charset=utf-8'
              )
            }
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-white/[0.08] disabled:opacity-40 cursor-pointer"
          >
            <span>Subtitle Klip Aktif</span>
            <span className="font-mono text-[11px] text-slate-400">.srt</span>
          </button>

          <button
            type="button"
            role="menuitem"
            disabled={transcript.length === 0}
            onClick={() =>
              downloadBlob(
                exportTranscriptToTxt(transcript),
                `transkrip-${videoId}.txt`,
                'text/plain;charset=utf-8'
              )
            }
            className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-slate-200 hover:bg-white/[0.08] disabled:opacity-40 cursor-pointer"
          >
            <span>Transkrip Penuh</span>
            <span className="font-mono text-[11px] text-slate-400">.txt</span>
          </button>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        onChange={handleImport}
        className="hidden"
      />
    </div>
  );
}
