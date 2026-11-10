import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { Citrus, PageTitle } from '../components/ui'
import { industryOptions, listAreas, listStores, registerStore, saveAnalysis } from '../api/shop'
import type { Area, Store, StoreInput } from '../api/shop'
import { AddressField } from '../components/AddressField'
import { example, formatNumber, monthLabel, timeSlots, won } from '../data/shop'
import { importPos } from '../data/pos'
import type { PosImport } from '../data/pos'
import type { MonthlySales, TimeSeries } from '../data/shop'

const concerns = [
  ['매출이 줄었어요', '지난달보다 매출이 줄었어요.'],
  ['한가한 시간대가 있어요', '평일 오후에 손님이 줄었어요.'],
  ['재고가 남아요', '잘 팔리지 않는 품목의 재고가 남아요.'],
  ['홍보 방법이 고민돼요', '우리 가게를 어떻게 홍보할지 고민돼요.'],
]

const industryGroups = [...new Set(industryOptions.map(({ group }) => group))]

const administrativeAreaAliases = new Map([
  ['제주시 도두일동', '제주시 도두동'],
  ['제주시 도두이동', '제주시 도두동'],
])

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

type ImportedFile = PosImport & { filename: string }

function PosUpload({ value, onChange, compareMonths, disabled }: {
  value?: ImportedFile
  onChange: (value: ImportedFile | undefined) => void
  compareMonths?: [string, string]
  disabled?: boolean
}) {
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(() => () => { request.current++ }, [])

  async function selectFile(file: File) {
    const id = ++request.current
    onChange(undefined)
    setError('')
    setReading(true)
    try {
      const data = await importPos(file, compareMonths)
      if (id === request.current) onChange({ ...data, filename: file.name })
    } catch (error) {
      if (id === request.current) setError(error instanceof Error ? error.message : 'POS 파일을 읽을 수 없어요.')
    } finally {
      if (id === request.current) setReading(false)
    }
  }

  return <div className="upload-preview">
    <span className="upload-arrow" aria-hidden="true">↑</span>
    <strong>토스포스 결제 내역 선택</strong>
    <p>Excel (.xlsx) · 결제 내역 CSV (.csv) · 최대 10MB</p>
    <label className="file-picker">파일 선택<input type="file" accept=".xlsx,.csv" disabled={disabled || reading} onChange={(event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) void selectFile(file)
    }} /></label>
    <small role="status">{reading ? '결제 내역을 집계하는 중이에요.' : value ? `${value.filename} · 집계 완료` : '서로 다른 두 달 이상의 결제 내역을 올려 주세요.'}</small>
    {error && <p role="alert" className="error">{error}</p>}
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

export function ExistingStoreIntake({ auth, storeId, onAnalyze }: { auth: string; storeId: string; onAnalyze: (id: string) => void }) {
  const [store, setStore] = useState<Store>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listStores(auth, controller.signal).then((stores) => {
      if (controller.signal.aborted) return
      const match = stores.find(({ id }) => id === storeId)
      if (match) setStore(match)
      else setError('내 매장 목록에서 이 매장을 찾을 수 없어요.')
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => controller.abort()
  }, [auth, storeId, retry])

  if (store) return <Intake auth={auth} existingStore={store} onAnalyze={onAnalyze} />
  return <section className="empty-state">
    {error ? <>
      <p role="alert" className="error">{error}</p>
      <button type="button" className="button secondary" onClick={() => {
        setError('')
        setRetry((value) => value + 1)
      }}>다시 불러오기</button>
      <Link to="/stores">내 매장으로 돌아가기</Link>
    </> : <p role="status">선택한 매장을 불러오는 중이에요.</p>}
  </section>
}

