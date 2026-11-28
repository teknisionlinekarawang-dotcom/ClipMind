"""
ClipMind — Python Transcription Sidecar
=======================================
Menggantikan transkripsi berbasis AI (Gemini) dengan faster-whisper lokal.

Menjalankan server FastAPI kecil yang dipanggil backend Node (server.ts)
melalui POST /transcribe. Model dimuat sekali (warm) agar transkripsi
berulang/chunk cepat.

Environment (semua opsional, ada default aman):
  CLIPMIND_TRANSCRIBER_PORT   port HTTP                 (default 8790)
  CLIPMIND_WHISPER_MODEL      nama/repo model CT2        (default mobiuslabsgmbh/faster-whisper-large-v3-turbo)
  CLIPMIND_WHISPER_MODEL_DIR  download_root / cache HF   (direkomendasikan: folder model yang sudah ada)
  CLIPMIND_WHISPER_LOCAL_ONLY 1/true = jangan unduh, pakai cache lokal saja
  CLIPMIND_WHISPER_DEVICE     cpu / cuda                (default cpu)
  CLIPMIND_WHISPER_COMPUTE    int8 / int8_float16 / float16 (default int8)
  CLIPMIND_WHISPER_BEAM       beam_size                 (default 1 = greedy, tercepat)
  CLIPMIND_FFMPEG             path ffmpeg.exe (untuk decode audio)

  # AI penyempurnaan ejaan (opsional). Bila CLIPMIND_LLM_* kosong, otomatis memakai
  # GEMINI_API_KEY via endpoint OpenAI-compatible Google (model gemini-2.5-flash).
  CLIPMIND_LLM_BASE_URL       OpenAI-compatible base url
  CLIPMIND_LLM_API_KEY        kunci LLM (isi sendiri; jangan lewat chat)
  CLIPMIND_LLM_MODEL          model (default auto)
  CLIPMIND_LLM_REFINE         auto|true|false           (default auto)
"""

from __future__ import annotations

import os
import re
import sys
import json
import time
import base64
import hashlib
import threading
import tempfile
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional

# Batasi thread BLAS agar tidak "over-subscribe" saat dipakai bersamaan dengan Node.
os.environ.setdefault("OMP_NUM_THREADS", str(os.cpu_count() or 4))
os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")

# Muat konfigurasi dari repo .env (node & python berbagi satu sumber). Nilai yang sudah
# di-export di shell tetap menang (override=False).
_HERE = os.path.dirname(os.path.abspath(__file__))
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_HERE, "..", ".env"), override=False)
except Exception:
    pass

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


def _resolve_model(name: str, download_root: Optional[str]):
    """Kembalikan (model_arg, download_root, local_only).

    Jika `name` adalah folder lokal berisi model.bin (cache CT2 flat), pakai langsung
    (offline). Jika tidak, anggap repo id HF dan gunakan download_root bila ada.
    """
    if name and os.path.isdir(name) and os.path.exists(os.path.join(name, "model.bin")):
        return name, None, False
    return name, download_root, (download_root is not None and os.environ.get(
        "CLIPMIND_WHISPER_LOCAL_ONLY", ""
    ).strip().lower() in ("1", "true", "yes"))


MODEL_NAME = os.environ.get(
    "CLIPMIND_WHISPER_MODEL", "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
).strip()
MODEL_DIR = (os.environ.get("CLIPMIND_WHISPER_MODEL_DIR", "").strip() or None)
LOCAL_ONLY = os.environ.get("CLIPMIND_WHISPER_LOCAL_ONLY", "").strip().lower() in ("1", "true", "yes")
DEVICE = os.environ.get("CLIPMIND_WHISPER_DEVICE", "cpu").strip() or "cpu"
COMPUTE = os.environ.get("CLIPMIND_WHISPER_COMPUTE", "int8").strip() or "int8"
BEAM_SIZE = int(os.environ.get("CLIPMIND_WHISPER_BEAM", "1") or "1")
FFMPEG_BIN = os.environ.get("CLIPMIND_FFMPEG", "ffmpeg").strip() or "ffmpeg"
PORT = int(os.environ.get("CLIPMIND_TRANSCRIBER_PORT", "8790") or "8790")

