import { timeSlots } from './shop'
import type { MonthlySales, ProductSale, TimeSeries } from './shop'
import { parseCsv } from './csv'
import type { CellValue } from 'read-excel-file/browser'

type Cell = CellValue | null | undefined
type MonthlyTotals = { amount: number; counts: [number, number, number]; hours: HourlyTotal[] }
export type HourlyTotal = { amount: number; count: number }
export type HourlySales = Record<string, HourlyTotal[]>
export type PosImport = {
  monthly: MonthlySales[]
  timeSeries: TimeSeries
  hourlySales: HourlySales
  months: [string, string]
  productSales?: ProductSale[]
  productWarning?: string
}

const columns = ['결제기준일자', '결제시각', '결제건수', '결제금액', '결제상태'] as const
const productColumns = ['주문기준일자', '결제상태', '상품명', '수량'] as const
const productRevenueColumn = /^실판매금액(?:\(.+\))?$/
const maxFileSize = 10 * 1024 * 1024

function readMonth(value: Cell) {
  return readDate(value)?.slice(0, 7)
}

function readDate(value: Cell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10)
  const match = String(value ?? '').trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/)
  if (!match) return undefined
  const [, year, month, day] = match
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return undefined
  return date
}

function readHour(value: Cell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getUTCHours()
  const match = String(value ?? '').trim().match(/^(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}[ T])?(\d{1,2}):[0-5]\d(?::[0-5]\d)?$/)
  return match && Number(match[1]) <= 23 ? Number(match[1]) : undefined
}

function readTotal(value: Cell) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : undefined
  const text = String(value ?? '').trim()
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(text)) return undefined
  const number = Number(text.replaceAll(',', ''))
  return Number.isSafeInteger(number) ? number : undefined
}

async function readPosRows(file: File): Promise<Cell[][]> {
  if (/\.xlsx$/i.test(file.name)) {
    try {
      const { readSheet } = await import('read-excel-file/browser')
      return await readSheet(file, '결제')
    } catch {
      throw new Error('엑셀을 읽을 수 없어요. 토스포스 파일에 결제 시트가 있는지 확인해 주세요.')
    }
  }
  if (!/\.csv$/i.test(file.name)) throw new Error('엑셀(.xlsx) 또는 CSV(.csv) 파일을 선택해 주세요.')
  return readPosCsv(file)
}

async function readPosCsv(file: File) {
  const bytes = await file.arrayBuffer()
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder('euc-kr').decode(bytes)
  }
  return parseCsv(text)
}

export async function inspectPosDates(file: File, kind: 'PAYMENT' | 'PRODUCT') {
  if (!file.size || file.size > maxFileSize) return
  const rows = kind === 'PRODUCT' ? await readProductRows(file) : await readPosRows(file)
  const firstRow = rows.findIndex(row => row.some(cell => String(cell ?? '').trim()))
  const dateColumn = kind === 'PRODUCT' ? productColumns[0] : columns[0]
  const index = rows[firstRow]?.findIndex(cell => String(cell ?? '').replace(/\s/g, '') === dateColumn) ?? -1
  if (index < 0) return
  let start: string | undefined
  let end: string | undefined
  const days = new Set<string>()
  for (const row of rows.slice(firstRow + 1)) {
    const day = readDate(row[index])
    if (!day) continue
    days.add(day)
    if (!start || day < start) start = day
    if (!end || day > end) end = day
  }
  if (start && end) return { start, end, days }
}

async function readProductRows(file: File) {
  if (file.size > maxFileSize) throw new Error('10MB 이하의 상품 주문 CSV를 선택해 주세요.')
  return /\.csv$/i.test(file.name) ? await readPosCsv(file)
    : await (await import('read-excel-file/browser')).readSheet(file, '상품 주문')
}

export async function readProductSales(file: File, beforeMonth: string, afterMonth: string): Promise<ProductSale[]> {
  return aggregateProductSales([{ rows: await readProductRows(file) }], beforeMonth, afterMonth)
}

