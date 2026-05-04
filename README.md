# MEDiLIFE LINE Bot

FP日下幸晴のアシスタントBotです。LINEに問い合わせてきた方に、Claudeが自動でヒアリングを行い、Zoom面談の予約リンクを案内します。

## 動作の流れ

```
LINEにメッセージ
    ↓
Claudeが自動返信（挨拶）
    ↓
お名前をヒアリング
    ↓
ご相談内容をヒアリング
    ↓
Zoom面談の予約リンクを案内
```

---

## セットアップ手順

### 1. 事前準備

以下のアカウント・情報が必要です：

| 必要なもの | 入手先 |
|---|---|
| LINEチャネルアクセストークン | LINE Developers Console |
| LINEチャネルシークレット | LINE Developers Console |
| AnthropicのAPIキー | console.anthropic.com |
| Zoom予約URL | Calendly などの予約ツール |

---

### 2. LINE Developers の設定

1. [LINE Developers Console](https://developers.line.biz/) にログイン
2. プロバイダー → チャネル → **Messaging API** を選択
3. 「チャネル基本設定」タブ → **チャネルシークレット** をコピー
4. 「Messaging API設定」タブ → **チャネルアクセストークン（長期）** を発行してコピー
5. 「Messaging API設定」タブ → **自動応答メッセージ** を「オフ」にする
6. Webhook URLは後でサーバーURLが決まったら設定します

---

### 3. サーバーへのデプロイ（Railway を使う場合）

[Railway](https://railway.app/) は無料枠があり、GitHubと連携するだけで簡単にデプロイできます。

#### 手順

1. [railway.app](https://railway.app/) にGitHubアカウントでサインアップ
2. 「New Project」→「Deploy from GitHub repo」→ このリポジトリを選択
3. デプロイが完了したら、「Settings」→「Domains」→「Generate Domain」でURLを発行
4. 「Variables」タブで以下の環境変数を設定：

```
LINE_CHANNEL_ACCESS_TOKEN = （LINEのアクセストークン）
LINE_CHANNEL_SECRET       = （LINEのチャネルシークレット）
ANTHROPIC_API_KEY         = （AnthropicのAPIキー）
ZOOM_BOOKING_URL          = （Zoom予約のURL）
```

---

### 4. LINEのWebhook URLを設定

1. LINE Developers Console → Messaging API設定タブ
2. **Webhook URL** に以下を入力（Railwayで発行したURLを使用）：
   ```
   https://あなたのURL.railway.app/webhook
   ```
3. 「検証」ボタンをクリック → 「成功」と表示されればOK
4. **Webhookの利用** を「オン」にする

---

### 5. ローカルで動作確認（開発時）

```bash
# 依存パッケージをインストール
npm install

# .env ファイルを作成
cp .env.example .env
# .env を編集して各APIキーを入力

# サーバーを起動
npm run dev
```

ローカル開発時は [ngrok](https://ngrok.com/) を使うとLINEのWebhookをローカルに転送できます：

```bash
ngrok http 3000
```

ngrokが発行したURLを `https://xxxx.ngrok.io/webhook` としてLINEに設定してください。

---

## ファイル構成

```
medilife-line-bot/
├── index.js          # メインサーバー（Webhookの受信・Claude連携）
├── package.json      # 依存パッケージの定義
├── .env.example      # 環境変数のテンプレート
├── .env              # 実際のAPIキー（Gitには含めない）
├── .gitignore        # node_modules と .env を除外
└── README.md         # このファイル
```

---

## カスタマイズ

[index.js](index.js) の `SYSTEM_PROMPT` を編集するとClaudeの動作を変更できます。

例：
- 挨拶文を変える
- ヒアリング項目を追加する（職業、家族構成など）
- 特定の相談内容に対して固定のメッセージを返す

---

## 注意事項

- `.env` ファイルはGitHubにアップロードしないでください（`.gitignore` で除外済み）
- 会話履歴はサーバーのメモリに保持されます。サーバー再起動でリセットされます
- 長期運用の場合は、データベース（Railway の PostgreSQL など）への保存を検討してください
