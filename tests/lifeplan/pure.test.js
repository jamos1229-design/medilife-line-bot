// ライフプラン年次シミュレーション（初期版）の純粋関数テスト（合成データのみ、実データ・顧客情報は使わない）。
// 実行: node tests/lifeplan/pure.test.js
// 依存: Node.jsのみ。常にリポジトリ直下のnexus.htmlから対象関数を直接読み込んで評価するため、
// nexus.htmlが変更されても自動的に最新の内容でテストされる（事前生成した静的コピーには依存しない）。
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
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label + (extra !== undefined ? ' -- ' + extra : ''));
}
function approxEqual(a, b, eps) {
  return Math.abs(a - b) <= (eps === undefined ? 0.01 : eps);
}

// ════════════════════════════════════════════════════════════
// §1 期間生成（nexusLpBuildPeriods / nexusLpAddYears）
// ════════════════════════════════════════════════════════════
{
  const periods = nexusLpBuildPeriods({ basisDate: null, birthdate: null, currentAge: 65, maxAge: 100 });
  record('期間数：65歳開始→100歳で35期間', periods.length === 35, `len=${periods.length}`);
  record('期間0の開始年齢は65', periods[0].startAge === 65);
  record('最終期間の終了年齢は100', periods[periods.length - 1].endAge === 100);
  record('年齢のみの期間はisApprox=true', periods.every(p => p.isApprox === true));
}
{
  const periods = nexusLpBuildPeriods({ basisDate: null, birthdate: null, currentAge: 40, maxAge: 100 });
  record('期間数：40歳開始→100歳で60期間', periods.length === 60, `len=${periods.length}`);
}
{
  const periods = nexusLpBuildPeriods({ basisDate: '2026-10-07', birthdate: '1986-06-15', currentAge: null, maxAge: 100 });
  record('誕生日あり：期首年齢は基準日時点の満年齢(40)', periods[0].startAge === 40, `startAge=${periods[0].startAge}`);
  record('誕生日あり：isApprox=false', periods.every(p => p.isApprox === false));
  record('誕生日あり：期間0の開始日は基準日そのもの', periods[0].startDate === '2026-10-07');
  record('誕生日あり：期間0の終了日は次の誕生日(2027-06-15)', periods[0].endDate === '2027-06-15', periods[0].endDate);
}
{
  const d = nexusLpAddYears('2000-02-29', 1);
  record('閏日境界：2000-02-29 + 1年 = 2001-02-28', d === '2001-02-28', d);
  const d2 = nexusLpAddYears('2000-02-29', 4);
  record('閏日境界：2000-02-29 + 4年 = 2004-02-29', d2 === '2004-02-29', d2);
}

// ════════════════════════════════════════════════════════════
// §2 計算エンジン：ユーザー指定のシナリオC/D/E/F（厳密な数値検算）
// ════════════════════════════════════════════════════════════
{
  const input = {
    status: 'complete',
    periods: nexusLpBuildPeriods({ basisDate: null, birthdate: null, currentAge: 65, maxAge: 100 }),
    assetCategories: [{ key: 'pool', label: '取り崩し可能資産', openingBalanceJpy: 50000000, returnRatePct: 3, eligible: true, isCashSink: true, withdrawable: true, drawOrder: 0 }],
    incomeStreams: [],
    pensionStreams: [{ id: 'pension', startPeriodIndex: 0, endPeriodIndex: null, baseAnnualJpy: 2400000, riseRatePct: 0 }],
    expenseStreams: [{ id: 'living', startPeriodIndex: 0, endPeriodIndex: null, baseAnnualJpy: 3600000, riseRatePct: 2 }],
    contributions: []
  };
  const result = calculateLifePlan(input);
  const y0 = result.rows[0];
  const y1 = result.rows[1];
  record('C: 初年度末資産 = 5030万円', approxEqual(y0.endBalances.pool, 50300000, 1), y0.endBalances.pool);
  record('C: 翌年度末資産 = 5053.7万円', approxEqual(y1.endBalances.pool, 50537000, 1), y1.endBalances.pool);
  record('C: 35年間フルで計算すると最終的に資金不足が生じる（年金一定×生活費上昇という前提の自然な結果）', result.firstUnmetShortfallPeriod === 33, result.firstUnmetShortfallPeriod);
}
{
  const input = {
    periods: nexusLpBuildPeriods({ basisDate: null, birthdate: null, currentAge: 30, maxAge: 31 }),
    assetCategories: [
      { key: 'cash', label: '現金', openingBalanceJpy: 1000000, returnRatePct: 0, eligible: true, isCashSink: true, withdrawable: true, drawOrder: 0 },
      { key: 'invest', label: '投資', openingBalanceJpy: 0, returnRatePct: 0, eligible: true, isCashSink: false, withdrawable: true, drawOrder: 1 }
    ],
    incomeStreams: [{ id: 'inc', startPeriodIndex: 0, endPeriodIndex: null, baseAnnualJpy: 2000000, riseRatePct: 0 }],
    pensionStreams: [],
    expenseStreams: [{ id: 'exp', startPeriodIndex: 0, endPeriodIndex: null, baseAnnualJpy: 1500000, riseRatePct: 0 }],
    contributions: [{ id: 'contrib', startPeriodIndex: 0, endPeriodIndex: null, baseAnnualJpy: 600000, riseRatePct: 0, targetCategoryKey: 'invest' }]
  };
  const result = calculateLifePlan(input);
  const y0 = result.rows[0];
  record('D: 期末現金 = 90(900,000円)', approxEqual(y0.endBalances.cash, 900000, 1), y0.endBalances.cash);
  record('D: 期末投資 = 60(600,000円)', approxEqual(y0.endBalances.invest, 600000, 1), y0.endBalances.invest);
  record('D: 合計 = 150(1,500,000円)、合計90にしない', approxEqual(y0.endBalances.cash + y0.endBalances.invest, 1500000, 1));
}
{
  const input = {
    periods: nexusLpBuildPeriods({ basisDate: null, birthdate: null, currentAge: 30, maxAge: 31 }),
    assetCategories: [
      { key: 'cash', label: '現金', openingBalanceJpy: 100000, returnRatePct: 0, eligible: true, isCashSink: true, withdrawable: true, drawOrder: 0 },
      { key: 'invest', label: '投資', openingBalanceJpy: 1000000, returnRatePct: 0, eligible: true, isCashSink: false, withdrawable: true, drawOrder: 1 }
    ],
    incomeStreams: [],
    pensionStreams: [],
    expenseStreams: [{ id: 'exp', startPeriodIndex: 0, endPeriodIndex: null, baseAnnualJpy: 500000, riseRatePct: 0 }],
    contributions: []
  };
  const result = calculateLifePlan(input);
  const y0 = result.rows[0];
  record('E: 期末現金 = 0', approxEqual(y0.endBalances.cash, 0, 1), y0.endBalances.cash);
  record('E: 期末投資 = 60(600,000円)', approxEqual(y0.endBalances.invest, 600000, 1), y0.endBalances.invest);
  record('E: 資金不足 = 0', y0.unmetShortfall === 0, y0.unmetShortfall);
  record('E: 取り崩し可能資産は枯渇していない（資産枯渇としない）', result.firstWithdrawableDepletionPeriod === null);
}
{
  const input = {
    periods: nexusLpBuildPeriods({ basisDate: null, birthdate: null, currentAge: 30, maxAge: 32 }),
    assetCategories: [{ key: 'pool', label: '利用可能資産', openingBalanceJpy: 300000, returnRatePct: 0, eligible: true, isCashSink: true, withdrawable: true, drawOrder: 0 }],
    incomeStreams: [],
    pensionStreams: [],
    expenseStreams: [{ id: 'exp', startPeriodIndex: 0, endPeriodIndex: null, baseAnnualJpy: 500000, riseRatePct: 0 }],
    contributions: []
  };
  const result = calculateLifePlan(input);
  const y0 = result.rows[0];
  const y1 = result.rows[1];
  record('F: 期末資産 = 0', y0.endBalances.pool === 0, y0.endBalances.pool);
  record('F: 資金不足 = 20(200,000円)', approxEqual(y0.unmetShortfall, 200000, 1), y0.unmetShortfall);
  record('F: 取り崩し可能資産の枯渇period=0として記録される', result.firstWithdrawableDepletionPeriod === 0);
  record('F: 翌期も資産0のまま（負の資産に運用益がついて増えたりしない）', y1.endBalances.pool === 0, y1.endBalances.pool);
  record('F: 翌期は期首残高0のため支出全額(50万円)が資金不足、累積は前期分と合算して70万円', y1.unmetShortfall === 500000 && result.cumulativeUnmetShortfall === 700000, `y1=${y1.unmetShortfall} cum=${result.cumulativeUnmetShortfall}`);
}
{
  const input = {
    periods: nexusLpBuildPeriods({ basisDate: null, birthdate: null, currentAge: 30, maxAge: 31 }),
    assetCategories: [{ key: 'pool', label: 'p', openingBalanceJpy: 1000000, returnRatePct: 0, eligible: true, isCashSink: true, withdrawable: true, drawOrder: 0 }],
    incomeStreams: [], pensionStreams: [], expenseStreams: [], contributions: []
  };
  const result = calculateLifePlan(input);
  record('運用率0%は欠損扱いにならず、資産が増減しない', result.rows[0].endBalances.pool === 1000000);
}
{
  const input = {
    periods: nexusLpBuildPeriods({ basisDate: null, birthdate: null, currentAge: 30, maxAge: 31 }),
    assetCategories: [{ key: 'pool', label: 'p', openingBalanceJpy: 1000000, returnRatePct: -5, eligible: true, isCashSink: true, withdrawable: true, drawOrder: 0 }],
    incomeStreams: [], pensionStreams: [], expenseStreams: [], contributions: []
  };
  const result = calculateLifePlan(input);
  record('マイナス運用率(-5%)は欠損扱いにならず適用される', approxEqual(result.rows[0].endBalances.pool, 950000, 1), result.rows[0].endBalances.pool);
}