function aggregateProductSales(sources: { rows: Cell[][]; month?: string }[], beforeMonth: string, afterMonth: string) {
  const revenueMonths = new Set<string>()
  const products = new Map<string, ProductSale>()
  const prices = new Map<string, { date: string; values: Set<number> }>()
  const incompleteRevenue = new Map<string, Set<string>>()
  for (const { rows, month: sourceMonth } of sources) {
    const headerIndex = rows.findIndex((row) => row.some((cell) => String(cell ?? '').trim()))
    const header = rows[headerIndex]?.map((value) => String(value ?? '').replace(/\s/g, '')) ?? []
    const indices = productColumns.map((column) => header.indexOf(column))
    if (indices.includes(-1)) throw new Error('상품 주문 CSV의 날짜·결제상태·상품명·수량을 확인해 주세요.')
    const priceIndex = header.indexOf('상품가격')
    const revenueIndex = header.findIndex(column => productRevenueColumn.test(column))
    for (const row of rows.slice(headerIndex + 1)) {
      if (row.every((cell) => !String(cell ?? '').trim())) continue
      const [date, state, name, quantity] = indices.map((index) => row[index])
      const status = String(state ?? '').trim()
      if (status === '취소' || status === '결제취소') continue
      const orderDate = readDate(date)
      if (!orderDate) throw new Error('Invalid product order date')
      const month = orderDate.slice(0, 7)
      if ((sourceMonth && month !== sourceMonth) || (month !== beforeMonth && month !== afterMonth)) continue
      const productName = typeof name === 'string' ? name.trim() : ''
      const count = readTotal(quantity)
      if ((status !== '완료' && status !== '결제완료') || !productName || productName.length > 255
          || productName.includes('\0') || count === undefined) {
        throw new Error('Invalid product order row')
      }
      const totals = products.get(productName) ?? { productName, before: 0, after: 0 }
      const period = month === beforeMonth ? 'before' : 'after'
      totals[period] += count
      if (!Number.isSafeInteger(totals[period])) throw new Error('Product quantity total overflow')
      if (revenueIndex >= 0) {
        const revenue = readTotal(row[revenueIndex])
        const field = period === 'before' ? 'beforeRevenue' : 'afterRevenue'
        if (revenue === undefined) {
          const months = incompleteRevenue.get(productName) ?? new Set<string>()
          months.add(month)
          incompleteRevenue.set(productName, months)
        } else {
          revenueMonths.add(month)
          totals[field] = (totals[field] ?? 0) + revenue
          if (!Number.isSafeInteger(totals[field])) throw new Error('Product revenue total overflow')
        }
      }
      products.set(productName, totals)
      const price = readTotal(row[priceIndex])
      if (price && count > 0) {
        const latest = prices.get(productName)
        if (!latest || orderDate > latest.date) prices.set(productName, { date: orderDate, values: new Set([price]) })
        else if (orderDate === latest.date) latest.values.add(price)
      }
    }
  }
  for (const [name, { values }] of prices) {
    if (values.size === 1) products.get(name)!.priceWon = [...values][0]
  }
  for (const product of products.values()) {
    const missing = incompleteRevenue.get(product.productName)
    if (!revenueMonths.has(beforeMonth) || missing?.has(beforeMonth)) delete product.beforeRevenue
    else product.beforeRevenue ??= 0
    if (!revenueMonths.has(afterMonth) || missing?.has(afterMonth)) delete product.afterRevenue
    else product.afterRevenue ??= 0
  }
  return [...products.values()].sort((a, b) => b.after - a.after || b.before - a.before
    || a.productName.localeCompare(b.productName, 'ko'))
}