# --- AI penyempurnaan ejaan (opsional; aktif bila BASE_URL + API KEY diisi) ---
# LLM OpenAI-compatible dipanggil DARI Python agar Node tidak memproses apa pun.
LLM_BASE_URL = os.environ.get("CLIPMIND_LLM_BASE_URL", "").strip().rstrip("/")
LLM_API_KEY = os.environ.get("CLIPMIND_LLM_API_KEY", "").strip()
LLM_MODEL = (os.environ.get("CLIPMIND_LLM_MODEL", "auto").strip() or "auto")

# Fallback: bila tidak ada LLM khusus, pakai kunci GEMINI_API_KEY yang sudah ada
# lewat endpoint OpenAI-compatible Google -> refine ejaan langsung jalan tanpa setup lagi.
_gk = os.environ.get("GEMINI_API_KEY", "").strip()
if not LLM_API_KEY and _gk and _gk != "MY_GEMINI_API_KEY":
    LLM_BASE_URL = LLM_BASE_URL or "https://generativelanguage.googleapis.com/v1beta/openai"
    LLM_API_KEY = _gk
    if LLM_MODEL in ("", "auto"):
        LLM_MODEL = "gemini-2.5-flash"
_REFINE_MODE = os.environ.get("CLIPMIND_LLM_REFINE", "auto").strip().lower()  # auto|true|false
REFINE_BATCH = int(os.environ.get("CLIPMIND_LLM_REFINE_BATCH", "40") or "40")
REFINE_MAX_CHARS = int(os.environ.get("CLIPMIND_LLM_REFINE_MAX", "24000") or "24000")


def refine_active() -> bool:
    if _REFINE_MODE == "false":
        return False
    if _REFINE_MODE == "true":
        return bool(LLM_BASE_URL and LLM_API_KEY)
    return bool(LLM_BASE_URL and LLM_API_KEY)  # auto

# faster-whisper memanggil `ffmpeg` dari PATH untuk decode audio.
# Jika FFMPEG_BIN menunjuk file, tambahkan foldernya ke PATH.
if FFMPEG_BIN and FFMPEG_BIN.lower() not in ("ffmpeg", "ffmpeg.exe"):
    ff_dir = os.path.dirname(os.path.abspath(FFMPEG_BIN))
    if ff_dir and os.path.isdir(ff_dir):
        os.environ["PATH"] = ff_dir + os.pathsep + os.environ.get("PATH", "")

WORKDIR = os.path.join(tempfile.gettempdir(), "clipmind-transcribe")
os.makedirs(WORKDIR, exist_ok=True)

app = FastAPI(title="ClipMind Transcriber", version="1.0.0")

_model = None
_model_error: Optional[str] = None
_lock = threading.Lock()          # model CT2 tidak thread-safe untuk transcribe paralel

_cache: Dict[str, Dict[str, Any]] = {}   # key -> hasil transkrip utuh (disegmen absolute)
_cache_order: List[str] = []             # LRU
MAX_CACHE = 6

# Kunci per-sumber agar request paralel (summary + highlight sekaligus) tidak mengunduh
# / mentranskrip video yang sama dua kali.
_key_locks: Dict[str, threading.Lock] = {}
_key_locks_guard = threading.Lock()


def _get_key_lock(key: str) -> threading.Lock:
    with _key_locks_guard:
        lk = _key_locks.get(key)
        if lk is None:
            lk = threading.Lock()
            _key_locks[key] = lk
        return lk


def _log(*a: Any) -> None:
    print("[transcriber]", *a, file=sys.stderr, flush=True)


def get_model():
    """Muat (sekali) model faster-whisper."""
    global _model, _model_error
    if _model is not None:
        return _model
    if _model_error:
        raise RuntimeError(_model_error)
    try:
        from faster_whisper import WhisperModel
    except Exception as e:  # pragma: no cover
        _model_error = f"faster-whisper tidak terpasang: {e}"
        raise RuntimeError(_model_error)
    try:
        _log(f"memuat model {MODEL_NAME} (device={DEVICE}, compute={COMPUTE}, dir={MODEL_DIR})")
        t0 = time.time()
        m_arg, m_dir, m_local = _resolve_model(MODEL_NAME, MODEL_DIR)
        _model = WhisperModel(
            m_arg,
            device=DEVICE,
            compute_type=COMPUTE,
            download_root=m_dir,
            local_files_only=bool(m_local),
        )
        _log(f"model siap dalam {time.time() - t0:.1f}s")
        return _model
    except Exception as e:
        _model_error = f"Gagal memuat model: {e}"
        _log(_model_error)
        raise RuntimeError(_model_error)


