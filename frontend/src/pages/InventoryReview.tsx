import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { fetchInventoryEstimates, fetchMenuCost, fetchInventoryWeather, saveInventoryEstimate, saveInventoryEstimateNote,
  type InventoryDemandEstimate, type InventoryEstimateComparison,
  type InventoryEstimateNote, type MenuCost, type InventoryWeather } from '../api/shop'
import { formatQuantity, parseQuantity, preparationFor } from '../data/inventory'
import { actualSeoulDate, posLibraryPath, seoulDate } from '../data/promotionArchive'
import { addDays, formatNumber, monthLabel, won } from '../data/shop'
import type { Analysis, InventoryItem } from '../data/shop'


const koreaTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' })
const coverageRate = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 1 })
type ForecastSelection = { date: string; product: string; excludedDates?: string[] }

function ForecastMenuPicker({ menus, value, disabled, onChange }: {
  menus: string[]
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const hasMenus = menus.length > 0
  const manual = editing || !hasMenus || Boolean(value && !menus.includes(value))

  useEffect(() => {
    if (!open) return
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  function select(name: string) {
    setOpen(false)
    setEditing(false)
    if (name !== value) onChange(name)
    trigger.current?.focus()
  }

  return <div ref={root} className="inventory-menu-picker"
    onBlur={event => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false)
    }}
    onKeyDown={event => {
      if (event.key !== 'Escape' || !open) return
      event.preventDefault()
      setOpen(false)
      trigger.current?.focus()
    }}>
    <label id={`${id}-label`} htmlFor={`${id}-${hasMenus ? 'picker' : 'input'}`}>판매량을 예상할 메뉴</label>
    {hasMenus && <div>
      <button type="button" id={`${id}-picker`} ref={trigger} className="inventory-menu-trigger"
        aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open && !disabled} aria-controls={`${id}-options`}
        disabled={disabled} onClick={() => setOpen(current => !current)}>
        <span id={`${id}-value`}>{manual ? '목록에서 메뉴 선택' : value || '메뉴 선택'}</span>
        <span aria-hidden="true">▾</span>
      </button>
      <ul id={`${id}-options`} className="inventory-menu-options" hidden={!open || disabled}>
        {menus.map(name => <li key={name}>
          <button type="button" aria-pressed={!manual && name === value} onClick={() => select(name)}>{name}</button>
        </li>)}
        <li><button type="button" onClick={() => {
          setEditing(true)
          setOpen(false)
          requestAnimationFrame(() => input.current?.focus())
        }}>직접 입력</button></li>
        {value && <li><button type="button" onClick={() => select('')}>메뉴 선택 안 함</button></li>}
      </ul>
    </div>}
    {manual && <input ref={input} id={`${id}-input`} value={value} maxLength={255} placeholder="POS에 적힌 메뉴 이름"
      aria-label={hasMenus ? 'POS 메뉴 이름 직접 입력' : undefined} disabled={disabled}
      onChange={event => { setEditing(true); onChange(event.target.value) }} />}
  </div>
}

