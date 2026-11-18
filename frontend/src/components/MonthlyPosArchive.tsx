import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { listPosFiles, readStoredPosFile, updatePosFileCoverage } from '../api/shop'
import type { PosFileKind, StoredPosFile } from '../api/shop'
import { importMonthlyPos, inspectPosDates } from '../data/pos'
import type { PosImport } from '../data/pos'
import { posLibraryPath, seoulDate } from '../data/promotionArchive'
import { monthLabel } from '../data/shop'

type FileDates = NonNullable<Awaited<ReturnType<typeof inspectPosDates>>>
type Candidate = { file: StoredPosFile; dates: FileDates }
type MonthFiles = { month: string; payment: Candidate[]; product: Candidate[] }
type Scan = { key: string; months: [MonthFiles, MonthFiles]; unreadable: boolean }
const kindLabels = { PAYMENT: '결제 내역', PRODUCT: '상품 주문' } as const

function monthEnd(month: string) {
  const [year, number] = month.split('-').map(Number)
  return new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10)
}

function completeMonth(candidate: Candidate, month: string) {
  const { file, dates } = candidate
  return Boolean(file.coverageStart && file.coverageEnd
    && monthEnd(month) <= seoulDate()
    && file.coverageStart <= month + '-01' && file.coverageEnd >= monthEnd(month)
    && file.coverageStart <= dates.start && file.coverageEnd >= dates.end)
}

