import {
  GoogleGenAI,
  MediaResolution,
  ThinkingLevel,
  Type,
  type GenerateContentParameters,
} from '@google/genai';
import type {
  ModelMode,
  SummaryLength,
  SummaryStyle,
  TranscriptMode,
  VoiceOverTone,
} from '../types.ts';

export function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    const err = new Error('GEMINI_API_KEY belum dikonfigurasi pada environment server.');
    (err as Error & { statusCode?: number }).statusCode = 500;
    throw err;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function resolveModelAndThinking(mode: ModelMode): {
  model: string;
  thinkingLevel: ThinkingLevel;
} {
  // gemini-4-hydrogen supports ThinkingLevel.LOW (fast) and ThinkingLevel.HIGH (deep analysis)
  return {
    model: 'gemini-4-hydrogen',
    thinkingLevel: mode === 'deep' ? ThinkingLevel.HIGH : ThinkingLevel.LOW,
  };
}

export function buildVideoFilePart(youtubeUrl: string) {
  return {
    fileData: {
      fileUri: youtubeUrl,
    },
  };
}

export function shouldUseLowMediaResolution(durationSec?: number): boolean {
  return typeof durationSec === 'number' && durationSec > 3600;
}

export function mapGeminiError(
  error: unknown,
  context?: { sourceType?: 'youtube' | 'local' | 'tts' }
): { status: number; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  const sourceType = context?.sourceType;

  if (lower.includes('gemini_api_key') || lower.includes('api_key_invalid') || lower.includes('401')) {
    return {
      status: 400,
      message: 'API key Gemini tidak valid atau belum diatur di Pengaturan Provider AI / Settings > Secrets.',
    };
  }
  if (lower.includes('permission_denied') || lower.includes('403')) {
    return {
      status: 403,
      message: 'Akses ditolak oleh Gemini API. Periksa izin API key Anda di Pengaturan Provider AI / Settings > Secrets.',
    };
  }
  if (lower.includes('resource_exhausted') || lower.includes('429') || lower.includes('quota')) {
    return {
      status: 429,
      message: 'Kuota permintaan AI sedang penuh (429). Tunggu beberapa detik lalu coba lagi.',
    };
  }

  if (sourceType === 'tts') {
    if (
      lower.includes('503') ||
      lower.includes('unavailable') ||
      lower.includes('overloaded') ||
      lower.includes('high demand')
    ) {
      return {
        status: 503,
        message: 'Layanan suara AI (TTS) sedang sibuk (503). Tunggu beberapa detik lalu coba lagi.',
      };
    }
    if (lower.includes('not_found') || lower.includes('not found') || lower.includes('404')) {
      return {
        status: 502,
        message: `Model atau suara TTS tidak tersedia: ${raw}`,
      };
    }
    return {
      status: 500,
      message: raw || 'Gagal menghasilkan audio voice over.',
    };
  }

  if (sourceType === 'local') {
    if (
      lower.includes('mp4 lokal tidak ditemukan') ||
      lower.includes('sesi telah berakhir') ||
      lower.includes('enoent')
    ) {
      return {
        status: 404,
        message:
          'File video MP4 lokal tidak ditemukan di server (sesi berakhir). Silakan unggah ulang video MP4 Anda.',
      };
    }
    if (
      lower.includes('503') ||
      lower.includes('unavailable') ||
      lower.includes('overloaded') ||
      lower.includes('high demand')
    ) {
      return {
        status: 503,
        message: 'Layanan AI sedang sibuk saat memproses video lokal (503). Coba beberapa detik lagi.',
      };
    }
    return {
      status: 500,
      message: raw || 'Terjadi kesalahan saat memproses video MP4 lokal.',
    };
  }

  if (
    lower.includes('503') ||
    lower.includes('overloaded') ||
    lower.includes('high demand') ||
    (sourceType !== 'youtube' && lower.includes('unavailable'))
  ) {
    return {
      status: 503,
      message: 'Model AI sedang mengalami lonjakan permintaan (503). Tunggu beberapa detik lalu coba lagi.',
    };
  }

  if (
    lower.includes('private') ||
    /\bage[-_ ]?restrict/i.test(lower) ||
    lower.includes('video unavailable') ||
    lower.includes('cannot access') ||
    (sourceType === 'youtube' &&
      (lower.includes('unavailable') || lower.includes('not found') || lower.includes('not_found')))
  ) {
    return {
      status: 422,
      message:
        'Video YouTube tidak dapat diakses (mungkin privat, dihapus, dibatasi umur, atau terlalu panjang). Pastikan video bersifat publik.',
    };
  }
  if (lower.includes('context') || lower.includes('too long') || lower.includes('token')) {
    return {
      status: 413,
      message:
        'Video melebihi batas panjang pemrosesan langsung. Coba analisis segmen transkrip secara bertahap.',
    };
  }
  if (lower.includes('json')) {
    return {
      status: 502,
      message: 'Respons AI tidak berbentuk JSON valid. Silakan klik "Coba lagi".',
    };
  }
  return {
    status: 500,
    message: raw || 'Terjadi kesalahan saat menghubungi AI API.',
  };
}

