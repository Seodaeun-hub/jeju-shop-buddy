import { useEffect, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { fetchInventoryEstimates, fetchInventoryRecipes, fetchInventoryWeather, saveInventoryEstimate, saveInventoryEstimateNote,
  saveInventoryRecipe, type InventoryDemandEstimate, type InventoryEstimateComparison,
  type InventoryEstimateNote, type InventoryRecipe, type InventoryWeather } from '../api/shop'
import { formatQuantity, parseQuantity, preparationFor, quantities, shortageOf } from '../data/inventory'
import { posLibraryPath, seoulDate } from '../data/promotionArchive'
import { addDays, formatNumber, monthLabel } from '../data/shop'
import type { Analysis, InventoryItem } from '../data/shop'

import { InventoryImport } from './InventoryImport'

const koreaTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' })
const coverageRate = new Intl.NumberFormat('ko-KR', { style: 'percent', maximumFractionDigits: 1 })
type ForecastSelection = { date: string; product: string; excludedDates?: string[] }

function InventoryForecast({ auth, planId, analysisId, storeId, initialLookup, menus, productName, recipeSaving, onProduct, onEstimate }: {
  auth: string
  planId: string
  analysisId?: string
  storeId?: string
  initialLookup?: ForecastSelection
  menus: string[]
  productName: string
  recipeSaving: boolean
  onProduct: (product: string) => void
  onEstimate: (estimate: InventoryDemandEstimate | null) => void
}) {
  const [date, setDate] = useState(() => initialLookup?.date ?? addDays(seoulDate(), 1))
  const menuOptions = useId()
  const [reference, setReference] = useState<InventoryWeather>()
  const [lookup, setLookup] = useState(initialLookup)
  const [loading, setLoading] = useState(Boolean(initialLookup))
  const [error, setError] = useState('')
  const [comparisons, setComparisons] = useState<InventoryEstimateComparison[]>()
  const [comparisonError, setComparisonError] = useState('')
  const [comparisonRevision, setComparisonRevision] = useState(0)
  const [savingEstimate, setSavingEstimate] = useState(false)
  const [estimateSaved, setEstimateSaved] = useState(false)

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

  return <div className="ruled-block form-stack">
    <h3>날씨로 발주량 살펴보기</h3>
    <label>날씨를 확인할 날짜
      <input type="date" value={date} disabled={loading || savingEstimate} onChange={event => {
        setDate(event.target.value)
        clear()
      }} />
    </label>
    <label>판매량을 예상할 메뉴
      <input list={menuOptions} value={productName} maxLength={255} placeholder="POS에 적힌 메뉴 이름" disabled={loading || recipeSaving || savingEstimate}
        onChange={event => { onProduct(event.target.value); clear() }} />
    </label>
    <datalist id={menuOptions}>{menuNames.map(name => <option value={name} key={name} />)}</datalist>
    <button type="button" className="button secondary small" disabled={loading || savingEstimate || !date} onClick={() => {
      clear()
      setLoading(true)
      setLookup({ date, product: productName.trim() })
    }}>
      {loading ? '기상청과 POS 자료 확인 중…' : productName.trim() ? '예상 판매량 보기' : '기상청 예보 보기'}
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
      pendingExclusions={loading ? lookup?.excludedDates : undefined} disabled={loading || savingEstimate} onExclusions={recalculate} />}
    {estimate && estimate.low !== null && estimate.high !== null && (alreadySaved || estimateSaved
      ? <p role="status" className="muted">이 계획에 저장한 예상 범위는 아래 이력에서 확인할 수 있어요.</p>
      : <button type="button" className="button secondary small" disabled={loading || savingEstimate}
        onClick={() => void saveEstimate()}>{savingEstimate ? '저장 중…' : '예상 범위 저장'}</button>)}
    {error && <p role="alert" className="error">{error}</p>}
    {comparisonError && <div role="alert" className="error">{comparisonError}{' '}
      <button type="button" className="text-button" onClick={() => setComparisonRevision(value => value + 1)}>저장한 범위 다시 불러오기</button>
    </div>}
    {comparisons && <SavedEstimateComparisons rows={comparisons} product={productName.trim() || comparisons[0]?.estimate.product}
      storeId={storeId} planId={planId} analysisId={analysisId} onSaveNote={saveNote} />}
  </div>
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
          return (later ? [first, later] : [first]).map(({ estimate, actualSales, status, note, excludedDates }, index) => {
            const difference = actualSales === null ? null : status === 'ABOVE_RANGE'
              ? `상한보다 ${formatNumber(actualSales - estimate.high)}개 더 팔렸어요.`
              : status === 'BELOW_RANGE' ? `하한보다 ${formatNumber(estimate.low - actualSales)}개 덜 팔렸어요.` : null
            return <tr key={`${estimate.date}-${index}`}>
              <th scope="row"><time dateTime={estimate.date}>{estimate.date}</time>
                {index > 0 && <small className="muted">이 계획에서 저장</small>}
              </th>
              <td>{formatNumber(estimate.low)}~{formatNumber(estimate.high)}개
                {!!excludedDates?.length && <small className="muted">제외 · {excludedDates.join(', ')}</small>}
              </td>
              <td>{actualSales === null ? '—' : `${formatNumber(actualSales)}개`}</td>
              <td><strong data-status={status}>{comparisonLabels[status]}</strong>
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

function DemandEstimate({ estimate, uploadTo, notes, pendingExclusions, disabled, onExclusions }: {
  estimate: InventoryDemandEstimate
  uploadTo?: string
  notes: InventoryEstimateComparison[]
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
    {historical && <p className="muted">과거 날짜 검증 · 선택한 날짜의 판매량은 비교 범위 계산에서 제외했어요.</p>}
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
        <p><strong>{product} 예상 판매량 · {formatNumber(low)}~{formatNumber(high)}개</strong></p>
        <p className="muted">{basis === 'WEATHER'
          ? `같은 요일에 강수 여부가 같았던 ${samples.length}일의 판매 범위예요.`
          : `날씨까지 같은 비교일이 부족해 같은 요일 ${samples.length}일의 판매 범위를 참고했어요.`}</p>
        <p className="muted">아래 발주 품목에서 메뉴 한 개당 재료 사용량을 적으면 준비할 양을 계산해요.</p>
      </>}
    {originalBounds && originalBounds.low !== null && originalBounds.high !== null && <p className="muted">
      제외 전 {formatNumber(originalBounds.low)}~{formatNumber(originalBounds.high)}개 → 제외 후 {low === null || high === null
        ? '자료 부족' : `${formatNumber(low)}~${formatNumber(high)}개`}
    </p>}
    {historical && actualSales !== null && <p>선택한 날짜의 실제 POS 판매량 {formatNumber(actualSales)}개</p>}
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
    {observationSourceUrl && <small className="muted">
      {station} 관측소 · <a href={observationSourceUrl} target="_blank" rel="noopener noreferrer">기상청 과거 관측 출처</a>
    </small>}
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
  const [productName, setProductName] = useState(initialLookup?.product ?? '')
  const product = productName.trim()
  const [estimate, setEstimate] = useState<InventoryDemandEstimate | null>(null)
  const [stored, setStored] = useState<{ product: string; values: InventoryRecipe[]; suggested: InventoryItem[] }>()
  const [loadError, setLoadError] = useState('')
  const [recipeEdits, setRecipeEdits] = useState<Record<string, string>>({})
  const [recipeSaving, setRecipeSaving] = useState(false)
  const [recipeMessage, setRecipeMessage] = useState<{ key: string; text: string; error?: boolean }>()
  const [dismissed, setDismissed] = useState<string[]>([])
  const range = estimate && estimate.low !== null && estimate.high !== null ? { low: estimate.low, high: estimate.high } : null
  const currentRecipes = stored?.product === product ? stored : undefined
  const visibleItems = [...items, ...(currentRecipes?.suggested.filter(row => {
    const key = recipeKey(row.name, row.unit)
    return !dismissed.includes(JSON.stringify([product, key])) && !items.some(item => recipeKey(item.name, item.unit) === key)
  }) ?? [])]
  const months = analysis.monthly.slice(-2)
  const recorded = visibleItems.filter((item) =>
    item.name.trim() && item.unit.trim() && shortageOf(item) !== null,
  ).length

  useEffect(() => {
    if (!auth || !planId || !product || product.length > 255) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetchInventoryRecipes(auth, planId, product, controller.signal).then(values => {
        if (!controller.signal.aborted) setStored({ product, values,
          suggested: values.map(value => emptyItem(value.ingredientName, value.unit)) })
      }).catch(() => {
        if (!controller.signal.aborted) setLoadError('매장에 저장한 사용량을 불러오지 못했어요. 메뉴를 다시 선택해 주세요.')
      })
    }, 250)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [auth, planId, product])

  function changeProduct(value: string) {
    setProductName(value)
    if (value.trim() === product) return
    setLoadError('')
    setStored(undefined)
    setRecipeMessage(undefined)
  }

  async function saveRecipe(item: InventoryItem, key: string, amount: string) {
    if (!auth || !planId || recipeSaving) return
    setRecipeSaving(true)
    setRecipeMessage(undefined)
    try {
      const saved = await saveInventoryRecipe(auth, planId, product, { ingredientName: item.name, unit: item.unit, amount })
      setStored(current => {
        const values = current?.product === product ? current.values : []
        return { product, values: [...values.filter(value => recipeKey(value.ingredientName, value.unit) !== recipeKey(item.name, item.unit)), saved],
          suggested: current?.product === product ? current.suggested : [] }
      })
      setRecipeEdits(current => {
        const next = { ...current }
        delete next[key]
        return next
      })
      setRecipeMessage({ key, text: '매장에 저장했어요. 다음 발주 검토에서도 불러와요.' })
    } catch (failure) {
      setRecipeMessage({ key, error: true, text: failure instanceof Error ? failure.message : '사용량을 저장하지 못했어요.' })
    } finally {
      setRecipeSaving(false)
    }
  }

  function updateItems(next: InventoryItem[]) {
    setMessage('')
    setError('')
    onChange(next)
  }

  async function save() {
    if (!onSave || saving) return
    setSaving(true)
    setMessage('')
    setError('')
    try {
      await onSave(items)
      setMessage('발주 검토표를 저장했어요.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '발주 검토표를 저장할 수 없어요.')
    } finally {
      setSaving(false)
    }
  }

  function addItem() {
    updateItems([...items, emptyItem()])
  }

  return <section className="execution-material inventory-review">
    <div className="section-top ruled">
      <h2>발주량 검토표</h2>
      <span className="badge" aria-live="polite">{recorded} / {visibleItems.length}품목 기록</span>
    </div>
    <div className="receipt">
      <p>다음 발주분이 들어오기 전까지 쓸 양과 그전에 들어올 물량을 입력해 주세요. 예정된 입고가 없다면 0을 입력해요.</p>
      <p className="muted">발주 검토 예정일 · {reviewDate}</p>
      {auth && planId && <InventoryForecast auth={auth} planId={planId} analysisId={analysisId}
        storeId={analysis.storeId} initialLookup={initialLookup}
        menus={analysis.productSales?.map(product => product.productName) ?? []}
        productName={productName} recipeSaving={recipeSaving} onProduct={changeProduct}
        onEstimate={setEstimate} />}
      {loadError && <p role="alert" className="error">{loadError}</p>}
      {analysis.productSales?.length ? <details className="ruled-block" open>
        <summary>POS 품목별 판매량 참고</summary>
        <p className="muted">판매량을 참고해 발주 품목의 사용량을 정해 주세요. 메뉴 판매량과 재료 사용량의 단위는 다를 수 있어요.</p>
        <table className="input-table" aria-label="발주 검토용 POS 품목별 판매량">
          <thead><tr><th scope="col">상품명</th>
            {months.map(({ month }) => <th scope="col" key={month}>{monthLabel(month)}</th>)}
          </tr></thead>
          <tbody>{analysis.productSales.map((product) => <tr key={product.productName}>
            <th scope="row">{product.productName}</th>
            <td>{formatNumber(product.before)}개</td><td>{formatNumber(product.after)}개</td>
          </tr>)}</tbody>
        </table>
      </details> : <p className="muted">이 분석에 저장된 POS 품목별 판매량이 없어요.</p>}
      <fieldset disabled={saving || recipeSaving} aria-label="발주 검토 입력">
      <InventoryImport onImport={(imported) => updateItems([...items, ...imported])} />
      <div className="inventory-rows">
        {visibleItems.map((item, index) => {
          const shortage = item.shortage ?? shortageOf(item)
          const unit = item.unit.trim()
          const ingredientKey = recipeKey(item.name, item.unit)
          const editKey = JSON.stringify([product, ingredientKey])
          const savedRecipe = currentRecipes?.values.find(value => recipeKey(value.ingredientName, value.unit) === ingredientKey)
          const perServing = recipeEdits[editKey] ?? savedRecipe?.amount ?? ''
          const preparation = range && preparationFor(item, perServing, range.low, range.high)
          function update(field: Exclude<keyof InventoryItem, 'id' | 'shortage'>, value: string) {
            const changed = { ...item, [field]: value, shortage: undefined }
            if ((field === 'name' || field === 'unit') && savedRecipe) setDismissed(current => [...current, editKey])
            updateItems(items.some(row => row.id === item.id)
              ? items.map(row => row.id === item.id ? changed : row)
              : [...items, changed])
          }
          return <fieldset key={item.id} className="inventory-row">
            <legend>품목 {index + 1}</legend>
            <div className="inventory-fields">
              <label>품목명<input value={item.name} maxLength={50} onChange={(event) => update('name', event.target.value)} placeholder="예: 쌀" /></label>
              <label>단위<input value={item.unit} maxLength={12} onChange={(event) => update('unit', event.target.value)} placeholder="예: kg, 개" /></label>
              {quantities.map(({ key, label }) => <label key={key}>{key === 'incoming' ? '입고 예정량' : label}
                <input type="number" inputMode="decimal" min="0" max="1000000000" step="0.001" value={item[key]} aria-invalid={item[key] !== '' && parseQuantity(item[key]) === null} onChange={(event) => update(key, event.target.value)} />
              </label>)}
              <div className="inventory-shortage">
                <span>부족 수량</span>
                <output aria-live="polite">{shortage !== null && unit ? `${formatQuantity(shortage)} ${unit}` : '추가 입력 필요'}</output>
              </div>
              <label>최종 발주량
                <input type="number" inputMode="decimal" min="0" max="1000000000" step="0.001" value={item.finalOrder} aria-invalid={item.finalOrder !== '' && parseQuantity(item.finalOrder) === null} onChange={(event) => update('finalOrder', event.target.value)} />
              </label>
              <button type="button" className="text-button inventory-remove" aria-label={`품목 ${index + 1} 삭제`} onClick={() => {
                setDismissed(current => [...current, editKey])
                updateItems(items.filter((row) => row.id !== item.id))
              }}>삭제</button>
            </div>
            {product && <div className="ruled-block form-stack">
              <label>{product} 한 개당 재료 사용량{unit && ` (${unit})`}
                <input type="number" inputMode="decimal" min="0.001" step="0.001" value={perServing}
                  onChange={event => {
                    const amount = event.target.value
                    setRecipeEdits(current => ({ ...current, [editKey]: amount }))
                    setRecipeMessage(undefined)
                  }} />
              </label>
              {!unit && <small className="muted">위에 재고와 같은 재료 단위를 먼저 입력해 주세요.</small>}
              {auth && planId && <button type="button" className="button secondary small"
                disabled={!item.name.trim() || !unit || !parseQuantity(perServing) || perServing === savedRecipe?.amount || !currentRecipes && !loadError}
                onClick={() => void saveRecipe(item, editKey, perServing)}>매장에 사용량 저장</button>}
              {savedRecipe && recipeEdits[editKey] === undefined && <small className="muted">매장에 저장된 사용량</small>}
              {recipeMessage?.key === editKey && <p role={recipeMessage.error ? 'alert' : 'status'}
                className={recipeMessage.error ? 'error' : undefined}>{recipeMessage.text}</p>}
              {preparation && unit && <>
                <p>예상 재료 사용량 <strong>{formatQuantity(preparation.usage[0])}~{formatQuantity(preparation.usage[1])} {unit}</strong></p>
                {preparation.shortage
                  ? <p>추가 준비량 <strong>{formatQuantity(preparation.shortage[0])}~{formatQuantity(preparation.shortage[1])} {unit}</strong></p>
                  : <p className="muted">추가 준비량을 보려면 현재 재고와 입고 예정량을 입력해 주세요.</p>}
                <button type="button" className="button secondary small"
                  onClick={() => update('expectedUse', String(preparation.usage[1]))}>예상 사용량에 상한 적용</button>
              </>}
            </div>}
          </fieldset>
        })}
      </div>
      <button type="button" className="button secondary small inventory-add" onClick={addItem}>+ 품목 추가</button>
      </fieldset>
      {visibleItems.length > 0 && <p className="muted inventory-hint">수량은 품목마다 같은 단위로, 소수점 셋째 자리까지 입력해 주세요. 최종 발주량은 주문 단위와 여유분을 고려해 정할 수 있어요.</p>}
      {onSave && <button type="button" className="button primary small" disabled={saving || recipeSaving} onClick={() => void save()}>
        {saving ? '저장 중…' : '발주 검토표 저장'}
      </button>}
      {message && <p role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  </section>
}
