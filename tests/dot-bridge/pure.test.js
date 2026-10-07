// Dot連携（第1段階）の純粋関数テスト（合成データのみ、実データ・資格情報は使わない）。
// 実行: node tests/dot-bridge/pure.test.js
// 依存: Node.jsのみ（ブラウザ・Playwright不要）。常にリポジトリ直下のnexus.htmlから
// 対象関数を直接読み込んで評価するため、事前生成した静的なコピーとは異なり、
// nexus.htmlが変更されても自動的に最新の内容でテストされる。
const fs = require('fs');
const path = require('path');

const NEXUS_HTML_PATH = path.join(__dirname, '..', '..', 'nexus.html');
const html = fs.readFileSync(NEXUS_HTML_PATH, 'utf8');
const scriptStart = html.indexOf('<script>const {');
const appStart = html.indexOf('function App() {');
if (scriptStart === -1 || appStart === -1 || appStart <= scriptStart) {
  throw new Error('nexus.htmlから対象スクリプトを抽出できませんでした（構造が変わった可能性があります）');
}
// App()以降（React実行時のレンダリングやDOM依存コード）は純粋関数テストに不要なため含めない。
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
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: k => {
      delete store[k];
    },
    clear: () => {
      store = {};
    }
  };
})();
global.navigator = {};
global.document = {
  createElement: () => ({ click: () => {}, style: {} }),
  getElementById: () => null
};
global.window = global;

eval(code);

let passed = 0,
  failed = 0;
const errors = [];
function assertEq(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failed++;
    errors.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  } else passed++;
}
function assertTrue(cond, label) {
  if (!cond) {
    failed++;
    errors.push(`${label}: expected true`);
  } else passed++;
}
function assertFalse(cond, label) {
  if (cond) {
    failed++;
    errors.push(`${label}: expected false`);
  } else passed++;
}
function assertThrows(fn, label) {
  try {
    fn();
    failed++;
    errors.push(`${label}: expected throw, did not throw`);
  } catch (e) {
    passed++;
  }
}

const mem = (id, over) => ({
  id,
  content: 'テスト本文' + id,
  category: '',
  tags: [],
  relatedEntityIds: [],
  relatedMemoryIds: [],
  source: 'manual',
  isPrivate: false,
  parentMemoryId: null,
  suggestedPrivate: false,
  manualPrivateConfirmed: false,
  linkedTaskIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over
});
const task = (id, over) => ({
  id,
  title: 'タスク' + id,
  date: '2026-02-01',
  completed: false,
  ...over
});