// ════════════════════════════════════════════════════════════
// §3 正規化層：ユーザー指定のシナリオA/B・追加確認
// ════════════════════════════════════════════════════════════
// nexus.htmlのNEXUS_EDUCATION_STAGES（大学部分）と同じ形。トップレベルconstはevalのレキシカル
// スコープ内に閉じてしまい外から参照できないため、テスト側で同じ値を直接持つ
// （本物のNEXUS_EDUCATION_STAGESは既存の教育プランニング機能のテストで別途検証されている）。
const EDU_STAGES = [{
  key: 'university', label: '大学', startAge: 18, years: 4,
  lumpCosts: { '国公立': 250, '私立文系': 400, '私立理系': 550 }
}];

{
  const ctx = {
    todayDateStr: '2026-10-07', birthdate: null, age: 40, ageYear: 2026,
    lp: {
      incomeItems: [{ id: 'inc1', type: '給与', unit: 'yearly', amount: 7000000 }],
      expenseItems: [], savingsItems: [], loans: [],
      retirement: { retirementAge: 65 }
    },
    lifePlan: {
      livingExpense: { baseAnnualJpy: 1920000, riseRatePct: 2 },
      pension: { includeInSim: true, riseRatePct: 0 },
      incomeOverrides: { inc1: { includeInSim: true, riseRatePct: 0 } }
    },
    portfolioCategoryTotals: {}, kidsForEducation: [], educationStages: EDU_STAGES, contractsForPremium: []
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('A: status=partial', input.status === 'partial', input.status);
  record('A: 年金額未入力がmissingInputsに記録される', input.missingInputs.includes('pension_amount'));
  record('A: 年収の額面/手取り不明がmissingInputsに記録される（可処分所得と断定しない）', input.missingInputs.includes('income_net_unconfirmed:inc1'));
  record('A: 額面のみの給与はincomeStreamsに加算されない（除外される）', input.incomeStreams.length === 0, JSON.stringify(input.incomeStreams));
  record('A: 資産未確認がmissingInputsに記録される', input.missingInputs.includes('no_assets_confirmed'));
  const result = calculateLifePlan(input);
  record('A: エンジンは実行できる（止めない）が、statusはpartialのまま', result.status === 'partial');
}
{
  const ctx = {
    todayDateStr: '2026-10-07', birthdate: null, age: 33, ageYear: 2026,
    lp: {
      incomeItems: [
        { id: 'inc_self', type: '給与', unit: 'yearly', amount: 4030000, amountType: '手取り' },
        { id: 'inc_spouse', type: '配偶者給与', unit: 'yearly', amount: 3770000, amountType: '手取り' }
      ],
      expenseItems: [], savingsItems: [],
      loans: [{ id: 'loan1', category: '住宅', balance: 35000000 }],
      retirement: {}
    },
    lifePlan: {
      livingExpense: { baseAnnualJpy: 3000000, riseRatePct: 1 },
      pension: { includeInSim: false },
      incomeOverrides: {
        inc_self: { includeInSim: true, riseRatePct: 0 },
        inc_spouse: { includeInSim: true, riseRatePct: 0 }
      },
      housing: { loanOverrides: { loan1: { includeInSim: true } } },
      education: { mode: 'separate' }
    },
    portfolioCategoryTotals: { deposits: 2000000 },
    kidsForEducation: [{ id: 'kid1', age: 1, ageYear: 2026, track: { university: '国公立' } }],
    educationStages: EDU_STAGES, contractsForPremium: []
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('B: 返済額・残年数が未確認のローンは支出に含めない', input.missingInputs.includes('loan_amount_unconfirmed:loan1'));
  record('B: ローンがexpenseStreamsに含まれない', !input.expenseStreams.some(s => s.id === 'loan:loan1'));
  record('B: 本人・配偶者の収入は両方incomeStreamsに含まれる（重複なし、2件）', input.incomeStreams.length === 2, input.incomeStreams.length);
  const uniStream = input.expenseStreams.find(s => s.id === 'education:kid1:university');
  record('B: 大学費用の年額は625,000円（国公立250万円÷4年）', uniStream && Math.abs(uniStream.baseAnnualJpy - 625000) < 1, uniStream && uniStream.baseAnnualJpy);
  record('B: 大学費用の対象期間は4期間分だけ（毎年全額ではない）', uniStream && uniStream.endPeriodIndex - uniStream.startPeriodIndex === 4);
}
{
  const base = {
    todayDateStr: '2026-10-07', birthdate: null, age: 30, ageYear: 2026,
    lp: { incomeItems: [], expenseItems: [], savingsItems: [], loans: [], retirement: {} },
    portfolioCategoryTotals: { cash: 1000000 },
    kidsForEducation: [], educationStages: EDU_STAGES, contractsForPremium: []
  };
  const ctx1 = { ...base, lifePlan: { livingExpense: { baseAnnualJpy: 3000000, riseRatePct: 0 }, pension: { includeInSim: false }, assetCategories: { cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } } } };
  const in1 = nexusLifePlanNormalizeInput(ctx1);
  record('追加: 生活費上昇率に明示的な0は欠損扱いにならない', !in1.missingInputs.includes('living_expense_rise_rate'));
  const ctx2 = { ...base, lifePlan: { livingExpense: { baseAnnualJpy: 3000000, riseRatePct: '' }, pension: { includeInSim: false }, assetCategories: { cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } } } };
  const in2 = nexusLifePlanNormalizeInput(ctx2);
  record('追加: 生活費上昇率が未入力（空文字）ならmissingInputsに記録される', in2.missingInputs.includes('living_expense_rise_rate'));
  record('追加: 不正値([1,2])はnexusLpValidNumberOrNullでnullになる', nexusLpValidNumberOrNull([1, 2]) === null);
  record('追加: 不正値("abc")はnullになる', nexusLpValidNumberOrNull('abc') === null);
  record('追加: Infinityはnullになる', nexusLpValidNumberOrNull(Infinity) === null);
  record('追加: 文字列"0"は有効な0として扱われる', nexusLpValidNumberOrNull('0') === 0);
  record('追加: 数値0は有効な0として扱われる（欠損にしない）', nexusLpValidNumberOrNull(0) === 0);
}
{
  const ctx = {
    todayDateStr: '2026-10-07', birthdate: null, age: 65, ageYear: 2026,
    lp: { incomeItems: [], expenseItems: [], savingsItems: [], loans: [], retirement: { retirementAge: 65, pensionMonthly: 200000 } },
    lifePlan: {
      livingExpense: { baseAnnualJpy: 3000000, riseRatePct: 3 },
      pension: { includeInSim: true, riseRatePct: 0 },
      assetCategories: { cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } }
    },
    portfolioCategoryTotals: { cash: 10000000 },
    kidsForEducation: [], educationStages: EDU_STAGES, contractsForPremium: []
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  const result = calculateLifePlan(input);
  const pensionYear0 = result.rows[0].incomeBreakdown.pension_self;
  const pensionYear5 = result.rows[5].incomeBreakdown.pension_self;
  record('追加: 年金上昇率0%なら5年後も年金額は変わらない', pensionYear0 === pensionYear5, `y0=${pensionYear0} y5=${pensionYear5}`);
}