export async function callGeminiWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;
  while (attempt <= maxRetries) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      const isRetryable =
        msg.includes('429') ||
        msg.includes('resource_exhausted') ||
        msg.includes('503') ||
        msg.includes('unavailable') ||
        msg.includes('timeout');
      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }
      const delayMs = 800 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt += 1;
    }
  }
  throw lastError;
}

export const SUMMARY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    judul: { type: Type.STRING },
    tldr: { type: Type.STRING, description: 'Maksimal 3 kalimat ringkasan inti video.' },
    poin_penting: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          teks: { type: Type.STRING },
          detik: { type: Type.INTEGER },
        },
        required: ['teks', 'detik'],
      },
    },
    bab: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          judul: { type: Type.STRING },
          mulai: { type: Type.INTEGER },
          selesai: { type: Type.INTEGER },
          ringkasan: { type: Type.STRING },
        },
        required: ['judul', 'mulai', 'selesai', 'ringkasan'],
      },
    },
    topik: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    durasi_total_detik: { type: Type.INTEGER },
  },
  required: ['judul', 'tldr', 'poin_penting', 'bab', 'topik', 'durasi_total_detik'],
};

export function buildSummaryPrompt(
  style: SummaryStyle,
  length: SummaryLength
): string {
  const styleGuide: Record<SummaryStyle, string> = {
    Santai: 'Gunakan bahasa Indonesia santai, komunikatif, dan mudah dipahami seperti kreator membahas ke teman.',
    Akademis: 'Gunakan bahasa Indonesia formal, objektif, terstruktur, dan tepat secara konseptual.',
    'Bahan Presentasi': 'Susun poin ringkas siap salin untuk slide presentasi, padat dan berorientasi insight.',
    'Untuk Anak SMA': 'Gunakan bahasa Indonesia sederhana, analogi sehari-hari, dan jelaskan istilah sulit dengan ringan.',
  };

  const lengthGuide: Record<SummaryLength, string> = {
    Singkat: '4–5 poin penting dan 3–5 bab utama yang sangat ringkas.',
    Sedang: '6–8 poin penting dan 5–8 bab yang seimbang.',
    Detail: '8–12 poin penting dan 8–14 bab mendalam mencakup sub-topik penting.',
  };

  return `Analisis video YouTube ini secara menyeluruh dan hasilkan ringkasan terstruktur dalam Bahasa Indonesia.
Gaya penulisan: ${styleGuide[style]}
Kedalaman: ${lengthGuide[length]}
Aturan wajib:
- Seluruh timestamp (detik, mulai, selesai, durasi_total_detik) harus berupa angka integer dalam SATUAN DETIK.
- TL;DR maksimal 3 kalimat.
- Pastikan bab tersusun kronologis dari awal hingga akhir video.`;
}

export const HIGHLIGHTS_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      judul: { type: Type.STRING },
      mulai: { type: Type.INTEGER },
      selesai: { type: Type.INTEGER },
      kategori: {
        type: Type.STRING,
        description:
          'Harus salah satu dari: Kutipan kuat, Tips praktis, Plot twist, Momen lucu, Fakta mengejutkan, Emosional',
      },
      skor_viral: { type: Type.INTEGER },
      alasan: { type: Type.STRING },
      hook_saran: { type: Type.STRING },
    },
    required: ['judul', 'mulai', 'selesai', 'kategori', 'skor_viral', 'alasan', 'hook_saran'],
  },
};

