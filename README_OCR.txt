OCR動作版

この版は2モードです。

A. そのまま使用
OCR初回実行時だけTesseract.js本体・Worker・WASM・言語データを公式配布元から取得します。
名刺画像・OCR結果・登録データを外部へ送信する処理はありません。

B. 完全ローカルOCRにする（推奨）
Windows PCで setup-local-ocr.ps1 を右クリック→PowerShellで実行してください。
必要なOCR資材をvendor/core/tessdataにダウンロードします。
以後はアプリがローカル資材を優先利用します。

注意:
・PWAはHTTPSまたはlocalhostで起動してください。
・古いService Workerが残っている場合は、ブラウザのサイトデータを一度削除するか、更新後に再読み込みしてください。
・名刺データはIndexedDBに保存されます。定期的にJSONバックアップを作成してください。
