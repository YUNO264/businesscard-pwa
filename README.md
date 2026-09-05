# 名刺管理PWA

外部DBを使わず、名刺情報をブラウザのIndexedDBに保存するPWAです。

## 実装済み
- 名刺登録・編集・削除
- 会社名、氏名、部署、役職、電話、メール、分類、タグ、メモ等
- 複数語AND検索
- 分類フィルタ
- 重複警告
- 名刺画像の任意保存
- CSVバックアップ
- JSON完全バックアップ
- JSON復元
- 登録件数・概算容量表示
- PWA / Service Worker
- OCR呼び出し口（ローカルTesseract.js用）

## 重要なセキュリティ仕様
名刺データはIndexedDBに保存し、このコードにはサーバー送信処理を実装していません。
外部OCR API、Analytics、広告SDK、Firebase等も使用していません。

ただし、PWA本体をGitHub Pages等から配信する場合、ページを取得する通信自体は発生します。
「名刺情報を外部に送信しない」ことと「インターネット通信が完全にゼロ」は別です。

## 起動方法
PWAは file:// ではService Workerが動かないため、HTTPSまたはlocalhostで起動してください。

開発PC:
1. このフォルダをVS Codeで開く
2. Live Server等で起動
3. iPhoneから利用する場合はHTTPSで公開する

## OCRを有効にする
OCRはTesseract.jsのローカル同梱を前提としています。
外部CDNを指定しないでください。

配置例:
vendor/
  tesseract.min.js
  worker.min.js
  tesseract-core.wasm.js または使用バージョンに必要なcore一式
tessdata/
  jpn.traineddata.gz
  eng.traineddata.gz

index.htmlの末尾で、js/ocr.jsより前に次を追加します。

<script src="./vendor/tesseract.min.js"></script>

使用するTesseract.jsのバージョンによりcoreファイル名・初期化オプションが変わる場合があります。
同一バージョンのdist/worker/coreを揃えてください。

## iPhoneでの注意
- 「ホーム画面に追加」でPWAとして利用
- SafariのWebサイトデータ削除でIndexedDBが消える可能性があるため、JSONバックアップを定期的に作成
- 機種変更前にもJSONバックアップを作成
- 名刺画像保存はデフォルトOFF推奨

## 推奨運用
1. 名刺を撮影
2. OCR（有効化後）
3. OCR結果を人が確認
4. 分類・タグ・メモを追加
5. 保存
6. 月1回程度JSON完全バックアップ

## バックアップの違い
CSV: Excel閲覧・一覧利用向け。画像は含みません。
JSON: アプリ完全復元向け。画像保存をONにした名刺は画像も含みます。
