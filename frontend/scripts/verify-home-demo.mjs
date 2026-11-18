import assert from 'node:assert/strict'
import { readFile, writeFile, unlink, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

const file = join(tmpdir(), `home-demo-${process.pid}.mjs`)
const json = async path => JSON.parse((await readFile(new URL(path, import.meta.url), 'utf8')).replace(/^\uFEFF/, ''))
try {
  const source = await readFile(new URL('../src/data/landingDemo.ts', import.meta.url), 'utf8')
  await writeFile(file, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
  const { landingDemo: demo, landingSteps: steps } = await import(pathToFileURL(file).href)
  const original = await json('../../demo/the-aewol-june-rehearsal/expected-results.json')
  const followup = await json('../../demo/the-aewol-june-rehearsal/follow-up/expected-results.json')
  const months = [original.months[demo.beforeMonth], original.months[demo.afterMonth]]
  assert.deepEqual(demo.sales, months.map(month => month.amount))
  assert.deepEqual(demo.product.quantities, months.map(month => month.quantities[demo.product.name]))
  assert.deepEqual(demo.product.revenue, months.map(month => month.productRevenue[demo.product.name]))
  assert.deepEqual(demo.afternoon, months.map(month => month.hourlySales.slice(14, 17).reduce((sum, hour) => sum + hour.count, 0)))
  assert.deepEqual(demo.inventory.forecast, [original.demand.weekdayLow, original.demand.weekdayHigh])
  assert.equal(demo.inventory.actual, followup.inventory.actual)
  demo.inventory.forecast.forEach((n, i) => assert.ok(Math.abs(n * demo.inventory.porkPerServing - demo.inventory.stock - demo.inventory.incoming - demo.inventory.preparation[i]) < 1e-9))
  assert.deepEqual(demo.outcome.quantities, [followup.before.quantity, followup.after.quantity])
  assert.deepEqual(demo.outcome.afternoon, [followup.before.afternoonCount, followup.after.afternoonCount])
  assert.deepEqual(demo.outcome.days, [followup.before.days, followup.after.days])
  assert.deepEqual(demo.outcome.before, [followup.before.start, followup.before.end])
  assert.deepEqual(demo.outcome.after, [followup.after.start, followup.after.end])
  assert.deepEqual(steps.map(step => step.id), ['sales', 'evidence', 'inventory', 'promotion', 'menu', 'outcome'])
  await access(new URL('../src/assets/kimchi-jjigae-ai.png', import.meta.url))
  console.log('PASS: home figures match independent April/May and follow-up fixtures; stock arithmetic and six-step order verified')
} finally { await unlink(file).catch(() => {}) }
