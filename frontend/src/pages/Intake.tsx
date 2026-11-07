import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Citrus, PageTitle } from '../components/ui'
import { AddressField } from '../components/AddressField'
import { example, monthLabel, timeSlots } from '../data/shop'
import type { Analysis, MonthlySales, TimeSeries } from '../data/shop'

const concerns = [
  ['매출이 줄었어요', '지난달보다 매출이 줄었어요.'],
  ['한가한 시간대가 있어요', '평일 오후에 손님이 줄었어요.'],
  ['재고가 남아요', '잘 팔리지 않는 품목의 재고가 남아요.'],
  ['홍보 방법이 고민돼요', '우리 가게를 어떻게 홍보할지 고민돼요.'],
]

const industryGroups = [
  {
    label: '음식점·카페',
    options: [
      ['한식 음식점', '한식 음식점업'],
      ['중식 음식점', '중식 음식점업'],
      ['일식 음식점', '일식 음식점업'],
      ['양식 음식점', '서양식 음식점업'],
      ['기타 외국식 음식점', '기타 외국식 음식점업'],
      ['피자·햄버거·샌드위치', '피자, 햄버거, 샌드위치 및 유사 음식점업'],
      ['카페·음료점', '비알콜 음료점업'],
      ['주점', '기타 주점업'],
    ],
  },
  {
    label: '소매',
    options: [
      ['빵·과자 판매점', '빵 및 과자류 소매업'],
      ['슈퍼마켓', '슈퍼마켓'],
      ['편의점', '체인화 편의점'],
      ['과일·채소 판매점', '과실 및 채소 소매업'],
      ['수산물 판매점', '수산물 소매업'],
      ['정육점', '육류 소매업'],
      ['기념품·선물 가게', '관광 민예품 및 선물용품 소매업'],
      ['화장품 판매점', '화장품 및 방향제 소매업'],
    ],
  },
  {
    label: '숙박·관광',
    options: [
      ['호텔', '호텔업'],
      ['여관·모텔', '여관업'],
      ['휴양콘도', '휴양콘도 운영업'],
      ['여행사', '여행사업'],
    ],
  },
]

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

function UploadPreview() {
  const [filename, setFilename] = useState('')
  return <div className="upload-preview">
    <span className="upload-arrow" aria-hidden="true">↑</span>
    <strong>매출 파일 선택</strong>
    <p>Excel (.xlsx) · CSV (.csv)</p>
    <label className="file-picker">파일 선택<input type="file" accept=".xlsx,.csv" onChange={(event) => setFilename(event.target.files?.[0]?.name ?? '')} /></label>
    <small role="status">{filename ? `${filename} · 파일 분석은 Spring API 연결 후 사용할 수 있어요.` : '파일 선택 화면 미리보기'}</small>
  </div>
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
  onSave: (value: TimeSeries) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
    onSave({ metric, rows })
  }

  return <dialog ref={dialog} className="time-dialog" aria-labelledby="time-title" onCancel={(event) => { event.preventDefault(); onClose() }}>
    <div className="section-top"><h2 id="time-title">시간대별 자료 추가</h2><button type="button" className="text-button close" aria-label="닫기" onClick={onClose}>×</button></div>
    <p className="muted">비교 기간 · {monthLabel(before.month)}과 {monthLabel(after.month)}</p>
    <InputTabs mode={mode} onChange={setMode} manualLabel="시간대별 직접 입력" />
    {mode === 'upload' ? <UploadPreview /> : <form onSubmit={submit} className="form-stack">
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
      <div className="actions end"><button type="button" className="button secondary" onClick={onClose}>취소</button><button className="button primary">저장하고 차트 보기 <span aria-hidden="true">→</span></button></div>
    </form>}
  </dialog>
}