function InventoryForecast({ auth, planId, analysisId, storeId, initialLookup, date, onDate, menus, productName, posReference, onProduct, onEstimate }: {
  auth: string
  planId: string
  analysisId?: string
  storeId?: string
  initialLookup?: ForecastSelection
  date: string
  onDate: (date: string) => void
  menus: string[]
  productName: string
  posReference: ReactNode
  onProduct: (product: string) => void
  onEstimate: (estimate: InventoryDemandEstimate | null) => void
}) {
  const [reference, setReference] = useState<InventoryWeather>()
  const [lookup, setLookup] = useState(initialLookup)
  const [loading, setLoading] = useState(Boolean(initialLookup))
  const [error, setError] = useState('')
  const [comparisons, setComparisons] = useState<InventoryEstimateComparison[]>()
  const [comparisonError, setComparisonError] = useState('')
  const [comparisonRevision, setComparisonRevision] = useState(0)
  const [savingEstimate, setSavingEstimate] = useState(false)
  const [estimateSaved, setEstimateSaved] = useState(false)
  const pastDate = Boolean(date && date < actualSeoulDate())

  function clear() {
    setReference(undefined)
    onEstimate(null)
    setError('')
    setEstimateSaved(false)
  }

  useEffect(() => {
    const controller = new AbortController()
    fetchInventoryEstimates(auth, planId, controller.signal).then(saved => {
      if (!controller.signal.aborted) {
        setComparisons(saved)
        setComparisonError('')
      }
    }).catch(failure => {
      if (!controller.signal.aborted) setComparisonError(failure instanceof Error ? failure.message : '저장한 예상 판매량을 확인할 수 없어요.')
    })
    return () => controller.abort()
  }, [auth, planId, comparisonRevision])

  async function saveEstimate() {
    const estimate = reference?.estimate
    if (!reference || !estimate || estimate.low === null || estimate.high === null || estimate.basis === 'INSUFFICIENT') return
    setSavingEstimate(true)
    setComparisonError('')
    try {
      await saveInventoryEstimate(auth, planId, {
        date: reference.date, product: estimate.product, low: estimate.low, high: estimate.high, basis: estimate.basis,
        excludedDates: estimate.excludedDates,
        originalBounds: estimate.originalBounds,
      })
      setEstimateSaved(true)
      setComparisonRevision(value => value + 1)
    } catch (failure) {
      setComparisonError(failure instanceof Error ? failure.message : '저장한 예상 판매량을 확인할 수 없어요.')
    } finally {
      setSavingEstimate(false)
    }
  }

  async function saveNote(input: InventoryEstimateNote) {
    const saved = await saveInventoryEstimateNote(auth, planId, input)
    setComparisons(current => current?.map(row => row.estimate.date === saved.date && row.estimate.product === saved.product
      ? { ...row, note: saved.note } : row))
    setComparisonRevision(value => value + 1)
    return saved.note
  }

  useEffect(() => {
    if (!lookup) return
    const controller = new AbortController()
    fetchInventoryWeather(auth, planId, lookup.date, lookup.product, lookup.excludedDates ?? [], controller.signal)
      .then(next => {
        if (controller.signal.aborted) return
        setReference(next)
        onEstimate(next.estimate)
      }).catch(failure => {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : '예보를 불러오지 못했어요.')
      }).finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [auth, planId, lookup, onEstimate])

  const forecast = reference?.forecast
  const estimate = reference?.estimate
  const productComparisons = comparisons?.filter(row => !productName.trim() || row.estimate.product === productName.trim()) ?? []
  const canSaveEstimate = estimate && estimate.low !== null && estimate.high !== null
  const required = estimate?.requiredPos
  const alreadySaved = comparisons?.some(row => row.currentPlan && row.estimate.date === reference?.date && row.estimate.product === estimate?.product)
  const menuNames = [...new Set([...menus, ...(comparisons?.map(row => row.estimate.product) ?? [])])]
  const uploadTo = required && reference && storeId && analysisId && productName.trim()
    ? posLibraryPath(storeId, { date: required.end, kind: required.kind, upload: {
      missingStart: required.start, inventory: { planId, analysisId, date: reference.date, product: productName.trim() },
    } })
    : undefined

  function recalculate(excludedDates: string[]) {
    if (loading || savingEstimate) return
    setError('')
    setLoading(true)
    setLookup({ date, product: productName.trim(), excludedDates })
  }

  return <section className="inventory-forecast-panel form-stack" aria-label="판매량 예상">
    <h3><span className="inventory-step-number" aria-hidden="true">1</span> 판매량 예상</h3>
    <label>날씨를 확인할 날짜
      <input type="date" value={date} disabled={loading || savingEstimate} onChange={event => {
        onDate(event.target.value)
        clear()
      }} />
    </label>
    <ForecastMenuPicker menus={menuNames} value={productName} disabled={loading || savingEstimate}
      onChange={value => { onProduct(value); clear() }} />
    {pastDate && !productName.trim() && <small className="muted">과거 관측과 판매량을 비교할 메뉴를 선택해 주세요.</small>}
    <button type="button" className="button secondary small" disabled={loading || savingEstimate || !date || (pastDate && !productName.trim())} onClick={() => {
      clear()
      setLoading(true)
      setLookup({ date, product: productName.trim() })
    }}>
      {loading ? '기상청과 POS 자료 확인 중…' : productName.trim() || pastDate ? '예상 판매량 보기' : '기상청 예보 보기'}
    </button>
    {reference && <div role="status">
      <strong>{reference.area} · {reference.date}</strong>
      {forecast ? <>
        <p>{forecast.label}
          {forecast.maxPrecipitationProbability !== null && ` · 최고 강수확률 ${forecast.maxPrecipitationProbability}%`}
          {forecast.minTemperature !== null && forecast.maxTemperature !== null && ` · 예보 기온 ${forecast.minTemperature}~${forecast.maxTemperature}°C`}
        </p>
        <small className="muted">{koreaTime.format(new Date(forecast.issuedAt))} 발표
          {reference.sourceUrl && <> · <a href={reference.sourceUrl} target="_blank" rel="noopener noreferrer">기상청 단기예보 출처</a></>}
        </small>
      </> : !reference.estimate?.historical && <p className="muted">선택한 날짜의 기상청 단기예보를 확인할 수 없어요.</p>}
    </div>}
    {estimate && <DemandEstimate estimate={estimate} uploadTo={uploadTo} notes={comparisons ?? []}
      posReference={posReference} pendingExclusions={loading ? lookup?.excludedDates : undefined}
      disabled={loading || savingEstimate} onExclusions={recalculate} />}
    {error && <p role="alert" className="error">{error}</p>}
    {comparisonError && <div role="alert" className="error">{comparisonError}{' '}
      <button type="button" className="text-button" onClick={() => setComparisonRevision(value => value + 1)}>저장한 범위 다시 불러오기</button>
    </div>}
    {(canSaveEstimate || productComparisons.length > 0) && <details className="inventory-secondary">
      <summary>예상 이력 관리{productComparisons.length > 0 && ` · ${productComparisons.length}건`}</summary>
      <div className="form-stack">
        {canSaveEstimate && (alreadySaved || estimateSaved
          ? <p role="status" className="muted">이 계획에 저장한 예상 범위예요.</p>
          : <>
            <p className="muted">이 범위를 기록해 두면 실제 판매량과 비교할 수 있어요.</p>
            <button type="button" className="button secondary small" disabled={loading || savingEstimate}
              onClick={() => void saveEstimate()}>{savingEstimate ? '저장 중…' : '예상 범위 저장'}</button>
          </>)}
        {productComparisons.length > 0 && <SavedEstimateComparisons rows={productComparisons}
          product={productName.trim() || productComparisons[0]?.estimate.product}
          storeId={storeId} planId={planId} analysisId={analysisId} onSaveNote={saveNote} />}
      </div>
    </details>}
  </section>
}

