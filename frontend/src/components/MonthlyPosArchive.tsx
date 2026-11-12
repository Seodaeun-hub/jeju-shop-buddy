import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { listPosFiles, readStoredPosFile } from '../api/shop'
import type { PosFileKind, StoredPosFile } from '../api/shop'
import { importMonthlyPos, inspectPosDates } from '../data/pos'
import type { PosImport } from '../data/pos'
import { posLibraryPath, seoulDate } from '../data/promotionArchive'
import { monthLabel } from '../data/shop'

type FileDates = Awaited<ReturnType<typeof inspectPosDates>>
type MonthFiles = { month: string; payment: StoredPosFile[]; product: StoredPosFile[]; partial: Set<PosFileKind> }
type Scan = { key: string; months: [MonthFiles, MonthFiles]; unreadable: boolean }
const kindLabels = { PAYMENT: '결제 내역', PRODUCT: '상품 주문' } as const

function monthEnd(month: string) {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10)
}

function matchesMonth(dates: NonNullable<FileDates>, month: string, file: StoredPosFile) {
  const start = month + '-01'
  const end = monthEnd(month)
  const observed = [...dates.days].filter(date => date.startsWith(month)).length
  if (!observed) return 'absent'
  const completeExport = file.coverageStart && file.coverageEnd && file.coverageStart <= start && file.coverageEnd >= end
    && file.coverageStart <= dates.start && file.coverageEnd >= dates.end
  return completeExport || observed === Number(end.slice(-2)) ? 'complete' : 'partial'
}

function currentFile(files: StoredPosFile[], selected: string | undefined) {
  return files.find(file => file.id === selected) ?? files[0]
}

