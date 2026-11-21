import type { ThumbnailEditorState } from '../types';

export const THUMBNAIL_PALETTES: Record<string, [string, string, string]> = {
  'violet-blue': ['#1E103C', '#4C1D95', '#1D4ED8'],
  'crimson-gold': ['#2A0A12', '#9F1239', '#D97706'],
  'emerald-slate': ['#071D1A', '#065F46', '#0F172A'],
  'midnight-amber': ['#0B0D12', '#1E293B', '#B45309'],
};

export function drawThumbnailOnCanvas(
  canvas: HTMLCanvasElement,
  thumb: ThumbnailEditorState,
  bgImg: HTMLImageElement | null
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const width = thumb.aspectRatio === '9:16' ? 540 : 960;
  const height = thumb.aspectRatio === '9:16' ? 960 : 540;
  canvas.width = width;
  canvas.height = height;

  // 1. Background
  if (bgImg) {
    const imgRatio = bgImg.width / bgImg.height;
    const canvasRatio = width / height;
    let drawW = width;
    let drawH = height;
    let offsetX = 0;
    let offsetY = 0;
    if (imgRatio > canvasRatio) {
      drawW = height * imgRatio;
      offsetX = -(drawW - width) / 2;
    } else {
      drawH = width / imgRatio;
      offsetY = -(drawH - height) / 2;
    }
    ctx.drawImage(bgImg, offsetX, offsetY, drawW, drawH);
  } else {
    const cols = THUMBNAIL_PALETTES[thumb.gradientPalette] ?? THUMBNAIL_PALETTES['violet-blue'];
    const grad = ctx.createLinearGradient(0, 0, width, height);
    grad.addColorStop(0, cols[0]);
    grad.addColorStop(0.55, cols[1]);
    grad.addColorStop(1, cols[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(width * 0.78, height * 0.25, width * 0.28, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 2. Dark Overlay Scrim
  if (thumb.darkOverlay > 0) {
    const scrim = ctx.createLinearGradient(0, 0, 0, height);
    scrim.addColorStop(0, `rgba(0,0,0,${thumb.darkOverlay * 0.4})`);
    scrim.addColorStop(1, `rgba(0,0,0,${thumb.darkOverlay})`);
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, width, height);
  }

  // 3. Text
  if (thumb.text.trim()) {
    ctx.save();
    ctx.font = `800 ${thumb.fontSize}px "${thumb.fontFamily}", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = thumb.shadowBlur;
    ctx.lineWidth = Math.max(4, Math.round(thumb.fontSize * 0.14));
    ctx.strokeStyle = thumb.strokeColor;
    ctx.fillStyle = thumb.textColor;

    const lines = thumb.text.toUpperCase().split('\n');
    const lineHeight = thumb.fontSize * 1.15;
    const startY = thumb.textY * height - ((lines.length - 1) * lineHeight) / 2;

    lines.forEach((line, idx) => {
      const y = startY + idx * lineHeight;
      ctx.strokeText(line, thumb.textX * width, y, width - 72);
      ctx.fillText(line, thumb.textX * width, y, width - 72);
    });
    ctx.restore();
  }

  // 4. Emoji Sticker
  if (thumb.sticker) {
    ctx.save();
    ctx.font = `${Math.round(thumb.fontSize * 1.35)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(thumb.sticker, thumb.stickerX * width, thumb.stickerY * height);
    ctx.restore();
  }
}

export function loadThumbnailBackground(
  thumb: ThumbnailEditorState,
  videoId: string | null,
  timeoutMs = 5000
): Promise<HTMLImageElement | null> {
  if (thumb.backgroundMode === 'gradient') {
    return Promise.resolve(null);
  }
  const isLocal = Boolean(videoId && videoId.startsWith('local-'));
  const src =
    thumb.backgroundMode === 'custom' && thumb.customImageUrl
      ? thumb.customImageUrl
      : videoId
      ? isLocal
        ? `/api/local-video/thumbnail/${encodeURIComponent(videoId)}`
        : `/api/youtube/thumbnail?videoId=${encodeURIComponent(videoId)}`
      : null;

  if (!src) return Promise.resolve(null);

  return new Promise((resolve) => {
    const img = new Image();
    let settled = false;
    const finish = (result: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      clearTimeout(timer);
      finish(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    img.src = src;
  });
}

export async function renderThumbnailPngBlob(
  thumb: ThumbnailEditorState,
  videoId: string | null
): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  const bgImg = await loadThumbnailBackground(thumb, videoId);
  const canvas = document.createElement('canvas');
  drawThumbnailOnCanvas(canvas, thumb, bgImg);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}
