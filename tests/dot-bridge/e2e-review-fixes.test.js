// Dot連携：公開コード確認で見つかった2件の保存問題の再現・修正確認テスト。
// すべて架空の合成データのみ使用。
//
// ①古いReact状態による再上書き：別タブで追加されたタスクが、関連付け操作の際に
//   setTasks(prev => ...)で古いprevを使って保存し直され、消えてしまう。
// ②新規作成後の部分失敗からの再試行：タスク側だけ保存できて記憶側が失敗した後、
//   作成フォームをやり直すと新しいIDで別タスクが作られ、重複してしまう。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const results = [];
function record(label, cond, extra) {
  results.push({ label, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (extra ? ' -- ' + extra : ''));
}
const VENDOR = __dirname + '/vendor';
async function newPage(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('https://unpkg.com/react@18/umd/react.production.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(VENDOR, 'react', 'react.production.min.js')) }));
  await context.route('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(VENDOR, 'react-dom', 'react-dom.production.min.js')) }));
  const page = await context.newPage();
  return { context, page };
}
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
// 既存タスクタブの「+」から無関係なタスクを1件追加する（Dot機能を経由しない、通常のタスク追加）。
const addUnrelatedTaskViaTaskTab = async (page, title) => {
  await page.locator('.nav-item:has-text("タスク")').click();
  await page.waitForTimeout(300);
  const fab = page.locator('button.fab, button:has-text("＋")').first();
  await fab.click();
  await page.waitForTimeout(300);
  await page.locator('.drawer input.form-input').first().fill(title);
  await page.locator('.drawer button:has-text("保存")').click();
  await page.waitForTimeout(400);
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });

  // ════════════════════════════════════════════════════════════
  // ①古いReact状態による再上書き（別タブで追加したタスクが消えるか）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page: pageA } = await newPage(browser);
    await pageA.goto('http://localhost:8791/nexus.html', { waitUntil: 'load' });
    await pageA.waitForTimeout(400);
    await pageA.evaluate(() => {
      localStorage.setItem('ml_tasks_v1', JSON.stringify([{ id: 'taskX', title: '架空タスクX', date: '2026-08-01', completed: false }]));
    });
    await pageA.reload({ waitUntil: 'load' });
    await pageA.waitForTimeout(500);
    await addMemory(pageA, '架空の記憶R1：クロスタブ上書き再現用');
    await pageA.locator('text=架空の記憶R1').first().click();
    await pageA.waitForTimeout(300);
    await pageA.locator('button:has-text("📌 タスクと関連付ける")').click();
    await pageA.waitForTimeout(300);
    // ここでpageAの画面は開いたまま（reloadしない）。pageAのReact tasks stateは
    // taskXだけを含み、以後pageBが追加するタスクを知らない状態になる。

    const { context: ignoredCtx, page: pageB } = await (async () => {
      const page = await context.newPage();
      return { context: null, page };
    })();
    await pageB.goto('http://localhost:8791/nexus.html', { waitUntil: 'load' });
    await pageB.waitForTimeout(400);
    await addUnrelatedTaskViaTaskTab(pageB, '架空タスクB（別タブ追加）');
    const tasksAfterB = await pageB.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]'));
    record('前提: Bタブでタスク追加後、localStorageには2件ある', tasksAfterB.length === 2, `count=${tasksAfterB.length}`);
    await pageB.close();

    // pageA（リロードしていない、古いReact状態のまま）で既存タスクと関連付ける
    await pageA.locator('div.card', { hasText: '架空タスクX' }).locator('button:has-text("選ぶ")').click();
    await pageA.waitForTimeout(600);

    const tasksAfterLink = await pageA.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]'));
    record('①-1: 関連付け操作の保存データに、Bタブが追加したタスクが残っている', tasksAfterLink.some(t => t.title === '架空タスクB（別タブ追加）'), `tasks=${JSON.stringify(tasksAfterLink.map(t => t.title))}`);
    record('①-2: 関連付け操作でタスクが消えていない（2件のまま）', tasksAfterLink.length === 2, `count=${tasksAfterLink.length}`);

    // リロード後の画面表示でも同様に残っていることを確認
    await pageA.reload({ waitUntil: 'load' });
    await pageA.waitForTimeout(500);
    await pageA.locator('.nav-item:has-text("タスク")').click();
    await pageA.waitForTimeout(300);
    const bodyText = await pageA.locator('body').innerText();
    record('①-3: 再読込後の画面にもBタブが追加したタスクが表示される', bodyText.includes('架空タスクB（別タブ追加）'));
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ②新規作成後の部分失敗からの再試行（タスクが2件にならないか）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8791/nexus.html', { waitUntil: 'load' });
    await page.waitForTimeout(400);
    await addMemory(page, '架空の記憶R2：新規作成retry重複再現用');
    await page.locator('text=架空の記憶R2').first().click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("📌 タスクと関連付ける")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("＋ 新しいタスクを作成して関連付ける")').click();
    await page.waitForTimeout(300);
    let drawer = page.locator('.drawer').last();
    await drawer.locator('input.form-input').first().fill('架空タスクR2-1回目');

    // タスク側の保存は成功させ、続く記憶側（IndexedDB）の保存だけを失敗させる
    await armIndexedDbFailureOnce(page);
    await drawer.locator('button:has-text("保存")').click();
    await page.waitForTimeout(600);
    await disarmIndexedDbFailure(page);

    const tasksAfterFirstAttempt = await page.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]'));
    record('前提: 1回目でタスク側だけ保存できている（1件、sourceMemoryId設定済み）', tasksAfterFirstAttempt.length === 1 && !!tasksAfterFirstAttempt[0].sourceMemoryId, `count=${tasksAfterFirstAttempt.length}`);

    // 画面の案内どおり、リロードせずに作成操作をやり直す
    await page.locator('button:has-text("📌 タスクと関連付ける")').click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("＋ 新しいタスクを作成して関連付ける")').click();
    await page.waitForTimeout(300);
    drawer = page.locator('.drawer').last();
    await drawer.locator('input.form-input').first().fill('架空タスクR2-2回目');
    await drawer.locator('button:has-text("保存")').click();
    await page.waitForTimeout(600);

    const tasksAfterRetry = await page.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]'));
    const memoryIdOfR2 = await page.evaluate(() => new Promise(resolve => {
      const req = indexedDB.open('nexus_second_brain_db');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('memories', 'readonly');
        const all = [];
        const cursorReq = tx.objectStore('memories').openCursor();
        cursorReq.onsuccess = e => {
          const cursor = e.target.result;
          if (cursor) { all.push(cursor.value); cursor.continue(); } else {
            const m = all.find(x => (x.content || '').includes('新規作成retry重複再現用'));
            resolve(m ? m.id : null);
          }
        };
      };
    }));
    const tasksForThisMemory = tasksAfterRetry.filter(t => t.sourceMemoryId === memoryIdOfR2);
    record('②-1: 同じ記憶からタスクが2件にならない（1件のまま）', tasksForThisMemory.length === 1, `count=${tasksForThisMemory.length}, titles=${JSON.stringify(tasksForThisMemory.map(t => t.title))}`);
    record('②-2: リンクが完了している（Dot用JSONを確認ボタンが出る）', await page.locator('button:has-text("📤 Dot用JSONを確認")').count() > 0);
    await context.close();
  }

  record('No unexpected crashes across bugfix reproduction scenarios', true);
  const failedCount = results.filter(r => !r.pass).length;
  console.log(`\nTOTAL: ${results.length}, PASS: ${results.length - failedCount}, FAIL: ${failedCount}`);
  await browser.close();
  process.exit(failedCount > 0 ? 1 : 0);
})();
