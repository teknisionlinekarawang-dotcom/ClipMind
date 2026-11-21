import React, { useState } from 'react';
import { Check, Copy, Gauge, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { serializeTranscriptContext, useClipMind } from '../../context/ClipMindContext';
import { auditClipRetention, generateClipMetadata } from '../../services/geminiService';
import type { AspectRatioPreset } from '../../types';
import { normalizeClipEditing } from '../../utils/mp4Helpers';
import { TimestampChip } from '../TimestampChip';

export function MetadataSubTab() {
  const {
    youtubeUrl,
    localVideoId,
    transcript,
    modelMode,
    durationSec,
    selectedClip,
    updateClip,
  } = useClipMind();
  const [loading, setLoading] = useState(false);
  const [auditLoading, setAuditLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [appliedHint, setAppliedHint] = useState<string | null>(null);

  if (!selectedClip) return null;
  const meta = selectedClip.metadata;
  const audit = selectedClip.retentionAudit;

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const handleGenerate = async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await generateClipMetadata({
        youtubeUrl: youtubeUrl || undefined,
        localVideoId: localVideoId || undefined,
        transcriptContextText: serializeTranscriptContext(transcript),
        clipTitle: selectedClip.judul,
        clipStart: selectedClip.mulai,
        clipEnd: selectedClip.selesai,
        mode: modelMode,
        durationHint: durationSec,
      });
      updateClip(selectedClip.id, { metadata: data });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat metadata klip.');
    } finally {
      setLoading(false);
    }
  };

  const handleRunRetentionAudit = async () => {
    setAuditError(null);
    setAuditLoading(true);
    try {
      const subtitleContext =
        selectedClip.subtitle.length > 0
          ? selectedClip.subtitle.map((s) => `[${s.mulai}d] ${s.teks}`).join('\n')
          : selectedClip.naskahVO.naskah || undefined;

      const data = await auditClipRetention({
        youtubeUrl: youtubeUrl || undefined,
        localVideoId: localVideoId || undefined,
        transcriptContextText: serializeTranscriptContext(transcript),
        clipTitle: selectedClip.judul,
        clipStart: selectedClip.mulai,
        clipEnd: selectedClip.selesai,
        currentRatio: selectedClip.rasio.rasio,
        subtitleContext,
        mode: modelMode,
        durationHint: durationSec,
      });
      updateClip(selectedClip.id, { retentionAudit: data });
    } catch (err) {
      setAuditError(
        err instanceof Error ? err.message : 'Gagal menjalankan audit retensi AI.'
      );
    } finally {
      setAuditLoading(false);
    }
  };

  const applyHookToThumbnail = () => {
    if (!audit?.hook_teks_saran) return;
    updateClip(selectedClip.id, {
      thumbnail: { ...selectedClip.thumbnail, text: audit.hook_teks_saran },
    });
    setAppliedHint('Hook diterapkan ke teks Thumbnail.');
    setTimeout(() => setAppliedHint(null), 2200);
  };

  const applyRatioAndSpeed = () => {
    if (!audit) return;
    const ed = normalizeClipEditing(selectedClip.editing);
    updateClip(selectedClip.id, {
      rasio: { ...selectedClip.rasio, rasio: audit.rekomendasi_rasio },
      editing: { ...ed, speed: audit.rekomendasi_kecepatan },
    });
    setAppliedHint(
      `Rasio ${audit.rekomendasi_rasio} & tempo ${audit.rekomendasi_kecepatan}x diterapkan ke editor.`
    );
    setTimeout(() => setAppliedHint(null), 2400);
  };

  const CopyBtn = ({ id, text }: { id: string; text: string }) => (
    <button
      type="button"
      onClick={() => copyText(id, text)}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-slate-300 hover:bg-white/10 hover:text-white cursor-pointer whitespace-nowrap shrink-0"
    >
      {copiedKey === id ? (
        <Check className="h-3 w-3 text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      <span>{copiedKey === id ? 'Tersalin' : 'Salin'}</span>
    </button>
  );

  return (
    <div className="space-y-5">
      {/* AI Retention & Hook Coach */}
      <section className="rounded-xl border border-white/[0.08] bg-[#0B0D12] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="flex items-center gap-1.5 text-xs font-semibold text-white">
              <Gauge className="h-3.5 w-3.5 text-emerald-400" />
              <span>AI Audit Retensi &amp; Optimasi Hook</span>
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Analisis kekuatan 3 detik pembuka, titik rawan penonton skip, dan saran edit otomatis.
            </p>
          </div>
          <button
            type="button"
            disabled={auditLoading}
            onClick={handleRunRetentionAudit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-600/20 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-600/30 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
          >
            {auditLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Gauge className="h-3.5 w-3.5" />
            )}
            <span>{audit ? 'Audit Ulang' : 'Audit Retensi Klip AI'}</span>
          </button>
        </div>

        {auditError && <p className="text-xs text-rose-300">{auditError}</p>}
        {appliedHint && <p className="text-xs text-emerald-300">{appliedHint}</p>}

        {audit && (
          <div className="space-y-3 border-t border-white/[0.06] pt-3">
            {/* Unboxed Tabular Audit Metrics */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-300">
              <span>
                Skor Hook:{' '}
                <strong className="font-mono tabular-nums text-white">{audit.skor_hook}/100</strong>
              </span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>
                Retensi:{' '}
                <strong className="font-mono tabular-nums text-white">{audit.skor_retensi}/100</strong>
              </span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>
                Kejelasan:{' '}
                <strong className="font-mono tabular-nums text-white">{audit.skor_kejelasan}/100</strong>
              </span>
              <span aria-hidden="true" className="text-slate-600">·</span>
              <span>
                Rekomendasi:{' '}
                <strong className="font-mono tabular-nums text-violet-300">
                  {audit.rekomendasi_rasio} ({audit.rekomendasi_kecepatan}x)
                </strong>
              </span>
            </div>

            <p className="text-xs leading-relaxed text-slate-200">{audit.ringkasan_audit}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs border-t border-white/[0.06] pt-2.5">
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-400">Teks Layar 3 Detik Pertama</span>
                <p className="font-medium text-amber-200">“{audit.hook_teks_saran}”</p>
                <p className="text-[11px] text-slate-400">{audit.hook_visual_saran}</p>
              </div>
              <div className="space-y-1">
                <span className="text-[11px] font-medium text-slate-400">CTA Penutup Disarankan</span>
                <p className="text-slate-200">{audit.cta_penutup}</p>
              </div>
            </div>

            {audit.titik_rawan_skip.length > 0 && (
              <div className="space-y-1.5 border-t border-white/[0.06] pt-2.5">
                <span className="block text-[11px] font-medium text-slate-400">
                  Titik Rawan Penonton Skip
                </span>
                <ul className="space-y-1.5">
                  {audit.titik_rawan_skip.map((item, idx) => (
                    <li
                      key={idx}
                      className="flex items-start gap-2.5 text-xs text-slate-300"
                    >
                      <span className="shrink-0 mt-0.5">
                        <TimestampChip
                          seconds={selectedClip.mulai + item.detik_relatif}
                          label={`+${item.detik_relatif}d`}
                        />
                      </span>
                      <div className="min-w-0">
                        <span className="text-white font-medium">{item.masalah}</span>
                        <span className="text-slate-400"> — {item.solusi}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={applyHookToThumbnail}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.12] cursor-pointer whitespace-nowrap shrink-0"
              >
                <Wand2 className="h-3.5 w-3.5 text-amber-300" />
                <span>Terapkan Hook ke Thumbnail</span>
              </button>
              <button
                type="button"
                onClick={applyRatioAndSpeed}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.12] cursor-pointer whitespace-nowrap shrink-0"
              >
                <Wand2 className="h-3.5 w-3.5 text-violet-300" />
                <span>Terapkan Rasio &amp; Tempo ({audit.rekomendasi_rasio})</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Social Metadata & Hooks */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-slate-400">
          Hook 3 detik pertama, judul &amp; caption siap posting untuk Shorts, TikTok, Reels, dan X.
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={handleGenerate}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          <span>{meta ? 'Buat ulang' : 'Buat Metadata & Hook'}</span>
        </button>
      </div>

      {error && <p className="text-xs text-rose-300">{error}</p>}

      {!meta ? (
        <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-xs text-slate-400">
          Klik &ldquo;Buat Metadata &amp; Hook&rdquo; untuk menyiapkan paket publikasi multi-platform.
        </div>
      ) : (
        <div className="space-y-3">
          {/* 3 Hooks */}
          <div className="rounded-xl border border-white/[0.08] bg-[#0B0D12] p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-white">3 Opsi Hook 3 Detik Pertama</h4>
              <CopyBtn id="hooks" text={meta.hooks.join('\n')} />
            </div>
            <ul className="space-y-1.5 text-xs text-slate-200">
              {meta.hooks.map((h, i) => (
                <li key={i} className="flex items-start justify-between gap-2 rounded bg-white/[0.03] px-2.5 py-1.5">
                  <span>{i + 1}. {h}</span>
                  <CopyBtn id={`hook-${i}`} text={h} />
                </li>
              ))}
            </ul>
          </div>

          {/* Platform Titles & Captions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { id: 'shorts', label: 'YouTube Shorts', title: meta.judul_shorts, caption: meta.caption_shorts },
              { id: 'tiktok', label: 'TikTok', title: meta.judul_tiktok, caption: meta.caption_tiktok },
              { id: 'reels', label: 'Instagram Reels', title: meta.judul_reels, caption: meta.caption_reels },
              { id: 'x', label: 'X / Twitter', title: meta.judul_x, caption: meta.caption_x },
            ].map((p) => (
              <div key={p.id} className="rounded-xl border border-white/[0.08] bg-[#0B0D12] p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-violet-300">{p.label}</span>
                  <CopyBtn id={p.id} text={`${p.title}\n\n${p.caption}`} />
                </div>
                <p className="text-xs font-medium text-white">{p.title}</p>
                <p className="text-xs text-slate-400 leading-relaxed">{p.caption}</p>
              </div>
            ))}
          </div>

          {/* Description & 10 Hashtags */}
          <div className="rounded-xl border border-white/[0.08] bg-[#0B0D12] p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-white">Deskripsi &amp; 10 Hashtag</h4>
              <CopyBtn
                id="desc-hash"
                text={`${meta.deskripsi}\n\n${meta.hashtag.join(' ')}`}
              />
            </div>
            <p className="text-xs text-slate-300">{meta.deskripsi}</p>
            <p className="text-xs font-mono text-violet-300">{meta.hashtag.join(' ')}</p>
          </div>
        </div>
      )}
    </div>
  );
}

const RATIOS: Array<{ key: AspectRatioPreset; desc: string }> = [
  { key: '16:9', desc: 'YouTube Lanskap' },
  { key: '9:16', desc: 'Shorts / TikTok / Reels' },
  { key: '1:1', desc: 'Feed Persegi' },
  { key: '4:5', desc: 'Feed Potret' },
];

export function ReframeSubTab() {
  const { sourceType, selectedClip, updateClip, playRange } = useClipMind();
  if (!selectedClip) return null;

  const { rasio, fokusX } = selectedClip.rasio;

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        {sourceType === 'local'
          ? 'Atur pemotongan rasio dan titik fokus horizontal langsung pada pemutar video di sebelah kiri. Pengaturan ini ikut dirender otomatis ke video MP4 saat diunduh.'
          : 'Pratinjau pemotongan rasio dan titik fokus horizontal langsung pada pemutar video di sebelah kiri (khusus pratinjau tampilan, tanpa merender file video MP4).'}
      </p>

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
            className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${
              rasio === item.key
                ? 'border-violet-500 bg-violet-500/15 text-white'
                : 'border-white/[0.08] bg-[#0B0D12] text-slate-300 hover:border-white/20'
            }`}
          >
            <div className="font-mono text-sm font-bold">{item.key}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{item.desc}</div>
          </button>
        ))}
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-[#0B0D12] p-4 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-300 font-medium">Posisi Fokus Horizontal</span>
          <span className="font-mono text-violet-300 tabular-nums">{fokusX}%</span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          aria-label="Posisi fokus horizontal"
          value={fokusX}
          disabled={rasio === '16:9'}
          onChange={(e) =>
            updateClip(selectedClip.id, {
              rasio: { ...selectedClip.rasio, fokusX: Number(e.target.value) },
            })
          }
          className="w-full accent-violet-500 disabled:opacity-40"
        />
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>Kiri (0%)</span>
          <span>Tengah (50%)</span>
          <span>Kanan (100%)</span>
        </div>

        <button
          type="button"
          onClick={() => playRange(selectedClip.mulai, selectedClip.selesai)}
          className="rounded-lg bg-white/[0.08] px-3 py-1.5 text-xs font-medium text-white hover:bg-white/[0.14] cursor-pointer"
        >
          Putar Pratinjau Reframe
        </button>
      </div>
    </div>
  );
}
