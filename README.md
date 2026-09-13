# 名刺管理PWA 最終版（座標付き完全ローカルOCR）

## 主な改善点

- Tesseract.js v7を端末内で実行
- `blocks:true` の座標付きOCRを使用
- OCR wordのbbox（X/Y座標）から、同じ高さでも横方向に離れた情報を別領域へ分割
- 会社・氏名・部署・役職・住所・電話・携帯・FAX・メール・Webを内容＋位置で分類
- OCR画像上に解析領域を表示
- OCR後の各領域について分類をプルダウンで手修正可能
- 修正した分類からフォームへ再転記可能
- OCR全文からの座標なし再解析も補助機能として残す
- 名刺画像・OCR結果・登録データを外部OCR APIへ送信しない
- CSV / JSONバックアップ、IndexedDB検索、分類・タグ機能を継続

## 初回セットアップ

1. ZIPを展開
2. `SETUP_OCR_FINAL.bat` をダブルクリック
3. 最後に3つのcoreがすべて `OK` になることを確認
4. VS Code + Live ServerなどでPWAを起動
5. 設定 → OCR資材を確認
6. `総合判定: OCR実行可能` を確認
7. GitHub Pagesへ公開する場合は、セットアップ後の展開済みフォルダをコミット

## GitHub容量対策

旧版はTesseract coreを6種類保存していたためvendorが約43MBになりました。
最終版はOEM=1（LSTM）専用とし、端末互換性のため以下3種類だけを保持します。

- tesseract-core-lstm
- tesseract-core-simd-lstm
- tesseract-core-relaxedsimd-lstm

`SETUP_OCR_FINAL.bat` は旧coreを一度削除してから、この3種類だけを再配置します。

## OCRの使い方

1. ＋登録
2. 名刺画像を撮影または選択
3. 端末内OCR
4. OCR完了後、「レイアウト解析結果」を確認
5. 誤分類があれば、例えば「その他 → 部署」「住所 → 会社」のようにプルダウンを変更
6. 「分類をフォームに反映」
7. 最終確認して保存

名刺は自由レイアウトのため100%完全自動判定は保証できません。
そのため本版では「座標を使った自動判定＋誤分類だけ手修正」を実用上の最終仕様としています。

## セキュリティ

CSPは `connect-src 'self'` を維持しています。
Tesseractのworker/core/langPathもすべて同一PWA内を参照します。
`wasm-unsafe-eval` はTesseract WebAssemblyのコンパイルに必要な範囲でのみ許可しています。

## 旧版から更新する場合

Service Workerの旧キャッシュが残ることがあります。
旧PWAを削除し、対象サイトのブラウザデータを消してから最終版を開くことを推奨します。
