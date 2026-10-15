// ファン化フォロー「フォロー・接触記録」（電話フォロー専用設計の廃止・1contact=1回の接触への
// 再設計）の純粋関数テスト（合成データのみ）。
// 実行: node tests/fan-follow-contact-log/pure.test.js
// 依存: Node.jsのみ。常にリポジトリ直下のnexus.htmlから対象関数を直接読み込んで評価する
// （tests/dot-bridge-phase2/pure.test.js等と同じ抽出パターン）。
const fs = require('fs');
const path = require('path');

const NEXUS_HTML_PATH = path.join(__dirname, '..', '..', 'nexus.html');
const html = fs.readFileSync(NEXUS_HTML_PATH, 'utf8');
const scriptStart = html.indexOf('<script>const {');
const appStart = html.indexOf('function App() {');
if (scriptStart === -1 || appStart === -1 || appStart <= scriptStart) {
  throw new Error('nexus.htmlから対象スクリプトを抽出できませんでした（構造が変わった可能性があります）');
}
const code = html.slice(scriptStart + '<script>'.length, appStart);

global.React = {
  useState: () => [undefined, () => {}],
  useCallback: fn => fn,
  useMemo: fn => fn(),
  useEffect: () => {},
  createElement: () => null,
  Fragment: Symbol('Fragment')
};
global.localStorage = (() => {
  let store = {};
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    clear: () => { store = {}; }
  };
})();
global.navigator = {};
global.document = {
  createElement: () => ({ click: () => {}, style: {} }),
  getElementById: () => null
};
global.window = global;

eval(code);