// ════════════════════════════════════════════════════════════
// §4 年金の二重計上防止と取りこぼし防止（本番反映前レビュー対応）
// ════════════════════════════════════════════════════════════
const pensionBase = {
  todayDateStr: '2026-10-07', birthdate: null, age: 65, ageYear: 2026,
  portfolioCategoryTotals: { cash: 10000000 },
  kidsForEducation: [], educationStages: EDU_STAGES, contractsForPremium: []
};
// ①retirement未入力で、incomeItemsだけに年金がある → 取りこぼさず通常の収入として計上できる
{
  const ctx = {
    ...pensionBase,
    lp: { incomeItems: [{ id: 'inc_pension1', type: '年金', unit: 'yearly', amount: 1200000, amountType: '手取り' }], expenseItems: [], savingsItems: [], loans: [], retirement: {} },
    lifePlan: {
      pension: { includeInSim: false },
      assetCategories: { cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } },
      incomeOverrides: { inc_pension1: { includeInSim: true, riseRatePct: 0 } }
    }
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('①retirement未入力+incomeItemsのみ年金: 重複候補として除外されず、通常の収入として計上される', input.incomeStreams.some(s => s.id === 'inc_pension1' && s.baseAnnualJpy === 1200000), JSON.stringify(input.incomeStreams));
  record('①retirement未入力+incomeItemsのみ年金: pension_duplicate_candidateは記録されない（老後プランニング側に年金データが無いため）', !input.missingInputs.some(k => k.startsWith('pension_duplicate_candidate')));
}
// ②同じ公的年金が両方（retirement＋incomeItems）にある → 未確認のうちはどちらにも二重計上しない
{
  const ctx = {
    ...pensionBase,
    lp: { incomeItems: [{ id: 'inc_pension2', type: '年金', unit: 'yearly', amount: 2400000, amountType: '手取り' }], expenseItems: [], savingsItems: [], loans: [], retirement: { retirementAge: 65, pensionMonthly: 200000 } },
    lifePlan: {
      pension: { includeInSim: true, riseRatePct: 0 },
      assetCategories: { cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } },
      incomeOverrides: { inc_pension2: { includeInSim: true, riseRatePct: 0 } } // pensionDuplicateStatus未確認
    }
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('②同じ公的年金が両方にある（未確認）: incomeItems側は重複候補として記録され、どちらにも計上しない', input.missingInputs.includes('pension_duplicate_candidate:inc_pension2') && !input.incomeStreams.some(s => s.id === 'inc_pension2'));
  record('②同じ公的年金が両方にある（未確認）: retirement側のpension_selfは引き続き計上される（取りこぼさない）', input.pensionStreams.some(s => s.id === 'pension_self' && s.baseAnnualJpy === 2400000));
  // 「同じ年金」と明示確認した場合：incomeItems側を除外し、記録もしない
  const ctx2 = { ...ctx, lifePlan: { ...ctx.lifePlan, incomeOverrides: { inc_pension2: { includeInSim: true, riseRatePct: 0, pensionDuplicateStatus: 'duplicateExcluded' } } } };
  const input2 = nexusLifePlanNormalizeInput(ctx2);
  record('②「同じ年金」と確認済み: incomeItems側は計上されず、missingInputsにも記録されない', !input2.incomeStreams.some(s => s.id === 'inc_pension2') && !input2.missingInputs.some(k => k.startsWith('pension_duplicate_candidate')));
}
// ③公的年金（retirement）と私的年金（incomeItems、別の年金と確認済み）が別々にある → 両方加算される
{
  const ctx = {
    ...pensionBase,
    lp: { incomeItems: [{ id: 'inc_private_pension', type: '年金', unit: 'yearly', amount: 600000, amountType: '手取り' }], expenseItems: [], savingsItems: [], loans: [], retirement: { retirementAge: 65, pensionMonthly: 200000 } },
    lifePlan: {
      pension: { includeInSim: true, riseRatePct: 0 },
      assetCategories: { cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } },
      incomeOverrides: { inc_private_pension: { includeInSim: true, riseRatePct: 0, pensionDuplicateStatus: 'separate' } }
    }
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  const result = calculateLifePlan(input);
  const totalPensionYear0 = result.rows[0].totalIncome;
  record('③公的年金＋私的年金（別の年金と確認済み）: 私的年金がincomeStreamsに計上される', input.incomeStreams.some(s => s.id === 'inc_private_pension' && s.baseAnnualJpy === 600000));
  record('③公的年金＋私的年金: 両方が合算され、初年度の総収入は240万+60万=300万円（取りこぼし無し）', totalPensionYear0 === 3000000, totalPensionYear0);
}
// ④本人と配偶者で受給開始時期が違う → 未確認のうちは配偶者側を含めない（タイミングを推測しない）。確認すれば別ストリームで正しい時期から
{
  const ctx = {
    ...pensionBase,
    lp: { incomeItems: [], expenseItems: [], savingsItems: [], loans: [], retirement: { retirementAge: 65, pensionMonthly: 200000, spousePensionMonthly: 150000 } },
    lifePlan: {
      pension: { includeInSim: true, riseRatePct: 0 }, // spouseStartAgeSelfEquivalent未確認
      assetCategories: { cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } }
    }
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('④配偶者の受給開始時期未確認: pension_spouse_start_age_unconfirmedが記録される', input.missingInputs.includes('pension_spouse_start_age_unconfirmed'));
  record('④配偶者の受給開始時期未確認: 配偶者分は本人と同じ開始時期に推測されず、pensionStreamsに含まれない', !input.pensionStreams.some(s => s.id === 'pension_spouse'));
  record('④配偶者の受給開始時期未確認: 本人分は引き続き計上される', input.pensionStreams.some(s => s.id === 'pension_self' && s.baseAnnualJpy === 2400000));
  // 本人68歳の時に配偶者の年金が始まる、と明示確認した場合
  const ctx2 = { ...ctx, lifePlan: { ...ctx.lifePlan, pension: { ...ctx.lifePlan.pension, spouseStartAgeSelfEquivalent: 68 } } };
  const input2 = nexusLifePlanNormalizeInput(ctx2);
  const spouseStream = input2.pensionStreams.find(s => s.id === 'pension_spouse');
  record('④受給開始時期を確認済み: 配偶者分が本人68歳開始（period index=3）として計上される', spouseStream && spouseStream.startPeriodIndex === 3, spouseStream);
  const result2 = calculateLifePlan(input2);
  record('④受給開始時期を確認済み: 本人65〜67歳は配偶者年金なし、68歳から配偶者年金が加わる', result2.rows[2].incomeBreakdown.pension_spouse === 0 && result2.rows[3].incomeBreakdown.pension_spouse === 1800000, `age67=${result2.rows[2].incomeBreakdown.pension_spouse} age68=${result2.rows[3].incomeBreakdown.pension_spouse}`);
}
// ⑤年金タイプの収入項目も、額面のままでは手取り収支として扱わない（確認済み手取り額が必要）
{
  const ctx = {
    ...pensionBase,
    lp: { incomeItems: [{ id: 'inc_pension5', type: '年金', unit: 'yearly', amount: 1500000 /* amountType未設定＝額面か手取りか不明 */ }], expenseItems: [], savingsItems: [], loans: [], retirement: {} },
    lifePlan: {
      pension: { includeInSim: false },
      assetCategories: { cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } },
      incomeOverrides: { inc_pension5: { includeInSim: true, riseRatePct: 0 } }
    }
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('⑤年金タイプも額面/手取り不明なら計上されず、income_net_unconfirmedが記録される', input.missingInputs.includes('income_net_unconfirmed:inc_pension5') && !input.incomeStreams.some(s => s.id === 'inc_pension5'));
}
{
  const ctx = {
    todayDateStr: '2026-10-07', birthdate: null, age: 40, ageYear: 2026,
    lp: { incomeItems: [], expenseItems: [], savingsItems: [], loans: [], retirement: {} },
    lifePlan: {
      livingExpense: { baseAnnualJpy: 2000000, riseRatePct: 0 },
      pension: { includeInSim: false },
      assetCategories: { cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } },
      insurance: { includeInSim: true }
    },
    portfolioCategoryTotals: { cash: 5000000 },
    kidsForEducation: [], educationStages: EDU_STAGES,
    contractsForPremium: [
      { id: 'ctLump', paymentCycle: '一時払', premium: 3000000, date: '2020-01-01', premiumPaymentStatus: '払込完了' },
      { id: 'ctMonthly', paymentCycle: '月払', premium: 10000 }
    ]
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('追加: 一時払保険料(ctLump、過去の契約日＋払込完了確認済み)はexpenseStreamsに含まれない（払込済み）', !input.expenseStreams.some(s => s.id === 'premium:ctLump'));
  record('追加: 一時払保険料(ctLump)は払込完了が確認済みのため未確認フラグも立たない', !input.missingInputs.some(k => k.includes('ctLump')));
  record('追加: 月払保険料(ctMonthly)は年額12万円としてexpenseStreamsに含まれる', input.expenseStreams.some(s => s.id === 'premium:ctMonthly' && s.baseAnnualJpy === 120000));
}

