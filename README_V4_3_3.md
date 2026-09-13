# 名刺管理PWA v4.3.3 — OpenCV不要でも傾き補正できる版

## 重要な変更
OpenCV.js が NG でもOCRを停止しません。

画像補正は次の優先順位です。

### 1. OpenCV.js が使える場合
名刺外周4点を検出し、
- 回転
- 台形歪み
- 透視歪み
を補正します。

### 2. OpenCV.js が使えない場合
PWA内蔵の純JavaScript処理へ自動フォールバックします。

処理:
1. Canvasで画像縮小
2. グレースケール化
3. Sobel勾配で輪郭・文字エッジ検出
4. 外周側エッジへ重み付け
5. -30°～+30°の角度ヒストグラム
6. 名刺/文字列の傾き角を推定
7. Canvasで逆方向に回転補正
8. 補正画像をTesseractへ入力

このJS補正は外部ライブラリを必要としません。

## 設定画面
OpenCVが使えない場合でも、正常例は次のようになります。

    OpenCV.js:    NG（任意）
    JS傾き補正:   OK
    Tesseract.js: OK
    Worker:       OK
    Japanese:     OK
    Japanese Vert:OK
    English:      OK
    LSTM Core:    OK
    ------------------------
    総合判定: JS傾き補正＋OCR実行可能

OpenCV NGだけなら問題ありません。

## セキュリティ
純JavaScript補正は完全に端末内処理です。
名刺画像を外部へ送信しません。

## OpenCVについて
OpenCVは残していますが、v4.3.3では必須ではありません。
OpenCVが読み込めた場合だけ、より高度な4点透視補正を使用します。

## 更新手順
1. v4.3.3をGitHub Pagesへ配置
2. SETUP_OCR_FINAL.batはTesseract資材が不足している場合のみ実行
3. 古いService Worker / サイトデータを削除
4. PWAを再読込
5. 設定 → OCR・画像補正自己診断
6. OpenCVがNGでも「JS傾き補正: OK」「Tesseract各項目: OK」なら使用可能