def _cache_put(key: str, value: Dict[str, Any]) -> None:
    _cache[key] = value
    _cache_order.append(key)
    while len(_cache_order) > MAX_CACHE:
        old = _cache_order.pop(0)
        _cache.pop(old, None)


# ---------------------------------------------------------------------------
#  AI penyempurnaan ejaan (LLM OpenAI-compatible, dipanggil dari Python)
# ---------------------------------------------------------------------------
_REFINE_SYS = (
    "Anda asisten penyunting ejaan. Perbaiki HANYA ejaan, tanda baca, dan tata bahasa "
    "pada tiap baris transkrip. JANGAN menerjemahkan, JANGAN mengubah makna, JANGAN "
    "menambah/mengurangi/menggabungkan baris. Keluarkan HANYA array JSON string dengan "
    "jumlah dan urutan yang sama persis dengan input."
)


def _llm_chat(messages: List[Dict[str, str]], timeout: int = 120, retries: int = 2) -> str:
    url = f"{LLM_BASE_URL}/chat/completions"
    payload = {"model": LLM_MODEL, "messages": messages, "temperature": 0}
    data = json.dumps(payload).encode("utf-8")
    last: Optional[BaseException] = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {LLM_API_KEY}",
                # Cloudflare menolak User-Agent python-urllib default -> pakai UA browser.
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
                ),
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                obj = json.load(resp)
            return obj["choices"][0]["message"]["content"] or ""
        except Exception as e:  # jaringan/HTTP transien -> retry
            last = e
            if attempt < retries:
                time.sleep(0.8 * (attempt + 1))
    raise last if last else RuntimeError("LLM call failed")


