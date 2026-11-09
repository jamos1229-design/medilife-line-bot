// サスペクトツリー（人脈→顧客→紹介・候補者・家族の折りたたみツリー）の純粋関数テスト（合成データのみ）。
// 実行: node tests/suspect-tree/pure.test.js
// 依存: Node.jsのみ。リポジトリ直下のnexus.htmlから対象関数を直接読み込んで評価する
// （tests/fan-follow-contact-log/pure.test.js等と同じ抽出パターン）。
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
global.document = { createElement: () => ({ click: () => {}, style: {} }), getElementById: () => null };
global.window = global;

eval(code);

const results = [];
function record(label, cond, extra) {
  results.push({ label, pass: !!cond });
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (extra !== undefined ? ' -- ' + JSON.stringify(extra) : ''));
}
const cust = o => ({ id: 'x', name: '', status: '未接触', contracts: [], suspects: [], referredBy: '', referredByName: '', lastContact: '', acquisitionSource: '', ...o });
const TODAY = '2026-11-10';
const findNode = (tree, key) => {
  let found = null;
  const walk = n => { if (n.key === key) found = n; n.children.forEach(walk); };
  tree.groups.forEach(g => g.nodes.forEach(walk));
  return found;
};
const groupOf = (tree, category) => tree.groups.find(g => g.category === category);

// ── 状態判定 ──
record('状態: 有効契約あり→既契約', nexusSuspectTreeCustomerState(cust({ contracts: [{ contractStatus: '有効' }] })) === '既契約');
record('状態: 解約・失効のみ→既契約にしない', nexusSuspectTreeCustomerState(cust({ contracts: [{ contractStatus: '解約' }, { contractStatus: '失効' }] })) === '未接触');
record('状態: 契約なし＋面談済→相談中', nexusSuspectTreeCustomerState(cust({ status: '面談済' })) === '相談中');
record('状態: 契約なし＋未接触→未接触', nexusSuspectTreeCustomerState(cust({})) === '未接触');

// ── 分類 ──
record('分類: 既契約は自動で既契約者', nexusSuspectTreeCustomerCategory(cust({ contracts: [{}] })) === '既契約者');
record('分類: 流入元SNS系はSNS・交流会', nexusSuspectTreeCustomerCategory(cust({ acquisitionSource: 'LinkedIn' })) === 'SNS・交流会');
record('分類: 判定材料が無ければ未分類（推測しない）', nexusSuspectTreeCustomerCategory(cust({ acquisitionSource: '紹介' })) === '未分類');
record('分類: 手動指定が最優先', nexusSuspectTreeCustomerCategory(cust({ contracts: [{}], networkCategory: '地域関係' })) === '地域関係');
record('分類: 不正な手動値は無視', nexusSuspectTreeCustomerCategory(cust({ networkCategory: 'でたらめ' })) === '未分類');
record('分類: 候補者 職場→仕事関係', nexusSuspectTreeCandidateCategory({ relationship: '職場' }) === '仕事関係');
record('分類: 候補者 地域→地域関係', nexusSuspectTreeCandidateCategory({ relationship: '地域' }) === '地域関係');
record('分類: 候補者 家族・親族は未分類のまま', nexusSuspectTreeCandidateCategory({ relationship: '家族・親族' }) === '未分類');
record('分類: 候補者 手動指定が最優先', nexusSuspectTreeCandidateCategory({ relationship: '職場', networkCategory: '友人・知人' }) === '友人・知人');

// ── 親子（紹介元） ──
{
  const pm = nexusSuspectTreeParentMap([cust({ id: 'a' }), cust({ id: 'b', referredBy: 'a' }), cust({ id: 'c', referredBy: 'zzz' }), cust({ id: 'd', referredBy: 'd' })]);
  record('紹介元: 登録済み顧客を指す場合だけ親になる', pm.b === 'a' && !pm.c && !pm.d, pm);
  const cyc = nexusSuspectTreeParentMap([cust({ id: 'a', referredBy: 'b' }), cust({ id: 'b', referredBy: 'a' })]);
  record('紹介元: 循環参照はつながず、無限ループしない', !cyc.a || !cyc.b, cyc);
}

