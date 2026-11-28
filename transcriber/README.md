# ClipMind — Transcriber Python (faster-whisper)

Service kecil untuk **transkripsi lokal** yang menggantikan transkripsi AI (Gemini).
Backend Node (`server.ts`) memanggil service ini lewat `POST /transcribe`.

## Kenapa
- Whisper (faster-whisper / CTranslate2) memberi **timestamp kata akurat** & lebih murah/offline.
- Hasil transkrip juga dipakai sebagai **konteks ringkasan & highlight** (lebih setia pada isi).

## Setup (sekali)
```powershell
# dari folder ClipMind
.\transcriber\install.ps1
```
Membuat venv Python 3.12 di `transcriber\.venv` dan install: `faster-whisper`,
`av==16.1.0`, `fastapi`, `uvicorn[standard]`, `yt-dlp`.

## Jalankan
```powershell
.\transcriber\run-transcriber.ps1
```
Service aktif di `http://127.0.0.1:8790`. Jalankan **terpisah** dari `npm run dev`.

Lalu (terminal lain):
```powershell
npm install
npm run dev      # ClipMind di http://localhost:3000
```

## Konfigurasi (env)
| Variabel | Default | Arti |
|---|---|---|
| `USE_PY_TRANSCRIBE` | `true` | `false` = kembali ke transkripsi AI |
| `TRANSCRIBER_URL` | `http://127.0.0.1:8790` | Alamat service dari Node |
| `CLIPMIND_WHISPER_MODEL` | `mobiuslabsgmbh/faster-whisper-large-v3-turbo` | Repo/nama model CT2 |
| `CLIPMIND_WHISPER_MODEL_DIR` | (diisi otomatis bila ada) | `download_root` cache HF |
| `CLIPMIND_WHISPER_LOCAL_ONLY` | — | `true` = jangan unduh, pakai cache saja |
| `CLIPMIND_WHISPER_DEVICE` | `cpu` | `cpu` / `cuda` |
| `CLIPMIND_WHISPER_COMPUTE` | `int8` | `int8` / `int8_float16` / `float16` |
| `CLIPMIND_WHISPER_BEAM` | `1` | beam_size (1 = greedy, tercepat) |
| `CLIPMIND_FFMPEG` | (otodetect) | path `ffmpeg.exe` untuk decode audio |
| `CLIPMIND_TRANSCRIBER_PORT` | `8790` | port service |

`run-transcriber.ps1` otomatis memakai model + ffmpeg yang sudah ada di PC ini bila
ditemukan (agar tidak download ulang).

## Perilaku
- **YouTube** -> `yt-dlp` unduh audio (bestaudio m4a) -> Whisper.
- **MP4 lokal** -> Node mengirim path file -> Whisper.
- Transkrip **bahasa asli** (verbatim) + timestamp akurat. Terjemahan Indonesia tetap lewat AI.
- Satu video ditranskrip penuh sekali lalu di-cache (LRU 6); permintaan chunk berikutnya instan.
- `visual_narration` (skrip narasi) tetap AI, bukan Whisper.
- Tanpa pemisahan pembicara (label `pembicara` dikosongkan).

## AI penyempurnaan ejaan (di Python)
Setelah Whisper, transkrip bisa **diperbaiki ejaan/tanda bacanya oleh LLM** — seluruhnya jalan
di Python, Node tidak memproses.
- **Langsung aktif** bila `GEMINI_API_KEY` sudah ada di `.env` (pakai endpoint
  OpenAI-compatible Google, model `gemini-2.5-flash`).
- **Ingin LLM lain?** isi di `.env`:
  ```
  CLIPMIND_LLM_BASE_URL="https://.../v1"
  CLIPMIND_LLM_API_KEY="..."        # isi sendiri, jangan lewat chat
  CLIPMIND_LLM_MODEL="auto"
  CLIPMIND_LLM_REFINE="auto"        # auto|true|false
  ```
- LLM hanya **mengoreksi ejaan**, tidak menerjemahkan/mengubah makna; jumlah & urutan
  baris dipertahankan. Bila LLM gagal, transkrip mentah Whisper dikembalikan (aman).
- Cek status: `GET /health` -> `refine_active`. Lewati refine: kirim `raw_only=true`.

## Endpoint
- `GET /health` -> status + model termuat + `refine_active` + `llm_available`.
- `POST /transcribe` `{ youtube_url | file_path | audio_base64, start_sec, end_sec, language, raw_only }`
  -> `{ segments:[{start,end,text,words:[{word,start,end}]}], language, duration, refined }`
- `POST /summary` `{ youtube_url | file_path, style, length, duration_hint }`
  -> `SummaryData` (judul, tldr, poin_penting[], bab[], topik[], durasi_total_detik) — **AI ringkasan jalan di Python**.
- `POST /highlights` `{ youtube_url | file_path, focus_query, duration_hint }`
  -> `HighlightItem[]` (judul, mulai, selesai, kategori, skor_viral, alasan, hook_saran) — **AI pencari klip jalan di Python**.

> Node (`server.ts`) hanya mem-proxy `/api/analyze/{transcript,summary,highlights}` ke Python.
> LLM yang dipakai Python = `CLIPMIND_LLM_*` atau fallback `GEMINI_API_KEY` (gemini-2.5-flash).
> Panggilan LLM punya retry ber-backoff agar tahan hiccup transien.

## Catatan portabilitas
- Windows: pastikan `ffmpeg` tersedia (bawaan repo `ffmpeg-static` untuk render; untuk
  transcriber atur `CLIPMIND_FFMPEG`).
- GPU: set `CLIPMIND_WHISPER_DEVICE=cuda` + `COMPUTE=float16` bila ada CUDA.
