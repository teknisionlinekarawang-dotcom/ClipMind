import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  Film,
  Flame,
  KeyRound,
  Loader2,
  MessageSquare,
  Scissors,
  Sparkles,
  Subtitles,
  Upload,
  Wand2,
} from 'lucide-react';
import { ClipMindProvider, useClipMind } from './context/ClipMindContext';
import type { MainTabKey } from './types';
import { PROVIDER_PRESETS } from './utils/aiProviders';
import { YouTubePlayerPanel } from './components/YouTubePlayerPanel';
import { SavedClipsList } from './components/SavedClipsList';
import { ExportMenu } from './components/ExportMenu';
import { ProviderSettingsModal } from './components/ProviderSettingsModal';
import { SummaryTab } from './components/tabs/SummaryTab';
import { ChatTab } from './components/tabs/ChatTab';
import { HighlightTab } from './components/tabs/HighlightTab';
import { ClipEditorTab } from './components/tabs/ClipEditorTab';
import { TranscriptTab } from './components/tabs/TranscriptTab';
import { StudioTab } from './components/tabs/StudioTab';

const TABS: Array<{
  key: MainTabKey;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'ringkasan', label: 'Ringkasan', icon: BookOpen },
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'highlight', label: 'Highlight', icon: Flame },
  { key: 'klip', label: 'Klip & Editor', icon: Scissors },
  { key: 'transkrip', label: 'Transkrip', icon: Subtitles },
  { key: 'studio', label: 'Studio', icon: Wand2 },
];

const SAMPLE_VIDEOS = [
  {
    label: 'Video Pendek (First at the Zoo)',
    url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
  },
  {
    label: 'Kuliah AI / Deep Learning',
    url: 'https://www.youtube.com/watch?v=zjkBMFhNj_g',
  },
];

