// Dot連携（第1段階）のE2Eテスト。すべて架空の合成データのみ使用。
// commit/push/デプロイ/外部AI送信/Googleカレンダー登録は一切行わない（このテストでも使わない）。
const { chromium } = require('playwright');
const fs = require('fs');
const results = [];
function record(label, cond, extra) {
  results.push({ label, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (extra ? ' -- ' + extra : ''));
}
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const VENDOR = __dirname + '/vendor';
  await context.route('https://unpkg.com/react@18/umd/react.production.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(VENDOR + '/react/react.production.min.js') }));
  await context.route('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(VENDOR + '/react-dom/react-dom.production.min.js') }));
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', err => errors.push('PAGEERROR: ' + err.message));
  await page.goto('http://localhost:8791/nexus.html', { waitUntil: 'load' });
  await page.waitForTimeout(400);

  const openMemoryTab = async () => {
    await page.locator('.nav-item:has-text("記憶")').click();
    await page.waitForTimeout(300);
  };
  const closeIfOpen = async () => {
    const backBtn = page.locator('button:has-text("← 戻る")').last();
    if (await backBtn.count() > 0 && await backBtn.isVisible().catch(() => false)) {
      await backBtn.click();
      await page.waitForTimeout(250);
    }
  };
  const closeAllOverlays = async () => {
    for (let i = 0; i < 8; i++) {
      const fullScreenCount = await page.locator('.full-screen').count();
      if (fullScreenCount === 0) return;
      const backBtn = page.locator('.full-screen button:has-text("← 戻る")').last();
      if (await backBtn.count() > 0) {
        await backBtn.click({ force: true }).catch(() => {});
      } else {
        await page.keyboard.press('Escape').catch(() => {});
      }
      await page.waitForTimeout(300);
    }
  };

  // ── 前提：架空の記憶3件・タスク1件をIndexedDB/localStorageへ直接投入 ──
  await page.evaluate(async () => {
    localStorage.setItem('ml_tasks_v1', JSON.stringify([
      { id: 'taskA', title: '架空タスクA', date: '2026-05-01', completed: false },
      { id: 'taskB', title: '架空タスクB（別記憶に関連付け済み）', date: '2026-05-02', completed: false, sourceMemoryId: 'memOther' }
    ]));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  await openMemoryTab();
  // PRIVATEな記憶も一覧で本文が見えるようにしておく（テストの選択操作のため。デフォルトでは
  // マスクされるのが正しい挙動であり、このテストではそれを確認した上で明示的に解除する）。
  await page.locator('button:has-text("🔧 絞り込み")').click();
  await page.waitForTimeout(200);
  await page.locator('label:has-text("PRIVATEな記憶の本文も一覧に表示する") input[type=checkbox]').check();
  await page.waitForTimeout(200);
  // 通常メモ作成（クイック追加）
  const addMemory = async (content, opts) => {
    await page.locator('button:has-text("＋ 記憶する")').click();
    await page.waitForTimeout(250);
    await page.locator('textarea[placeholder*="思ったこと"]').fill(content);
    if (opts && opts.private) {
      await page.locator('button:has-text("▾ カテゴリ・タグ・非公開設定")').click();
      await page.waitForTimeout(200);
      await page.locator('.drawer input[type="checkbox"]').check();
    }
    await page.locator('.drawer button:has-text("保存する")').click();
    await page.waitForTimeout(400);
  };
  await addMemory('架空の記憶A：来週A社へ提案資料を送る');
  await page.waitForTimeout(200);

  // 直近保存したメモを開く
  const openFirstMemory = async () => {
    await openMemoryTab();
    await page.locator('.card, [class*="memory"]').first().click().catch(() => {});
  };

  // メモ一覧から本文を含むカードをクリックして詳細を開く
  const openMemoryByText = async text => {
    await openMemoryTab();
    await page.waitForTimeout(200);
    await page.locator(`text=${text}`).first().click();
    await page.waitForTimeout(300);
  };

  await openMemoryByText('架空の記憶A');
  record('T1: 記憶詳細に「タスクと関連付ける」ボタンが表示される', await page.locator('button:has-text("📌 タスクと関連付ける")').count() > 0);

  await page.locator('button:has-text("📌 タスクと関連付ける")').click();
  await page.waitForTimeout(300);
  record('T2: 関連付け画面が開く', await page.locator('text=既存のタスクから選ぶ').count() > 0);
  record('T3: 既存タスクAが候補に表示される', await page.locator('text=架空タスクA').count() > 0);

  // 既に別記憶に関連付け済みのタスクBを選ぶとブロックされる
  const taskBRow = page.locator('div.card', { hasText: '架空タスクB' });
  await taskBRow.locator('button:has-text("選ぶ")').click();
  await page.waitForTimeout(200);
  record('T4: 別の記憶に関連付け済みのタスクは選べず理由が表示される', await page.locator('text=別の記憶と関連付けられている').count() > 0);

  // タスクAを選ぶ
  const taskARow = page.locator('div.card', { hasText: '架空タスクA' });
  await taskARow.locator('button:has-text("選ぶ")').click();
  await page.waitForTimeout(500);
  record('T5: 関連付け後、記憶詳細に戻り関連タスクが表示される', await page.locator('text=関連タスク：架空タスクA').count() > 0);

  // 再度「タスクと関連付ける」導線は出ず、Dot出力・解除ボタンが出る
  record('T6: 関連付け済みなら「Dot用JSONを確認」ボタンが出る', await page.locator('button:has-text("📤 Dot用JSONを確認")').count() > 0);

  // 同じ記憶で同じタスクへ再度リンクしても重複しないことの確認（内部状態の冪等性）。
  // 再度リンク操作をするUIがないため、タスク一覧(localStorage)側で重複タスクが増えていないことを検証。
  const taskCountAfterLink = await page.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]').length);
  record('T7: 関連付け操作でタスクが重複作成されていない（2件のまま）', taskCountAfterLink === 2, `count=${taskCountAfterLink}`);

  // ── Dot用JSON：PRIVATEでない記憶なら生成・コピーできる ──
  await page.locator('button:has-text("📤 Dot用JSONを確認")').click();
  await page.waitForTimeout(300);
  record('T8: Dot用JSON確認画面が開く', await page.locator('text=Dot用JSONを確認').count() > 0);
  await page.locator('button:has-text("プレビューを作成")').click();
  await page.waitForTimeout(300);
  const previewText = await page.locator('textarea[readonly]').first().inputValue().catch(() => '');
  let previewJson = null;
  try { previewJson = JSON.parse(previewText); } catch (e) {}
  record('T9: 非PRIVATE記憶ならプレビューJSONが生成される', !!previewJson, previewText.slice(0, 80));
  if (previewJson) {
    const allowedKeys = ['schemaVersion', 'memoryRefId', 'taskRefId', 'sourceRevision', 'taskRevision', 'action', 'actionBasis', 'status', 'statusBasis', 'dueDate', 'dueDateBasis', 'durationMinutes', 'durationBasis', 'timezone', 'tags', 'tagsBasis'];
    const extraKeys = Object.keys(previewJson).filter(k => !allowedKeys.includes(k));
    record('T10: 生成されたJSONに許可リスト外のキーが無い', extraKeys.length === 0, JSON.stringify(extraKeys));
    record('T11: 本文・氏名等の生テキストが含まれていない（タスク名も含まれない）', !JSON.stringify(previewJson).includes('架空タスクA') && !JSON.stringify(previewJson).includes('架空の記憶A'));
    // taskAはkind指定の無い単純タスク（date=2026-05-01）のため、確定している既存日付はdueDateに出てよい。
    record('T12: 単純な既存期限はdueDateとして出力される（自動生成ではなく既存値そのまま）', previewJson.dueDate === '2026-05-01' && previewJson.dueDateBasis === 'existing_explicit' && previewJson.timezone === 'Asia/Tokyo');
    record('T13: durationMinutes未入力ならnull（30分等を自動で入れない）', previewJson.durationMinutes === null);
  }
  await closeAllOverlays();

  // ── §5 PRIVATE安全ガード：PRIVATEな記憶はDot出力をブロック ──
  await openMemoryTab();
  await addMemory('架空の記憶B：個人的な健康相談の内容', { private: true });
  await page.waitForTimeout(300);
  await openMemoryByText('架空の記憶B');
  await page.locator('button:has-text("📌 タスクと関連付ける")').click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("＋ 新しいタスクを作成して関連付ける")').click();
  await page.waitForTimeout(300);
  const taskFormArea = page.locator('.drawer').last();
  await taskFormArea.locator('input.form-input').first().fill('架空タスクC（PRIVATE記憶用）');
  await taskFormArea.locator('button:has-text("保存")').click();
  await page.waitForTimeout(500);
  record('T14: PRIVATE記憶でも新規タスク作成→関連付け自体は可能', await page.locator('text=関連タスク：架空タスクC').count() > 0);
  await page.locator('button:has-text("📤 Dot用JSONを確認")').click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("プレビューを作成")').click();
  await page.waitForTimeout(300);
  record('T15: PRIVATE記憶はプレビューがブロックされJSONが表示されない', await page.locator('textarea[readonly]').count() === 0);
  record('T16: ブロック理由（PRIVATE）がトーストで示される', await page.locator('text=PRIVATE').count() > 0);
  await closeAllOverlays();

  // ── §9 連打防止：同じタスクへの「選ぶ」を連打しても1回分の関連付けにしかならない ──
  await openMemoryTab();
  await addMemory('架空の記憶D：連打テスト用');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const tasks = JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]');
    tasks.push({ id: 'taskRapid', title: '架空タスクRapid', date: '2026-05-05', completed: false });
    localStorage.setItem('ml_tasks_v1', JSON.stringify(tasks));
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(500);
  await openMemoryByText('架空の記憶D');
  await page.locator('button:has-text("📌 タスクと関連付ける")').click();
  await page.waitForTimeout(300);
  const rapidRow = page.locator('div.card', { hasText: '架空タスクRapid' });
  const rapidBtn = rapidRow.locator('button:has-text("選ぶ")');
  await Promise.all([rapidBtn.click(), rapidBtn.click().catch(() => {}), rapidBtn.click().catch(() => {})]);
  await page.waitForTimeout(600);
  const taskCountAfterRapid = await page.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]').length);
  record('T17: 連打しても既存タスクが重複作成されない', taskCountAfterRapid === 4, `count=${taskCountAfterRapid}`); // taskA,B,C,Rapid
  await closeAllOverlays();

  // ── §14 機能フラグ：Dotタスク連携を停止すると新UIが消えるが、既存の関連付け情報は保持される ──
  await openMemoryTab();
  const toggle = page.locator('label:has-text("Dotタスク連携機能を使う") input[type=checkbox]');
  record('T18: Dot連携の機能フラグ切替が記憶タブに表示される', await toggle.count() > 0);
  await toggle.uncheck();
  await page.waitForTimeout(300);
  await openMemoryByText('架空の記憶A');
  record('T19: フラグOFFだと「タスク連携（Dot）」セクションが表示されない', await page.locator('text=タスク連携（Dot）').count() === 0);
  await closeAllOverlays();
  const linkedTaskIdsStillThere = await page.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]').some(t => t.sourceMemoryId));
  record('T20: フラグOFFでも既存の関連付けデータ自体は消えていない', linkedTaskIdsStillThere);
  await openMemoryTab();
  await page.locator('label:has-text("Dotタスク連携機能を使う") input[type=checkbox]').check();
  await page.waitForTimeout(300);

  // ── 既存AIパックの安全ガード強化：PRIVATE記憶を選ぶと「次へ」がブロックされる ──
  await openMemoryByText('架空の記憶B');
  await page.locator('button:has-text("🤖 AI分析パックを作る")').click();
  await page.waitForTimeout(300);
  const nextBtn = page.locator('button:has-text("次へ（匿名化する）")');
  record('T21: PRIVATE記憶を含むAIパック選択画面では「次へ」が無効化される', await nextBtn.isDisabled());
  record('T22: ブロック理由の文言が表示される', await page.locator('text=PRIVATE設定のため出力できません').count() > 0);
  await closeAllOverlays();

  // ── AI Insight保存：PRIVATEな元記憶から保存すると自動でisPrivate=trueになる ──
  await openMemoryByText('架空の記憶B');
  await page.locator('button:has-text("🤖 AI分析パックを作る")').click();
  await page.waitForTimeout(300);
  // PRIVATEだが「AI Insightを保存する」導線はprompt stepのボタンなので、まずconfirmedRiskを超えられないため
  // select stepのまま「🧠 AI Insightを保存する」は無い。MemoryTab側の汎用ボタンを使う。
  await closeAllOverlays();
  await openMemoryTab();
  await page.locator('button:has-text("🧠 AI Insightを保存する")').click();
  await page.waitForTimeout(300);
  record('T23: 関連記憶が無い状態ではPRIVATE継承の注記は出ない', await page.locator('text=このAI Insightも自動的にPRIVATEとして保存').count() === 0);
  await closeAllOverlays();

  // ── §5 PRIVATE候補の誤検知を解除できる（「🔍 自動判定の候補を確認：この内容はPRIVATEに該当しない」） ──
  await openMemoryTab();
  await addMemory('架空の記憶E：家族の不安について相談された（誤検知を想定した本文）');
  await page.waitForTimeout(300);
  await openMemoryByText('架空の記憶E');
  record('T25: ヒューリスティックでPRIVATE候補として検出される', await page.locator('text=PRIVATE候補').count() > 0);
  await page.locator('button:has-text("📌 タスクと関連付ける")').click();
  await page.waitForTimeout(300);
  record('T26: 未確認のPRIVATE候補のままではDot連携画面でも関連付け自体は妨げない（出力のみ止める）', await page.locator('text=既存のタスクから選ぶ').count() > 0);
  await page.locator('button:has-text("← 戻る")').last().click();
  await page.waitForTimeout(300);
  await page.locator('button:has-text("🔍 自動判定の候補を確認：この内容はPRIVATEに該当しない")').first().click();
  await page.waitForTimeout(300);
  record('T27: 確認済みにするとPRIVATE候補の表示が消える', await page.locator('text=PRIVATE候補').count() === 0);
  await page.locator('button:has-text("🤖 AI分析パックを作る")').click();
  await page.waitForTimeout(300);
  record('T28: 確認済みにすればAI分析パックの「次へ」が有効化される（誤検知のまま永久ブロックしない）', await page.locator('button:has-text("次へ（匿名化する）")').isEnabled());
  await closeAllOverlays();

  // ── iPhone幅での表示確認（375/390/430px、横スクロールが出ないこと） ──
  for (const width of [375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 });
    await openMemoryByText('架空の記憶A');
    await page.locator('button:has-text("📤 Dot用JSONを確認")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("プレビューを作成")').click();
    await page.waitForTimeout(300);
    const hasHScroll = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    record(`T24-${width}: Dot出力画面が${width}px幅で横スクロールなし`, !hasHScroll);
    await closeAllOverlays();
  }
  await page.setViewportSize({ width: 390, height: 844 });

  record('No page errors occurred', errors.length === 0, errors.join(' | '));

  const failedCount = results.filter(r => !r.pass).length;
  console.log(`\nTOTAL: ${results.length}, PASS: ${results.length - failedCount}, FAIL: ${failedCount}`);
  await browser.close();
  process.exit(failedCount > 0 ? 1 : 0);
})();
