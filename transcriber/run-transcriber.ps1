# ClipMind — jalankan service transcriber Python (Windows PowerShell)
# Konfigurasi dibaca dari file .env di root repo (app.py memuatnya via python-dotenv):
#   CLIPMIND_TRANSCRIBER_PORT, CLIPMIND_WHISPER_MODEL, CLIPMIND_WHISPER_MODEL_DIR,
#   CLIPMIND_WHISPER_DEVICE, CLIPMIND_WHISPER_COMPUTE, CLIPMIND_FFMPEG, CLIPMIND_WHISPER_LOCAL_ONLY
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$py   = Join-Path $here ".venv\Scripts\python.exe"

if (-not (Test-Path $py)) {
    Write-Host "venv belum dibuat. Jalankan dulu:  .\transcriber\install.ps1" -ForegroundColor Yellow
}

Write-Host "Menjalankan transcriber (lihat .env untuk port & model)..." -ForegroundColor Cyan
& $py "$here\app.py"