export function buildHighlightsPrompt(focusQuery?: string): string {
  const focusClause = focusQuery?.trim()
    ? `Fokus pencarian highlight khusus dari pengguna: "${focusQuery.trim()}". Prioritaskan momen yang paling cocok dengan fokus tersebut.`
    : 'Cari momen terbaik yang paling menarik, informatif, atau berpotensi viral untuk dijadikan klip pendek.';

  return `Identifikasi 5 sampai 8 momen highlight terbaik dari video ini dalam Bahasa Indonesia.
${focusClause}
Aturan wajib:
- Urutkan dari skor_viral tertinggi (0–100) ke terendah.
- Durasi klip ideal 15–90 detik (boleh lebih panjang jika topiknya utuh).
- Nilai "mulai" dan "selesai" harus berupa angka integer dalam detik.
- "kategori" WAJIB dipilih persis dari daftar ini: "Kutipan kuat", "Tips praktis", "Plot twist", "Momen lucu", "Fakta mengejutkan", "Emosional".
- Sertakan "hook_saran" yaitu kalimat pembuka 3 detik pertama yang memancing rasa ingin tahu.`;
}

export const TRANSCRIPT_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      mulai: { type: Type.INTEGER },
      selesai: { type: Type.INTEGER },
      pembicara: { type: Type.STRING },
      teks: { type: Type.STRING },
    },
    required: ['mulai', 'selesai', 'pembicara', 'teks'],
  },
};

export function buildVisualNarrationTranscriptPrompt(
  startSec: number,
  endSec: number,
  tone: VoiceOverTone = 'Informatif',
  targetLanguage = 'Indonesia'
): string {
  const span = Math.max(4, endSec - startSec);
  return `Tonton adegan visual, aksi, teks di layar, transisi, dan suasana pada video ini untuk rentang waktu detik ${startSec} hingga ${endSec} (durasi ${span} detik).
Video ini TIDAK memiliki narasi lisan (atau pengguna ingin memberikan narasi suara baru). Buatlah skrip narasi voice over bersegmen yang mengalir alami dan siap langsung dibacakan oleh AI serta ditampilkan sebagai subtitle!

Aturan wajib:
- Bahasa output: ${targetLanguage}.
- Nada / gaya narasi: ${tone}.
- Isi setiap segmen berupa kalimat narasi orang ketiga/kreator yang natural dan enak didengar (JANGAN menulis tag teknis seperti "[adegan menunjukkan...]" atau catatan panggung).
- Bagi ke dalam segmen kronologis berdurasi sekitar 4–10 detik per segmen, dengan kecepatan baca alami (~2 hingga 2,5 kata per detik) agar durasi audio voice over pas dengan adegan.
- Nilai "mulai" dan "selesai" harus berupa angka integer dalam detik di antara ${startSec} hingga ${endSec}, berurutan tanpa tumpang tindih.
- Gunakan "Narator AI" sebagai nilai "pembicara".`;
}

export function buildTranscriptPrompt(
  startSec: number,
  endSec: number,
  transcriptMode: TranscriptMode = 'auto',
  narrationTone: VoiceOverTone = 'Informatif',
  targetLanguage = 'Indonesia'
): string {
  if (transcriptMode === 'visual_narration') {
    return buildVisualNarrationTranscriptPrompt(
      startSec,
      endSec,
      narrationTone,
      targetLanguage
    );
  }

  if (transcriptMode === 'speech') {
    return `Buat transkrip lisan bersegmen yang akurat dari ucapan pada video ini khusus untuk rentang waktu mulai detik ${startSec} sampai detik ${endSec}.
Aturan wajib:
- Kembalikan segmen-segmen berdurasi 5–20 detik agar mudah diikuti.
- "mulai" dan "selesai" harus berupa angka integer dalam detik (antara ${startSec} hingga ${endSec}).
- Identifikasi nama atau label pembicara (mis. "Pembicara 1", "Host", atau nama jika disebut di video).
- Pertahankan bahasa asli pembicaraan atau tulis rapi sesuai ucapan di video.`;
  }

  return `Buat transkrip bersegmen yang akurat dari video ini khusus untuk rentang waktu mulai detik ${startSec} sampai detik ${endSec}.
Aturan wajib:
- Jika ada ucapan/dialog di video, transkripsikan ucapan tersebut dalam segmen berdurasi 5–20 detik lengkap dengan label pembicara.
- PENTING: Jika video atau rentang waktu ini TIDAK memiliki ucapan/narasi lisan (misalnya hanya visual, B-roll, animasi, musik, atau tutorial tanpa suara), buatlah narasi deskriptif yang natural dalam Bahasa ${targetLanguage} dengan label pembicara "Narator AI" agar video tetap memiliki skrip narasi dan subtitle yang siap dibacakan!
- "mulai" dan "selesai" harus berupa angka integer dalam detik (antara ${startSec} hingga ${endSec}).`;
}

