import React, { useEffect, useRef, useState } from 'react';
import { Download, Image as ImageIcon, Loader2, Sparkles, Upload } from 'lucide-react';
import { serializeTranscriptContext, useClipMind } from '../../context/ClipMindContext';
import { generateThumbnailIdeas } from '../../services/geminiService';
import type { ThumbnailEditorState, ThumbnailIdea } from '../../types';
import {
  drawThumbnailOnCanvas,
  loadThumbnailBackground,
} from '../../utils/thumbnailRenderer';

const EMOJI_STICKERS = ['', '🔥', '⚡', '🤯', '💡', '🎯', '🚀', '❗'];

export function ThumbnailSubTab() {
  const {
    sourceType,
    localVideoId,
    transcript,
    videoId,
    youtubeUrl,
    modelMode,
    durationSec,
    selectedClip,
    updateClip,
  } = useClipMind();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loadingIdeas, setLoadingIdeas] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null);
  const [draggingTarget, setDraggingTarget] = useState<'text' | 'sticker' | null>(null);

  const thumb = selectedClip?.thumbnail;

  // Load background image (YouTube maxres proxy or custom uploaded image)
  useEffect(() => {
    if (!thumb || !videoId) return;
    let cancelled = false;
    loadThumbnailBackground(thumb, videoId).then((img) => {
      if (!cancelled) setBgImg(img);
    });
    return () => {
      cancelled = true;
    };
  }, [thumb?.backgroundMode, thumb?.customImageUrl, videoId]);

  // Draw canvas whenever editor state changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !thumb) return;
    drawThumbnailOnCanvas(canvas, thumb, bgImg);
  }, [bgImg, thumb]);

  if (!selectedClip || !thumb) return null;

  const patchThumb = (patch: Partial<ThumbnailEditorState>) => {
    updateClip(selectedClip.id, { thumbnail: { ...thumb, ...patch } });
  };

  const handleGenerateIdeas = async () => {
    setError(null);
    setLoadingIdeas(true);
    try {
      const ideas = await generateThumbnailIdeas({
        youtubeUrl: youtubeUrl || undefined,
        localVideoId: localVideoId || undefined,
        transcriptContextText: serializeTranscriptContext(transcript),
        clipTitle: selectedClip.judul,
        clipStart: selectedClip.mulai,
        clipEnd: selectedClip.selesai,
        mode: modelMode,
        durationHint: durationSec,
      });
      patchThumb({ ideas });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat ide thumbnail.');
    } finally {
      setLoadingIdeas(false);
    }
  };

  const applyIdea = (idea: ThumbnailIdea) => {
    const emo = idea.emosi.toLowerCase();
    const palette =
      emo.includes('kaget') || emo.includes('tegas')
        ? 'crimson-gold'
        : emo.includes('inspirasi') || emo.includes('sukses')
        ? 'emerald-slate'
        : 'violet-blue';
    patchThumb({
      text: idea.teks_thumbnail,
      gradientPalette: palette,
    });
  };

  const handleCanvasPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0.08, Math.min(0.92, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0.08, Math.min(0.92, (e.clientY - rect.top) / rect.height));
    if (draggingTarget === 'sticker') {
      patchThumb({ stickerX: x, stickerY: y });
    } else if (draggingTarget === 'text') {
      patchThumb({ textX: x, textY: y });
    }
  };

  const handleUploadCustomImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        patchThumb({ backgroundMode: 'custom', customImageUrl: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  const handleDownloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `thumbnail-${selectedClip.judul.slice(0, 24).replace(/[^a-z0-9]/gi, '-')}.png`;
    a.click();
  };

  return (
    <div className="space-y-4">
      {/* Top Actions */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          disabled={loadingIdeas}
          onClick={handleGenerateIdeas}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
        >
          {loadingIdeas ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          <span>Buat 5 ide judul &amp; thumbnail</span>
        </button>

        <button
          type="button"
          onClick={handleDownloadPng}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white hover:bg-white/[0.12] cursor-pointer whitespace-nowrap shrink-0"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Unduh PNG</span>
        </button>
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      {/* 5 Ideas List */}
      {thumb.ideas.length > 0 && (
        <div className="grid grid-cols-1 gap-2 max-h-[210px] overflow-y-auto pr-1">
          {thumb.ideas.map((idea, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => applyIdea(idea)}
              className="rounded-lg border border-white/[0.08] bg-[#0B0D12] p-3 text-left hover:border-violet-500/60 transition-colors cursor-pointer space-y-1"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white">{idea.judul_klikbait_sehat}</span>
                <span className="text-[11px] font-mono text-violet-300 shrink-0">
                  {idea.emosi}
                </span>
              </div>
              <p className="text-xs text-amber-300 font-semibold">
                Teks: “{idea.teks_thumbnail}”
              </p>
              <p className="text-[11px] text-slate-400">{idea.deskripsi_visual}</p>
            </button>
          ))}
        </div>
      )}

      {/* Canvas Preview */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0B0D12] p-3 flex flex-col items-center gap-2">
        <canvas
          ref={canvasRef}
          data-testid="thumbnail-canvas"
          onPointerDown={(e) => {
            setDraggingTarget('text');
            handleCanvasPointer(e);
          }}
          onPointerMove={(e) => draggingTarget && handleCanvasPointer(e)}
          onPointerUp={() => setDraggingTarget(null)}
          onPointerLeave={() => setDraggingTarget(null)}
          className={`rounded-lg border border-white/10 cursor-move ${
            thumb.aspectRatio === '9:16' ? 'max-h-[340px] w-auto' : 'w-full h-auto'
          }`}
        />
        <p className="text-[11px] text-slate-500">
          Klik &amp; seret pada kanvas untuk memindahkan posisi teks.
        </p>
      </div>

      {/* Canvas Editor Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <div className="space-y-2">
          <span className="block text-slate-400">Sumber Latar &amp; Rasio</span>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => patchThumb({ backgroundMode: 'youtube' })}
              className={`rounded-md px-2.5 py-1.5 font-medium cursor-pointer ${
                thumb.backgroundMode === 'youtube'
                  ? 'bg-violet-600 text-white'
                  : 'bg-white/[0.05] text-slate-300'
              }`}
            >
              {sourceType === 'local' ? 'Frame Video' : 'Frame YouTube'}
            </button>
            <button
              type="button"
              onClick={() => patchThumb({ backgroundMode: 'gradient' })}
              className={`rounded-md px-2.5 py-1.5 font-medium cursor-pointer ${
                thumb.backgroundMode === 'gradient'
                  ? 'bg-violet-600 text-white'
                  : 'bg-white/[0.05] text-slate-300'
              }`}
            >
              Latar Studio
            </button>
            <label className="inline-flex items-center gap-1 rounded-md bg-white/[0.05] px-2.5 py-1.5 text-slate-200 hover:bg-white/[0.1] cursor-pointer">
              <Upload className="h-3 w-3" />
              <span>Unggah</span>
              <input type="file" accept="image/*" onChange={handleUploadCustomImage} className="hidden" />
            </label>
          </div>
          <p className="text-[11px] text-slate-500">
            <ImageIcon className="inline h-3 w-3 mr-1" />
            Pembuatan gambar AI memerlukan kunci API berbayar di Settings &gt; Secrets. Gunakan Frame YouTube, Latar Studio, atau unggah gambar lokal.
          </p>
        </div>

        <div className="space-y-2">
          <span className="block text-slate-400">Rasio &amp; Palet Studio</span>
          <div className="flex flex-wrap gap-1.5">
            {(['16:9', '9:16'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => patchThumb({ aspectRatio: r })}
                className={`rounded-md px-2.5 py-1.5 font-mono cursor-pointer ${
                  thumb.aspectRatio === r
                    ? 'bg-white/20 text-white'
                    : 'bg-white/[0.05] text-slate-400'
                }`}
              >
                {r}
              </button>
            ))}
            <select
              value={thumb.gradientPalette}
              onChange={(e) => patchThumb({ gradientPalette: e.target.value })}
              className="rounded-md border border-white/10 bg-[#121620] px-2 py-1 text-xs text-white"
            >
              <option value="violet-blue">Ungu-Biru</option>
              <option value="crimson-gold">Merah-Emas</option>
              <option value="emerald-slate">Zamrud-Gelap</option>
              <option value="midnight-amber">Malam-Amber</option>
            </select>
          </div>
        </div>

        <label className="space-y-1 sm:col-span-2">
          <span className="block text-slate-400">Teks Thumbnail (maks. 4 kata disarankan)</span>
          <input
            type="text"
            value={thumb.text}
            onChange={(e) => patchThumb({ text: e.target.value })}
            className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-xs text-white"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-slate-400">Ukuran Teks ({thumb.fontSize}px)</span>
          <input
            type="range"
            min={24}
            max={96}
            value={thumb.fontSize}
            onChange={(e) => patchThumb({ fontSize: Number(e.target.value) })}
            className="w-full accent-violet-500"
          />
        </label>

        <label className="space-y-1">
          <span className="block text-slate-400">
            Overlay Gelap ({Math.round(thumb.darkOverlay * 100)}%)
          </span>
          <input
            type="range"
            min={0}
            max={85}
            value={Math.round(thumb.darkOverlay * 100)}
            onChange={(e) => patchThumb({ darkOverlay: Number(e.target.value) / 100 })}
            className="w-full accent-violet-500"
          />
        </label>

        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5">
            <span className="text-slate-400">Teks</span>
            <input
              type="color"
              value={thumb.textColor}
              onChange={(e) => patchThumb({ textColor: e.target.value })}
              className="h-7 w-9 bg-transparent cursor-pointer"
            />
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-slate-400">Outline</span>
            <input
              type="color"
              value={thumb.strokeColor}
              onChange={(e) => patchThumb({ strokeColor: e.target.value })}
              className="h-7 w-9 bg-transparent cursor-pointer"
            />
          </label>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-slate-400 mr-1">Stiker:</span>
          {EMOJI_STICKERS.map((em) => (
            <button
              key={em || 'none'}
              type="button"
              onClick={() => patchThumb({ sticker: em })}
              className={`rounded px-2 py-1 text-sm cursor-pointer ${
                thumb.sticker === em ? 'bg-violet-600 text-white' : 'bg-white/[0.05]'
              }`}
            >
              {em || 'Tanpa'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