def _parse_json_array(text: str) -> Optional[List[Any]]:
    if not text:
        return None
    t = text.strip()
    t = re.sub(r"^```(?:json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    try:
        v = json.loads(t)
        return v if isinstance(v, list) else None
    except Exception:
        pass
    m = re.search(r"\[.*\]", t, re.DOTALL)
    if m:
        try:
            v = json.loads(m.group(0))
            return v if isinstance(v, list) else None
        except Exception:
            return None
    return None


def _refine_batch(lines: List[str], language: Optional[str]) -> Optional[List[str]]:
    numbered = "\n".join(f"{i}: {t}" for i, t in enumerate(lines))
    lang_hint = f" (bahasa: {language})" if language else ""
    user = (
        f"Perbaiki ejaan/tanda baca/tata bahasa baris berikut{lang_hint}, "
        f"tanpa menerjemahkan:{numbered}\n\n"
        f'Keluarkan JSON array string persis {len(lines)} elemen, contoh: ["baris 0","baris 1"]'
    )
    content = _llm_chat(
        [{"role": "system", "content": _REFINE_SYS}, {"role": "user", "content": user}]
    )
    arr = _parse_json_array(content)
    if not arr or len(arr) != len(lines):
        return None
    out = []
    for i in range(len(lines)):
        val = str(arr[i]).strip()
        out.append(val if val else lines[i])
    return out


def _apply_refine(full: Dict[str, Any], key: str) -> Dict[str, Any]:
    """Kembalikan full dengan teks sudah disempurnakan ejaannya (cache terpisah)."""
    if not refine_active():
        return full
    rkey = key + "::refined"
    cached = _cache.get(rkey)
    if cached is not None:
        return cached

    segs = full.get("segments", [])
    if not segs:
        return full
    texts = [s.get("text", "") for s in segs]
    out_texts = list(texts)
    language = full.get("language")

    idx = 0
    budget = REFINE_MAX_CHARS
    refined_any = False
    while idx < len(texts) and budget > 0:
        batch = texts[idx : idx + REFINE_BATCH]
        try:
            res = _refine_batch(batch, language)
        except Exception as e:
            _log(f"refine batch gagal (dilewati): {e}")
            res = None
        if res:
            for j, rt in enumerate(res):
                if rt:
                    out_texts[idx + j] = rt
            refined_any = True
        budget -= sum(len(t) + 1 for t in batch)
        idx += REFINE_BATCH

    result = {**full, "segments": [{**s, "text": out_texts[i]} for i, s in enumerate(segs)]}
    result["refined"] = refined_any
    _cache_put(rkey, result)
    _log(f"refine ejaan selesai untuk {key[:40]}… ({'ada perubahan' if refined_any else 'tanpa perubahan'})")
    return result


# ---------------------------------------------------------------------------
#  Analisis tingkat lanjut: Ringkasan & Highlight (AI dipanggil dari Python)
# ---------------------------------------------------------------------------
def llm_available() -> bool:
    return bool(LLM_BASE_URL and LLM_API_KEY)


def _get_full(req) -> (Dict[str, Any], str):
    """Transkrip penuh (cache) + refine ejaan (bila aktif). Aman utk request paralel."""
    key, kind = _source_key(req)
    with _get_key_lock(key):
        if key not in _cache:
            path, is_temp = _acquire_audio(req, kind, key)
            try:
                _transcribe_full(path, key, getattr(req, "language", None))
            finally:
                if is_temp and path and os.path.exists(path):
                    try:
                        os.remove(path)
                    except OSError:
                        pass
        full = _cache[key]
        if not getattr(req, "raw_only", False):
            full = _apply_refine(full, key)
    return full, key


def _transcript_text(full: Dict[str, Any], max_chars: int = 30000) -> str:
    lines: List[str] = []
    n = 0
    for s in full.get("segments", []):
        mm = int(s["start"] // 60)
        ss = int(s["start"] % 60)
        line = f"[{mm:02d}:{ss:02d}] {s.get('text', '')}"
        n += len(line) + 1
        if n > max_chars:
            break
        lines.append(line)
    return "\n".join(lines)


def _parse_json_obj(text: str) -> Optional[Any]:
    if not text:
        return None
    t = text.strip()
    t = re.sub(r"^```(?:json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    try:
        return json.loads(t)
    except Exception:
        m = re.search(r"[\{\[].*[\}\]]", t, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                return None
    return None


def _llm_json(messages: List[Dict[str, str]], timeout: int = 180) -> Optional[Any]:
    content = _llm_chat(messages, timeout=timeout)
    return _parse_json_obj(content)


def _clamp_int(v: Any, mx: float) -> int:
    try:
        x = int(float(v))
    except (TypeError, ValueError):
        x = 0
    return max(0, min(int(mx) if mx else 0, x))


_STYLE_GUIDE = {
    "Santai": "bahasa Indonesia santai, komunikatif, seperti kreator membahas ke teman",
    "Akademis": "bahasa Indonesia formal, objektif, terstruktur",
    "Bahan Presentasi": "poin ringkas siap salin untuk slide, padat & berorientasi insight",
    "Untuk Anak SMA": "bahasa sederhana, analogi sehari-hari, istilah sulit dijelaskan ringan",
}
_LENGTH_GUIDE = {
    "Singkat": "4-5 poin penting dan 3-5 bab utama yang sangat ringkas",
    "Sedang": "6-8 poin penting dan 5-8 bab yang seimbang",
    "Detail": "8-12 poin penting dan 8-14 bab mendalam",
}
_KATEGORI = {
    "Kutipan kuat", "Tips praktis", "Plot twist",
    "Momen lucu", "Fakta mengejutkan", "Emosional",
}


def _build_summary(obj: Optional[Dict[str, Any]], dur: float) -> Dict[str, Any]:
    obj = obj or {}
    pp = [
        {"teks": str(p.get("teks", "")).strip(), "detik": _clamp_int(p.get("detik"), dur)}
        for p in (obj.get("poin_penting") or [])
        if str(p.get("teks", "")).strip()
    ]
    bab = []
    for c in (obj.get("bab") or []):
        mulai = _clamp_int(c.get("mulai"), dur)
        selesai = _clamp_int(c.get("selesai"), dur)
        if selesai <= mulai:
            selesai = min(int(dur), mulai + 30)
        bab.append({
            "judul": str(c.get("judul", "")).strip(),
            "mulai": mulai,
            "selesai": selesai,
            "ringkasan": str(c.get("ringkasan", "")).strip(),
        })
    topik = [str(t).strip() for t in (obj.get("topik") or []) if str(t).strip()][:12]
    return {
        "judul": str(obj.get("judul") or "Ringkasan Video").strip() or "Ringkasan Video",
        "tldr": str(obj.get("tldr") or "").strip(),
        "poin_penting": pp,
        "bab": bab,
        "topik": topik,
        "durasi_total_detik": _clamp_int(obj.get("durasi_total_detik") or dur, dur) or int(dur),
    }


def _build_highlights(arr: Optional[List[Any]], dur: float) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for h in (arr or []):
        if not isinstance(h, dict):
            continue
        kat = str(h.get("kategori", "")).strip()
        if kat not in _KATEGORI:
            kat = "Kutipan kuat"
        mulai = _clamp_int(h.get("mulai"), dur)
        selesai = _clamp_int(h.get("selesai"), dur)
        if selesai <= mulai:
            selesai = min(int(dur), mulai + 30)
        try:
            sv = int(float(h.get("skor_viral", 0)))
        except (TypeError, ValueError):
            sv = 0
        out.append({
            "judul": str(h.get("judul", "")).strip() or "Highlight",
            "mulai": mulai,
            "selesai": selesai,
            "kategori": kat,
            "skor_viral": max(0, min(100, sv)),
            "alasan": str(h.get("alasan", "")).strip(),
            "hook_saran": str(h.get("hook_saran", "")).strip(),
        })
    out.sort(key=lambda x: -x["skor_viral"])
    return out


class AnalyzeReq(BaseModel):
    youtube_url: Optional[str] = None
    file_path: Optional[str] = None
    audio_base64: Optional[str] = None
    language: Optional[str] = None
    raw_only: bool = False
    style: str = "Santai"
    length: str = "Sedang"
    focus_query: Optional[str] = None
    duration_hint: Optional[float] = None


@app.post("/summary")
def summary(req: AnalyzeReq):
    if not llm_available():
        raise HTTPException(
            status_code=500,
            detail="LLM untuk ringkasan belum dikonfigurasi (isi CLIPMIND_LLM_* atau GEMINI_API_KEY).",
        )
    full, _ = _get_full(req)
    if not full.get("segments"):
        raise HTTPException(status_code=422, detail="Transkrip kosong, tidak dapat membuat ringkasan.")
    dur = float(req.duration_hint or 0) or full.get("duration") or (full["segments"][-1]["end"] if full["segments"] else 0)
    style_guide = _STYLE_GUIDE.get(req.style, _STYLE_GUIDE["Santai"])
    length_guide = _LENGTH_GUIDE.get(req.length, _LENGTH_GUIDE["Sedang"])
    schema = (
        '{"judul":str,"tldr":str,"poin_penting":[{"teks":str,"detik":int}],'
        '"bab":[{"judul":str,"mulai":int,"selesai":int,"ringkasan":str}],'
        '"topik":[str],"durasi_total_detik":int}'
    )
    user = (
        f"Buat ringkasan terstruktur dalam bahasa Indonesia, gaya: {style_guide}; kedalaman: {length_guide}.\n"
        "Semua waktu dalam SATUAN DETIK (integer). TL;DR maks 3 kalimat. Bab kronologis.\n"
        f'Keluarkan HANYA JSON sesuai bentuk ini: {schema}\n\n'
        f"Transkrip (format [MM:SS] teks):\n{_transcript_text(full)}"
    )
    obj = _llm_json([
        {"role": "system", "content": "Anda penyusun ringkasan video dari transkrip. Keluarkan HANYA JSON valid, tanpa markdown."},
        {"role": "user", "content": user},
    ])
    return _build_summary(obj, dur)


@app.post("/highlights")
def highlights(req: AnalyzeReq):
    if not llm_available():
        raise HTTPException(
            status_code=500,
            detail="LLM untuk highlight belum dikonfigurasi (isi CLIPMIND_LLM_* atau GEMINI_API_KEY).",
        )
    full, _ = _get_full(req)
    if not full.get("segments"):
        raise HTTPException(status_code=422, detail="Transkrip kosong, tidak dapat mencari highlight.")
    dur = float(req.duration_hint or 0) or full.get("duration") or (full["segments"][-1]["end"] if full["segments"] else 0)
    focus = (
        f'Fokus khusus pengguna: "{req.focus_query.strip()}". Prioritaskan momen yang cocok.'
        if req.focus_query and req.focus_query.strip()
        else "Cari momen terbaik yang paling menarik/informatif/berpotensi viral."
    )
    schema = (
        '[{"judul":str,"mulai":int,"selesai":int,"kategori":str,'
        '"skor_viral":int,"alasan":str,"hook_saran":str}]'
    )
    user = (
        f'Identifikasi 5-8 momen highlight dari transkrip untuk dijadikan klip pendek (15-90 detik). {focus}\n'
        'Urutkan skor_viral tertinggi (0-100). "mulai"/"selesai" dalam DETIK (integer).\n'
        f'"kategori" WAJIB salah satu: {sorted(_KATEGORI)}. Sertakan "hook_saran" pembuka 3 detik.\n'
        f'Keluarkan HANYA JSON array: {schema}\n\n'
        f"Transkrip (format [MM:SS] teks):\n{_transcript_text(full)}"
    )
    arr = _llm_json([
        {"role": "system", "content": "Anda analis highlight video dari transkrip. Keluarkan HANYA JSON array valid, tanpa markdown."},
        {"role": "user", "content": user},
    ])
    if isinstance(arr, dict):
        arr = arr.get("highlights") or arr.get("items") or []
    return _build_highlights(arr, dur)


_YT_ID_RE = re.compile(r"(?:v=|youtu\.be/|/shorts/|/live/|/embed/)([\w-]{11})")


def _guess_yt_id(url: str) -> str:
    m = _YT_ID_RE.search(url or "")
    return m.group(1) if m else ""


def _source_key(req) -> (str, str):
    """Hitung (cache_key, kind) TANPA mengunduh apa pun. kind: youtube|file|buf."""
    if req.youtube_url:
        vid = _guess_yt_id(req.youtube_url) or str(abs(hash(req.youtube_url)))
        return f"yt::{vid}", "youtube"
    if req.file_path:
        ap = os.path.abspath(req.file_path)
        if not os.path.isfile(ap):
            raise HTTPException(status_code=404, detail="File audio/video tidak ditemukan di server.")
        st = os.stat(ap)
        return f"file::{ap}::{int(st.st_mtime)}::{st.st_size}", "file"
    if req.audio_base64:
        raw = base64.b64decode(req.audio_base64)
        return f"buf::{hashlib.sha1(raw).hexdigest()}", "buf"
    raise HTTPException(status_code=400, detail="Butuh youtube_url, file_path, atau audio_base64.")


def _acquire_audio(req, kind: str, key: str) -> (str, bool):
    """Siapkan file audio. Hanya dipanggil saat hasil belum di-cache. Return (path, is_temp)."""
    if kind == "file":
        return os.path.abspath(req.file_path), False

    if kind == "youtube":
        vid = key.split("::", 1)[1]
        # Nama file unik per proses+waktu agar dua unduhan paralel tidak bentrok.
        out = os.path.join(WORKDIR, f"yt-{vid}-{os.getpid()}-{int(time.time() * 1000)}.m4a")
        try:
            from yt_dlp import YoutubeDL
        except Exception as e:  # pragma: no cover
            raise HTTPException(status_code=500, detail=f"yt-dlp tidak terpasang: {e}")
        opts = {
            "format": "bestaudio[ext=m4a]/bestaudio/best",
            "outtmpl": out,
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "restrictfilenames": True,
            # YouTube kini butuh JS runtime utk ekstraksi; pakai Node bila tersedia.
            "js_runtimes": {"node": {}},
        }
        try:
            with YoutubeDL(opts) as ydl:
                ydl.extract_info(req.youtube_url, download=True)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Gagal mengunduh audio YouTube: {e}")
        if not os.path.exists(out):
            # yt-dlp kadang menyimpan dgn ekstensi berbeda; cari file terbaru berprefiks sama.
            cands = [
                f for f in os.listdir(WORKDIR)
                if f.startswith(f"yt-{vid}-{os.getpid()}-{int(time.time() * 1000)}")
            ]
            if not cands:
                raise HTTPException(status_code=502, detail="Audio YouTube tidak berhasil diunduh.")
            out = os.path.join(WORKDIR, cands[0])
        return out, True

    if kind == "buf":
        raw = base64.b64decode(req.audio_base64)
        out = os.path.join(WORKDIR, f"buf-{os.getpid()}-{int(time.time() * 1000)}.m4a")
        with open(out, "wb") as f:
            f.write(raw)
        return out, True

    raise HTTPException(status_code=400, detail="Sumber tidak valid.")


def _transcribe_full(path: str, key: str, language: Optional[str]) -> Dict[str, Any]:
    """Transkripsi SELURUH file sekali, lalu cache. Return dict hasil."""
    cached = _cache.get(key)
    if cached is not None:
        return cached
    if not path:
        raise HTTPException(status_code=500, detail="Sumber audio tidak tersedia untuk transkripsi.")

    with _lock:
        cached = _cache.get(key)
        if cached is not None:
            return cached
        model = get_model()
        t0 = time.time()
        segments_iter, info = model.transcribe(
            path,
            language=(language or None),
            beam_size=BEAM_SIZE,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300},
        )
        out_segs: List[Dict[str, Any]] = []
        for s in segments_iter:
            words = [
                {"word": (w.word or "").strip(), "start": float(w.start), "end": float(w.end)}
                for w in (s.words or [])
            ]
            text = (s.text or "").strip()
            if not text:
                continue
            out_segs.append(
                {"start": float(s.start), "end": float(s.end), "text": text, "words": words}
            )
        result = {
            "segments": out_segs,
            "language": getattr(info, "language", None),
            "language_probability": round(float(getattr(info, "language_probability", 0.0)), 3),
            "duration": float(getattr(info, "duration", 0.0) or 0.0),
        }
        _cache_put(key, result)
        _log(f"transkrip {key[:40]}… selesai {len(out_segs)} segmen dalam {time.time()-t0:.1f}s")
        return result


class TranscribeReq(BaseModel):
    youtube_url: Optional[str] = None
    file_path: Optional[str] = None
    audio_base64: Optional[str] = None
    start_sec: float = 0.0
    end_sec: Optional[float] = None
    language: Optional[str] = None
    word_timestamps: bool = True
    raw_only: bool = False  # True = lewati AI refine (kembalikan Whisper mentah)


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL_NAME,
        "device": DEVICE,
        "compute": COMPUTE,
        "ffmpeg": FFMPEG_BIN,
        "model_loaded": _model is not None,
        "model_error": _model_error,
        "cached_sources": len(_cache),
        "refine_active": refine_active(),
        "llm_available": llm_available(),
        "llm_model": LLM_MODEL if llm_available() else None,
    }


@app.post("/transcribe")
def transcribe(req: TranscribeReq):
    full, key = _get_full(req)
    start = float(req.start_sec or 0.0)
    end = float(req.end_sec) if req.end_sec is not None else None
    segs = full["segments"]
    if start > 0 or end is not None:
        hi = end if end is not None else float("inf")
        segs = [s for s in segs if s["end"] > start and s["start"] < hi]

    return {
        "segments": segs,
        "language": full["language"],
        "language_probability": full["language_probability"],
        "duration": full["duration"],
        "refined": bool(full.get("refined", False)),
        "cached": key in _cache,
    }


def main() -> None:
    import uvicorn
    _log(f"ClipMind Transcriber di http://127.0.0.1:{PORT}")
    # preload model agar request pertama tidak menunggu load
    try:
        get_model()
    except Exception as e:
        _log(f"peringatan: {e}")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")


if __name__ == "__main__":
    main()
