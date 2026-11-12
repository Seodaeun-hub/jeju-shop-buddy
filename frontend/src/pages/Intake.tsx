import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { listPosFiles, listStores, readStoredPosFile, saveAnalysis } from '../api/shop'
import type { StoredPosFile, Store } from '../api/shop'
import { useStoreSelection } from '../components/useStoreSelection'
import { MonthlyPosArchive } from '../components/MonthlyPosArchive'
import { formatNumber, monthLabel, timeSlots, won } from '../data/shop'
import { importPos, readProductSales } from '../data/pos'
import type { PosImport } from '../data/pos'
import type { MonthlySales, TimeSeries } from '../data/shop'
import '../styles/intake.css'

const concerns = [
  ['매출이 줄었어요', '지난달보다 매출이 줄었어요.'],
  ['한가한 시간대가 있어요', '평일 오후에 손님이 줄었어요.'],
  ['재고가 남아요', '잘 팔리지 않는 품목의 재고가 남아요.'],
  ['홍보 방법이 고민돼요', '우리 가게를 어떻게 홍보할지 고민돼요.'],
]

function toggleConcernExample(concern: string, example: string) {
  const lines = concern.split('\n')
  if (lines.includes(example)) return lines.filter(line => line !== example).join('\n')
  const next = [concern.trimEnd(), example].filter(Boolean).join('\n')
  return next.length <= 1000 ? next : concern
}

type InputRow = { id: number; month: string; amount: string }
type InputMode = 'manual' | 'upload'

