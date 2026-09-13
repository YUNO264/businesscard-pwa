# 名刺管理PWA v4.3.2 — OpenCV自動読込修正版

## 変更理由
v4.3 / v4.3.1では OpenCV.js をSETUP_OCR_FINAL.batで
`vendor/opencv.js`へダウンロードしていました。

環境によってこのダウンロードが失敗し、
設定画面で `OpenCV.js: NG` になることがありました。

## v4.3.2
OpenCVをSETUPから切り離しました。

起動時の優先順位:
1. `vendor/opencv.js` が存在すればローカル版を使用
2. 無ければ OpenCV公式CDN 4.13.0
3. 失敗時 OpenCV公式CDN 4.12.0
4. さらに失敗時 jsDelivrのbrowser build

そのため `SETUP_OCR_FINAL.bat` はTesseract関係だけを取得します。

## プライバシー
CDNから取得するのはOpenCVプログラム本体のみです。
名刺画像・氏名・会社名・OCR結果をCDNへ送る処理はありません。

OpenCVが読み込まれた後、
名刺画像の輪郭検出・透視補正は端末内JavaScript/WebAssemblyで実行します。

## 設定画面
正常時:
    OpenCV.js: OK (CDN)

または、vendor/opencv.jsを自分で配置している場合:
    OpenCV.js: OK (local)

## 更新手順
1. v4.3.2を配置
2. SETUP_OCR_FINAL.batを実行
3. Tesseract資材のSETUP SUCCESSを確認
4. 古いService Worker / サイトデータを削除
5. v4.3.2を再読込
6. 設定 → OCR・画像補正自己診断
7. OpenCV.js: OK (CDN) を確認

OpenCV CDNを初めて使用するときだけインターネット接続が必要です。