const comparisonLabels = {
  PENDING_DATE: '대상일이 지난 뒤 확인할 수 있어요.',
  POS_REQUIRED: '이날의 상품 주문 POS가 필요해요.',
  WITHIN_RANGE: '예상 범위 안',
  BELOW_RANGE: '예상 범위보다 적음',
  ABOVE_RANGE: '예상 범위보다 많음',
}

const nextOrderChecks = {
  ABOVE_RANGE: '행사나 단체 주문이 있었는지 확인해 보세요. 비슷한 요일과 날씨에도 상한을 넘겼다면 현재 재고와 입고 예정량을 보고 준비량을 검토해 보세요.',
  BELOW_RANGE: '품절이나 단축 영업이 있었는지 확인해 보세요. 비슷한 요일과 날씨에도 하한보다 적게 팔렸다면 남은 재고와 폐기량을 확인해 보세요.',
}

function SavedEstimateComparisons({ rows, product, storeId, planId, analysisId, onSaveNote }: {
  rows: InventoryEstimateComparison[]
  product?: string
  storeId?: string
  planId: string
  analysisId?: string
  onSaveNote: (input: InventoryEstimateNote) => Promise<string>
}) {
  const byDate = new Map<string, InventoryEstimateComparison>()
  const additional = new Map<string, InventoryEstimateComparison>()
  for (const row of rows) {
    const { date, low, high } = row.estimate
    if (row.estimate.product !== product) continue
    const first = byDate.get(date)
    if (!first) byDate.set(date, row)
    else if (row.currentPlan && (first.estimate.low !== low || first.estimate.high !== high
      || first.originalBounds?.low !== row.originalBounds?.low || first.originalBounds?.high !== row.originalBounds?.high
      || (first.excludedDates ?? []).join() !== (row.excludedDates ?? []).join())) additional.set(date, row)
  }
  const daily = [...byDate.values()]
  const compared = daily.filter(row => row.actualSales !== null)
  const within = compared.filter(row => row.status === 'WITHIN_RANGE').length
  const latestMiss = compared.find(row => row.status === 'ABOVE_RANGE' || row.status === 'BELOW_RANGE')
  const nextOrderCheck = latestMiss?.status === 'ABOVE_RANGE' || latestMiss?.status === 'BELOW_RANGE'
    ? nextOrderChecks[latestMiss.status] : undefined

  return <section className="inventory-history form-stack" aria-label="지난 예상과 실제 판매량">
    <h4>{product ? `${product} · 지난 예상과 실제 판매량` : '지난 예상과 실제 판매량'}</h4>
    {daily.length ? <>
      <div className="inventory-history-rate">
        <span>예상 범위에 든 비율</span>
        {compared.length ? <><strong>{coverageRate.format(within / compared.length)}</strong>
          <span>판매량을 확인한 {formatNumber(compared.length)}일 중 {formatNumber(within)}일</span></>
          : <strong>비교할 POS 자료가 아직 없어요.</strong>}
      </div>
      <small className="muted">이 매장의 메뉴별 기록이에요. 같은 날짜는 처음 저장한 예상으로 한 번만 비교해요.</small>
      <table className="input-table inventory-history-table" aria-label={`${product} 날짜별 예상과 판매량`}>
        <thead><tr><th scope="col">날짜</th><th scope="col">예상 범위</th><th scope="col">실제 판매량</th><th scope="col">결과</th></tr></thead>
        <tbody>{daily.flatMap(first => {
          const later = additional.get(first.estimate.date)
          return (later ? [first, later] : [first]).map(({ estimate, actualSales, status, note, excludedDates, originalBounds }, index) => {
            const originalLow = originalBounds?.low
            const originalHigh = originalBounds?.high
            const hasOriginal = originalLow != null && originalHigh != null
            const difference = actualSales === null ? null : status === 'ABOVE_RANGE'
              ? `상한보다 ${formatNumber(actualSales - estimate.high)}개 더 팔렸어요.`
              : status === 'BELOW_RANGE' ? `하한보다 ${formatNumber(estimate.low - actualSales)}개 덜 팔렸어요.` : null
            return <tr key={`${estimate.date}-${index}`}>
              <th scope="row"><time dateTime={estimate.date}>{estimate.date}</time>
                {index > 0 && <small className="muted">이 계획에서 저장</small>}
              </th>
              <td>{hasOriginal && <div>제외 전 <strong>{formatNumber(originalLow)}~{formatNumber(originalHigh)}개</strong></div>}
                {hasOriginal && '제외 후 '}{formatNumber(estimate.low)}~{formatNumber(estimate.high)}개
                {!!excludedDates?.length && <small className="muted">제외 · {excludedDates.join(', ')}</small>}
              </td>
              <td>{actualSales === null ? '—' : `${formatNumber(actualSales)}개`}</td>
              <td>{hasOriginal && actualSales !== null
                ? <ExclusionOutcome actual={actualSales} before={{ low: originalLow, high: originalHigh }} after={estimate} />
                : <strong data-status={status}>{comparisonLabels[status]}</strong>}
                {difference && <small className="inventory-history-gap">{difference}</small>}
                {index === 0 && note && <small><strong>확인 메모</strong> {note}</small>}
                {index === 0 && status === 'POS_REQUIRED' && storeId && analysisId && <Link className="text-button"
                  to={posLibraryPath(storeId, { date: estimate.date, kind: 'PRODUCT', upload: {
                    missingStart: estimate.date,
                    inventory: { planId, analysisId, date: estimate.date, product: estimate.product },
                  } })}>이날 상품 주문 POS 올리기</Link>}
              </td>
            </tr>
          })
        })}</tbody>
      </table>
      {latestMiss && nextOrderCheck && <div className="inventory-history-check">
        <h5>다음 발주 전에 확인할 것</h5>
        <p><time dateTime={latestMiss.estimate.date}>{latestMiss.estimate.date}</time> 판매 기록 · {nextOrderCheck}</p>
        <InventoryEstimateNoteForm key={JSON.stringify([latestMiss.estimate.product, latestMiss.estimate.date])}
          comparison={latestMiss} onSave={onSaveNote} />
      </div>}
    </> : <p className="muted">저장한 예상 범위가 아직 없어요.</p>}
  </section>
}