// ── ツリー全体 ──
{
  const customers = [
    cust({ id: 'a', name: '青木 一郎', contracts: [{ contractStatus: '有効' }], lastContact: '2026-05-01',
      suspects: [{ id: 'sp1', name: '青木 花子', relation: '配偶者' }, { id: 'sp2', name: '旧名', relation: '子供', linkedCustomerId: 'e' }] }),
    cust({ id: 'b', name: '馬場 二郎', referredBy: 'a', status: '面談済', lastContact: '2026-11-01' }),
    cust({ id: 'c', name: '千葉 三郎', referredBy: 'b', contracts: [{ contractStatus: '有効' }] }),
    cust({ id: 'd', name: '土井 四郎', referredByName: '未登録 太郎' }),
    cust({ id: 'e', name: '青木 五郎' })
  ];
  const suspects = [
    { id: 's1', name: '候補 一', status: '育成中', relationship: '地域', referrer: '' },
    { id: 's2', name: '候補 二', status: '未接触', relationship: '未設定', referrer: '青木 一郎' },
    { id: 's3', name: '候補 三', status: '接触済み', relationship: '友人', referrer: '', referrerCustomerId: 'a' },
    { id: 's4', name: '候補 四', relationship: 'SNS', referrerCustomerId: '存在しないid' }
  ];
  const follows = [{ id: 'f1', customerId: 'a', campaignId: 'k', contacts: [{ id: 'ct', occurredAt: '2026-06-15', method: '電話', result: '通話' }] }];
  const tree = nexusBuildSuspectTree(customers, suspects, { follows, today: TODAY, staleDays: 90 });
  const a = findNode(tree, 'c:a');
  record('ツリー: 紹介元なしの既契約者は「既契約者」の直下', groupOf(tree, '既契約者').nodes.some(n => n.key === 'c:a'));
  record('ツリー: 紹介された顧客は紹介元の下に入る', a.children.some(n => n.key === 'c:b') && findNode(tree, 'c:b').children.some(n => n.key === 'c:c'));
  record('ツリー: 名前だけの紹介元（顧客未登録）はつながない', groupOf(tree, '未分類').nodes.some(n => n.key === 'c:d') && findNode(tree, 'c:d').unregisteredReferrerName === '未登録 太郎');
  record('ツリー: 顧客のサスペクトは家族・知人として下に出る', a.children.some(n => n.key === 'f:a:sp1' && n.kind === 'family' && n.relation === '配偶者'));
  record('ツリー: 顧客連携済みサスペクトは参照（顧客登録済み）で、連携先の名前を出す', a.children.some(n => n.kind === 'familyLink' && n.linkedCustomerId === 'e' && n.name === '青木 五郎'));
  record('ツリー: 候補者は関係性の分類で自分の直下に入る', groupOf(tree, '地域関係').nodes.some(n => n.key === 's:s1' && n.status === '育成中'));
  const s2 = findNode(tree, 's:s2');
  record('ツリー: 紹介者欄の名前一致だけでは自動接続しない', groupOf(tree, '未分類').nodes.some(n => n.key === 's:s2') && !a.children.some(n => n.key === 's:s2'));
  record('ツリー: 名前が1名だけ一致する場合は「つなぐ候補」として提示', s2.suggestReferrerId === 'a' && s2.referrerText === '青木 一郎');
  record('ツリー: 明示的に選んだ紹介元（referrerCustomerId）の下に入る', a.children.some(n => n.key === 's:s3'));
  record('ツリー: 存在しない顧客idの紹介元は無視して直下に置く', groupOf(tree, 'SNS・交流会').nodes.some(n => n.key === 's:s4'));
  record('集計: 直接の紹介人数（顧客＋候補者）', a.stats.referred === 2, a.stats);
  record('集計: 枝の合計人数・相談中・成約', a.stats.people === 3 && a.stats.consulting === 1 && a.stats.contracted === 1, a.stats);
  record('集計: 家族・知人は紹介人数と別に数える', a.stats.family === 1, a.stats);
  record('接触: 最終接触日は顧客欄とファン化フォロー記録の新しい方', a.lastContact === '2026-06-15', a.lastContact);
  record('接触: 90日以上あいた既契約は要フォロー', a.needsFollow === true && a.days === 148, { days: a.days });
  record('接触: 最近連絡した相談中は要フォローにしない', findNode(tree, 'c:b').needsFollow === false);
  const c = findNode(tree, 'c:c');
  record('接触: 記録が無い既契約は「接触記録なし」で、要フォローと断定しない', c.noContactRecord === true && c.needsFollow === false);
  record('接触: 未接触の顧客は要フォロー・記録なしの対象外', findNode(tree, 'c:e').needsFollow === false && findNode(tree, 'c:e').noContactRecord === false);
  record('合計: 顧客・既契約・相談中・候補者・家族', tree.totals.customers === 5 && tree.totals.contracted === 2 && tree.totals.consulting === 1 && tree.totals.candidates === 4 && tree.totals.family === 1, tree.totals);
  record('合計: 紹介でつながった人数（b・c・s3）', tree.totals.referralLinks === 3, tree.totals);
  record('合計: 要フォロー1名・接触記録なし1名', tree.totals.needsFollow === 1 && tree.totals.noContactRecord === 1, tree.totals);
  record('グループ: 5分類＋未分類の6グループを常に返す', tree.groups.length === 6 && tree.groups.map(g => g.category).join() === '既契約者,仕事関係,友人・知人,地域関係,SNS・交流会,未分類');
  record('グループ: 人数は枝の中の紹介先も含む', groupOf(tree, '既契約者').people === 4, groupOf(tree, '既契約者').people);

  const tree180 = nexusBuildSuspectTree(customers, suspects, { follows, today: TODAY, staleDays: 180 });
  record('接触: しきい値180日では148日は要フォローにならない', findNode(tree180, 'c:a').needsFollow === false);

  const filtered = nexusSuspectTreeFilterNodes(groupOf(tree, '既契約者').nodes, n => n.name.includes('千葉'));
  record('絞り込み: 該当者までの経路（親）を残す', filtered.length === 1 && filtered[0].key === 'c:a' && filtered[0].children.length === 1 && filtered[0].children[0].children[0].key === 'c:c');
  record('絞り込み: 元の木は変更しない', a.children.length === 4);
  record('件数: 顧客登録済みの参照は人数に数えない', nexusSuspectTreeCountNodes([a]) === 5, nexusSuspectTreeCountNodes([a]));
}

// ── 空・壊れたデータ ──
{
  const empty = nexusBuildSuspectTree([], [], { today: TODAY });
  record('空: 顧客も候補者もいなくても落ちない', empty.groups.length === 6 && empty.totals.customers === 0);
  const messy = nexusBuildSuspectTree([cust({ id: 'a', suspects: [null, { name: '' }] }), null, { name: 'idなし' }], [null, { name: 'idなし' }], { today: TODAY });
  record('壊れたデータ: null・id無しを無視し、名前未入力は表示用の名前にする', messy.totals.customers === 1 && messy.totals.candidates === 0 && findNode(messy, 'c:a').children[0].name === '(名前未入力)');
  const sameName = nexusSuspectTreeSuggestReferrer({ referrer: '同姓 同名' }, [cust({ id: 'p', name: '同姓 同名' }), cust({ id: 'q', name: '同姓 同名' })]);
  record('つなぐ候補: 同名の顧客が複数いる場合は提示しない', sameName === '');
}

const failed = results.filter(r => !r.pass).length;
console.log(`\nTOTAL: ${results.length}, PASS: ${results.length - failed}, FAIL: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