function monthlyValues(rows: InputRow[]): MonthlySales[] | null {
  if (rows.some(({ month, amount }) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    || !/^\d+$/.test(amount) || !Number.isSafeInteger(Number(amount)))) return null
  if (new Set(rows.map(({ month }) => month)).size !== rows.length) return null
  return rows.map(({ month, amount }) => ({ month, amount: Number(amount) }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

function InputTabs({ mode, onChange, manualLabel }: {
  mode: InputMode
  onChange: (mode: InputMode) => void
  manualLabel: string
}) {
  return <div className="input-tabs" role="group" aria-label="자료 입력 방식">
    <button type="button" aria-pressed={mode === 'upload'} onClick={() => onChange('upload')}>POS 파일 업로드</button>
    <button type="button" aria-pressed={mode === 'manual'} onClick={() => onChange('manual')}>{manualLabel}</button>
  </div>
}

type ImportedFile = PosImport & { filename: string; paymentFileId?: string; productFilename?: string; productFileId?: string }

function PosFilePicker({ label, filename, placeholder, accept, disabled, onSelect }: {
  label: string
  filename?: string
  placeholder?: string
  accept: string
  disabled: boolean
  onSelect: (file: File) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return <div className={filename || placeholder ? 'pos-file-picker with-filename' : 'pos-file-picker'}>
    <button type="button" className="button secondary small" disabled={disabled} onClick={() => input.current?.click()}>
      {label}
    </button>
    {(filename || placeholder) && <span className={filename ? undefined : 'muted'}>{filename ?? placeholder}</span>}
    <input ref={input} type="file" aria-label={label} accept={accept} disabled={disabled} hidden onChange={event => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) onSelect(file)
    }} />
  </div>
}

function StoredFilePicker({ label, files, selectedId, disabled, placeholder, onSelect }: {
  label: string
  files: StoredPosFile[]
  selectedId?: string
  disabled: boolean
  placeholder: string
  onSelect: (file: StoredPosFile) => void
}) {
  return <label className="stored-file-picker">{label}
    <select value={selectedId ?? ''} disabled={disabled || !files.length} onChange={event => {
      const file = files.find(item => item.id === event.target.value)
      if (file) onSelect(file)
    }}>
      <option value="" disabled>{placeholder}</option>
      {files.map(file => <option key={file.id} value={file.id}>
        {file.filename} · {new Date(file.uploadedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
      </option>)}
    </select>
  </label>
}

function PosUpload({ value, onChange, compareMonths, disabled, onProductReadingChange, auth, storeId }: {
  value?: ImportedFile
  onChange: (value: ImportedFile | undefined) => void
  compareMonths?: [string, string]
  disabled?: boolean
  onProductReadingChange?: (reading: boolean) => void
  auth?: string
  storeId?: string
}) {
  const [reading, setReading] = useState<{ kind: 'payment' | 'product'; filename: string }>()
  const [error, setError] = useState('')
  const [storedFiles, setStoredFiles] = useState<StoredPosFile[]>()
  const [storedFilesError, setStoredFilesError] = useState('')
  const [retry, setRetry] = useState(0)
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])

  useEffect(() => {
    if (!auth || !storeId) return
    const controller = new AbortController()
    listPosFiles(auth, storeId, controller.signal).then(files => {
      if (!controller.signal.aborted) setStoredFiles(files)
    }).catch(() => {
      if (!controller.signal.aborted) setStoredFilesError('저장된 POS 파일 목록을 불러올 수 없어요.')
    })
    return () => controller.abort()
  }, [auth, storeId, retry])

  async function selectFile(filename: string, load: () => File | Promise<File>, paymentFileId?: string) {
    const id = ++request.current
    onChange(undefined)
    setError('')
    setReading({ kind: 'payment', filename })
    try {
      const data = await importPos(await load(), compareMonths)
      if (id === request.current) onChange({ ...data, filename, paymentFileId })
    } catch (error) {
      if (id === request.current) setError(error instanceof Error ? error.message : 'POS 파일을 읽을 수 없어요.')
    } finally {
      if (id === request.current) setReading(undefined)
    }
  }

  async function selectProductFile(filename: string, load: () => File | Promise<File>, payment: ImportedFile, productFileId?: string) {
    const id = ++request.current
    setError('')
    setReading({ kind: 'product', filename })
    onProductReadingChange?.(true)
    try {
      const productSales = await readProductSales(await load(), ...payment.months)
      if (!productSales.length) throw new Error('비교 기간에 해당하는 상품 주문이 없어요.')
      if (id === request.current) {
        onChange({ ...payment, productSales, productWarning: undefined, productFilename: filename, productFileId })
      }
    } catch {
      if (id === request.current) setError(filename + ' 파일을 읽지 못했어요. 저장 여부, CSV 형식과 비교 기간을 확인해 주세요.')
    } finally {
      if (id === request.current) {
        setReading(undefined)
        onProductReadingChange?.(false)
      }
    }
  }

  const productCount = value?.productSales?.length ?? 0
  const priceCount = value?.productSales?.filter(item => item.priceWon != null).length ?? 0
  const canAddProductCsv = value && (/\.csv$/i.test(value.filename) || !productCount || value.productFilename)
  const pickerDisabled = Boolean(disabled || reading)
  const paymentFiles = storedFiles?.filter(file => file.kind === 'PAYMENT') ?? []
  const productFiles = storedFiles?.filter(file => file.kind === 'PRODUCT') ?? []
  const savedFilePlaceholder = (files: StoredPosFile[]) => storedFilesError ? '파일 목록을 불러오지 못했어요'
    : !storedFiles ? '파일 목록 불러오는 중…'
      : files.length ? '저장된 파일을 선택해 주세요' : '이 매장에 저장된 파일이 없어요'

  return <div className={compareMonths ? "upload-preview" : "sales-pos"}>
    {compareMonths && <>
      <span className="upload-arrow" aria-hidden="true">↑</span>
      <strong>토스포스 결제 내역 선택</strong>
      <p>Excel (.xlsx) · 결제 내역 CSV (.csv) · 최대 10MB</p>
    </>}
    <div className="pos-file-statuses">
      <div className="pos-file-status">
        <div role="status">
          <strong>결제 내역</strong>
          {reading?.kind === 'payment' ? <small>집계 중</small>
            : value ? <>
              <span className="badge">집계 완료</span>
              <small>{compareMonths ? '시간대별 결제 건수' : '월별 매출 · 시간대별 결제 건수'}</small>
            </> : <small>토스포스 결제 CSV 또는 엑셀 · 최대 10MB</small>}
        </div>
        <PosFilePicker label={value ? '결제 파일 교체' : '결제 파일 선택'}
          filename={reading?.kind === 'payment' ? reading.filename : value?.filename}
          placeholder={compareMonths ? "결제 CSV 또는 엑셀 파일" : undefined} accept=".xlsx,.csv"
          disabled={pickerDisabled} onSelect={file => void selectFile(file.name, () => file)} />
        {auth && storeId && <StoredFilePicker label="저장된 결제 내역 불러오기" files={paymentFiles} disabled={pickerDisabled}
          selectedId={value?.paymentFileId} placeholder={savedFilePlaceholder(paymentFiles)}
          onSelect={file => void selectFile(file.filename, () => readStoredPosFile(auth, storeId, file), file.id)} />}
      </div>
      {!compareMonths && <div className="pos-file-status">
        <div role="status">
          <strong>상품 주문 <span className="sales-optional">선택</span></strong>
          {reading?.kind === 'product' ? <small>집계 중</small>
            : productCount ? <>
              {!value?.productFilename && <small>엑셀의 상품 주문 시트</small>}
              <span className="badge">집계 완료</span>
              <small>판매량 {formatNumber(productCount)}개 품목 · 판매가 {formatNumber(priceCount)}개 품목</small>
            </> : <small>{!value ? '결제 파일을 먼저 올려 주세요.'
              : canAddProductCsv ? '상품 주문 CSV를 추가하면 품목별 판매량과 판매가를 볼 수 있어요.'
              : value.productWarning ?? '비교 기간에 해당하는 상품 주문이 없어요.'}</small>}
        </div>
        {canAddProductCsv && <PosFilePicker label={value.productFilename ? '상품 주문 파일 교체' : '파일 추가'}
            filename={reading?.kind === 'product' ? reading.filename : value.productFilename}
            accept=".csv" disabled={pickerDisabled} onSelect={file => void selectProductFile(file.name, () => file, value)} />}
        {auth && storeId && (!value || canAddProductCsv) && <StoredFilePicker label="저장된 상품 주문 불러오기"
          files={productFiles} disabled={pickerDisabled || !value} selectedId={value?.productFileId}
          placeholder={value ? savedFilePlaceholder(productFiles) : '결제 내역을 먼저 선택해 주세요'}
          onSelect={file => { if (value) void selectProductFile(file.filename, () => readStoredPosFile(auth, storeId, file), value, file.id) }} />}
      </div>}
    </div>
    {error && <p role="alert" className="error">{error}</p>}
    {auth && storeId && <div className="pos-library-note">
      {storedFilesError && <p role="alert">{storedFilesError} <button type="button" className="text-button" onClick={() => {
        setStoredFilesError('')
        setRetry(value => value + 1)
      }}>다시 불러오기</button></p>}
      <Link to={'/stores?' + new URLSearchParams({ storeId, section: 'pos-files' })}>내 매장 POS 파일 관리</Link>
    </div>}
    {value && !reading && !compareMonths && <small>분석 시작을 누르면 집계된 자료를 저장해요.</small>}
  </div>
}

function PosTimeSummary({ series, months }: { series: TimeSeries; months: [string, string] }) {
  return <table className="input-table" aria-label="시간대별 결제 건수 미리보기">
    <thead><tr><th scope="col">결제 시간대</th><th scope="col">{monthLabel(months[0])}</th><th scope="col">{monthLabel(months[1])}</th></tr></thead>
    <tbody>{series.rows.map(({ label, before, after }) => <tr key={label}>
      <th scope="row">{label}</th><td>{formatNumber(before)}건</td><td>{formatNumber(after)}건</td>
    </tr>)}</tbody>
  </table>
}

type TimeTotals = { before: string; after: string }
type TimeRow = {
  id: number
  label: string
  totals: Partial<Record<TimeSeries['metric'], TimeTotals>>
}

export function TimeDialog({ monthly, initial, onClose, onSave }: {
  monthly: MonthlySales[]
  initial?: TimeSeries
  onClose: () => void
  onSave: (value: TimeSeries) => void | Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [pos, setPos] = useState<ImportedFile>()
  const [mode, setMode] = useState<InputMode>('manual')
  const [metric, setMetric] = useState<TimeSeries['metric']>(initial?.metric ?? 'amount')
  const nextRowId = useRef(initial?.rows.length ?? timeSlots.length)
  const [timeRows, setTimeRows] = useState<TimeRow[]>(() => {
    if (!initial) return timeSlots.map((label, id) => ({ id, label, totals: {} }))
    return initial.rows.map(({ label, before, after }, id) => ({
      id, label, totals: { [initial.metric]: { before: String(before), after: String(after) } },
    }))
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [before, after] = monthly.slice(-2)

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  function updateTotal(id: number, field: keyof TimeTotals, value: string) {
    setTimeRows((rows) => rows.map((row) => row.id === id ? {
      ...row,
      totals: { ...row.totals, [metric]: { before: '', after: '', ...row.totals[metric], [field]: value } },
    } : row))
  }

  function addTimeRow() {
    const id = nextRowId.current++
    setTimeRows((rows) => [...rows, { id, label: '', totals: {} }])
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (saving) return
    const labels = timeRows.map(({ label }) => label.trim())
    if (labels.some((label) => !label) || new Set(labels).size !== labels.length) {
      setError('시간대 이름을 비우거나 중복해서 입력할 수 없어요.')
      return
    }
    const rows = timeRows.map(({ totals }, index) => ({
      label: labels[index],
      before: Number(totals[metric]?.before || NaN),
      after: Number(totals[metric]?.after || NaN),
    }))
    if (rows.some((row) => !Number.isSafeInteger(row.before) || !Number.isSafeInteger(row.after))) {
      setError('합계는 정수로 입력해 주세요.')
      return
    }
    await saveTimeSeries({ metric, rows })
  }

  async function saveTimeSeries(value: TimeSeries) {
    setSaving(true)
    setError('')
    try {
      await onSave(value)
    } catch (error) {
      setError(error instanceof Error ? error.message : '시간대별 자료를 저장할 수 없어요.')
    } finally {
      setSaving(false)
    }
  }

  return <dialog ref={dialog} className="time-dialog" aria-labelledby="time-title" onCancel={(event) => { event.preventDefault(); if (!saving) onClose() }}>
    <div className="section-top"><h2 id="time-title">시간대별 자료 추가</h2><button type="button" className="text-button close" aria-label="닫기" disabled={saving} onClick={onClose}>×</button></div>
    <p className="muted">비교 기간 · {monthLabel(before.month)}과 {monthLabel(after.month)}</p>
    <InputTabs mode={mode} onChange={(next) => { if (!saving) { setError(''); setMode(next) } }} manualLabel="시간대별 직접 입력" />
    {mode === 'upload' ? <>
      <PosUpload value={pos} onChange={setPos} compareMonths={[before.month, after.month]} disabled={saving} />
      {pos && <>
        <PosTimeSummary series={pos.timeSeries} months={pos.months} />
        <button type="button" className="button primary" disabled={saving} onClick={() => void saveTimeSeries(pos.timeSeries)}>
          {saving ? '저장 중…' : '저장하고 차트 보기'}
        </button>
      </>}
      {error && <p role="alert" className="error">{error}</p>}
    </> : <form onSubmit={submit} className="form-stack">
      <label>입력 항목<select value={metric} onChange={(event) => setMetric(event.target.value === 'count' ? 'count' : 'amount')}>
        <option value="amount">매출액 (원)</option><option value="count">결제 건수 (건)</option>
      </select></label>
      <p className="muted">서로 겹치지 않는 시간대로 나누고, 두 달에 같은 구간을 적용해 주세요.</p>
      <table className="input-table">
        <thead><tr><th scope="col">시간대</th><th scope="col">{monthLabel(before.month)}</th><th scope="col">{monthLabel(after.month)}</th><th scope="col">삭제</th></tr></thead>
        <tbody>{timeRows.map((row, index) => <tr key={row.id}>
          <th scope="row"><input required aria-label={`${index + 1}번째 시간대`} placeholder="예: 오후 5~8시"
            value={row.label} onChange={(event) => {
              const label = event.target.value
              setTimeRows((rows) => rows.map((item) => item.id === row.id ? { ...item, label } : item))
            }} /></th>
          <td><input type="number" min="0" step="1" required aria-label={`${monthLabel(before.month)} ${row.label || index + 1}`}
            value={row.totals[metric]?.before ?? ''} onChange={(event) => updateTotal(row.id, 'before', event.target.value)} /></td>
          <td><input type="number" min="0" step="1" required aria-label={`${monthLabel(after.month)} ${row.label || index + 1}`}
            value={row.totals[metric]?.after ?? ''} onChange={(event) => updateTotal(row.id, 'after', event.target.value)} /></td>
          <td><button className="text-button" type="button" aria-label={`${index + 1}번째 시간대 삭제`} disabled={timeRows.length === 1}
            onClick={() => setTimeRows((rows) => rows.filter(({ id }) => id !== row.id))}>×</button></td>
        </tr>)}</tbody>
      </table>
      <button className="button secondary fit" type="button" onClick={addTimeRow}>+ 시간대 추가</button>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="actions end"><button type="button" className="button secondary" disabled={saving} onClick={onClose}>취소</button><button className="button primary" disabled={saving}>{saving ? '저장 중…' : '저장하고 차트 보기'} <span aria-hidden="true">→</span></button></div>
    </form>}
  </dialog>
}

export function Intake({ auth, ownerEmail, onAnalyze }: { auth: string; ownerEmail: string; onAnalyze: (id: string) => void }) {
  const [params, setParams] = useSearchParams()
  const [stores, setStores] = useState<Store[]>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [saving, setSaving] = useState(false)
  const storeId = params.get('storeId')
  const selected = useStoreSelection(ownerEmail, stores, storeId)

  useEffect(() => {
    const controller = new AbortController()
    listStores(auth, controller.signal).then(value => {
      if (!controller.signal.aborted) setStores(value)
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => controller.abort()
  }, [auth, retry])

  return <div className="sales-intake">
    <header className="sales-heading">
      <h1>매출 입력</h1>
      <p>매장을 고른 뒤 보관한 POS를 불러오거나 매출 자료를 새로 입력하세요.</p>
    </header>
    {error ? <section className="empty-state">
      <p role="alert" className="error">{error}</p>
      <button type="button" className="button secondary" onClick={() => {
        setError('')
        setRetry(value => value + 1)
      }}>다시 불러오기</button>
    </section> : !stores ? <p role="status">등록한 매장을 불러오는 중이에요.</p>
      : stores.length === 0 ? <section className="empty-state">
        <p>등록한 매장이 없어요. 내 매장에서 먼저 매장을 등록해 주세요.</p>
        <Link className="button primary" to="/stores">내 매장으로 이동</Link>
      </section> : <div className="form-stack">
        <section className="sales-form sales-section form-stack" aria-label="매출을 입력할 매장">
          <div className="store-picker">
            <label>매장 선택<select value={selected?.id ?? ''} disabled={saving}
              onChange={event => setParams({ storeId: event.target.value }, { replace: true })}>
              <option value="" disabled>매장을 선택해 주세요</option>
              {stores.map(store => <option key={store.id} value={store.id}>{store.name} · {store.areaName}</option>)}
            </select></label>
            {selected && <Link className="button secondary" to={'/stores?' + new URLSearchParams({ storeId: selected.id })}>분석 이력 보기</Link>}
          </div>
          {selected ? <p className="muted store-address">{selected.address}</p>
            : storeId && <p role="alert" className="error">선택한 매장을 찾을 수 없어요. 목록에서 매장을 골라 주세요.</p>}
        </section>
        {selected && <SalesForm key={selected.id} auth={auth} storeId={selected.id} saving={saving} onSaving={setSaving} onAnalyze={onAnalyze} />}
      </div>}
  </div>
}

function SalesForm({ auth, storeId, saving, onSaving, onAnalyze }: {
  auth: string
  storeId: string
  saving: boolean
  onSaving: (saving: boolean) => void
  onAnalyze: (id: string) => void
}) {
  const submitting = useRef(false)
  const nextId = useRef(2)
  const [rows, setRows] = useState<InputRow[]>([{ id: 0, month: '', amount: '' }, { id: 1, month: '', amount: '' }])
  const [analysisName, setAnalysisName] = useState('')
  const [concern, setConcern] = useState('')
  const [mode, setMode] = useState<InputMode>('upload')
  const [error, setError] = useState('')
  const [timeOpen, setTimeOpen] = useState(false)
  const [extra, setExtra] = useState<{ value: TimeSeries; period: string }>()
  const [posSource, setPosSource] = useState<'archive' | 'upload'>('archive')
  const [directPos, setDirectPos] = useState<ImportedFile>()
  const [archivedPos, setArchivedPos] = useState<PosImport>()
  const [productReading, setProductReading] = useState(false)
  const pos = posSource === 'archive' ? archivedPos : directPos
  const monthly = mode === 'upload' ? pos?.monthly : monthlyValues(rows)
  const period = monthly?.slice(-2).map(({ month }) => month).join('/')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current || productReading) return
    if (!monthly) {
      setError('서로 다른 두 달 이상의 매출을 확인해 주세요.')
      return
    }
    submitting.current = true
    onSaving(true)
    setError('')
    try {
      const timeSeries = mode === 'upload' ? pos?.timeSeries : extra?.period === period ? extra?.value : undefined
      const saved = await saveAnalysis(auth, storeId, monthly, concern.trim(), analysisName.trim(), timeSeries,
        mode === 'upload' ? pos?.productSales : undefined, mode === 'upload' ? pos?.hourlySales : undefined)
      onAnalyze(saved.id)
    } catch (error) {
      setError(error instanceof Error ? error.message : '매출을 저장할 수 없어요.')
    } finally {
      submitting.current = false
      onSaving(false)
    }
  }

  function updateRow(id: number, field: 'month' | 'amount', value: string) {
    setRows(rows.map((row) => row.id === id ? { ...row, [field]: value } : row))
  }

  return <>
    <form className="sales-form" onSubmit={submit}>
      <section className="sales-section form-stack" aria-labelledby="sales-data-heading">
        <h2 id="sales-data-heading">매출 자료</h2>
          <InputTabs mode={mode} onChange={next => {
            if (saving || productReading || next === mode) return
            setError('')
            setArchivedPos(undefined)
            setMode(next)
          }} manualLabel="월별 매출 직접 입력" />
          {mode === 'upload' ? <>
            <div className="actions monthly-pos-source" role="group" aria-label="POS 파일 가져오기">
              <button type="button" className="button secondary small" aria-pressed={posSource === 'archive'}
                disabled={saving || productReading} onClick={() => { setError(''); setPosSource('archive') }}>내 매장 월별 파일</button>
              <button type="button" className="button secondary small" aria-pressed={posSource === 'upload'}
                disabled={saving || productReading} onClick={() => {
                  setError('')
                  setArchivedPos(undefined)
                  setPosSource('upload')
                }}>직접 업로드</button>
            </div>
            {posSource === 'archive'
              ? <MonthlyPosArchive auth={auth} storeId={storeId} disabled={saving} onImport={setArchivedPos} onReading={setProductReading} />
              : <PosUpload value={directPos} onChange={setDirectPos} disabled={saving}
                onProductReadingChange={setProductReading} auth={auth} storeId={storeId} />}
            {pos && <div className="sales-import-summary">
              <h3>월별 매출 미리보기</h3>
              <table className="input-table" aria-label="월별 매출 미리보기">
                <thead><tr><th scope="col">연도와 월</th><th scope="col">결제 완료 매출</th></tr></thead>
                <tbody>{pos.monthly.map(({ month, amount }) => <tr key={month}>
                  <th scope="row">{monthLabel(month)}</th><td>{won(amount)}</td>
                </tr>)}</tbody>
              </table>
              {posSource === 'archive' && pos.productSales && <p className="muted">상품 주문에서 {formatNumber(pos.productSales.length)}개 품목을 집계했어요.</p>}
              {posSource === 'archive' && pos.productWarning && <p className="muted" role="status">{pos.productWarning}</p>}
              <details>
                <summary>시간대별 결제 건수 보기</summary>
                <p className="muted">가장 최근 두 달을 비교하며 취소된 결제는 집계에서 제외해요.</p>
                <PosTimeSummary series={pos.timeSeries} months={pos.months} />
              </details>
            </div>}
          </> : <>
            <table className="input-table"><thead><tr><th scope="col">연도와 월</th><th scope="col">매출액 (원)</th>{rows.length > 2 && <th scope="col">삭제</th>}</tr></thead>
              <tbody>{rows.map((row, index) => <tr key={row.id}>
                <td><input type="month" required aria-label={`${index + 1}번째 연도와 월`} value={row.month} onChange={(event) => updateRow(row.id, 'month', event.target.value)} /></td>
                <td><input type="number" required min="0" step="1" aria-label={`${index + 1}번째 매출액`} value={row.amount} onChange={(event) => updateRow(row.id, 'amount', event.target.value)} placeholder="0" /></td>
                {rows.length > 2 && <td><button className="text-button" type="button" aria-label={`${index + 1}번째 월 삭제`} onClick={() => setRows(rows.filter(({ id }) => id !== row.id))}>×</button></td>}
              </tr>)}</tbody>
            </table>
            <div className="actions">
              <button className="button secondary small" type="button" onClick={() => setRows([...rows, { id: nextId.current++, month: '', amount: '' }])}>+ 월 추가</button>
              <button type="button" className="button secondary small" onClick={() => {
                if (monthly) { setError(''); setTimeOpen(true) } else setError('비교할 두 달의 월별 매출을 먼저 입력해 주세요.')
              }}>{extra && extra.period === period ? '시간대별 자료 수정' : '시간대별 자료 추가'}</button>
            </div>
          </>}
      </section>
      <section className="sales-section form-stack" aria-labelledby="sales-context-heading">
        <h2 id="sales-context-heading">분석 정보 <span className="sales-optional">선택</span></h2>
        <label>분석 이름<input value={analysisName} onChange={event => setAnalysisName(event.target.value)}
          placeholder="예: 봄철 점심 매출 비교" maxLength={100} disabled={saving} /></label>
        <label>요즘 어떤 점이 고민인가요?
          <textarea rows={3} value={concern} maxLength={1000} onChange={(event) => setConcern(event.target.value)} />
          <small className="muted">고민이 여러 가지라면 줄을 나눠 적어도 돼요.</small>
        </label>
        <div className="chips">{concerns.map(([label, value]) => {
          const selected = concern.split('\n').includes(value)
          return <button className="chip" key={label} type="button" aria-pressed={selected}
            disabled={toggleConcernExample(concern, value) === concern}
            onClick={() => setConcern(current => toggleConcernExample(current, value))}>{label}</button>
        })}</div>
      </section>
      <div className="form-footer sales-footer">
        <span role="alert" className="error">{error}</span>
        <button className="button primary" disabled={saving || productReading || (mode === 'upload' && !pos)}>
          {saving ? '저장 중…' : mode === 'upload' && posSource === 'archive' ? '이 자료로 분석하기' : '분석 시작'} <span aria-hidden="true">→</span>
        </button>
      </div>
    </form>
    {timeOpen && mode === 'manual' && monthly && period && <TimeDialog monthly={monthly} initial={extra?.period === period ? extra.value : undefined} onClose={() => setTimeOpen(false)} onSave={(value) => { setExtra({ value, period }); setTimeOpen(false) }} />}
  </>
}
