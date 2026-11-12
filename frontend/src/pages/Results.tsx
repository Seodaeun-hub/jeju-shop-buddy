import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { deleteSalesResult, fetchSalesResult, saveSalesResult } from '../api/shop'
import type { ResultMetric, SavedSalesResult } from '../api/shop'
import { Citrus, PageTitle } from '../components/ui'
import { formatQuantity, parseQuantity } from '../data/inventory'
import { addDays, changeRate, formatNumber, formatRate, won } from '../data/shop'
import type { Plan, SalesPeriod, SalesResult } from '../data/shop'
import { PromotionImpactPanel } from './PromotionImpactPanel'
import '../styles/results.css'

const sample: SalesResult = {
  before: { start: '2021-05-19', end: '2021-05-31', days: 7, amount: 1_036_000, count: 34 },
  after: { start: '2021-06-02', end: '2021-06-14', days: 7, amount: 1_204_000, count: 45 },
}

const averageCount = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format

function periodLabel(start: string, end: string) {
  return `${start.replaceAll('-', '.')} ~ ${end.replaceAll('-', '.')}`
}

function ResultChart({ title, metric, format }: {
  title: string
  metric: ResultMetric
  format: (value: number) => string
}) {
  const { beforeDailyAverage: before, afterDailyAverage: after, changeRatePercent: rate } = metric
  const scale = Math.max(before, after, 1)
  return <section className="result-chart ruled-block">
    <div className="section-top">
      <h2>{title}</h2>
      <span className={after < before ? 'badge result-drop' : 'badge'}>{formatRate(rate)}</span>
    </div>
    <ul aria-label={`${title} 비교`}>
      {[['실행 전', before], ['실행 기간', after]].map(([label, value]) =>
        <li key={label}>
          <span>{label}</span>
          <div className="result-bar-track" aria-hidden="true"><div style={{ width: `${Number(value) / scale * 100}%` }} /></div>
          <strong>{format(Number(value))}</strong>
        </li>,
      )}
    </ul>
  </section>
}

function ResultFields({ phase, label, values }: { phase: 'before' | 'after'; label: string; values: Partial<SalesPeriod> }) {
  return <fieldset className="result-fields">
    <legend>{label}</legend>
    <label>시작일<input name={`${phase}Start`} type="date" min="1900-01-01" max="9999-12-31" defaultValue={values.start} required /></label>
    <label>종료일<input name={`${phase}End`} type="date" min="1900-01-01" max="9999-12-31" defaultValue={values.end} required /></label>
    <label>비교한 영업일 수<input name={`${phase}Days`} type="number" min="1" step="1" defaultValue={values?.days} required /></label>
    <label>매출 합계 (원)<input name={`${phase}Amount`} type="number" min="0" step="1" max={Number.MAX_SAFE_INTEGER} defaultValue={values.amount} /></label>
    <label>결제 건수 합계<input name={`${phase}Count`} type="number" min="0" step="1" max={Number.MAX_SAFE_INTEGER} defaultValue={values?.count} /></label>
  </fieldset>
}

function getPeriod(fields: FormData, phase: 'before' | 'after'): SalesPeriod {
  const start = String(fields.get(`${phase}Start`))
  const end = String(fields.get(`${phase}End`))
  const days = Number(fields.get(`${phase}Days`))
  const amount = fields.get(`${phase}Amount`)
  const count = fields.get(`${phase}Count`)
  return { start, end, days, amount: amount ? Number(amount) : undefined, count: count ? Number(count) : undefined }
}

function localMetric(before: number | undefined, after: number | undefined, result: SalesResult): ResultMetric | undefined {
  if (before === undefined || after === undefined) return undefined
  const beforeDailyAverage = before / result.before.days
  const afterDailyAverage = after / result.after.days
  return { beforeDailyAverage, afterDailyAverage, changeRatePercent: changeRate(beforeDailyAverage, afterDailyAverage) }
}

