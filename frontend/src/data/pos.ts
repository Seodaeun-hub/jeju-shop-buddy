import { timeSlots } from './shop'
import type { MonthlySales, TimeSeries } from './shop'
import { parseCsv } from './csv'
import type { CellValue } from 'read-excel-file/browser'

type Cell = CellValue | null | undefined
type MonthlyTotals = { amount: number; counts: [number, number, number] }
export type PosImport = { monthly: MonthlySales[]; timeSeries: TimeSeries; months: [string, string] }

const columns = ['결제기준일자', '결제시각', '결제건수', '결제금액', '결제상태'] as const
const maxFileSize = 10 * 1024 * 1024

function readMonth(value: Cell) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 7)
  const match = String(value ?? '').trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/)
  if (!match) return undefined
  const [, year, month, day] = match
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return undefined
  return date.slice(0, 7)
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
  const bytes = await file.arrayBuffer()
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder('euc-kr').decode(bytes)
  }
  return parseCsv(text)
}

export async function importPos(file: File, compareMonths?: [string, string]): Promise<PosImport> {
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
    const total: MonthlyTotals = totals.get(month) ?? { amount: 0, counts: [0, 0, 0] }
    total.amount += amount
    total.counts[bucket] += count
    if (!Number.isSafeInteger(total.amount) || !Number.isSafeInteger(total.counts[bucket])) {
      throw new Error('월별 매출 또는 시간대별 결제 건수 합계가 입력 가능한 범위를 넘었어요.')
    }
    totals.set(month, total)
  }

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
    timeSeries: {
      metric: 'count',
      rows: timeSlots.map((label, index) => ({ label, before: before.counts[index], after: after.counts[index] })),
    },
  }
}