async function readPromotionOrders(file: File) {
  if (file.size > maxFileSize) throw new Error('10MB 이하의 POS 파일을 선택해 주세요.')
  let rows: Cell[][]
  if (/\.xlsx$/i.test(file.name)) {
    try {
      const { readSheet } = await import('read-excel-file/browser')
      rows = await readSheet(file, '상품 주문')
    } catch {
      throw new Error('토스포스 엑셀에서 상품 주문 시트를 찾을 수 없어요.')
    }
  } else if (/\.csv$/i.test(file.name)) {
    rows = await readPosCsv(file)
  } else {
    throw new Error('상품 주문 엑셀(.xlsx) 또는 CSV(.csv)를 선택해 주세요.')
  }
  const headerIndex = rows.findIndex(row => row.some(cell => String(cell ?? '').trim()))
  const header = rows[headerIndex]?.map(cell => String(cell ?? '').replace(/\s/g, '')) ?? []
  const indices = [...productColumns.map(column => header.indexOf(column)),
    header.findIndex(column => productRevenueColumn.test(column))]
  if (indices.includes(-1)) {
    throw new Error('상품 주문에 주문기준일자·결제상태·상품명·수량·실판매금액 열이 있는지 확인해 주세요.')
  }
  return rows.flatMap((row, index) => {
    if (index <= headerIndex || row.every(cell => !String(cell ?? '').trim())) return []
    const [dateValue, state, name, count, amount] = indices.map(column => row[column])
    const date = readDate(dateValue)
    if (!date) throw new Error(`${index + 1}행의 주문기준일자를 확인해 주세요.`)
    return [{ date, status: String(state ?? '').trim(), name: String(name ?? '').trim(), count, amount, line: index + 1 }]
  })
}

function isCompletedOrder({ status, name, line }: Awaited<ReturnType<typeof readPromotionOrders>>[number]) {
  if (!['완료', '결제완료', '취소', '결제취소'].includes(status) || !name) {
    throw new Error(`${line}행의 결제상태와 상품명을 확인해 주세요.`)
  }
  return status === '완료' || status === '결제완료'
}

export async function readArchivedProductDays(file: File) {
  const days = new Map<string, Map<string, { quantity: number; amount: number } | null>>()
  for (const order of await readPromotionOrders(file)) {
    const products = days.get(order.date) ?? new Map()
    days.set(order.date, products)
    if (!isCompletedOrder(order)) continue
    const previous = products.get(order.name)
    const count = readTotal(order.count)
    const sales = readTotal(order.amount)
    const quantity = (previous?.quantity ?? 0) + (count ?? 0)
    const amount = (previous?.amount ?? 0) + (sales ?? 0)
    products.set(order.name, previous === null || count === undefined || sales === undefined
      || !Number.isSafeInteger(quantity) || !Number.isSafeInteger(amount) ? null : { quantity, amount })
  }
  return days
}

export async function importPromotionProduct(file: File, product: string, start: string, end: string) {
  const days = new Set<string>()
  let quantity = 0
  let amount = 0
  for (const order of await readPromotionOrders(file)) {
    if (order.date < start || order.date > end) continue
    const completed = isCompletedOrder(order)
    days.add(order.date)
    if (!completed || order.name !== product) continue
    const count = readTotal(order.count)
    const sales = readTotal(order.amount)
    if (count === undefined || sales === undefined) {
      throw new Error(`${order.line}행의 수량과 실판매금액을 확인해 주세요.`)
    }
    quantity += count
    amount += sales
    if (!Number.isSafeInteger(quantity) || !Number.isSafeInteger(amount)) {
      throw new Error('판매량 또는 실판매금액 합계가 저장 가능한 범위를 넘었어요.')
    }
  }
  if (!days.size) throw new Error('표시된 비교 기간의 주문 자료가 없어요. 파일에 포함된 날짜를 확인해 주세요.')
  return {quantity, amount, recordedDays: days.size}
}

