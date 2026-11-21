import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  GitBranch,
  Headphones,
  HelpCircle,
  Layers,
  ListChecks,
  Loader2,
  MessageSquareQuote,
  Mic,
  NotebookPen,
  Scale,
  Sparkles,
} from 'lucide-react';
import { serializeTranscriptContext, useClipMind } from '../../context/ClipMindContext';
import { generatePodcastAudio, generateStudioContent } from '../../services/geminiService';
import type { GeminiVoiceName, MindMapNode } from '../../types';
import { base64ToUint8Array, wrapPcmToWav } from '../../utils/audio';
import { MarkdownView } from '../MarkdownView';
import { TimestampChip } from '../TimestampChip';
import { StudioQuoteCanvas } from '../StudioQuoteCanvas';

type StudioToolKey =
  | 'article'
  | 'thread'
  | 'quotes'
  | 'flashcards_quiz'
  | 'mindmap'
  | 'cornell'
  | 'factcheck'
  | 'compare'
  | 'podcast'
  | 'carousel'
  | 'sop';

const STUDIO_TOOLS: Array<{
  key: StudioToolKey;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'article', label: 'Artikel Blog', desc: 'Esai Markdown terstruktur', icon: FileText },
  { key: 'thread', label: 'Thread X', desc: '8–12 cuitan maks. 280 karakter', icon: MessageSquareQuote },
  { key: 'quotes', label: 'Quote Card', desc: '5 kutipan terbaik + PNG', icon: Sparkles },
  { key: 'flashcards_quiz', label: 'Flashcard & Kuis', desc: '10 kartu & 10 soal latihan', icon: HelpCircle },
  { key: 'mindmap', label: 'Mind Map', desc: 'Pohon konsep SVG hierarkis', icon: GitBranch },
  { key: 'cornell', label: 'Catatan Cornell', desc: 'Isyarat, catatan, & rangkuman', icon: NotebookPen },
  { key: 'factcheck', label: 'Cek Klaim Web', desc: 'Verifikasi via Google Search', icon: AlertTriangle },
  { key: 'compare', label: 'Bandingkan Video', desc: 'Tabel komparasi 2 video', icon: Scale },
  { key: 'podcast', label: 'Podcast AI (2 Suara)', desc: 'Dialog & audio 2 pembicara', icon: Headphones },
  { key: 'carousel', label: 'Slide Carousel', desc: 'Deck IG & LinkedIn siap desain', icon: Layers },
  { key: 'sop', label: 'Panduan & SOP', desc: 'Langkah aksi ber-timestamp', icon: ListChecks },
];

const PODCAST_VOICES: Array<{ name: GeminiVoiceName; desc: string }> = [
  { name: 'Puck', desc: 'Ceria & Dinamis' },
  { name: 'Kore', desc: 'Tegas & Jernih' },
  { name: 'Charon', desc: 'Berat & Berwibawa' },
  { name: 'Zephyr', desc: 'Hangat & Natural' },
  { name: 'Fenrir', desc: 'Cepat & Enerjik' },
  { name: 'Aoede', desc: 'Lembut & Ekspresif' },
];

function MindMapSvg({ root }: { root: MindMapNode }) {
  const branches = root.anak ?? [];
  const height = Math.max(280, branches.length * 105);
  const width = 760;
  const rootX = 110;
  const rootY = height / 2;

  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#0B0D12] p-3">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[620px] h-auto"
        role="img"
        aria-label={`Mind map ${root.judul}`}
      >
        {branches.map((branch, bIdx) => {
          const by = ((bIdx + 0.5) / Math.max(1, branches.length)) * height;
          const bx = 370;
          const subs = branch.anak ?? [];
          return (
            <g key={bIdx}>
              <path
                d={`M ${rootX + 75} ${rootY} C ${rootX + 140} ${rootY}, ${bx - 120} ${by}, ${bx - 80} ${by}`}
                fill="none"
                stroke="#6366F1"
                strokeOpacity="0.55"
                strokeWidth="2"
              />
              {subs.map((sub, sIdx) => {
                const offset = (sIdx - (subs.length - 1) / 2) * 26;
                const sy = Math.max(20, Math.min(height - 20, by + offset));
                const sx = 620;
                return (
                  <g key={sIdx}>
                    <path
                      d={`M ${bx + 80} ${by} C ${bx + 120} ${by}, ${sx - 120} ${sy}, ${sx - 95} ${sy}`}
                      fill="none"
                      stroke="#3B82F6"
                      strokeOpacity="0.45"
                      strokeWidth="1.5"
                    />
                    <rect
                      x={sx - 95}
                      y={sy - 11}
                      width="195"
                      height="22"
                      rx="6"
                      fill="#181D2B"
                      stroke="rgba(255,255,255,0.12)"
                    />
                    <text
                      x={sx + 2}
                      y={sy + 4}
                      textAnchor="middle"
                      fill="#CBD5E1"
                      fontSize="10"
                    >
                      {sub.judul.slice(0, 28)}
                    </text>
                  </g>
                );
              })}
              <rect
                x={bx - 80}
                y={by - 15}
                width="160"
                height="30"
                rx="8"
                fill="#1E1B4B"
                stroke="#7C3AED"
              />
              <text
                x={bx}
                y={by + 4}
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize="11"
                fontWeight="600"
              >
                {branch.judul.slice(0, 22)}
              </text>
            </g>
          );
        })}

        <rect
          x={rootX - 85}
          y={rootY - 22}
          width="170"
          height="44"
          rx="10"
          fill="#4C1D95"
          stroke="#A78BFA"
          strokeWidth="1.5"
        />
        <text
          x={rootX}
          y={rootY + 4}
          textAnchor="middle"
          fill="#FFFFFF"
          fontSize="12"
          fontWeight="700"
        >
          {root.judul.slice(0, 22)}
        </text>
      </svg>
    </div>
  );
}