function ExclusionOutcome({ actual, before, after }: {
  actual: number
  before: { low: number; high: number }
  after: { low: number; high: number }
}) {
  const beforeGap = Math.max(before.low - actual, actual - before.high, 0)
  const afterGap = Math.max(after.low - actual, actual - after.high, 0)
  const outcome = beforeGap < afterGap ? '제외 전 범위가 더 가까워요.'
    : afterGap < beforeGap ? '제외 후 범위가 더 가까워요.'
      : beforeGap === 0 ? '두 범위에 모두 들어요.' : '두 범위와의 차이가 같아요.'
  return <>
    <strong>{outcome}</strong>
    <small>제외 전 {beforeGap === 0 ? '범위 안' : `범위 밖 ${formatNumber(beforeGap)}개`}<br />
      제외 후 {afterGap === 0 ? '범위 안' : `범위 밖 ${formatNumber(afterGap)}개`}</small>
  </>
}

function InventoryEstimateNoteForm({ comparison, onSave }: {
  comparison: InventoryEstimateComparison
  onSave: (input: InventoryEstimateNote) => Promise<string>
}) {
  const [note, setNote] = useState(comparison.note ?? '')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ text: string; error?: boolean }>()
  const { date, product } = comparison.estimate
  const placeholder = comparison.status === 'ABOVE_RANGE' ? '예: 점심에 단체 주문이 있었어요' : '예: 오후에 고기국수가 품절됐어요'

  return <form className="inventory-history-note form-stack" onSubmit={async event => {
    event.preventDefault()
    const trimmed = note.trim()
    if (saving || !trimmed || trimmed === comparison.note) return
    setSaving(true)
    setFeedback(undefined)
    try {
      setNote(await onSave({ date, product, note: trimmed }))
      setFeedback({ text: '확인 메모를 저장했어요.' })
    } catch (failure) {
      setFeedback({ text: failure instanceof Error ? failure.message : '확인 메모를 저장하지 못했어요.', error: true })
    } finally {
      setSaving(false)
    }
  }}>
    <label>확인한 내용 한 줄
      <input value={note} maxLength={200} placeholder={placeholder} disabled={saving} onChange={event => {
        setNote(event.target.value)
        setFeedback(undefined)
      }} />
    </label>
    <button type="submit" className="button secondary small" disabled={saving || !note.trim() || note.trim() === comparison.note}>
      {saving ? '저장 중…' : '확인 메모 저장'}
    </button>
    {feedback && <p role={feedback.error ? 'alert' : 'status'} className={feedback.error ? 'error' : undefined}>{feedback.text}</p>}
  </form>
}

