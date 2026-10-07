// 神メモ第2段階（記憶→dot相談→既存タスクへの反映）のE2Eテスト。すべて架空の合成データのみ使用。
// commit/push/デプロイ/外部AI送信/Googleカレンダー登録は一切行わない（このテストでも使わない）。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const results = [];
function record(label, cond, extra) {
  results.push({ label, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (extra !== undefined ? ' -- ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
}
const VENDOR = path.join(__dirname, '..', 'dot-bridge', 'vendor');

async function newPage(browser, viewport, opts) {
  const context = await browser.newContext({ viewport: viewport || { width: 390, height: 844 } });
  if (opts && opts.clipboard) {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  }
  await context.route('https://unpkg.com/react@18/umd/react.production.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(VENDOR, 'react', 'react.production.min.js')) }));
  await context.route('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(VENDOR, 'react-dom', 'react-dom.production.min.js')) }));
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  return { context, page, pageErrors };
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });

  const openMemoryTab = async page => {
    await page.locator('.nav-item:has-text("記憶")').click();
    await page.waitForTimeout(300);
  };
  const closeAllOverlays = async page => {
    for (let i = 0; i < 8; i++) {
      const fullScreenCount = await page.locator('.full-screen').count();
      if (fullScreenCount === 0) return;
      const backBtn = page.locator('.full-screen button:has-text("← 戻る")').last();
      if (await backBtn.count() > 0) {
        await backBtn.click({ force: true }).catch(() => {});
      } else {
        await page.keyboard.press('Escape').catch(() => {});
      }
      await page.waitForTimeout(250);
    }
  };
  const addMemory = async (page, content, opts) => {
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
  const openMemoryByText = async (page, text) => {
    await openMemoryTab(page);
    await page.waitForTimeout(200);
    await page.locator(`text=${text}`).first().click();
    await page.waitForTimeout(300);
  };
  const linkToExistingTask = async (page, taskTitleSubstring) => {
    await page.locator('button:has-text("📌 タスクと関連付ける")').click();
    await page.waitForTimeout(300);
    const row = page.locator('div.card', { hasText: taskTitleSubstring });
    await row.locator('button:has-text("選ぶ")').click();
    await page.waitForTimeout(500);
  };
  const readDotRequests = page => page.evaluate(() => JSON.parse(localStorage.getItem('ml_dot_requests_v1') || '[]'));
  const readTasks = page => page.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]'));

  // ════════════════════════════════════════════════════════════
  // ⓪基本往復：相談作成→コピー→回答取込→採用→既存タスクへの反映（spec例に準拠）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page, pageErrors } = await newPage(browser, null, { clipboard: true });
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([
        { id: 'taskZero', title: '架空タスク0（面談準備）', date: '2026-11-01', completed: false, dotAction: 'customer_followup', dotDurationMinutes: 20, dotTags: ['follow_up'] }
      ]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶0：提案済みの案件について、次回面談の準備を進めたい');
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶0');
    await linkToExistingTask(page, '架空タスク0');
    record('⓪-1: 関連付け後、Dotへ相談するボタンが出る', await page.locator('button:has-text("🤝 Dotへ相談する")').count() > 0);
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    record('⓪-2: 相談画面が開く', await page.locator('text=Dotへ相談する').count() > 0);

    await page.locator('textarea[placeholder*="相談（"]').fill('提案済みの案件について、次回面談の準備を20分で進めたい');
    await page.locator('textarea[placeholder*="未来の意図"]').fill('お客さまが納得して判断できる状態にする');
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    record('⓪-3: 依頼JSONが表示される', await page.locator('pre').count() > 0);

    // 実際に「📋 依頼とDotへの回答指示をコピー」を押し、ブラウザのクリップボードへ
    // 本当に書き込まれた内容を読み出す（report上の省略ではなく、実際の出力そのものを検証する）。
    await page.locator('button:has-text("📋 依頼とDotへの回答指示をコピー")').click();
    await page.waitForTimeout(300);
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    record('⓪-3b: コピー内容に回答形式の固定指示（型・許可値・文字数）が含まれる', clipboardText.includes('schemaVersion: 2固定') && clipboardText.includes('1〜80文字') && clipboardText.includes('1〜480の整数'));
    record('⓪-3c: コピー内容にIDをそのまま変更しない指示が含まれる', clipboardText.includes('そのまま変更せずに使用'));
    record('⓪-3d: コピー内容に完全な回答JSON例が含まれる', clipboardText.includes('■回答JSONの例'));

    const requestsAfterCreate = await readDotRequests(page);
    record('⓪-4: 依頼が1件、localStorageに保存される', requestsAfterCreate.length === 1, requestsAfterCreate.length);
    const reqRecord = requestsAfterCreate[0];
    record('⓪-5: 依頼のsourceに確認済みの行動・所要時間・期限が含まれる', reqRecord.source.action === 'customer_followup' && reqRecord.source.durationMinutes === 20 && reqRecord.source.dueDate === '2026-11-01');

    // コピー内容（実際のクリップボード文字列）から、依頼JSON部分そのものを取り出して
    // 参照ID・版番号が実際に省略なく一致していることを確認する（報告書の「…」は報告上の
    // 省略であり、実際の出力が省略されていないことをここで検証する）。
    const requestJsonBlockMatch = clipboardText.match(/■依頼JSON\n([\s\S]*?)\n\n■回答JSONの例/);
    const copiedRequestJson = requestJsonBlockMatch ? JSON.parse(requestJsonBlockMatch[1]) : null;
    record('⓪-5b: コピー内容に含まれる依頼JSONの参照ID・版番号が実際の記録と完全一致する（省略なし）', !!copiedRequestJson && copiedRequestJson.source.memoryRefId === reqRecord.source.memoryRefId && copiedRequestJson.source.taskRefId === reqRecord.source.taskRefId && copiedRequestJson.source.sourceRevision === reqRecord.source.sourceRevision && copiedRequestJson.source.taskRevision === reqRecord.source.taskRevision && copiedRequestJson.requestId === reqRecord.requestId, copiedRequestJson);

    // 実在のenum値（NEXUS_DOT_ACTION_VALUES等）だけを使い、架空の値は使わない。
    // factsは「確認済みフィールドの参照（フィールド名）」のみで、値は一切渡さない。
    const response = {
      schemaVersion: 2, type: 'dot_response', requestId: copiedRequestJson.requestId,
      memoryRefId: copiedRequestJson.source.memoryRefId, taskRefId: copiedRequestJson.source.taskRefId,
      sourceRevision: copiedRequestJson.source.sourceRevision, taskRevision: copiedRequestJson.source.taskRevision,
      facts: ['durationMinutes', 'action', 'dueDate', 'tags', 'status'],
      unknowns: [],
      options: [],
      nextStep: { title: '前回の未確認事項を3点に整理する', durationMinutes: 15, dueDate: '2026-11-01', reason: '次回面談で判断に必要な情報をそろえるため' },
      futureLink: 'お客さまが自分で比較検討できる資料を用意する'
    };
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(JSON.stringify(response));
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(400);
    record('⓪-6: 次の行動（提案）が表示される', await page.locator('text=前回の未確認事項を3点に整理する').count() > 0);
    record('⓪-7a: 所要時間のfactsはNEXUS側の値（20分）が表示される', await page.locator('text=所要時間（分）：20').count() > 0);
    record('⓪-7b: 行動（action）のfactsもNEXUS側の値が表示される', await page.locator('text=行動（action）：customer_followup').count() > 0);
    record('⓪-7c: 期限（dueDate）のfactsもNEXUS側の値が表示される', await page.locator('text=期限（dueDate）：2026-11-01').count() > 0);
    record('⓪-7d: タグのfactsもNEXUS側の値が表示される', await page.locator('text=タグ：follow_up').count() > 0);

    await page.locator('div.card', { hasText: '前回の未確認事項を3点に整理する' }).locator('button:has-text("この案を採用する")').click();
    await page.waitForTimeout(400);
    record('⓪-8: 採用済みバッジが表示される', await page.locator('text=採用済み').count() > 0);

    const tasksAfterApply = await readTasks(page);
    const updatedTask = tasksAfterApply.find(t => t.id === 'taskZero');
    record('⓪-9: タスクのタイトルが採用した内容に更新される', updatedTask.title === '前回の未確認事項を3点に整理する', updatedTask);
    record('⓪-10: 所要時間（dotDurationMinutes）が15分に更新される', updatedTask.dotDurationMinutes === 15);
    record('⓪-11: 期限（date）が2026-11-01に更新される', updatedTask.date === '2026-11-01');

    record('No page errors during basic round-trip', pageErrors.length === 0, pageErrors.join(' | '));
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ①PRIVATEな記憶は相談の作成自体をブロックする
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskPriv', title: '架空タスク（PRIVATE用）', date: null, completed: false }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶1：個人的な健康相談の内容', { private: true });
    await page.waitForTimeout(200);
    await page.locator('button:has-text("🔧 絞り込み")').click();
    await page.waitForTimeout(200);
    await page.locator('label:has-text("PRIVATEな記憶の本文も一覧に表示する") input[type=checkbox]').check();
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶1');
    await linkToExistingTask(page, '架空タスク（PRIVATE用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    record('①-1: PRIVATE記憶では依頼が作成されない（JSONが表示されない）', await page.locator('pre').count() === 0);
    record('①-2: PRIVATEを理由にブロックされたことがトーストで示される', await page.locator('text=PRIVATE').count() > 0);
    const requests = await readDotRequests(page);
    record('①-3: 依頼がlocalStorageにも作られていない', requests.length === 0, requests.length);
    await closeAllOverlays(page);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ②不正JSON（パースエラー）は取り込まない
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskBadJson', title: '架空タスク（不正JSON用）', date: null, completed: false }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶2：不正JSONテスト用');
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶2');
    await linkToExistingTask(page, '架空タスク（不正JSON用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill('{not valid json');
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(300);
    record('②-1: 不正JSONはJSONとして読み取れない旨が表示される', await page.locator('text=JSONとして読み取れませんでした').count() > 0);
    const requests = await readDotRequests(page);
    record('②-2: 依頼のstatusはawaiting_responseのまま', requests[0].status === 'awaiting_response', requests[0] && requests[0].status);
    await closeAllOverlays(page);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ③基準が変わった後の古い回答は拒否する（taskRevision不一致）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskStale', title: '架空タスク（版不一致用）', date: null, completed: false, dotDurationMinutes: 10 }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶3：版不一致テスト用');
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶3');
    await linkToExistingTask(page, '架空タスク（版不一致用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    const staleRecord = (await readDotRequests(page))[0];
    const staleTaskRevision = staleRecord.source.taskRevision;

    // タスクの内容を変更してから、もう一度「依頼を更新する」を押す＝版が変わる。
    await page.evaluate(() => {
      const tasks = JSON.parse(localStorage.getItem('ml_tasks_v1'));
      localStorage.setItem('ml_tasks_v1', JSON.stringify(tasks.map(t => t.id === 'taskStale' ? { ...t, dotDurationMinutes: 45 } : t)));
    });
    await page.locator('button:has-text("依頼を更新する")').click();
    await page.waitForTimeout(400);
    const freshRecord = (await readDotRequests(page))[0];
    record('③-1: 依頼を更新すると版（taskRevision）が変わる', freshRecord.source.taskRevision !== staleTaskRevision, { stale: staleTaskRevision, fresh: freshRecord.source.taskRevision });

    const staleResponse = {
      schemaVersion: 2, type: 'dot_response', requestId: freshRecord.requestId,
      memoryRefId: freshRecord.source.memoryRefId, taskRefId: freshRecord.source.taskRefId,
      sourceRevision: freshRecord.source.sourceRevision, taskRevision: staleTaskRevision,
      facts: [], unknowns: [], options: [], nextStep: null, futureLink: null
    };
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(JSON.stringify(staleResponse));
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(300);
    record('③-2: 古い版の回答は拒否され、形式エラーのヒントが表示される', await page.locator('text=回答の形式が許可された内容と一致しません').count() > 0);
    await closeAllOverlays(page);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ④保留→後から採用できる（キャンセル・保留）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskHold', title: '架空タスク（保留用）', date: null, completed: false }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶4：保留テスト用');
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶4');
    await linkToExistingTask(page, '架空タスク（保留用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    const rec = (await readDotRequests(page))[0];
    const resp = { schemaVersion: 2, type: 'dot_response', requestId: rec.requestId, memoryRefId: rec.source.memoryRefId, taskRefId: rec.source.taskRefId, sourceRevision: rec.source.sourceRevision, taskRevision: rec.source.taskRevision, facts: [], unknowns: [], options: [], nextStep: { title: '保留テスト用の行動', durationMinutes: null, dueDate: null, reason: 'テスト用の理由' }, futureLink: null };
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(JSON.stringify(resp));
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(400);
    await page.locator('button:has-text("今回は保留する")').click();
    await page.waitForTimeout(400);
    record('④-1: 保留中バッジが表示される', await page.locator('text=保留中').count() > 0);
    let tasks = await readTasks(page);
    record('④-2: 保留した時点ではタスクは変更されていない', tasks.find(t => t.id === 'taskHold').title === '架空タスク（保留用）');

    // 保留から後で採用する
    await page.locator('div.card', { hasText: '保留テスト用の行動' }).locator('button:has-text("この案を採用する")').click();
    await page.waitForTimeout(400);
    record('④-3: 保留から後で採用できる', await page.locator('text=採用済み').count() > 0);
    tasks = await readTasks(page);
    record('④-4: 採用後にタスクのタイトルが更新される', tasks.find(t => t.id === 'taskHold').title === '保留テスト用の行動');
    await closeAllOverlays(page);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑤再取込・連打：同じ回答の再取込は重複させず、別内容での上書きは拒否する
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskDup', title: '架空タスク（重複用）', date: null, completed: false }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶5：重複取込テスト用');
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶5');
    await linkToExistingTask(page, '架空タスク（重複用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    const rec = (await readDotRequests(page))[0];
    const resp = { schemaVersion: 2, type: 'dot_response', requestId: rec.requestId, memoryRefId: rec.source.memoryRefId, taskRefId: rec.source.taskRefId, sourceRevision: rec.source.sourceRevision, taskRevision: rec.source.taskRevision, facts: [], unknowns: [], options: [], nextStep: null, futureLink: null };
    const respJson = JSON.stringify(resp);
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(respJson);
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(400);
    let requestsAfter1 = await readDotRequests(page);
    record('⑤-1: 1回目の取込で応答が保存される', requestsAfter1[0].status === 'response_received');

    // 同じ内容を再度貼り付けて取り込む（画面を開き直して再現）
    await closeAllOverlays(page);
    await openMemoryByText(page, '架空の記憶5');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(respJson);
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(400);
    record('⑤-2: 同じ内容の再取込はエラーにならず取り込み済みと案内される', await page.locator('text=取り込み済みです').count() > 0);
    const requestsAfter2 = await readDotRequests(page);
    record('⑤-3: 再取込で依頼が増えていない（1件のまま）', requestsAfter2.length === 1, requestsAfter2.length);

    // 別内容の回答は拒否される
    const respDifferent = { ...resp, nextStep: { title: '別の提案', durationMinutes: null, dueDate: null, reason: 'x' } };
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(JSON.stringify(respDifferent));
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(400);
    record('⑤-4: 同じ依頼IDで別内容の回答は拒否される', await page.locator('text=別の回答が取り込まれています').count() > 0);
    await closeAllOverlays(page);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑥保存障害：タスクへの保存に失敗した場合、成功表示をせず採用済みにしない
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskFail', title: '架空タスク（保存障害用）', date: null, completed: false }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶6：保存障害テスト用');
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶6');
    await linkToExistingTask(page, '架空タスク（保存障害用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    const rec = (await readDotRequests(page))[0];
    const resp = { schemaVersion: 2, type: 'dot_response', requestId: rec.requestId, memoryRefId: rec.source.memoryRefId, taskRefId: rec.source.taskRefId, sourceRevision: rec.source.sourceRevision, taskRevision: rec.source.taskRevision, facts: [], unknowns: [], options: [], nextStep: { title: '保存障害時の行動', durationMinutes: null, dueDate: null, reason: 'x' }, futureLink: null };
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(JSON.stringify(resp));
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(400);

    // ml_tasks_v1への書込だけ1回失敗させる（他のキーは影響しない）。
    await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      let failedOnce = false;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'ml_tasks_v1' && !failedOnce) {
          failedOnce = true;
          throw new Error('synthetic failure');
        }
        return orig.call(this, key, value);
      };
    });
    await page.locator('div.card', { hasText: '保存障害時の行動' }).locator('button:has-text("この案を採用する")').click();
    await page.waitForTimeout(400);
    record('⑥-1: 保存失敗時は成功表示をしない', await page.locator('text=採用済み').count() === 0);
    record('⑥-2: 保存に失敗した旨が表示される', await page.locator('text=保存に失敗しました').count() > 0);
    let tasks = await readTasks(page);
    record('⑥-3: タスクは変更されていない', tasks.find(t => t.id === 'taskFail').title === '架空タスク（保存障害用）');
    let requestsAfterFail = await readDotRequests(page);
    record('⑥-4: 依頼もapplied扱いになっていない', requestsAfterFail[0].status === 'response_received', requestsAfterFail[0].status);

    // 同じ採用操作をもう一度行うと、今度は成功する（タスクが重複して変わることはない）。
    await page.locator('div.card', { hasText: '保存障害時の行動' }).locator('button:has-text("この案を採用する")').click();
    await page.waitForTimeout(400);
    record('⑥-5: 再試行すると成功する', await page.locator('text=採用済み').count() > 0);
    tasks = await readTasks(page);
    record('⑥-6: 再試行後はタスクが正しく更新される', tasks.find(t => t.id === 'taskFail').title === '保存障害時の行動');
    await closeAllOverlays(page);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑦別タブでの変更：採用時に、応答受領後の別タブでの変更を上書きしない
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskOtherTab', title: '架空タスク（別タブ用）', date: null, completed: false, customerId: 'cust_keep_me' }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶7：別タブ変更テスト用');
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶7');
    await linkToExistingTask(page, '架空タスク（別タブ用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    const rec = (await readDotRequests(page))[0];
    const resp = { schemaVersion: 2, type: 'dot_response', requestId: rec.requestId, memoryRefId: rec.source.memoryRefId, taskRefId: rec.source.taskRefId, sourceRevision: rec.source.sourceRevision, taskRevision: rec.source.taskRevision, facts: [], unknowns: [], options: [], nextStep: { title: '別タブ変更後の採用', durationMinutes: 30, dueDate: null, reason: 'x' }, futureLink: null };
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(JSON.stringify(resp));
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(400);

    // 「別タブ」での変更を模擬：customerIdを書き換える（画面はまだ知らない）。
    await page.evaluate(() => {
      const tasks = JSON.parse(localStorage.getItem('ml_tasks_v1'));
      localStorage.setItem('ml_tasks_v1', JSON.stringify(tasks.map(t => t.id === 'taskOtherTab' ? { ...t, customerId: 'cust_changed_elsewhere' } : t)));
    });
    await page.locator('div.card', { hasText: '別タブ変更後の採用' }).locator('button:has-text("この案を採用する")').click();
    await page.waitForTimeout(400);
    const tasks = await readTasks(page);
    const updated = tasks.find(t => t.id === 'taskOtherTab');
    record('⑦-1: 別タブでの変更（customerId）が保持される', updated.customerId === 'cust_changed_elsewhere', updated);
    record('⑦-2: それでも採用した内容（title・所要時間）は正しく反映される', updated.title === '別タブ変更後の採用' && updated.dotDurationMinutes === 30);
    await closeAllOverlays(page);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑧連携OFF・再開：OFFにすると画面が消えるが既存データは保持。再開後は再確認できる
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskOff', title: '架空タスク（OFF用）', date: null, completed: false }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶8：連携OFFテスト用');
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶8');
    await linkToExistingTask(page, '架空タスク（OFF用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    const beforeOff = await readDotRequests(page);
    record('⑧-1: OFFにする前に依頼が1件ある', beforeOff.length === 1);
    await closeAllOverlays(page);

    await openMemoryTab(page);
    await page.locator('label:has-text("Dotタスク連携機能を使う") input[type=checkbox]').uncheck();
    await page.waitForTimeout(300);
    await openMemoryByText(page, '架空の記憶8');
    record('⑧-2: OFFだと「Dotへ相談する」ボタンが表示されない', await page.locator('button:has-text("🤝 Dotへ相談する")').count() === 0);
    const duringOff = await readDotRequests(page);
    record('⑧-3: OFFでも既存の依頼データは消えていない', duringOff.length === 1);
    await closeAllOverlays(page);

    await openMemoryTab(page);
    await page.locator('label:has-text("Dotタスク連携機能を使う") input[type=checkbox]').check();
    await page.waitForTimeout(300);
    await openMemoryByText(page, '架空の記憶8');
    record('⑧-4: 再開後はボタンが再表示される', await page.locator('button:has-text("🤝 Dotへ相談する")').count() > 0);
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    record('⑧-5: 再開後、以前の依頼JSONをそのまま確認できる', await page.locator('pre').count() > 0);
    await closeAllOverlays(page);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑨復元後の古い依頼の無効化：復元前の未適用依頼・回答はそのまま採用できず、必ず
  // 再出力を求める。採用済み履歴は保持し再適用しない。新しい依頼を出せば通常通り使える。
  // （本番反映前レビュー項目3対応）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    page.on('dialog', d => d.accept());
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([
        { id: 'taskBackupHeld', title: '架空タスク（復元・保留用）', date: null, completed: false },
        { id: 'taskBackupApplied', title: '架空タスク（復元・採用済み用）', date: null, completed: false }
      ]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);

    // ①バックアップ前に「保留」まで進めた依頼（復元後に無効化されるべき）
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶9a：復元・保留テスト用');
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶9a');
    await linkToExistingTask(page, '架空タスク（復元・保留用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    let rec = (await readDotRequests(page)).find(r => r.taskId === 'taskBackupHeld');
    let resp = { schemaVersion: 2, type: 'dot_response', requestId: rec.requestId, memoryRefId: rec.source.memoryRefId, taskRefId: rec.source.taskRefId, sourceRevision: rec.source.sourceRevision, taskRevision: rec.source.taskRevision, facts: [], unknowns: [], options: [], nextStep: { title: '復元前に保留した行動', durationMinutes: null, dueDate: null, reason: 'x' }, futureLink: null };
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(JSON.stringify(resp));
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(400);
    await page.locator('button:has-text("今回は保留する")').click();
    await page.waitForTimeout(400);
    await closeAllOverlays(page);

    // ②バックアップ前に「採用済み」まで進めた依頼（復元後も履歴として保持されるべき）
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶9b：復元・採用済みテスト用');
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶9b');
    await linkToExistingTask(page, '架空タスク（復元・採用済み用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    rec = (await readDotRequests(page)).find(r => r.taskId === 'taskBackupApplied');
    resp = { schemaVersion: 2, type: 'dot_response', requestId: rec.requestId, memoryRefId: rec.source.memoryRefId, taskRefId: rec.source.taskRefId, sourceRevision: rec.source.sourceRevision, taskRevision: rec.source.taskRevision, facts: [], unknowns: [], options: [], nextStep: { title: '復元前に採用した行動', durationMinutes: null, dueDate: null, reason: 'x' }, futureLink: null };
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(JSON.stringify(resp));
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(400);
    await page.locator('div.card', { hasText: '復元前に採用した行動' }).locator('button:has-text("この案を採用する")').click();
    await page.waitForTimeout(400);
    await closeAllOverlays(page);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button', { hasText: '💾書出' }).first().click().catch(() => null)
    ]);
    let backupPath = null;
    if (download) {
      backupPath = path.join(require('os').tmpdir(), 'nexus_dot_phase2_test_backup_' + Date.now() + '.json');
      await download.saveAs(backupPath);
    }
    record('⑨-1: 全データバックアップのダウンロードが行われる', !!download);
    if (backupPath) {
      const backupJson = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      record('⑨-2: バックアップJSONにnexusDotRequests（依頼・応答の記録）が含まれる', Array.isArray(backupJson.nexusDotRequests) && backupJson.nexusDotRequests.length === 2, backupJson.nexusDotRequests.length);

      // 端末のデータを消去し、バックアップから復元する。復元だけでは何も自動採用されない。
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(400);
      await page.locator('label', { hasText: '📥復元' }).locator('input[type="file"]').setInputFiles(backupPath);
      await page.waitForTimeout(500);
      const restoredRequests = await readDotRequests(page);
      const restoredHeld = restoredRequests.find(r => r.taskId === 'taskBackupHeld');
      const restoredApplied = restoredRequests.find(r => r.taskId === 'taskBackupApplied');
      record('⑨-3: 復元後、依頼の記録が再現される（件数・状態）', restoredRequests.length === 2 && restoredHeld.status === 'held' && restoredApplied.status === 'applied', restoredRequests.map(r => r.status));
      record('⑨-4: 復元した未適用（保留）の依頼にはrestoredInvalidが付く', restoredHeld.restoredInvalid === true);
      record('⑨-5: 復元した採用済みの依頼にはrestoredInvalidが付かない（履歴として保持）', !restoredApplied.restoredInvalid);

      // ③復元した「保留」の依頼：画面を開いても、そのまま採用できない。再出力が必要。
      await openMemoryByText(page, '架空の記憶9a');
      await page.locator('button:has-text("🤝 Dotへ相談する")').click();
      await page.waitForTimeout(300);
      record('⑨-6: 復元後、古い依頼・回答である旨の注記が表示される', await page.locator('text=バックアップからの復元によるものです').count() > 0);
      record('⑨-7: 復元した保留中の提案に「採用する」ボタンが出ない（そのまま採用できない）', await page.locator('button:has-text("この案を採用する")').count() === 0);
      record('⑨-8: 新しい相談内容を入力する画面（再出力）が表示される', await page.locator('textarea[placeholder*="相談（"]').count() > 0);

      // ④新しく依頼を出し直せば、通常どおりの往復ができる。
      // 既に（復元した無効な）依頼が存在するため、ボタン文言は「依頼を更新する」になる
      // （内部的には、restoredInvalidな依頼は進行中とみなされないため新しいrequestIdが発行される）。
      await page.locator('button:has-text("依頼を更新する"), button:has-text("依頼を作成する")').first().click();
      await page.waitForTimeout(400);
      record('⑨-9: 再出力すると古い注記が消え、新しい依頼JSONが表示される', await page.locator('text=バックアップからの復元によるものです').count() === 0 && await page.locator('pre').count() > 0);
      const freshRec = (await readDotRequests(page)).find(r => r.taskId === 'taskBackupHeld' && !r.restoredInvalid);
      record('⑨-10: 再出力により、古い依頼とは別の新しいrequestIdが発行される', !!freshRec && freshRec.requestId !== restoredHeld.requestId);
      const freshResp = { schemaVersion: 2, type: 'dot_response', requestId: freshRec.requestId, memoryRefId: freshRec.source.memoryRefId, taskRefId: freshRec.source.taskRefId, sourceRevision: freshRec.source.sourceRevision, taskRevision: freshRec.source.taskRevision, facts: [], unknowns: [], options: [], nextStep: { title: '再出力後に採用した行動', durationMinutes: null, dueDate: null, reason: 'x' }, futureLink: null };
      await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(JSON.stringify(freshResp));
      await page.locator('button:has-text("取り込む")').click();
      await page.waitForTimeout(400);
      await page.locator('div.card', { hasText: '再出力後に採用した行動' }).locator('button:has-text("この案を採用する")').click();
      await page.waitForTimeout(400);
      record('⑨-11: 再出力後は通常どおり採用できる', await page.locator('text=採用済み').count() > 0);
      const tasksAfterReissue = await readTasks(page);
      record('⑨-12: 採用した内容がタスクへ反映される', tasksAfterReissue.find(t => t.id === 'taskBackupHeld').title === '再出力後に採用した行動');
      await closeAllOverlays(page);

      // ⑤復元した「採用済み」の依頼は、履歴として保持され、再適用もされない（タスクは既に書込済みの内容のまま）。
      const tasksCheckApplied = await readTasks(page);
      record('⑨-13: 復元した採用済みの依頼のタスクは、復元前に採用した内容のまま（再適用されていない）', tasksCheckApplied.find(t => t.id === 'taskBackupApplied').title === '復元前に採用した行動');
      try { fs.unlinkSync(backupPath); } catch (e) {}
    }
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑩iPhone幅（375/390/430px）での横あふれ確認
  // ════════════════════════════════════════════════════════════
  for (const width of [375, 390, 430]) {
    const { context, page } = await newPage(browser, { width, height: 844 });
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskWidth', title: '架空タスク（幅確認用）', date: null, completed: false }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶10：幅確認テスト用' + width);
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶10：幅確認テスト用' + width);
    await linkToExistingTask(page, '架空タスク（幅確認用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    record(`⑩ ${width}px: 相談画面が横へはみ出さない`, overflow <= 2, `overflow=${overflow}`);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑪採用直前のPRIVATE化：応答取込後、採用の直前に記憶がPRIVATEになった場合は停止する
  // （本番反映前レビュー項目2対応：コピー直前・取込時だけでなく採用直前も再確認する）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskPrivAtDecide', title: '架空タスク（採用直前PRIVATE化用）', date: null, completed: false }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶11：採用直前PRIVATE化テスト用');
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶11');
    await linkToExistingTask(page, '架空タスク（採用直前PRIVATE化用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    const rec = (await readDotRequests(page))[0];
    const resp = { schemaVersion: 2, type: 'dot_response', requestId: rec.requestId, memoryRefId: rec.source.memoryRefId, taskRefId: rec.source.taskRefId, sourceRevision: rec.source.sourceRevision, taskRevision: rec.source.taskRevision, facts: [], unknowns: [], options: [], nextStep: { title: '採用直前PRIVATE化後の行動', durationMinutes: null, dueDate: null, reason: 'x' }, futureLink: null };
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(JSON.stringify(resp));
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(400);

    // 応答取込後、採用の直前に（別の操作・別タブ想定で）記憶をPRIVATEにする。
    await page.evaluate(async () => {
      const all = await MemoryService.getAll();
      const target = all.find(m => (m.content || '').includes('採用直前PRIVATE化テスト用'));
      await MemoryService.update(target.id, { isPrivate: true, manualPrivateConfirmed: true, privacyConfirmedContentFingerprint: nexusSimpleFingerprint(target.content) });
    });
    await page.locator('div.card', { hasText: '採用直前PRIVATE化後の行動' }).locator('button:has-text("この案を採用する")').click();
    await page.waitForTimeout(400);
    record('⑪-1: 採用直前にPRIVATE化されていると採用が停止される', await page.locator('text=採用済み').count() === 0);
    record('⑪-2: PRIVATEを理由に停止したことが表示される', await page.locator('text=PRIVATE').count() > 0);
    const tasksAfter = await readTasks(page);
    record('⑪-3: タスクは変更されていない', tasksAfter.find(t => t.id === 'taskPrivAtDecide').title === '架空タスク（採用直前PRIVATE化用）');
    const requestsAfter = await readDotRequests(page);
    record('⑪-4: 依頼もapplied扱いになっていない', requestsAfter[0].status === 'response_received', requestsAfter[0].status);
    await closeAllOverlays(page);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑫採用の反映範囲の限定：タイトル・所要時間・期限以外は一切変更しない
  // （本番反映前レビュー項目2対応：件数・完了状態・顧客情報・商談結果・元メモ・営業実績が
  // 変わらないことを、同種の他タスクも含めて確認する）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([
        { id: 'taskScopeTarget', title: '架空タスク（反映範囲確認用）', date: '2026-10-10', completed: false, customerId: 'cust_scope_keep', method: '電話', time: '10:00', waitingFrom: '相手', dealResult: '検討中', memo: '元メモは変更しない' },
        { id: 'taskScopeOther', title: '無関係な他タスク', date: '2026-10-20', completed: true, customerId: 'cust_other_keep' }
      ]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶12：反映範囲確認テスト用');
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶12');
    await linkToExistingTask(page, '架空タスク（反映範囲確認用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    const rec = (await readDotRequests(page))[0];
    const resp = { schemaVersion: 2, type: 'dot_response', requestId: rec.requestId, memoryRefId: rec.source.memoryRefId, taskRefId: rec.source.taskRefId, sourceRevision: rec.source.sourceRevision, taskRevision: rec.source.taskRevision, facts: [], unknowns: [], options: [], nextStep: { title: '反映範囲確認後のタイトル', durationMinutes: 25, dueDate: '2026-10-10', reason: 'x' }, futureLink: null };
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(JSON.stringify(resp));
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(400);

    const tasksBefore = await readTasks(page);
    await page.locator('div.card', { hasText: '反映範囲確認後のタイトル' }).locator('button:has-text("この案を採用する")').click();
    await page.waitForTimeout(400);
    const tasksAfter = await readTasks(page);
    record('⑫-1: タスクの件数は変わらない', tasksAfter.length === tasksBefore.length, tasksAfter.length);
    const target = tasksAfter.find(t => t.id === 'taskScopeTarget');
    const other = tasksAfter.find(t => t.id === 'taskScopeOther');
    record('⑫-2: 採用したタイトル・所要時間・期限だけが変わる', target.title === '反映範囲確認後のタイトル' && target.dotDurationMinutes === 25 && target.date === '2026-10-10');
    record('⑫-3: 完了状態（completed）は変わらない', target.completed === false);
    record('⑫-4: 顧客情報（customerId）は変わらない', target.customerId === 'cust_scope_keep');
    record('⑫-5: 商談結果（dealResult）は変わらない', target.dealResult === '検討中');
    record('⑫-6: 元メモ（memo）は変わらない', target.memo === '元メモは変更しない');
    record('⑫-7: 連絡方法・時間・相手（method/time/waitingFrom）は変わらない', target.method === '電話' && target.time === '10:00' && target.waitingFrom === '相手');
    record('⑫-8: 無関係な他タスク（営業実績含む）は一切変更されない', other.title === '無関係な他タスク' && other.completed === true && other.customerId === 'cust_other_keep' && other.date === '2026-10-20');
    await closeAllOverlays(page);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑬復旧用記録（処理中記録）の保存失敗：採用処理を開始せず、タスクを変更しない
  // （本番反映前レビュー項目4対応）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskPendingFail', title: '架空タスク（復旧記録障害用）', date: null, completed: false }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶13：復旧記録障害テスト用');
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶13');
    await linkToExistingTask(page, '架空タスク（復旧記録障害用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    const rec = (await readDotRequests(page))[0];
    const resp = { schemaVersion: 2, type: 'dot_response', requestId: rec.requestId, memoryRefId: rec.source.memoryRefId, taskRefId: rec.source.taskRefId, sourceRevision: rec.source.sourceRevision, taskRevision: rec.source.taskRevision, facts: [], unknowns: [], options: [], nextStep: { title: '復旧記録障害時の行動', durationMinutes: null, dueDate: null, reason: 'x' }, futureLink: null };
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(JSON.stringify(resp));
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(400);

    // ml_dot_apply_pending_v1（復旧用記録）への書込だけを常に失敗させる。
    await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'ml_dot_apply_pending_v1') throw new Error('synthetic pending failure');
        return orig.call(this, key, value);
      };
      window.__origSetItem = orig;
    });
    await page.locator('div.card', { hasText: '復旧記録障害時の行動' }).locator('button:has-text("この案を採用する")').click();
    await page.waitForTimeout(400);
    record('⑬-1: 復旧用記録の保存に失敗すると成功表示をしない', await page.locator('text=採用済み').count() === 0);
    record('⑬-2: 保存に失敗した旨が表示される', await page.locator('text=保存に失敗しました').count() > 0);
    let tasksAfter = await readTasks(page);
    record('⑬-3: タスクはまったく変更されていない（処理自体が始まっていない）', tasksAfter.find(t => t.id === 'taskPendingFail').title === '架空タスク（復旧記録障害用）');
    record('⑬-4: 入力（提案カード・採用ボタン）はそのまま保持され、再試行できる', await page.locator('div.card', { hasText: '復旧記録障害時の行動' }).locator('button:has-text("この案を採用する")').count() > 0);

    await page.evaluate(() => { Storage.prototype.setItem = window.__origSetItem; });
    await page.locator('div.card', { hasText: '復旧記録障害時の行動' }).locator('button:has-text("この案を採用する")').click();
    await page.waitForTimeout(400);
    record('⑬-5: 障害を取り除いて再試行すると成功する', await page.locator('text=採用済み').count() > 0);
    tasksAfter = await readTasks(page);
    record('⑬-6: 再試行後は正しくタスクへ反映される', tasksAfter.find(t => t.id === 'taskPendingFail').title === '復旧記録障害時の行動');
    await closeAllOverlays(page);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑭タスク保存成功・適用済み記録の保存失敗：再試行で二重適用せず、記録だけ補完する
  // （本番反映前レビュー項目4対応）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskRecordFail', title: '架空タスク（記録保存障害用）', date: null, completed: false }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶14：記録保存障害テスト用');
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶14');
    await linkToExistingTask(page, '架空タスク（記録保存障害用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    const rec = (await readDotRequests(page))[0];
    const resp = { schemaVersion: 2, type: 'dot_response', requestId: rec.requestId, memoryRefId: rec.source.memoryRefId, taskRefId: rec.source.taskRefId, sourceRevision: rec.source.sourceRevision, taskRevision: rec.source.taskRevision, facts: [], unknowns: [], options: [], nextStep: { title: '記録保存障害時の行動', durationMinutes: null, dueDate: null, reason: 'x' }, futureLink: null };
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(JSON.stringify(resp));
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(400);

    // タスク（ml_tasks_v1）の書込は成功させ、依頼記録（ml_dot_requests_v1）の書込だけ失敗させる
    // （採用処理の最後の一歩だけが失敗する状況を再現する）。
    await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'ml_dot_requests_v1') throw new Error('synthetic record-save failure');
        return orig.call(this, key, value);
      };
      window.__origSetItem = orig;
    });
    await page.locator('div.card', { hasText: '記録保存障害時の行動' }).locator('button:has-text("この案を採用する")').click();
    await page.waitForTimeout(400);
    record('⑭-1: 記録の保存に失敗すると成功表示をしない', await page.locator('text=採用済み').count() === 0);
    let tasksAfter = await readTasks(page);
    record('⑭-2: タスク側には既に反映されている（タスク保存自体は成功している）', tasksAfter.find(t => t.id === 'taskRecordFail').title === '記録保存障害時の行動');

    await page.evaluate(() => { Storage.prototype.setItem = window.__origSetItem; });
    await page.locator('div.card', { hasText: '記録保存障害時の行動' }).locator('button:has-text("この案を採用する")').click();
    await page.waitForTimeout(400);
    record('⑭-3: 再試行すると成功表示になる', await page.locator('text=採用済み').count() > 0);
    const tasksAfterRetry = await readTasks(page);
    record('⑭-4: 再試行してもタスクの内容は変わらない（二重適用されていない）', tasksAfterRetry.find(t => t.id === 'taskRecordFail').title === '記録保存障害時の行動' && tasksAfterRetry.length === 1);
    const pendingAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('ml_dot_apply_pending_v1') || '{}'));
    record('⑭-5: 復旧用記録は完了後にクリアされている', Object.keys(pendingAfter).length === 0, pendingAfter);
    await closeAllOverlays(page);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑮復旧前にタスクが変更／削除された：古い値へ巻き戻さず、削除済みタスクを復活させない。
  // 無関係な最新タスクも消さない（本番反映前レビュー項目4対応）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8793/nexus.html', { waitUntil: 'load' });
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([
        { id: 'taskConflict', title: '架空タスク（競合確認用）', date: null, completed: false },
        { id: 'taskUnrelatedLatest', title: '無関係な最新タスク', date: null, completed: false }
      ]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await openMemoryTab(page);
    await addMemory(page, '架空の記憶15：競合確認テスト用');
    await page.waitForTimeout(200);
    await openMemoryByText(page, '架空の記憶15');
    await linkToExistingTask(page, '架空タスク（競合確認用）');
    await page.locator('button:has-text("🤝 Dotへ相談する")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("依頼を作成する")').click();
    await page.waitForTimeout(400);
    const rec = (await readDotRequests(page))[0];
    const resp = { schemaVersion: 2, type: 'dot_response', requestId: rec.requestId, memoryRefId: rec.source.memoryRefId, taskRefId: rec.source.taskRefId, sourceRevision: rec.source.sourceRevision, taskRevision: rec.source.taskRevision, facts: [], unknowns: [], options: [], nextStep: { title: '競合確認後の行動', durationMinutes: null, dueDate: null, reason: 'x' }, futureLink: null };
    await page.locator('textarea[placeholder*="Dotからの回答JSON"]').fill(JSON.stringify(resp));
    await page.locator('button:has-text("取り込む")').click();
    await page.waitForTimeout(400);

    // 前回の試行が中断した状況を模擬：before/afterが現在のタスクのどちらとも一致しない
    // 処理中記録を直接書き込む（＝対象データが復旧前後の想定外に変化している）。
    await page.evaluate(requestId => {
      localStorage.setItem('ml_dot_apply_pending_v1', JSON.stringify({
        'op-conflict-test': { requestId, taskId: 'taskConflict', before: { title: '想定していた古いタイトル' }, after: { title: '想定していた新しいタイトル' }, startedAt: new Date().toISOString() }
      }));
    }, rec.requestId);
    await page.locator('div.card', { hasText: '競合確認後の行動' }).locator('button:has-text("この案を採用する")').click();
    await page.waitForTimeout(400);
    record('⑮-1: 想定外の競合では成功表示をしない', await page.locator('text=採用済み').count() === 0);
    record('⑮-2: 競合を理由に停止したことが表示される', await page.locator('text=別の操作でタスクが変更された').count() > 0);
    let tasksAfter = await readTasks(page);
    const target = tasksAfter.find(t => t.id === 'taskConflict');
    record('⑮-3: 古い想定値（before）に巻き戻されていない', target.title !== '想定していた古いタイトル');
    record('⑮-4: 新しい想定値（after）も強制適用されていない', target.title !== '想定していた新しいタイトル');
    record('⑮-5: タスク自体は変更前のまま保持されている', target.title === '架空タスク（競合確認用）');
    record('⑮-6: 無関係な最新タスクは消えていない', tasksAfter.some(t => t.id === 'taskUnrelatedLatest' && t.title === '無関係な最新タスク'));
    await page.evaluate(() => localStorage.removeItem('ml_dot_apply_pending_v1'));

    // タスクが削除された場合（復旧前に削除済み）：巻き戻し・復活のどちらも行わない。
    await page.evaluate(requestId => {
      const tasks = JSON.parse(localStorage.getItem('ml_tasks_v1'));
      localStorage.setItem('ml_tasks_v1', JSON.stringify(tasks.filter(t => t.id !== 'taskConflict')));
      localStorage.setItem('ml_dot_apply_pending_v1', JSON.stringify({
        'op-deleted-test': { requestId, taskId: 'taskConflict', before: { title: '架空タスク（競合確認用）' }, after: { title: '競合確認後の行動' }, startedAt: new Date().toISOString() }
      }));
    }, rec.requestId);
    await page.locator('div.card', { hasText: '競合確認後の行動' }).locator('button:has-text("この案を採用する")').click();
    await page.waitForTimeout(400);
    record('⑮-7: 削除済みタスクでは成功表示をしない', await page.locator('text=採用済み').count() === 0);
    record('⑮-8: タスクが見つからない旨が表示される', await page.locator('text=対象のタスクが見つからない').count() > 0);
    const tasksFinal = await readTasks(page);
    record('⑮-9: 削除済みタスクは復活していない', !tasksFinal.some(t => t.id === 'taskConflict'));
    record('⑮-10: 無関係な最新タスクはこの操作でも消えていない', tasksFinal.some(t => t.id === 'taskUnrelatedLatest'));
    await closeAllOverlays(page);
    await context.close();
  }

  record('No unexpected crashes across all phase2 consult scenarios', true);
  const failedCount = results.filter(r => !r.pass).length;
  console.log(`\nTOTAL: ${results.length}, PASS: ${results.length - failedCount}, FAIL: ${failedCount}`);
  await browser.close();
  process.exit(failedCount > 0 ? 1 : 0);
})();
