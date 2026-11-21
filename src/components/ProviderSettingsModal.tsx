import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RotateCcw,
  ShieldCheck,
  X,
  XCircle,
} from 'lucide-react';
import { useClipMind } from '../context/ClipMindContext';
import { testProviderConnection } from '../services/geminiService';
import type { AIProviderEntry, AIProviderId } from '../types';
import {
  maskApiKey,
  PROVIDER_ORDER,
  PROVIDER_PRESETS,
  validateProviderConfig,
} from '../utils/aiProviders';

interface ProviderSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function ProviderSettingsModal({ open, onClose }: ProviderSettingsModalProps) {
  const {
    aiSettings,
    setActiveProvider,
    updateProviderConfig,
    resetAISettings,
  } = useClipMind();

  const [selectedTab, setSelectedTab] = useState<AIProviderId>(aiSettings.activeProvider);
  const [draft, setDraft] = useState<AIProviderEntry>(
    aiSettings.providers[aiSettings.activeProvider]
  );
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState(false);

  useEffect(() => {
    if (open) {
      setSelectedTab(aiSettings.activeProvider);
      setDraft(aiSettings.providers[aiSettings.activeProvider]);
      setShowKey(false);
      setTestResult(null);
      setFormError(null);
      setSavedBanner(false);
    }
  }, [open, aiSettings]);

  const switchTab = (id: AIProviderId) => {
    setSelectedTab(id);
    setDraft(aiSettings.providers[id]);
    setShowKey(false);
    setTestResult(null);
    setFormError(null);
    setSavedBanner(false);
  };

  if (!open) return null;

  const preset = PROVIDER_PRESETS[selectedTab];
  const isCurrentActive = aiSettings.activeProvider === selectedTab;

  const handleSave = (activate: boolean) => {
    const check = validateProviderConfig(draft);
    if (!check.valid) {
      setFormError(check.error || 'Konfigurasi tidak valid.');
      return;
    }
    setFormError(null);
    updateProviderConfig(selectedTab, draft);
    if (activate) {
      setActiveProvider(selectedTab);
    }
    setSavedBanner(true);
    setTimeout(() => setSavedBanner(false), 2000);
  };

