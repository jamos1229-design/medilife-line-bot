'use strict';

/**
 * instagram-poster.js
 * ─────────────────────────────────────────────────────────────────────────────
 * MEDiLIFE DESIGN Instagram 自動投稿モジュール
 *
 * 機能概要:
 *   - node-cron で毎朝9:00（日本時間）に自動実行
 *   - Claude API (claude-sonnet-4-6) でトピックをランダム選択してキャプション生成
 *   - Facebook Graph API v19.0 経由で Instagram に画像投稿
 *
 * 環境変数（.env に設定が必要）:
 *   ANTHROPIC_API_KEY           - Anthropic API キー
 *   INSTAGRAM_USER_ID           - Instagram ビジネスアカウントのユーザーID
 *   FACEBOOK_PAGE_ACCESS_TOKEN  - Facebook ページアクセストークン
 *   DEFAULT_IMAGE_URL           - 投稿に使うデフォルト画像URL（ブランドバナーなど）
 * ─────────────────────────────────────────────────────────────────────────────
 */

require('dotenv').config();
const cron = require('node-cron');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

// ─── 定数・設定 ───────────────────────────────────────────────────────────────

/** Facebook Graph API のバージョン */
const GRAPH_API_VERSION = 'v19.0';

/** Facebook Graph API のベースURL */
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

/**
 * 投稿トピック一覧
 * 毎日ランダムに1つ選ばれ、Claude がキャプションを生成する
 */
const TOPICS = [
  '勤務医の開業準備',
  '医師の資産形成',
  '保険の見直し',
  '老後の資金計画',
  '医師のライフプランニング',
  '開業後の資金繰り',
  '医師の節税対策',
];

/**
 * Claude へのシステムプロンプト
 * Instagram キャプション生成のルールを定義する
 */
const CAPTION_SYSTEM_PROMPT = `あなたはMEDiLIFE DESIGNのInstagram投稿担当ライターです。
医師・勤務医向けのファイナンシャルプランニングに特化したアカウントとして、
プロフェッショナルかつ親しみやすいキャプションを作成してください。

【投稿フォーマット（厳守）】
1行目: 絵文字1〜2個 + キャッチコピー（20文字以内）
空行
本文: 指定トピックに関する有益な情報（150文字以内）
空行
ハッシュタグ: 必ず以下の5つを含める
#MEDiLIFEDESIGN #医師のライフプラン #勤務医 #FP相談 #ファイナンシャルプランナー

【注意事項】
- 医師の日常に寄り添う、温かみのある文体にする
- 専門用語は使いすぎず、分かりやすい言葉を選ぶ
- 読者の行動を促す前向きなメッセージにする
- 本文は必ず150文字以内に収める
- フォーマット以外の余計な説明や前置きは一切不要`;

// ─── Anthropic クライアント初期化 ────────────────────────────────────────────

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ─── ユーティリティ関数 ───────────────────────────────────────────────────────

/**
 * 配列からランダムに1要素を取得する
 * @param {Array} arr - 対象配列
 * @returns {*} ランダムな要素
 */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * 指定ミリ秒だけ待機する（非同期スリープ）
 * @param {number} ms - 待機ミリ秒数
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 現在の日本時間を "YYYY-MM-DD HH:mm:ss JST" 形式で返す
 * @returns {string} 日本時間の文字列
 */
function nowJST() {
  return new Date().toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }) + ' JST';
}

// ─── Claude API: キャプション生成 ────────────────────────────────────────────

/**
 * Claude API を使って Instagram キャプションを生成する
 * @param {string} topic - 投稿トピック（例: "医師の資産形成"）
 * @returns {Promise<string>} 生成されたキャプション文字列
 */
async function generateCaption(topic) {
  console.log(`[Instagram投稿] Claude API でキャプションを生成中... トピック: ${topic}`);

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: CAPTION_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `今日のトピック「${topic}」についてInstagram投稿のキャプションを作成してください。`,
      },
    ],
  });

  const caption = response.content[0].text.trim();
  console.log(`[Instagram投稿] キャプション生成完了 (${caption.length}文字)`);
  return caption;
}

// ─── Facebook Graph API: Instagram 投稿 ──────────────────────────────────────

/**
 * Step 1: Instagram メディアコンテナを作成する
 * POST /{ig_user_id}/media
 *
 * @param {string} igUserId          - Instagram ビジネスアカウントのユーザーID
 * @param {string} pageAccessToken   - Facebook ページアクセストークン
 * @param {string} imageUrl          - 投稿する画像のURL（公開アクセス可能なURL）
 * @param {string} caption           - 投稿キャプション
 * @returns {Promise<string>} creation_id（メディアコンテナID）
 */
async function createMediaContainer(igUserId, pageAccessToken, imageUrl, caption) {
  console.log('[Instagram投稿] Step 1: メディアコンテナを作成中...');

  const url = `${GRAPH_API_BASE}/${igUserId}/media`;
  const params = {
    image_url: imageUrl,
    caption: caption,
    access_token: pageAccessToken,
  };

  const response = await axios.post(url, null, { params });

  if (!response.data || !response.data.id) {
    throw new Error(`メディアコンテナの作成に失敗: レスポンスにIDが含まれていません (${JSON.stringify(response.data)})`);
  }

  const creationId = response.data.id;
  console.log(`[Instagram投稿] Step 1 完了: creation_id = ${creationId}`);
  return creationId;
}

