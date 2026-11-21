import React, { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type { QuoteCardItem } from '../types';

interface StudioQuoteCanvasProps {
  quote: QuoteCardItem;
  videoTitle: string;
}

const TEMPLATES = [
  { id: 'obsidian', label: 'Obsidian', bg1: '#0B0D12', bg2: '#1E1B4B', text: '#F8FAFC', accent: '#A78BFA' },
  { id: 'aurora', label: 'Aurora', bg1: '#0F172A', bg2: '#1D4ED8', text: '#FFFFFF', accent: '#93C5FD' },
  { id: 'paper', label: 'Editorial', bg1: '#F8FAFC', bg2: '#E2E8F0', text: '#0F172A', accent: '#4F46E5' },
] as const;

export function StudioQuoteCanvas({ quote, videoTitle }: StudioQuoteCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [templateIdx, setTemplateIdx] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const tpl = TEMPLATES[templateIdx];
    const W = 800;
    const H = 500;
    canvas.width = W;
    canvas.height = H;

    const grad = ctx.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, tpl.bg1);
    grad.addColorStop(1, tpl.bg2);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Subtle border
    ctx.strokeStyle = tpl.accent;
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 3;
    ctx.strokeRect(24, 24, W - 48, H - 48);
    ctx.globalAlpha = 1;

    // Quote mark
    ctx.fillStyle = tpl.accent;
    ctx.font = '700 72px Georgia, serif';
    ctx.fillText('“', 56, 118);

    // Wrap quote text
    ctx.fillStyle = tpl.text;
    ctx.font = '600 28px "Plus Jakarta Sans", sans-serif';
    const words = quote.kutipan.split(/\s+/);
    const lines: string[] = [];
    let current = '';
    for (const w of words) {
      const test = current ? `${current} ${w}` : w;
      if (ctx.measureText(test).width > W - 120) {
        lines.push(current);
        current = w;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);

    let y = 165;
    for (const line of lines.slice(0, 6)) {
      ctx.fillText(line, 60, y);
      y += 42;
    }

    // Attribution
    ctx.fillStyle = tpl.accent;
    ctx.font = '600 18px "DM Sans", sans-serif';
    ctx.fillText(`— ${quote.pembicara || 'Pembicara'}`, 60, H - 78);

    ctx.fillStyle = tpl.text;
    ctx.globalAlpha = 0.55;
    ctx.font = '400 14px "DM Sans", sans-serif';
    ctx.fillText(videoTitle.slice(0, 64), 60, H - 50);
    ctx.globalAlpha = 1;
  }, [quote, templateIdx, videoTitle]);

  const downloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `kutipan-${quote.detik}s.png`;
    a.click();
  };

  return (
    <div className="space-y-2 pt-2 border-t border-white/[0.06]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          {TEMPLATES.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTemplateIdx(i)}
              className={`rounded px-2 py-1 text-[11px] font-medium cursor-pointer ${
                templateIdx === i
                  ? 'bg-violet-600 text-white'
                  : 'bg-white/[0.06] text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={downloadPng}
          className="inline-flex items-center gap-1 rounded bg-white/[0.08] px-2.5 py-1 text-xs text-white hover:bg-white/[0.15] cursor-pointer"
        >
          <Download className="h-3 w-3" />
          <span>Unduh PNG</span>
        </button>
      </div>
      <canvas ref={canvasRef} className="w-full h-auto rounded-lg border border-white/10" />
    </div>
  );
}
