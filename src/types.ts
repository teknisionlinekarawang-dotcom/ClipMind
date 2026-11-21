export type ModelMode = 'fast' | 'deep';
export type VideoSourceType = 'youtube' | 'local';

export interface LocalVideoInfo {
  localId: string;
  filename: string;
  durationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  sizeBytes: number;
  geminiReady?: boolean;
}

export type SummaryStyle = 'Santai' | 'Akademis' | 'Bahan Presentasi' | 'Untuk Anak SMA';
export type SummaryLength = 'Singkat' | 'Sedang' | 'Detail';

export interface KeyPoint {
  teks: string;
  detik: number;
}

export interface Chapter {
  judul: string;
  mulai: number;
  selesai: number;
  ringkasan: string;
}

export interface SummaryData {
  judul: string;
  tldr: string;
  poin_penting: KeyPoint[];
  bab: Chapter[];
  topik: string[];
  durasi_total_detik: number;
}

export type TranscriptMode = 'auto' | 'speech' | 'visual_narration' | 'precise_audio';

export interface TranscriptSegment {
  mulai: number;
  selesai: number;
  pembicara: string;
  teks: string;
}

export type HighlightCategory =
  | 'Kutipan kuat'
  | 'Tips praktis'
  | 'Plot twist'
  | 'Momen lucu'
  | 'Fakta mengejutkan'
  | 'Emosional';

export interface HighlightItem {
  judul: string;
  mulai: number;
  selesai: number;
  kategori: HighlightCategory;
  skor_viral: number;
  alasan: string;
  hook_saran: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestampDetik?: number;
  createdAt: number;
}

export interface WordTiming {
  kata: string;
  mulai: number;
  selesai: number;
}

export interface SubtitleLine {
  id: string;
  mulai: number; // relative to clip start in seconds
  selesai: number;
  teks: string;
  kata?: WordTiming[];
}

export type SubtitleStylePreset = 'minimalis' | 'bold' | 'karaoke' | 'kotak';
export type SubtitlePosition = 'top' | 'middle' | 'bottom';

export interface SubtitleAppearance {
  preset: SubtitleStylePreset;
  fontSize: number;
  color: string;
  position: SubtitlePosition;
}

export type VoiceOverTone = 'Informatif' | 'Santai' | 'Dramatis' | 'Humor' | 'Profesional';
export type GeminiVoiceName = 'Kore' | 'Puck' | 'Charon' | 'Zephyr' | 'Fenrir' | 'Aoede';

export interface VoiceOverData {
  naskah: string;
  nada: VoiceOverTone;
  bahasa: string;
  suara: GeminiVoiceName;
  gayaBicara: string;
  audioBase64Pcm?: string;
  originalVolume: number; // 0-100
}

export interface ThumbnailIdea {
  judul_klikbait_sehat: string;
  teks_thumbnail: string;
  deskripsi_visual: string;
  emosi: string;
}

export interface ThumbnailEditorState {
  backgroundMode: 'youtube' | 'gradient' | 'custom';
  customImageUrl?: string;
  gradientPalette: string;
  text: string;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  strokeColor: string;
  shadowBlur: number;
  textX: number; // 0..1 normalized
  textY: number; // 0..1 normalized
  darkOverlay: number; // 0..0.85
  sticker: string;
  stickerX: number;
  stickerY: number;
  aspectRatio: '16:9' | '9:16';
  ideas: ThumbnailIdea[];
}

export interface ClipMetadataData {
  hooks: string[];
  judul_shorts: string;
  judul_tiktok: string;
  judul_reels: string;
  judul_x: string;
  deskripsi: string;
  hashtag: string[];
  caption_shorts: string;
  caption_tiktok: string;
  caption_reels: string;
  caption_x: string;
}

export interface ClipRetentionIssue {
  detik_relatif: number;
  masalah: string;
  solusi: string;
}

export interface ClipRetentionAuditData {
  skor_hook: number;
  skor_retensi: number;
  skor_kejelasan: number;
  ringkasan_audit: string;
  hook_teks_saran: string;
  hook_visual_saran: string;
  titik_rawan_skip: ClipRetentionIssue[];
  rekomendasi_rasio: AspectRatioPreset;
  rekomendasi_kecepatan: number;
  cta_penutup: string;
}

export type AspectRatioPreset = '16:9' | '9:16' | '1:1' | '4:5';
export type CropFitMode = 'fill' | 'fit';
export type VideoRotationDeg = 0 | 90 | 180 | 270;
export type VideoColorPreset =
  | 'normal'
  | 'sinematik'
  | 'vibrant'
  | 'hangat'
  | 'sejuk'
  | 'bw';
export type ExportQualityPreset = '720p' | '1080p';

export interface ReframeSettings {
  rasio: AspectRatioPreset;
  fokusX: number; // 0..100 percent horizontal pan
}

