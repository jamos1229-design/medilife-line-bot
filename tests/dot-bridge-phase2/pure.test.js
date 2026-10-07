// 神メモ第2段階（記憶→dot相談→既存タスクへの反映）の純粋関数テスト（合成データのみ）。
// 実行: node tests/dot-bridge-phase2/pure.test.js
// 依存: Node.jsのみ。常にリポジトリ直下のnexus.htmlから対象関数を直接読み込んで評価する
// （tests/dot-bridge/pure.test.js・tests/lifeplan/pure.test.jsと同じ抽出パターン）。
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

const SOURCE_FULL_CONFIRMED = {
  schemaVersion: 1, memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb',
  sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1',
  action: 'customer_followup', actionBasis: 'user_confirmed',
  status: 'open', statusBasis: 'existing_explicit',
  dueDate: '2026-11-01', dueDateBasis: 'existing_explicit',
  durationMinutes: 20, durationBasis: 'user_confirmed',
  timezone: 'Asia/Tokyo', tags: ['follow_up'], tagsBasis: 'user_confirmed'
};
const REQUEST_RECORD_BASE = {
  requestId: 'req-0123456789',
  source: SOURCE_FULL_CONFIRMED,
  context: { question: '提案済みの案件について、次回面談の準備を20分で進めたい', futureIntent: 'お客さまが納得して判断できる状態にする' }
};

// ①依頼JSONの組み立て・検証
{
  const json = nexusDotBuildConsultRequestJson({ requestId: 'req-0123456789', source: SOURCE_FULL_CONFIRMED, question: REQUEST_RECORD_BASE.context.question, futureIntent: REQUEST_RECORD_BASE.context.futureIntent });
  record('①依頼JSON: schemaVersion=2・type=dot_request', json.schemaVersion === 2 && json.type === 'dot_request');
  record('①依頼JSON: sourceをそのまま再利用（新規に作り直さない）', json.source === SOURCE_FULL_CONFIRMED);
  record('①依頼JSON: 検証エラーなし', nexusDotValidateConsultRequestJson(json).length === 0);
  const jsonBlank = nexusDotBuildConsultRequestJson({ requestId: 'req-0123456789', source: SOURCE_FULL_CONFIRMED, question: null, futureIntent: null });
  record('①依頼JSON: question/futureIntent空欄でも使用可能', nexusDotValidateConsultRequestJson(jsonBlank).length === 0);
  let threw = false;
  try {
    nexusDotBuildConsultRequestJson({ requestId: 'req-0123456789', source: SOURCE_FULL_CONFIRMED, question: 'あ'.repeat(201), futureIntent: null });
  } catch (e) { threw = /DOT_REQUEST_INVALID/.test(e.message); }
  record('①依頼JSON: question201文字は拒否（例外）', threw);
}

