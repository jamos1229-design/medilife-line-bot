require('dotenv').config();
const express = require('express');
const line = require('@line/bot-sdk');
const Anthropic = require('@anthropic-ai/sdk');

// ─── 設定 ────────────────────────────────────────────────────────────────────

const lineConfig = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const lineClient = new line.messagingApi.MessagingApiClient({
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const ZOOM_URL = process.env.ZOOM_BOOKING_URL || process.env['ZOOM予約URL'] || 'https://calendly.com/your-zoom-link';

const SYSTEM_PROMPT = `あなたはFP（ファイナンシャルプランナー）日下幸晴のアシスタントです。
LINEに問い合わせてきた方に、以下の流れで丁寧にヒアリングを進めてください。

【ヒアリングの流れ】
ステップ1: 温かく歓迎の挨拶をする
ステップ2: お名前をお聞きする（まだ名前を聞いていない場合）
ステップ3: 名前を教えていただいたら、ご相談内容をお聞きする
ステップ4: 相談内容を教えていただいたら、Zoom面談の予約リンクを案内する

【Zoom面談予約リンク】
${ZOOM_URL}

【会話のルール】
- 営業色は一切出さず、親しみやすく丁寧な対応をする
- 一度のメッセージで複数の質問をしない（1メッセージ1質問）
- 返答は短く、分かりやすくする（長文にしない）
- 相手の言葉に共感してから次のステップに進む
- Zoom予約リンクを案内する際は「ご都合の良いお時間でご予約いただけます」と一言添える
- すでにお名前や相談内容を聞いた場合は、同じ質問を繰り返さない`;

// ─── 会話履歴（ユーザーIDごとに保持） ────────────────────────────────────────
// キー: LINE userId、値: { messages: [{role, content}], hasName: bool, hasConsult: bool }
const sessions = new Map();

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { messages: [] });
  }
  return sessions.get(userId);
}

// ─── Claude に返答を生成させる ────────────────────────────────────────────────

async function generateReply(userId, userText) {
  const session = getSession(userId);
  session.messages.push({ role: 'user', content: userText });

  // トークン節約のため直近20件のみ使用
  const recentMessages = session.messages.slice(-20);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: recentMessages,
  });

  const replyText = response.content[0].text;
  session.messages.push({ role: 'assistant', content: replyText });

  return replyText;
}

// ─── LINE イベント処理 ────────────────────────────────────────────────────────

async function handleEvent(event) {
  const userId = event.source.userId;

  // 友達追加・ブロック解除時の初回メッセージ
  if (event.type === 'follow') {
    // セッションをリセットしてClaudeに挨拶文を生成させる
    sessions.set(userId, { messages: [] });

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: 'こんにちは' }],
    });
    const greeting = response.content[0].text;
    // 挨拶はセッションに保存して以降の会話につなげる
    sessions.get(userId).messages.push(
      { role: 'user', content: 'こんにちは' },
      { role: 'assistant', content: greeting }
    );

    await lineClient.pushMessage({
      to: userId,
      messages: [{ type: 'text', text: greeting }],
    });
    return;
  }

  // テキストメッセージのみ処理
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const userText = event.message.text.trim();
  if (!userText) return;

  try {
    const replyText = await generateReply(userId, userText);
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: replyText }],
    });
  } catch (err) {
    console.error(`[ERROR] userId=${userId}`, err.message);
    // エラー時はシンプルなメッセージを返す
    await lineClient.replyMessage({
      replyToken: event.replyToken,
      messages: [
        {
          type: 'text',
          text: '申し訳ありません、少し時間をおいて再度メッセージをお送りください。',
        },
      ],
    });
  }
}

// ─── Express サーバー ─────────────────────────────────────────────────────────

const app = express();

// LINE の署名検証ミドルウェア（必須）
app.post('/webhook', line.middleware(lineConfig), (req, res) => {
  res.sendStatus(200); // LINE サーバーに即座に 200 を返す

  // 非同期でイベントを並列処理
  Promise.all(req.body.events.map(handleEvent)).catch((err) => {
    console.error('[ERROR] event processing:', err.message);
  });
});

// ヘルスチェック用（Railway / Render のデプロイ確認に使用）
app.get('/', (_, res) => {
  res.json({ status: 'ok', service: 'MEDiLIFE LINE Bot' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ MEDiLIFE LINE Bot が起動しました (port ${PORT})`);
});

// ─── Instagram 自動投稿スケジューラー起動 ─────────────────────────────────────
require('./instagram-poster');