// ════════════════════════════════════════════════════════════
// §5 保険料：払込方法だけで「支払済み」と決めない（本番反映前レビュー対応）
// ════════════════════════════════════════════════════════════
const premiumBase = {
  todayDateStr: '2026-10-07', birthdate: '1986-10-07', age: null, ageYear: null,
  lp: { incomeItems: [], expenseItems: [], savingsItems: [], loans: [], retirement: {} },
  lifePlan: {
    livingExpense: { baseAnnualJpy: 1000000, riseRatePct: 0 },
    pension: { includeInSim: false },
    assetCategories: { cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } },
    insurance: { includeInSim: true }
  },
  portfolioCategoryTotals: { cash: 1000000 },
  kidsForEducation: [], educationStages: EDU_STAGES
};
// ①一時払・契約日未確認 → 0円と断定せず未反映として記録する
{
  const ctx = { ...premiumBase, contractsForPremium: [{ id: 'ct1', paymentCycle: '一時払', premium: 3000000 }] };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('①一時払・契約日未確認: premium_lump_date_unconfirmedが記録される（未反映を明示）', input.missingInputs.includes('premium_lump_date_unconfirmed:ct1'));
  record('①一時払・契約日未確認: expenseStreamsには含まれない（0円と断定もしない）', !input.expenseStreams.some(s => s.id === 'premium:ct1'));
}
// ②一時払・契約日が基準日より先（将来の支払予定） → 漏らさず未反映として記録する
{
  const ctx = { ...premiumBase, contractsForPremium: [{ id: 'ct2', paymentCycle: '一時払', premium: 3000000, date: '2027-01-01' }] };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('②一時払・将来の契約日: premium_future_lump_unconfirmedが記録される（将来の支払予定を漏らさない）', input.missingInputs.includes('premium_future_lump_unconfirmed:ct2'));
}
// ①-b 一時払・過去の契約日＋払込完了を確認済み → 将来の保険料に再計上しない
{
  const ctx = { ...premiumBase, contractsForPremium: [{ id: 'ct1b', paymentCycle: '一時払', premium: 3000000, date: '2020-01-01', premiumPaymentStatus: '払込完了' }] };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('①-b 過去の契約日＋払込完了確認済み: 未確認フラグが立たない', !input.missingInputs.some(k => k.includes('ct1b')), input.missingInputs);
  record('①-b 過去の契約日＋払込完了確認済み: expenseStreamsに含まれない（将来の保険料に再計上しない）', !input.expenseStreams.some(s => s.id === 'premium:ct1b'));
}
// ①-c 一時払・過去の契約日だが払込状況が未確認（premiumPaymentStatus未設定）
// → 契約日だけで支払済みにせず、未確認として表示する（本番反映前レビュー対応：契約日≠支払の証拠）
{
  const ctx = { ...premiumBase, contractsForPremium: [{ id: 'ct1c', paymentCycle: '一時払', premium: 3000000, date: '2020-01-01' }] };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('①-c 過去の契約日＋払込状況未確認: premium_lump_payment_status_unconfirmedが記録される（契約日だけで支払済みにしない）', input.missingInputs.includes('premium_lump_payment_status_unconfirmed:ct1c'), input.missingInputs);
  record('①-c 過去の契約日＋払込状況未確認: expenseStreamsには含まれない（0円と断定もしない）', !input.expenseStreams.some(s => s.id === 'premium:ct1c'));
}
// ①-d 一時払・過去の契約日だが払込状況が「通常払込」（払込完了ではない）
// → 払込完了が明示確認されていない限り、支払済みと断定しない
{
  const ctx = { ...premiumBase, contractsForPremium: [{ id: 'ct1d', paymentCycle: '全期前納', premium: 3000000, date: '2020-01-01', premiumPaymentStatus: '通常払込' }] };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('①-d 過去の契約日＋payment statusが「通常払込」（払込完了ではない）: 未確認として記録される', input.missingInputs.includes('premium_lump_payment_status_unconfirmed:ct1d'), input.missingInputs);
}
// ③前期前納・前納期間終了後に再開（契約日＋前納回数＋前納時1回あたり保険料が確認済み）
{
  const ctx = { ...premiumBase, contractsForPremium: [{ id: 'ct3', paymentCycle: '前期前納', date: '2020-10-07', prepaidCount: 5, premiumPerPayment: 100000, paymentTermEnd: '2060-10-07' }] };
  const input = nexusLifePlanNormalizeInput(ctx);
  const stream = input.expenseStreams.find(s => s.id === 'premium:ct3');
  // 契約日2020-10-07＋前納5年＝2025-10-07に再開。基準日2026-10-07時点で本人は40歳（誕生日1986-10-07）。
  // 2025-10-07時点の年齢は39歳のため、period(本人の年齢)で言うと「39歳の期（index -1→0に丸め）」から再開。
  record('③前期前納・再開確認済み: 前納終了後に再開する支出ストリームが作られる', !!stream, JSON.stringify(stream));
  record('③前期前納・再開確認済み: 再開後の年額は前納時の1回あたり保険料と同額', stream && stream.baseAnnualJpy === 100000);
  record('③前期前納・再開確認済み: 払込期間終了（2060-10-07、本人74歳）でストリームが終了する', stream && stream.endPeriodIndex === 34, stream);
}
// ④前期前納・前納回数が未確認 → 0円と断定せず未反映として記録する
{
  const ctx = { ...premiumBase, contractsForPremium: [{ id: 'ct4', paymentCycle: '前期前納', date: '2020-10-07', premiumPerPayment: 100000 }] };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('④前期前納・前納回数未確認: premium_prepaid_resume_unconfirmedが記録される', input.missingInputs.includes('premium_prepaid_resume_unconfirmed:ct4'));
  record('④前期前納・前納回数未確認: expenseStreamsには含まれない', !input.expenseStreams.some(s => s.id === 'premium:ct4'));
}
// ⑤月払・払込期間終了（paymentTermEnd）が確認済み → そこで計上を終了する（従来は無視して継続計上していた）
{
  const ctx = { ...premiumBase, contractsForPremium: [{ id: 'ct5', paymentCycle: '月払', premium: 10000, paymentTermEnd: '2051-10-07' /* 本人65歳 */ }] };
  const input = nexusLifePlanNormalizeInput(ctx);
  const stream = input.expenseStreams.find(s => s.id === 'premium:ct5');
  record('⑤月払・払込期間終了確認済み: endPeriodIndexが65歳相当(25)に設定される（無視されない）', stream && stream.endPeriodIndex === 25, stream);
}
// ⑥月払・払込免除中だが確認未完了（保険会社への全額免除確認待ち） → 免除を適用せず、未確認として記録する
{
  const ctx = { ...premiumBase, contractsForPremium: [{ id: 'ct6', paymentCycle: '月払', premium: 10000, premiumPaymentStatus: '払込免除中', waiverStartDate: '2026-01-01' /* waiverFullyConfirmed未設定 */ }] };
  const input = nexusLifePlanNormalizeInput(ctx);
  const stream = input.expenseStreams.find(s => s.id === 'premium:ct6');
  record('⑥払込免除中・確認未完了: premium_waiver_unconfirmedが記録される', input.missingInputs.includes('premium_waiver_unconfirmed:ct6'));
  record('⑥払込免除中・確認未完了: 免除を適用せず全額を計上する（過少計上しない）', stream && stream.proration === null, stream);
}
// ⑦月払・払込免除が確認済み（3条件すべて満たす） → 免除開始日から正しく0円になる
{
  // 誕生日1986-10-07・基準日2026-10-07＝period0は本人40〜41歳(2026-10-07〜2027-10-07)、
  // period1は41〜42歳(2027-10-07〜2028-10-07)。waiverStartDateをperiod1の途中に設定する。
  const ctx = { ...premiumBase, contractsForPremium: [{ id: 'ct7', paymentCycle: '月払', premium: 10000, premiumPaymentStatus: '払込免除中', waiverFullyConfirmed: true, waiverStartDate: '2028-04-07' }] };
  const input = nexusLifePlanNormalizeInput(ctx);
  const stream = input.expenseStreams.find(s => s.id === 'premium:ct7');
  record('⑦払込免除確認済み: 免除開始前の期間は全額（period0=40〜41歳）', stream && stream.proration && stream.proration[0] === 1, JSON.stringify(stream && stream.proration));
  record('⑦払込免除確認済み: 免除開始日を含む期間(41〜42歳)は一部のみ課金される（0と1の間）', stream && stream.proration && stream.proration[1] > 0 && stream.proration[1] < 1, stream && stream.proration && stream.proration[1]);
  record('⑦払込免除確認済み: 免除開始後の期間(42〜43歳)は0円', stream && stream.proration && stream.proration[2] === 0, JSON.stringify(stream && stream.proration));
}

