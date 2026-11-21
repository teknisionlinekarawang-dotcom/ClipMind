import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {
  AIProviderEntry,
  AIProviderId,
  AISettingsState,
  AspectRatioPreset,
  ChatMessage,
  ClipEditorSubTab,
  GeminiVoiceName,
  HighlightItem,
  LocalVideoInfo,
  MainTabKey,
  ModelMode,
  StudioArtifacts,
  SubtitleLine,
  SummaryData,
  SummaryLength,
  SummaryStyle,
  TranscriptSegment,
  VideoProjectCache,
  VideoSourceType,
  VirtualClip,
  VoiceOverTone,
} from '../types';
import {
  analyzeHighlights,
  analyzeSummary,
  analyzeTranscriptChunk,
  fetchYouTubeOembed,
  generateVoiceOverAudio,
  setActiveAISettings,
  uploadLocalMp4Video,
} from '../services/geminiService';
import {
  AI_SETTINGS_STORAGE_KEY,
  createDefaultAISettings,
  mergeStoredAISettings,
} from '../utils/aiProviders';
import {
  extractYouTubeVideoId,
  formatTimestamp,
  normalizeYouTubeUrl,
} from '../utils/youtube';
import { validateClipRange } from '../utils/validators';
import { base64ToUint8Array, wrapPcmToWav } from '../utils/audio';
import {
  generateClipSubtitlesFromTranscript,
  getActiveTranscriptSubtitle,
} from '../utils/subtitles';
import { getDefaultClipEditing, normalizeClipEditing } from '../utils/mp4Helpers';

export interface YTPlayerInstance {
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  setVolume: (volume: number) => void;
  getVolume: () => number;
  setPlaybackRate?: (rate: number) => void;
  setMuted?: (muted: boolean) => void;
  destroy: () => void;
}

interface ProgressState {
  summary: 'idle' | 'loading' | 'done' | 'error';
  highlights: 'idle' | 'loading' | 'done' | 'error';
  transcript: 'idle' | 'loading' | 'done' | 'error';
  stepText: string;
}

interface ClipMindContextValue {
  urlInput: string;
  setUrlInput: (val: string) => void;
  sourceType: VideoSourceType;
  localVideoId: string | null;
  localVideoObjectUrl: string | null;
  localVideoInfo: LocalVideoInfo | null;
  uploadProgress: number | null;
  videoId: string | null;
  youtubeUrl: string;
  videoTitle: string;
  videoAuthor: string;
  durationSec: number;
  setDurationSec: (dur: number) => void;
  modelMode: ModelMode;
  setModelMode: (m: ModelMode) => void;

  currentTime: number;
  setCurrentTime: (t: number) => void;
  isPlaying: boolean;
  setIsPlaying: (p: boolean) => void;
  playerRef: React.MutableRefObject<YTPlayerInstance | null>;

  activeTab: MainTabKey;
  setActiveTab: (tab: MainTabKey) => void;
  activeEditorSubTab: ClipEditorSubTab;
  setActiveEditorSubTab: (sub: ClipEditorSubTab) => void;

  trimStart: number;
  trimEnd: number;
  setTrimStart: (sec: number) => void;
  setTrimEnd: (sec: number) => void;
  trimError: string | null;

  rangePlayback: { start: number; end: number } | null;
  reelQueue: VirtualClip[];
  reelIndex: number;

  summary?: SummaryData;
  summaryStyle: SummaryStyle;
  summaryLength: SummaryLength;
  summaryError: string | null;
  highlights?: HighlightItem[];
  highlightsError: string | null;
  transcript: TranscriptSegment[];
  transcriptLoadedUntil: number;
  transcriptError: string | null;
  showTranscriptSubtitles: boolean;
  setShowTranscriptSubtitles: (show: boolean) => void;
  narrationTone: VoiceOverTone;
  setNarrationTone: (tone: VoiceOverTone) => void;
  narrationLanguage: string;
  setNarrationLanguage: (lang: string) => void;
  narrationVoice: GeminiVoiceName;
  setNarrationVoice: (voice: GeminiVoiceName) => void;
  narrationSpeakingStyle: string;
  setNarrationSpeakingStyle: (style: string) => void;
  narrationOriginalVolume: number;
  setNarrationOriginalVolume: (vol: number) => void;
  narrationAudioPcm: string | null;
  narrationAudioLoading: boolean;
  narrationError: string | null;
  chat: ChatMessage[];
  setChat: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  studio: StudioArtifacts;
  updateStudio: (patch: Partial<StudioArtifacts>) => void;

  clips: VirtualClip[];
  selectedClipId: string | null;
  setSelectedClipId: (id: string | null) => void;
  selectedClip: VirtualClip | null;

  progress: ProgressState;
  globalError: string | null;
  setGlobalError: (err: string | null) => void;

  activeSubtitleText: string;
  activeSubtitleKaraokeWords: Array<{ kata: string; active: boolean }>;

  analyzeVideoUrl: (rawUrl: string) => Promise<void>;
  importLocalMp4File: (file: File) => Promise<void>;
  regenerateSummary: (style?: SummaryStyle, length?: SummaryLength) => Promise<void>;
  regenerateHighlights: (focusQuery?: string) => Promise<void>;
  loadNextTranscriptChunk: (forceRestart?: boolean) => Promise<void>;
  generateNarrationTranscript: (opts?: {
    tone?: VoiceOverTone;
    language?: string;
  }) => Promise<void>;
  transcribeLocalAudioAccurate: () => Promise<void>;
  updateTranscriptSegment: (index: number, newText: string) => void;
  generateNarrationVoiceOver: () => Promise<void>;
  playVideoWithNarration: () => void;
  applyNarrationToClipAndEdit: () => void;

  seekTo: (seconds: number, autoPlay?: boolean) => void;
  togglePlayPause: () => void;
  nudgeTime: (deltaSeconds: number) => void;
  playRange: (
    start: number,
    end: number,
    options?: {
      withVoiceOverPcm?: string;
      originalVolume?: number;
      playbackRate?: number;
      muteOriginal?: boolean;
      clipSubtitles?: SubtitleLine[];
      aspectRatio?: AspectRatioPreset;
    }
  ) => void;
  stopRangePlayback: () => void;
  playAllClipsReel: () => void;

