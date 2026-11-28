# ClipMind — setup venv Python untuk transcriber (Windows PowerShell)
# Membuat venv Python 3.12 di transcriber\.venv lalu install dependency.
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
$venv = Join-Path $here ".venv"

Write-Host "== Membuat venv Python 3.12 di $venv ==" -ForegroundColor Cyan
if (-not (Test-Path $venv)) {
    py -3.12 -m venv $venv
}
$py = Join-Path $venv "Scripts\python.exe"

Write-Host "== Upgrade pip ==" -ForegroundColor Cyan
& $py -m pip install --upgrade pip

Write-Host "== Install dependency transcriber ==" -ForegroundColor Cyan
& $py -m pip install -r (Join-Path $here "requirements.txt")

Write-Host ""
Write-Host "Selesai. Jalankan service dengan:  .\transcriber\run-transcriber.ps1" -ForegroundColor Green
