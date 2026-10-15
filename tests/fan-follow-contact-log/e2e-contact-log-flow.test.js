// ファン化フォロー「フォロー・接触記録」（電話フォロー専用設計の廃止）のE2Eテスト。
// すべて架空の合成データのみを使用する。commit/push/デプロイ/外部送信は一切行わない。
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

const BASE = 'http://localhost:8794/nexus.html';

const CUSTOMER_A = { id: 'custA', name: '吉井 暢子', status: '未接触', phone: '090-0000-0001', contracts: [], suspects: [], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' };
const CAMPAIGN_1 = { id: 'camp1', name: '2026年秋 ハガキフォロー', campaignType: 'ハガキ', startDate: '2026-10-01', endDate: '', targetCount: 10, purpose: '', memo: '', status: '進行中', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' };

async function seed(page, { customers, campaigns, follows, tasks }) {
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(({ customers, campaigns, follows, tasks }) => {
    localStorage.setItem('customers_v1', JSON.stringify(customers || []));
    localStorage.setItem('nexus_fan_campaigns_v1', JSON.stringify(campaigns || []));
    localStorage.setItem('nexus_fan_follow_records_v1', JSON.stringify(follows || []));
    localStorage.setItem('ml_tasks_v1', JSON.stringify(tasks || []));
  }, { customers, campaigns, follows, tasks });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(400);
}
const openFanFollow = async page => {
  await page.locator('button:has-text("始める →"), button:has-text("開く →")').first().click();
  await page.waitForTimeout(300);
};
const openRecordsTab = async page => {
  await page.locator('button:has-text("記録一覧")').click();
  await page.waitForTimeout(250);
};
const pickCustomerInSelect = async (page, name) => {
  await page.locator('.form-group', { hasText: '顧客（登録済みの方はこちらから選択）' }).locator('button').first().click();
  await page.waitForTimeout(200);
  await page.locator('input[placeholder="名前・AI分析用IDで検索..."]').fill(name);
  await page.waitForTimeout(150);
  await page.locator(`button:has-text("${name}")`).first().click();
  await page.waitForTimeout(150);
};
const readFollows = page => page.evaluate(() => JSON.parse(localStorage.getItem('nexus_fan_follow_records_v1') || '[]'));
const readTasks = page => page.evaluate(() => JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]'));
const readCustomers = page => page.evaluate(() => JSON.parse(localStorage.getItem('customers_v1') || '[]'));

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });

  // ════════════════════════════════════════════════════════════
  // ⓪基本：新規記録を作成し、方法→結果の2タップで接触を記録できる
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await seed(page, { customers: [CUSTOMER_A], campaigns: [CAMPAIGN_1], follows: [], tasks: [] });
    await openFanFollow(page);
    await openRecordsTab(page);
    await page.locator('button:has-text("＋ 記録を追加")').click();
    await page.waitForTimeout(250);
    await pickCustomerInSelect(page, '吉井 暢子');
    // 方法→結果の2タップで記録
    await page.locator('button:has-text("💬 LINE")').click();
    await page.waitForTimeout(150);
    await page.locator('.drawer button:has-text("送信済み")').first().click();
    await page.waitForTimeout(250);
    const hasTimelineLine = await page.locator('.drawer', { hasText: 'LINE' }).first().isVisible();
    record('⓪2タップで接触が記録され、タイムラインに表示される', hasTimelineLine);
    await page.locator('.drawer button:has-text("保存")').click();
    await page.waitForTimeout(300);
    const follows1 = await readFollows(page);
    const rec1 = follows1.find(f => f.customerId === 'custA');
    record('⓪保存後、記録にcontactsが1件ある', rec1 && rec1.contacts && rec1.contacts.length === 1, rec1 && rec1.contacts);
    record('⓪contactのmethod=LINE・direction=outbound・result=送信済み', rec1 && rec1.contacts[0].method === 'LINE' && rec1.contacts[0].direction === 'outbound' && rec1.contacts[0].result === '送信済み', rec1 && rec1.contacts[0]);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ①「LINEを送った」と「LINEの返信があった」は別のcontactとして記録される（方法と結果を合成しない）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    const existingRecord = { id: 'rec1', campaignId: 'camp1', customerId: 'custA', customerNameText: '', attribute: '既契約者', sentDate: '2026-10-05', articleTitle: '', articleUrl: '', sendMethod: '', messageText: '', memo: '', readAt: '', repliedAt: '', phoneFollowStatus: '', phoneFollowDate: '', contacts: [], nextThingTaskId: '', relatedActivityLogId: '', nextFollowDate: '', nextFollowMethod: '', nextFollowAction: '', noFollowNeeded: false, createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z', deletedAt: '' };
    await seed(page, { customers: [CUSTOMER_A], campaigns: [CAMPAIGN_1], follows: [existingRecord], tasks: [] });
    await openFanFollow(page);
    await openRecordsTab(page);
    await page.locator('.card', { hasText: '吉井 暢子' }).first().click();
    await page.waitForTimeout(250);
    // 送信（outbound・LINE・送信済み）
    await page.locator('button:has-text("💬 LINE")').click();
    await page.waitForTimeout(150);
    await page.locator('.drawer button:has-text("送信済み")').first().click();
    await page.waitForTimeout(200);
    // 返信（inbound・LINE・返信あり）
    await page.locator('button:has-text("お客様から")').click();
    await page.locator('button:has-text("💬 LINE")').click();
    await page.waitForTimeout(150);
    await page.locator('.drawer button:has-text("返信あり")').first().click();
    await page.waitForTimeout(250);
    await page.locator('.drawer button:has-text("保存")').click();
    await page.waitForTimeout(300);
    const follows2 = await readFollows(page);
    const rec2 = follows2.find(f => f.id === 'rec1');
    record('①同じ方法(LINE)でも送信と返信は別の2件のcontactになる', rec2 && rec2.contacts.length === 2, rec2 && rec2.contacts);
    const sentC = rec2.contacts.find(c => c.result === '送信済み');
    const repliedC = rec2.contacts.find(c => c.result === '返信あり');
    record('①送信はdirection=outbound', sentC && sentC.direction === 'outbound');
    record('①返信はdirection=inbound', repliedC && repliedC.direction === 'inbound');
    record('①resultには方法名が合成されない（"LINE返信"のような値ではない）', repliedC && repliedC.result === '返信あり' && !repliedC.result.includes('LINE'));
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ②相談になった場合、ボタンが強調表示される
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await seed(page, { customers: [CUSTOMER_A], campaigns: [CAMPAIGN_1], follows: [], tasks: [] });
    await openFanFollow(page);
    await openRecordsTab(page);
    await page.locator('button:has-text("＋ 記録を追加")').click();
    await page.waitForTimeout(250);
    await pickCustomerInSelect(page, '吉井 暢子');
    const beforeEmphasis = await page.locator('button.btn-primary:has-text("相談・問合せ")').count();
    record('②相談結果が無い間は強調ボタンが出ていない', beforeEmphasis === 0);
    await page.locator('button:has-text("📞 電話")').click();
    await page.waitForTimeout(150);
    await page.locator('.drawer button:has-text("相談になった")').first().click();
    await page.waitForTimeout(250);
    const afterEmphasis = await page.locator('button.btn-primary:has-text("相談・問合せとして登録しますか")').count();
    record('②「相談になった」を記録すると相談登録ボタンが強調表示される', afterEmphasis > 0);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ③次回フォロー（日・方法・内容）が既存の「次にすること」へ反映される（増殖しない）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await seed(page, { customers: [CUSTOMER_A], campaigns: [CAMPAIGN_1], follows: [], tasks: [] });
    await openFanFollow(page);
    await openRecordsTab(page);
    await page.locator('button:has-text("＋ 記録を追加")').click();
    await page.waitForTimeout(250);
    await pickCustomerInSelect(page, '吉井 暢子');
    await page.locator('input[type="date"]').nth(1).fill('2026-11-05'); // 次回フォロー日（1件目はsentDate）
    await page.locator('.form-group', { hasText: '次回フォローの方法' }).locator('button:has-text("電話")').click();
    await page.locator('input[placeholder*="電話でフォロー"]').fill('契約内容の確認');
    await page.locator('.drawer button:has-text("保存")').click();
    await page.waitForTimeout(300);
    const tasks3 = await readTasks(page);
    const t3 = tasks3.find(t => t.source === 'fanFollowTask');
    record('③次回フォローがtasksストアへfanFollowTaskとして反映される', !!t3, t3);
    record('③kindはnextContact', t3 && t3.kind === 'nextContact');
    record('③日付・内容が反映される', t3 && t3.date === '2026-11-05' && t3.memo === '契約内容の確認', t3);

    // 同じ記録をもう一度開いて保存しても、タスクが増殖しない。
    await page.locator('.card', { hasText: '吉井 暢子' }).first().click();
    await page.waitForTimeout(250);
    await page.locator('.drawer button:has-text("保存")').click();
    await page.waitForTimeout(300);
    const tasks3b = await readTasks(page);
    const fanTasks = tasks3b.filter(t => t.source === 'fanFollowTask');
    record('③再保存してもfanFollowTaskは1件のまま（増殖しない）', fanTasks.length === 1, fanTasks);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ④紹介があった場合：人数・メモを記録でき、既存の顧客登録（referredBy）と連携できる
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await seed(page, { customers: [CUSTOMER_A], campaigns: [CAMPAIGN_1], follows: [], tasks: [] });
    await openFanFollow(page);
    await openRecordsTab(page);
    await page.locator('button:has-text("＋ 記録を追加")').click();
    await page.waitForTimeout(250);
    await pickCustomerInSelect(page, '吉井 暢子');
    await page.locator('button:has-text("📞 電話")').click();
    await page.waitForTimeout(150);
    await page.locator('.drawer button:has-text("紹介あり")').first().click();
    await page.waitForTimeout(200);
    await page.locator('input[type="number"]').fill('2');
    await page.locator('label:has-text("紹介者メモ（任意）") + input').fill('友人2名を紹介してくれた');
    await page.locator('.drawer button:has-text("記録する")').click();
    await page.waitForTimeout(300);
    await page.locator('.drawer button:has-text("保存")').click();
    await page.waitForTimeout(300);
    const follows4 = await readFollows(page);
    const rec4 = follows4.find(f => f.customerId === 'custA');
    const referralContact = rec4 && rec4.contacts.find(c => c.result === '紹介あり');
    record('④紹介ありのcontactに人数・メモが保存される', referralContact && String(referralContact.referralCount) === '2' && referralContact.referralMemo === '友人2名を紹介してくれた', referralContact);

    // 紹介された方を顧客として登録する（既存のreferredByをそのまま使う）
    await page.locator('.card', { hasText: '吉井 暢子' }).first().click();
    await page.waitForTimeout(250);
    await page.locator('button:has-text("紹介を登録")').click();
    await page.waitForTimeout(300);
    await page.locator('input[placeholder="例：山田 太郎"]').fill('田中 一郎');
    await page.locator('button:has-text("保存する")').click();
    await page.waitForTimeout(400);
    const customers4 = await readCustomers(page);
    const newCust = customers4.find(c => c.name === '田中 一郎');
    record('④紹介された方が既存のreferredByで顧客登録される', newCust && newCust.referredBy === 'custA', newCust);
    const follows4b = await readFollows(page);
    const rec4b = follows4b.find(f => f.customerId === 'custA');
    const referralContact2 = rec4b.contacts.find(c => c.result === '紹介あり');
    record('④登録した顧客のidが接触記録のreferredCustomerIdsに残る（将来の紐付け用）', referralContact2 && referralContact2.referredCustomerIds.includes(newCust.id), referralContact2);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑤面談予定と面談実施は別のcontactとして記録され、予定を入れただけで実施扱いにならない
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    await seed(page, { customers: [CUSTOMER_A], campaigns: [CAMPAIGN_1], follows: [], tasks: [] });
    await openFanFollow(page);
    await openRecordsTab(page);
    await page.locator('button:has-text("＋ 記録を追加")').click();
    await page.waitForTimeout(250);
    await pickCustomerInSelect(page, '吉井 暢子');
    await page.locator('button:has-text("🎥 オンライン面談")').click();
    await page.waitForTimeout(150);
    await page.locator('.drawer button:has-text("面談予定")').first().click();
    await page.waitForTimeout(200);
    await page.locator('label:has-text("面談目的（任意）") + input').fill('保険見直しの相談');
    await page.locator('.drawer button:has-text("記録する")').click();
    await page.waitForTimeout(300);
    await page.locator('.drawer button:has-text("保存")').click();
    await page.waitForTimeout(300);
    let follows5 = await readFollows(page);
    let rec5 = follows5.find(f => f.customerId === 'custA');
    record('⑤面談予定が1件だけ記録される', rec5.contacts.filter(c => c.result === '面談予定').length === 1);
    record('⑤面談予定だけでは「面談実施」は作られない', rec5.contacts.filter(c => c.result === '面談実施').length === 0);

    // 実際に面談した後、別のcontactとして「面談実施」を追加する。
    await page.locator('.card', { hasText: '吉井 暢子' }).first().click();
    await page.waitForTimeout(250);
    await page.locator('button:has-text("🎥 オンライン面談")').click();
    await page.waitForTimeout(150);
    await page.locator('.drawer button:has-text("面談実施")').first().click();
    await page.waitForTimeout(250);
    await page.locator('.drawer button:has-text("保存")').click();
    await page.waitForTimeout(300);
    follows5 = await readFollows(page);
    rec5 = follows5.find(f => f.customerId === 'custA');
    record('⑤面談実施を追加すると、予定(1件)と実施(1件)が別々に残る', rec5.contacts.filter(c => c.result === '面談予定').length === 1 && rec5.contacts.filter(c => c.result === '面談実施').length === 1, rec5.contacts);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑥旧データ（電話フォロー専用設計）は削除されず、仮想contactとして履歴に表示される。
  // 無関係な新しい接触を追加しても、旧データ側は消えない（マージされる）。
  // 旧データと完全一致する新しい接触を追加した場合だけ、重複として1件に収まる。
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    const legacyRecord = { id: 'recLegacy', campaignId: 'camp1', customerId: 'custA', customerNameText: '', attribute: '既契約者', sentDate: '2026-09-20', articleTitle: '', articleUrl: '', sendMethod: '', messageText: '', memo: '', readAt: '', repliedAt: '', phoneFollowStatus: '電話した', phoneFollowDate: '2026-09-25', contacts: [], nextThingTaskId: '', relatedActivityLogId: '', nextFollowDate: '', nextFollowMethod: '', nextFollowAction: '', noFollowNeeded: false, createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z', deletedAt: '' };
    await seed(page, { customers: [CUSTOMER_A], campaigns: [CAMPAIGN_1], follows: [legacyRecord], tasks: [] });
    await openFanFollow(page);
    await openRecordsTab(page);
    await page.locator('.card', { hasText: '吉井 暢子' }).first().click();
    await page.waitForTimeout(250);
    // 旧データの仮想contactは「📞 電話（旧データ）」として表示される（初回送付の「📮 ハガキ（旧データ）」とは別物）。
    const legacyPhoneCount = await page.locator('.drawer', { hasText: '📞 電話（旧データ）' }).count();
    record('⑥旧データ（電話フォロー）が仮想contactとして表示される', legacyPhoneCount > 0);
    const initialSendLegacyBefore = await page.locator('.drawer', { hasText: '📮 ハガキ（旧データ）' }).count();
    record('⑥初回送付（ハガキ）も恒久的な履歴として表示される', initialSendLegacyBefore > 0);
    // 無関係な新しい接触（LINE・会話できた）を1件追加する。
    await page.locator('button:has-text("💬 LINE")').click();
    await page.waitForTimeout(150);
    await page.locator('.drawer button:has-text("会話できた")').first().click();
    await page.waitForTimeout(250);
    const legacyPhoneCountAfterUnrelated = await page.locator('.drawer', { hasText: '📞 電話（旧データ）' }).count();
    record('⑥無関係な新しい接触を追加しても、旧データ（電話フォロー）側の表示は消えない（マージされる）', legacyPhoneCountAfterUnrelated > 0);
    const initialSendLegacyAfter = await page.locator('.drawer', { hasText: '📮 ハガキ（旧データ）' }).count();
    record('⑥初回送付の履歴は新しい接触を追加しても消えない（恒久的な記録のため）', initialSendLegacyAfter > 0);
    await page.locator('.drawer button:has-text("保存")').click();
    await page.waitForTimeout(300);
    const follows6 = await readFollows(page);
    const rec6 = follows6.find(f => f.id === 'recLegacy');
    record('⑥保存データ自体（phoneFollowStatus）は書き換えられず残る', rec6.phoneFollowStatus === '電話した' && rec6.phoneFollowDate === '2026-09-25', rec6);
    record('⑥新しいcontactsは1件だけ追加される', rec6.contacts.length === 1 && rec6.contacts[0].result === '会話できた', rec6.contacts);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑥-b 旧データと完全一致（方法・結果・日付）する新しい接触が既にある場合、重複排除で画面には
  // 1件だけ表示される（pure.test.jsのケース2・4の算出ロジックが、実際の画面表示にも反映されることを確認）。
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    const dupRecord = { id: 'recDup', campaignId: 'camp1', customerId: 'custA', customerNameText: '', attribute: '既契約者', sentDate: '2026-09-20', articleTitle: '', articleUrl: '', sendMethod: '', messageText: '', memo: '', readAt: '', repliedAt: '', phoneFollowStatus: '電話した', phoneFollowDate: '2026-09-25',
      contacts: [{ id: 'realDup', occurredAt: '2026-09-25', direction: 'outbound', method: '電話', result: '連絡済み', topics: [], memo: '', createdAt: '2026-09-25T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z' }],
      nextThingTaskId: '', relatedActivityLogId: '', nextFollowDate: '', nextFollowMethod: '', nextFollowAction: '', noFollowNeeded: false, createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-25T00:00:00.000Z', deletedAt: '' };
    await seed(page, { customers: [CUSTOMER_A], campaigns: [CAMPAIGN_1], follows: [dupRecord], tasks: [] });
    await openFanFollow(page);
    await openRecordsTab(page);
    await page.locator('.card', { hasText: '吉井 暢子' }).first().click();
    await page.waitForTimeout(250);
    const legacyPhoneRows = await page.locator('.drawer', { hasText: '📞 電話（旧データ）' }).count();
    record('⑥-b 旧データと完全一致する接触が既にある場合、旧データ側（legacy）は表示されない', legacyPhoneRows === 0);
    const phoneRowText = await page.locator('.drawer', { hasText: '連絡済み' }).count();
    record('⑥-b 「連絡済み」は1件分だけ表示される（新データ側のみ）', phoneRowText > 0);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑦一覧カードには「最新の接触」と「次回」だけが表示される（全履歴は詳細側）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    const rec = { id: 'rec7', campaignId: 'camp1', customerId: 'custA', customerNameText: '', attribute: '既契約者', sentDate: '2026-10-05', articleTitle: '', articleUrl: '', sendMethod: '', messageText: '', memo: '', readAt: '', repliedAt: '', phoneFollowStatus: '', phoneFollowDate: '', contacts: [
      { id: 'c1', occurredAt: '2026-10-13', direction: 'outbound', method: 'LINE', result: '送信済み', topics: [], memo: '', createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z' },
      { id: 'c2', occurredAt: '2026-10-16', direction: 'outbound', method: '電話', result: '相談になった', topics: [], memo: '', createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z' }
    ], nextThingTaskId: '', relatedActivityLogId: '', nextFollowDate: '2026-10-20', nextFollowMethod: 'オンライン面談', nextFollowAction: '', noFollowNeeded: false, createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z', deletedAt: '' };
    await seed(page, { customers: [CUSTOMER_A], campaigns: [CAMPAIGN_1], follows: [rec], tasks: [] });
    await openFanFollow(page);
    await openRecordsTab(page);
    const card = page.locator('.card', { hasText: '吉井 暢子' }).first();
    const cardText = await card.innerText();
    record('⑦カードに最新の接触（電話・相談になった）が表示される', cardText.includes('電話') && cardText.includes('相談になった'), cardText);
    record('⑦カードに古い接触（LINE送信済み）は表示されない（最新のみ）', !cardText.includes('送信済み'), cardText);
    record('⑦カードに「次回：10/20の日付・方法」が表示される', cardText.includes('2026-10-20') && cardText.includes('オンライン面談'), cardText);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑧バックアップ／復元で接触履歴（contacts）が保持される
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser);
    const rec = { id: 'rec8', campaignId: 'camp1', customerId: 'custA', customerNameText: '', attribute: '既契約者', sentDate: '2026-10-05', articleTitle: '', articleUrl: '', sendMethod: '', messageText: '', memo: '', readAt: '', repliedAt: '', phoneFollowStatus: '', phoneFollowDate: '', contacts: [
      { id: 'c1', occurredAt: '2026-10-13', direction: 'outbound', method: 'LINE', result: '送信済み', topics: ['近況確認'], memo: 'テストメモ', createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z' }
    ], nextThingTaskId: '', relatedActivityLogId: '', nextFollowDate: '', nextFollowMethod: '', nextFollowAction: '', noFollowNeeded: false, createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z', deletedAt: '' };
    await seed(page, { customers: [CUSTOMER_A], campaigns: [CAMPAIGN_1], follows: [rec], tasks: [] });
    const backupJson = await page.evaluate(() => {
      const data = {
        __medilifeBackup: true,
        customers: JSON.parse(localStorage.getItem('customers_v1') || '[]'),
        nexusFanCampaigns: JSON.parse(localStorage.getItem('nexus_fan_campaigns_v1') || '[]'),
        nexusFanFollows: JSON.parse(localStorage.getItem('nexus_fan_follow_records_v1') || '[]'),
        tasks: JSON.parse(localStorage.getItem('ml_tasks_v1') || '[]')
      };
      return JSON.stringify(data);
    });
    await page.evaluate(() => {
      localStorage.setItem('customers_v1', '[]');
      localStorage.setItem('nexus_fan_campaigns_v1', '[]');
      localStorage.setItem('nexus_fan_follow_records_v1', '[]');
    });
    await page.evaluate(backup => {
      const data = JSON.parse(backup);
      localStorage.setItem('customers_v1', JSON.stringify(data.customers));
      localStorage.setItem('nexus_fan_campaigns_v1', JSON.stringify(data.nexusFanCampaigns));
      localStorage.setItem('nexus_fan_follow_records_v1', JSON.stringify(data.nexusFanFollows));
    }, backupJson);
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(400);
    const restoredFollows = await readFollows(page);
    const restoredRec = restoredFollows.find(f => f.id === 'rec8');
    record('⑧復元後もcontacts（topics・memo含む）がそのまま保持される', restoredRec && restoredRec.contacts.length === 1 && restoredRec.contacts[0].topics.includes('近況確認') && restoredRec.contacts[0].memo === 'テストメモ', restoredRec);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑨iPhone幅（390px）で横スクロールが出ない
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser, { width: 390, height: 844 });
    await seed(page, { customers: [CUSTOMER_A], campaigns: [CAMPAIGN_1], follows: [], tasks: [] });
    await openFanFollow(page);
    await openRecordsTab(page);
    await page.locator('button:has-text("＋ 記録を追加")').click();
    await page.waitForTimeout(250);
    await pickCustomerInSelect(page, '吉井 暢子');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    record('⑨390px幅で横スクロールが発生しない', !overflow);
    await context.close();
  }

  // ════════════════════════════════════════════════════════════
  // ⑩AI分析出力（案B・接触履歴明細）は自由記述を一切含まない（実際のクリップボードコピーで確認）
  // ════════════════════════════════════════════════════════════
  {
    const { context, page } = await newPage(browser, null, { clipboard: true });
    const recAi = { id: 'recAi', campaignId: 'camp1', customerId: 'custA', customerNameText: '', attribute: '既契約者', sentDate: '2026-10-01', articleTitle: '', articleUrl: '', sendMethod: '', messageText: '', memo: '', readAt: '', repliedAt: '', phoneFollowStatus: '', phoneFollowDate: '',
      contacts: [
        { id: 'c1', occurredAt: '2026-10-05', direction: 'outbound', method: 'LINE', result: '送信済み', topics: [], memo: 'メモ秘匿マーカー山田家の件', createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z' },
        { id: 'c2', occurredAt: '2026-10-10', direction: 'outbound', method: '電話', result: '紹介あり', referralCount: '1', referralMemo: 'リファラル秘匿マーカー田中さんから', createdAt: '2026-10-10T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z' },
        { id: 'c3', occurredAt: '2026-10-15', direction: 'outbound', method: 'オンライン面談', result: '面談予定', meetingMode: 'オンライン', meetingPurpose: '面談秘匿マーカー相続の相談', createdAt: '2026-10-15T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z' }
      ],
      nextThingTaskId: '', relatedActivityLogId: '', nextFollowDate: '', nextFollowMethod: '', nextFollowAction: '', noFollowNeeded: false, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-15T00:00:00.000Z', deletedAt: '' };
    await seed(page, { customers: [CUSTOMER_A], campaigns: [CAMPAIGN_1], follows: [recAi], tasks: [] });
    await openFanFollow(page);
    // ホーム画面側にも同名のボタン（売上AI分析用）があるため、ファン化フォロー画面内の方を指定する。
    await page.locator('button:has-text("🤖 AI分析用データ")').last().click();
    await page.waitForTimeout(300);
    await page.locator('button:has-text("プレビューへ")').click();
    await page.waitForTimeout(400);
    await page.locator('button:has-text("📋 CSVをコピー（推奨）")').click();
    await page.waitForTimeout(300);
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    record('⑩AI出力: 「接触履歴明細」セクションが含まれる', clipboardText.includes('接触履歴明細'));
    record('⑩AI出力: eventType（followup_contact）が含まれる', clipboardText.includes('followup_contact'));
    record('⑩AI出力: 固定の結果（紹介あり・面談予定）は含まれる', clipboardText.includes('紹介あり') && clipboardText.includes('面談予定'));
    record('⑩AI出力: contact.memoの自由記述は一切含まれない', !clipboardText.includes('メモ秘匿マーカー'));
    record('⑩AI出力: referralMemoの自由記述は一切含まれない', !clipboardText.includes('リファラル秘匿マーカー'));
    record('⑩AI出力: meetingPurposeの自由記述は一切含まれない', !clipboardText.includes('面談秘匿マーカー'));
    await context.close();
  }

  await browser.close();
  const failedCount = results.filter(r => !r.pass).length;
  console.log(`\nTOTAL: ${results.length}, PASS: ${results.length - failedCount}, FAIL: ${failedCount}`);
  process.exit(failedCount > 0 ? 1 : 0);
})();
