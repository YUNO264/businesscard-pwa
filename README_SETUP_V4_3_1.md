# 名刺管理PWA v4.3.1 — セットアップ修正版

## v4.3からの修正
v4.3ではOpenCV.jsを最初にダウンロードしていました。
OpenCV取得に失敗するとPowerShellが停止し、Tesseractの `vendor/core` まで
ダウンロードされない問題がありました。

v4.3.1では順序を変更しています。

1. Tesseract.js本体
2. Tesseract LSTM core 6ファイル
3. jpn / eng / jpn_vert
4. OpenCV.js
5. 全ファイル検証

OpenCVは最後に取得するため、OpenCVだけ失敗してもTesseract coreが空にはなりません。

## ダウンロードの冗長化
各ファイルは複数URLを順番に試します。
PowerShell `Invoke-WebRequest` が失敗した場合は、Windowsの `curl.exe` も試します。

OpenCV:
1. jsDelivr `opencv-browser@1.0.0/opencv.js`
2. OpenCV docs `4.x/opencv.js`
3. OpenCV docs `4.12.0/opencv.js`

Tesseract:
- jsDelivr
- unpkg

## 実行方法
1. ZIPを展開
2. `SETUP_OCR_FINAL.bat` をダブルクリック
3. 最後まで画面を閉じない
4. `SETUP SUCCESS` を確認

正常時、`vendor/core` には最低6ファイルあります。

- tesseract-core-lstm.wasm.js
- tesseract-core-lstm.wasm
- tesseract-core-simd-lstm.wasm.js
- tesseract-core-simd-lstm.wasm
- tesseract-core-relaxedsimd-lstm.wasm.js
- tesseract-core-relaxedsimd-lstm.wasm

`vendor` には次も必要です。

- tesseract.min.js
- worker.min.js
- opencv.js

## 失敗時
同じフォルダの `SETUP_OCR_FINAL.log` に
どのURL・どのファイルで失敗したかが残ります。

`CHECK_OCR_FILES.bat` を実行すると、
vendor / vendor/core / tessdata の中身を一覧表示できます。

## 既存PWA更新時
セットアップ成功後、
古いService Workerとサイトデータを削除してからv4.3.1を開いてください。