const results = [];
function record(label, cond, extra) {
  results.push({ label, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (extra !== undefined ? ' -- ' + JSON.stringify(extra) : ''));
}

function makeRecord(overrides) {
  return {
    id: 'rec1', campaignId: 'camp1', customerId: 'cust1', customerNameText: '',
    attribute: '既契約者', sentDate: '2026-10-05', articleTitle: '', articleUrl: '', sendMethod: '',
    messageText: '', memo: '',
    readAt: '', repliedAt: '', phoneFollowStatus: '', phoneFollowDate: '',
    contacts: [], nextThingTaskId: '',
    relatedActivityLogId: '', nextFollowDate: '', nextFollowMethod: '', nextFollowAction: '',
    noFollowNeeded: false, createdAt: '2026-10-05T00:00:00.000Z', updatedAt: '2026-10-05T00:00:00.000Z', deletedAt: '',
    ...overrides
  };
}

// ①nexusFanContactBlank：新規contactの初期形
{
  const blank = nexusFanContactBlank();
  record('①blank: directionの初期値はoutbound', blank.direction === 'outbound');
  record('①blank: topics/referredCustomerIdsは空配列', Array.isArray(blank.topics) && blank.topics.length === 0 && Array.isArray(blank.referredCustomerIds) && blank.referredCustomerIds.length === 0);
}

// ②nexusFanActiveContacts：ソフトデリート済みは除外
{
  const record1 = makeRecord({ contacts: [
    { id: 'c1', occurredAt: '2026-10-10', direction: 'outbound', method: 'LINE', result: '送信済み' },
    { id: 'c2', occurredAt: '2026-10-11', direction: 'inbound', method: 'LINE', result: '返信あり', deletedAt: '2026-10-12T00:00:00.000Z' }
  ] });
  const active = nexusFanActiveContacts(record1);
  record('②active: 削除済みは除外され1件だけ残る', active.length === 1 && active[0].id === 'c1', active);
}

// ③nexusFanInitialSendVirtualContact：初回送付の仮想contact
{
  record('③initial: sentDateが無ければnull', nexusFanInitialSendVirtualContact(makeRecord({ sentDate: '' }), '記事') === null);
  const postcard = nexusFanInitialSendVirtualContact(makeRecord({ sentDate: '2026-10-05', sendMethod: '' }), 'ハガキ');
  record('③initial: ハガキはmethod=ハガキ・result=発送済み', postcard.method === 'ハガキ' && postcard.result === '発送済み', postcard);
  const article = nexusFanInitialSendVirtualContact(makeRecord({ sentDate: '2026-10-05', sendMethod: 'LINE' }), '記事');
  record('③initial: 記事はsendMethodがあればそれをmethodに使う', article.method === 'LINE' && article.result === '送信済み', article);
}

// ④nexusFanLegacyFollowupVirtualContacts：旧スカラー項目からの仮想変換
{
  const none = nexusFanLegacyFollowupVirtualContacts(makeRecord({}));
  record('④legacy: 旧項目が何も無ければ空配列', none.length === 0, none);
  const readOnly = nexusFanLegacyFollowupVirtualContacts(makeRecord({ readAt: '2026-10-07' }));
  record('④legacy: readAtは既読として1件', readOnly.length === 1 && readOnly[0].result === '既読' && readOnly[0].legacy === true, readOnly);
  const repliedOnly = nexusFanLegacyFollowupVirtualContacts(makeRecord({ repliedAt: '2026-10-08' }));
  record('④legacy: repliedAtは返信ありとして1件', repliedOnly.length === 1 && repliedOnly[0].result === '返信あり', repliedOnly);
  const phoneCalled = nexusFanLegacyFollowupVirtualContacts(makeRecord({ phoneFollowStatus: '電話した', phoneFollowDate: '2026-10-09' }));
  record('④legacy: 電話した→結果は連絡済み', phoneCalled.length === 1 && phoneCalled[0].result === '連絡済み' && phoneCalled[0].method === '電話', phoneCalled);
  const phoneBusy = nexusFanLegacyFollowupVirtualContacts(makeRecord({ phoneFollowStatus: '不通', phoneFollowDate: '2026-10-09' }));
  record('④legacy: 不通はそのまま不通', phoneBusy[0].result === '不通');
  const phoneWaiting = nexusFanLegacyFollowupVirtualContacts(makeRecord({ phoneFollowStatus: '折返し待ち', phoneFollowDate: '2026-10-09' }));
  record('④legacy: 折返し待ちはそのまま折返し待ち', phoneWaiting[0].result === '折返し待ち');
  const phoneNotYet = nexusFanLegacyFollowupVirtualContacts(makeRecord({ phoneFollowStatus: '未実施' }));
  record('④legacy: 未実施（まだ電話していない）は履歴に出さない', phoneNotYet.length === 0, phoneNotYet);
}

// ⑤nexusFanNormalizedContacts：旧データ・新データのマージ＋重複排除（二者択一ではない）
{
  const legacyOnly = makeRecord({ readAt: '2026-10-07', repliedAt: '2026-10-08' });
  const r1 = nexusFanNormalizedContacts(legacyOnly);
  record('⑤normalized: contacts空＝旧データの仮想変換が返る（2件）', r1.length === 2, r1);

  // 旧データ（readAt）が物理的に残っていても、関係ない新データが追加されただけなら、
  // 旧データ由来の履歴は消えない（マージされる）。
  const unrelatedNew = makeRecord({
    readAt: '2026-10-07',
    contacts: [{ id: 'c1', occurredAt: '2026-10-15', direction: 'outbound', method: '電話', result: '会話できた' }]
  });
  const r2 = nexusFanNormalizedContacts(unrelatedNew);
  record('⑤normalized: 無関係な新データを追加しても旧データ（既読）は消えない（マージされる）', r2.length === 2 && r2.some(c => c.result === '既読') && r2.some(c => c.result === '会話できた'), r2);

  // ケース1（ユーザー指定）：旧10/13電話した＋新10/20LINE送信→両方残る。
  const case1 = makeRecord({
    phoneFollowStatus: '電話した', phoneFollowDate: '2026-10-13',
    contacts: [{ id: 'c1', occurredAt: '2026-10-20', direction: 'outbound', method: 'LINE', result: '送信済み' }]
  });
  const r3 = nexusFanNormalizedContacts(case1);
  record('⑤ケース1: 旧（電話10/13）と新（LINE10/20）の両方が残る（2件）', r3.length === 2, r3);
  record('⑤ケース1: 電話・連絡済みが含まれる', r3.some(c => c.method === '電話' && c.result === '連絡済み' && c.occurredAt === '2026-10-13'), r3);
  record('⑤ケース1: LINE・送信済みが含まれる', r3.some(c => c.method === 'LINE' && c.result === '送信済み' && c.occurredAt === '2026-10-20'), r3);

  // ケース2（ユーザー指定）：旧10/13電話した＋新contactsに同じ10/13電話・連絡済みと10/20LINE送信
  // →10/13電話は1件だけ（重複排除）。
  const case2 = makeRecord({
    phoneFollowStatus: '電話した', phoneFollowDate: '2026-10-13',
    contacts: [
      { id: 'c1', occurredAt: '2026-10-13', direction: 'outbound', method: '電話', result: '連絡済み' },
      { id: 'c2', occurredAt: '2026-10-20', direction: 'outbound', method: 'LINE', result: '送信済み' }
    ]
  });
  const r4 = nexusFanNormalizedContacts(case2);
  record('⑤ケース2: 重複した10/13電話は1件だけに収まる（3件ではなく2件）', r4.length === 2, r4);
  record('⑤ケース2: 残る10/13電話は新データ側（legacy=false）', r4.find(c => c.occurredAt === '2026-10-13').legacy === false, r4);
  record('⑤ケース2: 10/20LINEも残る', r4.some(c => c.occurredAt === '2026-10-20' && c.method === 'LINE'), r4);

  // ケース3（ユーザー指定）：readAt／repliedAt／phoneFollowStatusが存在し、その後contactsが
  // 追加されても、旧履歴（3件とも）が消えない。
  const case3 = makeRecord({
    readAt: '2026-10-07', repliedAt: '2026-10-08', phoneFollowStatus: '電話した', phoneFollowDate: '2026-10-09',
    contacts: [{ id: 'c1', occurredAt: '2026-10-20', direction: 'outbound', method: 'LINE', result: '送信済み' }]
  });
  const r5 = nexusFanNormalizedContacts(case3);
  record('⑤ケース3: 旧データ3件＋新データ1件＝4件とも残る', r5.length === 4, r5);
  record('⑤ケース3: 既読・返信あり・連絡済みがすべて含まれる', ['既読', '返信あり', '連絡済み'].every(res => r5.some(c => c.result === res)), r5);

  // ケース4（ユーザー指定）：旧＋新が混在しても、集計（既読／返信）が二重カウントされない。
  // 旧readAtの仮想contactはmethodにsendMethodを使うため、新データ側と同じLINEに揃える。
  const case4 = makeRecord({ readAt: '2026-10-07', sendMethod: 'LINE', contacts: [{ id: 'c1', occurredAt: '2026-10-07', direction: 'inbound', method: 'LINE', result: '既読' }] });
  const r6 = nexusFanNormalizedContacts(case4);
  record('⑤ケース4: 旧既読と新既読が完全一致（同日・同method・同result）なら重複排除で1件のみ', r6.filter(c => c.result === '既読').length === 1, r6);
}

// ⑥nexusFanContactTimeline：初回送付＋以降の接触を新しい順で返す
{
  const rec = makeRecord({
    sentDate: '2026-10-05',
    contacts: [
      { id: 'c1', occurredAt: '2026-10-13', direction: 'outbound', method: 'LINE', result: '送信済み' },
      { id: 'c2', occurredAt: '2026-10-16', direction: 'outbound', method: '電話', result: '会話できた' }
    ]
  });
  const tl = nexusFanContactTimeline(rec, '記事');
  record('⑥timeline: 3件（初回送付＋2件）', tl.length === 3, tl.map(c => c.occurredAt));
  record('⑥timeline: 新しい順（電話0416が先頭）', tl[0].id === 'c2', tl.map(c => c.id));
  record('⑥timeline: 最後が初回送付（legacy=true）', tl[2].legacy === true && tl[2].occurredAt === '2026-10-05', tl[2]);
}

// ⑦nexusFanLatestContact：以降の接触が無ければ初回送付にフォールバック
{
  const recNoFollowup = makeRecord({ sentDate: '2026-10-05', contacts: [] });
  const latest = nexusFanLatestContact(recNoFollowup, 'ハガキ');
  record('⑦latest: 以降の接触が無ければ初回送付自体が最新になる', latest && latest.legacy === true && latest.result === '発送済み', latest);
}

// ⑧nexusFanContactMethodBreakdown：初回送付は含まない／新旧混在でも二重計上なし
{
  const recA = makeRecord({ id: 'a', sentDate: '2026-10-05', contacts: [
    { id: 'c1', occurredAt: '2026-10-13', direction: 'outbound', method: 'LINE', result: '送信済み' },
    { id: 'c2', occurredAt: '2026-10-16', direction: 'outbound', method: '電話', result: '会話できた' }
  ] });
  const recB = makeRecord({ id: 'b', sentDate: '2026-10-05', readAt: '2026-10-07', sendMethod: 'LINE' }); // 旧データのみ
  const rows = nexusFanContactMethodBreakdown([recA, recB]);
  const lineCount = rows.find(r => r.method === 'LINE').count;
  const phoneCount = rows.find(r => r.method === '電話').count;
  record('⑧breakdown: LINE=2（recAの送信1＋recBの旧データ既読1、初回送付は含まない）', lineCount === 2, rows);
  record('⑧breakdown: 電話=1', phoneCount === 1, rows);

  // ⑧-b 旧データと完全一致する新データが同じレコードに存在する場合、方法別集計も二重計上しない。
  const recC = makeRecord({ id: 'c', sentDate: '2026-10-05', readAt: '2026-10-07', sendMethod: 'LINE', contacts: [
    { id: 'c3', occurredAt: '2026-10-07', direction: 'inbound', method: 'LINE', result: '既読' }
  ] });
  const rowsC = nexusFanContactMethodBreakdown([recC]);
  record('⑧-b breakdown: 重複する旧データ＋新データは1件として数える（LINE=1）', rowsC.find(r => r.method === 'LINE').count === 1, rowsC);
}

// ⑨nexusFanFollowMetricsGroup：read/repliedの計算（マージ＋重複排除込み、ケース4対応）
{
  const legacyReadOnly = makeRecord({ id: 'r1', readAt: '2026-10-07' });
  // 旧readAtがあり、無関係な新データ（電話）が追加されても、旧既読は消えず引き続きreadに数える。
  const legacyReadPlusUnrelatedNew = makeRecord({ id: 'r2', readAt: '2026-10-07', contacts: [
    { id: 'c1', occurredAt: '2026-10-15', direction: 'outbound', method: '電話', result: '会話できた' }
  ] });
  // 旧readAtと完全一致する新データ（同日・同method・同result=既読）が追加された場合は、
  // 重複排除により1件のみ＝二重カウントしない。
  const legacyReadDuplicatedByNew = makeRecord({ id: 'r3', readAt: '2026-10-07', sendMethod: 'LINE', contacts: [
    { id: 'c2', occurredAt: '2026-10-07', direction: 'inbound', method: 'LINE', result: '既読' }
  ] });
  const stage = { consultedAt: null, metAt: null, proposedAt: null, closedAt: null, confirmedRevenue: null };
  const recordsWithStage = [
    { record: legacyReadOnly, stage, expectedRevenue: 0 },
    { record: legacyReadPlusUnrelatedNew, stage, expectedRevenue: 0 },
    { record: legacyReadDuplicatedByNew, stage, expectedRevenue: 0 }
  ];
  const metrics = nexusFanFollowMetricsGroup(recordsWithStage);
  // r1（旧既読のみ）・r2（旧既読＋無関係な新データ、旧既読は消えない）・r3（旧既読＝新既読が
  // 重複一致、レコードとしては依然readあり）のいずれも「既読」を持つレコードとして数えられる。
  record('⑨metrics: 3件ともreadとして数えられる（旧データは無関係な新データの追加で消えない）', metrics.read === 3, metrics);
  // r3のレコード内部では、重複排除により「既読」が1件だけになっている（2件に増殖しない）ことを確認する。
  const normalizedR3 = nexusFanNormalizedContacts(legacyReadDuplicatedByNew);
  record('⑨metrics: r3内部では既読が重複排除で1件だけ（2件ではない＝二重計上しない）', normalizedR3.filter(c => c.result === '既読').length === 1, normalizedR3);
}

// ⑩nexusSyncNextThingTasks：source省略時は従来通りnegotiationTask、新規sourceオプションも動く
{
  const now = '2026-10-14T00:00:00.000Z';
  const r1 = nexusSyncNextThingTasks([], [], [{ kind: 'self', title: 'テスト', date: '2026-10-20' }], { customerId: 'cust1', now });
  record('⑩sync: source省略時はnegotiationTask（後方互換）', r1.tasks[0].source === 'negotiationTask', r1.tasks[0]);
  const r2 = nexusSyncNextThingTasks([], [], [{ kind: 'nextContact', date: '2026-10-20', method: 'LINE', memo: '面談日程確認' }], { customerId: 'cust1', now, source: 'fanFollowTask' });
  record('⑩sync: source指定時はそのsourceで保存される', r2.tasks[0].source === 'fanFollowTask', r2.tasks[0]);
  // 既存タスクをtaskIdで更新しても増殖しない
  const taskId = r2.nextThingTaskIds[0];
  const r3 = nexusSyncNextThingTasks(r2.tasks, [taskId], [{ taskId, kind: 'nextContact', date: '2026-10-21', method: '電話', memo: '変更後' }], { customerId: 'cust1', now, source: 'fanFollowTask' });
  record('⑩sync: taskId指定で再実行しても1件のまま（増殖しない）', r3.tasks.length === 1 && r3.tasks[0].id === taskId && r3.tasks[0].date === '2026-10-21', r3.tasks);
}

// ⑪nexusCustomerNextThings／nexusTodayNextThings：fanFollowTaskも対象に含まれる
{
  const TODAY = '2026-10-14';
  const tasksArr = [
    { id: 't1', source: 'fanFollowTask', kind: 'nextContact', customerId: 'cust1', date: TODAY, method: 'LINE', memo: '', completed: false },
    { id: 't2', source: 'negotiationTask', kind: 'self', customerId: 'cust1', title: '商談メモ側', date: TODAY, completed: false }
  ];
  const custThings = nexusCustomerNextThings(tasksArr, 'cust1');
  record('⑪customerNextThings: fanFollowTask・negotiationTaskの両方が含まれる（2件）', custThings.length === 2, custThings.map(t => t.source));
  const todayThings = nexusTodayNextThings(tasksArr, TODAY);
  record('⑪todayNextThings: fanFollowTaskも今日やることに含まれる', todayThings.some(t => t.source === 'fanFollowTask'), todayThings.map(t => t.source));
}

// ⑫nexusFanFollowSyncNextThingTask：ファン化フォロー記録1件につきタスク1件のみ（増殖しない）
{
  const now1 = '2026-10-14T00:00:00.000Z';
  const rec1 = makeRecord({ nextFollowDate: '2026-10-20', nextFollowMethod: 'LINE', nextFollowAction: '面談日程確認' });
  const sync1 = nexusFanFollowSyncNextThingTask([], rec1, now1);
  record('⑫fanFollowSync: タスクが1件作られ、kind=nextContact・source=fanFollowTask', sync1.tasks.length === 1 && sync1.tasks[0].kind === 'nextContact' && sync1.tasks[0].source === 'fanFollowTask', sync1.tasks);
  record('⑫fanFollowSync: method/memoが反映される', sync1.tasks[0].method === 'LINE' && sync1.tasks[0].memo === '面談日程確認', sync1.tasks[0]);

  // 同じ記録を（nextThingTaskIdを引き継いで）再保存しても1件のまま、内容だけ更新される。
  const rec2 = { ...rec1, nextThingTaskId: sync1.nextThingTaskId, nextFollowDate: '2026-10-22', nextFollowMethod: '電話' };
  const now2 = '2026-10-15T00:00:00.000Z';
  const sync2 = nexusFanFollowSyncNextThingTask(sync1.tasks, rec2, now2);
  record('⑫fanFollowSync: 再保存してもタスクは1件のまま（増殖しない）', sync2.tasks.length === 1, sync2.tasks);
  record('⑫fanFollowSync: 同じidのまま内容が更新される', sync2.tasks[0].id === sync1.nextThingTaskId && sync2.tasks[0].date === '2026-10-22' && sync2.tasks[0].method === '電話', sync2.tasks[0]);

  // nextFollowDateを空にして保存すると、紐づくタスクが削除される。
  const rec3 = { ...rec2, nextThingTaskId: sync2.nextThingTaskId, nextFollowDate: '', nextFollowMethod: '' };
  const sync3 = nexusFanFollowSyncNextThingTask(sync2.tasks, rec3, now2);
  record('⑫fanFollowSync: nextFollowDateを消すと紐づくタスクが削除される', sync3.tasks.length === 0 && sync3.nextThingTaskId === '', sync3);
}

// ⑬nexusFanContactDetailRows：AI分析用接触履歴明細（1 contact = 1行、案B）
{
  const campaign = { id: 'camp-xyz', campaignType: 'ハガキ' };
  const customers13 = [{ id: 'cust1', aiAnalysisId: 'C0100' }];
  const rec = makeRecord({
    id: 'r13', customerId: 'cust1', sentDate: '2026-10-05',
    contacts: [
      { id: 'c1', occurredAt: '2026-10-13', direction: 'outbound', method: 'LINE', result: '送信済み', topics: ['近況確認'], memo: '自由記述が入っていても出力しない確認用', createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T00:00:00.000Z' },
      { id: 'c2', occurredAt: '2026-10-14', direction: 'inbound', method: 'LINE', result: '返信あり', createdAt: '2026-10-14T00:00:00.000Z', updatedAt: '2026-10-14T00:00:00.000Z' },
      { id: 'c3', occurredAt: '2026-10-16', direction: 'outbound', method: '電話', result: '相談になった', createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z' },
      { id: 'c4', occurredAt: '2026-10-20', direction: 'outbound', method: 'オンライン面談', result: '面談予定', meetingMode: 'オンライン', meetingPurpose: '自由記述（出力しない確認用）', createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z' },
      { id: 'c5', occurredAt: '2026-10-21', direction: 'outbound', method: 'オンライン面談', result: '面談実施', createdAt: '2026-10-21T00:00:00.000Z', updatedAt: '2026-10-21T00:00:00.000Z' },
      { id: 'c6', occurredAt: '2026-10-22', direction: 'outbound', method: '電話', result: '紹介あり', referralCount: '2', referralMemo: '自由記述（出力しない確認用）', createdAt: '2026-10-22T00:00:00.000Z', updatedAt: '2026-10-22T00:00:00.000Z' }
    ]
  });
  const rows13 = nexusFanContactDetailRows({ record: rec, stage: {}, expectedRevenue: 0 }, campaign, customers13);
  record('⑬rows: 初回送付＋6接触＝7行', rows13.length === 7, rows13.length);
  record('⑬rows: 先頭はinitial_send・contactSequence=0・daysFromInitialSend=0', rows13[0].eventType === 'initial_send' && rows13[0].contactSequence === 0 && rows13[0].daysFromInitialSend === 0, rows13[0]);
  record('⑬rows: codeは氏名と無関係のaiAnalysisId', rows13[0].code === 'C0100', rows13[0]);
  record('⑬rows: campaignNameではなくcampaignId（匿名なランダムid）を使う', rows13[0].campaignId === 'camp-xyz' && !('campaignName' in rows13[0]), rows13[0]);
  const followupRows13 = rows13.filter(r => r.eventType === 'followup_contact');
  record('⑬rows: followupは時系列でcontactSequence=1,2,3,4,5,6（発生順＝古い順）', followupRows13.map(r => r.contactSequence).join(',') === '1,2,3,4,5,6', followupRows13.map(r => r.contactSequence));
  record('⑬rows: daysFromInitialSendが正しく計算される（10/13は8日後、10/22は17日後）', followupRows13[0].daysFromInitialSend === 8 && followupRows13[5].daysFromInitialSend === 17, followupRows13.map(r => r.daysFromInitialSend));
  record('⑬rows: 相談になったcontactはconsultedFlag=true', followupRows13[2].consultedFlag === true && followupRows13[2].result === '相談になった', followupRows13[2]);
  record('⑬rows: 面談予定contactはmetFlag=false（予定≠実施）', followupRows13[3].result === '面談予定' && followupRows13[3].metFlag === false, followupRows13[3]);
  record('⑬rows: 面談実施contactはmetFlag=true', followupRows13[4].result === '面談実施' && followupRows13[4].metFlag === true, followupRows13[4]);
  record('⑬rows: 紹介ありcontactはreferredFlag=true・referralCountも出力される', followupRows13[5].referredFlag === true && followupRows13[5].referralCount === '2', followupRows13[5]);
  record('⑬rows: topicsは配列のまま出力される', Array.isArray(followupRows13[0].topics) && followupRows13[0].topics.includes('近況確認'), followupRows13[0].topics);
  // 自由記述（memo／referralMemo／meetingPurpose／customerNameText）が一切含まれないことを確認。
  const forbiddenKeys = ['memo', 'referralMemo', 'meetingPurpose', 'messageText', 'customerNameText'];
  const hasForbidden = rows13.some(r => forbiddenKeys.some(k => k in r));
  record('⑬rows: 自由記述欄（memo/referralMemo/meetingPurpose等）のキー自体が一切含まれない', !hasForbidden, rows13.map(r => Object.keys(r)));
  // sentDateが無い記録は初回送付の行自体が無く、daysFromInitialSendもnull。
  const recNoSent = makeRecord({ id: 'r13b', customerId: 'cust1', sentDate: '', contacts: [{ id: 'c1', occurredAt: '2026-10-13', direction: 'outbound', method: 'LINE', result: '送信済み' }] });
  const rowsNoSent = nexusFanContactDetailRows({ record: recNoSent, stage: {}, expectedRevenue: 0 }, campaign, customers13);
  record('⑬rows: sentDateが無い場合、initial_send行は作られない', !rowsNoSent.some(r => r.eventType === 'initial_send'), rowsNoSent);
  record('⑬rows: sentDateが無い場合、daysFromInitialSendはnull', rowsNoSent[0].daysFromInitialSend === null, rowsNoSent[0]);
}

// ⑭nexusFanContactDetailRowsは正規化済み（重複排除後）のcontactsを使う
{
  const campaign14 = { id: 'camp-dup', campaignType: '記事' };
  const recDup = makeRecord({
    id: 'r14', customerId: 'cust1', sentDate: '2026-09-20', sendMethod: 'LINE',
    phoneFollowStatus: '電話した', phoneFollowDate: '2026-09-25',
    contacts: [{ id: 'c1', occurredAt: '2026-09-25', direction: 'outbound', method: '電話', result: '連絡済み' }]
  });
  const rows14 = nexusFanContactDetailRows({ record: recDup, stage: {}, expectedRevenue: 0 }, campaign14, []);
  const followupRows14 = rows14.filter(r => r.eventType === 'followup_contact');
  record('⑭rows: 旧データ（電話した）と完全一致する新データは重複排除で1行だけ', followupRows14.length === 1, followupRows14);
}

// ⑮nexusFanFollowAnonymizedExportにcontactDetailsが含まれる（複数レコードを集約）
{
  const campaigns15 = [{ id: 'camp15', name: 'テストキャンペーン', campaignType: 'ハガキ', targetCount: 10 }];
  const follows15 = [
    makeRecord({ id: 'f1', campaignId: 'camp15', customerId: 'cust1', sentDate: '2026-10-01', contacts: [{ id: 'c1', occurredAt: '2026-10-05', direction: 'outbound', method: 'LINE', result: '送信済み' }] }),
    makeRecord({ id: 'f2', campaignId: 'camp15', customerId: 'cust2', sentDate: '2026-10-01', contacts: [] })
  ];
  const exportData15 = nexusFanFollowAnonymizedExport({ campaigns: campaigns15, follows: follows15, activityLogs: [], customers: [], tasks: [], campaignIds: [], sentFrom: undefined, sentTo: undefined });
  record('⑮export: contactDetailsが含まれる', Array.isArray(exportData15.contactDetails), exportData15.contactDetails);
  // f1: 初回送付1件＋LINE送信1件＝2行。f2: 初回送付1件のみ＝1行。合計3行。
  record('⑮export: 2レコード分（初回送付2件＋接触1件＝3行）が集約される', exportData15.contactDetails.length === 3, exportData15.contactDetails);
  record('⑮export: individualProgress（既存）も変わらず含まれる', exportData15.individualProgress.length === 2, exportData15.individualProgress);
}

// ⑯nexusFanFollowContactDetailCsvRows：CSV化しても自由記述を含まない
{
  const csvRows16 = nexusFanFollowContactDetailCsvRows([
    { code: 'C0100', campaignId: 'camp1', eventType: 'followup_contact', occurredAt: '2026-10-13', direction: 'outbound', method: 'LINE', result: '送信済み', topics: ['近況確認', '保険見直し'], meetingMode: '', referralCount: '', consultedFlag: false, metFlag: false, referredFlag: false, contactSequence: 1, daysFromInitialSend: 8 }
  ]);
  record('⑯csv: ヘッダー行＋1データ行', csvRows16.length === 2, csvRows16);
  record('⑯csv: topicsは「・」区切りの文字列になる', csvRows16[1][7] === '近況確認・保険見直し', csvRows16[1]);
  record('⑯csv: 顧客コード・キャンペーンIDが含まれる', csvRows16[1][0] === 'C0100' && csvRows16[1][1] === 'camp1', csvRows16[1]);
}

// ⑰contactSequenceは「発生順」（最新から1ではなく、古い方から1）であることの確認
{
  const campaign17 = { id: 'camp17', campaignType: 'ハガキ' };
  // 1. 初回0→古い接触1→新しい接触2 の順になる。
  const rec17 = makeRecord({
    id: 'r17', customerId: 'cust1', sentDate: '2026-10-05',
    contacts: [
      { id: 'newer', occurredAt: '2026-10-20', direction: 'outbound', method: '電話', result: '会話できた', createdAt: '2026-10-20T00:00:00.000Z' },
      { id: 'older', occurredAt: '2026-10-13', direction: 'outbound', method: 'LINE', result: '送信済み', createdAt: '2026-10-13T00:00:00.000Z' }
    ]
  });
  const rows17 = nexusFanContactDetailRows({ record: rec17, stage: {}, expectedRevenue: 0 }, campaign17, []);
  record('⑰-1: 初回送付=0、古い接触（LINE10/13）=1、新しい接触（電話10/20）=2', rows17[0].contactSequence === 0 && rows17[1].occurredAt === '2026-10-13' && rows17[1].contactSequence === 1 && rows17[2].occurredAt === '2026-10-20' && rows17[2].contactSequence === 2, rows17);

  // 2. nexusFanNormalizedContacts自体は（画面表示用に）新しい順（降順）のままだが、
  //    AI出力のcontactSequenceはその降順に影響されず昇順になることを確認する。
  const normalized17 = nexusFanNormalizedContacts(rec17);
  record('⑰-2: nexusFanNormalizedContacts自体は新しい順（降順）のまま（画面表示用の設計を変えていない）', normalized17[0].occurredAt === '2026-10-20' && normalized17[1].occurredAt === '2026-10-13', normalized17);
  record('⑰-2: それでもAI出力のcontactSequenceは古い順（昇順）になる', rows17.filter(r => r.eventType === 'followup_contact').every((r, i, arr) => i === 0 || r.occurredAt >= arr[i - 1].occurredAt), rows17);

  // 3. 初回送付は必ず1行だけ（contacts側に初回送付と同じ内容があっても二重出力されない）。
  const recInitialDup = makeRecord({
    id: 'r17b', customerId: 'cust1', sentDate: '2026-10-05', sendMethod: 'ハガキ',
    contacts: [{ id: 'c1', occurredAt: '2026-10-05', direction: 'outbound', method: 'ハガキ', result: '発送済み' }]
  });
  const rowsInitialDup = nexusFanContactDetailRows({ record: recInitialDup, stage: {}, expectedRevenue: 0 }, campaign17, []);
  record('⑰-3: 初回送付と同日・同方法・同結果のcontactがあっても、initial_send行は1件だけ', rowsInitialDup.filter(r => r.eventType === 'initial_send').length === 1, rowsInitialDup);

  // 4. daysFromInitialSendが各contactSequenceと正しく対応する（昇順の並びに対して計算される）。
  record('⑰-4: daysFromInitialSendもsequence=1(8日後)→2(15日後)の順に対応する', rows17[1].daysFromInitialSend === 8 && rows17[2].daysFromInitialSend === 15, rows17);

  // 5. 相談・面談・紹介フラグの対象resultを、enum全件に対して網羅的に確認する（取りこぼし無し）。
  // NEXUS_FAN_CONTACT_RESULTSはeval対象コード内でconst宣言のためこのスコープへ漏れてこない
  // （todayStrと同じ理由）。nexus.html側の定義と完全に一致させて個別に列挙する。
  const ALL_CONTACT_RESULTS = ['未対応', '送信済み', '連絡済み', '不通', '未読', '既読', '返信あり', '折返し待ち', '返事待ち', '会話できた', '相談になった', '面談予定', '面談実施', '今回は見送り', '連絡不要', '特に相談なし', '紹介あり', 'その他'];
  const flagResultsMap = {};
  ALL_CONTACT_RESULTS.forEach(r => {
    const rowsForResult = nexusFanContactDetailRows({ record: makeRecord({ id: 'rf', customerId: 'cust1', sentDate: '', contacts: [{ id: 'c1', occurredAt: '2026-10-10', direction: 'outbound', method: 'その他', result: r }] }), stage: {}, expectedRevenue: 0 }, campaign17, []);
    const row = rowsForResult[0];
    flagResultsMap[r] = { consultedFlag: row.consultedFlag, metFlag: row.metFlag, referredFlag: row.referredFlag };
  });
  const consultedTrueFor = Object.keys(flagResultsMap).filter(r => flagResultsMap[r].consultedFlag);
  const metTrueFor = Object.keys(flagResultsMap).filter(r => flagResultsMap[r].metFlag);
  const referredTrueFor = Object.keys(flagResultsMap).filter(r => flagResultsMap[r].referredFlag);
  record('⑰-5: consultedFlagがtrueになるresultは「相談になった」のみ', consultedTrueFor.length === 1 && consultedTrueFor[0] === '相談になった', consultedTrueFor);
  record('⑰-5: metFlagがtrueになるresultは「面談実施」のみ（「面談予定」はfalse）', metTrueFor.length === 1 && metTrueFor[0] === '面談実施', metTrueFor);
  record('⑰-5: referredFlagがtrueになるresultは「紹介あり」のみ', referredTrueFor.length === 1 && referredTrueFor[0] === '紹介あり', referredTrueFor);
  // 3つのフラグが同時にtrueになるresultが無い（排他）ことも確認する。
  const anyOverlap = ALL_CONTACT_RESULTS.some(r => {
    const f = flagResultsMap[r];
    return (f.consultedFlag && f.metFlag) || (f.consultedFlag && f.referredFlag) || (f.metFlag && f.referredFlag);
  });
  record('⑰-5: 3つのフラグが同時にtrueになるresultは存在しない', !anyOverlap, flagResultsMap);

  // 同日の接触の順序：occurredAtが同じ日の場合、createdAt（実際に記録された時刻）を補助キーに
  // 使う。旧データ（createdAtを持たない仮想contact）が新データと同日になった場合は、実際の
  // 前後関係を推測せず、常に旧データを先に置く固定の規約とする（真の前後関係の主張ではない）。
  const recSameDay = makeRecord({
    id: 'r17c', customerId: 'cust1', sentDate: '2026-10-01', phoneFollowStatus: '電話した', phoneFollowDate: '2026-10-10',
    contacts: [{ id: 'c1', occurredAt: '2026-10-10', direction: 'outbound', method: 'LINE', result: '送信済み', createdAt: '2026-10-10T09:00:00.000Z' }]
  });
  const rowsSameDay = nexusFanContactDetailRows({ record: recSameDay, stage: {}, expectedRevenue: 0 }, campaign17, []);
  const sameDayFollowups = rowsSameDay.filter(r => r.eventType === 'followup_contact');
  record('⑱同日tie-break: 同じ日（10/10）の旧データ（電話）と新データ（LINE）が両方残る', sameDayFollowups.length === 2, sameDayFollowups);
  record('⑱同日tie-break: createdAtを持たない旧データ（電話）が、固定規約により先（sequence=1）になる', sameDayFollowups[0].method === '電話' && sameDayFollowups[0].contactSequence === 1 && sameDayFollowups[1].method === 'LINE' && sameDayFollowups[1].contactSequence === 2, sameDayFollowups);
}

const failedCount = results.filter(r => !r.pass).length;
console.log(`\nTOTAL: ${results.length}, PASS: ${results.length - failedCount}, FAIL: ${failedCount}`);
process.exit(failedCount > 0 ? 1 : 0);