function currentFile(files: Candidate[], selected: string | undefined) {
  if (selected === '') return undefined
  return files.find(candidate => candidate.file.id === selected) ?? files[0]
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
  const [confirming, setConfirming] = useState<string>()
  const [retry, setRetry] = useState(0)
  const datesCache = useRef(new Map<string, FileDates | undefined>())
  const today = seoulDate()
  const monthLimit = today.slice(0, 7)
  const valid = (month: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month >= '1900-01' && month <= monthLimit
  const key = valid(before) && valid(after) && before < after ? `${storeId}:${before}/${after}` : ''
  const available = key && scan?.key === key ? scan : undefined
  const busy = disabled || reading || Boolean(confirming)
  const filesToManage = '/stores?' + new URLSearchParams({ storeId, section: 'pos-files' })

  useEffect(() => {
    if (!key) return
    const controller = new AbortController()
    const { signal } = controller
    const months: [MonthFiles, MonthFiles] = [
      { month: before, payment: [], product: [] },
      { month: after, payment: [], product: [] },
    ]
    async function findFiles() {
      let unreadable = false
      for (const file of await listPosFiles(auth, storeId, signal)) {
        signal.throwIfAborted()
        if (!datesCache.current.has(file.id)) {
          try {
            const content = await readStoredPosFile(auth, storeId, file, signal)
            const dates = await inspectPosDates(content, file.kind)
            datesCache.current.set(file.id, dates)
          } catch {
            signal.throwIfAborted()
            unreadable = true
            continue
          }
        }
        const dates = datesCache.current.get(file.id)
        if (!dates) { unreadable = true; continue }
        for (const period of months) {
          if ([...dates.days].some(date => date.startsWith(period.month + '-'))) {
            (file.kind === 'PAYMENT' ? period.payment : period.product).push({ file, dates })
          }
        }
      }
      for (const period of months) {
        for (const files of [period.payment, period.product]) {
          files.sort((a, b) => Number(completeMonth(b, period.month)) - Number(completeMonth(a, period.month)))
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
    setReady(false)
    onImport(undefined)
    setReading(false)
    onReading(false)
    if (!available) return
    const [base, comparison] = available.months
    const first = currentFile(base.payment, selected[base.month + 'PAYMENT'])
    const last = currentFile(comparison.payment, selected[comparison.month + 'PAYMENT'])
    if (!first || !last) return
    const firstProduct = currentFile(base.product, selected[base.month + 'PRODUCT'])
    const lastProduct = currentFile(comparison.product, selected[comparison.month + 'PRODUCT'])
    if (!completeMonth(first, base.month) || !completeMonth(last, comparison.month)
      || (firstProduct && lastProduct && (!completeMonth(firstProduct, base.month) || !completeMonth(lastProduct, comparison.month)))) return
    const controller = new AbortController()
    const { signal } = controller
    const downloads = new Map<string, Promise<File>>()
    function download(candidate: Candidate) {
      const file = candidate.file
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
      if (!signal.aborted) { setReading(false); onReading(false) }
    })
    return () => { controller.abort(); onReading(false) }
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

  async function confirmExport(candidate: Candidate) {
    if (busy || candidate.file.tossMonth) return
    const start = candidate.dates.start.slice(0, 7) + '-01'
    const end = monthEnd(candidate.dates.end.slice(0, 7))
    if (end > today) return
    resetImport()
    setConfirming(candidate.file.id)
    try {
      const saved = await updatePosFileCoverage(auth, storeId, candidate.file.id, start, end)
      setScan(current => current && { ...current, months: current.months.map(period => ({
        ...period,
        payment: period.payment.map(row => row.file.id === saved.id ? { ...row, file: saved } : row),
        product: period.product.map(row => row.file.id === saved.id ? { ...row, file: saved } : row),
      })) as [MonthFiles, MonthFiles] })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '월 전체 자료 확인을 저장하지 못했어요.')
    } finally {
      setConfirming(undefined)
    }
  }

  function fileChoice(period: MonthFiles, kind: PosFileKind) {
    const files = kind === 'PAYMENT' ? period.payment : period.product
    const label = kindLabels[kind]
    const id = period.month + kind
    const candidate = currentFile(files, selected[id])
    const confirmed = candidate && completeMonth(candidate, period.month)
    const observed = candidate ? [...candidate.dates.days].filter(day => day.startsWith(period.month + '-')).sort() : []
    const exportStart = candidate ? candidate.dates.start.slice(0, 7) + '-01' : ''
    const exportEnd = candidate ? monthEnd(candidate.dates.end.slice(0, 7)) : ''
    return <div className="monthly-pos-file" key={kind}>
      <span>{label}</span>
      {files.length > 0 ? <>
        {files.length > 1 || kind === 'PRODUCT' ? <select aria-label={monthLabel(period.month) + ' ' + label}
          value={candidate?.file.id ?? ''} disabled={busy} onChange={event => {
            resetImport()
            setSelected(current => ({ ...current, [id]: event.target.value }))
          }}>
          {kind === 'PRODUCT' && <option value="">이번 분석에서 제외</option>}
          {files.map(row => <option key={row.file.id} value={row.file.id}>
            {row.file.filename} · {completeMonth(row, period.month) ? '기간 확인됨' : '기간 확인 필요'}
          </option>)}
        </select> : <strong>{candidate?.file.filename}</strong>}
        {candidate ? <>
          <small>파일에서 읽은 거래 날짜 · {observed[0]}~{observed[observed.length - 1]} · {observed.length}일</small>
          <small className={confirmed ? 'monthly-pos-verified' : 'monthly-pos-unverified'}>
            {confirmed ? '월 전체 기간 확인됨' : '월 전체 여부 확인 필요'}
          </small>
          {confirmed ? <small>확인한 내보내기 기간 · {candidate.file.coverageStart}~{candidate.file.coverageEnd}</small>
            : candidate.file.tossMonth ? <p className="muted">토스 연동 파일의 내보내기 기간은 토스포스에서 다시 불러오면 갱신돼요.</p>
            : exportEnd > today ? <p className="muted">파일에 아직 끝나지 않은 월의 거래가 포함돼 있어요. 파일 관리에서 실제 내보내기 기간을 지정해 주세요.</p>
            : <label className="monthly-pos-confirm">
              <input type="checkbox" aria-label={monthLabel(period.month) + ' ' + label + ' 월 전체 내역 확인'}
                checked={confirming === candidate.file.id} disabled={busy}
                onChange={event => { if (event.target.checked) void confirmExport(candidate) }} />
              <span>{confirming === candidate.file.id ? '확인을 저장하고 있어요…'
                : `이 파일은 ${exportStart}~${exportEnd} 전체 내역이에요. (휴무·무거래일 포함)`}</span>
            </label>}
          <Link to={filesToManage}>파일 관리에서 기간 수정</Link>
        </> : <small>상품 주문을 제외했어요. 두 달 모두 선택하면 품목별 비교에 포함해요.</small>}
      </> : <>
        <span>이 달 거래가 있는 보관 파일이 없어요.</span>
        <Link to={posLibraryPath(storeId, { date: monthEnd(period.month) <= today ? monthEnd(period.month) : today, kind })}>파일 등록</Link>
      </>}
    </div>
  }

  return <section className="monthly-pos-archive form-stack" aria-label="내 매장 월별 POS">
    <div className="monthly-pos-periods">
      <label>기준 월<input type="month" min="1900-01" max={monthLimit} value={before} disabled={busy}
        onChange={event => selectMonth(event.target.value, true)} /></label>
      <label>비교 월<input type="month" min="1900-01" max={monthLimit} value={after} disabled={busy}
        onChange={event => selectMonth(event.target.value, false)} /></label>
    </div>
    {!before || !after ? <p className="muted">두 달을 고르면 내 매장에 보관한 POS를 찾아요.</p>
      : !key && <p className="error" role="status">기준 월보다 뒤의 비교 월을 골라 주세요.</p>}
    {key && !available && !error && <p role="status">보관한 파일의 거래 날짜로 해당 월 자료를 찾고 있어요.</p>}
    {available && <>
      <p className="muted">내보내기 기간이 없어도 거래 날짜로 파일을 찾아요. 거래 없는 날은 휴무일인지 누락인지 알 수 없으니 월 전체 내역인지 확인해 주세요. 확인은 파일의 내보내기 기간으로 저장돼요.</p>
      <div className="monthly-pos-matches">
        {available.months.map(period => <section key={period.month} aria-label={monthLabel(period.month) + ' 보관 파일'}>
          <h3>{monthLabel(period.month)}</h3>
          {fileChoice(period, 'PAYMENT')}
          {fileChoice(period, 'PRODUCT')}
        </section>)}
      </div>
      {!reading && !ready && !error && <p role="status">두 달의 결제 파일을 고르고, 분석에 사용할 파일의 월 전체 여부를 확인해 주세요.</p>}
      <p className="muted">상품 주문은 두 달 모두 선택·확인해야 품목별 비교에 포함해요. 한 달만 선택한 상품 주문은 집계하지 않아요.</p>
    </>}
    {reading && <p role="status">선택한 두 달의 POS를 집계하고 있어요.</p>}
    {ready && available && <p role="status">보관한 POS 집계 완료</p>}
    {(error || available?.unreadable) && <p role="alert" className="error">
      {error || '일부 보관 파일에서 거래 날짜를 읽지 못했어요. 파일 형식과 내용을 확인해 주세요.'}{' '}
      <button className="text-button" type="button" disabled={busy} onClick={() => {
        resetImport()
        datesCache.current.clear()
        setScan(undefined)
        setRetry(value => value + 1)
      }}>다시 확인하기</button>
    </p>}
  </section>
}