export const SUBTITLE_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      mulai: { type: Type.NUMBER },
      selesai: { type: Type.NUMBER },
      teks: { type: Type.STRING },
      kata: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            kata: { type: Type.STRING },
            mulai: { type: Type.NUMBER },
            selesai: { type: Type.NUMBER },
          },
          required: ['kata', 'mulai', 'selesai'],
        },
      },
    },
    required: ['mulai', 'selesai', 'teks'],
  },
};

export function buildClipSubtitlePrompt(
  clipStart: number,
  clipEnd: number,
  targetLang = 'Indonesia',
  includeWordTimings = true
): string {
  const duration = Math.max(1, clipEnd - clipStart);
  return `Buat subtitle yang presisi untuk klip video pada rentang waktu absolut detik ${clipStart} sampai ${clipEnd} (total durasi ${duration} detik).
Aturan wajib:
- Timestamp "mulai" dan "selesai" pada hasil HARUS RELATIF terhadap awal klip (mulai dari 0 sampai ${duration} detik).
- Pecah teks menjadi baris pendek agar nyaman dibaca (maksimal 42 karakter per baris, maksimal 2 baris per entri, pisahkan baris dengan "\\n").
- Bahasa target subtitle: ${targetLang}.
${
  includeWordTimings
    ? '- Sertakan array "kata" berisi perkiraan waktu mulai dan selesai per kata (relatif terhadap awal klip) untuk mode karaoke.'
    : ''
}`;
}

export function buildTranslateSubtitlesPrompt(
  linesJson: string,
  targetLanguage: string
): string {
  return `Terjemahkan daftar subtitle berikut ke bahasa ${targetLanguage}.
Aturan wajib:
- JANGAN ubah timestamp "mulai" dan "selesai". Pertahankan jumlah segmen dan waktu persis sama.
- Jika ada array "kata", sesuaikan kata terjemahan agar berada di rentang mulai..selesai segmen tersebut.
- Jaga panjang per baris tetap ringkas (maksimal 42 karakter per baris, maksimal 2 baris).

Data subtitle asli:
${linesJson}`;
}

export function buildVoiceOverScriptPrompt(
  clipStart: number,
  clipEnd: number,
  tone: VoiceOverTone,
  targetLanguage: string,
  subtitleContext?: string
): string {
  const duration = Math.max(5, clipEnd - clipStart);
  const targetWords = Math.max(12, Math.round(duration * 2.5));
  return `Tulis naskah voice over (narasi) untuk klip video pada detik ${clipStart} hingga ${clipEnd} (durasi ${duration} detik).
Parameter:
- Bahasa target: ${targetLanguage}
- Nada penyampaian: ${tone}
- Panjang target: sekitar ${targetWords} kata (±15%) agar pas dibacakan dalam ${duration} detik (kecepatan ~2,5 kata/detik).
- Jika klip ini tidak memiliki dialog/suara narasi, amati langsung adegan visual di video pada rentang waktu tersebut dan tulis narasi yang menjelaskan/mengiringi visual secara menarik.
- Tulis langsung teks narasi yang siap dibacakan oleh pengisi suara tanpa catatan panggung atau label kurung siku.
${subtitleContext ? `\nKonteks ucapan asli/subtitle klip:\n${subtitleContext}` : ''}`;
}

export const THUMBNAIL_IDEAS_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      judul_klikbait_sehat: { type: Type.STRING },
      teks_thumbnail: { type: Type.STRING, description: 'Maksimal 4 kata punchy untuk gambar thumbnail.' },
      deskripsi_visual: { type: Type.STRING },
      emosi: { type: Type.STRING },
    },
    required: ['judul_klikbait_sehat', 'teks_thumbnail', 'deskripsi_visual', 'emosi'],
  },
};