  const handleTest = async () => {
    const check = validateProviderConfig(draft);
    if (!check.valid) {
      setFormError(check.error || 'Konfigurasi tidak valid.');
      return;
    }
    setFormError(null);
    setTestResult(null);
    setTesting(true);
    try {
      const res = await testProviderConnection(draft);
      setTestResult({
        ok: true,
        message: `Terhubung ke ${preset.label} (${res.model}) dalam ${res.latencyMs} ms.`,
      });
    } catch (err) {
      setTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Gagal menghubungi provider.',
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="provider-modal-title"
    >
      <div className="w-full max-w-2xl rounded-2xl border border-white/12 bg-[#121620] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 text-white">
              <KeyRound className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2
                id="provider-modal-title"
                className="font-display text-base font-bold text-white"
              >
                Pengaturan Provider AI &amp; API Key
              </h2>
              <p className="text-xs text-slate-400">
                Simpan API Key di browser (localStorage) dan pilih provider aktif.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup pengaturan provider"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-white/10 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-5 space-y-5">
          {/* Provider Tabs */}
          <div
            role="tablist"
            aria-label="Daftar provider AI"
            className="grid grid-cols-2 sm:grid-cols-3 gap-2"
          >
            {PROVIDER_ORDER.map((id) => {
              const p = PROVIDER_PRESETS[id];
              const entry = aiSettings.providers[id];
              const isSelected = selectedTab === id;
              const isActive = aiSettings.activeProvider === id;
              const hasKey = Boolean(entry.apiKey.trim());

              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => switchTab(id)}
                  className={`rounded-xl border p-3 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-violet-500 bg-violet-500/15'
                      : 'border-white/[0.08] bg-[#0B0D12] hover:border-white/20'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-semibold text-white truncate">
                      {id === 'custom' && entry.customName
                        ? entry.customName
                        : p.label}
                    </span>
                    {isActive && (
                      <span className="text-[10px] font-semibold text-emerald-400 shrink-0">
                        Aktif
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-400 truncate mt-0.5 font-mono">
                    {hasKey
                      ? maskApiKey(entry.apiKey)
                      : id === 'gemini'
                      ? 'Kunci server bawaan'
                      : 'Belum ada key'}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Selected Provider Form */}
          <div className="rounded-xl border border-white/[0.08] bg-[#0B0D12] p-4 space-y-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-display text-sm font-semibold text-white">
                  {preset.label}
                </h3>
                {isCurrentActive && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Sedang digunakan</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                {preset.description}
              </p>
            </div>

            {selectedTab === 'custom' && (
              <label className="block space-y-1 text-xs">
                <span className="text-slate-300 font-medium">Nama Label Provider</span>
                <input
                  type="text"
                  value={draft.customName || ''}
                  onChange={(e) => setDraft({ ...draft, customName: e.target.value })}
                  placeholder="mis. Together AI / Ollama Lokal"
                  className="w-full rounded-lg border border-white/10 bg-[#121620] px-3 py-2 text-xs text-white focus:border-violet-500 focus:outline-none"
                />
              </label>
            )}

            {/* API Key Input */}
            <div className="space-y-1 text-xs">
              <label htmlFor="provider-api-key" className="block text-slate-300 font-medium">
                API Key {preset.requiresApiKeyInUi ? '(Wajib)' : '(Opsional)'}
              </label>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    id="provider-api-key"
                    type={showKey ? 'text' : 'password'}
                    autoComplete="off"
                    placeholder={preset.keyPlaceholder}
                    value={draft.apiKey}
                    onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                    className="w-full rounded-lg border border-white/10 bg-[#121620] pl-3 pr-10 py-2 font-mono text-xs text-white placeholder:font-sans placeholder:text-slate-500 focus:border-violet-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    aria-label={showKey ? 'Sembunyikan API Key' : 'Tampilkan API Key'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {draft.apiKey && (
                  <button
                    type="button"
                    onClick={() => setDraft({ ...draft, apiKey: '' })}
                    className="rounded-lg border border-white/10 px-2.5 py-2 text-xs text-slate-300 hover:bg-white/10 cursor-pointer"
                  >
                    Hapus
                  </button>
                )}
              </div>
            </div>

            {/* Base URL (Non-Gemini) */}
            {selectedTab !== 'gemini' && (
              <label className="block space-y-1 text-xs">
                <span className="text-slate-300 font-medium">Base URL Endpoint</span>
                <input
                  type="url"
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  className="w-full rounded-lg border border-white/10 bg-[#121620] px-3 py-2 font-mono text-xs text-white focus:border-violet-500 focus:outline-none"
                />
              </label>
            )}

            {/* Model Name + Suggested Presets */}
            <div className="space-y-1.5 text-xs">
              <label htmlFor="provider-model-input" className="block text-slate-300 font-medium">
                Model ID
              </label>
              <input
                id="provider-model-input"
                type="text"
                value={draft.model}
                onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                placeholder={preset.defaultModel}
                className="w-full rounded-lg border border-white/10 bg-[#121620] px-3 py-2 font-mono text-xs text-white focus:border-violet-500 focus:outline-none"
              />
              {preset.suggestedModels.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-[11px] text-slate-500">Rekomendasi:</span>
                  {preset.suggestedModels.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDraft({ ...draft, model: m })}
                      className={`rounded-md px-2 py-0.5 font-mono text-[11px] cursor-pointer ${
                        draft.model === m
                          ? 'bg-violet-600 text-white'
                          : 'bg-white/[0.06] text-slate-300 hover:text-white'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedTab !== 'gemini' && (
              <p className="text-[11px] text-amber-300/90 leading-relaxed">
                Catatan: Provider non-Gemini menganalisis video berdasarkan metadata dan subtitle publik YouTube. Fitur Audio TTS tetap dapat menggunakan OpenAI TTS (khusus OpenAI) atau fallback ke Gemini TTS.
              </p>
            )}

            {formError && (
              <p role="alert" className="text-xs text-rose-400">
                {formError}
              </p>
            )}

            {testResult && (
              <div
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                  testResult.ok
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                    : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
                }`}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}

            {savedBanner && (
              <p className="text-xs font-medium text-emerald-400">
                Konfigurasi provider berhasil disimpan ke localStorage.
              </p>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] bg-[#0B0D12]/60 px-5 py-3.5">
          <button
            type="button"
            onClick={() => {
              resetAISettings();
              setTestResult(null);
              setFormError(null);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:bg-white/10 cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset Default</span>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={testing}
              onClick={handleTest}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/12 bg-white/[0.05] px-3 py-2 text-xs font-medium text-white hover:bg-white/[0.12] disabled:opacity-40 cursor-pointer"
            >
              {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>Uji Koneksi</span>
            </button>

            <button
              type="button"
              onClick={() => handleSave(false)}
              className="rounded-lg border border-white/12 bg-white/[0.06] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-white/[0.12] cursor-pointer"
            >
              Simpan Key
            </button>

            <button
              type="button"
              onClick={() => {
                handleSave(true);
              }}
              className="rounded-lg bg-gradient-to-r from-violet-600 to-blue-600 px-4 py-2 text-xs font-semibold text-white hover:from-violet-500 hover:to-blue-500 cursor-pointer"
            >
              Simpan &amp; Aktifkan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
