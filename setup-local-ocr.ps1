$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
New-Item -ItemType Directory -Force -Path "$root\vendor\core" | Out-Null
New-Item -ItemType Directory -Force -Path "$root\tessdata" | Out-Null

$files = @{
  "$root\vendor\tesseract.min.js" = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js"
  "$root\vendor\worker.min.js" = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js"
  "$root\vendor\core\tesseract-core.wasm.js" = "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core.wasm.js"
  "$root\vendor\core\tesseract-core-simd.wasm.js" = "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-simd.wasm.js"
  "$root\vendor\core\tesseract-core-lstm.wasm.js" = "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-lstm.wasm.js"
  "$root\vendor\core\tesseract-core-simd-lstm.wasm.js" = "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-simd-lstm.wasm.js"
  "$root\vendor\core\tesseract-core-relaxedsimd.wasm.js" = "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-relaxedsimd.wasm.js"
  "$root\vendor\core\tesseract-core-relaxedsimd-lstm.wasm.js" = "https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/tesseract-core-relaxedsimd-lstm.wasm.js"
  "$root\tessdata\jpn.traineddata.gz" = "https://tessdata.projectnaptha.com/4.0.0/jpn.traineddata.gz"
  "$root\tessdata\eng.traineddata.gz" = "https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz"
}

Write-Host "Tesseract.js OCR local assets downloading..."
foreach ($pair in $files.GetEnumerator()) {
  Write-Host ("  " + [IO.Path]::GetFileName($pair.Key))
  Invoke-WebRequest -Uri $pair.Value -OutFile $pair.Key -UseBasicParsing
}
Write-Host "Complete. OCR will now use local assets." -ForegroundColor Green
Read-Host "Press Enter to close"