// ── §1: nexusMemoryPrivacyBlockReason ──
{
  const m = mem('m1');
  const byId = new Map([[m.id, m]]);
  assertEq(nexusMemoryPrivacyBlockReason(m.id, byId), null, '通常の非PRIVATE記憶はブロックされない');
}
{
  const m = mem('m2', { isPrivate: true });
  const byId = new Map([[m.id, m]]);
  assertEq(nexusMemoryPrivacyBlockReason(m.id, byId), 'memory_private', 'PRIVATE記憶はmemory_privateでブロック');
}
{
  const m = mem('m3', { suggestedPrivate: true, manualPrivateConfirmed: false });
  const byId = new Map([[m.id, m]]);
  assertEq(nexusMemoryPrivacyBlockReason(m.id, byId), 'privacy_unconfirmed', 'PRIVATE候補未確認はprivacy_unconfirmedでブロック');
}
{
  // 確認時点の本文指紋を正しく記録している場合のみ「確認済み」として扱う
  const base = mem('m4', { suggestedPrivate: true, manualPrivateConfirmed: true });
  const m = { ...base, privacyConfirmedContentFingerprint: nexusSimpleFingerprint(base.content) };
  const byId = new Map([[m.id, m]]);
  assertEq(nexusMemoryPrivacyBlockReason(m.id, byId), null, 'PRIVATE候補が確認済み（指紋も一致）ならブロックされない');
}
{
  // 確認済みフラグはあるが、確認時点の指紋が記録されていない（旧データ等）場合は
  // 安全側に倒して未確認として扱う
  const m = mem('m4b', { suggestedPrivate: true, manualPrivateConfirmed: true, privacyConfirmedContentFingerprint: null });
  const byId = new Map([[m.id, m]]);
  assertEq(nexusMemoryPrivacyBlockReason(m.id, byId), 'privacy_unconfirmed', '確認時点の指紋が無い確認済みフラグは安全側で未確認扱いにする');
}
{
  // 確認後に本文が変わった場合は、古い確認済み状態を失効させる
  const confirmedAt = mem('m4c', { suggestedPrivate: true, manualPrivateConfirmed: true });
  const withFp = { ...confirmedAt, privacyConfirmedContentFingerprint: nexusSimpleFingerprint(confirmedAt.content) };
  const edited = { ...withFp, content: withFp.content + '（編集後の追記）' };
  const byId = new Map([[edited.id, edited]]);
  assertEq(nexusMemoryPrivacyBlockReason(edited.id, byId), 'privacy_unconfirmed', '確認後に本文が変わると古い確認済み状態は失効し未確認扱いに戻る');
}
{
  // 由来情報を全く持たない（relatedMemoryIdsが空）AI Insightは、安全と推定せずブロックする
  const insight = mem('ins_empty', { source: 'ai-insight', relatedMemoryIds: [] });
  const byId = new Map([[insight.id, insight]]);
  assertEq(nexusMemoryPrivacyBlockReason(insight.id, byId), 'derivation_unknown', '由来情報を持たないAI Insightはderivation_unknownでブロックする');
}
{
  // 由来不明（参照切れ）：AI Insightのrelated元が存在しない
  const m = mem('m5', { source: 'ai-insight', relatedMemoryIds: ['missing1'] });
  const byId = new Map([[m.id, m]]);
  assertEq(nexusMemoryPrivacyBlockReason(m.id, byId), 'derivation_unknown', 'AI Insightの由来元が見つからない場合はderivation_unknown');
}
{
  // PRIVATE由来：AI Insightの元になった記憶がPRIVATE
  const src = mem('src1', { isPrivate: true });
  const insight = mem('ins1', { source: 'ai-insight', relatedMemoryIds: [src.id] });
  const byId = new Map([[src.id, src], [insight.id, insight]]);
  assertEq(nexusMemoryPrivacyBlockReason(insight.id, byId), 'memory_private', 'AI InsightはPRIVATEな元記憶の制約を継承する');
}
{
  // 通常メモの単なる関連リンク（relatedMemoryIds、source!=='ai-insight'）はPRIVATE継承の対象にしない
  const priv = mem('priv1', { isPrivate: true });
  const normal = mem('norm1', { source: 'manual', relatedMemoryIds: [priv.id] });
  const byId = new Map([[priv.id, priv], [normal.id, normal]]);
  assertEq(nexusMemoryPrivacyBlockReason(normal.id, byId), null, '通常メモの単なる関連リンクは由来とみなさずブロックしない');
}
{
  // 循環参照があっても停止しない
  const a = mem('cyc_a', { source: 'ai-insight', relatedMemoryIds: ['cyc_b'] });
  const b = mem('cyc_b', { source: 'ai-insight', relatedMemoryIds: ['cyc_a'] });
  const byId = new Map([[a.id, a], [b.id, b]]);
  let result;
  assertTrue(
    (() => {
      try {
        result = nexusMemoryPrivacyBlockReason(a.id, byId);
        return true;
      } catch (e) {
        return false;
      }
    })(),
    '循環参照があっても例外なく停止する'
  );
  assertEq(result, null, '循環参照のみでPRIVATE要素がなければブロックしない');
}

// ── §2: nexusLinkMemoryToTask ──
{
  const m = mem('lm1');
  const t = task('lt1');
  assertEq(nexusLinkMemoryToTask(m, t), { ok: true }, '未関連の記憶・タスクは関連付け可能');
}
{
  const m = mem('lm2', { linkedTaskIds: ['other_task'] });
  const t = task('lt2');
  assertEq(nexusLinkMemoryToTask(m, t).ok, false, '既に別タスクに関連付いた記憶は新しいタスクに関連付けない');
  assertEq(nexusLinkMemoryToTask(m, t).reason, 'memory_already_linked_to_other_task', '理由: memory_already_linked_to_other_task');
}
{
  const m = mem('lm3');
  const t = task('lt3', { sourceMemoryId: 'other_memory' });
  assertEq(nexusLinkMemoryToTask(m, t).ok, false, '既に別の記憶に関連付いたタスクは上書きしない');
  assertEq(nexusLinkMemoryToTask(m, t).reason, 'task_already_linked_to_other_memory', '理由: task_already_linked_to_other_memory');
}
{
  // 同じ組み合わせの再確認は常にok（冪等性）
  const m = mem('lm4', { linkedTaskIds: ['lt4'] });
  const t = task('lt4', { sourceMemoryId: 'lm4' });
  assertEq(nexusLinkMemoryToTask(m, t), { ok: true }, '既に同じ組み合わせで関連付け済みなら再実行してもok（冪等）');
}