/**
 * Step 2: メディアコンテナを公開する（Instagram に投稿する）
 * POST /{ig_user_id}/media_publish
 *
 * @param {string} igUserId          - Instagram ビジネスアカウントのユーザーID
 * @param {string} pageAccessToken   - Facebook ページアクセストークン
 * @param {string} creationId        - Step 1 で取得したメディアコンテナID
 * @returns {Promise<string>} 公開済みメディアID
 */
async function publishMediaContainer(igUserId, pageAccessToken, creationId) {
  console.log('[Instagram投稿] Step 3: メディアコンテナを公開中...');

  const url = `${GRAPH_API_BASE}/${igUserId}/media_publish`;
  const params = {
    creation_id: creationId,
    access_token: pageAccessToken,
  };

  const response = await axios.post(url, null, { params });

  if (!response.data || !response.data.id) {
    throw new Error(`メディアの公開に失敗: レスポンスにIDが含まれていません (${JSON.stringify(response.data)})`);
  }

  const mediaId = response.data.id;
  console.log(`[Instagram投稿] Step 3 完了: media_id = ${mediaId}`);
  return mediaId;
}

// ─── メイン投稿処理 ───────────────────────────────────────────────────────────

/**
 * Instagram への自動投稿を実行するメイン処理
 * 1. 環境変数チェック
 * 2. ランダムトピック選択
 * 3. Claude API でキャプション生成
 * 4. Facebook Graph API でメディアコンテナ作成
 * 5. 3秒待機（API の推奨インターバル）
 * 6. メディアコンテナを公開（投稿完了）
 *
 * @returns {Promise<void>}
 */
async function postToInstagram() {
  const startTime = nowJST();
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[Instagram投稿] 自動投稿を開始します (${startTime})`);
  console.log('='.repeat(60));

  // ── 環境変数チェック ──
  const igUserId = process.env.INSTAGRAM_USER_ID;
  const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const imageUrl = process.env.DEFAULT_IMAGE_URL;

  const missingVars = [];
  if (!igUserId) missingVars.push('INSTAGRAM_USER_ID');
  if (!pageAccessToken) missingVars.push('FACEBOOK_PAGE_ACCESS_TOKEN');
  if (!imageUrl) missingVars.push('DEFAULT_IMAGE_URL');
  if (!process.env.ANTHROPIC_API_KEY) missingVars.push('ANTHROPIC_API_KEY');

  if (missingVars.length > 0) {
    console.error(`[Instagram投稿] エラー: 以下の環境変数が設定されていません: ${missingVars.join(', ')}`);
    return;
  }

  try {
    // ── ランダムトピック選択 ──
    const topic = pickRandom(TOPICS);
    console.log(`[Instagram投稿] 今日のトピック: 「${topic}」`);

    // ── Step 1: キャプション生成 ──
    const caption = await generateCaption(topic);
    console.log('[Instagram投稿] 生成されたキャプション:');
    console.log('─'.repeat(40));
    console.log(caption);
    console.log('─'.repeat(40));

    // ── Step 2: メディアコンテナ作成 ──
    const creationId = await createMediaContainer(igUserId, pageAccessToken, imageUrl, caption);

    // ── Step 3: 3秒待機（Facebook API の推奨インターバル）──
    console.log('[Instagram投稿] Step 2: 3秒待機中... (API安定化のため)');
    await sleep(3000);

    // ── Step 4: メディア公開 ──
    const mediaId = await publishMediaContainer(igUserId, pageAccessToken, creationId);

    console.log(`\n[Instagram投稿] ✅ 投稿が完了しました！`);
    console.log(`[Instagram投稿] メディアID: ${mediaId}`);
    console.log(`[Instagram投稿] 完了時刻: ${nowJST()}`);

  } catch (error) {
    // ── エラーハンドリング ──
    console.error(`\n[Instagram投稿] ❌ 投稿に失敗しました (${nowJST()})`);

    // Axios のエラーレスポンスは詳細を出力する
    if (error.response) {
      console.error('[Instagram投稿] APIエラーレスポンス:', JSON.stringify(error.response.data, null, 2));
      console.error(`[Instagram投稿] ステータスコード: ${error.response.status}`);
    } else {
      console.error('[Instagram投稿] エラー詳細:', error.message);
    }
  }

  console.log('='.repeat(60) + '\n');
}

// ─── cron スケジュール設定 ────────────────────────────────────────────────────

/**
 * 毎朝 9:00（日本時間 Asia/Tokyo）に postToInstagram を実行する
 *
 * cron 式: "0 9 * * *"
 *   - 分: 0
 *   - 時: 9
 *   - 日: 毎日
 *   - 月: 毎月
 *   - 曜日: 毎曜日
 */
const scheduledTask = cron.schedule(
  '0 9 * * *',
  () => {
    postToInstagram().catch((err) => {
      // スケジューラー自体のキャッチできないエラーをログに記録
      console.error('[Instagram投稿] スケジューラー予期せぬエラー:', err.message);
    });
  },
  {
    scheduled: true,
    timezone: 'Asia/Tokyo',
  }
);

console.log('[Instagram投稿] スケジューラーが起動しました (毎朝9:00 JST に投稿)');

// ─── 外部公開 ────────────────────────────────────────────────────────────────

module.exports = {
  postToInstagram,   // 手動実行・テスト用にエクスポート
  scheduledTask,     // タスクの停止・管理用にエクスポート
};