// ②回答JSON検証：正常系
{
  const resp = {
    schemaVersion: 2, type: 'dot_response', requestId: 'req-0123456789',
    memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1',
    facts: ['dueDate', 'action'],
    unknowns: [],
    options: [{ title: '前回の未確認事項を3点に整理する', durationMinutes: 15, dueDate: null, reason: '次回面談で判断に必要な情報をそろえるため' }],
    nextStep: { title: '前回の未確認事項を3点に整理する', durationMinutes: 20, dueDate: '2026-11-01', reason: '次回面談で判断に必要な情報をそろえるため' },
    futureLink: 'お客さまが自分で比較検討できる資料を用意する'
  };
  const r = nexusDotValidateConsultResponseJson(resp, REQUEST_RECORD_BASE);
  record('②回答JSON: 正常系はok', r.ok, r.errors);
  if (r.ok) {
    const dueFact = r.validated.facts.find(f => f.field === 'dueDate');
    record('②回答JSON: factsは参照（フィールド名）のみで、値はsourceから再取得される', dueFact.value === '2026-11-01', dueFact);
    record('②回答JSON: nextStep.dueDateは元のdueDateと一致するので許可', r.validated.nextStep.dueDate === '2026-11-01');
  }
}
// ②-b requestId不一致
{
  const resp = { schemaVersion: 2, type: 'dot_response', requestId: 'req-WRONG', memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1', facts: [], unknowns: [], options: [], nextStep: null, futureLink: null };
  const r = nexusDotValidateConsultResponseJson(resp, REQUEST_RECORD_BASE);
  record('②-b requestId不一致は拒否される', !r.ok && r.errors.includes('requestId_mismatch'), r.errors);
}
// ②-c sourceRevision不一致（基準が変わった後の古い回答）
{
  const resp = { schemaVersion: 2, type: 'dot_response', requestId: 'req-0123456789', memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-OLD', taskRevision: 'rev-task-1', facts: [], unknowns: [], options: [], nextStep: null, futureLink: null };
  const r = nexusDotValidateConsultResponseJson(resp, REQUEST_RECORD_BASE);
  record('②-c sourceRevision不一致（変更後の古い回答）は拒否される', !r.ok && r.errors.includes('sourceRevision_mismatch'), r.errors);
}
// ②-d 未確認項目をfactsとして主張
{
  const sourceWithUnknownDuration = { ...SOURCE_FULL_CONFIRMED, durationMinutes: null, durationBasis: 'unknown' };
  const rr = { ...REQUEST_RECORD_BASE, source: sourceWithUnknownDuration };
  const resp = { schemaVersion: 2, type: 'dot_response', requestId: 'req-0123456789', memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1', facts: ['durationMinutes'], unknowns: [], options: [], nextStep: null, futureLink: null };
  const r = nexusDotValidateConsultResponseJson(resp, rr);
  record('②-d 未確認項目をfactsとして主張したら拒否される', !r.ok && r.errors.includes('facts[0].field_not_confirmed'), r.errors);
}
// ②-d2 factsに値（value）を含めても使われず、参照（文字列）のみを許可する形式のため、
// 値付きのオブジェクトを渡すと「文字列ではない」として拒否される（値を受け取る余地が無い）。
{
  const resp = { schemaVersion: 2, type: 'dot_response', requestId: 'req-0123456789', memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1', facts: [{ field: 'action', value: 'anything' }], unknowns: [], options: [], nextStep: null, futureLink: null };
  const r = nexusDotValidateConsultResponseJson(resp, REQUEST_RECORD_BASE);
  record('②-d2 factsに{field,value}形式を渡すと拒否される（参照のみ・値は渡せない形式）', !r.ok && r.errors.includes('facts[0]'), r.errors);
}
// ②-e 確認済みの項目をunknownsとして主張
{
  const resp = { schemaVersion: 2, type: 'dot_response', requestId: 'req-0123456789', memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1', facts: [], unknowns: ['dueDate'], options: [], nextStep: null, futureLink: null };
  const r = nexusDotValidateConsultResponseJson(resp, REQUEST_RECORD_BASE);
  record('②-e 確認済みの項目をunknownsとして主張したら拒否される', !r.ok && r.errors.includes('unknowns[0].field_not_actually_unknown'), r.errors);
}
// ②-f nextStep.dueDateが元のdueDateと異なる
{
  const resp = { schemaVersion: 2, type: 'dot_response', requestId: 'req-0123456789', memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1', facts: [], unknowns: [], options: [], nextStep: { title: 'x', durationMinutes: 10, dueDate: '2099-01-01', reason: 'y' }, futureLink: null };
  const r = nexusDotValidateConsultResponseJson(resp, REQUEST_RECORD_BASE);
  record('②-f nextStep.dueDateが元の期限と異なる場合は拒否される（期限の発明を防ぐ）', !r.ok && r.errors.includes('nextStep.dueDate_not_original'), r.errors);
}
// ②-g nextStep.dueDate=null許可
{
  const resp = { schemaVersion: 2, type: 'dot_response', requestId: 'req-0123456789', memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1', facts: [], unknowns: [], options: [], nextStep: { title: 'x', durationMinutes: 10, dueDate: null, reason: 'y' }, futureLink: null };
  const r = nexusDotValidateConsultResponseJson(resp, REQUEST_RECORD_BASE);
  record('②-g nextStep.dueDate=nullは許可される（期限不明の表現）', r.ok, r.errors);
}
// ②-h futureLink without futureIntent
{
  const rrNoFuture = { ...REQUEST_RECORD_BASE, context: { question: REQUEST_RECORD_BASE.context.question, futureIntent: null } };
  const resp = { schemaVersion: 2, type: 'dot_response', requestId: 'req-0123456789', memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1', facts: [], unknowns: [], options: [], nextStep: null, futureLink: '何か' };
  const r = nexusDotValidateConsultResponseJson(resp, rrNoFuture);
  record('②-h futureIntentが無いのにfutureLinkがあると拒否される', !r.ok && r.errors.includes('futureLink_without_futureIntent'), r.errors);
}
// ②-i options最大3件を超える
{
  const opt = { title: 'x', durationMinutes: null, dueDate: null, reason: 'y' };
  const resp = { schemaVersion: 2, type: 'dot_response', requestId: 'req-0123456789', memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1', facts: [], unknowns: [], options: [opt, opt, opt, opt], nextStep: null, futureLink: null };
  const r = nexusDotValidateConsultResponseJson(resp, REQUEST_RECORD_BASE);
  record('②-i optionsが4件は拒否される', !r.ok && r.errors.includes('options_too_many'), r.errors);
}
// ②-j HTMLタグ拒否
{
  const resp = { schemaVersion: 2, type: 'dot_response', requestId: 'req-0123456789', memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1', facts: [], unknowns: [], options: [{ title: '<script>alert(1)</script>', durationMinutes: null, dueDate: null, reason: 'y' }], nextStep: null, futureLink: null };
  const r = nexusDotValidateConsultResponseJson(resp, REQUEST_RECORD_BASE);
  record('②-j titleにHTMLタグが含まれる場合は拒否される（evalやHTML挿入を防ぐ）', !r.ok && r.errors.includes('options[0].title'), r.errors);
}
// ②-k URL拒否
{
  const resp = { schemaVersion: 2, type: 'dot_response', requestId: 'req-0123456789', memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1', facts: [], unknowns: [], options: [{ title: 'x', durationMinutes: null, dueDate: null, reason: '詳細はhttps://example.com/aを参照' }], nextStep: null, futureLink: null };
  const r = nexusDotValidateConsultResponseJson(resp, REQUEST_RECORD_BASE);
  record('②-k reasonにURLが含まれる場合は拒否される', !r.ok && r.errors.includes('options[0].reason'), r.errors);
}
// ②-l 未知キー拒否
{
  const resp = { schemaVersion: 2, type: 'dot_response', requestId: 'req-0123456789', memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1', facts: [], unknowns: [], options: [], nextStep: null, futureLink: null, revenueEstimate: 1000000 };
  const r = nexusDotValidateConsultResponseJson(resp, REQUEST_RECORD_BASE);
  record('②-l 未知キー（revenueEstimate等）は拒否される（感情・金額・売上見込みを事実にしない）', !r.ok && r.errors.includes('unknown_key:revenueEstimate'), r.errors);
}
// ②-m 16KB超
{
  const big = { schemaVersion: 2, type: 'dot_response', requestId: 'req-0123456789', memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1', facts: [], unknowns: [], options: [], nextStep: null, futureLink: null, padding: 'x'.repeat(20000) };
  const r = nexusDotValidateConsultResponseJson(big, REQUEST_RECORD_BASE);
  record('②-m 16KBを超える応答は拒否される', !r.ok && r.errors.includes('too_large'), r.errors);
}
// ②-n durationMinutes範囲外
{
  const resp = { schemaVersion: 2, type: 'dot_response', requestId: 'req-0123456789', memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1', facts: [], unknowns: [], options: [{ title: 'x', durationMinutes: 481, dueDate: null, reason: 'y' }], nextStep: null, futureLink: null };
  const r = nexusDotValidateConsultResponseJson(resp, REQUEST_RECORD_BASE);
  record('②-n durationMinutes=481は拒否される（既存の1-480分と同じ範囲）', !r.ok && r.errors.includes('options[0].durationMinutes'), r.errors);
}
// ②-o 存在しない依頼（requestRecord無し）
{
  const resp = { schemaVersion: 2, type: 'dot_response', requestId: 'req-missing', memoryRefId: 'x', taskRefId: 'y', sourceRevision: 'z', taskRevision: 'w', facts: [], unknowns: [], options: [], nextStep: null, futureLink: null };
  const r = nexusDotValidateConsultResponseJson(resp, null);
  record('②-o 存在しない依頼（requestRecord無し）は拒否される', !r.ok && r.errors.includes('no_matching_request'), r.errors);
}
// ②-p factsとunknownsが同じfieldを重複して主張
{
  const resp = { schemaVersion: 2, type: 'dot_response', requestId: 'req-0123456789', memoryRefId: 'mref-aaaaaaaa', taskRefId: 'tref-bbbbbbbb', sourceRevision: 'rev-src-1', taskRevision: 'rev-task-1', facts: ['action'], unknowns: ['action'], options: [], nextStep: null, futureLink: null };
  const r = nexusDotValidateConsultResponseJson(resp, REQUEST_RECORD_BASE);
  record('②-p 同一fieldがfactsとunknownsの両方にあると拒否される', !r.ok && r.errors.includes('unknowns[0].field_not_actually_unknown'), r.errors);
}

// ③自由文PIIリスク検出
{
  const r1 = nexusDotFreeTextRiskScan('090-1234-5678に電話してほしい', []);
  record('③自由文: 電話番号らしい文字列を検出する', !r1.ok && r1.issues.some(i => i.pattern === '電話番号らしい文字列'), r1);
  const r2 = nexusDotFreeTextRiskScan('次回面談の準備を進めたい', []);
  record('③自由文: 問題なければok', r2.ok, r2);
  const r3 = nexusDotFreeTextRiskScan('山田太郎様の件で相談したい', [{ name: '山田太郎' }]);
  record('③自由文: 登録済み顧客の氏名を検出する', !r3.ok && r3.issues.some(i => i.pattern === '氏名'), r3);
  const r4 = nexusDotFreeTextRiskScan('', []);
  record('③自由文: 空文字はok（空欄でも使用可能）', r4.ok);
}

// ④既存タスクへの反映パッチ計算
{
  const task = { id: 't1', title: '旧タイトル', date: '2026-10-01', dotDurationMinutes: 10 };
  const p1 = nexusDotComputeApplyPatch(task, { title: '新タイトル', durationMinutes: 25, dueDate: '2026-11-01' });
  record('④パッチ: title・所要時間・期限がすべて反映される', p1.patch.title === '新タイトル' && p1.patch.dotDurationMinutes === 25 && p1.patch.date === '2026-11-01', p1);
  const p2 = nexusDotComputeApplyPatch(task, { title: '新タイトル', durationMinutes: 25, dueDate: null });
  record('④パッチ: dueDateがnullなら既存のdateを一切変更しない（nullで既存期限を消さない）', !('date' in p2.patch), p2);
  const taskWithKind = { id: 't2', title: '旧', date: '2026-10-05', kind: 'nextContact' };
  const p3 = nexusDotComputeApplyPatch(taskWithKind, { title: '新', durationMinutes: null, dueDate: '2026-11-01' });
  record('④パッチ: kind設定済み（商談メモの次にすること等）タスクはdateを更新しない', !('date' in p3.patch) && p3.dateSkippedReason === 'unsafe_date_kind', p3);
}

// ⑤中断時の復旧判定
{
  const pendingEntry = { before: { title: '旧', date: '2026-10-01' }, after: { title: '新', date: '2026-11-01' } };
  record('⑤復旧: まだ未適用ならnot_started', nexusDotApplyPendingReconcile(pendingEntry, { id: 't1', title: '旧', date: '2026-10-01' }) === 'not_started');
  record('⑤復旧: 既に適用済みならalready_applied', nexusDotApplyPendingReconcile(pendingEntry, { id: 't1', title: '新', date: '2026-11-01' }) === 'already_applied');
  record('⑤復旧: before/afterどちらとも一致しない場合はconflict（別タブの変更を検出）', nexusDotApplyPendingReconcile(pendingEntry, { id: 't1', title: '別タブでの変更', date: '2026-12-01' }) === 'conflict');
  record('⑤復旧: pendingEntryが無ければnot_started', nexusDotApplyPendingReconcile(null, { id: 't1' }) === 'not_started');
}

// ⑥同じ依頼の重複防止（進行中の依頼を探す）
{
  const requests = [
    { id: 'r1', memoryId: 'm1', taskId: 't1', status: 'awaiting_response' },
    { id: 'r2', memoryId: 'm2', taskId: 't2', status: 'applied' }
  ];
  record('⑥進行中の依頼を正しく見つける', nexusDotFindActiveRequest(requests, 'm1', 't1').id === 'r1');
  record('⑥応答済み（awaiting_responseでない）は進行中とみなさない', nexusDotFindActiveRequest(requests, 'm2', 't2') === null);
  record('⑥一致する組がなければnull', nexusDotFindActiveRequest(requests, 'm9', 't9') === null);
}

// ⑦ml_dot_requests_v1の安全な読み書き
{
  localStorage.clear();
  const r1 = nexusReadDotRequestsRawSafe();
  record('⑦未設定時は空配列', r1.ok && Array.isArray(r1.requests) && r1.requests.length === 0, r1);
  const w1 = nexusWriteDotRequestsRawVerified([{ id: 'r1' }]);
  record('⑦書込確認が成功する', w1.ok);
  const r2 = nexusReadDotRequestsRawSafe();
  record('⑦読み直すと書いた内容が読める', r2.ok && r2.requests.length === 1 && r2.requests[0].id === 'r1', r2);
  localStorage.setItem('ml_dot_requests_v1', '{not valid json');
  const r3 = nexusReadDotRequestsRawSafe();
  record('⑦不正データはcorrupt_dataとして区別され、空配列として扱わない', !r3.ok && r3.reason === 'corrupt_data', r3);
  localStorage.clear();
}

// ⑧ml_dot_apply_pending_v1の安全な読み書き
{
  localStorage.clear();
  const s1 = nexusSetDotApplyPendingVerified('op1', { requestId: 'r1', taskId: 't1', before: { title: 'a' }, after: { title: 'b' } });
  record('⑧処理中記録の書込が確認される', s1.ok);
  const r1 = nexusReadDotApplyPendingMapSafe();
  record('⑧読み直すと処理中記録が読める', r1.ok && r1.map.op1 && r1.map.op1.requestId === 'r1', r1);
  nexusClearDotApplyPendingEntry('op1');
  const r2 = nexusReadDotApplyPendingMapSafe();
  record('⑧クリア後は処理中記録が消えている', r2.ok && !('op1' in r2.map), r2);
  localStorage.clear();
}

// ⑨コピー内容：依頼JSON単体ではなく、固定の回答指示＋この依頼用の完全な回答例を含む
// （本番反映前レビュー項目1対応：省略のない完全なコピー内容を一度の操作で渡す）。
{
  const requestJson = nexusDotBuildConsultRequestJson({ requestId: 'req-0123456789', source: SOURCE_FULL_CONFIRMED, question: REQUEST_RECORD_BASE.context.question, futureIntent: REQUEST_RECORD_BASE.context.futureIntent });
  const copyText = nexusDotBuildConsultCopyText(requestJson);
  record('⑨コピー内容に固定の回答指示（形式の明文化）が含まれる', copyText.includes('schemaVersion: 2固定') && copyText.includes('dot_response'));
  record('⑨コピー内容に依頼JSON全文が省略なく含まれる（参照ID・版番号を含む）', copyText.includes(SOURCE_FULL_CONFIRMED.memoryRefId) && copyText.includes(SOURCE_FULL_CONFIRMED.taskRefId) && copyText.includes(SOURCE_FULL_CONFIRMED.sourceRevision) && copyText.includes(SOURCE_FULL_CONFIRMED.taskRevision));
  record('⑨コピー内容にこの依頼用の完全な回答例JSONが含まれる', copyText.includes('"type": "dot_response"') && copyText.includes('"requestId": "req-0123456789"'));
  const exampleJson = nexusDotConsultResponseExampleJson(requestJson);
  record('⑨回答例：確認済みの項目（action/status/dueDate/durationMinutes/tags）はfactsに入る', ['action', 'status', 'dueDate', 'durationMinutes', 'tags'].every(f => exampleJson.facts.includes(f)), exampleJson.facts);
  record('⑨回答例：unknownsは空（この依頼はすべて確認済みのため）', exampleJson.unknowns.length === 0, exampleJson.unknowns);
  record('⑨回答例：nextStep.dueDateは元のdueDateと同じ値（新しい期限を発明しない）', exampleJson.nextStep.dueDate === SOURCE_FULL_CONFIRMED.dueDate);
  record('⑨回答例：futureIntentがあるためfutureLinkは例として入る', exampleJson.futureLink !== null);
  record('⑨回答例は自身の検証をそのまま通る（手本として機能する）', nexusDotValidateConsultResponseJson(exampleJson, REQUEST_RECORD_BASE).ok, nexusDotValidateConsultResponseJson(exampleJson, REQUEST_RECORD_BASE).errors);

  // futureIntentが無い依頼では、回答例のfutureLinkもnullになる（futureLink_without_futureIntentを自ら破らない）。
  const requestNoFuture = nexusDotBuildConsultRequestJson({ requestId: 'req-9876543210', source: SOURCE_FULL_CONFIRMED, question: null, futureIntent: null });
  const exampleNoFuture = nexusDotConsultResponseExampleJson(requestNoFuture);
  record('⑨回答例：futureIntentが無い依頼ではfutureLinkもnull', exampleNoFuture.futureLink === null);
}

const failedCount = results.filter(r => !r.pass).length;
console.log(`\nTOTAL: ${results.length}, PASS: ${results.length - failedCount}, FAIL: ${failedCount}`);
process.exit(failedCount > 0 ? 1 : 0);