// ── §3: nexusDotRefMapEnsure（外向け参照ID、再採番しない）──
{
  const r1 = nexusDotRefMapEnsure({}, 'memory', 'realId1');
  assertTrue(typeof r1.refId === 'string' && r1.refId.length >= 8, '新規の外向けIDが発行される');
  const r2 = nexusDotRefMapEnsure(r1.map, 'memory', 'realId1');
  assertEq(r2.refId, r1.refId, '同じ内部IDには同じ外向けIDが再利用される（再採番しない）');
  const r3 = nexusDotRefMapEnsure(r2.map, 'memory', 'realId2');
  assertFalse(r3.refId === r1.refId, '別の内部IDには別の外向けIDが発行される');
  const r4 = nexusDotRefMapEnsure(r3.map, 'task', 'realId1');
  assertFalse(r4.refId === r1.refId, 'memory種別とtask種別は内部IDが同じでも別の外向けIDになる（名前空間が別）');
}

// ── §3b: nexusDotRevisionTokenEnsure（外向け版番号は内容から直接計算しない）──
{
  const fp1 = nexusSimpleFingerprint(['本文A', false]);
  const r1 = nexusDotRevisionTokenEnsure({}, 'memory', 'mem1', fp1);
  assertTrue(typeof r1.version === 'string' && r1.version.length >= 8, '新規の版トークンが発行される');
  assertFalse(r1.version === fp1, '外向けの版トークンは内部指紋そのものと異なる（内容から直接計算しない）');
  const r2 = nexusDotRevisionTokenEnsure(r1.map, 'memory', 'mem1', fp1);
  assertEq(r2.version, r1.version, '指紋が変化していなければ同じ版トークンを再利用する');
  const fp2 = nexusSimpleFingerprint(['本文B', false]);
  const r3 = nexusDotRevisionTokenEnsure(r2.map, 'memory', 'mem1', fp2);
  assertFalse(r3.version === r1.version, '指紋が変化したら新しい版トークンを発行する');
}

// ── §3c: nexusMemorySourceFingerprint／nexusTaskFingerprintForDot は内部指紋専用 ──
{
  const m1 = mem('fp1');
  const m2 = { ...m1, content: '別の本文', updatedAt: m1.updatedAt };
  assertFalse(nexusMemorySourceFingerprint(m1) === nexusMemorySourceFingerprint(m2), 'updatedAtが同じでも本文が変われば指紋が変わる');
  const m3 = { ...m1 };
  assertEq(nexusMemorySourceFingerprint(m1), nexusMemorySourceFingerprint(m3), '内容が同一なら指紋は同じ');
  const t1 = task('fpt1');
  const t2 = { ...t1, completed: true };
  assertFalse(nexusTaskFingerprintForDot(t1) === nexusTaskFingerprintForDot(t2), '完了状態が変わればtask指紋が変わる');
}

// ── §4: nexusDotDueDateEligibility（日付型の安全な区別）──
{
  const t = task('d1', { date: '2026-03-01' });
  assertEq(nexusDotDueDateEligibility(t), { eligible: true, reason: null }, 'kind無しの単純な日付はdueDate対象');
}
{
  const t = task('d2', { date: '2026-03-01', kind: 'self' });
  assertEq(nexusDotDueDateEligibility(t).eligible, false, '商談メモ由来(kind=self)の日付はdueDate対象外');
  assertEq(nexusDotDueDateEligibility(t).reason, 'unsupported_kind', '理由: unsupported_kind');
}
{
  const t = task('d3', { date: '2026-03-01', kind: 'waiting' });
  assertEq(nexusDotDueDateEligibility(t).eligible, false, '返事待ち(kind=waiting)の確認日もdueDate対象外（複数の意味を持ちうるため）');
}
{
  const t = task('d4', { date: '' });
  assertEq(nexusDotDueDateEligibility(t).eligible, false, '日付未入力はdueDate対象外');
  assertEq(nexusDotDueDateEligibility(t).reason, 'no_plain_date', '理由: no_plain_date');
}
{
  const t = task('d5', { date: '2026/03/01' });
  assertEq(nexusDotDueDateEligibility(t).eligible, false, 'YYYY-MM-DD形式でない日付はdueDate対象外');
}

