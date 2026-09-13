# 名刺管理PWA v3

## 重要
このZIPには、日本語・英語のOCR言語データを同梱しています。
Tesseract.js本体・Worker・WASM coreはライセンス上公開配布されているファイルですが、
この生成環境から外部バイナリをZIPへ直接取得できないため、初回だけ
`SETUP_OCR_V3.bat` をPCで実行してください。

このセットアップは「OCRプログラム本体をダウンロードするだけ」です。
名刺画像・OCR文字列・氏名・会社名等を外部へ送信しません。
セットアップ完了後、OCRはPWAフォルダ内のローカル資材だけを使用します。

## 初回セットアップ
1. ZIPを展開
2. `SETUP_OCR_V3.bat` をダブルクリック
3. "Setup completed." を確認
4. VS Code + Live Server等でフォルダをHTTP/HTTPS配信
5. PWA → 設定 → OCR自己診断
6. すべてOKなら名刺登録 → 画像 → 端末内OCR

## OCR自己診断
- Tesseract.js
- Worker
- Japanese
- English
- Core loader

の状態を表示します。

## v3のOCRフロー
1. Tesseract.js確認
2. Worker起動
3. 日本語・英語データ読込
4. OCR文字認識
5. OCR全文を画面表示
6. OCR全文から会社名・氏名・部署・役職・電話・携帯・メール・郵便番号・住所・Webを解析
7. フォームへ転記

OCR全文を手動修正後、「OCR全文から再解析」も可能です。

## 外部送信について
アプリ本体のCSPは `connect-src 'self'` です。
そのためアプリ実行中のJavaScriptは同一オリジン以外へのfetch/XHRを許可しません。
TesseractのworkerPath/corePath/langPathもすべて `./vendor` / `./tessdata` を指定しています。

## 旧版から切替える場合
古いService Worker/キャッシュが残る可能性があるため、
ホーム画面の旧PWAを削除し、ブラウザの対象サイトデータを削除してからv3を開くことを推奨します。

## バックアップ
CSV: Excel閲覧用
JSON: 完全復元用（画像保存ONの場合は画像も含む）