function metricSummary(name: string, metric: ResultMetric) {
  const { beforeDailyAverage: before, afterDailyAverage: after } = metric
  const direction = after > before ? '늘었어요' : after < before ? '줄었어요' : '같았어요'
  return `하루 평균 ${name}${name === '매출' ? '이' : '가'} ${direction}.`
}

function SalesResults({ plan, onChange, auth }: { plan: Plan; onChange: (plan: Plan) => void; auth?: string }) {
  const planId = plan.id
  const [savedResult, setSavedResult] = useState<SavedSalesResult | null>()
  const [loadError, setLoadError] = useState('')
  const [reload, setReload] = useState(0)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pending, setPending] = useState<'save' | 'delete'>()
  const [error, setError] = useState('')

  useEffect(() => {
    if (!auth || !planId) return
    const controller = new AbortController()
    fetchSalesResult(auth, planId, controller.signal).then((value) => {
      if (!controller.signal.aborted) setSavedResult(value)
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setLoadError(error.message)
    })
    return () => controller.abort()
  }, [auth, planId, reload])

  const showSample = !planId && plan.demo && plan.strategy === 'promotion' && plan.duration === '2주' && plan.timeLabel === '오후 2~5시' && !plan.salesResult
  const result = planId ? savedResult : plan.salesResult ?? (showSample ? sample : undefined)
  const scope = plan.reviewAction ? '오후 2~5시'
    : plan.strategy === 'promotion' ? plan.timeLabel || '사장님이 정한 행사 시간대'
    : '같은 영업 시간대'
  const defaultScope = `같은 요일 · ${scope}`
  const activeFrom = plan.tasks[plan.strategy === 'promotion' ? 1 : 2]?.date ?? plan.startDate
  const shift = -Number.parseInt(plan.duration, 10) * 7
  const defaults = {
    before: { start: addDays(activeFrom, shift), end: addDays(plan.endDate, shift) },
    after: { start: activeFrom, end: plan.endDate },
  }
  const sales = planId ? savedResult?.comparison.amount : result && localMetric(result.before.amount, result.after.amount, result)
  const count = planId ? savedResult?.comparison.count : result && localMetric(result.before.count, result.after.count, result)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const fields = new FormData(event.currentTarget)
    const before = getPeriod(fields, 'before')
    const after = getPeriod(fields, 'after')
    if ([before, after].some(({ start, end, days }) => {
      const calendarDays = (Date.parse(end) - Date.parse(start)) / 86_400_000 + 1
      return !Number.isInteger(days) || days < 1 || !(days <= calendarDays)
    })) {
      setError('시작일·종료일과 기간 안의 영업일 수를 확인해 주세요.')
      return
    }
    if (before.end >= after.start) {
      setError('실행 전 기간이 끝난 뒤에 실행 기간이 시작되도록 입력해 주세요.')
      return
    }
    if ((before.amount === undefined) !== (after.amount === undefined)
      || (before.count === undefined) !== (after.count === undefined)) {
      setError('비교할 항목의 합계는 두 기간 모두 입력해 주세요.')
      return
    }
    if (before.amount === undefined && before.count === undefined) {
      setError('매출 또는 결제 건수 중 하나 이상 입력해 주세요.')
      return
    }
    setPending('save')
    setError('')
    try {
      if (auth && planId) {
        const saved = await saveSalesResult(auth, planId, {
          before, after, scope: String(fields.get('scope')).trim(),
        }, savedResult?.id)
        setSavedResult(saved)
      } else {
        onChange({ ...plan, salesResult: { before, after } })
      }
      setEditing(false)
    } catch (error) {
      setError(error instanceof Error ? error.message : '실행 결과를 저장할 수 없어요.')
    } finally {
      setPending(undefined)
    }
  }

  async function remove() {
    if (!auth || !planId || !savedResult || pending) return
    setPending('delete')
    setError('')
    try {
      await deleteSalesResult(auth, planId, savedResult.id)
      setConfirmDelete(false)
      setSavedResult(undefined)
      setReload((value) => value + 1)
    } catch (error) {
      setError(error instanceof Error ? error.message : '실행 결과를 삭제할 수 없어요.')
    } finally {
      setPending(undefined)
    }
  }

  const loading = !!planId && savedResult === undefined
  const showForm = !loading && (editing || !result)
  return <>
    <PageTitle title="실행 결과 확인" detail={`${plan.store}${showSample ? ' · 시연용 가상 결과' : ''}`} />
    <ResultSummary plan={plan} detail={savedResult?.scope ?? defaultScope} />
    {(plan.strategy === 'promotion' || (plan.marketing && plan.promotionDraft)) && auth && planId &&
      <PromotionImpactPanel key={planId} auth={auth} planId={planId} review={plan.promotionReview} />}
    {loading && <section className="empty-state compact">
      {loadError ? <>
        <p role="alert" className="error">{loadError}</p>
        <button type="button" className="button secondary" onClick={() => {
          setLoadError('')
          setReload((value) => value + 1)
        }}>다시 불러오기</button>
      </> : <p role="status">저장한 실행 결과를 불러오는 중이에요.</p>}
    </section>}
    {result && <div className="split planning results-layout">
      <div className="form-stack">
        {count && <ResultChart title="하루 평균 결제 건수" metric={count} format={(value) => `${averageCount(value)}건`} />}
        {sales && <ResultChart title="하루 평균 매출" metric={sales} format={won} />}
        <p className="muted result-method">기간 합계를 영업일 수로 나눴어요. 변화율은 반올림 전 평균으로 계산했어요.</p>
      </div>
      <aside className="form-stack results-aside">
        <section className="result-basis">
          <div className="ruled"><h2>비교 기준</h2></div>
          <p><span className="badge">실행 전</span> {periodLabel(result.before.start, result.before.end)} · {formatNumber(result.before.days)}영업일</p>
          <p><span className="badge">실행 기간</span> {periodLabel(result.after.start, result.after.end)} · {formatNumber(result.after.days)}영업일</p>
        </section>
        <section className="receipt">
          <div className="section-top"><h2>짝꿍의 한눈 요약</h2><Citrus stamp /></div>
          <p>{[sales && metricSummary('매출', sales), count && metricSummary('결제 건수', count)].filter(Boolean).join(' ')}</p>
          <p className="muted">{showSample ? '비교 방법을 보여주는 가상 수치예요.' : '입력한 두 기간의 하루 평균을 비교했어요.'}</p>
        </section>
        {!editing && !confirmDelete && <button type="button" className="button secondary full" onClick={() => setEditing(true)}>{showSample ? '내 결과 입력하기' : '결과 자료 수정하기'}</button>}
        {savedResult && !editing && !confirmDelete && <button type="button" className="button secondary full" onClick={() => {
          setError('')
          setConfirmDelete(true)
        }}>결과 삭제하기</button>}
        {confirmDelete && <section className="receipt">
          <p>저장한 결과를 삭제할까요?</p>
          <div className="result-form-actions">
            <button type="button" className="button primary" disabled={!!pending} onClick={() => void remove()}>{pending === 'delete' ? '삭제 중…' : '삭제 확인'}</button>
            <button type="button" className="button secondary" disabled={!!pending} onClick={() => { setConfirmDelete(false); setError('') }}>취소</button>
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </section>}
      </aside>
    </div>}
    {showForm && <form className="receipt result-form" onSubmit={save}>
      <div className="section-top"><h2>비교할 매출·결제 건수 입력</h2><Citrus stamp /></div>
      <p>두 기간에서 같은 요일과 시간대의 영업일을 골라 주세요. 매출과 결제 건수 중 비교할 항목만 입력하면 돼요.</p>
      {planId && <label>공통 비교 기준<input name="scope" required maxLength={100} defaultValue={savedResult?.scope ?? defaultScope} /></label>}
      <div className="result-form-grid">
        <ResultFields phase="before" label="실행 전" values={(showSample ? undefined : result?.before) ?? defaults.before} />
        <ResultFields phase="after" label="실행 기간" values={(showSample ? undefined : result?.after) ?? defaults.after} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="result-form-actions">
        <button type="submit" className="button primary" disabled={!!pending}>{pending === 'save' ? '저장 중…' : savedResult ? '수정 내용 저장' : '전후 결과 비교하기'}</button>
        {result && <button type="button" className="button secondary" disabled={!!pending} onClick={() => { setEditing(false); setError('') }}>취소</button>}
      </div>
    </form>}
  </>
}