// ── 追加確認：残高0円の資産区分は、未確認でもmissingInputsに記録しない
// （10区分すべてを毎回チェックしないとcompleteにならない、という実用的でない要求を避ける） ──
{
  const ctx = {
    todayDateStr: '2026-10-07', birthdate: null, age: 40, ageYear: 2026,
    lp: { incomeItems: [], expenseItems: [], savingsItems: [], loans: [], retirement: {} },
    lifePlan: {
      livingExpense: { baseAnnualJpy: 2000000, riseRatePct: 0 },
      pension: { includeInSim: false },
      assetCategories: { deposits: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } },
      // お子様・保険契約の登録が無いことを本人が確認済み（未登録と確認済みの「なし」を区別）
      education: { noChildrenConfirmed: true },
      insurance: { noContractsConfirmed: true }
    },
    // depositsだけ残高があり、他の9区分はすべて0円（未登録）
    portfolioCategoryTotals: { deposits: 5000000, fundsStocks: 0, corporateDc: 0, ideco: 0, mutualPension: 0, bonds: 0, fx: 0, crypto: 0, realEstate: 0, misc: 0 },
    kidsForEducation: [], educationStages: EDU_STAGES, contractsForPremium: []
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('追加: 残高0円の資産区分(fundsStocks等)はmissingInputsに記録されない', !input.missingInputs.some(k => k.startsWith('asset:fundsStocks') || k.startsWith('asset:bonds') || k.startsWith('asset:crypto')), JSON.stringify(input.missingInputs));
  record('追加: 残高のあるdepositsを確認済みにすればstatus=complete（他区分の確認は不要）', input.status === 'complete', JSON.stringify(input.missingInputs));
}

