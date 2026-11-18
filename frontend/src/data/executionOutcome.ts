import { parseCsv } from './csv'
import { readArchivedProductDays } from './pos'

export type OutcomePeriod = {
  start: string; end: string; days: number; amount: number; count: number
  afternoonCount: number; quantity: number; productAmount: number
}
export type OutcomeComparison = {
  product: string; before: OutcomePeriod; after: OutcomePeriod
  sources: { name: string; sha256: string }[]
}
export type ExecutionOutcome = {
  simulated: boolean; executedOn: string; action: string; note: string
  reviewedCount?: number | null; reviewSource?: string | null
  comparison?: OutcomeComparison | null
  inventory?: { date: string; product: string; actualQuantity?: number | null
    remaining: { name: string; unit: string; quantity: number }[] } | null
}

function integer(value: string) {
  const n = Number(value.replaceAll(',', ''))
  if (!/^\d+(?:,\d{3})*$/.test(value) || !Number.isSafeInteger(n) || n < 0) throw new Error('결제 금액·건수를 확인해 주세요.')
  return n
}

/** Payment period import uses the same simplified POS CSV columns as sales input. */
export async function importOutcomePeriod(payment: File, product: File, start: string, end: string, name: string): Promise<OutcomePeriod> {
  if (!start || !end || start > end || !name.trim()) throw new Error('비교 기간과 메뉴명을 입력해 주세요.')
  if (!/\.csv$/i.test(payment.name) || payment.size > 10 * 1024 * 1024) throw new Error('10MB 이하 결제 CSV를 선택해 주세요.')
  let text: string
  const bytes = await payment.arrayBuffer()
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { text = new TextDecoder('euc-kr').decode(bytes) }
  const rows = parseCsv(text).filter(row => row.some(Boolean))
  const header = rows.shift() ?? []
  const indices = ['결제기준일자', '결제시각', '결제건수', '결제금액', '결제상태'].map(key => header.indexOf(key))
  if (indices.includes(-1)) throw new Error('결제 CSV의 날짜·시각·건수·금액·상태 열을 확인해 주세요.')
  const days = new Map<string, { amount: number; count: number; afternoon: number }>()
  for (const row of rows) {
    const [day, time, countText, amountText, state] = indices.map(i => row[i] ?? '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day))
      || new Date(day).toISOString().slice(0, 10) !== day) throw new Error('결제 날짜를 YYYY-MM-DD 형식으로 확인해 주세요.')
    if (day < start || day > end) continue
    if (state === '취소' || state === '결제취소') continue
    if (!['완료', '결제완료'].includes(state) || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(time)) throw new Error('결제 시각과 상태를 확인해 주세요.')
    const count = integer(countText), amount = integer(amountText)
    const prior = days.get(day) ?? { amount: 0, count: 0, afternoon: 0 }
    days.set(day, { amount: prior.amount + amount, count: prior.count + count,
      afternoon: prior.afternoon + (time >= '14:00' && time < '17:00' ? count : 0) })
  }
  if (!days.size) throw new Error('해당 기간의 결제 자료가 없어요.')
  const orders = await readArchivedProductDays(product)
  const productDays = [...orders.keys()].filter(day => day >= start && day <= end)
  if (productDays.length !== days.size || productDays.some(day => !days.has(day))) throw new Error('두 파일에 기록된 영업일이 달라요. 결제·상품 주문 파일을 함께 확인해 주세요.')
  const result: OutcomePeriod = { start, end, days: days.size, amount: 0, count: 0, afternoonCount: 0, quantity: 0, productAmount: 0 }
  for (const [day, paymentTotal] of days) {
    const items = orders.get(day)!
    let dailyAmount = 0
    for (const item of items.values()) {
      if (!item) throw new Error('상품 주문의 수량·실판매금액이 누락됐어요.')
      dailyAmount += item.amount
    }
    if (dailyAmount !== paymentTotal.amount) throw new Error(`${day} 결제 합계와 상품 매출 합계가 달라요.`)
    result.amount += paymentTotal.amount
    result.count += paymentTotal.count
    result.afternoonCount += paymentTotal.afternoon
    result.quantity += items.get(name)?.quantity ?? 0
    result.productAmount += items.get(name)?.amount ?? 0
  }
  if (![result.amount, result.count, result.afternoonCount, result.quantity, result.productAmount].every(Number.isSafeInteger)) throw new Error('집계값이 저장 가능한 범위를 넘었어요.')
  if (![...orders.values()].some(items => items.has(name))) throw new Error('상품 주문에 해당 메뉴가 없어요. POS 메뉴명과 같게 입력해 주세요.')
  return result
}

export async function outcomeSource(file: File) {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return { name: file.name, sha256: Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('') }
}
