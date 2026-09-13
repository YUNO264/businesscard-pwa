# 名刺管理PWA v4.3 — 外周輪郭による傾き・台形補正対応

## v4.3の主変更
OCRを実行する前に、名刺写真から外周輪郭を検出します。

処理順:
1. OpenCV.jsでグレースケール化
2. Cannyエッジ検出
3. 輪郭抽出
4. 名刺らしい最大四角形を選択
5. 外周4点を左上・右上・右下・左下へ並べる
6. 4点透視変換
7. 長方形へ補正した画像をTesseract.jsへ渡す
8. 座標付きOCR・レイアウト解析
9. 各項目へ転記

これにより単なる回転だけでなく、斜め撮影による台形歪みにも対応します。

OpenCVの4点透視変換は `getPerspectiveTransform` と `warpPerspective` を使用します。

## 外周を検出できない場合
OCR自体は停止しません。
元画像へ自動的にフォールバックします。

画面には
- 名刺外周から回転・台形補正完了
- 外周未検出・元画像を使用

のどちらかを表示します。

## 初回 / v4.2から更新時
1. ZIPを展開
2. `SETUP_OCR_FINAL.bat` を実行
3. OpenCV.js / Tesseract.js / LSTM core / jpn / jpn_vert / engを配置
4. v4.2以前のサイトデータ・Service Workerを削除
5. VS Code + Live ServerまたはGitHub Pagesで起動
6. 設定 → OCR・画像補正自己診断
7. `OpenCV.js: OK` を確認
8. 名刺画像を選択して端末内OCR

## GitHub
OpenCV.js 4.13.0公式ビルドはセットアップ時に `vendor/opencv.js` として配置されます。
PWA実行時は外部CDNを参照しません。
名刺画像・OCR結果は外部OCRサービスへ送信しません。

## OCR方向
- 自動判定
- 横書き
- 縦書き

はv4.2から継続しています。

横書き読取順:
上 → 下、同じ行は左 → 右

縦書き読取順:
右列 → 左列、各列は上 → 下


## 画像補正ライブラリ
`SETUP_OCR_FINAL.bat` は OpenCV 4.13.0 の公式 `opencv.js` を取得します。
アプリ実行時は `vendor/opencv.js` をローカル読み込みし、画像を外部サーバへ送信しません。
