import assert from 'node:assert/strict'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const temporary = join(tmpdir(), `response-overview-${process.pid}.mjs`)
try {
  const source = await readFile(new URL('../src/data/responseOverview.ts', import.meta.url), 'utf8')
  await writeFile(temporary, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
  const { largestMenuDecline, largestTimeDecline, matchingEstimate, analysisMaterial, planChoices } = await import(pathToFileURL(temporary).href)
  const data = { name: '일반 분석', demo: false, productSales: [
    { productName: '수량 감소가 큰 저가 메뉴', before: 200, after: 100, beforeRevenue: 200000, afterRevenue: 100000 },
    { productName: '김치찌개', before: 610, after: 462, beforeRevenue: 4880000, afterRevenue: 3696000 },
    { productName: '판매 전량 소진 감소', before: 1, after: 0, beforeRevenue: 9000, afterRevenue: 0 },
    { productName: '금액 없는 메뉴', before: 10000, after: 0, priceWon: 10000 },
  ], timeSeries: { metric: 'count', rows: [{ label: '오전', before: 312, after: 312 }, { label: '오후 2~5시', before: 208, after: 104 }] } }
  assert.equal(largestMenuDecline(data).productName, '김치찌개', 'rank by sales loss, not quantity or current unit price')
  assert.equal(largestTimeDecline(data).label, '오후 2~5시')
  assert.equal(largestMenuDecline({ productSales: [] }), undefined)
  assert.equal(largestTimeDecline({ timeSeries: { rows: [{ before: 0, after: 1 }] } }), undefined)
  assert.equal(analysisMaterial(data), '매장 입력 · 실제/가상 미확인', 'old dates never establish simulated provenance')
  assert.equal(analysisMaterial({ ...data, name: '더애월 공개정보 참고 · 가상 운영 시연' }), '가상 시연 POS')
  const snapshot = (date, product, low, currentPlan = true) => ({ currentPlan, estimate: { date, product, low, high: low + 4, savedAt: date } })
  const row = { outcome: { inventory: { date: '2021-06-05', product: '김치찌개' } }, estimates: [
    snapshot('2021-06-01', '김치찌개', 16), snapshot('2021-06-05', '다른 메뉴', 100),
    snapshot('2021-06-05', '김치찌개', 99, false), snapshot('2021-06-05', '김치찌개', 20),
    snapshot('2021-06-20', '김치찌개', 80),
  ] }
  assert.equal(matchingEstimate(row).low, 20)
  assert.equal(matchingEstimate({ ...row, estimates: row.estimates.filter(item => item.estimate.low !== 20) }), undefined, 'do not borrow a different plan, date or menu')
  assert.equal(matchingEstimate({ ...row, outcome: null }).date, '2021-06-20', 'a future planned forecast is allowed; actual outcomes use the server reference-date gate')
  const plans = [
    { plan: { id: 'a', strategy: 'custom', startDate: '2021-06-01' }, errors: [] },
    { plan: { id: 'b', strategy: 'inventory', startDate: '2021-06-01' }, errors: [] },
    { plan: { id: 'c', strategy: 'custom', marketing: true, startDate: '2021-06-01' }, outcome: { simulated: true }, errors: [] },
    { plan: { id: 'd', strategy: 'custom', marketing: true, startDate: '2021-07-01' }, errors: [] },
  ]
  assert.deepEqual(planChoices(plans, 'inventory').map(row => row.plan.id), ['b'])
  assert.deepEqual(planChoices(plans, 'promotion').map(row => row.plan.id), ['c', 'd'], 'keep results paired with the selected plan; do not mix duplicate plans')
  console.log('PASS: revenue ranking, time decline, material distinction, matching forecast, planned forecast, plan selection')
} finally { await unlink(temporary).catch(() => {}) }