async function readMonthlyPayments(file: File) {
  if (file.size > maxFileSize) throw new Error('10MB 이하의 POS 파일을 선택해 주세요.')
  const rows = await readPosRows(file)
  const headerIndex = rows.findIndex((row) => row.some((value) => value != null && String(value).trim() !== ''))
  const header = rows[headerIndex]?.map((value) => String(value ?? '').replace(/\s/g, ''))
  const indices = columns.map((column) => header?.indexOf(column) ?? -1)
  if (indices.includes(-1)) throw new Error(`결제 내역에 ${columns.join(', ')} 열이 있는지 확인해 주세요.`)

  const totals = new Map<string, MonthlyTotals>()
  for (const [index, row] of rows.entries()) {
    if (index <= headerIndex || row.every((value) => value == null || String(value).trim() === '')) continue
    const [date, time, countValue, amountValue, state] = indices.map((column) => row[column])
    const status = String(state ?? '').trim()
    if (status === '취소' || status === '결제취소') continue
    const month = readMonth(date)
    const hour = readHour(time)
    const amount = readTotal(amountValue)
    const count = readTotal(countValue)
    if ((status !== '완료' && status !== '결제완료') || !month || hour === undefined || amount === undefined || count === undefined) {
      throw new Error(`${index + 1}행의 결제 기준일자, 결제시각, 건수, 금액, 상태를 확인해 주세요.`)
    }
    const bucket = hour < 14 ? 0 : hour < 17 ? 1 : 2
    const total: MonthlyTotals = totals.get(month) ?? {
      amount: 0, counts: [0, 0, 0], hours: Array.from({ length: 24 }, () => ({ amount: 0, count: 0 })),
    }
    total.amount += amount
    total.counts[bucket] += count
    const hourTotal = total.hours[hour]
    hourTotal.amount += amount
    hourTotal.count += count
    if (!Number.isSafeInteger(total.amount) || !Number.isSafeInteger(total.counts[bucket])
        || !Number.isSafeInteger(hourTotal.amount) || !Number.isSafeInteger(hourTotal.count)) {
      throw new Error('월별 매출 또는 시간대별 결제 건수 합계가 입력 가능한 범위를 넘었어요.')
    }
    totals.set(month, total)
  }
  return totals
}

function summarizePayments(totals: Map<string, MonthlyTotals>, compareMonths?: [string, string]): PosImport {
  const monthly = [...totals].sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { amount }]) => ({ month, amount }))
  if (monthly.length < 2) throw new Error('결제 완료 내역이 있는 서로 다른 두 달 이상의 자료가 필요해요.')
  const [beforeMonth, afterMonth] = compareMonths ?? monthly.slice(-2).map(({ month }) => month)
  const before = totals.get(beforeMonth)
  const after = totals.get(afterMonth)
  if (!before || !after) throw new Error('비교할 두 달의 결제 완료 내역이 모두 포함된 파일을 선택해 주세요.')
  return {
    monthly,
    months: [beforeMonth, afterMonth],
    hourlySales: Object.fromEntries([...totals].map(([month, total]) => [month, total.hours])),
    timeSeries: {
      metric: 'count',
      rows: timeSlots.map((label, index) => ({ label, before: before.counts[index], after: after.counts[index] })),
    },
  }
}

export async function importPos(file: File, compareMonths?: [string, string]): Promise<PosImport> {
  const imported = summarizePayments(await readMonthlyPayments(file), compareMonths)
  const [beforeMonth, afterMonth] = imported.months
  if (/\.xlsx$/i.test(file.name) && !compareMonths) {
    try {
      imported.productSales = await readProductSales(file, beforeMonth, afterMonth)
    } catch {
      imported.productWarning = '상품 주문 시트가 없거나 형식이 달라 품목별 판매량을 읽지 못했어요. 월별 매출과 시간대별 결제 건수는 저장할 수 있어요.'
    }
  }
  return imported
}

export async function importMonthlyPos(months: [string, string], payments: [File, File], products?: [File, File]) {
  const [beforeMonth, afterMonth] = months
  const beforeTotals = await readMonthlyPayments(payments[0])
  const afterTotals = payments[0] === payments[1] ? beforeTotals : await readMonthlyPayments(payments[1])
  const before = beforeTotals.get(beforeMonth)
  const after = afterTotals.get(afterMonth)
  if (!before || !after) throw new Error('선택한 두 달의 결제 완료 내역이 있는지 확인해 주세요.')
  const data = summarizePayments(new Map([[beforeMonth, before], [afterMonth, after]]), months)
  if (products) {
    try {
      const beforeRows = await readProductRows(products[0])
      const afterRows = products[0] === products[1] ? beforeRows : await readProductRows(products[1])
      data.productSales = aggregateProductSales([{ rows: beforeRows, month: beforeMonth },
        { rows: afterRows, month: afterMonth }], beforeMonth, afterMonth)
    } catch {
      data.productWarning = '상품 주문 파일의 형식을 확인해 주세요. 결제 내역 집계는 저장할 수 있어요.'
    }
  }
  return data
}