export interface ClipEditingSettings {
  rotation: VideoRotationDeg;
  flipH: boolean;
  flipV: boolean;
  cropMode: CropFitMode;
  fokusY: number; // 0..100 percent vertical pan
  zoom: number; // 1.0..2.5
  marginTop: number; // 0..30 percent
  marginBottom: number; // 0..30 percent
  marginLeft: number; // 0..30 percent
  marginRight: number; // 0..30 percent
  speed: number; // 0.5..2.0
  colorPreset: VideoColorPreset;
  brightness: number; // -0.3..0.3
  contrast: number; // 0.5..1.8
  saturation: number; // 0..2.0
  fadeInSec: number; // 0..2.0
  fadeOutSec: number; // 0..2.0
  clipVolume: number; // 0..150 percent
  muteOriginal: boolean;
  exportQuality: ExportQualityPreset;
  burnSubtitles: boolean;
  includeVoiceOver: boolean;
}

export interface VirtualClip {
  id: string;
  judul: string;
  mulai: number;
  selesai: number;
  sumber: 'manual' | 'highlight' | 'bab';
  subtitle: SubtitleLine[];
  subtitleAppearance: SubtitleAppearance;
  naskahVO: VoiceOverData;
  rasio: ReframeSettings;
  editing?: ClipEditingSettings;
  thumbnail: ThumbnailEditorState;
  metadata?: ClipMetadataData;
  retentionAudit?: ClipRetentionAuditData;
}

export interface QuoteCardItem {
  kutipan: string;
  pembicara: string;
  detik: number;
}

export interface FlashcardItem {
  depan: string;
  belakang: string;
}

export interface QuizQuestionItem {
  pertanyaan: string;
  pilihan: string[];
  jawabanBenar: number;
  penjelasan: string;
}

export interface MindMapNode {
  judul: string;
  anak?: MindMapNode[];
}

export interface CornellNotesData {
  judul: string;
  isyarat: string[];
  catatan: string[];
  rangkuman: string;
}

export interface FactCheckWebSource {
  title: string;
  url: string;
}

export interface FactCheckItem {
  klaim: string;
  detik: number;
  tingkat_keyakinan: 'Tinggi' | 'Sedang' | 'Perlu Verifikasi';
  status_web?: 'Terverifikasi Web' | 'Perlu Konteks' | 'Belum Ditemukan';
  catatan: string;
}

export interface VideoComparisonRow {
  aspek: string;
  video1: string;
  video2: string;
}

export interface VideoComparisonData {
  ringkasan_perbandingan: string;
  pemenang_kepadatan: string;
  tabel: VideoComparisonRow[];
}

export interface PodcastDialogueLine {
  pembicara: 'Host' | 'Ko-Host';
  nama: string;
  gaya: string;
  teks: string;
}

export interface PodcastData {
  judul: string;
  ringkasan: string;
  gaya_diskusi: string;
  hostNama: string;
  hostSuara: GeminiVoiceName;
  coHostNama: string;
  coHostSuara: GeminiVoiceName;
  dialog: PodcastDialogueLine[];
  audioBase64Pcm?: string;
}

export interface CarouselSlideItem {
  slide_ke: number;
  headline: string;
  poin: string[];
  catatan_visual: string;
}

export interface CarouselDeckData {
  judul_deck: string;
  platform: string;
  slides: CarouselSlideItem[];
  caption_cta: string;
}

export interface SopStepItem {
  nomor: number;
  judul: string;
  detail: string;
  detik: number;
}

export interface SopGuideData {
  judul: string;
  tujuan: string;
  prasyarat: string[];
  langkah: SopStepItem[];
  hasil_akhir: string;
}

export interface StudioArtifacts {
  article?: { nada: string; markdown: string };
  thread?: string[];
  quotes?: QuoteCardItem[];
  study?: { flashcards: FlashcardItem[]; kuis: QuizQuestionItem[] };
  mindmap?: MindMapNode;
  cornell?: CornellNotesData;
  factcheck?: FactCheckItem[];
  factcheckSources?: FactCheckWebSource[];
  compare?: { secondUrl: string; data: VideoComparisonData };
  podcast?: PodcastData;
  carousel?: CarouselDeckData;
  sop?: SopGuideData;
}

export interface VideoProjectCache {
  videoId: string;
  sourceType?: VideoSourceType;
  localVideoId?: string;
  youtubeUrl: string;
  title?: string;
  author?: string;
  durationSec: number;
  summary?: SummaryData;
  summaryStyle: SummaryStyle;
  summaryLength: SummaryLength;
  highlights?: HighlightItem[];
  transcript: TranscriptSegment[];
  transcriptLoadedUntil: number;
  showTranscriptSubtitles?: boolean;
  clips: VirtualClip[];
  chat: ChatMessage[];
  studio: StudioArtifacts;
  updatedAt: number;
}

export type MainTabKey =
  | 'ringkasan'
  | 'chat'
  | 'highlight'
  | 'klip'
  | 'transkrip'
  | 'studio';

export type ClipEditorSubTab = 'subtitle' | 'vo' | 'thumbnail' | 'metadata' | 'reframe';

export type AIProviderId =
  | 'gemini'
  | 'openai'
  | 'nvidia'
  | 'openrouter'
  | 'groq'
  | 'custom';

export interface AIProviderEntry {
  id: AIProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
  customName?: string;
}

export interface AISettingsState {
  activeProvider: AIProviderId;
  providers: Record<AIProviderId, AIProviderEntry>;
}