export const CLIP_METADATA_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    hooks: { type: Type.ARRAY, items: { type: Type.STRING } },
    judul_shorts: { type: Type.STRING },
    judul_tiktok: { type: Type.STRING },
    judul_reels: { type: Type.STRING },
    judul_x: { type: Type.STRING },
    deskripsi: { type: Type.STRING },
    hashtag: { type: Type.ARRAY, items: { type: Type.STRING } },
    caption_shorts: { type: Type.STRING },
    caption_tiktok: { type: Type.STRING },
    caption_reels: { type: Type.STRING },
    caption_x: { type: Type.STRING },
  },
  required: [
    'hooks',
    'judul_shorts',
    'judul_tiktok',
    'judul_reels',
    'judul_x',
    'deskripsi',
    'hashtag',
    'caption_shorts',
    'caption_tiktok',
    'caption_reels',
    'caption_x',
  ],
};

export const QUOTES_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      kutipan: { type: Type.STRING },
      pembicara: { type: Type.STRING },
      detik: { type: Type.INTEGER },
    },
    required: ['kutipan', 'pembicara', 'detik'],
  },
};

export const STUDY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    flashcards: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          depan: { type: Type.STRING },
          belakang: { type: Type.STRING },
        },
        required: ['depan', 'belakang'],
      },
    },
    kuis: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          pertanyaan: { type: Type.STRING },
          pilihan: { type: Type.ARRAY, items: { type: Type.STRING } },
          jawabanBenar: { type: Type.INTEGER },
          penjelasan: { type: Type.STRING },
        },
        required: ['pertanyaan', 'pilihan', 'jawabanBenar', 'penjelasan'],
      },
    },
  },
  required: ['flashcards', 'kuis'],
};

export const MINDMAP_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    judul: { type: Type.STRING },
    anak: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          judul: { type: Type.STRING },
          anak: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                judul: { type: Type.STRING },
              },
              required: ['judul'],
            },
          },
        },
        required: ['judul'],
      },
    },
  },
  required: ['judul', 'anak'],
};

export const CORNELL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    judul: { type: Type.STRING },
    isyarat: { type: Type.ARRAY, items: { type: Type.STRING } },
    catatan: { type: Type.ARRAY, items: { type: Type.STRING } },
    rangkuman: { type: Type.STRING },
  },
  required: ['judul', 'isyarat', 'catatan', 'rangkuman'],
};

export const FACTCHECK_SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      klaim: { type: Type.STRING },
      detik: { type: Type.INTEGER },
      tingkat_keyakinan: {
        type: Type.STRING,
        description: 'Salah satu dari: Tinggi, Sedang, Perlu Verifikasi',
      },
      status_web: {
        type: Type.STRING,
        description: 'Salah satu dari: Terverifikasi Web, Perlu Konteks, Belum Ditemukan',
      },
      catatan: { type: Type.STRING },
    },
    required: ['klaim', 'detik', 'tingkat_keyakinan', 'catatan'],
  },
};

export function buildFactCheckWithSearchPrompt(): string {
  return `Identifikasi 5–7 klaim faktual, statistik, tanggal, atau pernyataan penting dari video ini, lalu verifikasi kebenarannya menggunakan pencarian web (Google Search).
Kembalikan HANYA array JSON valid (tanpa markdown fence) dengan struktur objek per elemen:
{
  "klaim": "bunyi klaim spesifik dalam Bahasa Indonesia",
  "detik": 0,
  "tingkat_keyakinan": "Tinggi" | "Sedang" | "Perlu Verifikasi",
  "status_web": "Terverifikasi Web" | "Perlu Konteks" | "Belum Ditemukan",
  "catatan": "penjelasan singkat hasil verifikasi web dalam Bahasa Indonesia"
}`;
}

export const COMPARE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    ringkasan_perbandingan: { type: Type.STRING },
    pemenang_kepadatan: { type: Type.STRING },
    tabel: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          aspek: { type: Type.STRING },
          video1: { type: Type.STRING },
          video2: { type: Type.STRING },
        },
        required: ['aspek', 'video1', 'video2'],
      },
    },
  },
  required: ['ringkasan_perbandingan', 'pemenang_kepadatan', 'tabel'],
};