  createClip: (params: {
    judul: string;
    mulai: number;
    selesai: number;
    sumber: 'manual' | 'highlight' | 'bab';
    hook?: string;
  }) => VirtualClip | null;
  updateClip: (id: string, patch: Partial<VirtualClip>) => void;
  deleteClip: (id: string) => void;
  duplicateClip: (id: string) => void;
  reorderClips: (fromIndex: number, toIndex: number) => void;

  exportProjectJson: () => string;
  importProjectJson: (jsonText: string) => { ok: boolean; error?: string };
  askAboutCurrentMoment: () => void;
  pendingChatPrompt: string | null;
  consumePendingChatPrompt: () => void;

  aiSettings: AISettingsState;
  activeProviderConfig: AIProviderEntry;
  setActiveProvider: (id: AIProviderId) => void;
  updateProviderConfig: (id: AIProviderId, patch: Partial<AIProviderEntry>) => void;
  resetAISettings: () => void;
}

const ClipMindContext = createContext<ClipMindContextValue | null>(null);

const STORAGE_PREFIX = 'clipmind_project_v1_';

function makeDefaultClip(params: {
  videoId: string;
  judul: string;
  mulai: number;
  selesai: number;
  sumber: 'manual' | 'highlight' | 'bab';
  hook?: string;
}): VirtualClip {
  return {
    id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    judul: params.judul,
    mulai: params.mulai,
    selesai: params.selesai,
    sumber: params.sumber,
    subtitle: [],
    subtitleAppearance: {
      preset: 'bold',
      fontSize: 22,
      color: '#FFFFFF',
      position: 'bottom',
    },
    naskahVO: {
      naskah: '',
      nada: 'Informatif',
      bahasa: 'Indonesia',
      suara: 'Kore',
      gayaBicara: 'Ceria, jelas, dan bertenaga',
      originalVolume: 20,
    },
    rasio: {
      rasio: '16:9',
      fokusX: 50,
    },
    editing: getDefaultClipEditing(),
    thumbnail: {
      backgroundMode: 'youtube',
      gradientPalette: 'violet-blue',
      text: params.hook ? params.hook.split(' ').slice(0, 4).join(' ') : params.judul.split(' ').slice(0, 4).join(' '),
      fontFamily: 'Plus Jakarta Sans',
      fontSize: 54,
      textColor: '#FFFFFF',
      strokeColor: '#0B0D12',
      shadowBlur: 14,
      textX: 0.5,
      textY: 0.78,
      darkOverlay: 0.3,
      sticker: '',
      stickerX: 0.85,
      stickerY: 0.2,
      aspectRatio: '16:9',
      ideas: [],
    },
  };
}

export function serializeTranscriptContext(
  segments: TranscriptSegment[]
): string | undefined {
  if (!segments.length) return undefined;
  return segments
    .map((s) => `[${formatTimestamp(s.mulai)}] ${s.pembicara}: ${s.teks}`)
    .join('\n')
    .slice(0, 25000);
}