export function StudioTab() {
  const {
    videoId,
    youtubeUrl,
    localVideoId,
    transcript,
    videoTitle,
    modelMode,
    durationSec,
    studio,
    updateStudio,
  } = useClipMind();

  const [activeTool, setActiveTool] = useState<StudioToolKey>('article');
  const [articleTone, setArticleTone] = useState('Informatif & Mendalam');
  const [secondUrl, setSecondUrl] = useState('');
  const [podcastStyle, setPodcastStyle] = useState('Diskusi Santai & Analitis');
  const [hostName, setHostName] = useState('Raka');
  const [hostVoice, setHostVoice] = useState<GeminiVoiceName>('Puck');
  const [coHostName, setCoHostName] = useState('Sari');
  const [coHostVoice, setCoHostVoice] = useState<GeminiVoiceName>('Kore');
  const [podcastAudioLoading, setPodcastAudioLoading] = useState(false);
  const [carouselPlatform, setCarouselPlatform] = useState('Instagram & LinkedIn');
  const [loadingTool, setLoadingTool] = useState<StudioToolKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Interactive Study Mode state
  const [flippedCard, setFlippedCard] = useState<Record<number, boolean>>({});
  const [quizAnswers, setQuizAnswers] = useState<Record<number, number>>({});
  const [activeQuoteCanvas, setActiveQuoteCanvas] = useState<number | null>(null);

  const podcastWavUrl = useMemo(() => {
    const b64 = studio.podcast?.audioBase64Pcm;
    if (!b64) return null;
    try {
      const pcm = base64ToUint8Array(b64);
      const blob = wrapPcmToWav(pcm, 24000, 1, 16);
      return URL.createObjectURL(blob);
    } catch {
      return null;
    }
  }, [studio.podcast?.audioBase64Pcm]);

  useEffect(() => {
    return () => {
      if (podcastWavUrl) URL.revokeObjectURL(podcastWavUrl);
    };
  }, [podcastWavUrl]);

  if (!videoId) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-400">
        Muat video YouTube atau impor MP4 terlebih dahulu untuk menghasilkan artikel, thread, kuis, mind map, podcast AI, dan materi turunan lainnya.
      </div>
    );
  }

  const copyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const runTool = async (tool: StudioToolKey) => {
    setError(null);
    if (tool === 'compare' && !secondUrl.trim()) {
      setError('Masukkan URL video YouTube kedua untuk dibandingkan.');
      return;
    }
    setLoadingTool(tool);
    try {
      const res = await generateStudioContent({
        youtubeUrl: youtubeUrl || undefined,
        localVideoId: localVideoId || undefined,
        transcriptContextText: serializeTranscriptContext(transcript),
        type: tool,
        tone: tool === 'podcast' ? podcastStyle : articleTone,
        secondUrl: tool === 'compare' ? secondUrl.trim() : undefined,
        hostName: hostName.trim() || 'Raka',
        hostVoice,
        coHostName: coHostName.trim() || 'Sari',
        coHostVoice,
        platform: carouselPlatform,
        mode: modelMode,
        durationHint: durationSec,
      });

      if (tool === 'article' && res.markdown) {
        updateStudio({ article: { nada: articleTone, markdown: res.markdown } });
      } else if (tool === 'thread' && res.tweets) {
        updateStudio({ thread: res.tweets });
      } else if (tool === 'quotes' && res.quotes) {
        updateStudio({ quotes: res.quotes });
      } else if (tool === 'flashcards_quiz' && res.flashcards && res.kuis) {
        updateStudio({ study: { flashcards: res.flashcards, kuis: res.kuis } });
        setFlippedCard({});
        setQuizAnswers({});
      } else if (tool === 'mindmap' && res.mindmap) {
        updateStudio({ mindmap: res.mindmap });
      } else if (tool === 'cornell' && res.cornell) {
        updateStudio({ cornell: res.cornell });
      } else if (tool === 'factcheck' && res.factcheck) {
        updateStudio({
          factcheck: res.factcheck,
          factcheckSources: res.factcheckSources ?? [],
        });
      } else if (tool === 'compare' && res.compare) {
        updateStudio({ compare: { secondUrl: secondUrl.trim(), data: res.compare } });
      } else if (tool === 'podcast' && res.podcast) {
        updateStudio({ podcast: res.podcast });
      } else if (tool === 'carousel' && res.carousel) {
        updateStudio({ carousel: res.carousel });
      } else if (tool === 'sop' && res.sop) {
        updateStudio({ sop: res.sop });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghasilkan konten Studio.');
    } finally {
      setLoadingTool(null);
    }
  };

  const handleGeneratePodcastAudio = async () => {
    if (!studio.podcast || studio.podcast.dialog.length === 0) return;
    setError(null);
    setPodcastAudioLoading(true);
    try {
      const audioRes = await generatePodcastAudio({
        hostName: studio.podcast.hostNama || hostName,
        hostVoice,
        coHostName: studio.podcast.coHostNama || coHostName,
        coHostVoice,
        dialog: studio.podcast.dialog,
      });
      updateStudio({
        podcast: {
          ...studio.podcast,
          hostSuara: hostVoice,
          coHostSuara: coHostVoice,
          audioBase64Pcm: audioRes.pcmBase64,
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat audio podcast 2 suara.');
    } finally {
      setPodcastAudioLoading(false);
    }
  };

  const quizScore = studio.study
    ? studio.study.kuis.reduce(
        (acc, q, idx) => (quizAnswers[idx] === q.jawabanBenar ? acc + 1 : acc),
        0
      )
    : 0;

  return (
    <div className="space-y-4">
      {/* Studio Tool Selector Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {STUDIO_TOOLS.map((t) => {
          const Icon = t.icon;
          const isActive = activeTool === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTool(t.key)}
              className={`rounded-xl border p-2.5 text-left transition-colors cursor-pointer ${
                isActive
                  ? 'border-violet-500 bg-violet-500/15 text-white'
                  : 'border-white/[0.08] bg-[#0B0D12] text-slate-300 hover:border-white/20'
              }`}
            >
              <Icon className="h-4 w-4 text-violet-400 mb-1.5" />
              <div className="text-xs font-semibold truncate">{t.label}</div>
              <div className="text-[11px] text-slate-400 truncate">{t.desc}</div>
            </button>
          );
        })}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Active Studio Panel */}
      <div className="rounded-xl border border-white/[0.08] bg-[#0B0D12]/80 p-4 space-y-4">
        {/* 1. Article */}
        {activeTool === 'article' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <select
                  aria-label="Nada artikel blog"
                  value={articleTone}
                  onChange={(e) => setArticleTone(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#121620] px-3 py-1.5 text-xs text-white"
                >
                  <option value="Informatif & Mendalam">Informatif &amp; Mendalam</option>
                  <option value="Storytelling Ringan">Storytelling Ringan</option>
                  <option value="Opini Analitis">Opini Analitis</option>
                  <option value="Panduan Praktis">Panduan Praktis</option>
                </select>
                <button
                  type="button"
                  disabled={loadingTool === 'article'}
                  onClick={() => runTool('article')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-40"
                >
                  {loadingTool === 'article' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Buat Artikel</span>
                </button>
              </div>
              {studio.article && (
                <button
                  type="button"
                  onClick={() => copyText('article', studio.article!.markdown)}
                  className="inline-flex items-center gap-1 rounded border border-white/10 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10 cursor-pointer"
                >
                  {copiedId === 'article' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>Salin Markdown</span>
                </button>
              )}
            </div>
            {studio.article ? (
              <MarkdownView content={studio.article.markdown} enableTimestampChips={false} />
            ) : (
              <p className="text-xs text-slate-400">Klik &ldquo;Buat Artikel&rdquo; untuk menyusun artikel blog lengkap dari isi video.</p>
            )}
          </>
        )}

        {/* 2. Thread X */}
        {activeTool === 'thread' && (
          <>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={loadingTool === 'thread'}
                onClick={() => runTool('thread')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-40"
              >
                {loadingTool === 'thread' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Buat Thread X</span>
              </button>
              {studio.thread && (
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      'thread',
                      studio.thread!.map((t, i) => `${i + 1}/ ${t}`).join('\n\n')
                    )
                  }
                  className="inline-flex items-center gap-1 rounded border border-white/10 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10 cursor-pointer"
                >
                  {copiedId === 'thread' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>Salin Semua</span>
                </button>
              )}
            </div>
            {studio.thread ? (
              <div className="space-y-2.5">
                {studio.thread.map((tweet, idx) => (
                  <div key={idx} className="rounded-lg border border-white/[0.08] bg-[#121620] p-3 space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span className="font-mono">Tweet {idx + 1}/{studio.thread!.length}</span>
                      <span className={`font-mono tabular-nums ${tweet.length > 280 ? 'text-rose-400' : 'text-emerald-400'}`}>
                        {tweet.length}/280 karakter
                      </span>
                    </div>
                    <p className="text-xs leading-relaxed text-slate-100">{tweet}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">Buat rangkaian 8–12 cuitan padat dengan penghitung 280 karakter.</p>
            )}
          </>
        )}

        {/* 3. Quote Cards */}
        {activeTool === 'quotes' && (
          <>
            <button
              type="button"
              disabled={loadingTool === 'quotes'}
              onClick={() => runTool('quotes')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-40"
            >
              {loadingTool === 'quotes' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Ekstrak 5 Kutipan Terbaik</span>
            </button>
            {studio.quotes ? (
              <div className="space-y-3">
                {studio.quotes.map((q, idx) => (
                  <div key={idx} className="rounded-lg border border-white/[0.08] bg-[#121620] p-3.5 space-y-2">
                    <p className="text-sm font-medium text-white">“{q.kutipan}”</p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span>{q.pembicara}</span>
                        <TimestampChip seconds={q.detik} />
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setActiveQuoteCanvas((prev) => (prev === idx ? null : idx))
                        }
                        className="rounded-lg bg-white/[0.08] px-2.5 py-1 text-xs font-medium text-white hover:bg-white/[0.15] cursor-pointer"
                      >
                        {activeQuoteCanvas === idx ? 'Tutup gambar' : 'Jadikan gambar'}
                      </button>
                    </div>
                    {activeQuoteCanvas === idx && (
                      <StudioQuoteCanvas quote={q} videoTitle={videoTitle || 'ClipMind'} />
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">Ambil 5 kutipan paling kuat dan ubah menjadi kartu gambar PNG siap bagikan.</p>
            )}
          </>
        )}

        {/* 4. Flashcards & Quiz */}
        {activeTool === 'flashcards_quiz' && (
          <>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={loadingTool === 'flashcards_quiz'}
                onClick={() => runTool('flashcards_quiz')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-40"
              >
                {loadingTool === 'flashcards_quiz' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Buat Flashcard &amp; Kuis</span>
              </button>
              {studio.study && (
                <span className="font-mono text-xs text-violet-300 tabular-nums">
                  Skor Kuis: {quizScore}/{studio.study.kuis.length}
                </span>
              )}
            </div>

            {studio.study ? (
              <div className="space-y-5">
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <BookOpen className="h-3.5 w-3.5 text-violet-400" />
                    <span>Flashcard ({studio.study.flashcards.length}) — klik kartu untuk membalik</span>
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {studio.study.flashcards.map((fc, idx) => {
                      const isFlipped = Boolean(flippedCard[idx]);
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() =>
                            setFlippedCard((p) => ({ ...p, [idx]: !p[idx] }))
                          }
                          className={`rounded-xl border p-3.5 text-left transition-colors cursor-pointer min-h-[88px] ${
                            isFlipped
                              ? 'border-blue-500/50 bg-blue-500/10'
                              : 'border-white/[0.08] bg-[#121620] hover:border-violet-500/50'
                          }`}
                        >
                          <div className="text-[11px] font-mono text-slate-400 mb-1">
                            {isFlipped ? 'JAWABAN' : `KARTU #${idx + 1}`}
                          </div>
                          <p className="text-xs leading-relaxed text-white">
                            {isFlipped ? fc.belakang : fc.depan}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-white">
                    Kuis Pilihan Ganda ({studio.study.kuis.length} soal)
                  </h4>
                  {studio.study.kuis.map((q, qIdx) => {
                    const chosen = quizAnswers[qIdx];
                    const answered = chosen !== undefined;
                    return (
                      <div key={qIdx} className="rounded-xl border border-white/[0.08] bg-[#121620] p-3.5 space-y-2">
                        <p className="text-xs font-semibold text-white">
                          {qIdx + 1}. {q.pertanyaan}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          {q.pilihan.map((opt, oIdx) => {
                            const isCorrect = oIdx === q.jawabanBenar;
                            const isSelected = chosen === oIdx;
                            let cls = 'border-white/10 bg-[#0B0D12] text-slate-300 hover:border-white/25';
                            if (answered) {
                              if (isCorrect) cls = 'border-emerald-500 bg-emerald-500/15 text-emerald-200';
                              else if (isSelected) cls = 'border-rose-500 bg-rose-500/15 text-rose-200';
                            }
                            return (
                              <button
                                key={oIdx}
                                type="button"
                                onClick={() => setQuizAnswers((p) => ({ ...p, [qIdx]: oIdx }))}
                                className={`rounded-lg border px-3 py-2 text-left text-xs cursor-pointer ${cls}`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                        {answered && (
                          <p className="text-[11px] text-slate-300 pt-1">
                            <span className="font-semibold text-violet-300">Penjelasan: </span>
                            {q.penjelasan}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Latih pemahaman video dengan flashcard interaktif dan soal pilihan ganda.</p>
            )}
          </>
        )}

        {/* 5. Mind Map */}
        {activeTool === 'mindmap' && (
          <>
            <button
              type="button"
              disabled={loadingTool === 'mindmap'}
              onClick={() => runTool('mindmap')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-40"
            >
              {loadingTool === 'mindmap' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Buat Mind Map SVG</span>
            </button>
            {studio.mindmap ? (
              <MindMapSvg root={studio.mindmap} />
            ) : (
              <p className="text-xs text-slate-400">Petakan ide utama dan sub-topik video ke dalam diagram pohon SVG.</p>
            )}
          </>
        )}

        {/* 6. Cornell Notes */}
        {activeTool === 'cornell' && (
          <>
            <div className="flex items-center justify-between">
              <button
                type="button"
                disabled={loadingTool === 'cornell'}
                onClick={() => runTool('cornell')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-40"
              >
                {loadingTool === 'cornell' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Buat Catatan Cornell</span>
              </button>
              {studio.cornell && (
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      'cornell',
                      `# ${studio.cornell!.judul}\n\nIsyarat:\n${studio.cornell!.isyarat.join('\n')}\n\nCatatan:\n${studio.cornell!.catatan.join('\n')}\n\nRangkuman:\n${studio.cornell!.rangkuman}`
                    )
                  }
                  className="inline-flex items-center gap-1 rounded border border-white/10 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10 cursor-pointer"
                >
                  {copiedId === 'cornell' ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>Salin</span>
                </button>
              )}
            </div>
            {studio.cornell ? (
              <div className="rounded-xl border border-white/10 bg-[#121620] overflow-hidden">
                <div className="border-b border-white/10 px-4 py-2.5 font-display text-sm font-semibold text-white">
                  {studio.cornell.judul}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 border-b border-white/10">
                  <div className="p-3.5 border-b md:border-b-0 md:border-r border-white/10 space-y-2">
                    <h4 className="text-xs font-semibold text-violet-300">Isyarat &amp; Kata Kunci</h4>
                    <ul className="space-y-1.5 text-xs text-slate-200">
                      {studio.cornell.isyarat.map((c, i) => (
                        <li key={i}>• {c}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="md:col-span-2 p-3.5 space-y-2">
                    <h4 className="text-xs font-semibold text-blue-300">Catatan Utama</h4>
                    <ul className="space-y-1.5 text-xs leading-relaxed text-slate-200">
                      {studio.cornell.catatan.map((n, i) => (
                        <li key={i}>• {n}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="p-3.5 space-y-1 bg-[#0B0D12]/50">
                  <h4 className="text-xs font-semibold text-white">Rangkuman</h4>
                  <p className="text-xs leading-relaxed text-slate-300">{studio.cornell.rangkuman}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Susun catatan belajar rapi dengan kolom isyarat, catatan inti, dan rangkuman.</p>
            )}
          </>
        )}

        {/* 7. Fact Check (Web Grounded) */}
        {activeTool === 'factcheck' && (
          <>
            <button
              type="button"
              disabled={loadingTool === 'factcheck'}
              onClick={() => runTool('factcheck')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
            >
              {loadingTool === 'factcheck' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Audit Fakta + Google Search</span>
            </button>
            {studio.factcheck ? (
              <div className="space-y-3">
                <p className="text-[11px] text-slate-400">
                  Klaim diekstrak dari video dan dicocokkan langsung dengan hasil penelusuran web Google Search.
                </p>
                {studio.factcheck.map((item, idx) => (
                  <div key={idx} className="rounded-lg border border-white/[0.08] bg-[#121620] p-3 space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <TimestampChip seconds={item.detik} />
                      <div className="flex items-center gap-2 text-xs">
                        {item.status_web && (
                          <span className="text-slate-300">
                            {item.status_web}
                          </span>
                        )}
                        {item.status_web && (
                          <span aria-hidden="true" className="text-slate-600">·</span>
                        )}
                        <span
                          className={`font-semibold ${
                            item.tingkat_keyakinan === 'Tinggi'
                              ? 'text-emerald-400'
                              : item.tingkat_keyakinan === 'Sedang'
                              ? 'text-amber-300'
                              : 'text-rose-300'
                          }`}
                        >
                          Keyakinan: {item.tingkat_keyakinan}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs font-medium text-white">{item.klaim}</p>
                    <p className="text-xs text-slate-400">{item.catatan}</p>
                  </div>
                ))}

                {studio.factcheckSources && studio.factcheckSources.length > 0 && (
                  <div className="rounded-lg border border-white/[0.08] bg-[#121620]/70 p-3 space-y-2">
                    <h4 className="text-xs font-semibold text-white">
                      Sumber Web Terverifikasi ({studio.factcheckSources.length})
                    </h4>
                    <ul className="space-y-1">
                      {studio.factcheckSources.map((src, sIdx) => (
                        <li key={sIdx} className="text-xs truncate">
                          <a
                            href={src.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-blue-300 hover:text-blue-200 underline"
                          >
                            <ExternalLink className="h-3 w-3 shrink-0" />
                            <span className="truncate">{src.title}</span>
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Identifikasi klaim faktual dan statistik dalam video lalu verifikasi menggunakan Google Search real-time.
              </p>
            )}
          </>
        )}

        {/* 8. Video Comparison */}
        {activeTool === 'compare' && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                aria-label="URL video YouTube kedua"
                placeholder="Tempel URL video YouTube kedua untuk dibandingkan…"
                value={secondUrl}
                onChange={(e) => setSecondUrl(e.target.value)}
                className="min-w-[220px] flex-1 rounded-lg border border-white/10 bg-[#121620] px-3 py-2 text-xs text-white placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
              />
              <button
                type="button"
                disabled={loadingTool === 'compare'}
                onClick={() => runTool('compare')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2 text-xs font-semibold text-white cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                {loadingTool === 'compare' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Bandingkan</span>
              </button>
            </div>
            {studio.compare ? (
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-slate-200">
                  {studio.compare.data.ringkasan_perbandingan}
                </p>
                <p className="text-xs font-semibold text-violet-300">
                  Lebih padat &amp; akurat: {studio.compare.data.pemenang_kepadatan}
                </p>
                <div className="overflow-x-auto rounded-lg border border-white/10">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-white/[0.04] text-slate-300">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Aspek</th>
                        <th className="px-3 py-2 font-semibold">Video Utama</th>
                        <th className="px-3 py-2 font-semibold">Video Pembanding</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.06] text-slate-200">
                      {studio.compare.data.tabel.map((row, idx) => (
                        <tr key={idx}>
                          <td className="px-3 py-2 font-medium text-white">{row.aspek}</td>
                          <td className="px-3 py-2">{row.video1}</td>
                          <td className="px-3 py-2">{row.video2}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Masukkan URL video kedua untuk membandingkan argumen, kepadatan materi, dan akurasinya.</p>
            )}
          </>
        )}

        {/* 9. AI Podcast (2 Speakers via gemini-3.8-flash-tts) */}
        {activeTool === 'podcast' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 text-xs">
              <label className="space-y-1">
                <span className="block text-slate-400">Gaya Diskusi</span>
                <select
                  aria-label="Gaya diskusi podcast"
                  value={podcastStyle}
                  onChange={(e) => setPodcastStyle(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#121620] px-2.5 py-1.5 text-xs text-white"
                >
                  <option value="Diskusi Santai & Analitis">Diskusi Santai &amp; Analitis</option>
                  <option value="Debat Kritis & Tajam">Debat Kritis &amp; Tajam</option>
                  <option value="Wawancara Cepat & Padat">Wawancara Cepat &amp; Padat</option>
                </select>
              </label>

              <div className="space-y-1">
                <span className="block text-slate-400">Host 1 (Nama &amp; Suara)</span>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    aria-label="Nama Host"
                    value={hostName}
                    onChange={(e) => setHostName(e.target.value)}
                    className="w-24 rounded-lg border border-white/10 bg-[#121620] px-2.5 py-1.5 text-xs text-white"
                  />
                  <select
                    aria-label="Suara Host"
                    value={hostVoice}
                    onChange={(e) => setHostVoice(e.target.value as GeminiVoiceName)}
                    className="flex-1 min-w-0 rounded-lg border border-white/10 bg-[#121620] px-2 py-1.5 text-xs text-white"
                  >
                    {PODCAST_VOICES.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} · {v.desc}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <span className="block text-slate-400">Ko-Host 2 (Nama &amp; Suara)</span>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    aria-label="Nama Ko-Host"
                    value={coHostName}
                    onChange={(e) => setCoHostName(e.target.value)}
                    className="w-24 rounded-lg border border-white/10 bg-[#121620] px-2.5 py-1.5 text-xs text-white"
                  />
                  <select
                    aria-label="Suara Ko-Host"
                    value={coHostVoice}
                    onChange={(e) => setCoHostVoice(e.target.value as GeminiVoiceName)}
                    className="flex-1 min-w-0 rounded-lg border border-white/10 bg-[#121620] px-2 py-1.5 text-xs text-white"
                  >
                    {PODCAST_VOICES.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} · {v.desc}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={loadingTool === 'podcast'}
                  onClick={() => runTool('podcast')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  {loadingTool === 'podcast' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Headphones className="h-3.5 w-3.5" />
                  )}
                  <span>{studio.podcast ? 'Susun Ulang Naskah' : 'Susun Naskah Podcast'}</span>
                </button>

                {studio.podcast && studio.podcast.dialog.length > 0 && (
                  <button
                    type="button"
                    disabled={podcastAudioLoading}
                    onClick={handleGeneratePodcastAudio}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600/90 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    {podcastAudioLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Mic className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {podcastAudioLoading
                        ? 'Mensintesis 2 Suara…'
                        : 'Generate Audio Podcast (2 Suara)'}
                    </span>
                  </button>
                )}
              </div>

              {studio.podcast && (
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      'podcast',
                      `${studio.podcast!.judul}\n\n${studio.podcast!.dialog
                        .map((d) => `${d.nama}: ${d.teks}`)
                        .join('\n')}`
                    )
                  }
                  className="inline-flex items-center gap-1 rounded border border-white/10 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {copiedId === 'podcast' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>Salin Naskah</span>
                </button>
              )}
            </div>

            {podcastWavUrl && (
              <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-emerald-200">
                    Audio Podcast 2 Pembicara siap diputar
                  </span>
                  <a
                    href={podcastWavUrl}
                    download={`podcast-${videoId}.wav`}
                    className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/[0.05] px-2.5 py-1 text-xs text-slate-200 hover:bg-white/[0.12] whitespace-nowrap shrink-0"
                  >
                    <Download className="h-3 w-3" />
                    <span>Unduh .wav</span>
                  </a>
                </div>
                <audio controls src={podcastWavUrl} className="w-full h-9" />
              </div>
            )}

            {studio.podcast ? (
              <div className="space-y-2.5">
                <div className="space-y-0.5">
                  <h4 className="font-display text-sm font-semibold text-white">
                    {studio.podcast.judul}
                  </h4>
                  <p className="text-xs text-slate-400">{studio.podcast.ringkasan}</p>
                </div>
                <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.08] bg-[#121620]">
                  {studio.podcast.dialog.map((line, idx) => (
                    <div key={idx} className="px-3.5 py-2.5 space-y-1 text-xs">
                      <div className="flex items-center gap-2 text-slate-400">
                        <span
                          className={`font-semibold ${
                            line.pembicara === 'Host' ? 'text-violet-300' : 'text-blue-300'
                          }`}
                        >
                          {line.nama}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{line.pembicara}</span>
                      </div>
                      <p className="text-slate-100 leading-relaxed">{line.teks}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Ubah isi video menjadi episode audio diskusi 2 pembicara lengkap dengan dialog alami dan file WAV siap unduh.
              </p>
            )}
          </>
        )}

        {/* 10. Carousel Deck (IG & LinkedIn) */}
        {activeTool === 'carousel' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <select
                  aria-label="Platform target carousel"
                  value={carouselPlatform}
                  onChange={(e) => setCarouselPlatform(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#121620] px-3 py-1.5 text-xs text-white"
                >
                  <option value="Instagram & LinkedIn">Instagram &amp; LinkedIn</option>
                  <option value="TikTok Photo Mode">TikTok Photo Mode</option>
                </select>
                <button
                  type="button"
                  disabled={loadingTool === 'carousel'}
                  onClick={() => runTool('carousel')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  {loadingTool === 'carousel' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  <span>Buat Slide Carousel</span>
                </button>
              </div>
              {studio.carousel && (
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      'carousel',
                      `# ${studio.carousel!.judul_deck}\n\n${studio.carousel!.slides
                        .map(
                          (s) =>
                            `Slide ${s.slide_ke}: ${s.headline}\n${s.poin
                              .map((p) => `- ${p}`)
                              .join('\n')}\nVisual: ${s.catatan_visual}`
                        )
                        .join('\n\n')}\n\nCaption:\n${studio.carousel!.caption_cta}`
                    )
                  }
                  className="inline-flex items-center gap-1 rounded border border-white/10 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {copiedId === 'carousel' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>Salin Semua Slide</span>
                </button>
              )}
            </div>

            {studio.carousel ? (
              <div className="space-y-3">
                <div className="text-xs text-slate-400">
                  <strong className="text-sm text-white">{studio.carousel.judul_deck}</strong>{' '}
                  <span aria-hidden="true">·</span> {studio.carousel.platform}{' '}
                  <span aria-hidden="true">·</span> {studio.carousel.slides.length} slide
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {studio.carousel.slides.map((s) => (
                    <div
                      key={s.slide_ke}
                      className="rounded-xl border border-white/[0.08] bg-[#121620] p-3.5 space-y-2"
                    >
                      <div className="text-[11px] font-mono text-violet-300 tabular-nums">
                        Slide {s.slide_ke}
                      </div>
                      <h5 className="text-xs font-semibold text-white">{s.headline}</h5>
                      <ul className="space-y-1 text-xs text-slate-200">
                        {s.poin.map((pt, idx) => (
                          <li key={idx}>• {pt}</li>
                        ))}
                      </ul>
                      <p className="text-[11px] text-slate-400 border-t border-white/[0.06] pt-1.5">
                        Arahan visual: {s.catatan_visual}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-[#121620] p-3 space-y-1 text-xs">
                  <span className="font-semibold text-slate-300">Caption &amp; CTA:</span>
                  <p className="text-slate-200 leading-relaxed">{studio.carousel.caption_cta}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Susun 6–8 slide carousel terstruktur lengkap dengan headline, poin inti, arahan visual, dan caption CTA.
              </p>
            )}
          </>
        )}

        {/* 11. Panduan / SOP Langkah */}
        {activeTool === 'sop' && (
          <>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={loadingTool === 'sop'}
                onClick={() => runTool('sop')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0"
              >
                {loadingTool === 'sop' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                <span>Ekstrak Panduan / SOP</span>
              </button>
              {studio.sop && (
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      'sop',
                      `# ${studio.sop!.judul}\n\nTujuan: ${studio.sop!.tujuan}\n\nPrasyarat:\n${studio.sop!.prasyarat
                        .map((p) => `- ${p}`)
                        .join('\n')}\n\nLangkah:\n${studio.sop!.langkah
                        .map((l) => `${l.nomor}. ${l.judul}: ${l.detail}`)
                        .join('\n')}\n\nHasil Akhir: ${studio.sop!.hasil_akhir}`
                    )
                  }
                  className="inline-flex items-center gap-1 rounded border border-white/10 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10 cursor-pointer whitespace-nowrap shrink-0"
                >
                  {copiedId === 'sop' ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>Salin SOP</span>
                </button>
              )}
            </div>

            {studio.sop ? (
              <div className="space-y-3 rounded-xl border border-white/[0.08] bg-[#121620] p-4 text-xs">
                <div className="space-y-1">
                  <h4 className="font-display text-sm font-semibold text-white">
                    {studio.sop.judul}
                  </h4>
                  <p className="text-slate-300 leading-relaxed">{studio.sop.tujuan}</p>
                </div>

                {studio.sop.prasyarat.length > 0 && (
                  <div className="space-y-1 border-t border-white/[0.06] pt-2.5">
                    <h5 className="font-semibold text-slate-300">Prasyarat &amp; Persiapan</h5>
                    <ul className="space-y-1 text-slate-300">
                      {studio.sop.prasyarat.map((item, idx) => (
                        <li key={idx}>• {item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-2 border-t border-white/[0.06] pt-2.5">
                  <h5 className="font-semibold text-white">Langkah Eksekusi</h5>
                  <ol className="space-y-2">
                    {studio.sop.langkah.map((step) => (
                      <li
                        key={step.nomor}
                        className="flex items-start justify-between gap-3 rounded-lg border border-white/[0.06] bg-[#0B0D12] p-2.5"
                      >
                        <div className="space-y-0.5 min-w-0">
                          <div className="font-semibold text-white tabular-nums">
                            {step.nomor}. {step.judul}
                          </div>
                          <p className="text-slate-300 leading-relaxed">{step.detail}</p>
                        </div>
                        <TimestampChip seconds={step.detik} />
                      </li>
                    ))}
                  </ol>
                </div>

                <div className="border-t border-white/[0.06] pt-2.5 space-y-0.5">
                  <h5 className="font-semibold text-emerald-300">Hasil Akhir Diharapkan</h5>
                  <p className="text-slate-200">{studio.sop.hasil_akhir}</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Ubah video tutorial atau materi kompleks menjadi panduan langkah kerja (SOP) berurutan lengkap dengan timestamp video.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