export const PODCAST_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    judul: { type: Type.STRING },
    ringkasan: { type: Type.STRING },
    dialog: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          pembicara: { type: Type.STRING, description: 'Harus "Host" atau "Ko-Host"' },
          nama: { type: Type.STRING },
          gaya: { type: Type.STRING },
          teks: { type: Type.STRING },
        },
        required: ['pembicara', 'nama', 'gaya', 'teks'],
      },
    },
  },
  required: ['judul', 'ringkasan', 'dialog'],
};

export function buildPodcastPrompt(params: {
  style: string;
  hostName: string;
  coHostName: string;
}): string {
  return `Ubah pembahasan inti video ini menjadi naskah diskusi Podcast 2 pembicara yang hidup, mengalir, dan terasa seperti percakapan studio nyata dalam Bahasa Indonesia.
Pengaturan acara:
- Gaya diskusi: ${params.style}
- Pembicara 1 (pembicara: "Host", nama: "${params.hostName}"): memandu alur, antusias, mengajukan pertanyaan tajam.
- Pembicara 2 (pembicara: "Ko-Host", nama: "${params.coHostName}"): analis/praktisi yang memberi insight mendalam, contoh nyata, dan reaksi spontan.
Aturan wajib:
- Tulis 8 sampai 12 giliran dialog bergantian antara "Host" dan "Ko-Host".
- Total durasi baca sekitar 60–90 detik (~180–260 kata total) agar pas disintesis sebagai audio podcast ringkas.
- Gunakan bahasa lisan yang natural (boleh sisipkan jeda alami seperti <breath> atau reaksi ringan <laugh> seperlunya saja agar realistis saat dibacakan AI suara).
- Isi field "gaya" singkat dalam bahasa Inggris untuk arahan suara (mis. "Enthusiastic warm podcast host" atau "Thoughtful analytical co-host").`;
}

export const CAROUSEL_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    judul_deck: { type: Type.STRING },
    platform: { type: Type.STRING },
    slides: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          slide_ke: { type: Type.INTEGER },
          headline: { type: Type.STRING },
          poin: { type: Type.ARRAY, items: { type: Type.STRING } },
          catatan_visual: { type: Type.STRING },
        },
        required: ['slide_ke', 'headline', 'poin', 'catatan_visual'],
      },
    },
    caption_cta: { type: Type.STRING },
  },
  required: ['judul_deck', 'platform', 'slides', 'caption_cta'],
};

export function buildCarouselPrompt(platform = 'Instagram & LinkedIn'): string {
  return `Ubah materi video ini menjadi materi Slide Carousel siap desain untuk ${platform} dalam Bahasa Indonesia.
Aturan wajib:
- Buat 6 sampai 8 slide berurutan (Slide 1 = Cover hook kuat, Slide 2..N-1 = inti materi 2–4 poin singkat per slide, Slide terakhir = Kesimpulan & CTA).
- "headline" singkat, tajam (maksimal 8 kata).
- "poin" berisi 1–3 kalimat/bullet padat yang mudah dibaca di layar ponsel.
- "catatan_visual" memberi arahan layout/ikon/ilustrasi untuk desainer.`;
}

export const SOP_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    judul: { type: Type.STRING },
    tujuan: { type: Type.STRING },
    prasyarat: { type: Type.ARRAY, items: { type: Type.STRING } },
    langkah: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          nomor: { type: Type.INTEGER },
          judul: { type: Type.STRING },
          detail: { type: Type.STRING },
          detik: { type: Type.INTEGER },
        },
        required: ['nomor', 'judul', 'detail', 'detik'],
      },
    },
    hasil_akhir: { type: Type.STRING },
  },
  required: ['judul', 'tujuan', 'prasyarat', 'langkah', 'hasil_akhir'],
};

export function buildSopPrompt(): string {
  return `Ekstrak isi video ini menjadi Panduan Praktis / SOP Langkah-demi-Langkah yang terstruktur dan siap dieksekusi dalam Bahasa Indonesia.
Aturan wajib:
- Sertakan judul, tujuan utama, daftar prasyarat/alat/persiapan, 5–10 langkah berurutan lengkap dengan detik kemunculan (integer) di video, dan hasil akhir yang diharapkan.
- Jika video bersifat konseptual/diskusi, ubah menjadi kerangka kerja actionable yang bisa langsung dipraktikkan penonton.`;
}

