# 空き枠提案ページ

Googleカレンダーの空き枠と予定一覧を表示し、閲覧者が複数候補を提案できるWebページです。

## できること

- Googleカレンダーの埋まり時間から空き枠を計算
- 平日8:00-18:00の範囲で空き枠/予定を表示
- 予定カレンダーは予定がある時間のみ表示（タイトルは非表示）
- 閲覧者は「日付ごとの時間グラフ」をクリック/ドラッグして、連続した候補時間を複数提案送信（お名前・メール必須）
- 提案内容は `data/proposals.json` に保存
- 送信内容を指定アドレスへメール通知

## セットアップ

1. 依存関係をインストール

```bash
npm install
```

2. `.env` を作成

```bash
cp .env.example .env
```

3. Google Cloud 側で設定

- Calendar API を有効化
- サービスアカウントを作成
- 鍵(JSON)を作成し、`GOOGLE_SERVICE_ACCOUNT_JSON` に貼る
- 対象カレンダーをサービスアカウントのメールに「予定の表示（閲覧）」で共有
- `CALENDAR_ID` に対象カレンダーIDを設定

4. メール通知設定（任意だが本要件では推奨）

- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` を設定
- 通知先は `NOTIFY_TO`（デフォルト: `yamasaki586868@gmail.com`）
- Gmailを使う場合はアプリパスワードを利用

5. 起動

```bash
npm run dev
```

ブラウザで `http://localhost:3000` を開く。

## Vercel で公開する（推奨）

Vercel ではフロントとAPIを同じプロジェクトで公開できます。

1. GitHubにpush
2. VercelでリポジトリをImport
3. Environment Variables に以下を設定

- `CALENDAR_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `TIMEZONE`
- `WORK_START_HOUR`
- `WORK_END_HOUR`
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `MAIL_FROM`
- `NOTIFY_TO`

4. Deploy

補足:
- `vercel.json` で `/api/*` は `server.js`、それ以外は `public/` 配下を配信します。
- 提案ログ保存はVercel上では `/tmp/proposals.json` を使用します（永続保存ではありません）。

## 注意

- この実装は「空き枠提案」までです。確定時の本予約は未実装です。
- 提案保存はローカルJSONなので、本番運用時はDB化を推奨します。