// ── §5: nexusDotStatusForTask ──
{
  assertEq(nexusDotStatusForTask(task('s1', { completed: false })), 'open', '未完了タスクはstatus=open');
  assertEq(nexusDotStatusForTask(task('s2', { completed: true })), 'done', '完了タスクはstatus=done');
}

// §6（版の変化検知）は§3cへ統合済み。PRIVATE状態の変化も指紋に反映されることを確認。
{
  const m1 = mem('rev1');
  const m4 = { ...m1, isPrivate: true };
  assertFalse(nexusMemorySourceFingerprint(m1) === nexusMemorySourceFingerprint(m4), 'PRIVATE状態が変われば内部指紋が変わる');
}

// ── §7: nexusBuildDotExportJson / nexusValidateDotExportJson（許可リストの厳密検証）──
function validInput(over) {
  return {
    memoryRefId: 'a'.repeat(10),
    taskRefId: 'b'.repeat(10),
    sourceRevision: 'srcrev1',
    taskRevision: 'taskrev1',
    action: null,
    actionBasis: 'unknown',
    status: 'open',
    statusBasis: 'existing_explicit',
    dueDate: null,
    dueDateBasis: 'unknown',
    durationMinutes: null,
    durationBasis: 'unknown',
    timezone: null,
    tags: [],
    tagsBasis: 'unknown',
    ...over
  };
}
{
  const json = nexusBuildDotExportJson(validInput());
  assertEq(json.schemaVersion, 1, '正常な入力ならschemaVersion=1で生成できる');
  const expectedAllowedKeys = ['schemaVersion', 'memoryRefId', 'taskRefId', 'sourceRevision', 'taskRevision', 'action', 'actionBasis', 'status', 'statusBasis', 'dueDate', 'dueDateBasis', 'durationMinutes', 'durationBasis', 'timezone', 'tags', 'tagsBasis'];
  assertEq(Object.keys(json).sort(), expectedAllowedKeys.slice().sort(), '出力キーは許可リストのみ');
}
{
  assertThrows(() => nexusBuildDotExportJson(validInput({ action: 'タスクの生テキストをそのまま入れる' })), '許可されたenum以外のactionは拒否される（自由記述の抜け道を作らない）');
}
{
  assertThrows(() => nexusBuildDotExportJson(validInput({ dueDate: '2026/03/01' })), 'YYYY-MM-DD形式でないdueDateは拒否される');
}
{
  assertThrows(() => nexusBuildDotExportJson(validInput({ durationMinutes: 99999 })), '異常なdurationMinutesは拒否される');
}
{
  assertThrows(() => nexusBuildDotExportJson(validInput({ tags: ['顧客の実名タグ'] })), '許可リスト外のタグ文字列（自由記述タグ）は拒否される');
}
{
  const bad = validInput();
  bad.rawContent = '元の本文をそのまま入れてみる';
  const errs = nexusValidateDotExportJson(bad);
  assertTrue(errs.some(e => e.startsWith('unknown_key:')), '未知キー(rawContent)がエラーとして検出される');
}
{
  // 既存オブジェクトを丸ごとコピーして不要キーを消す、という作り方をしていないことの確認
  // （実在のtask/memoryのプロパティを直接渡しても、許可されたキーだけが出力される）
  const fakeFullTaskLikeInput = validInput();
  fakeFullTaskLikeInput.title = '顧客Aさんへの提案書作成';
  fakeFullTaskLikeInput.memo = '個人情報を含むメモ';
  const errs = nexusValidateDotExportJson({ ...validInput(), ...fakeFullTaskLikeInput });
  assertTrue(errs.includes('unknown_key:title') && errs.includes('unknown_key:memo'), '許可外のtitle/memoを混ぜてもバリデーションで検出される');
}