// ════════════════════════════════════════════════════════════
// §6 未入力・ゼロ・対象外の区別（本番反映前レビュー対応）
// ════════════════════════════════════════════════════════════
// ①資産集計が欠損を0円に変換していても、明細（配列）があれば入力完了と判定しない
{
  const ctx = {
    todayDateStr: '2026-10-07', birthdate: null, age: 40, ageYear: 2026,
    lp: { incomeItems: [], expenseItems: [], savingsItems: [], loans: [], retirement: {} },
    lifePlan: {
      livingExpense: { baseAnnualJpy: 2000000, riseRatePct: 0 },
      pension: { includeInSim: false },
      education: { noChildrenConfirmed: true }, insurance: { noContractsConfirmed: true }
      // fundsStocksは対象にする(includeInSim)がまだ未確認のまま
    },
    // fundsStocksの合計は0円だが、明細（stocks配列）が1件ある＝値が未入力なだけで資産自体は存在する
    portfolioCategoryTotals: { fundsStocks: 0 },
    portfolioCategoryHasData: { fundsStocks: true },
    kidsForEducation: [], educationStages: EDU_STAGES, contractsForPremium: []
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('①明細があり合計が0円の資産区分は、未確認ならmissingInputsに記録される（0円と断定しない）', input.missingInputs.includes('asset:fundsStocks'), JSON.stringify(input.missingInputs));
}
// ②明細も合計も無い資産区分は、本当に確認対象が無いため記録しない（①との対比）
{
  const ctx = {
    todayDateStr: '2026-10-07', birthdate: null, age: 40, ageYear: 2026,
    lp: { incomeItems: [], expenseItems: [], savingsItems: [], loans: [], retirement: {} },
    lifePlan: {
      livingExpense: { baseAnnualJpy: 2000000, riseRatePct: 0 },
      pension: { includeInSim: false },
      education: { noChildrenConfirmed: true }, insurance: { noContractsConfirmed: true }
    },
    portfolioCategoryTotals: { fundsStocks: 0 },
    portfolioCategoryHasData: { fundsStocks: false },
    kidsForEducation: [], educationStages: EDU_STAGES, contractsForPremium: []
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('②明細も合計も無い資産区分はmissingInputsに記録されない', !input.missingInputs.includes('asset:fundsStocks'));
}
// ③お子様の登録が無い状態：未確認なら記録、本人が確認済みなら除外項目として記録（入力漏れではない）
{
  const base6 = {
    todayDateStr: '2026-10-07', birthdate: null, age: 40, ageYear: 2026,
    lp: { incomeItems: [], expenseItems: [], savingsItems: [], loans: [], retirement: {} },
    portfolioCategoryTotals: {}, kidsForEducation: [], educationStages: EDU_STAGES, contractsForPremium: []
  };
  const ctxUnconfirmed = { ...base6, lifePlan: { livingExpense: { baseAnnualJpy: 2000000, riseRatePct: 0 }, pension: { includeInSim: false } } };
  const inputUnconfirmed = nexusLifePlanNormalizeInput(ctxUnconfirmed);
  record('③お子様登録なし・未確認: education_children_registration_unconfirmedが記録される', inputUnconfirmed.missingInputs.includes('education_children_registration_unconfirmed'));
  const ctxConfirmed = { ...base6, lifePlan: { livingExpense: { baseAnnualJpy: 2000000, riseRatePct: 0 }, pension: { includeInSim: false }, education: { noChildrenConfirmed: true } } };
  const inputConfirmed = nexusLifePlanNormalizeInput(ctxConfirmed);
  record('③お子様登録なし・確認済み: 記録されず、除外項目として残る', !inputConfirmed.missingInputs.includes('education_children_registration_unconfirmed') && inputConfirmed.excludedItems.some(e => e.type === 'education_no_children'));
}
// ④保険契約の登録が無い状態：未確認なら記録、本人が確認済みなら除外項目として記録
{
  const base6b = {
    todayDateStr: '2026-10-07', birthdate: null, age: 40, ageYear: 2026,
    lp: { incomeItems: [], expenseItems: [], savingsItems: [], loans: [], retirement: {} },
    portfolioCategoryTotals: {}, kidsForEducation: [], educationStages: EDU_STAGES, contractsForPremium: []
  };
  // includeInSimは未確認（undefined）のまま＝契約の登録有無で判定する分岐に入る。
  const ctxUnconfirmed = { ...base6b, lifePlan: { livingExpense: { baseAnnualJpy: 2000000, riseRatePct: 0 }, pension: { includeInSim: false } } };
  const inputUnconfirmed = nexusLifePlanNormalizeInput(ctxUnconfirmed);
  record('④保険契約登録なし・未確認: insurance_contracts_registration_unconfirmedが記録される', inputUnconfirmed.missingInputs.includes('insurance_contracts_registration_unconfirmed'));
  const ctxConfirmed = { ...base6b, lifePlan: { livingExpense: { baseAnnualJpy: 2000000, riseRatePct: 0 }, pension: { includeInSim: false }, insurance: { noContractsConfirmed: true } } };
  const inputConfirmed = nexusLifePlanNormalizeInput(ctxConfirmed);
  record('④保険契約登録なし・確認済み: 記録されず、除外項目として残る', !inputConfirmed.missingInputs.includes('insurance_contracts_registration_unconfirmed') && inputConfirmed.excludedItems.some(e => e.type === 'insurance_no_contracts'));
}
// ⑤明示的な対象外（住居費を除外）は入力漏れではないが、excludedItemsに残り「選択範囲の試算」である旨を示せる
{
  const ctx = {
    todayDateStr: '2026-10-07', birthdate: null, age: 40, ageYear: 2026,
    lp: { incomeItems: [], expenseItems: [{ id: 'exp_rent', category: '住居費（家賃・管理費等）', amount: 1200000 }], savingsItems: [], loans: [], retirement: {} },
    lifePlan: {
      livingExpense: { baseAnnualJpy: 2000000, riseRatePct: 0 },
      pension: { includeInSim: false },
      education: { noChildrenConfirmed: true }, insurance: { noContractsConfirmed: true },
      expenseOverrides: { exp_rent: { includeInSim: false } },
      assetCategories: { cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } }
    },
    portfolioCategoryTotals: { cash: 1000000 }, kidsForEducation: [], educationStages: EDU_STAGES, contractsForPremium: []
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('⑤明示的に除外した支出項目はmissingInputsに記録されない（入力漏れではない）', !input.missingInputs.includes('expense:exp_rent'));
  record('⑤明示的に除外した支出項目はexcludedItemsに記録される（選択範囲の試算であることを示せる）', input.excludedItems.some(e => e.type === 'expense' && e.id === 'exp_rent'));
  record('⑤住居費を除外していてもstatusはcomplete（除外は入力漏れと別概念）', input.status === 'complete', JSON.stringify(input.missingInputs));
}
{
  const ctx = {
    todayDateStr: '2026-10-07', birthdate: null, age: 50, ageYear: 2026,
    lp: {}, lifePlan: {}, portfolioCategoryTotals: {},
    kidsForEducation: [], educationStages: EDU_STAGES, contractsForPremium: []
  };
  let threw = false;
  let input = null;
  try {
    input = nexusLifePlanNormalizeInput(ctx);
  } catch (e) {
    threw = true;
  }
  record('追加: lifePlanが全く無い旧データでも例外を投げずに開ける', !threw);
  record('追加: 旧データはstatus=partial（入力不足一覧が返る。invalidで止めない）', input && input.status === 'partial', input && input.status);
}

// ════════════════════════════════════════════════════════════
// §7 二重計上・取り崩し対象の確認（本番反映前レビュー対応）
// ════════════════════════════════════════════════════════════
const dupBase = {
  todayDateStr: '2026-10-07', birthdate: null, age: 40, ageYear: 2026,
  kidsForEducation: [], educationStages: EDU_STAGES, contractsForPremium: []
};
// ①住居費と住宅ローンを両方計上する場合、二重計上の確認が無ければ記録する
{
  const ctx = {
    ...dupBase,
    lp: {
      incomeItems: [], expenseItems: [{ id: 'exp_rent', category: '住居費（家賃・管理費等）', amount: 1200000 }],
      savingsItems: [], loans: [{ id: 'loan_home', category: '住宅', monthlyPayment: 100000, remainingYears: 20 }],
      retirement: {}
    },
    lifePlan: {
      livingExpense: { baseAnnualJpy: 1000000, riseRatePct: 0 },
      pension: { includeInSim: false },
      education: { noChildrenConfirmed: true }, insurance: { noContractsConfirmed: true },
      assetCategories: { cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } },
      expenseOverrides: { exp_rent: { includeInSim: true, riseRatePct: 0 } },
      housing: { loanOverrides: { loan_home: { includeInSim: true } } }
    },
    portfolioCategoryTotals: { cash: 1000000 }
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('①住居費＋住宅ローンを両方計上・未確認: housing_expense_loan_overlap_unconfirmedが記録される', input.missingInputs.includes('housing_expense_loan_overlap_unconfirmed'));
  // 確認済みにすれば記録されない
  const ctx2 = { ...ctx, lifePlan: { ...ctx.lifePlan, housing: { loanOverrides: { loan_home: { includeInSim: true } }, rentExcludesLoanPayment: true } } };
  const input2 = nexusLifePlanNormalizeInput(ctx2);
  record('①二重計上なしを確認済みにすれば記録されない', !input2.missingInputs.includes('housing_expense_loan_overlap_unconfirmed'));
  record('①確認済みの場合、住居費・ローン返済の両方がexpenseStreamsに含まれる（除外しない）', input2.expenseStreams.some(s => s.id === 'expense:exp_rent') && input2.expenseStreams.some(s => s.id === 'loan:loan_home'));
}
// ②企業型DC・iDeCoは受給可能年齢の確認が無ければ、取り崩し可能にしていても取り崩し対象から外す
{
  const ctx = {
    ...dupBase,
    lp: { incomeItems: [], expenseItems: [], savingsItems: [], loans: [], retirement: {} },
    lifePlan: {
      livingExpense: { baseAnnualJpy: 1000000, riseRatePct: 0 },
      pension: { includeInSim: false },
      education: { noChildrenConfirmed: true }, insurance: { noContractsConfirmed: true },
      assetCategories: {
        cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 },
        ideco: { includeInSim: true, withdrawable: true, returnRatePct: 0 } // withdrawalEligibilityConfirmed未確認
      }
    },
    portfolioCategoryTotals: { cash: 100000, ideco: 5000000 }
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  const idecoCategory = input.assetCategories.find(c => c.key === 'ideco');
  record('②iDeCo・受給可能年齢未確認: asset_withdrawal_eligibility_unconfirmedが記録される', input.missingInputs.includes('asset_withdrawal_eligibility_unconfirmed:ideco'));
  record('②iDeCo・受給可能年齢未確認: withdrawableがfalseに強制される（自由に取り崩せる現金として扱わない）', idecoCategory && idecoCategory.withdrawable === false, idecoCategory);
  // 受給可能年齢を確認済みにすれば、取り崩し対象に含まれる
  const ctx2 = { ...ctx, lifePlan: { ...ctx.lifePlan, assetCategories: { ...ctx.lifePlan.assetCategories, ideco: { includeInSim: true, withdrawable: true, returnRatePct: 0, withdrawalEligibilityConfirmed: true } } } };
  const input2 = nexusLifePlanNormalizeInput(ctx2);
  const idecoCategory2 = input2.assetCategories.find(c => c.key === 'ideco');
  record('②受給可能年齢を確認済みにすれば、withdrawableがtrueのまま取り崩し対象になる', idecoCategory2 && idecoCategory2.withdrawable === true);
  record('②受給可能年齢を確認済みにすれば、記録されない', !input2.missingInputs.includes('asset_withdrawal_eligibility_unconfirmed:ideco'));
}
// ③不動産・現金・投資信託等（DC/iDeCo以外）は、受給可能年齢の確認を要求しない（従来通り）
{
  const ctx = {
    ...dupBase,
    lp: { incomeItems: [], expenseItems: [], savingsItems: [], loans: [], retirement: {} },
    lifePlan: {
      livingExpense: { baseAnnualJpy: 1000000, riseRatePct: 0 },
      pension: { includeInSim: false },
      education: { noChildrenConfirmed: true }, insurance: { noContractsConfirmed: true },
      assetCategories: {
        cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 },
        realEstate: { includeInSim: true, withdrawable: true, returnRatePct: 0 }
      }
    },
    portfolioCategoryTotals: { cash: 100000, realEstate: 30000000 }
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  const reCategory = input.assetCategories.find(c => c.key === 'realEstate');
  record('③不動産はDC/iDeCo以外のため、受給可能年齢の確認を要求されない', !input.missingInputs.some(k => k.startsWith('asset_withdrawal_eligibility_unconfirmed')) && reCategory && reCategory.withdrawable === true);
}

// ════════════════════════════════════════════════════════════
// §8 既存ローンの支出と終了時期（本番反映前レビュー対応）
// ════════════════════════════════════════════════════════════
const loanBase = {
  todayDateStr: '2026-10-07', birthdate: null, age: 40, ageYear: 2026,
  kidsForEducation: [], educationStages: EDU_STAGES, contractsForPremium: []
};
function loanCtx(loan, lifePlanExtra) {
  return {
    ...loanBase,
    lp: { incomeItems: [], expenseItems: [], savingsItems: [], loans: [loan], retirement: {} },
    lifePlan: {
      livingExpense: { baseAnnualJpy: 1000000, riseRatePct: 0 },
      pension: { includeInSim: false },
      education: { noChildrenConfirmed: true }, insurance: { noContractsConfirmed: true },
      assetCategories: { cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } },
      housing: { loanOverrides: { loan1: { includeInSim: true } } },
      ...lifePlanExtra
    },
    portfolioCategoryTotals: { cash: 1000000 }
  };
}
// ①ボーナス返済ありだが金額未確認 → 月々返済額だけで過少計上せず、未確認として記録する
{
  const ctx = loanCtx({ id: 'loan1', category: '住宅', monthlyPayment: 100000, remainingYears: 20, hasBonusPayment: true });
  const input = nexusLifePlanNormalizeInput(ctx);
  record('①ボーナス返済あり・金額未確認: loan_bonus_amount_unconfirmedが記録される', input.missingInputs.includes('loan_bonus_amount_unconfirmed:loan1'));
  const stream = input.expenseStreams.find(s => s.id === 'loan:loan1');
  record('①ボーナス返済あり・金額未確認でも、月々返済額分はexpenseStreamsに計上される（0円にはしない）', stream && stream.baseAnnualJpy === 1200000, stream);
}
// ②ボーナス返済ありで金額確認済み → 月々返済額（年額）＋ボーナス返済額が正しく加算される
{
  const ctx = loanCtx({ id: 'loan1', category: '住宅', monthlyPayment: 100000, remainingYears: 20, hasBonusPayment: true, bonusPaymentAmount: 200000 });
  const input = nexusLifePlanNormalizeInput(ctx);
  const stream = input.expenseStreams.find(s => s.id === 'loan:loan1');
  record('②ボーナス返済額確認済み: 年額は月々返済×12＋ボーナス返済額（120万+20万=140万円）', stream && stream.baseAnnualJpy === 1400000, stream);
  record('②ボーナス返済額確認済み: loan_bonus_amount_unconfirmedは記録されない', !input.missingInputs.includes('loan_bonus_amount_unconfirmed:loan1'));
}
// ③残年数が小数（5.5年）の場合、完済後も1年近く余分に支払う形にならない（最終年はprorationで比率計上）
{
  const ctx = loanCtx({ id: 'loan1', category: '住宅', monthlyPayment: 100000, remainingYears: 5.5 });
  const input = nexusLifePlanNormalizeInput(ctx);
  const stream = input.expenseStreams.find(s => s.id === 'loan:loan1');
  record('③残年数5.5年: endPeriodIndexは6（期5の途中で完済、期6以降は計上しない）', stream && stream.endPeriodIndex === 6, stream);
  record('③残年数5.5年: 完済年（期5）はproration0.5で半額だけ計上される（完済後の過大計上を防ぐ）', stream && stream.proration && Math.abs(stream.proration[5] - 0.5) < 1e-9, stream && stream.proration);
  const result = calculateLifePlan(input);
  record('③残年数5.5年: 期0〜4は全額（120万円）計上される', Math.abs(result.rows[0].expenseBreakdown['loan:loan1'] - 1200000) < 1, result.rows[0].expenseBreakdown);
  record('③残年数5.5年: 期5（完済年）は半額（60万円）だけ計上される', Math.abs(result.rows[5].expenseBreakdown['loan:loan1'] - 600000) < 1, result.rows[5].expenseBreakdown);
  record('③残年数5.5年: 期6（完済後）は計上されない', result.rows[6].expenseBreakdown['loan:loan1'] === undefined || result.rows[6].expenseBreakdown['loan:loan1'] === 0, result.rows[6].expenseBreakdown);
}
// ④残年数が整数（20年）の場合は、従来通り20期で終了する（余分な1年を追加しない）
{
  const ctx = loanCtx({ id: 'loan1', category: '住宅', monthlyPayment: 100000, remainingYears: 20 });
  const input = nexusLifePlanNormalizeInput(ctx);
  const stream = input.expenseStreams.find(s => s.id === 'loan:loan1');
  record('④残年数20年（整数）: endPeriodIndexは20のまま（余分な期間を追加しない）', stream && stream.endPeriodIndex === 20, stream);
  record('④残年数20年（整数）: prorationは設定されない', stream && stream.proration === null);
}

// ════════════════════════════════════════════════════════════
// §9 計算順序・境界値の再確認（本番反映前レビュー対応）
// ════════════════════════════════════════════════════════════
// ①ケースCの内訳を明示：年金は一定（240万円のまま）、生活費だけが360万円→367.2万円へ上昇する
// （年金額を勝手に増やしていないこと、生活費の上昇だけが反映されていることを直接示す）
{
  const input = {
    periods: nexusLpBuildPeriods({ basisDate: null, birthdate: null, currentAge: 65, maxAge: 100 }),
    assetCategories: [{ key: 'pool', label: '取り崩し可能資産', openingBalanceJpy: 50000000, returnRatePct: 3, eligible: true, isCashSink: true, withdrawable: true, drawOrder: 0 }],
    incomeStreams: [],
    pensionStreams: [{ id: 'pension_self', startPeriodIndex: 0, endPeriodIndex: null, baseAnnualJpy: 2400000, riseRatePct: 0 }],
    expenseStreams: [{ id: 'living', startPeriodIndex: 0, endPeriodIndex: null, baseAnnualJpy: 3600000, riseRatePct: 2 }],
    contributions: []
  };
  const result = calculateLifePlan(input);
  record('①ケースC内訳：初年度の年金は240万円（incomeBreakdown.pension_self）', result.rows[0].incomeBreakdown.pension_self === 2400000, result.rows[0].incomeBreakdown);
  record('①ケースC内訳：翌年度の年金も240万円のまま（年金額を勝手に増やさない）', result.rows[1].incomeBreakdown.pension_self === 2400000, result.rows[1].incomeBreakdown);
  record('①ケースC内訳：初年度の生活費は360万円（expenseBreakdown.living）', result.rows[0].expenseBreakdown.living === 3600000, result.rows[0].expenseBreakdown);
  record('①ケースC内訳：翌年度の生活費は367.2万円に上昇する（生活費だけが上昇する）', Math.abs(result.rows[1].expenseBreakdown.living - 3672000) < 1, result.rows[1].expenseBreakdown);
}
// ②生活費・給与・年金・教育費それぞれの上昇率が混同されず、独立して計算される
{
  const ctx = {
    todayDateStr: '2026-10-07', birthdate: null, age: 40, ageYear: 2026,
    lp: {
      incomeItems: [{ id: 'inc1', type: '給与', unit: 'yearly', amount: 5000000, amountType: '手取り' }],
      expenseItems: [], savingsItems: [], loans: [],
      retirement: { retirementAge: 40, pensionMonthly: 100000 } // 今年から受給開始（境界値）
    },
    lifePlan: {
      livingExpense: { baseAnnualJpy: 2000000, riseRatePct: 3 }, // 生活費は3%
      pension: { includeInSim: true, riseRatePct: 1 }, // 年金は1%
      education: { noChildrenConfirmed: true }, insurance: { noContractsConfirmed: true },
      assetCategories: { cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } },
      incomeOverrides: { inc1: { includeInSim: true, riseRatePct: 0 } } // 給与は0%
    },
    portfolioCategoryTotals: { cash: 10000000 },
    kidsForEducation: [], educationStages: EDU_STAGES, contractsForPremium: []
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  const result = calculateLifePlan(input);
  const y0 = result.rows[0], y3 = result.rows[3];
  record('②境界値：退職年齢＝現在の年齢（今年から受給開始）でも年金が初年度から計上される', y0.incomeBreakdown.pension_self === 1200000, y0.incomeBreakdown);
  record('②3年後：給与は上昇率0%のため500万円のまま変わらない', y3.incomeBreakdown.inc1 === 5000000, y3.incomeBreakdown);
  record('②3年後：年金は上昇率1%で120万円×1.01^3≈1,236,362円まで上昇する（給与の上昇率と混同されない）', Math.abs(y3.incomeBreakdown.pension_self - 1200000 * Math.pow(1.01, 3)) < 1, y3.incomeBreakdown.pension_self);
  record('②3年後：生活費は上昇率3%で200万円×1.03^3≈2,185,454円まで上昇する（年金・給与の上昇率と混同されない）', Math.abs(y3.expenseBreakdown.living - 2000000 * Math.pow(1.03, 3)) < 1, y3.expenseBreakdown.living);
}
// ③境界値：教育費の進学段階が基準日時点でちょうど終了している場合は計上されない（既存ロジックの再確認）
{
  const ctx = {
    todayDateStr: '2026-10-07', birthdate: null, age: 40, ageYear: 2026,
    lp: { incomeItems: [], expenseItems: [], savingsItems: [], loans: [], retirement: {} },
    lifePlan: {
      livingExpense: { baseAnnualJpy: 1000000, riseRatePct: 0 },
      pension: { includeInSim: false },
      insurance: { noContractsConfirmed: true },
      assetCategories: { cash: { includeInSim: true, isCashSink: true, withdrawable: true, returnRatePct: 0 } },
      education: { mode: 'separate' }
    },
    // 幼稚園終了(3〜6歳)ちょうど6歳＝境界で終了済み
    portfolioCategoryTotals: { cash: 1000000 },
    kidsForEducation: [{ id: 'kid1', age: 6, ageYear: 2026, track: { kindergarten: '公立' } }],
    educationStages: EDU_STAGES, contractsForPremium: []
  };
  const input = nexusLifePlanNormalizeInput(ctx);
  record('③境界値：6歳で幼稚園(3〜6歳)はちょうど終了済みのため計上されない', !input.expenseStreams.some(s => s.id === 'education:kid1:kindergarten'), JSON.stringify(input.expenseStreams.map(s => s.id)));
}
// ④100歳到達までの境界：最終periodの終了年齢は常に100（年齢のみ・誕生日ありの両方で再確認）
{
  const p1 = nexusLpBuildPeriods({ basisDate: null, birthdate: null, currentAge: 72, maxAge: 100 });
  record('④境界：72歳開始でも最終期間の終了年齢は100', p1[p1.length - 1].endAge === 100, p1[p1.length - 1]);
  const p2 = nexusLpBuildPeriods({ basisDate: '2026-10-07', birthdate: '1960-10-07', currentAge: null, maxAge: 100 });
  record('④境界：誕生日ありでも最終期間の終了年齢は100', p2[p2.length - 1].endAge === 100, p2[p2.length - 1]);
}
// ⑤取り崩し・積立で総資産の二重増減が起きないこと（運用益を含めた全体の検算式の再確認）
// 期末金融資産＝期首金融資産＋運用損益＋外部収入－外部支出（内部の取り崩し・積立は相殺される）
{
  const input = {
    periods: nexusLpBuildPeriods({ basisDate: null, birthdate: null, currentAge: 30, maxAge: 31 }),
    assetCategories: [
      { key: 'cash', label: '現金', openingBalanceJpy: 500000, returnRatePct: 2, eligible: true, isCashSink: true, withdrawable: true, drawOrder: 0 },
      { key: 'invest', label: '投資', openingBalanceJpy: 2000000, returnRatePct: 5, eligible: true, isCashSink: false, withdrawable: true, drawOrder: 1 }
    ],
    incomeStreams: [{ id: 'inc', startPeriodIndex: 0, endPeriodIndex: null, baseAnnualJpy: 3000000, riseRatePct: 0 }],
    pensionStreams: [],
    expenseStreams: [{ id: 'exp', startPeriodIndex: 0, endPeriodIndex: null, baseAnnualJpy: 2500000, riseRatePct: 0 }],
    contributions: [{ id: 'contrib', startPeriodIndex: 0, endPeriodIndex: null, baseAnnualJpy: 400000, riseRatePct: 0, targetCategoryKey: 'invest' }]
  };
  const result = calculateLifePlan(input);
  const y0 = result.rows[0];
  const startTotal = 500000 + 2000000;
  const investReturn = 2000000 * 0.05;
  const cashReturn = 500000 * 0.02;
  const expectedEndTotal = startTotal + investReturn + cashReturn + 3000000 - 2500000;
  record('⑤検算式：期末総資産＝期首総資産＋運用損益＋外部収入－外部支出（積立の内部移動は相殺される）', Math.abs(y0.eligibleAssetTotal - expectedEndTotal) < 1, `actual=${y0.eligibleAssetTotal} expected=${expectedEndTotal}`);
}

const failedCount = results.filter(r => !r.pass).length;
console.log(`\nTOTAL: ${results.length}, PASS: ${results.length - failedCount}, FAIL: ${failedCount}`);
process.exit(failedCount > 0 ? 1 : 0);
