import { parseCsv } from './csv'
import type { InventoryItem } from './shop'

type InventoryDraft = Omit<InventoryItem, 'id' | 'finalOrder'>

export const quantities = [
  { key: 'stock', label: '현재 재고' },
  { key: 'expectedUse', label: '예상 사용량' },
  { key: 'incoming', label: '들어올 물량' },
] as const

const columns = [
  { key: 'name', label: '품목명' },
  { key: 'unit', label: '단위' },
  ...quantities,
] as const

export const inventoryTemplate = '\uFEFF' + columns.map(({ label }) => label).join(',') + '\r\n쌀,kg,8,15,2\r\n'
export const formatQuantity = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 }).format

export function parseQuantity(value: string) {
  if (!/^\d+(\.\d{1,3})?$/.test(value)) return null
  const number = Number(value)
  return number <= 1_000_000_000 ? Math.round(number * 1000) : null
}

export function shortageOf(item: InventoryDraft) {
  const stock = parseQuantity(item.stock)
  const usage = parseQuantity(item.expectedUse)
  const incoming = parseQuantity(item.incoming)
  if (stock === null || usage === null || incoming === null) return null
  return Math.max(0, usage - stock - incoming) / 1000
}

export function parseInventoryCsv(input: string): InventoryDraft[] {
  const rows = parseCsv(input).filter((row) => row.some(Boolean))
  const header = rows.shift()
  const indices = columns.map(({ label }) => header?.indexOf(label) ?? -1)
  if (!header || indices.includes(-1) || header.length !== columns.length) {
    throw new Error('양식을 내려받아 품목명, 단위, 현재 재고, 예상 사용량, 들어올 물량 열을 넣어 주세요.')
  }
  if (rows.length === 0) throw new Error('CSV에 품목을 한 개 이상 입력해 주세요.')
  if (rows.length > 500) throw new Error('한 번에 최대 500품목까지 불러올 수 있어요.')

  return rows.map((row, index) => {
    const rowName = `${index + 1}번째 품목`
    if (row.length > header.length) throw new Error(`${rowName}의 열이 너무 많아요. 쉼표가 든 값은 큰따옴표로 감싸 주세요.`)
    const [name, unit, stock, expectedUse, incoming] = indices.map((column) => row[column] ?? '')
    if (name.length > 50 || unit.length > 12) throw new Error(`${rowName}의 품목명은 50자, 단위는 12자까지 입력할 수 있어요.`)
    for (const [value, { label }] of [stock, expectedUse, incoming].map((value, column) => [value, quantities[column]] as const)) {
      if (value && parseQuantity(value) === null) {
        throw new Error(`${rowName}의 ${label}을 확인해 주세요. 0 이상 10억 이하의 숫자를 소수점 셋째 자리까지 입력할 수 있어요.`)
      }
    }
    return { name, unit, stock, expectedUse, incoming }
  })
}
