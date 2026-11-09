// サスペクトツリー画面のE2Eテスト。すべて架空の合成データのみを使用する。
// 実行: リポジトリ直下で `python3 -m http.server 8794` を起動した状態で
//       node tests/suspect-tree/e2e-suspect-tree.test.js
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const results = [];
function record(label, cond, extra) {
  results.push({ label, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (extra !== undefined ? ' -- ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : ''));
}
const VENDOR = path.join(__dirname, '..', 'dot-bridge', 'vendor');
const BASE = 'http://localhost:8794/nexus.html';

async function newPage(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route('https://unpkg.com/react@18/umd/react.production.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(VENDOR, 'react', 'react.production.min.js')) }));
  await context.route('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(VENDOR, 'react-dom', 'react-dom.production.min.js')) }));
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  return { context, page, pageErrors };
}
const base = o => ({ status: '未接触', contracts: [], suspects: [], referredBy: '', referredByName: '', lastContact: '', createdAt: '2026-09-01T00:00:00.000Z', ...o });
const CUSTOMERS = [
  base({ id: 'custA', name: '合成 青木', contracts: [{ id: 'k1', contractStatus: '有効', company: '架空生命' }], lastContact: '2026-01-10',
    suspects: [{ id: 'sp1', name: '合成 青木花子', relation: '配偶者' }] }),
  base({ id: 'custB', name: '合成 馬場', referredBy: 'custA', status: '面談済', lastContact: new Date().toISOString().slice(0, 10) }),
  base({ id: 'custC', name: '合成 千葉', referredByName: '未登録の紹介者' })
];
const SUSPECTS = [
  { id: 'sus1', name: '合成 候補PTA', status: '未接触', relationship: '地域', referrer: '', helpCats: [], memo: '' },
  { id: 'sus2', name: '合成 候補つなぎ', status: '接触済み', relationship: '未設定', referrer: '合成 青木', helpCats: [], memo: '' }
];
async function seed(page) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(({ customers, suspects }) => {
    localStorage.setItem('customers_v1', JSON.stringify(customers));
    localStorage.setItem('ml_suspects_v1', JSON.stringify(suspects));
  }, { customers: CUSTOMERS, suspects: SUSPECTS });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
}
const openTree = async page => {
  await page.locator('.bottom-nav button:has-text("人脈")').click();
  await page.waitForTimeout(250);
  await page.locator('button.toggle-btn:has-text("サスペクトツリー")').click();
  await page.waitForTimeout(250);
};
const group = (page, name) => page.locator(`[data-suspect-tree-group="${name}"]`);
const node = (page, key) => page.locator(`[data-suspect-tree-node="${key}"]`);
const readSuspects = page => page.evaluate(() => JSON.parse(localStorage.getItem('ml_suspects_v1') || '[]'));
const readCustomers = page => page.evaluate(() => JSON.parse(localStorage.getItem('customers_v1') || '[]'));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const { context, page, pageErrors } = await newPage(browser);
  await seed(page);
  await openTree(page);

  record('①画面: サスペクトツリーが開く', await page.locator('[data-suspect-tree="root"]').count() === 1);
  record('①画面: 5分類＋未分類のグループが並ぶ', await page.locator('[data-suspect-tree-group]').count() === 6);
  record('①画面: 最初はグループが閉じている（人数が多くても読める）', await page.locator('[data-suspect-tree-node]').count() === 0);
  record('①画面: 既契約者グループの人数は紹介先を含む2人', (await group(page, '既契約者').locator('button').first().innerText()).includes('2人'));

  await group(page, '既契約者').locator('button').first().click();
  await page.waitForTimeout(150);
  record('②展開: グループを開くと直下の人が出る', await node(page, 'c:custA').count() === 1 && await node(page, 'c:custB').count() === 0);
  const aText = await node(page, 'c:custA').innerText();
  record('②展開: 既契約・要フォロー・紹介人数・家族人数のバッジ', aText.includes('既契約') && aText.includes('要フォロー') && aText.includes('紹介1人') && aText.includes('家族・知人1人'), aText);
  await node(page, 'c:custA').locator('button[aria-label="開く"]').click();
  await page.waitForTimeout(150);
  record('②展開: 紹介された顧客と家族が枝として出る', await node(page, 'c:custB').count() === 1 && await node(page, 'f:custA:sp1').count() === 1);
  record('②展開: 相談中の人は相談中バッジ', (await node(page, 'c:custB').innerText()).includes('相談中'));

  await group(page, '未分類').locator('button').first().click();
  await page.waitForTimeout(150);
  record('③未接続: 名前だけの紹介元は「未接続」と表示し、つながない', (await node(page, 'c:custC').innerText()).includes('未登録の紹介者') && (await node(page, 'c:custC').innerText()).includes('未接続'));
  record('③未接続: 紹介者欄が名前だけの候補者も未分類の直下', await node(page, 's:sus2').count() === 1);

  // 候補者を登録済み顧客へ明示的につなぐ
  await node(page, 's:sus2').locator('button[aria-label="ツリー設定"]').click();
  await page.waitForTimeout(200);
  record('④接続: 同名の顧客が1名いると「つなぐ」候補が出る', await page.locator('button:has-text("この顧客につなぐ")').count() === 1);
  await page.locator('button:has-text("この顧客につなぐ")').click();
  await page.waitForTimeout(200);
  record('④接続: 保存データにreferrerCustomerIdが入る', (await readSuspects(page)).find(s => s.id === 'sus2').referrerCustomerId === 'custA');
  record('④接続: 既存の項目（紹介者欄・ステータス）は変わらない', (await readSuspects(page)).find(s => s.id === 'sus2').referrer === '合成 青木' && (await readSuspects(page)).find(s => s.id === 'sus2').status === '接触済み');
  await page.locator('.drawer button:has-text("閉じる")').click();
  await page.waitForTimeout(200);
  record('④接続: つないだ候補者は顧客の枝へ移る', (await node(page, 'c:custA').innerText()).includes('紹介2人'));

  // 人脈分類の手動指定（顧客）
  await node(page, 'c:custC').locator('button[aria-label="ツリー設定"]').click();
  await page.waitForTimeout(200);
  await page.locator('.drawer button.toggle-btn:has-text("仕事関係")').click();
  await page.waitForTimeout(200);
  await page.locator('.drawer button:has-text("閉じる")').click();
  await page.waitForTimeout(200);
  record('⑤分類: 手動指定がcustomers_v1に保存される', (await readCustomers(page)).find(c => c.id === 'custC').networkCategory === '仕事関係');
  record('⑤分類: 他の顧客・他の項目は変わらない', JSON.stringify((await readCustomers(page)).find(c => c.id === 'custA')) === JSON.stringify(CUSTOMERS[0]));
  await group(page, '仕事関係').locator('button').first().click();
  await page.waitForTimeout(150);
  record('⑤分類: 指定した分類のグループへ移動する', await group(page, '仕事関係').locator('[data-suspect-tree-node="c:custC"]').count() === 1);

  // 候補者の追加（タスク画面のサスペクトリストと同じ保存先）
  await page.locator('button:has-text("＋ 候補者を追加")').click();
  await page.waitForTimeout(200);
  await page.locator('.drawer input').first().fill('合成 新規候補');
  await page.locator('.drawer button:has-text("保存")').click();
  await page.waitForTimeout(250);
  const afterAdd = await readSuspects(page);
  record('⑥追加: 候補者がml_suspects_v1に1件増える（二重管理にしない）', afterAdd.length === 3 && afterAdd.some(s => s.name === '合成 新規候補'), afterAdd.map(s => s.name));

  // 絞り込み
  await page.locator('button.chip:has-text("要フォローだけ")').click();
  await page.waitForTimeout(200);
  record('⑦絞り込み: 要フォローだけにすると該当者だけが開いた状態で出る', await node(page, 'c:custA').count() === 1 && await node(page, 'c:custB').count() === 0 && await node(page, 'c:custC').count() === 0);
  await page.locator('button.chip:has-text("要フォローだけ")').click();
  await page.locator('input[placeholder="名前で検索"]').fill('馬場');
  await page.waitForTimeout(200);
  record('⑦絞り込み: 名前検索は該当者までの経路（紹介元）も出す', await node(page, 'c:custB').count() === 1 && await node(page, 'c:custA').count() === 1 && await node(page, 'c:custC').count() === 0);
  await page.locator('input[placeholder="名前で検索"]').fill('');
  await page.waitForTimeout(150);

  // 顧客詳細への遷移・iPhone幅
  await page.locator('button.chip:has-text("すべて開く")').click();
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  record('⑧iPhone幅(390px): すべて開いても横スクロールが出ない', overflow <= 0, { overflow });
  await page.screenshot({ path: process.env.SUSPECT_TREE_SHOT || path.join(require('os').tmpdir(), 'suspect-tree.png'), fullPage: true });
  await node(page, 'c:custB').locator('div[style*="cursor: pointer"]').first().click();
  await page.waitForTimeout(300);
  record('⑨遷移: 顧客をタップすると既存の顧客詳細が開く', await page.locator('.overlay, .drawer').count() > 0 && (await page.locator('body').innerText()).includes('合成 馬場'));
  record('⑩全体: 画面エラーが出ていない', pageErrors.length === 0, pageErrors);

  await context.close();
  await browser.close();
  const failedCount = results.filter(r => !r.pass).length;
  console.log(`\nTOTAL: ${results.length}, PASS: ${results.length - failedCount}, FAIL: ${failedCount}`);
  process.exit(failedCount > 0 ? 1 : 0);
})();
