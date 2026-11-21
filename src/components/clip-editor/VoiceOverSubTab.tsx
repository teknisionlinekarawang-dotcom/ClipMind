import React, { useEffect, useMemo, useState } from 'react';
import {
  Download,
  Languages,
  Loader2,
  Mic,
  Play,
  Sparkles,
  Subtitles,
  Volume2,
} from 'lucide-react';
import { serializeTranscriptContext, useClipMind } from '../../context/ClipMindContext';
import {
  generateOrTranslateSubtitles,
  generateVoiceOverAudio,
  generateVoiceOverScript,
} from '../../services/geminiService';
import type { GeminiVoiceName, VoiceOverTone } from '../../types';
import { base64ToUint8Array, wrapPcmToWav } from '../../utils/audio';
import { buildTimedSubtitlesFromScript } from '../../utils/subtitles';

const TONES: VoiceOverTone[] = ['Informatif', 'Santai', 'Dramatis', 'Humor', 'Profesional'];
const VOICES: Array<{ name: GeminiVoiceName; desc: string }> = [
  { name: 'Kore', desc: 'Tegas & Jernih' },
  { name: 'Puck', desc: 'Ceria & Dinamis' },
  { name: 'Charon', desc: 'Berat & Berwibawa' },
  { name: 'Zephyr', desc: 'Hangat & Natural' },
  { name: 'Fenrir', desc: 'Cepat & Enerjik' },
  { name: 'Aoede', desc: 'Lembut & Ekspresif' },
];
const LANGUAGES = ['Indonesia', 'Inggris', 'Jepang', 'Korea', 'Arab', 'Spanyol'];