function ClipMindWorkspace() {
  const {
    urlInput,
    setUrlInput,
    videoId,
    uploadProgress,
    modelMode,
    setModelMode,
    activeTab,
    setActiveTab,
    progress,
    globalError,
    setGlobalError,
    analyzeVideoUrl,
    importLocalMp4File,
    clips,
    aiSettings,
    activeProviderConfig,
  } = useClipMind();

  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const mp4InputRef = useRef<HTMLInputElement | null>(null);

  const isUploading = uploadProgress !== null;
  const isAnalyzing =
    progress.summary === 'loading' || progress.highlights === 'loading';
  const activePreset = PROVIDER_PRESETS[aiSettings.activeProvider];
  const activeProviderLabel =
    aiSettings.activeProvider === 'custom'
      ? activeProviderConfig.customName?.trim() || activePreset.shortLabel
      : activePreset.shortLabel;
  const hasCustomKey = Boolean(activeProviderConfig.apiKey.trim());

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    analyzeVideoUrl(urlInput);
  };

  const handleMp4FileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      importLocalMp4File(file);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      importLocalMp4File(file);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0D12] text-slate-100">
      <input
        ref={mp4InputRef}
        type="file"
        accept="video/mp4,.mp4"
        aria-label="Pilih file video MP4 lokal"
        onChange={handleMp4FileChange}
        className="hidden"
      />

      {/* Header */}
      <header className="lg:sticky lg:top-0 z-40 border-b border-white/[0.08] bg-[#0B0D12]/95 backdrop-blur-md">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 py-3 flex flex-wrap lg:flex-nowrap items-center justify-between gap-3">
          {/* Brand */}
          <a
            href="/"
            className="inline-flex items-center gap-2.5 font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 text-white">
              <Film className="h-4 w-4" aria-hidden="true" />
            </span>
            <span>ClipMind</span>
          </a>

          {/* Large URL Input + Analyze CTA */}
          <form
            onSubmit={handleSubmit}
            className="order-last lg:order-none flex basis-full lg:basis-auto lg:flex-1 min-w-0 lg:min-w-[240px] max-w-2xl items-center gap-2"
          >
            <input
              type="url"
              aria-label="URL video YouTube"
              placeholder="Tempel tautan YouTube (watch?v=, youtu.be/, shorts/, live/)…"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              className="min-w-0 flex-1 rounded-xl border border-white/12 bg-[#121620] px-3.5 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={isAnalyzing || isUploading}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-blue-600 px-3.5 py-2.5 text-sm font-semibold text-white hover:from-violet-500 hover:to-blue-500 disabled:opacity-50 transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isAnalyzing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span>Analisis</span>
            </button>
          </form>

          {/* Upload MP4 + Model selector + Provider + Export/Import */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0 max-w-full">
            <button
              type="button"
              disabled={isUploading}
              onClick={() => mp4InputRef.current?.click()}
              aria-label="Impor video MP4 lokal"
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isUploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              <span>{isUploading ? `${uploadProgress}%` : 'Impor MP4'}</span>
            </button>

            <div
              role="group"
              aria-label="Pilihan mode analisis"
              className="inline-flex items-center rounded-lg border border-white/10 bg-[#121620] p-1"
            >
              <button
                type="button"
                onClick={() => setModelMode('fast')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  modelMode === 'fast'
                    ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Flash Cepat
              </button>
              <button
                type="button"
                onClick={() => setModelMode('deep')}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  modelMode === 'deep'
                    ? 'bg-gradient-to-r from-violet-600 to-blue-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Pro Mendalam
              </button>
            </div>

            <button
              type="button"
              onClick={() => setProviderModalOpen(true)}
              aria-label="Pengaturan Provider AI dan API Key"
              title={`Provider aktif: ${activeProviderLabel} (${activeProviderConfig.model})`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-[#121620] px-3 py-2 text-xs font-medium text-slate-200 hover:border-violet-500/60 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <KeyRound
                className={`h-3.5 w-3.5 ${hasCustomKey ? 'text-emerald-400' : 'text-violet-400'}`}
                aria-hidden="true"
              />
              <span>{activeProviderLabel}</span>
            </button>

            <ExportMenu />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 mx-auto w-full max-w-[1440px] px-4 sm:px-6 py-5">
        {isUploading && (
          <div
            role="status"
            className="mb-4 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3 space-y-2"
          >
            <div className="flex items-center justify-between text-xs font-medium text-emerald-200">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Mengunggah &amp; memeriksa video MP4 lokal…</span>
              </span>
              <span className="font-mono tabular-nums">{uploadProgress}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
              <div
                style={{ width: `${uploadProgress}%` }}
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-150"
              />
            </div>
          </div>
        )}

        {globalError && (
          <div
            role="alert"
            className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{globalError}</span>
            </div>
            <button
              type="button"
              onClick={() => setGlobalError(null)}
              className="text-xs underline cursor-pointer shrink-0"
            >
              Tutup
            </button>
          </div>
        )}

        {!videoId ? (
          /* Clean Empty / Welcome State */
          <section className="mx-auto max-w-3xl py-12 text-center space-y-6">
            <div className="space-y-3">
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white text-balance">
                Review, Edit, dan Klip Video YouTube atau MP4 Lokal dalam Sekejap
              </h1>
              <p className="text-sm sm:text-base text-slate-400 max-w-2xl mx-auto leading-relaxed">
                Tempel tautan YouTube atau unggah file MP4 lokal Anda. ClipMind akan menyusun ringkasan
                berbab, menemukan highlight viral, membuka ruang tanya-jawab, lalu membantu trim,
                reframe rasio, membakar subtitle, dan mengekspor klip MP4 siap re-upload.
              </p>
            </div>

            {/* MP4 Drag & Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              className={`mx-auto max-w-xl rounded-2xl border-2 border-dashed p-6 transition-colors ${
                dragActive
                  ? 'border-emerald-400 bg-emerald-500/10'
                  : 'border-white/15 bg-[#121620]/70 hover:border-violet-500/50'
              }`}
            >
              <div className="flex flex-col items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300">
                  <Upload className="h-5 w-5" />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-white">
                    Impor Video Lokal (.mp4)
                  </p>
                  <p className="text-xs text-slate-400">
                    Seret file .mp4 ke sini atau klik tombol di bawah (maks. 300 MB). Analisis, trim, edit subtitle/reframe/VO, lalu unduh kembali sebagai MP4 siap re-upload.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => mp4InputRef.current?.click()}
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-2 text-xs font-semibold text-white hover:from-emerald-500 hover:to-teal-500 disabled:opacity-50 cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5" />
                  <span>Pilih File MP4 dari Perangkat</span>
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-xs text-slate-500">Contoh cepat YouTube:</span>
              {SAMPLE_VIDEOS.map((sample) => (
                <button
                  key={sample.url}
                  type="button"
                  onClick={() => {
                    setUrlInput(sample.url);
                    analyzeVideoUrl(sample.url);
                  }}
                  className="rounded-lg border border-white/10 bg-[#121620] px-3 py-1.5 text-xs text-slate-200 hover:border-violet-500/60 hover:text-white transition-colors cursor-pointer"
                >
                  {sample.label}
                </button>
              ))}
            </div>
          </section>
        ) : (
          /* Two-Column Workspace */
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT COLUMN (sticky on desktop): Player + Timeline + Saved Clips */}
            <div className="lg:col-span-5 lg:sticky lg:top-20 space-y-4">
              <YouTubePlayerPanel />
              <SavedClipsList />
            </div>

            {/* RIGHT COLUMN: Tabbed Analysis & Studio Panel */}
            <div className="lg:col-span-7 rounded-xl border border-white/[0.08] bg-[#121620] overflow-hidden">
              {/* Tab Bar (scrollable on mobile) */}
              <div
                role="tablist"
                aria-label="Panel analisis dan editor"
                className="flex items-center gap-1 overflow-x-auto border-b border-white/[0.08] bg-[#0B0D12]/60 px-3 pt-2.5"
              >
                {TABS.map((tab) => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.key;
                  const countBadge =
                    tab.key === 'klip' && clips.length > 0 ? ` (${clips.length})` : '';
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActiveTab(tab.key)}
                      className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        isActive
                          ? 'border-violet-500 text-white'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>
                        {tab.label}
                        {countBadge}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Progressive Status Strip while background analysis runs */}
              {isAnalyzing && (
                <div className="border-b border-white/[0.06] bg-violet-500/10 px-4 py-2 text-xs text-violet-200 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                  <span>{progress.stepText || 'Menganalisis video secara paralel…'}</span>
                </div>
              )}

              {/* Tab Content */}
              <div className="p-4 sm:p-5">
                {activeTab === 'ringkasan' && <SummaryTab />}
                {activeTab === 'chat' && <ChatTab />}
                {activeTab === 'highlight' && <HighlightTab />}
                {activeTab === 'klip' && <ClipEditorTab />}
                {activeTab === 'transkrip' && <TranscriptTab />}
                {activeTab === 'studio' && <StudioTab />}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-4 px-4 sm:px-6 text-center text-xs text-slate-500">
        Klip virtual YouTube tidak mengunduh video kreator; ekspor MP4 tersedia penuh untuk video lokal yang Anda impor. Hormati hak cipta kreator.
      </footer>

      <ProviderSettingsModal
        open={providerModalOpen}
        onClose={() => setProviderModalOpen(false)}
      />
    </div>
  );
}

export default function App() {
  return (
    <ClipMindProvider>
      <ClipMindWorkspace />
    </ClipMindProvider>
  );
}
