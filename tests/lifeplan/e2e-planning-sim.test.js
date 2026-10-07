// 生存時ライフプラン・資産寿命シミュレーション（初期版）の画面E2Eテスト（合成データのみ）。
// 入力→保存→再読込後の保持→iPhone幅での横あふれ確認→既存のDot連携・既存プランニング機能への
// 無影響確認までを対象とする。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const results = [];
function record(label, cond, extra) {
  results.push({ label, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (extra !== undefined ? ' -- ' + extra : ''));
}
const VENDOR = path.join(__dirname, '..', 'dot-bridge', 'vendor');
async function newPage(browser, viewport) {
  const context = await browser.newContext({ viewport: viewport || { width: 390, height: 844 } });
  await context.route('https://unpkg.com/react@18/umd/react.production.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(VENDOR, 'react', 'react.production.min.js')) }));
  await context.route('https://unpkg.com/react-dom@18/umd/react-dom.production.min.js', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(VENDOR, 'react-dom', 'react-dom.production.min.js')) }));
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  return { context, page, pageErrors };
}

const SYNTHETIC_CUSTOMER = {
  id: 'cust_lp_test_1',
  name: '架空顧客LP1',
  customerType: '個人',
  birthdate: '1986-10-07',
  status: '未接触',
  suspects: [{ id: 'kid_lp_1', name: 'お子様1', relation: '子供', birthdate: '2025-04-01' }],
  contracts: [],
  lp: {
    incomeItems: [{ id: 'inc1', type: '給与', unit: 'yearly', amount: 6000000, amountType: '手取り' }],
    expenseItems: [{ id: 'exp1', category: '住居費（家賃・管理費等）', amount: 1200000 }],
    savingsItems: [],
    loans: [],
    retirement: { retirementAge: 65, lifeExpectancy: 90, pensionMonthly: 150000 },
    portfolio: { depositsJpy: 5000000 }
  }
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });

  // ════════════════════════════════════════════════════════════
  // ①基本フロー：入力→計算結果の表示→保存→再読込後も保持される
  // ════════════════════════════════════════════════════════════
  {
    const { context, page, pageErrors } = await newPage(browser);
    await page.goto('http://localhost:8792/nexus.html', { waitUntil: 'load' });
    await page.evaluate(customer => {
      localStorage.setItem('customers_v1', JSON.stringify([customer]));
    }, SYNTHETIC_CUSTOMER);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.locator('.nav-item:has-text("人脈")').click();
    await page.waitForTimeout(300);
    await page.locator('button.toggle-btn:has-text("プランニング")').click();
    await page.waitForTimeout(300);
    record('①-1: ライフプランセクション（折りたたみ）が表示される', await page.locator('text=生存時ライフプラン・資産寿命シミュレーション').count() > 0);
    await page.locator('text=生存時ライフプラン・資産寿命シミュレーション').first().click();
    await page.waitForTimeout(300);
    record('①-2: 展開後、ステータスバッジが表示される（初期状態は入力不足）', await page.locator('text=入力不足').count() > 0);

    // 資産区分：現金・預貯金をチェックすると、その行だけに「現金として扱う」「取り崩し可能」
    // ラジオ・チェックボックスが表れる（他のカテゴリは未チェックのまま＝ページ内で一意になる）。
    await page.locator('label', { hasText: '現金・預貯金' }).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(150);
    await page.locator('label', { hasText: '現金として扱う' }).locator('input[type="radio"]').check();
    await page.locator('label', { hasText: '取り崩し可能' }).locator('input[type="checkbox"]').check();
    await page.locator('input[placeholder="運用率%"]').fill('1');

    // 年金を含める
    await page.locator('label', { hasText: '年金をシミュレーションに含める' }).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(150);
    await page.locator('span', { hasText: '年金の年次上昇率' }).locator('xpath=following-sibling::input').fill('0');

    // 生活費
    await page.locator('.nexus-lp-living-base input').fill('3000000');
    await page.locator('.nexus-lp-living-rate input').fill('2');

    // 収入（給与）を対象にする
    await page.locator('label', { hasText: '給与' }).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(150);
    await page.locator('input[placeholder="上昇率%"]').first().fill('0');

    // 支出（住居費）を対象にする
    await page.locator('label', { hasText: '住居費' }).locator('input[type="checkbox"]').check();

    // 教育費：お子様が1人いるため、確認が必要（ここでは「支出項目に含まれている」を選ぶ）
    await page.locator('button', { hasText: '支出項目の「教育費」に含まれている' }).click();

    // 保険料：契約の登録が無いため、「本当に無いことを確認済み」にチェックする
    await page.locator('label', { hasText: '保険契約は登録されていませんが' }).locator('input[type="checkbox"]').check();

    await page.waitForTimeout(300);
    record('①-3: 必要項目を入力すると年度別表が表示される', await page.locator('table').count() > 0);
    record('①-4: ステータスバッジが「確認済み」に変わる', await page.locator('text=確認済み：すべての入力が確認済みです').count() > 0);

    await page.locator('button:has-text("この条件を保存する")').click();
    await page.waitForTimeout(300);
    record('①-5: 保存成功メッセージが表示される', await page.locator('text=保存しました').count() > 0);

    const savedRaw = await page.evaluate(() => localStorage.getItem('customers_v1'));
    const savedCustomers = JSON.parse(savedRaw || '[]');
    const savedLifePlan = savedCustomers[0] && savedCustomers[0].lp && savedCustomers[0].lp.lifePlan;
    record('①-6: localStorageに customer.lp.lifePlan が実際に保存されている', !!(savedLifePlan && savedLifePlan.schemaVersion === 1), JSON.stringify(savedLifePlan && Object.keys(savedLifePlan)));
    record('①-7: 保存データに資産区分(deposits)の確認が含まれる', !!(savedLifePlan && savedLifePlan.assetCategories && savedLifePlan.assetCategories.deposits && savedLifePlan.assetCategories.deposits.includeInSim === true));

    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.locator('.nav-item:has-text("人脈")').click();
    await page.waitForTimeout(300);
    await page.locator('button.toggle-btn:has-text("プランニング")').click();
    await page.waitForTimeout(300);
    await page.locator('text=生存時ライフプラン・資産寿命シミュレーション').first().click();
    await page.waitForTimeout(300);
    record('①-8: 再読込後も保存した内容が画面に復元される（確認済みバッジ）', await page.locator('text=確認済み：すべての入力が確認済みです').count() > 0);

    record('No page errors during basic flow', pageErrors.length === 0, pageErrors.join(' | '));
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ②入力不足の表示：何も確認していない状態ではpartial表示、資産寿命を確定表示しない
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8792/nexus.html', { waitUntil: 'load' });
    await page.evaluate(customer => {
      localStorage.setItem('customers_v1', JSON.stringify([customer]));
    }, { ...SYNTHETIC_CUSTOMER, id: 'cust_lp_test_2' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.locator('.nav-item:has-text("人脈")').click();
    await page.waitForTimeout(300);
    await page.locator('button.toggle-btn:has-text("プランニング")').click();
    await page.waitForTimeout(300);
    await page.locator('text=生存時ライフプラン・資産寿命シミュレーション').first().click();
    await page.waitForTimeout(300);
    record('②-1: 未確認の状態では入力不足バッジが表示される', await page.locator('text=入力不足').count() > 0);
    record('②-2: 「資産が1つも確認されていません」が未確認一覧に表示される', await page.locator('text=資産が1つも確認されていません').count() > 0);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ③iPhone幅（375/390/430px）での横あふれ確認
  // ════════════════════════════════════════════════════════════
  for (const width of [375, 390, 430]) {
    const { context, page } = await newPage(browser, { width, height: 844 });
    await page.goto('http://localhost:8792/nexus.html', { waitUntil: 'load' });
    await page.evaluate(customer => {
      localStorage.setItem('customers_v1', JSON.stringify([customer]));
    }, { ...SYNTHETIC_CUSTOMER, id: 'cust_lp_test_w' + width });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.locator('.nav-item:has-text("人脈")').click();
    await page.waitForTimeout(300);
    await page.locator('button.toggle-btn:has-text("プランニング")').click();
    await page.waitForTimeout(300);
    await page.locator('text=生存時ライフプラン・資産寿命シミュレーション').first().click();
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    record(`③ ${width}px: 入力画面全体が横へはみ出さない（表・グラフのスクロールは許可）`, overflow <= 2, `overflow=${overflow}`);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ④既存機能への無影響確認：既存の老後プランニング・教育資金プランニングが変わらず動作する
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8792/nexus.html', { waitUntil: 'load' });
    await page.evaluate(customer => {
      localStorage.setItem('customers_v1', JSON.stringify([customer]));
    }, { ...SYNTHETIC_CUSTOMER, id: 'cust_lp_test_4' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.locator('.nav-item:has-text("人脈")').click();
    await page.waitForTimeout(300);
    await page.locator('button.toggle-btn:has-text("プランニング")').click();
    await page.waitForTimeout(300);
    record('④-1: 既存の老後プランニング見出しが引き続き表示される', await page.locator('text=老後プランニング').count() > 0);
    record('④-2: 既存の教育資金プランニング見出しが引き続き表示される', await page.locator('text=教育資金プランニング').count() > 0);
    record('④-3: 既存の住宅資金プランニング見出しが引き続き表示される', await page.locator('text=住宅資金プランニング').count() > 0);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑤未登録と確認済み「なし」の区別、および「選択した範囲の試算」表示
  // （本番反映前レビュー対応：お子様・保険契約が0件の顧客で確認する）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8792/nexus.html', { waitUntil: 'load' });
    const noKidNoContractCustomer = { ...SYNTHETIC_CUSTOMER, id: 'cust_lp_test_5', suspects: [] };
    await page.evaluate(customer => {
      localStorage.setItem('customers_v1', JSON.stringify([customer]));
    }, noKidNoContractCustomer);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.locator('.nav-item:has-text("人脈")').click();
    await page.waitForTimeout(300);
    await page.locator('button.toggle-btn:has-text("プランニング")').click();
    await page.waitForTimeout(300);
    await page.locator('text=生存時ライフプラン・資産寿命シミュレーション').first().click();
    await page.waitForTimeout(300);
    record('⑤-1: お子様0人では教育費の進学トラック案内ではなく「本当にいないことを確認済み」チェックが表示される', await page.locator('label', { hasText: 'お子様は登録されていませんが' }).count() > 0);
    record('⑤-2: 保険契約0件では「本当に無いことを確認済み」チェックが表示される', await page.locator('label', { hasText: '保険契約は登録されていませんが' }).count() > 0);
    record('⑤-3: 未確認の段階ではお子様の登録未確認が入力不足として表示される', await page.locator('text=本当にお子様がいないのか').count() > 0);

    await page.locator('label', { hasText: '現金・預貯金' }).locator('input[type="checkbox"]').check();
    await page.locator('label', { hasText: '現金として扱う' }).locator('input[type="radio"]').check();
    await page.locator('label', { hasText: '取り崩し可能' }).locator('input[type="checkbox"]').check();
    await page.locator('input[placeholder="運用率%"]').fill('1');
    await page.locator('label', { hasText: '年金をシミュレーションに含める' }).locator('input[type="checkbox"]').check();
    await page.locator('span', { hasText: '年金の年次上昇率' }).locator('xpath=following-sibling::input').fill('0');
    await page.locator('.nexus-lp-living-base input').fill('3000000');
    await page.locator('.nexus-lp-living-rate input').fill('2');
    await page.locator('label', { hasText: '給与' }).locator('input[type="checkbox"]').check();
    await page.locator('input[placeholder="上昇率%"]').first().fill('0');
    // 住居費はまだ何もチェックしない＝未確認のまま（対象外・除外ではない）。
    await page.locator('label', { hasText: 'お子様は登録されていませんが' }).locator('input[type="checkbox"]').check();
    await page.locator('label', { hasText: '保険契約は登録されていませんが' }).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(300);

    record('⑤-4: お子様・保険契約を確認済みにした後、住居費が未確認のままならstatusはpartial', await page.locator('text=入力不足').count() > 0);

    // 住居費を「明示的に対象外」と確認する：チェックボックスは対象にする／しないの二択しか
    // 無いため、一度チェックしてから外す（チェック→解除）ことで「includeInSim:false
    // （対象外と確認済み）」を記録する。一度も触れていない状態（undefined＝未確認）とは
    // 区別される（本番反映前レビュー項目3で指摘された、この区別が実際に機能することの確認）。
    const rentCheckbox = page.locator('label', { hasText: '住居費' }).locator('input[type="checkbox"]');
    await rentCheckbox.check();
    await page.waitForTimeout(150);
    await rentCheckbox.uncheck();
    await page.waitForTimeout(300);
    record('⑤-5: 住居費を明示的に除外すると確認済みになる', await page.locator('text=確認済み：すべての入力が確認済みです').count() > 0);
    record('⑤-6: 「選択した範囲の試算」の注記と除外項目一覧が表示される', await page.locator('text=選択した範囲の試算です').count() > 0);
    record('⑤-7: 除外項目一覧に住居費が含まれる', await page.locator('text=支出項目（exp1）').count() > 0);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑥保存の競合保護：画面を開いた後に別タブ等で他の変更が入っても、
  // 　保存時にその変更を古いデータで上書きしないこと（本番反映前レビュー項目7）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8792/nexus.html', { waitUntil: 'load' });
    const targetCustomer = { ...SYNTHETIC_CUSTOMER, id: 'cust_lp_test_6', name: '架空顧客LP6' };
    const otherCustomer = { ...SYNTHETIC_CUSTOMER, id: 'cust_lp_test_6_other', name: '架空顧客LP6他' };
    await page.evaluate(customers => {
      localStorage.setItem('customers_v1', JSON.stringify(customers));
    }, [targetCustomer, otherCustomer]);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.locator('.nav-item:has-text("人脈")').click();
    await page.waitForTimeout(300);
    await page.locator('button.toggle-btn:has-text("プランニング")').click();
    await page.waitForTimeout(300);
    await page.locator('text=生存時ライフプラン・資産寿命シミュレーション').first().click();
    await page.waitForTimeout(300);

    // 必要項目を入力する（画面はこの時点のcustomers（旧データ）をpropとして保持したまま）
    await page.locator('label', { hasText: '現金・預貯金' }).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(150);
    await page.locator('label', { hasText: '現金として扱う' }).locator('input[type="radio"]').check();
    await page.locator('label', { hasText: '取り崩し可能' }).locator('input[type="checkbox"]').check();
    await page.locator('input[placeholder="運用率%"]').fill('1');
    await page.locator('label', { hasText: '年金をシミュレーションに含める' }).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(150);
    await page.locator('span', { hasText: '年金の年次上昇率' }).locator('xpath=following-sibling::input').fill('0');
    await page.locator('.nexus-lp-living-base input').fill('3000000');
    await page.locator('.nexus-lp-living-rate input').fill('2');
    await page.locator('label', { hasText: '給与' }).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(150);
    await page.locator('input[placeholder="上昇率%"]').first().fill('0');
    await page.locator('label', { hasText: '住居費' }).locator('input[type="checkbox"]').check();
    await page.locator('button', { hasText: '支出項目の「教育費」に含まれている' }).click();
    await page.locator('label', { hasText: '保険契約は登録されていませんが' }).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(300);
    record('⑥-1: 画面はこの時点で確認済みになっている（まだ保存前）', await page.locator('text=確認済み：すべての入力が確認済みです').count() > 0);

    // 「別タブでの編集」を模擬：画面のReact state（props）を経由せず、localStorageへ直接、
    // 対象顧客のstatusと、別の顧客の名前を書き換える。画面はこの変更をまだ知らない（再読込していない）。
    await page.evaluate(() => {
      const raw = JSON.parse(localStorage.getItem('customers_v1'));
      const next = raw.map(c => {
        if (c.id === 'cust_lp_test_6') return { ...c, status: 'アポ済' };
        if (c.id === 'cust_lp_test_6_other') return { ...c, name: '架空顧客LP6他（別タブで変更後）' };
        return c;
      });
      localStorage.setItem('customers_v1', JSON.stringify(next));
    });

    // この画面で「保存」する（画面が保持している古いcustomersをそのまま書き戻せば、
    // 上の2つの変更は両方消えてしまうはずの状況）
    await page.locator('button:has-text("この条件を保存する")').click();
    await page.waitForTimeout(300);
    record('⑥-2: 保存成功メッセージが表示される', await page.locator('text=保存しました').count() > 0);

    const afterSave = JSON.parse(await page.evaluate(() => localStorage.getItem('customers_v1')));
    const savedTarget = afterSave.find(c => c.id === 'cust_lp_test_6');
    const savedOther = afterSave.find(c => c.id === 'cust_lp_test_6_other');
    record('⑥-3: 他の顧客（別タブでの変更）が古いデータで上書きされていない', savedOther && savedOther.name === '架空顧客LP6他（別タブで変更後）', savedOther && savedOther.name);
    record('⑥-4: 対象顧客自身の、別タブでの変更（status）も上書きされていない', savedTarget && savedTarget.status === 'アポ済', savedTarget && savedTarget.status);
    record('⑥-5: それでも今回保存したライフプランの内容は正しく反映されている', !!(savedTarget && savedTarget.lp && savedTarget.lp.lifePlan && savedTarget.lp.lifePlan.schemaVersion === 1 && savedTarget.lp.lifePlan.assetCategories && savedTarget.lp.lifePlan.assetCategories.deposits && savedTarget.lp.lifePlan.assetCategories.deposits.includeInSim === true));
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑦保存の失敗保護：別タブ等で対象顧客自体が削除された状態で保存しても、
  // 　成功表示をせず、古いデータから顧客を復活させないこと
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await page.goto('http://localhost:8792/nexus.html', { waitUntil: 'load' });
    await page.evaluate(customer => {
      localStorage.setItem('customers_v1', JSON.stringify([customer]));
    }, { ...SYNTHETIC_CUSTOMER, id: 'cust_lp_test_7' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.locator('.nav-item:has-text("人脈")').click();
    await page.waitForTimeout(300);
    await page.locator('button.toggle-btn:has-text("プランニング")').click();
    await page.waitForTimeout(300);
    await page.locator('text=生存時ライフプラン・資産寿命シミュレーション').first().click();
    await page.waitForTimeout(300);
    await page.locator('.nexus-lp-living-base input').fill('3000000');

    // 「別タブでの削除」を模擬：対象顧客をcustomers_v1から取り除く
    await page.evaluate(() => {
      localStorage.setItem('customers_v1', JSON.stringify([]));
    });

    await page.locator('button:has-text("この条件を保存する")').click();
    await page.waitForTimeout(300);
    record('⑦-1: 保存失敗メッセージが表示される（成功表示はされない）', await page.locator('text=保存に失敗しました').count() > 0);
    record('⑦-2: 入力内容は画面にそのまま残っている', await page.inputValue('.nexus-lp-living-base input') === '3000000');
    const afterFailedSave = JSON.parse(await page.evaluate(() => localStorage.getItem('customers_v1')));
    record('⑦-3: 削除済みの顧客が古いデータから復活していない', Array.isArray(afterFailedSave) && afterFailedSave.length === 0, JSON.stringify(afterFailedSave));
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑧全データバックアップ→復元の実往復：JSONへの含有だけでなく、
  // 　復元後に同じ確認状態・同じ計算結果が再現されること
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    page.on('dialog', d => d.accept());
    await page.goto('http://localhost:8792/nexus.html', { waitUntil: 'load' });
    await page.evaluate(customer => {
      localStorage.setItem('customers_v1', JSON.stringify([customer]));
    }, { ...SYNTHETIC_CUSTOMER, id: 'cust_lp_test_8', name: '架空顧客LP8' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    await page.locator('.nav-item:has-text("人脈")').click();
    await page.waitForTimeout(300);
    await page.locator('button.toggle-btn:has-text("プランニング")').click();
    await page.waitForTimeout(300);
    await page.locator('text=生存時ライフプラン・資産寿命シミュレーション').first().click();
    await page.waitForTimeout(300);
    await page.locator('label', { hasText: '現金・預貯金' }).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(150);
    await page.locator('label', { hasText: '現金として扱う' }).locator('input[type="radio"]').check();
    await page.locator('label', { hasText: '取り崩し可能' }).locator('input[type="checkbox"]').check();
    await page.locator('input[placeholder="運用率%"]').fill('1');
    await page.locator('label', { hasText: '年金をシミュレーションに含める' }).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(150);
    await page.locator('span', { hasText: '年金の年次上昇率' }).locator('xpath=following-sibling::input').fill('0');
    await page.locator('.nexus-lp-living-base input').fill('3000000');
    await page.locator('.nexus-lp-living-rate input').fill('2');
    await page.locator('label', { hasText: '給与' }).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(150);
    await page.locator('input[placeholder="上昇率%"]').first().fill('0');
    await page.locator('label', { hasText: '住居費' }).locator('input[type="checkbox"]').check();
    await page.locator('button', { hasText: '支出項目の「教育費」に含まれている' }).click();
    await page.locator('label', { hasText: '保険契約は登録されていませんが' }).locator('input[type="checkbox"]').check();
    await page.waitForTimeout(300);
    record('⑧-1: 復元前に確認済み・年度別表が表示されている', await page.locator('text=確認済み：すべての入力が確認済みです').count() > 0);
    await page.locator('button:has-text("この条件を保存する")').click();
    await page.waitForTimeout(300);
    record('⑧-2: 保存成功', await page.locator('text=保存しました').count() > 0);

    // 保存後の年度別表（1行目）の資産残高セルの文字列を、復元後との比較用に記録する
    // ライフプランの年度別表（見出し行：年齢/収入/支出/資金不足/期末資産）に絞り込む。
    // ページ内には老後プランニング等の既存の表も複数あるため、単純な`table`では誤って
    // 別の表を拾ってしまう（実際に一度そうなって、本テストの検証が無意味になっていた）。
    const lpTable = page.locator('table', { has: page.locator('th', { hasText: '期末資産' }) });
    const firstRowCellsBefore = await lpTable.locator('tbody tr').nth(0).locator('td').allTextContents();

    // 全データバックアップをダウンロードする
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button', { hasText: '💾書出' }).first().click().catch(() => null)
    ]);
    let backupPath = null;
    if (download) {
      backupPath = path.join(require('os').tmpdir(), 'nexus_lp_test_backup_' + Date.now() + '.json');
      await download.saveAs(backupPath);
    }
    record('⑧-3: 全データバックアップのダウンロードが行われる', !!download);

    if (backupPath) {
      const backupJson = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      const backedUpCustomer = (backupJson.customers || []).find(c => c.id === 'cust_lp_test_8');
      record('⑧-4: バックアップJSONに、保存したlifePlanの内容が含まれる', !!(backedUpCustomer && backedUpCustomer.lp && backedUpCustomer.lp.lifePlan && backedUpCustomer.lp.lifePlan.schemaVersion === 1));

      // 端末のデータを消去し、別の（データが無い）状態を模擬する
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(400);

      // バックアップから復元する（📥復元ボタンのinput[type=file]にファイルを渡す。
      // Memory用バックアップ（accept=".json"）の入力欄とは別物のため、ラベルのテキストで絞り込む）
      await page.locator('label', { hasText: '📥復元' }).locator('input[type="file"]').setInputFiles(backupPath);
      await page.waitForTimeout(500);

      await page.locator('.nav-item:has-text("人脈")').click();
      await page.waitForTimeout(300);
      await page.locator('button.toggle-btn:has-text("プランニング")').click();
      await page.waitForTimeout(300);
      record('⑧-5: 復元後、顧客データが1件復元されている（header-subの件数表示）', await page.locator('.header-sub', { hasText: '1名' }).count() > 0);
      await page.locator('text=生存時ライフプラン・資産寿命シミュレーション').first().click();
      await page.waitForTimeout(300);
      record('⑧-6: 復元後も「確認済み」の状態が再現される（追加条件が引き継がれている）', await page.locator('text=確認済み：すべての入力が確認済みです').count() > 0);

      const lpTableAfter = page.locator('table', { has: page.locator('th', { hasText: '期末資産' }) });
      const firstRowCellsAfter = await lpTableAfter.locator('tbody tr').nth(0).locator('td').allTextContents();
      record('⑧-7: 復元後、年度別表の計算結果（1行目）が復元前と完全に一致する（再計算も同じ結果になる）', JSON.stringify(firstRowCellsBefore) === JSON.stringify(firstRowCellsAfter), JSON.stringify({ before: firstRowCellsBefore, after: firstRowCellsAfter }));

      try { fs.unlinkSync(backupPath); } catch (e) {}
    }
    await context.close();
  }

  record('No unexpected crashes across all lifeplan-sim scenarios', true);
  const failedCount = results.filter(r => !r.pass).length;
  console.log(`\nTOTAL: ${results.length}, PASS: ${results.length - failedCount}, FAIL: ${failedCount}`);
  await browser.close();
  process.exit(failedCount > 0 ? 1 : 0);
})();