function ResultSummary({ plan, detail }: { plan: Plan; detail: string }) {
  return <section className="receipt summary-strip results-summary" aria-label="실행 결과 기준">
    <Citrus stamp />
    <strong>{plan.title}</strong>
    <span>{detail}</span>
  </section>
}

function InventoryResults({ plan, onChange, embedded, executionTo }: {
  plan: Plan
  onChange: (plan: Plan) => void
  embedded?: boolean
  executionTo: string
}) {
  const items = plan.inventoryItems ?? []
  const remainingFor = (id: string, unit: string) => {
    const measurement = plan.remainingStock?.[id]
    return measurement?.unit === unit.trim() ? measurement.quantity : ''
  }
  const recorded = items.filter((item) => {
    const value = remainingFor(item.id, item.unit)
    return item.name.trim() && item.unit.trim() && parseQuantity(item.finalOrder) !== null && parseQuantity(value) !== null
  }).length
  const display = (value: string, unit: string) => {
    const quantity = parseQuantity(value)
    return quantity === null ? '미입력' : `${formatQuantity(quantity / 1000)} ${unit}`
  }

  return <>
    {!embedded && <>
      <PageTitle title="실행 결과 확인" detail={plan.store} />
      <ResultSummary plan={plan} detail={periodLabel(plan.startDate, plan.endDate)} />
    </>}
    <section className="inventory-results">
      <div className="section-top ruled"><h2>품목별 발주 결과</h2><span className="badge" aria-live="polite">{recorded} / {items.length}품목 기록</span></div>
      {items.length ? <>
        <p className="result-method">발주 검토표에서 정한 수량을 확인하고, 실행 기간이 끝났을 때 남은 재고를 같은 단위로 기록해 주세요.</p>
        <ul>
          {items.map((item, index) => {
            const remaining = remainingFor(item.id, item.unit)
            return <li className="receipt" key={item.id}>
              <h3>{item.name.trim() || `품목 ${index + 1}`}</h3>
              <dl><div><dt>검토 당시 재고</dt><dd>{display(item.stock, item.unit)}</dd></div><div><dt>최종 발주량</dt><dd>{display(item.finalOrder, item.unit)}</dd></div></dl>
              <label>실행 후 남은 재고{item.unit.trim() && ` (${item.unit.trim()})`}
                <input type="number" min="0" max="1000000000" step="0.001" inputMode="decimal" value={remaining}
                  aria-invalid={remaining !== '' && parseQuantity(remaining) === null}
                  onChange={(event) => onChange({
                    ...plan,
                    remainingStock: { ...plan.remainingStock, [item.id]: { unit: item.unit.trim(), quantity: event.target.value } },
                  })} />
              </label>
            </li>
          })}
        </ul>
      </> : <div className="empty-state compact"><p>실행 관리에서 발주를 검토한 품목을 먼저 추가해 주세요.</p></div>}
    </section>
    {!embedded && <ResultFooter to={executionTo} />}
  </>
}

function ResultFooter({ to }: { to: string }) {
  return <div className="form-footer"><Link className="button secondary" to={to}>← 실행 관리로 돌아가기</Link></div>
}

export function Results({ plan, onChange, auth, executionTo }: {
  plan: Plan
  onChange: (plan: Plan) => void
  auth?: string
  executionTo: string
}) {
  if (plan.strategy === 'inventory' && !plan.id) return <InventoryResults plan={plan} onChange={onChange} executionTo={executionTo} />

  return <>
    <SalesResults plan={plan} onChange={onChange} auth={auth} />
    {plan.strategy === 'inventory' && <InventoryResults plan={plan} onChange={onChange} executionTo={executionTo} embedded />}
    <ResultFooter to={executionTo} />
  </>
}