export function MonthlyPosArchive({ auth, storeId, disabled, onImport, onReading }: {
  auth: string; storeId: string; disabled: boolean
  onImport: (data: PosImport | undefined) => void
  onReading: (reading: boolean) => void
}) {
  const [before, setBefore] = useState('')
  const [after, setAfter] = useState('')
  const [scan, setScan] = useState<Scan>()
  const [selected, setSelected] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [ready, setReady] = useState(false)
  const [retry, setRetry] = useState(0)
  const datesCache = useRef(new Map<string, FileDates>())
  const monthLimit = seoulDate().slice(0, 7)
  const valid = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= '1900-01' && month <= monthLimit
  const key = valid(before) && valid(after) && before < after ? `${before}/${after}` : ''
  const available = key && scan?.key === key ? scan : undefined

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const { signal } = controller
    const months: [MonthFiles, MonthFiles] = [
      { month: before, payment: [], product: [], partial: new Set() },
      { month: after, payment: [], product: [], partial: new Set() },
    ]
    async function findFiles() {
      let unreadable = false
      for (const file of await listPosFiles(auth, storeId, signal)) {
        signal.throwIfAborted()
        const declaredDisjoint = file.coverageStart && file.coverageEnd && months.every(({ month }) =>
          file.coverageStart! > monthEnd(month) || file.coverageEnd! < month + '-01')
        if (declaredDisjoint) continue
        if (!datesCache.current.has(file.id)) {
          try {
            const content = await readStoredPosFile(auth, storeId, file, signal)
            const dates = await inspectPosDates(content, file.kind).catch(() => undefined)
            datesCache.current.set(file.id, dates)
          } catch {
            signal.throwIfAborted()
            unreadable = true
            continue
          }
        }
        const dates = datesCache.current.get(file.id)
        if (!dates) continue
        for (const period of months) {
          const coverage = matchesMonth(dates, period.month, file)
          if (coverage === 'complete') (file.kind === 'PAYMENT' ? period.payment : period.product).push(file)
          if (coverage === 'partial') period.partial.add(file.kind)
        }
      }
      if (!signal.aborted) setScan({ key, months, unreadable })
    }
    void findFiles().catch(() => {
      if (!signal.aborted) setError('내 매장의 POS 파일 목록을 불러오지 못했어요.')
    })
    return () => controller.abort()
  }, [auth, storeId, before, after, key, retry])

  useEffect(() => {
    if (!available) return
    const [base, comparison] = available.months
    const first = currentFile(base.payment, selected[base.month + 'PAYMENT'])
    const last = currentFile(comparison.payment, selected[comparison.month + 'PAYMENT'])
    if (!first || !last) return
    const firstProduct = currentFile(base.product, selected[base.month + 'PRODUCT'])
    const lastProduct = currentFile(comparison.product, selected[comparison.month + 'PRODUCT'])
    const controller = new AbortController()
    const { signal } = controller
    const downloads = new Map<string, Promise<File>>()
    function download(file: StoredPosFile) {
      const pending = downloads.get(file.id) ?? readStoredPosFile(auth, storeId, file, signal)
      downloads.set(file.id, pending)
      return pending
    }
    setReading(true)
    onReading(true)
    async function importFiles() {
      const payments = await Promise.all([download(first!), download(last!)])
      const products = firstProduct && lastProduct ? await Promise.all([download(firstProduct), download(lastProduct)]) : undefined
      const data = await importMonthlyPos([base.month, comparison.month], payments, products)
      if (!signal.aborted) {
        onImport(data)
        setReady(true)
      }
    }
    void importFiles().catch(failure => {
      if (!signal.aborted) setError(failure instanceof Error ? failure.message : '보관한 POS를 읽을 수 없어요.')
    }).finally(() => {
      if (!signal.aborted) {
        setReading(false)
        onReading(false)
      }
    })
    return () => controller.abort()
  }, [available, selected, auth, storeId, onImport, onReading])

  function resetImport() {
    setReady(false)
    setError('')
    onImport(undefined)
  }

  function selectMonth(month: string, first: boolean) {
    resetImport()
    setScan(undefined)
    setSelected({})
    if (first) setBefore(month)
    else setAfter(month)
  }

  function fileChoice(period: MonthFiles, kind: PosFileKind) {
    const files = kind === 'PAYMENT' ? period.payment : period.product
    const label = kindLabels[kind]
    const id = period.month + kind
    return files.length > 1 ? <label key={kind}>{label}
      <select aria-label={monthLabel(period.month) + ' ' + label} value={currentFile(files, selected[id])?.id}
        disabled={disabled || reading} onChange={event => {
          resetImport()
          setSelected(current => ({ ...current, [id]: event.target.value }))
        }}>
        {files.map(file => <option key={file.id} value={file.id}>{file.filename}</option>)}
      </select>
    </label> : <div className="monthly-pos-file" key={kind}>
      <span>{label}</span>
      {files[0] ? <strong>{files[0].filename}</strong> : <>
        <span>{period.partial.has(kind) ? '한 달 전체 내역이 필요해요.' : '보관한 파일이 없어요.'}</span>
        <Link to={posLibraryPath(storeId, { date: monthEnd(period.month) <= seoulDate() ? monthEnd(period.month) : seoulDate(), kind })}>파일 등록</Link>
      </>}
    </div>
  }

  return <section className="monthly-pos-archive form-stack" aria-label="내 매장 월별 POS">
    <div className="monthly-pos-periods">
      <label>기준 월<input type="month" min="1900-01" max={monthLimit} value={before} disabled={disabled || reading}
        onChange={event => selectMonth(event.target.value, true)} /></label>
      <label>비교 월<input type="month" min="1900-01" max={monthLimit} value={after} disabled={disabled || reading}
        onChange={event => selectMonth(event.target.value, false)} /></label>
    </div>
    {!before || !after ? <p className="muted">두 달을 고르면 내 매장에 보관한 POS를 찾아요.</p>
      : !key && <p className="error" role="status">기준 월보다 뒤의 비교 월을 골라 주세요.</p>}
    {key && !available && !error && <p role="status">보관한 파일의 거래 기간을 확인하고 있어요.</p>}
    {available && <>
      <div className="monthly-pos-matches">
        {available.months.map(period => <section key={period.month} aria-label={monthLabel(period.month) + ' 보관 파일'}>
          <h3>{monthLabel(period.month)}</h3>
          {fileChoice(period, 'PAYMENT')}
          {fileChoice(period, 'PRODUCT')}
        </section>)}
      </div>
      {available.months.some(period => !period.product.length) && <p className="muted">두 달의 상품 주문이 있으면 품목별 비교도 보여요.</p>}
    </>}
    {reading && <p role="status">선택한 두 달의 POS를 집계하고 있어요.</p>}
    {ready && <p role="status">보관한 POS 집계 완료</p>}
    {(error || available?.unreadable) && <p role="alert" className="error">
      {error || '일부 보관 파일의 거래 기간을 확인하지 못했어요.'}{' '}
      <button className="text-button" type="button" disabled={reading} onClick={() => {
        resetImport()
        setScan(undefined)
        setRetry(value => value + 1)
      }}>다시 확인하기</button>
    </p>}
  </section>
}