export function Intake({ auth, onAnalyze, existingStore }: { auth: string; onAnalyze: (id: string) => void; existingStore?: Store }) {
  const registeredStores = useRef(new Map<string, string>())
  const submitting = useRef(false)
  const [saving, setSaving] = useState(false)
  const [areas, setAreas] = useState<Area[]>()
  const [areaError, setAreaError] = useState('')
  const [areaRetry, setAreaRetry] = useState(0)
  const nextId = useRef(2)
  const [rows, setRows] = useState<InputRow[]>([{ id: 0, month: '', amount: '' }, { id: 1, month: '', amount: '' }])
  const [store, setStore] = useState('')
  const [address, setAddress] = useState('')
  const [areaCode, setAreaCode] = useState('')
  const [searchedArea, setSearchedArea] = useState<string>()
  const resolvedAreaCode = areaCode || areas?.find(({ name }) => name === searchedArea)?.code || ''
  const resolvedArea = areas?.find(({ code }) => code === resolvedAreaCode)?.name
  const [industry, setIndustry] = useState('')
  const [customIndustry, setCustomIndustry] = useState('')
  const [concern, setConcern] = useState('')
  const [selectedConcern, setSelectedConcern] = useState('')
  const [mode, setMode] = useState<InputMode>(existingStore ? 'upload' : 'manual')
  const [error, setError] = useState('')
  const [timeOpen, setTimeOpen] = useState(false)
  const [extra, setExtra] = useState<{ value: TimeSeries; period: string }>()
  const [pos, setPos] = useState<ImportedFile>()
  const monthly = mode === 'upload' ? pos?.monthly : monthlyValues(rows)
  const period = monthly?.slice(-2).map(({ month }) => month).join('/')

  useEffect(() => {
    if (existingStore) return
    const controller = new AbortController()
    listAreas(controller.signal).then(setAreas).catch((error: Error) => {
      if (!controller.signal.aborted) setAreaError(error.message)
    })
    return () => controller.abort()
  }, [areaRetry, existingStore])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    if (!monthly || (!existingStore && (!store.trim() || !address.trim() || !resolvedAreaCode || !industry
        || (industry === 'OTHER' && !customIndustry.trim())))) {
      setError(existingStore ? '서로 다른 두 달 이상의 매출을 확인해 주세요.'
        : '가게 정보, 제주 읍·면·동, 서로 다른 두 달 이상의 매출을 확인해 주세요.')
      return
    }
    submitting.current = true
    setSaving(true)
    setError('')
    try {
      const storeId = existingStore?.id ?? await saveNewStore()
      const timeSeries = mode === 'upload' ? pos?.timeSeries : extra?.period === period ? extra?.value : undefined
      const saved = await saveAnalysis(auth, storeId, monthly, concern.trim(), timeSeries,
        mode === 'upload' ? pos?.productSales : undefined, mode === 'upload' ? pos?.hourlySales : undefined)
      onAnalyze(saved.id)
    } catch (error) {
      setError(error instanceof Error ? error.message : '매출을 저장할 수 없어요.')
    } finally {
      submitting.current = false
      setSaving(false)
    }
  }

  async function saveNewStore() {
    const input: StoreInput = {
      name: store.trim(), address: address.trim(), areaCode: resolvedAreaCode,
      addressSource: searchedArea && searchedArea === resolvedArea ? 'SEARCH' : 'MANUAL',
      industryCode: industry,
      customIndustryName: industry === 'OTHER' ? customIndustry.trim() : undefined,
    }
    const key = JSON.stringify(input)
    const registered = registeredStores.current.get(key)
    if (registered) return registered
    const { id } = await registerStore(auth, input)
    registeredStores.current.set(key, id)
    return id
  }

  function loadExample() {
    setStore(example.store)
    setAddress(example.address ?? '')
    setSearchedArea(undefined)
    setAreaCode('JEJU_AEWOL')
    setIndustry('KOREAN_RESTAURANT')
    setConcern(example.concern)
    setSelectedConcern('')
    setRows(example.monthly.map(({ month, amount }) => ({ id: nextId.current++, month, amount: String(amount) })))
    setExtra(undefined)
    setError('')
    setMode('manual')
  }

  function updateRow(id: number, field: 'month' | 'amount', value: string) {
    setRows(rows.map((row) => row.id === id ? { ...row, [field]: value } : row))
  }

  return <>
    <PageTitle title={existingStore ? '새 매출 분석' : '매장 등록 · 매출 입력'} detail={existingStore
      ? '선택한 매장에 새 매출 분석을 추가해요.' : '가게 정보와 매출을 입력하면 짝꿍이 분석해드려요.'} />
    <form onSubmit={submit}>
      <div className="split">
        <section className="form-stack">
          {existingStore ? <>
            <div className="section-top ruled"><h2>01 선택한 매장</h2>
              <Link to={'/stores?' + new URLSearchParams({ storeId: existingStore.id })}>분석 이력 보기</Link>
            </div>
            <div className="receipt"><strong>{existingStore.name}</strong><p className="muted">{existingStore.areaName} · {existingStore.address}</p></div>
          </> : <>
          <div className="section-top ruled"><h2>01 가게 정보</h2><button type="button" className="text-button" onClick={loadExample}>예시값 채우기</button></div>
          <Link to="/stores">이미 등록한 매장에서 분석하기</Link>
          <label>가게 이름<input required maxLength={100} value={store} onChange={(event) => setStore(event.target.value)} placeholder="가게 이름을 입력하세요" /></label>
          <label>업종<select required value={industry} onChange={(event) => setIndustry(event.target.value)}>
            <option value="">업종을 선택해 주세요</option>
            {industryGroups.map((group) => <optgroup key={group} label={group}>
              {industryOptions.filter((option) => option.group === group).map(({ label, code }) => <option key={code} value={code}>{label}</option>)}
            </optgroup>)}
            <option value="OTHER">기타 (직접 입력)</option>
          </select></label>
          {industry === 'OTHER' && <label>업종명 직접 입력<input required maxLength={100} value={customIndustry} onChange={(event) => setCustomIndustry(event.target.value)} placeholder="예: 꽃집" /></label>}
          <AddressField address={address} area={searchedArea} onChange={(value, district) => {
            setAddress(value)
            setSearchedArea(district && (administrativeAreaAliases.get(district) ?? district))
            setAreaCode('')
          }} />
          <label>제주 읍·면·동<select required value={resolvedAreaCode} disabled={!areas}
            onChange={(event) => setAreaCode(event.target.value)}>
            <option value="">{areas ? '지역을 선택해 주세요' : areaError ? '지역 목록을 불러오지 못했어요' : '지역 목록 불러오는 중…'}</option>
            {areas?.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
          </select></label>
          {areaError && <div role="alert" className="error">{areaError} <button type="button" className="text-button" onClick={() => {
            setAreaError('')
            setAreaRetry((value) => value + 1)
          }}>다시 불러오기</button></div>}
          </>}
          <label>요즘 어떤 점이 고민인가요? <span className="muted">선택</span><textarea rows={3} value={concern} onChange={(event) => setConcern(event.target.value)} /></label>
          <div className="chips">{concerns.map(([label, value]) => <button className="chip" key={label} type="button" aria-pressed={selectedConcern === label} onClick={() => {
            if (selectedConcern === label) {
              setSelectedConcern('')
              if (concern === value) setConcern('')
              return
            }
            setSelectedConcern(label)
            setConcern(value)
          }}>{label}</button>)}</div>
        </section>
        <section className="form-stack">
          <div className="section-top ruled"><h2>02 매출 입력</h2></div>
          <InputTabs mode={mode} onChange={(next) => { if (!saving) { setError(''); setMode(next) } }} manualLabel="월별 매출 직접 입력" />
          {mode === 'upload' ? <>
            <PosUpload value={pos} onChange={setPos} disabled={saving} />
            {pos && <>
              <table className="input-table" aria-label="월별 매출 미리보기">
                <thead><tr><th scope="col">연도와 월</th><th scope="col">결제 완료 매출</th></tr></thead>
                <tbody>{pos.monthly.map(({ month, amount }) => <tr key={month}>
                  <th scope="row">{monthLabel(month)}</th><td>{won(amount)}</td>
                </tr>)}</tbody>
              </table>
              <p className="muted">가장 최근 두 달의 시간대를 비교해요. 취소된 결제는 집계에서 제외했어요.</p>
              <PosTimeSummary series={pos.timeSeries} months={pos.months} />
              {pos.productWarning && <p className="muted" role="status">{pos.productWarning}</p>}
            </>}
          </> : <>
            <table className="input-table"><thead><tr><th scope="col">연도와 월</th><th scope="col">매출액 (원)</th>{rows.length > 2 && <th scope="col">삭제</th>}</tr></thead>
              <tbody>{rows.map((row, index) => <tr key={row.id}>
                <td><input type="month" required aria-label={`${index + 1}번째 연도와 월`} value={row.month} onChange={(event) => updateRow(row.id, 'month', event.target.value)} /></td>
                <td><input type="number" required min="0" step="1" aria-label={`${index + 1}번째 매출액`} value={row.amount} onChange={(event) => updateRow(row.id, 'amount', event.target.value)} placeholder="0" /></td>
                {rows.length > 2 && <td><button className="text-button" type="button" aria-label={`${index + 1}번째 월 삭제`} onClick={() => setRows(rows.filter(({ id }) => id !== row.id))}>×</button></td>}
              </tr>)}</tbody>
            </table>
            <button className="button secondary fit" type="button" onClick={() => setRows([...rows, { id: nextId.current++, month: '', amount: '' }])}>+ 월 추가</button>
            <div className="notice with-icon"><Citrus /><div><strong>월별 매출 2개월이면 시작할 수 있어요.</strong><p>시간대별 변화가 궁금하면 자료를 추가해 주세요.</p></div></div>
            <button type="button" className="button secondary fit" onClick={() => {
              if (monthly) { setError(''); setTimeOpen(true) } else setError('비교할 두 달의 월별 매출을 먼저 입력해 주세요.')
            }}>{extra && extra.period === period ? '시간대별 자료 수정' : '시간대별 자료 추가'}</button>
          </>}
        </section>
      </div>
      <div className="form-footer">
        <span role="alert" className="error">{error}</span>
        <button className="button primary" disabled={saving || (!existingStore && !areas?.length) || (mode === 'upload' && !pos)}>{saving ? '저장 중…' : '분석 시작'} <span aria-hidden="true">→</span></button>
      </div>
    </form>
    {timeOpen && mode === 'manual' && monthly && period && <TimeDialog monthly={monthly} initial={extra?.period === period ? extra.value : undefined} onClose={() => setTimeOpen(false)} onSave={(value) => { setExtra({ value, period }); setTimeOpen(false) }} />}
  </>
}