// ── §8: 結合確認 ── 完成したJSONのsourceRevision/taskRevisionに生の指紋が出ていないこと
{
  const m = mem('intg1', { content: '顧客Xさんとの詳細な商談内容' });
  const t = task('intgt1');
  const fp = nexusMemorySourceFingerprint(m);
  const tfp = nexusTaskFingerprintForDot(t);
  const step = nexusDotRevisionTokenEnsure({}, 'memory', m.id, fp);
  const stepT = nexusDotRevisionTokenEnsure(step.map, 'task', t.id, tfp);
  const json = nexusBuildDotExportJson(validInput({
    sourceRevision: step.version,
    taskRevision: stepT.version
  }));
  assertFalse(json.sourceRevision === fp, '出力されたsourceRevisionは本文由来の指紋そのものではない');
  assertFalse(json.taskRevision === tfp, '出力されたtaskRevisionはタスク由来の指紋そのものではない');
  assertFalse(JSON.stringify(json).includes('顧客X'), '出力JSONに本文の実名が含まれない');
  // 同じ内容で再度トークンを取得しても同じ値（再採番しない）
  const step2 = nexusDotRevisionTokenEnsure(step.map, 'memory', m.id, fp);
  assertEq(step2.version, step.version, '内容が変わらない限り同じ版トークンが返る（再採番しない）');
}

// ── §9: 保存の成功・失敗を確実に判定するヘルパー（useLSの例外握りつぶしを持ち込まない）──
{
  localStorage.clear();
  const r = nexusReadTasksRawSafe();
  assertEq(r, { ok: true, tasks: [] }, 'キー自体が無い場合は空配列として扱ってよい');
}
{
  localStorage.setItem('ml_tasks_v1', '{this is not json');
  const r = nexusReadTasksRawSafe();
  assertEq(r.ok, false, '不正なJSONは読込失敗として区別する（空配列扱いしない）');
  assertEq(r.reason, 'corrupt_data', '理由: corrupt_data');
  localStorage.removeItem('ml_tasks_v1');
}
{
  localStorage.setItem('ml_tasks_v1', JSON.stringify({ not: 'an array' }));
  const r = nexusReadTasksRawSafe();
  assertEq(r.ok, false, '配列でないデータも不正データとして区別する');
  localStorage.removeItem('ml_tasks_v1');
}
{
  const tasks = [task('verif1'), task('verif2')];
  const w = nexusWriteTasksRawVerified(tasks);
  assertEq(w, { ok: true }, '正常な書込は読み直しで確認され成功を返す');
  const r = nexusReadTasksRawSafe();
  assertEq(r.tasks.length, 2, '書き込んだ内容が読み直せる');
  localStorage.removeItem('ml_tasks_v1');
}
{
  localStorage.clear();
  const r = nexusReadDotRefMapSafe();
  assertEq(r, { ok: true, map: {} }, 'ref-mapが無い場合は空オブジェクトとして扱ってよい');
}
{
  localStorage.setItem('ml_dot_ref_map_v1', '[1,2,3]');
  const r = nexusReadDotRefMapSafe();
  assertEq(r.ok, false, '配列形式のref-mapは不正データとして区別する');
  localStorage.removeItem('ml_dot_ref_map_v1');
}
{
  const w = nexusWriteDotRefMapVerified({ memory: { m1: 'r1' } });
  assertEq(w, { ok: true }, 'ref-mapの正常な書込は確認され成功を返す');
  localStorage.removeItem('ml_dot_ref_map_v1');
}
{
  // 処理中マーカー：複数の同時操作が互いの記録を上書きしない（マップ形式）
  localStorage.clear();
  const w1 = nexusSetDotLinkPendingVerified('memA', 'taskA');
  assertEq(w1, { ok: true }, '1件目の処理中マーカーが保存される');
  const w2 = nexusSetDotLinkPendingVerified('memB', 'taskB');
  assertEq(w2, { ok: true }, '2件目（別の組み合わせ）の処理中マーカーも保存される');
  const read = nexusReadDotLinkPendingMapSafe();
  assertEq(Object.keys(read.map).length, 2, '2件の処理中マーカーが両方とも残っている（互いに上書きしていない）');
  nexusClearDotLinkPendingEntry('memA', 'taskA');
  const read2 = nexusReadDotLinkPendingMapSafe();
  assertEq(Object.keys(read2.map).length, 1, '1件だけクリアすると、もう1件は残る');
  assertTrue('memB::taskB' in read2.map, '残っているのは別の組み合わせの方');
  localStorage.removeItem('ml_dot_link_pending_v1');
}

console.log(`PASS: ${passed}, FAIL: ${failed}`);
if (failed > 0) {
  console.log('---FAILURES---');
  errors.forEach(e => console.log(' - ' + e));
  process.exit(1);
}
