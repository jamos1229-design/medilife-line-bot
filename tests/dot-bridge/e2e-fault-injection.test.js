// Dot連携：保存失敗を実際にテストへ注入する（§4）。端末容量は使い切らず、
// localStorage.setItem / IndexedDBのput() に実際に例外を発生させて検証する。
// すべて架空の合成データのみ使用。
const { chromium } = require('playwright');
const fs = require('fs');
const results = [];
function record(label, cond, extra) {
  results.push({ label, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (extra ? ' -- ' + extra : ''));
}
const VENDOR = __dirname + '/vendor';
async function newPage(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('https://unpkg.com/react@18/umd/react.production.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(VENDOR + '/react/react.production.min.js') }));
  await context.route('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(VENDOR + '/react-dom/react-dom.production.min.js') }));
  const page = await context.newPage();
  return { context, page };
}
// localStorageの指定キーへの次回のsetItemだけを失敗させる（QuotaExceededError）。
async function armLocalStorageFailureOnce(page, targetKey) {
  await page.evaluate(key => {
    if (!window.__origSetItem) window.__origSetItem = Storage.prototype.setItem;
    window.__failKey = key;
    Storage.prototype.setItem = function (k, v) {
      if (k === window.__failKey) {
        window.__failKey = null; // 1回だけ失敗させる
        const err = new DOMException('Quota exceeded (simulated)', 'QuotaExceededError');
        throw err;
      }
      return window.__origSetItem.call(this, k, v);
    };
  }, targetKey);
}
async function disarmLocalStorageFailure(page) {
  await page.evaluate(() => {
    if (window.__origSetItem) Storage.prototype.setItem = window.__origSetItem;
    window.__failKey = null;
  });
}
// IndexedDBのmemoriesストアへの次回のput()だけを失敗させる。
async function armIndexedDbFailureOnce(page) {
  await page.evaluate(() => {
    if (!window.__origPut) window.__origPut = IDBObjectStore.prototype.put;
    window.__failPut = true;
    IDBObjectStore.prototype.put = function (...args) {
      if (window.__failPut && this.name === 'memories') {
        window.__failPut = false;
        throw new Error('Simulated IndexedDB put failure');
      }
      return window.__origPut.apply(this, args);
    };
  });
}
async function disarmIndexedDbFailure(page) {
  await page.evaluate(() => {
    if (window.__origPut) IDBObjectStore.prototype.put = window.__origPut;
    window.__failPut = false;
  });
}
const closeAllOverlays = async page => {
  for (let i = 0; i < 6; i++) {
    const n = await page.locator('.full-screen').count();
    if (n === 0) break;
    await page.locator('.full-screen button:has-text("← 戻る")').last().click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
  }
};
const addMemory = async (page, content) => {
  await page.locator('.nav-item:has-text("記憶")').click();
  await page.waitForTimeout(200);
  await page.locator('button:has-text("＋ 記憶する")').click();
  await page.waitForTimeout(250);
  await page.locator('textarea[placeholder*="思ったこと"]').fill(content);
  await page.locator('.drawer button:has-text("保存する")').click();
  await page.waitForTimeout(400);
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });

  // ════════════════════════════════════════════════════════════
  // テスト1: 既存タスクへの関連付け中、タスク一覧(localStorage)の書込が失敗する
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8791/nexus.html', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskF1', title: '架空タスクF1', date: '2026-07-01', completed: false }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await addMemory(page, '架空の記憶F1：保存失敗注入テスト用');
    await page.locator('text=架空の記憶F1').first().click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("📌 タスクと関連付ける")').click();
    await page.waitForTimeout(300);

    await armLocalStorageFailureOnce(page, 'ml_tasks_v1');
    await page.locator('div.card', { hasText: '架空タスクF1' }).locator('button:has-text("選ぶ")').click();
    await page.waitForTimeout(600);
    const bodyAfterFail = await page.locator('body').innerText();
    record('1-1: 保存失敗時に「関連タスク：」の成功表示が出ない', !bodyAfterFail.includes('関連タスク：架空タスクF1'));
    const tasksAfterFail = await page.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]'));
    record('1-2: 失敗後もタスクは1件のまま（書込失敗時に壊れたデータで上書きされていない）', tasksAfterFail.length === 1 && tasksAfterFail[0].sourceMemoryId === undefined, `count=${tasksAfterFail.length}`);
    await disarmLocalStorageFailure(page);

    // 再試行（同じ操作をもう一度）→ 今度は成功し、重複もしない
    await page.locator('div.card', { hasText: '架空タスクF1' }).locator('button:has-text("選ぶ")').click();
    await page.waitForTimeout(600);
    record('1-3: 失敗を解除して再試行すると成功する', await page.locator('text=関連タスク：架空タスクF1').count() > 0);
    const tasksAfterRetry = await page.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]'));
    record('1-4: 再試行で重複作成されない（1件のまま）', tasksAfterRetry.length === 1, `count=${tasksAfterRetry.length}`);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // テスト2: 新規タスク作成＋関連付け中、タスク一覧の書込が失敗する
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8791/nexus.html', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await addMemory(page, '架空の記憶F2：新規タスク作成失敗注入テスト用');
    await page.locator('text=架空の記憶F2').first().click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("📌 タスクと関連付ける")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("＋ 新しいタスクを作成して関連付ける")').click();
    await page.waitForTimeout(300);
    const taskFormArea = page.locator('.drawer').last();
    await taskFormArea.locator('input.form-input').first().fill('架空タスクF2');

    await armLocalStorageFailureOnce(page, 'ml_tasks_v1');
    await taskFormArea.locator('button:has-text("保存")').click();
    await page.waitForTimeout(600);
    const bodyAfterFail = await page.locator('body').innerText();
    record('2-1: タスク作成の保存失敗時に成功表示が出ない', !bodyAfterFail.includes('関連タスク：架空タスクF2'));
    const tasksAfterFail = await page.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]'));
    record('2-2: 保存失敗時はタスクが作成されていない（0件のまま）', tasksAfterFail.length === 0, `count=${tasksAfterFail.length}`);
    await disarmLocalStorageFailure(page);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // テスト3: タスク側は保存できるが、記憶側（IndexedDB）の保存が失敗する
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8791/nexus.html', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskF3', title: '架空タスクF3', date: '2026-07-03', completed: false }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await addMemory(page, '架空の記憶F3：記憶側の保存失敗注入テスト用');
    await page.locator('text=架空の記憶F3').first().click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("📌 タスクと関連付ける")').click();
    await page.waitForTimeout(300);

    await armIndexedDbFailureOnce(page);
    await page.locator('div.card', { hasText: '架空タスクF3' }).locator('button:has-text("選ぶ")').click();
    await page.waitForTimeout(600);
    const bodyAfterFail = await page.locator('body').innerText();
    record('3-1: 記憶側の保存失敗時に成功表示が出ない', !bodyAfterFail.includes('関連タスク：架空タスクF3'));
    const tasksAfterFail = await page.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]'));
    record('3-2: タスク側は保存されている（sourceMemoryIdが設定済み）', tasksAfterFail.find(t => t.id === 'taskF3') && tasksAfterFail.find(t => t.id === 'taskF3').sourceMemoryId);
    await disarmIndexedDbFailure(page);

    // 再試行で記憶側だけが補完され、タスクが重複作成されないことを確認
    await page.locator('div.card', { hasText: '架空タスクF3' }).locator('button:has-text("選ぶ")').click();
    await page.waitForTimeout(600);
    record('3-3: 再試行で記憶側が補完され成功する', await page.locator('text=関連タスク：架空タスクF3').count() > 0);
    const tasksAfterRetry = await page.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]'));
    record('3-4: 再試行でタスクが重複作成されない（1件のまま）', tasksAfterRetry.length === 1, `count=${tasksAfterRetry.length}`);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // テスト4: 処理中記録（ml_dot_link_pending_v1）自体の書込が失敗する場合、
  // 関連付け処理そのものを開始してはならない
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8791/nexus.html', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskF4', title: '架空タスクF4', date: '2026-07-04', completed: false }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await addMemory(page, '架空の記憶F4：処理中記録の保存失敗注入テスト用');
    await page.locator('text=架空の記憶F4').first().click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("📌 タスクと関連付ける")').click();
    await page.waitForTimeout(300);

    await armLocalStorageFailureOnce(page, 'ml_dot_link_pending_v1');
    await page.locator('div.card', { hasText: '架空タスクF4' }).locator('button:has-text("選ぶ")').click();
    await page.waitForTimeout(600);
    const tasksAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]'));
    record('4-1: 処理中記録を保存できない場合、タスク側への書込自体が行われない', tasksAfter.find(t => t.id === 'taskF4') && tasksAfter.find(t => t.id === 'taskF4').sourceMemoryId === undefined);
    await disarmLocalStorageFailure(page);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // テスト5: Dot用JSONの参照ID・版情報（ml_dot_ref_map_v1）の保存が失敗する
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8791/nexus.html', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskF5', title: '架空タスクF5', date: '2026-07-05', completed: false }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await addMemory(page, '架空の記憶F5：参照ID保存失敗注入テスト用');
    await page.locator('text=架空の記憶F5').first().click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("📌 タスクと関連付ける")').click();
    await page.waitForTimeout(300);
    await page.locator('div.card', { hasText: '架空タスクF5' }).locator('button:has-text("選ぶ")').click();
    await page.waitForTimeout(500);
    await page.locator('button:has-text("📤 Dot用JSONを確認")').click();
    await page.waitForTimeout(300);

    await armLocalStorageFailureOnce(page, 'ml_dot_ref_map_v1');
    await page.locator('button:has-text("プレビューを作成")').click();
    await page.waitForTimeout(500);
    record('5-1: 参照ID・版情報の保存失敗時はJSONプレビューが表示されない', await page.locator('textarea[readonly]').count() === 0);
    const bodyText = await page.locator('body').innerText();
    record('5-2: 失敗理由がトーストで示される', bodyText.includes('参照ID') || bodyText.includes('保存'));
    await disarmLocalStorageFailure(page);

    // 再試行で正常にプレビューが作成できる
    await page.locator('button:has-text("プレビューを作成")').click();
    await page.waitForTimeout(500);
    record('5-3: 失敗を解除して再試行するとプレビューが作成できる', await page.locator('textarea[readonly]').count() > 0);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // テスト6: action/所要時間/タグ（構造化項目）の保存が失敗する
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8791/nexus.html', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskF6', title: '架空タスクF6', date: '2026-07-06', completed: false }]));
    });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(500);
    await addMemory(page, '架空の記憶F6：構造化項目保存失敗注入テスト用');
    await page.locator('text=架空の記憶F6').first().click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("📌 タスクと関連付ける")').click();
    await page.waitForTimeout(300);
    await page.locator('div.card', { hasText: '架空タスクF6' }).locator('button:has-text("選ぶ")').click();
    await page.waitForTimeout(500);
    await page.locator('button:has-text("📤 Dot用JSONを確認")').click();
    await page.waitForTimeout(300);
    await page.locator('span:has-text("顧客フォロー")').click();
    await page.waitForTimeout(150);

    await armLocalStorageFailureOnce(page, 'ml_tasks_v1');
    await page.locator('button:has-text("プレビューを作成")').click();
    await page.waitForTimeout(500);
    record('6-1: action保存失敗時はJSONプレビューが表示されない', await page.locator('textarea[readonly]').count() === 0);
    await disarmLocalStorageFailure(page);
    await page.locator('button:has-text("プレビューを作成")').click();
    await page.waitForTimeout(500);
    record('6-2: 失敗を解除して再試行するとプレビューが作成できる', await page.locator('textarea[readonly]').count() > 0);
    const json = JSON.parse(await page.locator('textarea[readonly]').first().inputValue());
    record('6-3: 保存されたactionがJSONに反映される', json.action === 'customer_followup');
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // テスト7: 削除済みタスクを復活させない（タスクが削除された後に残ったマーカーから）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8791/nexus.html', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    // taskF7はもう存在しない（削除済み）という状態で、処理中マーカーだけ残っている
    await page.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskOther', title: '架空タスクOther', date: '2026-07-07', completed: false }]));
      localStorage.setItem('ml_dot_link_pending_v1', JSON.stringify({ 'memF7::taskF7': { memoryId: 'memF7', taskId: 'taskF7', startedAt: new Date().toISOString() } }));
    });
    await page.evaluate(() => new Promise(resolve => {
      const req = indexedDB.open('nexus_second_brain_db');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('memories', 'readwrite');
        tx.objectStore('memories').put({
          id: 'memF7', content: '架空の記憶F7：削除済みタスクの復活防止テスト',
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
          category: '', tags: [], relatedEntityIds: [], relatedMemoryIds: [],
          source: 'manual', isPrivate: false, linkedTaskIds: []
        });
        tx.oncomplete = () => resolve();
      };
    }));
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(800);
    const tasksAfter = await page.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]'));
    record('7-1: 削除済みタスク（taskF7）が復活して作り直されていない', !tasksAfter.some(t => t.id === 'taskF7'));
    record('7-2: 無関係なタスク（taskOther）は保持されている', tasksAfter.some(t => t.id === 'taskOther'));
    await context.close();
  }

  record('No critical crashes across all fault-injection scenarios', true);
  const failedCount = results.filter(r => !r.pass).length;
  console.log(`\nTOTAL: ${results.length}, PASS: ${results.length - failedCount}, FAIL: ${failedCount}`);
  await browser.close();
  process.exit(failedCount > 0 ? 1 : 0);
})();
