// Dot連携：§7 iPhone幅確認（375/390/430px）。ブラウザのビューポート幅テストであり、
// 実機での確認ではない。すべて架空の合成データのみ使用。
const { chromium } = require('playwright');
const fs = require('fs');
const results = [];
function record(label, cond, extra) {
  results.push({ label, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (extra ? ' -- ' + extra : ''));
}
const VENDOR = __dirname + '/vendor';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('https://unpkg.com/react@18/umd/react.production.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(VENDOR + '/react/react.production.min.js') }));
  await context.route('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(VENDOR + '/react-dom/react-dom.production.min.js') }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.goto('http://localhost:8791/nexus.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);

  const noHScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2);
  const noClipped = () => page.evaluate(() => {
    const els = document.querySelectorAll('button, .btn, .chip, .card, input, textarea');
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (r.right > document.documentElement.clientWidth + 2) return false;
    }
    return true;
  });
  const tapSizeOf = async locator => {
    if (await locator.count() === 0) return null;
    const box = await locator.first().boundingBox();
    return box ? box.height : null;
  };
  const closeAllOverlays = async () => {
    for (let i = 0; i < 6; i++) {
      const n = await page.locator('.full-screen').count();
      if (n === 0) break;
      await page.locator('.full-screen button:has-text("← 戻る")').last().click({ force: true }).catch(() => {});
      await page.waitForTimeout(250);
    }
  };

  // ── 合成データ投入：架空タスクW・記憶W（通常）・記憶X（PRIVATE） ──
  await page.evaluate(() => {
    localStorage.setItem('ml_tasks_v1', JSON.stringify([
      { id: 'taskW', title: '架空タスクW：とても長いタスク名を入れて折り返しや横あふれを確認するためのテスト用タスク名', date: '2026-06-01', completed: false }
    ]));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  await page.locator('.nav-item:has-text("記憶")').click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("＋ 記憶する")').click();
  await page.waitForTimeout(250);
  await page.locator('textarea[placeholder*="思ったこと"]').fill('架空の記憶W：家族のことで少し不安を感じた出来事についての長めの記録。iPhone幅確認用。');
  await page.locator('.drawer button:has-text("保存する")').click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("＋ 記憶する")').click();
  await page.waitForTimeout(250);
  await page.locator('textarea[placeholder*="思ったこと"]').fill('架空の記憶X：秘密にしたい内容（PRIVATE表示確認用）');
  await page.locator('button:has-text("▾ カテゴリ・タグ・非公開設定")').click();
  await page.waitForTimeout(200);
  await page.locator('.drawer input[type="checkbox"]').check();
  await page.locator('.drawer button:has-text("保存する")').click();
  await page.waitForTimeout(400);

  // PRIVATEな記憶も一覧で見えるようにしておく（テストの選択操作のため）。
  await page.locator('button:has-text("🔧 絞り込み")').click();
  await page.waitForTimeout(150);
  await page.locator('label:has-text("PRIVATEな記憶の本文も一覧に表示する") input[type=checkbox]').check();
  await page.waitForTimeout(150);

  // ── 事前に一度だけ記憶W→タスクWを関連付けておく（各幅での表示確認用の固定状態を作る）──
  await page.locator('text=架空の記憶W').first().click();
  await page.waitForTimeout(250);
  const confirmBtnHeight = await tapSizeOf(page.locator('button:has-text("🔍 自動判定の候補を確認")'));
  record('PRIVATE候補確認ボタンが表示されていれば押しやすい高さ（28px以上）', confirmBtnHeight === null || confirmBtnHeight >= 28, `height=${confirmBtnHeight}`);
  await page.locator('button:has-text("📌 タスクと関連付ける")').click();
  await page.waitForTimeout(250);
  await page.locator('div.card', { hasText: '架空タスクW' }).locator('button:has-text("選ぶ")').click();
  await page.waitForTimeout(500);
  await closeAllOverlays();

  for (const width of [375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(150);

    // ① 記憶タブ（Dotタスク連携機能のトグル含む）
    await page.locator('.nav-item:has-text("記憶")').click();
    await page.waitForTimeout(250);
    record(`${width}px: 記憶タブ全体で横スクロールなし`, await noHScroll());
    record(`${width}px: Dot連携トグルが画面幅に収まる`, await noClipped());
    const toggleHeight = await tapSizeOf(page.locator('label:has-text("Dotタスク連携機能を使う")'));
    record(`${width}px: Dot連携トグルの行が押しやすい高さ`, toggleHeight === null || toggleHeight >= 20, `height=${toggleHeight}`);

    // ② 記憶詳細（関連タスク表示）
    await page.locator('text=架空の記憶W').first().click();
    await page.waitForTimeout(250);
    record(`${width}px: 記憶詳細（関連タスク表示）で横スクロールなし`, await noHScroll());
    record(`${width}px: 記憶詳細の要素が画面幅に収まる`, await noClipped());
    record(`${width}px: 「Dot用JSONを確認」ボタンが表示される`, await page.locator('button:has-text("📤 Dot用JSONを確認")').count() > 0);

    // ③ Dot用JSON確認画面（action/期限/所要時間→プレビュー→コピー）
    await page.locator('button:has-text("📤 Dot用JSONを確認")').click();
    await page.waitForTimeout(250);
    record(`${width}px: Dot用JSON確認画面（action/期限/所要時間入力）で横スクロールなし`, await noHScroll());
    record(`${width}px: action/タグのチップが画面幅に収まる`, await noClipped());
    await page.locator('button:has-text("プレビューを作成")').click();
    await page.waitForTimeout(250);
    record(`${width}px: JSONプレビューで横スクロールなし`, await noHScroll());
    const copyHeight = await tapSizeOf(page.locator('button:has-text("📋 コピー")'));
    record(`${width}px: コピーボタンが押しやすい高さ`, copyHeight === null || copyHeight >= 28, `height=${copyHeight}`);
    await closeAllOverlays();

    // ④「タスクと関連付ける」画面・新規タスク作成ドロワー（別の未関連記憶で確認）
    await page.locator('.nav-item:has-text("記憶")').click();
    await page.waitForTimeout(200);
    await page.locator('text=架空の記憶X').first().click();
    await page.waitForTimeout(250);
    const linkBtn = page.locator('button:has-text("📌 タスクと関連付ける")');
    if (await linkBtn.count() > 0) {
      await linkBtn.click();
      await page.waitForTimeout(250);
      record(`${width}px: タスクと関連付ける画面で横スクロールなし`, await noHScroll());
      record(`${width}px: 長いタスク名でも画面幅からあふれない`, await noClipped());
      await page.locator('button:has-text("＋ 新しいタスクを作成して関連付ける")').click();
      await page.waitForTimeout(250);
      record(`${width}px: タスク作成ドロワーで横スクロールなし`, await noHScroll());
      await page.keyboard.press('Escape').catch(() => {});
    }
    await closeAllOverlays();

    // ⑤ PRIVATEで止まった状態の画面（AI分析パック選択画面）
    await page.locator('.nav-item:has-text("記憶")').click();
    await page.waitForTimeout(200);
    await page.locator('text=架空の記憶X').first().click();
    await page.waitForTimeout(250);
    await page.locator('button:has-text("🤖 AI分析パックを作る")').click();
    await page.waitForTimeout(250);
    record(`${width}px: PRIVATEで止まった状態の画面で横スクロールなし`, await noHScroll());
    record(`${width}px: PRIVATEブロック表示が画面幅に収まる`, await noClipped());
    await closeAllOverlays();
  }
  await page.setViewportSize({ width: 390, height: 844 });

  record('No page errors occurred', errors.length === 0, errors.join(' | '));
  const failedCount = results.filter(r => !r.pass).length;
  console.log(`\nTOTAL: ${results.length}, PASS: ${results.length - failedCount}, FAIL: ${failedCount}`);
  await browser.close();
  process.exit(failedCount > 0 ? 1 : 0);
})();