const recipeKey = (name: string, unit: string) => JSON.stringify([name.trim(), unit.trim()])

function emptyItem(name = '', unit = ''): InventoryItem {
  return { id: crypto.randomUUID(), name, unit, stock: '', expectedUse: '', incoming: '', finalOrder: '' }
}

function DemandEstimate({ estimate, uploadTo, notes, posReference, pendingExclusions, disabled, onExclusions }: {
  estimate: InventoryDemandEstimate
  uploadTo?: string
  notes: InventoryEstimateComparison[]
  posReference: ReactNode
  pendingExclusions?: string[]
  disabled: boolean
  onExclusions: (dates: string[]) => void
}) {
  const { product, historical, actualSales, basis, low, high, samples, station, observationSourceUrl,
    observedRainfallMm, precipitation, requiredPos, candidates, excludedDates, originalBounds } = estimate
  const usedDates = new Set(samples.map(sample => sample.date))
  const selectedExclusions = pendingExclusions ?? excludedDates
  const notesByDate = new Map(notes.filter(row => row.estimate.product === product).map(row => [row.estimate.date, row.note]))
  return <div className="form-stack">
    {historical && <p className="muted">과거 발주 시나리오 · 이전 판매 기록과 당시 날씨로 비교해요.</p>}
    {historical && precipitation !== null && <p>선택한 날짜 · {precipitation ? '강수 관측됨' : '강수 기록 없음'}
      {observedRainfallMm !== null && ` · 관측 강수량 ${observedRainfallMm}mm`}
    </p>}
    {low === null || high === null
      ? <div className="form-stack">
        <p>이 메뉴의 판매량을 예상할 자료가 부족해요.</p>
        {requiredPos ? <>
          <p><strong>필요한 파일 · 상품 주문 CSV</strong><br />
            <strong>비교할 기간 · {requiredPos.start} ~ {requiredPos.end}</strong></p>
          <p className="muted">이 기간에 선택한 날짜와 같은 요일의 영업 기록이 최소 {requiredPos.minimumDays}일 필요해요.
            {samples.length > 0 && ` 지금 ${samples.length}일을 확인했어요.`}</p>
          {uploadTo && <Link className="button secondary small" to={uploadTo}>상품 주문 POS 올리기</Link>}
        </> : excludedDates.length ? <p className="muted">제외한 날짜를 다시 포함해 비교할 판매 기록을 확보해 주세요.</p>
          : <p className="muted">자료가 있는 날짜를 선택해 다시 확인해 주세요.</p>}
      </div>
      : <>
        <div className="inventory-demand-result">
          <span>{product} 예상 판매량</span>
          <strong>{formatNumber(low)}~{formatNumber(high)}<small>개</small></strong>
        </div>
        <p className="muted">{basis === 'WEATHER'
          ? `같은 요일에 강수 여부가 같았던 ${samples.length}일의 판매 범위예요.`
          : historical && precipitation === null
            ? `기상청 강수 관측을 확인할 수 없어 같은 요일 ${samples.length}일의 판매 범위를 참고했어요. 위의 예상 판매량 보기를 눌러 다시 조회할 수 있어요.`
            : `날씨까지 같은 비교일이 부족해 같은 요일 ${samples.length}일의 판매 범위를 참고했어요.`}</p>
        <p className="muted">내 매장에 저장한 재료 사용량으로 추가 준비량을 계산해요.</p>
      </>}
    {originalBounds && originalBounds.low !== null && originalBounds.high !== null && <p className="muted">
      제외 전 {formatNumber(originalBounds.low)}~{formatNumber(originalBounds.high)}개 → 제외 후 {low === null || high === null
        ? '자료 부족' : `${formatNumber(low)}~${formatNumber(high)}개`}
    </p>}
    {historical && actualSales !== null && <p>선택한 날짜의 실제 POS 판매량 {formatNumber(actualSales)}개</p>}
    <details className="inventory-secondary inventory-evidence">
      <summary>계산 근거 보기</summary>
      <div className="form-stack">
    {observationSourceUrl && <small className="muted">
      {station} 관측소 · <a href={observationSourceUrl} target="_blank" rel="noopener noreferrer">기상청 과거 관측 출처</a>
    </small>}
    {candidates.length > 0 && <details className="inventory-comparison-days">
      <summary>비교할 POS 날짜 선택{selectedExclusions.length > 0 && ` · ${selectedExclusions.length}일 제외`}</summary>
      <ul>{candidates.map(sample => {
        const excluded = selectedExclusions.includes(sample.date)
        return <li key={sample.date}>
          <span>{sample.date} · {formatNumber(sample.quantity)}개
            {sample.precipitation !== null && (sample.precipitation ? ' · 강수 관측됨' : ' · 강수 기록 없음')}
            {sample.rainfallMm !== null && ` · 강수량 ${sample.rainfallMm}mm`}
            {!pendingExclusions && !excluded && !usedDates.has(sample.date) && ' · 강수 여부가 달라 미반영'}
          </span>
          {notesByDate.get(sample.date) && <span><strong>확인 메모</strong> {notesByDate.get(sample.date)}</span>}
          <label><input type="checkbox" checked={excluded} disabled={disabled}
            aria-label={`${sample.date} 계산에서 제외`} onChange={event => onExclusions(event.target.checked
              ? [...excludedDates, sample.date] : excludedDates.filter(day => day !== sample.date))} /> 계산에서 제외</label>
        </li>
      })}</ul>
    </details>}
    {posReference}
      </div>
    </details>
  </div>
}