export function VoiceOverSubTab() {
  const {
    youtubeUrl,
    localVideoId,
    transcript,
    modelMode,
    durationSec,
    selectedClip,
    updateClip,
    playRange,
  } = useClipMind();

  const [loadingScript, setLoadingScript] = useState(false);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [sampleLoading, setSampleLoading] = useState<string | null>(null);
  const [autoSyncSubtitle, setAutoSyncSubtitle] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const wavUrl = useMemo(() => {
    if (!selectedClip?.naskahVO.audioBase64Pcm) return null;
    try {
      const pcmBytes = base64ToUint8Array(selectedClip.naskahVO.audioBase64Pcm);
      const blob = wrapPcmToWav(pcmBytes, 24000, 1, 16);
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }, [selectedClip?.naskahVO.audioBase64Pcm]);

  useEffect(() => {
    return () => {
      if (wavUrl) URL.revokeObjectURL(wavUrl);
    };
  }, [wavUrl]);

  if (!selectedClip) return null;

  const vo = selectedClip.naskahVO;
  const clipDuration = Math.max(1, selectedClip.selesai - selectedClip.mulai);
  const targetWords = Math.max(12, Math.round(clipDuration * 2.5));
  const currentWords = vo.naskah.trim() ? vo.naskah.trim().split(/\s+/).length : 0;

  const patchVo = (patch: Partial<typeof vo>) => {
    updateClip(selectedClip.id, { naskahVO: { ...vo, ...patch } });
  };

  const syncScriptToSubtitles = (scriptText: string) => {
    const subs = buildTimedSubtitlesFromScript(scriptText, clipDuration, true);
    updateClip(selectedClip.id, {
      subtitle: subs,
      naskahVO: { ...vo, naskah: scriptText },
    });
  };

  const handleWriteScript = async () => {
    setError(null);
    setLoadingScript(true);
    try {
      const subContext = selectedClip.subtitle.map((s) => s.teks).join(' ');
      const res = await generateVoiceOverScript({
        youtubeUrl: youtubeUrl || undefined,
        localVideoId: localVideoId || undefined,
        transcriptContextText: serializeTranscriptContext(transcript),
        clipStart: selectedClip.mulai,
        clipEnd: selectedClip.selesai,
        tone: vo.nada,
        targetLanguage: vo.bahasa,
        subtitleContext: subContext || undefined,
        mode: modelMode,
        durationHint: durationSec,
      });
      if (autoSyncSubtitle && res.naskah.trim()) {
        const subs = buildTimedSubtitlesFromScript(res.naskah, clipDuration, true);
        updateClip(selectedClip.id, {
          subtitle: subs,
          naskahVO: { ...vo, naskah: res.naskah },
        });
      } else {
        patchVo({ naskah: res.naskah });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menulis naskah VO.');
    } finally {
      setLoadingScript(false);
    }
  };

  const handleDubbingTranslate = async () => {
    setError(null);
    setLoadingScript(true);
    try {
      const sourceLines =
        selectedClip.subtitle.length > 0
          ? selectedClip.subtitle
          : await generateOrTranslateSubtitles({
              youtubeUrl: youtubeUrl || undefined,
              localVideoId: localVideoId || undefined,
              transcriptContextText: serializeTranscriptContext(transcript),
              clipStart: selectedClip.mulai,
              clipEnd: selectedClip.selesai,
              targetLanguage: 'Indonesia',
              mode: modelMode,
              durationHint: durationSec,
            });
      const translated = await generateOrTranslateSubtitles({
        youtubeUrl: youtubeUrl || undefined,
        localVideoId: localVideoId || undefined,
        clipStart: selectedClip.mulai,
        clipEnd: selectedClip.selesai,
        targetLanguage: vo.bahasa,
        existingLines: sourceLines,
        mode: modelMode,
        durationHint: durationSec,
      });
      const combined = translated.map((l) => l.teks.replace(/\n/g, ' ')).join(' ');
      if (autoSyncSubtitle) {
        updateClip(selectedClip.id, {
          subtitle: translated,
          naskahVO: { ...vo, naskah: combined },
        });
      } else {
        patchVo({ naskah: combined });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat dubbing terjemahan.');
    } finally {
      setLoadingScript(false);
    }
  };

  const handleGenerateVoice = async () => {
    if (!vo.naskah.trim()) {
      setError('Tulis atau buat naskah narasi terlebih dahulu.');
      return;
    }
    setError(null);
    setLoadingAudio(true);
    try {
      const res = await generateVoiceOverAudio({
        text: vo.naskah,
        voiceName: vo.suara,
        speakingStyle: vo.gayaBicara,
      });
      patchVo({ audioBase64Pcm: res.pcmBase64 });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghasilkan audio TTS.');
    } finally {
      setLoadingAudio(false);
    }
  };

  const handlePlaySample = async () => {
    setError(null);
    setSampleLoading(vo.suara);
    try {
      const res = await generateVoiceOverAudio({
        text: `Halo, saya suara ${vo.suara}. Siap membawakan narasi video Anda dengan jelas.`,
        voiceName: vo.suara,
        speakingStyle: vo.gayaBicara,
      });
      const bytes = base64ToUint8Array(res.pcmBase64);
      const blob = wrapPcmToWav(bytes, res.sampleRate, res.channels, res.bitsPerSample);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      audio.play().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memutar contoh suara.');
    } finally {
      setSampleLoading(null);
    }
  };

  const downloadScript = () => {
    const blob = new Blob([vo.naskah], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `naskah-vo-${selectedClip.judul.slice(0, 24)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Script Controls */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1 text-xs">
          <span className="block text-slate-400">Nada Narasi</span>
          <select
            value={vo.nada}
            onChange={(e) => patchVo({ nada: e.target.value as VoiceOverTone })}
            className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-xs text-white"
          >
            {TONES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1 text-xs">
          <span className="block text-slate-400">Bahasa Target</span>
          <select
            value={vo.bahasa}
            onChange={(e) => patchVo({ bahasa: e.target.value })}
            className="w-full rounded-lg border border-white/10 bg-[#0B0D12] px-3 py-2 text-xs text-white"
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={loadingScript}
          onClick={handleWriteScript}
          className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
        >
          {loadingScript ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          <span>Tulis naskah narasi</span>
        </button>

        <button
          type="button"
          disabled={loadingScript}
          onClick={handleDubbingTranslate}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/[0.1] disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
        >
          <Languages className="h-3.5 w-3.5" />
          <span>Dubbing terjemahan</span>
        </button>

        {vo.naskah && (
          <>
            <button
              type="button"
              onClick={() => syncScriptToSubtitles(vo.naskah)}
              className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-2 text-xs text-emerald-200 hover:bg-emerald-500/20 cursor-pointer whitespace-nowrap shrink-0"
            >
              <Subtitles className="h-3.5 w-3.5" />
              <span>Terapkan ke Subtitle</span>
            </button>
            <button
              type="button"
              onClick={downloadScript}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2 text-xs text-slate-300 hover:text-white cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Naskah .txt</span>
            </button>
          </>
        )}
      </div>

      <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={autoSyncSubtitle}
          onChange={(e) => setAutoSyncSubtitle(e.target.checked)}
          className="accent-violet-500"
        />
        <span>Otomatis tampilkan naskah sebagai subtitle di video</span>
      </label>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Editor Naskah Voice Over</span>
          <span className="font-mono text-slate-400 tabular-nums">
            {currentWords} / ~{targetWords} kata ({clipDuration}d × 2,5 kata/d)
          </span>
        </div>
        <textarea
          rows={4}
          aria-label="Naskah voice over"
          placeholder="Naskah narasi akan muncul di sini, atau ketik langsung…"
          value={vo.naskah}
          onChange={(e) => patchVo({ naskah: e.target.value })}
          className="w-full rounded-xl border border-white/10 bg-[#0B0D12] p-3 text-xs leading-relaxed text-white placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
        />
      </div>

      {/* Voice Selection & Speaking Style */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0B0D12] p-3.5 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1 text-xs">
            <span className="block text-slate-400">Pilihan Suara Gemini TTS</span>
            <div className="flex items-center gap-2">
              <select
                value={vo.suara}
                onChange={(e) => patchVo({ suara: e.target.value as GeminiVoiceName })}
                className="flex-1 rounded-lg border border-white/10 bg-[#121620] px-3 py-2 text-xs text-white"
              >
                {VOICES.map((v) => (
                  <option key={v.name} value={v.name}>
                    {v.name} — {v.desc}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={Boolean(sampleLoading)}
                onClick={handlePlaySample}
                className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-2 text-xs text-slate-200 hover:bg-white/[0.12] cursor-pointer whitespace-nowrap shrink-0"
              >
                {sampleLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Volume2 className="h-3.5 w-3.5" />}
                <span>Contoh</span>
              </button>
            </div>
          </div>

          <label className="space-y-1 text-xs">
            <span className="block text-slate-400">Gaya Bicara</span>
            <input
              type="text"
              value={vo.gayaBicara}
              onChange={(e) => patchVo({ gayaBicara: e.target.value })}
              placeholder="mis. ceria dan cepat"
              className="w-full rounded-lg border border-white/10 bg-[#121620] px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loadingAudio || !vo.naskah.trim()}
            onClick={handleGenerateVoice}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
          >
            {loadingAudio ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mic className="h-3.5 w-3.5" />}
            <span>Buat suara (.wav)</span>
          </button>

          {wavUrl && (
            <a
              href={wavUrl}
              download={`vo-${selectedClip.judul.slice(0, 20).replace(/[^a-z0-9]/gi, '-')}.wav`}
              className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2 text-xs text-slate-200 hover:bg-white/[0.12]"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Unduh .wav</span>
            </a>
          )}
        </div>

        {error && (
          <p className="text-xs text-rose-300">{error}</p>
        )}

        {wavUrl && (
          <div className="space-y-3 pt-2 border-t border-white/[0.06]">
            <audio controls src={wavUrl} className="w-full h-9" />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex-1 min-w-[180px] space-y-1 text-xs">
                <span className="block text-slate-400">
                  Volume video asli saat sinkron ({vo.originalVolume}%)
                </span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={vo.originalVolume}
                  onChange={(e) => patchVo({ originalVolume: Number(e.target.value) })}
                  className="w-full accent-violet-500"
                />
              </label>

              <button
                type="button"
                onClick={() =>
                  playRange(selectedClip.mulai, selectedClip.selesai, {
                    withVoiceOverPcm: vo.audioBase64Pcm,
                    originalVolume: vo.originalVolume,
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/85 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Putar Klip + VO Sinkron</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
