import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../../nexus.html', import.meta.url), 'utf8');
function between(start,end) {
  const a=source.indexOf(start), b=source.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a, 'Missing source function: '+start);
  return source.slice(a,b);
}
// All fixtures are fictional; do not add real customer/policy information.
const program = [
  "const CONTRACT_PURPOSES=['死亡保障','死亡時収入保障','介護・就労不能保障','医療保障','特定疾病（ガン）','年金・貯蓄型','事業保障・退職金','相続対策','その他'];",
  "const CONTRACT_PURPOSE_DEATH_GROUP=['死亡保障','死亡時収入保障','事業保障・退職金'];",
  "const NEXUS_MEDICAL_BENEFIT_TYPES=['基本入院日額','女性疾病上乗せ日額','通院日額','入院一時金','手術給付金','三大疾病一時金','先進医療保障','その他'];",
  'function nexusContractPurposes(x){return x.purposes || (x.purpose?[x.purpose]:[])}',
  'function nexusRiderPurposes(x){return x.purposes || (x.purpose?[x.purpose]:[])}',
  'function nexusContractJpyAmount(x,k){return {amount:Number(x[k]),convertible:true}}',
  'function nexusProjectedSurrenderEntry(){return null}',
  "function nexusTermEndAge(end){return end==='65歳'?65:null}",
  'function calcAge(){return 43}',
  between('const NEXUS_MEDICAL_BENEFIT_TYPE_UNITS = {','// 医療保障の種類を選ぶUI'),
  between('function nexusEffectiveBenefitType(','// 保険金額とは切り離した'),
  between('function nexusPurposeSummary(','// 保障集計（本人・配偶者）の集計済み結果'),
  'return {nexusPurposeSummary,nexusEffectiveBenefitType};'
].join('\n');
const {nexusPurposeSummary}=new Function(program)();
const sum=(list,age=43)=>nexusPurposeSummary(list,age);
const medical=(extended=false)=>({
 type:'医療保険',coverageAmount:5000,amountUnit:'日額',
 medicalBenefitType:'基本入院日額',purposes:['医療保障'],
 riders:[
  {name:'入院一時金特約',amount:50000,purposes:[]},
  {name:'先進医療特約',amount:20000000,purposes:[]},
  ...(extended?[
    {name:'女性疾病入院特約',amount:5000,amountUnit:'日額',purposes:[]},
    {name:'通院特約',amount:5000,amountUnit:'日額',purposes:[]},
    {name:'手術保障特約',amount:100000,purposes:[]},
    {name:'三大疾病一時金特約',amount:500000,purposes:[]}
  ]:[])
]});
test('no misleading household coverage PDF/Excel totals',()=>{
 assert.equal(source.includes('保障集計（世帯合算）'),false);
 assert.match(source,/保障の確認（被保険者別）/);
 assert.match(source,/被保険者別 保障集計/);
});
test('household premium report remains',()=>{
 assert.match(source,/契約者別 保険料合計/);
 assert.match(source,/householdMonthlyPremium/);
});
test('each insured person has own 5,000 yen hospital daily benefit',()=>{
 assert.equal(sum([medical()]).medicalBreakdown['基本入院日額'],5000);
 assert.equal(sum([medical(true)],38).medicalBreakdown['基本入院日額'],5000);
});
test('female-specific and outpatient daily amounts are not added to base hospitalization',()=>{
 const b=sum([medical(true)],38).medicalBreakdown;
 assert.equal(b['女性疾病上乗せ日額'],5000);
 assert.equal(b['通院日額'],5000);
 assert.equal(b['基本入院日額'],5000);
});
test('inpatient lump sum of 50,000 per person is recognized even with no purpose tag',()=>{
 for(const x of [sum([medical()]),sum([medical(true)],38)]){
   assert.equal(x.medicalBreakdown['入院一時金'],50000);
 }
});
test('surgery 100,000 and critical illness 500,000 are separately recognized',()=>{
 const b=sum([medical(true)],38);
 assert.equal(b.medicalBreakdown['手術給付金'],100000);
 assert.equal(b.medicalBreakdown['三大疾病一時金'],500000);
 assert.equal(b.byPurpose['特定疾病（ガン）'],500000);
});
test('advanced treatment limit stays 20 million per person and outside lump sums',()=>{
 for(const x of [sum([medical()]),sum([medical(true)],38)]){
   assert.equal(x.medicalBreakdown['先進医療保障'],20000000);
   assert.ok(x.byPurpose['医療保障']<20000000);
 }
});
test('income protection conversion 100,000 monthly: 264 and 324 months',()=>{
 const c={type:'収入保障保険',coverageAmount:100000,purposes:['死亡時収入保障'],termEnd:'65歳',riders:[]};
 assert.equal(sum([c],43).byPurpose['死亡時収入保障'],26400000);
 assert.equal(sum([c],38).byPurpose['死亡時収入保障'],32400000);
});
test('one UL contract with three purpose tags counts once as death coverage',()=>{
 const c={type:'UL介護',coverageAmount:7048500,purposes:['死亡保障','介護・就労不能保障','相続対策'],riders:[]};
 const x=sum([c]);
 assert.equal(x.deathTotal,7048500);
 assert.equal(x.byPurpose['介護・就労不能保障'],7048500);
 assert.match(source,/目的別の金額を足して受取総額と考えないでください/);
});
test('unconfirmed is distinct from no insurance',()=>{
 assert.match(source,/no: '既契約なし'/);
 assert.match(source,/unknown: '不明'/);
});
test('bundled client JavaScript parses',()=>{
 const code=[...source.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]).find(x=>x.includes('function nexusPurposeSummary'));
 assert.ok(code);
 assert.doesNotThrow(()=>new Function(code));
});
test.todo('PDF browser rendering and visual inspection with fictional records');
test.todo('old local data migration and rollback check');
test.todo('loan repayment warning in phase 1-B');