export function InventoryReview({ auth, planId, analysisId, items, analysis, reviewDate, onChange, onSave }: {
  auth?: string
  planId?: string
  analysisId?: string
  items: InventoryItem[]
  analysis: Analysis
  reviewDate: string
  onChange: (items: InventoryItem[]) => void
  onSave?: (items: InventoryItem[]) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [params] = useSearchParams()
  const [initialLookup] = useState<ForecastSelection | undefined>(() => {
    const date = params.get('inventoryDate') ?? ''
    const product = (params.get('inventoryProduct') ?? '').trim()
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && product && product.length <= 255
      ? { date, product } : undefined
  })
  const [productName, setProductName] = useState(initialLookup?.product ?? analysis.productSales?.[0]?.productName ?? '')
  const [date, setDate] = useState(() => {
    const today = seoulDate()
    return initialLookup?.date ?? (reviewDate < today ? reviewDate : addDays(today, 1))
  })
  const product = productName.trim()
  const [estimate, setEstimate] = useState<InventoryDemandEstimate | null>(null)
  const [stored, setStored] = useState<{ cost: MenuCost; suggested: InventoryItem[] }>()
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [revision, setRevision] = useState(0)
  const range = estimate && estimate.low !== null && estimate.high !== null ? { low: estimate.low, high: estimate.high } : null
  const current = stored?.cost.productName === product ? stored : undefined
  const recipes = current?.cost.ingredients ?? []
  const visibleItems = recipes.map((recipe, index) =>
    items.find(item => recipeKey(item.name, item.unit) === recipeKey(recipe.ingredientName, recipe.unit))
      ?? current!.suggested[index])
  const recipeKeys = new Set(recipes.map(recipe => recipeKey(recipe.ingredientName, recipe.unit)))
  const previousItems = items.filter(item => !recipeKeys.has(recipeKey(item.name, item.unit)))
  const calculations = visibleItems.map((item, index) =>
    range ? preparationFor(item, recipes[index].amount, range.low, range.high) : null)
  const ready = visibleItems.length > 0 && calculations.every(value => value?.shortage != null)
  const recorded = calculations.filter(value => value?.shortage != null).length
  const months = analysis.monthly.slice(-2)
  const storeId = analysis.storeId
  const costParams = storeId ? new URLSearchParams({ storeId, section: 'menu-costs',
    ...(product ? { productName: product } : {}),
    ...(planId && analysisId ? { inventoryPlanId: planId, inventoryAnalysisId: analysisId,
      inventoryDate: date, inventoryProduct: product } : {}),
  }) : undefined
  const costTo = costParams ? '/stores?' + costParams : undefined

  useEffect(() => {
    if (!auth || !storeId || !product || product.length > 255) return
    const controller = new AbortController()
    setLoading(true)
    setLoadError('')
    fetchMenuCost(auth, storeId, product, controller.signal).then(cost => {
      if (!controller.signal.aborted) setStored({ cost,
        suggested: cost.ingredients.map(value => emptyItem(value.ingredientName, value.unit)) })
    }).catch(failure => {
      if (!controller.signal.aborted) {
        setStored(undefined)
        setLoadError(failure instanceof Error ? failure.message : '매장에 저장한 재료를 불러오지 못했어요.')
      }
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [auth, storeId, product, revision])

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  function changeProduct(value: string) {
    setProductName(value)
    setStored(undefined)
    setEstimate(null)
    setLoadError('')
    setMessage('')
    setError('')
  }

  function updateItem(item: InventoryItem, field: 'stock' | 'incoming', value: string) {
    setMessage('')
    setError('')
    onChange([...items.filter(row => recipeKey(row.name, row.unit) !== recipeKey(item.name, item.unit)),
      { ...item, [field]: value, shortage: undefined }])
  }

  async function save() {
    if (!onSave || saving || loading || !ready) return
    const reviewed = visibleItems.map((item, index) => ({ ...item,
      expectedUse: String(calculations[index]!.usage[1]), shortage: undefined }))
    const next = [...previousItems, ...reviewed]
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await onSave(next)
      onChange(next)
      setMessage('발주 검토표를 저장했어요. 예상 사용량은 판매량 범위의 상한으로 기록했어요.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '발주 검토표를 저장할 수 없어요.')
    } finally {
      setSaving(false)
    }
  }

  const posReference = analysis.productSales?.length ? <details className="inventory-pos-reference">
    <summary>POS 품목별 판매량 참고</summary>
    <p className="muted">메뉴 판매량과 재료 사용량의 단위는 다를 수 있어요.</p>
    <table className="input-table" aria-label="발주 검토용 POS 품목별 판매량">
      <thead><tr><th scope="col">상품명</th>
        {months.map(({ month }) => <th scope="col" key={month}>{monthLabel(month)}</th>)}
      </tr></thead>
      <tbody>{analysis.productSales.map(row => <tr key={row.productName}>
        <th scope="row">{row.productName}</th>
        <td>{formatNumber(row.before)}개</td><td>{formatNumber(row.after)}개</td>
      </tr>)}</tbody>
    </table>
  </details> : <p className="muted">이 분석에 저장된 POS 품목별 판매량이 없어요.</p>

  return <section className="execution-material inventory-review">
    <div className="section-top ruled">
      <h2>발주량 검토표</h2>
      <span className="badge" aria-live="polite">{recorded} / {visibleItems.length}품목 기록</span>
    </div>
    <div className="receipt inventory-workspace">
      <p className="muted inventory-review-date">발주 검토 예정일 · {reviewDate.replaceAll('-', '.')}</p>
      <div className="inventory-workspace-grid">
        {auth && planId ? <InventoryForecast auth={auth} planId={planId} analysisId={analysisId}
          storeId={storeId} initialLookup={initialLookup} date={date} onDate={setDate}
          menus={analysis.productSales?.map(row => row.productName) ?? []}
          productName={productName} posReference={posReference} onProduct={changeProduct}
          onEstimate={setEstimate} /> : <div className="inventory-forecast-panel">{posReference}</div>}
        <section className="inventory-preparation form-stack" aria-label="재료별 준비량">
          <div className="section-top">
            <h3><span className="inventory-step-number" aria-hidden="true">2</span> 재료별 준비량</h3>
            {costTo && <Link className="text-button" to={costTo}>내 매장에서 사용량 수정</Link>}
          </div>
          <p className="muted">저장된 한 개당 사용량으로 계산해요. 현재 재고와 입고 예정량만 입력해 주세요. 입고 예정이 없으면 0을 입력해요.</p>
          {current?.cost.costWon != null && <p className="inventory-menu-cost">{product} 한 개당 합산 원가 <strong>{won(current.cost.costWon)}</strong></p>}
          {loading && <p role="status">내 매장의 재료 사용량을 불러오는 중이에요.</p>}
          {loadError && <p role="alert" className="error">{loadError}{' '}
            <button type="button" className="text-button" onClick={() => setRevision(value => value + 1)}>다시 불러오기</button>
          </p>}
          {!loading && !loadError && visibleItems.length === 0 && <div className="inventory-empty">
            <strong>{product ? '이 메뉴의 재료 사용량을 먼저 저장해 주세요.' : '판매량을 예상할 메뉴를 선택해 주세요.'}</strong>
            {costTo && <Link className="button secondary small" to={costTo}>내 매장에서 재료·원가 등록</Link>}
          </div>}
          <fieldset className="inventory-inputs" disabled={saving || loading} aria-label="발주 검토 입력">
            <div className="inventory-rows">
              {visibleItems.map((item, index) => {
                const recipe = recipes[index]
                const calculation = calculations[index]
                return <fieldset key={item.id} className="inventory-row inventory-managed-row">
                  <legend>{item.name} · {item.unit}</legend>
                  <p className="muted">{product} 한 개당 사용량 <strong>{recipe.amount} {item.unit}</strong>
                    {recipe.unitPriceWon != null && <> · {item.unit}당 {won(recipe.unitPriceWon)}</>}</p>
                  <div className="inventory-fields inventory-stock-fields">
                    <label>현재 재고 ({item.unit})<input type="number" inputMode="decimal" min="0" max="1000000000" step="0.001"
                      value={item.stock} aria-invalid={item.stock !== '' && parseQuantity(item.stock) === null}
                      onChange={event => updateItem(item, 'stock', event.target.value)} /></label>
                    <label>입고 예정량 ({item.unit})<input type="number" inputMode="decimal" min="0" max="1000000000" step="0.001"
                      value={item.incoming} aria-invalid={item.incoming !== '' && parseQuantity(item.incoming) === null}
                      onChange={event => updateItem(item, 'incoming', event.target.value)} /></label>
                  </div>
                  {calculation ? <div className="inventory-preparation-result form-stack" aria-live="polite">
                    <p>예상 재료 사용량 <strong>{formatQuantity(calculation.usage[0])}~{formatQuantity(calculation.usage[1])} {item.unit}</strong></p>
                    {calculation.shortage
                      ? <p>추가 준비량 <strong>{formatQuantity(calculation.shortage[0])}~{formatQuantity(calculation.shortage[1])} {item.unit}</strong></p>
                      : <p className="muted">현재 재고와 입고 예정량을 입력하면 추가 준비량이 나와요.</p>}
                  </div> : range
                    ? <p role="alert" className="error">예상 사용량이 계산 범위를 넘어요. 매장 사용량을 확인해 주세요.</p>
                    : <p className="muted">예상 판매량을 조회하면 필요한 재료와 추가 준비량을 계산해요.</p>}
                </fieldset>
              })}
            </div>
          </fieldset>
          {previousItems.length > 0 && <details className="inventory-secondary">
            <summary>이전 검토에 저장한 다른 품목 · {previousItems.length}개</summary>
            <p className="muted">현재 메뉴의 계산에는 포함하지 않아요. 기존 기록은 보존해요.</p>
            <ul>{previousItems.map(item => <li key={item.id}>{item.name} · {item.unit} · 재고 {item.stock || '미입력'} · 입고 예정 {item.incoming || '미입력'}</li>)}</ul>
          </details>}
          {visibleItems.length > 0 && <p className="muted inventory-hint">검토표 저장 시 예상 사용량은 판매량 범위의 상한을 반영해요. 사용량을 수정하러 가기 전 재고 입력은 먼저 저장해 주세요.</p>}
          {onSave && <div className="inventory-save-bar"><button type="button" className="button primary"
            disabled={saving || loading || !ready} onClick={() => void save()}>{saving ? '저장 중…' : '발주 검토표 저장'}</button></div>}
          {message && <p role="status">{message}</p>}
          {error && <p className="error" role="alert">{error}</p>}
        </section>
      </div>
    </div>
  </section>
}