export function ClipMindProvider({ children }: { children: React.ReactNode }) {
  const [urlInput, setUrlInput] = useState('');
  const [sourceType, setSourceType] = useState<VideoSourceType>('youtube');
  const [localVideoId, setLocalVideoId] = useState<string | null>(null);
  const [localVideoObjectUrl, setLocalVideoObjectUrl] = useState<string | null>(null);
  const [localVideoInfo, setLocalVideoInfo] = useState<LocalVideoInfo | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [videoTitle, setVideoTitle] = useState('');
  const [videoAuthor, setVideoAuthor] = useState('');
  const [durationSec, setDurationSec] = useState(600);
  const [modelMode, setModelMode] = useState<ModelMode>('fast');

  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playerRef = useRef<YTPlayerInstance | null>(null);
  const voAudioRef = useRef<HTMLAudioElement | null>(null);
  const voObjectUrlRef = useRef<string | null>(null);

  const [activeTab, setActiveTab] = useState<MainTabKey>('ringkasan');
  const [activeEditorSubTab, setActiveEditorSubTab] =
    useState<ClipEditorSubTab>('subtitle');

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(30);
  const [trimError, setTrimError] = useState<string | null>(null);

  const [rangePlayback, setRangePlayback] = useState<{ start: number; end: number } | null>(
    null
  );
  const [reelQueue, setReelQueue] = useState<VirtualClip[]>([]);
  const [reelIndex, setReelIndex] = useState(-1);

  const [summary, setSummary] = useState<SummaryData | undefined>(undefined);
  const [summaryStyle, setSummaryStyle] = useState<SummaryStyle>('Santai');
  const [summaryLength, setSummaryLength] = useState<SummaryLength>('Sedang');
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [highlights, setHighlights] = useState<HighlightItem[] | undefined>(undefined);
  const [highlightsError, setHighlightsError] = useState<string | null>(null);

  const [transcript, setTranscript] = useState<TranscriptSegment[]>([]);
  const [transcriptLoadedUntil, setTranscriptLoadedUntil] = useState(0);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [showTranscriptSubtitles, setShowTranscriptSubtitles] = useState(false);
  const [narrationTone, setNarrationTone] = useState<VoiceOverTone>('Informatif');
  const [narrationLanguage, setNarrationLanguage] = useState('Indonesia');
  const [narrationVoice, setNarrationVoice] = useState<GeminiVoiceName>('Kore');
  const [narrationSpeakingStyle, setNarrationSpeakingStyle] = useState(
    'Jelas, natural, dan ekspresif'
  );
  const [narrationOriginalVolume, setNarrationOriginalVolume] = useState(15);
  const [narrationAudioPcm, setNarrationAudioPcm] = useState<string | null>(null);
  const [narrationAudioLoading, setNarrationAudioLoading] = useState(false);
  const [narrationError, setNarrationError] = useState<string | null>(null);

  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [studio, setStudio] = useState<StudioArtifacts>({});
  const [clips, setClips] = useState<VirtualClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);

  const [progress, setProgress] = useState<ProgressState>({
    summary: 'idle',
    highlights: 'idle',
    transcript: 'idle',
    stepText: '',
  });
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [pendingChatPrompt, setPendingChatPrompt] = useState<string | null>(null);

  const [aiSettings, setAiSettings] = useState<AISettingsState>(() => {
    let initial = createDefaultAISettings();
    try {
      const raw = localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
      if (raw) {
        initial = mergeStoredAISettings(raw);
      }
    } catch {
      initial = createDefaultAISettings();
    }
    setActiveAISettings(initial);
    return initial;
  });

  const abortRef = useRef<AbortController | null>(null);

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;
  const activeProviderConfig = aiSettings.providers[aiSettings.activeProvider];

  // Sync AI provider settings with geminiService & persist to localStorage
  useEffect(() => {
    setActiveAISettings(aiSettings);
    try {
      localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(aiSettings));
    } catch {
      // Ignore storage quota warnings
    }
  }, [aiSettings]);

  const setActiveProvider = useCallback((id: AIProviderId) => {
    setAiSettings((prev) => ({ ...prev, activeProvider: id }));
  }, []);

  const updateProviderConfig = useCallback(
    (id: AIProviderId, patch: Partial<AIProviderEntry>) => {
      setAiSettings((prev) => ({
        ...prev,
        providers: {
          ...prev.providers,
          [id]: {
            ...prev.providers[id],
            ...patch,
            id,
          },
        },
      }));
    },
    []
  );

  const resetAISettings = useCallback(() => {
    setAiSettings(createDefaultAISettings());
  }, []);

  // Keep default/current trim range within actual video duration when durationSec updates
  useEffect(() => {
    if (!videoId || durationSec <= 0) return;
    setTrimEnd((prev) => (prev > durationSec ? durationSec : prev));
    setTrimStart((prev) => (prev >= durationSec ? Math.max(0, durationSec - 5) : prev));
  }, [durationSec, videoId]);

  // Validate trim range reactively
  useEffect(() => {
    if (!videoId) {
      setTrimError(null);
      return;
    }
    const check = validateClipRange(trimStart, trimEnd, durationSec);
    setTrimError(check.valid ? null : check.error || 'Rentang tidak valid');
  }, [trimStart, trimEnd, durationSec, videoId]);

  // Cleanup local object URL on unmount
  const localObjUrlRef = useRef<string | null>(null);
  useEffect(() => {
    localObjUrlRef.current = localVideoObjectUrl;
  }, [localVideoObjectUrl]);
  useEffect(() => {
    return () => {
      if (localObjUrlRef.current) {
        URL.revokeObjectURL(localObjUrlRef.current);
      }
    };
  }, []);

  // Persist project cache in localStorage whenever core project state changes
  useEffect(() => {
    if (!videoId || sourceType === 'local') return;
    const payload: VideoProjectCache = {
      videoId,
      sourceType,
      youtubeUrl,
      title: videoTitle,
      author: videoAuthor,
      durationSec,
      summary,
      summaryStyle,
      summaryLength,
      highlights,
      transcript,
      transcriptLoadedUntil,
      showTranscriptSubtitles,
      clips,
      chat,
      studio,
      updatedAt: Date.now(),
    };
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${videoId}`, JSON.stringify(payload));
    } catch {
      // Ignore storage quota warnings
    }
  }, [
    sourceType,
    videoId,
    youtubeUrl,
    videoTitle,
    videoAuthor,
    durationSec,
    summary,
    summaryStyle,
    summaryLength,
    highlights,
    transcript,
    transcriptLoadedUntil,
    showTranscriptSubtitles,
    clips,
    chat,
    studio,
  ]);

  const stopVoAudio = useCallback(() => {
    if (voAudioRef.current) {
      voAudioRef.current.pause();
      voAudioRef.current = null;
    }
    if (voObjectUrlRef.current) {
      URL.revokeObjectURL(voObjectUrlRef.current);
      voObjectUrlRef.current = null;
    }
    try {
      playerRef.current?.setVolume(100);
    } catch {
      // ignore if player not ready
    }
  }, []);

  const stopRangePlayback = useCallback(() => {
    setRangePlayback(null);
    setReelQueue([]);
    setReelIndex(-1);
    stopVoAudio();
    try {
      playerRef.current?.pauseVideo();
    } catch {
      // ignore
    }
  }, [stopVoAudio]);

  const seekTo = useCallback((seconds: number, autoPlay = true) => {
    const clamped = Math.max(0, Math.floor(seconds));
    setCurrentTime(clamped);
    try {
      if (playerRef.current) {
        playerRef.current.seekTo(clamped, true);
        if (autoPlay) {
          playerRef.current.playVideo();
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const togglePlayPause = useCallback(() => {
    try {
      if (!playerRef.current) return;
      const state = playerRef.current.getPlayerState();
      if (state === 1) {
        playerRef.current.pauseVideo();
        voAudioRef.current?.pause();
      } else {
        playerRef.current.playVideo();
        voAudioRef.current?.play().catch(() => {});
      }
    } catch {
      // ignore
    }
  }, []);

  const nudgeTime = useCallback(
    (deltaSeconds: number) => {
      const target = Math.max(0, Math.min(durationSec || 86400, currentTime + deltaSeconds));
      seekTo(target, isPlaying);
    },
    [currentTime, durationSec, isPlaying, seekTo]
  );

  const playRange = useCallback(
    (
      start: number,
      end: number,
      options?: {
        withVoiceOverPcm?: string;
        originalVolume?: number;
        playbackRate?: number;
        muteOriginal?: boolean;
      }
    ) => {
      stopVoAudio();
      setRangePlayback({ start, end });
      try {
        if (playerRef.current) {
          playerRef.current.setMuted?.(Boolean(options?.muteOriginal));
          playerRef.current.setVolume(
            options?.muteOriginal ? 0 : Math.min(100, options?.originalVolume ?? 100)
          );
          if (options?.playbackRate) {
            playerRef.current.setPlaybackRate?.(options.playbackRate);
          }
          playerRef.current.seekTo(start, true);
          playerRef.current.playVideo();
        }
      } catch {
        // ignore
      }

      if (options?.withVoiceOverPcm) {
        try {
          const bytes = base64ToUint8Array(options.withVoiceOverPcm);
          const wavBlob = wrapPcmToWav(bytes, 24000, 1, 16);
          const url = URL.createObjectURL(wavBlob);
          voObjectUrlRef.current = url;
          const audio = new Audio(url);
          voAudioRef.current = audio;
          audio.play().catch(() => {});
        } catch {
          // ignore audio playback error
        }
      }
    },
    [stopVoAudio]
  );

  // 200ms poll for currentTime, automatic end-time pause, and reel progression
  useEffect(() => {
    if (!videoId) return;
    const id = window.setInterval(() => {
      const player = playerRef.current;
      if (!player) return;
      try {
        const t = player.getCurrentTime();
        const dur = player.getDuration();
        if (Number.isFinite(dur) && dur > 0 && Math.abs(dur - durationSec) > 2) {
          setDurationSec(Math.floor(dur));
        }
        if (Number.isFinite(t)) {
          setCurrentTime(t);
          if (rangePlayback && t >= rangePlayback.end) {
            if (reelQueue.length > 0 && reelIndex >= 0 && reelIndex + 1 < reelQueue.length) {
              const nextIdx = reelIndex + 1;
              const nextClip = reelQueue[nextIdx];
              setReelIndex(nextIdx);
              setSelectedClipId(nextClip.id);
              setRangePlayback({ start: nextClip.mulai, end: nextClip.selesai });
              player.seekTo(nextClip.mulai, true);
              player.playVideo();
            } else {
              player.pauseVideo();
              setRangePlayback(null);
              setReelQueue([]);
              setReelIndex(-1);
              stopVoAudio();
            }
          }
        }
      } catch {
        // ignore transient YT API calls
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [videoId, durationSec, rangePlayback, reelQueue, reelIndex, stopVoAudio]);

  const playAllClipsReel = useCallback(() => {
    if (clips.length === 0) return;
    setReelQueue(clips);
    setReelIndex(0);
    const first = clips[0];
    const ed = normalizeClipEditing(first.editing);
    setSelectedClipId(first.id);
    playRange(first.mulai, first.selesai, {
      withVoiceOverPcm:
        ed.includeVoiceOver ? first.naskahVO.audioBase64Pcm : undefined,
      originalVolume: first.naskahVO.audioBase64Pcm
        ? first.naskahVO.originalVolume
        : Math.min(100, ed.clipVolume),
      playbackRate: ed.speed,
      muteOriginal: ed.muteOriginal,
    });
  }, [clips, playRange]);

  const runParallelAnalysis = useCallback(
    async (
      source: { youtubeUrl?: string; localVideoId?: string },
      style: SummaryStyle,
      length: SummaryLength,
      mode: ModelMode,
      durHint?: number
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSummaryError(null);
      setHighlightsError(null);
      setProgress({
        summary: 'loading',
        highlights: 'loading',
        transcript: 'idle',
        stepText: 'Membaca video… Menyusun bab… Mencari highlight…',
      });

      const summaryPromise = analyzeSummary({
        youtubeUrl: source.youtubeUrl || undefined,
        localVideoId: source.localVideoId || undefined,
        style,
        length,
        mode,
        durationHint: durHint,
        signal: controller.signal,
      })
        .then((res) => {
          setSummary(res);
          if (res.judul && !source.localVideoId) {
            setVideoTitle((prev) => prev || res.judul);
          }
          if (res.durasi_total_detik > 0) {
            setDurationSec((prev) => (prev === 600 ? res.durasi_total_detik : prev));
          }
          setProgress((p) => ({
            ...p,
            summary: 'done',
            stepText:
              p.highlights === 'loading'
                ? 'Ringkasan siap. Menyelesaikan pencarian highlight…'
                : 'Analisis selesai',
          }));
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setSummaryError(err instanceof Error ? err.message : 'Gagal membuat ringkasan.');
          setProgress((p) => ({ ...p, summary: 'error' }));
        });

      const highlightsPromise = analyzeHighlights({
        youtubeUrl: source.youtubeUrl || undefined,
        localVideoId: source.localVideoId || undefined,
        mode,
        durationHint: durHint,
        signal: controller.signal,
      })
        .then((res) => {
          setHighlights(res);
          setProgress((p) => ({
            ...p,
            highlights: 'done',
            stepText:
              p.summary === 'loading'
                ? 'Highlight siap. Menyelesaikan ringkasan & bab…'
                : 'Analisis selesai',
          }));
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setHighlightsError(err instanceof Error ? err.message : 'Gagal mencari highlight.');
          setProgress((p) => ({ ...p, highlights: 'error' }));
        });

      await Promise.allSettled([summaryPromise, highlightsPromise]);
    },
    []
  );

  const analyzeVideoUrl = useCallback(
    async (rawUrl: string) => {
      const id = extractYouTubeVideoId(rawUrl);
      if (!id) {
        setGlobalError(
          'URL YouTube tidak dikenali. Gunakan format youtube.com/watch?v=, youtu.be/, youtube.com/shorts/, atau youtube.com/live/.'
        );
        return;
      }

      setGlobalError(null);
      stopRangePlayback();
      if (localVideoObjectUrl) {
        URL.revokeObjectURL(localVideoObjectUrl);
        setLocalVideoObjectUrl(null);
      }
      setSourceType('youtube');
      setLocalVideoId(null);
      setLocalVideoInfo(null);

      const normalized = normalizeYouTubeUrl(id);
      setUrlInput(rawUrl);
      setVideoId(id);
      setYoutubeUrl(normalized);
      setCurrentTime(0);
      setTrimStart(0);
      setTrimEnd(30);

      // Check localStorage cache first
      try {
        const cachedRaw = localStorage.getItem(`${STORAGE_PREFIX}${id}`);
        if (cachedRaw) {
          const cached = JSON.parse(cachedRaw) as VideoProjectCache;
          setVideoTitle(cached.title || '');
          setVideoAuthor(cached.author || '');
          setDurationSec(cached.durationSec || 600);
          setSummary(cached.summary);
          setSummaryStyle(cached.summaryStyle || 'Santai');
          setSummaryLength(cached.summaryLength || 'Sedang');
          setHighlights(cached.highlights);
          setTranscript(cached.transcript || []);
          setTranscriptLoadedUntil(cached.transcriptLoadedUntil || 0);
          setShowTranscriptSubtitles(Boolean(cached.showTranscriptSubtitles));
          setNarrationAudioPcm(null);
          setNarrationError(null);
          setClips(cached.clips || []);
          setSelectedClipId(cached.clips?.[0]?.id ?? null);
          setChat(cached.chat || []);
          setStudio(cached.studio || {});

          if (cached.summary && cached.highlights) {
            setProgress({
              summary: 'done',
              highlights: 'done',
              transcript: cached.transcript?.length ? 'done' : 'idle',
              stepText: 'Dimuat dari cache lokal',
            });
            return;
          }
        } else {
          setVideoTitle('');
          setVideoAuthor('');
          setDurationSec(600);
          setSummary(undefined);
          setHighlights(undefined);
          setTranscript([]);
          setTranscriptLoadedUntil(0);
          setShowTranscriptSubtitles(false);
          setNarrationAudioPcm(null);
          setNarrationError(null);
          setClips([]);
          setSelectedClipId(null);
          setChat([]);
          setStudio({});
        }
      } catch {
        // ignore cache parse errors
      }

      // Fetch fast oEmbed metadata in background
      fetchYouTubeOembed(normalized)
        .then((meta) => {
          setVideoTitle(meta.title);
          setVideoAuthor(meta.author);
        })
        .catch(() => {
          // Non-fatal; summary still runs
        });

      await runParallelAnalysis({ youtubeUrl: normalized }, summaryStyle, summaryLength, modelMode);
    },
    [localVideoObjectUrl, modelMode, runParallelAnalysis, stopRangePlayback, summaryLength, summaryStyle]
  );

  const importLocalMp4File = useCallback(
    async (file: File) => {
      const isMp4 =
        file.type === 'video/mp4' || /\.mp4$/i.test(file.name);
      if (!isMp4) {
        setGlobalError('Format file harus berupa video .mp4.');
        return;
      }
      if (file.size > 300 * 1024 * 1024) {
        setGlobalError('Ukuran file MP4 melebihi batas maksimal 300 MB.');
        return;
      }

      setGlobalError(null);
      stopRangePlayback();
      setUploadProgress(0);

      try {
        const info = await uploadLocalMp4Video(file, (pct) => setUploadProgress(pct));
        if (localVideoObjectUrl) {
          URL.revokeObjectURL(localVideoObjectUrl);
        }
        const objectUrl = URL.createObjectURL(file);

        setSourceType('local');
        setLocalVideoId(info.localId);
        setLocalVideoInfo(info);
        setLocalVideoObjectUrl(objectUrl);
        setVideoId(info.localId);
        setYoutubeUrl('');
        setUrlInput('');
        setVideoTitle(info.filename.replace(/\.mp4$/i, ''));
        setVideoAuthor(`MP4 Lokal · ${info.width}×${info.height}`);
        setDurationSec(info.durationSec);
        setCurrentTime(0);
        setTrimStart(0);
        setTrimEnd(Math.min(30, info.durationSec));
        setSummary(undefined);
        setSummaryError(null);
        setHighlights(undefined);
        setHighlightsError(null);
        setTranscript([]);
        setTranscriptLoadedUntil(0);
        setTranscriptError(null);
        setShowTranscriptSubtitles(false);
        setNarrationAudioPcm(null);
        setNarrationError(null);
        setClips([]);
        setSelectedClipId(null);
        setChat([]);
        setStudio({});
        setActiveTab('ringkasan');
        setUploadProgress(null);

        await runParallelAnalysis(
          { localVideoId: info.localId },
          summaryStyle,
          summaryLength,
          modelMode,
          info.durationSec
        );
      } catch (err) {
        setUploadProgress(null);
        setGlobalError(
          err instanceof Error ? err.message : 'Gagal mengimpor file video MP4.'
        );
      }
    },
    [localVideoObjectUrl, modelMode, runParallelAnalysis, stopRangePlayback, summaryLength, summaryStyle]
  );

  const regenerateSummary = useCallback(
    async (style?: SummaryStyle, length?: SummaryLength) => {
      if (!youtubeUrl && !localVideoId) return;
      const nextStyle = style ?? summaryStyle;
      const nextLength = length ?? summaryLength;
      setSummaryStyle(nextStyle);
      setSummaryLength(nextLength);
      setSummaryError(null);
      setProgress((p) => ({
        ...p,
        summary: 'loading',
        stepText: 'Menyusun ulang ringkasan…',
      }));
      try {
        const res = await analyzeSummary({
          youtubeUrl: youtubeUrl || undefined,
          localVideoId: localVideoId || undefined,
          transcriptContextText: serializeTranscriptContext(transcript),
          style: nextStyle,
          length: nextLength,
          mode: modelMode,
          durationHint: durationSec,
        });
        setSummary(res);
        setProgress((p) => ({ ...p, summary: 'done', stepText: 'Ringkasan diperbarui' }));
      } catch (err) {
        setSummaryError(err instanceof Error ? err.message : 'Gagal memperbarui ringkasan.');
        setProgress((p) => ({ ...p, summary: 'error' }));
      }
    },
    [durationSec, localVideoId, modelMode, summaryLength, summaryStyle, transcript, youtubeUrl]
  );

  const regenerateHighlights = useCallback(
    async (focusQuery?: string) => {
      if (!youtubeUrl && !localVideoId) return;
      setHighlightsError(null);
      setProgress((p) => ({
        ...p,
        highlights: 'loading',
        stepText: focusQuery
          ? `Mencari highlight: "${focusQuery}"…`
          : 'Mencari highlight baru…',
      }));
      try {
        const res = await analyzeHighlights({
          youtubeUrl: youtubeUrl || undefined,
          localVideoId: localVideoId || undefined,
          transcriptContextText: serializeTranscriptContext(transcript),
          focusQuery,
          mode: modelMode,
          durationHint: durationSec,
        });
        setHighlights(res);
        setProgress((p) => ({ ...p, highlights: 'done', stepText: 'Highlight siap' }));
      } catch (err) {
        setHighlightsError(err instanceof Error ? err.message : 'Gagal mencari highlight.');
        setProgress((p) => ({ ...p, highlights: 'error' }));
      }
    },
    [durationSec, localVideoId, modelMode, transcript, youtubeUrl]
  );

  const loadNextTranscriptChunk = useCallback(
    async (forceRestart = false) => {
      if (!youtubeUrl && !localVideoId) return;
      const chunkSize = 600; // 10 minutes per lazy chunk
      const startSec = forceRestart ? 0 : transcriptLoadedUntil;
      const maxDur = durationSec > 0 ? durationSec : 3600;
      if (!forceRestart && startSec >= maxDur) return;

      const endSec = Math.min(maxDur, startSec + chunkSize);
      setTranscriptError(null);
      setProgress((p) => ({
        ...p,
        transcript: 'loading',
        stepText: `Memuat transkrip ${Math.floor(startSec / 60)}–${Math.ceil(endSec / 60)} menit…`,
      }));

      try {
        const segs = await analyzeTranscriptChunk({
          youtubeUrl: youtubeUrl || undefined,
          localVideoId: localVideoId || undefined,
          startSec,
          endSec,
          transcriptMode: 'auto',
          targetLanguage: narrationLanguage,
          mode: modelMode,
          durationHint: durationSec,
        });
        setTranscript((prev) => {
          const base = forceRestart ? [] : prev;
          return [...base, ...segs].sort((a, b) => a.mulai - b.mulai);
        });
        setTranscriptLoadedUntil(endSec);
        // Auto-activate player subtitle overlay if Gemini produced AI narration segments
        if (segs.some((s) => /narator ai/i.test(s.pembicara))) {
          setShowTranscriptSubtitles(true);
        }
        setProgress((p) => ({ ...p, transcript: 'done', stepText: 'Transkrip siap' }));
      } catch (err) {
        setTranscriptError(err instanceof Error ? err.message : 'Gagal memuat transkrip.');
        setProgress((p) => ({ ...p, transcript: 'error' }));
      }
    },
    [durationSec, localVideoId, modelMode, narrationLanguage, transcriptLoadedUntil, youtubeUrl]
  );

  const generateNarrationTranscript = useCallback(
    async (opts?: { tone?: VoiceOverTone; language?: string }) => {
      if (!youtubeUrl && !localVideoId) return;
      const effectiveTone = opts?.tone ?? narrationTone;
      const effectiveLang = opts?.language ?? narrationLanguage;
      if (opts?.tone) setNarrationTone(opts.tone);
      if (opts?.language) setNarrationLanguage(opts.language);

      const maxDur = durationSec > 0 ? durationSec : 600;
      const endSec = Math.min(maxDur, 600);
      setTranscriptError(null);
      setNarrationError(null);
      setNarrationAudioPcm(null);
      setProgress((p) => ({
        ...p,
        transcript: 'loading',
        stepText: 'Mengamati adegan video & menyusun skrip narasi AI…',
      }));

      try {
        const segs = await analyzeTranscriptChunk({
          youtubeUrl: youtubeUrl || undefined,
          localVideoId: localVideoId || undefined,
          startSec: 0,
          endSec,
          transcriptMode: 'visual_narration',
          narrationTone: effectiveTone,
          targetLanguage: effectiveLang,
          mode: modelMode,
          durationHint: durationSec,
        });
        const sorted = [...segs].sort((a, b) => a.mulai - b.mulai);
        setTranscript(sorted);
        setTranscriptLoadedUntil(endSec);
        // Automatically show generated narration as live subtitles on the video!
        setShowTranscriptSubtitles(true);

        // If a clip is currently selected and has no subtitles yet, populate its subtitles & VO script automatically
        if (selectedClipId) {
          setClips((prev) =>
            prev.map((c) => {
              if (c.id !== selectedClipId) return c;
              const autoSubs = generateClipSubtitlesFromTranscript(
                sorted,
                c.mulai,
                c.selesai
              );
              const fullScript = sorted
                .filter((s) => s.selesai > c.mulai && s.mulai < c.selesai)
                .map((s) => s.teks)
                .join(' ');
              return {
                ...c,
                subtitle: c.subtitle.length > 0 ? c.subtitle : autoSubs,
                naskahVO: {
                  ...c.naskahVO,
                  naskah: c.naskahVO.naskah.trim() ? c.naskahVO.naskah : fullScript,
                  nada: effectiveTone,
                  bahasa: effectiveLang,
                },
              };
            })
          );
        }

        setProgress((p) => ({
          ...p,
          transcript: 'done',
          stepText: 'Narasi AI & subtitle otomatis siap',
        }));
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Gagal membuat skrip narasi video.';
        setTranscriptError(msg);
        setNarrationError(msg);
        setProgress((p) => ({ ...p, transcript: 'error' }));
      }
    },
    [
      durationSec,
      localVideoId,
      modelMode,
      narrationLanguage,
      narrationTone,
      selectedClipId,
      youtubeUrl,
    ]
  );

  const transcribeLocalAudioAccurate = useCallback(async () => {
    if (!localVideoId) return;
    const maxDur = durationSec > 0 ? durationSec : 600;
    const endSec = Math.min(maxDur, 600);
    setTranscriptError(null);
    setProgress((p) => ({
      ...p,
      transcript: 'loading',
      stepText: 'Mengekstrak trek audio MP4 & mentranskripsi presisi dengan AI…',
    }));
    try {
      const segs = await analyzeTranscriptChunk({
        localVideoId,
        startSec: 0,
        endSec,
        transcriptMode: 'precise_audio',
        targetLanguage: narrationLanguage,
        mode: modelMode,
        durationHint: durationSec,
      });
      const sorted = [...segs].sort((a, b) => a.mulai - b.mulai);
      setTranscript(sorted);
      setTranscriptLoadedUntil(endSec);
      setProgress((p) => ({
        ...p,
        transcript: 'done',
        stepText: 'Transkrip audio presisi selesai',
      }));
    } catch (err) {
      setTranscriptError(
        err instanceof Error ? err.message : 'Gagal mentranskripsi audio MP4 secara presisi.'
      );
      setProgress((p) => ({ ...p, transcript: 'error' }));
    }
  }, [durationSec, localVideoId, modelMode, narrationLanguage]);

  const updateTranscriptSegment = useCallback((index: number, newText: string) => {
    setTranscript((prev) =>
      prev.map((seg, idx) => (idx === index ? { ...seg, teks: newText } : seg))
    );
  }, []);

  const generateNarrationVoiceOver = useCallback(async () => {
    const fullText = transcript
      .map((s) => s.teks.trim())
      .filter(Boolean)
      .join(' ');
    if (!fullText) {
      setNarrationError('Buat atau muat skrip narasi terlebih dahulu.');
      return;
    }
    setNarrationError(null);
    setNarrationAudioLoading(true);
    try {
      const res = await generateVoiceOverAudio({
        text: fullText,
        voiceName: narrationVoice,
        speakingStyle: narrationSpeakingStyle,
      });
      setNarrationAudioPcm(res.pcmBase64);
    } catch (err) {
      setNarrationError(
        err instanceof Error ? err.message : 'Gagal menghasilkan suara narasi AI.'
      );
    } finally {
      setNarrationAudioLoading(false);
    }
  }, [narrationSpeakingStyle, narrationVoice, transcript]);

  const playVideoWithNarration = useCallback(() => {
    const endAt = Math.max(1, transcriptLoadedUntil || durationSec);
    setShowTranscriptSubtitles(true);
    playRange(0, endAt, {
      withVoiceOverPcm: narrationAudioPcm || undefined,
      originalVolume: narrationAudioPcm ? narrationOriginalVolume : 100,
    });
  }, [
    durationSec,
    narrationAudioPcm,
    narrationOriginalVolume,
    playRange,
    transcriptLoadedUntil,
  ]);

  const applyNarrationToClipAndEdit = useCallback(() => {
    if (!videoId || transcript.length === 0) return;
    const endSec = Math.max(
      1,
      Math.min(durationSec, transcript[transcript.length - 1]?.selesai || durationSec)
    );
    const autoSubs = generateClipSubtitlesFromTranscript(transcript, 0, endSec);
    const fullScript = transcript
      .map((s) => s.teks.trim())
      .filter(Boolean)
      .join(' ');

    const newClip = makeDefaultClip({
      videoId,
      judul: `Narasi AI (${formatTimestamp(0)}–${formatTimestamp(endSec)})`,
      mulai: 0,
      selesai: endSec,
      sumber: 'manual',
    });
    newClip.subtitle = autoSubs;
    newClip.naskahVO = {
      naskah: fullScript,
      nada: narrationTone,
      bahasa: narrationLanguage,
      suara: narrationVoice,
      gayaBicara: narrationSpeakingStyle,
      audioBase64Pcm: narrationAudioPcm || undefined,
      originalVolume: narrationOriginalVolume,
    };

    setClips((prev) => [...prev, newClip]);
    setSelectedClipId(newClip.id);
    setTrimStart(0);
    setTrimEnd(endSec);
    setActiveTab('klip');
    setActiveEditorSubTab('vo');
  }, [
    durationSec,
    narrationAudioPcm,
    narrationLanguage,
    narrationOriginalVolume,
    narrationSpeakingStyle,
    narrationTone,
    narrationVoice,
    transcript,
    videoId,
  ]);

  const createClip = useCallback(
    (params: {
      judul: string;
      mulai: number;
      selesai: number;
      sumber: 'manual' | 'highlight' | 'bab';
      hook?: string;
    }) => {
      if (!videoId) return null;
      const check = validateClipRange(params.mulai, params.selesai, durationSec);
      if (!check.valid) {
        setTrimError(check.error || 'Rentang klip tidak valid.');
        return null;
      }
      const newClip = makeDefaultClip({ videoId, ...params });
      setClips((prev) => [...prev, newClip]);
      setSelectedClipId(newClip.id);
      setTrimStart(params.mulai);
      setTrimEnd(params.selesai);
      setActiveTab('klip');
      setActiveEditorSubTab('subtitle');
      return newClip;
    },
    [durationSec, videoId]
  );

  const updateClip = useCallback(
    (id: string, patch: Partial<VirtualClip>) => {
      setClips((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      if (id === selectedClipId) {
        if (typeof patch.mulai === 'number') setTrimStart(patch.mulai);
        if (typeof patch.selesai === 'number') setTrimEnd(patch.selesai);
      }
    },
    [selectedClipId]
  );

  const deleteClip = useCallback(
    (id: string) => {
      setClips((prev) => {
        const next = prev.filter((c) => c.id !== id);
        if (selectedClipId === id) {
          setSelectedClipId(next[0]?.id ?? null);
        }
        return next;
      });
    },
    [selectedClipId]
  );

  const duplicateClip = useCallback((id: string) => {
    setClips((prev) => {
      const target = prev.find((c) => c.id === id);
      if (!target) return prev;
      const copy: VirtualClip = {
        ...structuredClone(target),
        id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        judul: `${target.judul} (Salinan)`,
      };
      setSelectedClipId(copy.id);
      return [...prev, copy];
    });
  }, []);

  const reorderClips = useCallback((fromIndex: number, toIndex: number) => {
    setClips((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }
      const copy = [...prev];
      const [moved] = copy.splice(fromIndex, 1);
      copy.splice(toIndex, 0, moved);
      return copy;
    });
  }, []);

  const updateStudio = useCallback((patch: Partial<StudioArtifacts>) => {
    setStudio((prev) => ({ ...prev, ...patch }));
  }, []);

  const exportProjectJson = useCallback(() => {
    const payload: VideoProjectCache = {
      videoId: videoId || '',
      sourceType,
      localVideoId: localVideoId || undefined,
      youtubeUrl,
      title: videoTitle,
      author: videoAuthor,
      durationSec,
      summary,
      summaryStyle,
      summaryLength,
      highlights,
      transcript,
      transcriptLoadedUntil,
      clips,
      chat,
      studio,
      updatedAt: Date.now(),
    };
    return JSON.stringify(payload, null, 2);
  }, [
    sourceType,
    localVideoId,
    videoId,
    youtubeUrl,
    videoTitle,
    videoAuthor,
    durationSec,
    summary,
    summaryStyle,
    summaryLength,
    highlights,
    transcript,
    transcriptLoadedUntil,
    clips,
    chat,
    studio,
  ]);

  const importProjectJson = useCallback((jsonText: string) => {
    try {
      const parsed = JSON.parse(jsonText) as Partial<VideoProjectCache>;
      if (!parsed.videoId || (!parsed.youtubeUrl && !parsed.localVideoId)) {
        return { ok: false, error: 'Berkas proyek tidak memiliki videoId atau URL/video lokal.' };
      }
      setSourceType(parsed.sourceType || (parsed.localVideoId ? 'local' : 'youtube'));
      setLocalVideoId(parsed.localVideoId || null);
      setVideoId(parsed.videoId);
      setYoutubeUrl(parsed.youtubeUrl || '');
      setUrlInput(parsed.youtubeUrl || '');
      setVideoTitle(parsed.title || '');
      setVideoAuthor(parsed.author || '');
      setDurationSec(parsed.durationSec || 600);
      setSummary(parsed.summary);
      setSummaryStyle(parsed.summaryStyle || 'Santai');
      setSummaryLength(parsed.summaryLength || 'Sedang');
      setHighlights(parsed.highlights);
      setTranscript(parsed.transcript || []);
      setTranscriptLoadedUntil(parsed.transcriptLoadedUntil || 0);
      setClips(parsed.clips || []);
      setSelectedClipId(parsed.clips?.[0]?.id ?? null);
      setChat(parsed.chat || []);
      setStudio(parsed.studio || {});
      setProgress({
        summary: parsed.summary ? 'done' : 'idle',
        highlights: parsed.highlights ? 'done' : 'idle',
        transcript: parsed.transcript?.length ? 'done' : 'idle',
        stepText: 'Proyek berhasil diimpor',
      });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Gagal membaca JSON proyek. Periksa format file.' };
    }
  }, []);

  const askAboutCurrentMoment = useCallback(() => {
    const sec = Math.floor(currentTime);
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    setActiveTab('chat');
    setPendingChatPrompt(
      `Tolong jelaskan lebih detail apa yang sedang dibahas pada momen [${mm}:${ss}] di video ini.`
    );
  }, [currentTime]);

  const consumePendingChatPrompt = useCallback(() => {
    setPendingChatPrompt(null);
  }, []);

  // Compute live subtitle overlay text:
  // 1) Selected clip subtitles when playhead is inside clip range
  // 2) Full-video transcript/narration subtitles when showTranscriptSubtitles is ON
  let activeSubtitleText = '';
  let activeSubtitleKaraokeWords: Array<{ kata: string; active: boolean }> = [];
  if (
    selectedClip &&
    selectedClip.subtitle.length > 0 &&
    currentTime >= selectedClip.mulai &&
    currentTime <= selectedClip.selesai
  ) {
    const relTime = currentTime - selectedClip.mulai;
    const activeLine = selectedClip.subtitle.find(
      (line) => relTime >= line.mulai && relTime <= line.selesai
    );
    if (activeLine) {
      activeSubtitleText = activeLine.teks;
      if (activeLine.kata && activeLine.kata.length > 0) {
        activeSubtitleKaraokeWords = activeLine.kata.map((w) => ({
          kata: w.kata,
          active: relTime >= w.mulai && relTime <= w.selesai,
        }));
      } else {
        const words = activeLine.teks.split(/\s+/).filter(Boolean);
        const span = Math.max(0.2, activeLine.selesai - activeLine.mulai);
        const progressRatio = Math.max(0, Math.min(1, (relTime - activeLine.mulai) / span));
        const activeIdx = Math.min(words.length - 1, Math.floor(progressRatio * words.length));
        activeSubtitleKaraokeWords = words.map((w, idx) => ({
          kata: w,
          active: idx <= activeIdx,
        }));
      }
    }
  } else if (showTranscriptSubtitles && transcript.length > 0) {
    const liveSub = getActiveTranscriptSubtitle(transcript, currentTime);
    if (liveSub) {
      activeSubtitleText = liveSub.text;
      activeSubtitleKaraokeWords = liveSub.words;
    }
  }

  return (
    <ClipMindContext.Provider
      value={{
        urlInput,
        setUrlInput,
        sourceType,
        localVideoId,
        localVideoObjectUrl,
        localVideoInfo,
        uploadProgress,
        videoId,
        youtubeUrl,
        videoTitle,
        videoAuthor,
        durationSec,
        setDurationSec,
        modelMode,
        setModelMode,
        currentTime,
        setCurrentTime,
        isPlaying,
        setIsPlaying,
        playerRef,
        activeTab,
        setActiveTab,
        activeEditorSubTab,
        setActiveEditorSubTab,
        trimStart,
        trimEnd,
        setTrimStart,
        setTrimEnd,
        trimError,
        rangePlayback,
        reelQueue,
        reelIndex,
        summary,
        summaryStyle,
        summaryLength,
        summaryError,
        highlights,
        highlightsError,
        transcript,
        transcriptLoadedUntil,
        transcriptError,
        showTranscriptSubtitles,
        setShowTranscriptSubtitles,
        narrationTone,
        setNarrationTone,
        narrationLanguage,
        setNarrationLanguage,
        narrationVoice,
        setNarrationVoice,
        narrationSpeakingStyle,
        setNarrationSpeakingStyle,
        narrationOriginalVolume,
        setNarrationOriginalVolume,
        narrationAudioPcm,
        narrationAudioLoading,
        narrationError,
        chat,
        setChat,
        studio,
        updateStudio,
        clips,
        selectedClipId,
        setSelectedClipId,
        selectedClip,
        progress,
        globalError,
        setGlobalError,
        activeSubtitleText,
        activeSubtitleKaraokeWords,
        analyzeVideoUrl,
        importLocalMp4File,
        regenerateSummary,
        regenerateHighlights,
        loadNextTranscriptChunk,
        generateNarrationTranscript,
        transcribeLocalAudioAccurate,
        updateTranscriptSegment,
        generateNarrationVoiceOver,
        playVideoWithNarration,
        applyNarrationToClipAndEdit,
        seekTo,
        togglePlayPause,
        nudgeTime,
        playRange,
        stopRangePlayback,
        playAllClipsReel,
        createClip,
        updateClip,
        deleteClip,
        duplicateClip,
        reorderClips,
        exportProjectJson,
        importProjectJson,
        askAboutCurrentMoment,
        pendingChatPrompt,
        consumePendingChatPrompt,
        aiSettings,
        activeProviderConfig,
        setActiveProvider,
        updateProviderConfig,
        resetAISettings,
      }}
    >
      {children}
    </ClipMindContext.Provider>
  );
}

export function useClipMind(): ClipMindContextValue {
  const ctx = useContext(ClipMindContext);
  if (!ctx) {
    throw new Error('useClipMind must be used inside ClipMindProvider');
  }
  return ctx;
}