export function Intake({ onAnalyze }: { onAnalyze: (value: Analysis) => void }) {
  const nextId = useRef(2)
  const [rows, setRows] = useState<InputRow[]>([{ id: 0, month: '', amount: '' }, { id: 1, month: '', amount: '' }])
  const [store, setStore] = useState('')
  const [address, setAddress] = useState('')
  const [area, setArea] = useState<string>()
  const [industry, setIndustry] = useState('')
  const [customIndustry, setCustomIndustry] = useState('')
  const [concern, setConcern] = useState('')
  const [selectedConcern, setSelectedConcern] = useState('')
  const [mode, setMode] = useState<InputMode>('manual')
  const [error, setError] = useState('')
  const [timeOpen, setTimeOpen] = useState(false)
  const [extra, setExtra] = useState<{ value: TimeSeries; period: string }>()
  const monthly = monthlyValues(rows)
  const period = monthly?.slice(-2).map(({ month }) => month).join('/')

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const industryName = industry === 'other' ? customIndustry.trim() : industry
    if (!store.trim() || !address.trim() || !industryName || !monthly) {
      setError('가게 정보와 서로 다른 두 달 이상의 매출을 확인해 주세요.')
      return
    }
    onAnalyze({ store: store.trim(), address: address.trim(), area, industry: industryName, concern: concern.trim(), monthly, timeSeries: extra?.period === period ? extra?.value : undefined, demo: false })
  }

  function loadExample() {
    setStore(example.store)
    setAddress(example.address ?? '')
    setArea(example.area)
    setIndustry(example.industry)
    setConcern(example.concern)
    setRows(example.monthly.map(({ month, amount }) => ({ id: nextId.current++, month, amount: String(amount) })))
    setExtra(undefined)
    setError('')
    setMode('manual')
  }

  function updateRow(id: number, field: 'month' | 'amount', value: string) {
    setRows(rows.map((row) => row.id === id ? { ...row, [field]: value } : row))
  }

  return <>
    <PageTitle title="매장 등록 · 매출 입력" detail="가게 정보와 매출을 입력하면 짝꿍이 분석해드려요." />
    <form onSubmit={submit}>
      <div className="split">
        <section className="form-stack">
          <div className="section-top ruled"><h2>01 가게 정보</h2><button type="button" className="text-button" onClick={loadExample}>예시값 채우기</button></div>
          <label>가게 이름<input required value={store} onChange={(event) => setStore(event.target.value)} placeholder="가게 이름을 입력하세요" /></label>
          <label>업종<select required value={industry} onChange={(event) => setIndustry(event.target.value)}>
            <option value="">업종을 선택해 주세요</option>
            {industryGroups.map((group) => <optgroup key={group.label} label={group.label}>
              {group.options.map(([label, value]) => <option key={value} value={value}>{label}</option>)}
            </optgroup>)}
            <option value="other">기타 (직접 입력)</option>
          </select></label>
          {industry === 'other' && <label>업종명 직접 입력<input required value={customIndustry} onChange={(event) => setCustomIndustry(event.target.value)} placeholder="예: 꽃집" /></label>}
          <AddressField address={address} area={area} onChange={(value, district) => {
            setAddress(value)
            setArea(district)
          }} />
          <label>요즘 어떤 점이 고민인가요? <span className="muted">선택</span><textarea rows={3} value={concern} onChange={(event) => setConcern(event.target.value)} /></label>
          <div className="chips">{concerns.map(([label, value]) => <button className="chip" key={label} type="button" aria-pressed={selectedConcern === label} onClick={() => { setSelectedConcern(label); setConcern(value) }}>{label}</button>)}</div>
        </section>
        <section className="form-stack">
          <div className="section-top ruled"><h2>02 매출 입력</h2></div>
          <InputTabs mode={mode} onChange={setMode} manualLabel="월별 매출 직접 입력" />
          {mode === 'upload' ? <UploadPreview /> : <>
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
        <button className="button primary" disabled={mode === 'upload'}>분석 시작 <span aria-hidden="true">→</span></button>
      </div>
    </form>
    {timeOpen && monthly && period && <TimeDialog monthly={monthly} initial={extra?.period === period ? extra.value : undefined} onClose={() => setTimeOpen(false)} onSave={(value) => { setExtra({ value, period }); setTimeOpen(false) }} />}
  </>
}
