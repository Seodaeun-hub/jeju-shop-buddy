import { fetchPromotionImpact, listPosFiles, readStoredPosFile, savePromotionImpact } from '../api/shop'
import type { PosFileKind, PromotionImpact, PromotionImpactPeriod, PromotionImpactTotals, StoredPosFile } from '../api/shop'
import { readArchivedProductDays } from './pos'
import { addDays } from './shop'

export const resultsDataChanged = 'shop-buddy:results-data-changed'
export const promotionArchiveUpdated = 'shop-buddy:promotion-archive-updated'
export const notifyResultsDataChanged = () => window.dispatchEvent(new Event(resultsDataChanged))
export function posLibraryPath(storeId: string, date?: string, kind?: PosFileKind) {
  const query = new URLSearchParams({ storeId, section: 'pos-files' })
  if (date) query.set('date', date)
  if (kind) query.set('kind', kind)
  return '/stores?' + query
}
const seoulCalendar = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
})
export const seoulDate = (date = new Date()) => seoulCalendar.format(date)

type ProductDays = Awaited<ReturnType<typeof readArchivedProductDays>>
type ArchiveFile = { days: ProductDays; start?: string | null; end?: string | null }
type Phase = 'BEFORE' | 'AFTER'
type MissingPeriod = PromotionImpactPeriod & { phase: Phase }
export type PromotionArchiveResult = {
  impact: PromotionImpact
  missing: MissingPeriod[]
  saved: boolean
}

const parsedFiles = new Map<string, ArchiveFile | null>()

async function readArchiveFile(auth: string, storeId: string, entry: StoredPosFile, signal: AbortSignal) {
  if (parsedFiles.has(entry.id)) return parsedFiles.get(entry.id)
  const file = await readStoredPosFile(auth, storeId, entry, signal)
  let archive: ArchiveFile | null = null
  try {
    const days = await readArchivedProductDays(file)
    const { coverageStart, coverageEnd } = entry
    const declared = coverageStart && coverageEnd && [...days.keys()].every(day => day >= coverageStart && day <= coverageEnd)
    archive = { days, start: declared ? coverageStart : null, end: declared ? coverageEnd : null }
  } catch {
    // A payment-only workbook or invalid product file cannot cover any product order dates.
  }
  if (parsedFiles.size >= 24) parsedFiles.delete(parsedFiles.keys().next().value!)
  parsedFiles.set(entry.id, archive)
  return archive
}

export async function loadPromotionArchive(auth: string, storeId: string, signal: AbortSignal) {
  const files = await listPosFiles(auth, storeId, signal)
  const archive: ArchiveFile[] = []
  for (const file of files) {
    if (file.kind !== 'PRODUCT' && !/\.xlsx$/i.test(file.filename)) continue
    signal.throwIfAborted()
    const parsed = await readArchiveFile(auth, storeId, file, signal)
    if (parsed) archive.push(parsed)
  }
  return archive
}

function summarizePeriod(archive: ArchiveFile[], product: string, period: PromotionImpactPeriod) {
  const totals: PromotionImpactTotals = { quantity: 0, amount: 0, recordedDays: 0 }
  const missing: PromotionImpactPeriod[] = []
  for (let day = period.start; day <= period.end; day = addDays(day, 1)) {
    // The archive is newest first. Use one complete daily export when files overlap.
    const file = archive.find(entry => entry.days.has(day) || (entry.start && entry.end && entry.start <= day && day <= entry.end))
    const products = file?.days.get(day)
    const item = products?.get(product)
    if (!file || item === null) {
      const last = missing.at(-1)
      if (last && addDays(last.end, 1) === day) last.end = day
      else missing.push({ start: day, end: day })
      continue
    }
    if (products) totals.recordedDays += 1
    totals.quantity += item?.quantity ?? 0
    totals.amount += item?.amount ?? 0
  }
  if (!Number.isSafeInteger(totals.quantity) || !Number.isSafeInteger(totals.amount)) {
    throw new Error('판매량 또는 실판매금액 합계가 저장 가능한 범위를 넘었어요.')
  }
  return { totals, missing }
}

const samePeriod = (left: PromotionImpactPeriod | null, right: PromotionImpactPeriod) =>
  left?.start === right.start && left.end === right.end
const phaseTotals = (impact: PromotionImpact, phase: Phase) => phase === 'BEFORE' ? impact.beforeTotals : impact.afterTotals

export async function reconcilePromotionArchive(auth: string, planId: string, initial: PromotionImpact,
  archive: ArchiveFile[], signal: AbortSignal): Promise<PromotionArchiveResult> {
  const { productName, before, after } = initial
  if (!initial.afterReady || !productName || !before || !after) return { impact: initial, missing: [], saved: false }
  const periods = [{ phase: 'BEFORE', period: before }, { phase: 'AFTER', period: after }] as const
  let impact = initial
  let saved = false
  const missing: MissingPeriod[] = []
  for (const { phase, period } of periods) {
    if (phaseTotals(impact, phase)) continue
    const summary = summarizePeriod(archive, productName, period)
    if (summary.missing.length) {
      missing.push(...summary.missing.map(range => ({ ...range, phase })))
      continue
    }
    const input = { phase, productName, ...period, ...summary.totals, onlyIfMissing: true }
    signal.throwIfAborted()
    try {
      impact = await savePromotionImpact(auth, planId, input, signal)
    } catch (error) {
      signal.throwIfAborted()
      impact = await fetchPromotionImpact(auth, planId, signal)
      if (impact.productName !== productName || !samePeriod(impact.before, before) || !samePeriod(impact.after, after)) {
        return { impact, missing: [], saved: false }
      }
      if (!phaseTotals(impact, phase)) impact = await savePromotionImpact(auth, planId, input, signal)
    }
    saved = true
  }
  return { impact, missing: missing.filter(({ phase }) => !phaseTotals(impact, phase)), saved }
}

export function describeMissingPos(missing: MissingPeriod[]) {
  return missing.map(({ phase, start, end }) =>
    `${phase === 'BEFORE' ? '행사 전' : '행사 기간'} ${start}${start === end ? '' : `~${end}`}`).join(' · ')
}