export const RETENTION_AUDIT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    skor_hook: { type: Type.INTEGER },
    skor_retensi: { type: Type.INTEGER },
    skor_kejelasan: { type: Type.INTEGER },
    ringkasan_audit: { type: Type.STRING },
    hook_teks_saran: { type: Type.STRING },
    hook_visual_saran: { type: Type.STRING },
    titik_rawan_skip: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          detik_relatif: { type: Type.INTEGER },
          masalah: { type: Type.STRING },
          solusi: { type: Type.STRING },
        },
        required: ['detik_relatif', 'masalah', 'solusi'],
      },
    },
    rekomendasi_rasio: {
      type: Type.STRING,
      description: 'Harus salah satu dari: 9:16, 1:1, 4:5, 16:9',
    },
    rekomendasi_kecepatan: { type: Type.NUMBER },
    cta_penutup: { type: Type.STRING },
  },
  required: [
    'skor_hook',
    'skor_retensi',
    'skor_kejelasan',
    'ringkasan_audit',
    'hook_teks_saran',
    'hook_visual_saran',
    'titik_rawan_skip',
    'rekomendasi_rasio',
    'rekomendasi_kecepatan',
    'cta_penutup',
  ],
};

export function buildRetentionAuditPrompt(params: {
  clipTitle: string;
  clipStart: number;
  clipEnd: number;
  currentRatio: string;
  subtitleContext?: string;
}): string {
  const dur = Math.max(1, params.clipEnd - params.clipStart);
  return `Anda adalah editor video pendek & pakar retensi audiens (Shorts/Reels/TikTok).
Audit klip "${params.clipTitle}" pada detik ${params.clipStart} sampai ${params.clipEnd} (durasi ${dur} detik, rasio saat ini: ${params.currentRatio}).
${params.subtitleContext ? `Teks subtitle/VO saat ini:\n${params.subtitleContext}\n` : ''}
Evaluasi secara objektif dan berikan rekomendasi perbaikan nyata dalam Bahasa Indonesia:
- skor_hook (0-100): seberapa kuat 3 detik pembuka menghentikan scroll.
- skor_retensi (0-100): alur tempo, variasi visual, dan daya tahan hingga akhir.
- skor_kejelasan (0-100): kejelasan pesan utama klip berdiri sendiri.
- hook_teks_saran: maksimal 5 kata teks layar pembuka yang jauh lebih kuat.
- hook_visual_saran: arahan visual 3 detik pertama (mis. zoom, potong jeda awal, teks besar).
- titik_rawan_skip: 2-4 titik detik RELATIF terhadap awal klip (0..${dur}) yang berpotensi membosankan beserta solusinya.
- rekomendasi_rasio: salah satu dari "9:16", "4:5", "1:1", atau "16:9".
- rekomendasi_kecepatan: angka di rentang 1.0 sampai 1.25 (mis. 1.0 atau 1.15 jika tempo lambat).
- cta_penutup: kalimat ajakan interaksi singkat di 3 detik terakhir.`;
}

export function buildPreciseAudioTranscribePrompt(
  startSec: number,
  endSec: number,
  targetLanguage = 'Indonesia'
): string {
  const dur = Math.max(1, endSec - startSec);
  return `Transkripsikan rekaman audio ini secara verbatim dan akurat (potongan berdurasi ${dur} detik, dimulai dari detik absolut ${startSec}).
Aturan wajib:
- Kembalikan HANYA array JSON valid (tanpa markdown fence) berisi segmen-segmen berurutan:
  [{"mulai": number_integer_detik_absolut, "selesai": number_integer_detik_absolut, "pembicara": "Pembicara 1", "teks": "transkrip akurat"}]
- Timestamp "mulai" dan "selesai" harus sudah digeser ke waktu absolut (${startSec} hingga ${endSec}).
- Pertahankan istilah teknis dan nama diri dengan tepat. Gunakan bahasa utama ucapan (atau rapikan ke Bahasa ${targetLanguage} bila diminta terjemahan).`;
}

export function buildGenerateConfig(
  mode: ModelMode,
  durationSec?: number,
  extra?: GenerateContentParameters['config']
): GenerateContentParameters['config'] {
  const { thinkingLevel } = resolveModelAndThinking(mode);
  return {
    ...extra,
    thinkingConfig: { thinkingLevel },
    ...(shouldUseLowMediaResolution(durationSec)
      ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW }
      : {}),
  };
}
