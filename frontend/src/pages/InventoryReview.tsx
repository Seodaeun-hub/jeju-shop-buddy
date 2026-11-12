import { useId, useState } from 'react'
import { fetchInventoryWeather, type InventoryDemandEstimate, type InventoryWeather } from '../api/shop'
import { formatQuantity, parseQuantity, preparationFor, quantities, shortageOf } from '../data/inventory'
import { formatNumber, monthLabel } from '../data/shop'
import type { Analysis, InventoryItem } from '../data/shop'

import { InventoryImport } from './InventoryImport'

const koreaDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' })
const koreaTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' })

function InventoryForecast({ auth, planId, menus, onEstimate }: {
  auth: string
  planId: string
  menus: string[]
  onEstimate: (estimate: InventoryDemandEstimate | null) => void
}) {
  const [date, setDate] = useState(() => koreaDate.format(new Date(Date.now() + 86_400_000)))
  const [productName, setProductName] = useState('')
  const menuOptions = useId()
  const [reference, setReference] = useState<InventoryWeather>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function clear() {
    setReference(undefined)
    onEstimate(null)
    setError('')
  }

  async function lookup() {
    if (!date || loading) return
    setLoading(true)
    clear()
    try {
      const next = await fetchInventoryWeather(auth, planId, date, productName.trim())
      setReference(next)
      onEstimate(next.estimate)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '예보를 불러오지 못했어요.')
    } finally {
      setLoading(false)
    }
  }

  const forecast = reference?.forecast
  return <div className="ruled-block form-stack">
    <h3>날씨로 발주량 살펴보기</h3>
    <label>날씨를 확인할 날짜
      <input type="date" value={date} disabled={loading} onChange={event => {
        setDate(event.target.value)
        clear()
      }} />
    </label>
    <label>판매량을 예상할 메뉴
      <input list={menuOptions} value={productName} maxLength={255} placeholder="POS에 적힌 메뉴 이름" disabled={loading}
        onChange={event => { setProductName(event.target.value); clear() }} />
    </label>
    <datalist id={menuOptions}>{menus.map(name => <option value={name} key={name} />)}</datalist>
    <button type="button" className="button secondary small" disabled={loading || !date} onClick={() => void lookup()}>
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
    {reference?.estimate && <DemandEstimate estimate={reference.estimate} />}
    {error && <p role="alert" className="error">{error}</p>}
  </div>
}

function DemandEstimate({ estimate }: { estimate: InventoryDemandEstimate }) {
  const { product, historical, actualSales, basis, low, high, samples, station, observationSourceUrl,
    observedRainfallMm, precipitation } = estimate
  return <div className="form-stack">
    {historical && <p className="muted">과거 날짜 검증 · 선택한 날짜의 판매량은 비교 범위 계산에서 제외했어요.</p>}
    {historical && precipitation !== null && <p>선택한 날짜 · {precipitation ? '강수 관측됨' : '강수 기록 없음'}
      {observedRainfallMm !== null && ` · 관측 강수량 ${observedRainfallMm}mm`}
    </p>}
    {low === null || high === null
      ? <p>이 메뉴의 판매량을 예상할 자료가 부족해요. 내 매장 POS 파일 관리에 해당 날짜 직전 12주의 상품 주문 파일을 올려 주세요. 같은 요일의 영업 기록이 최소 3일 필요해요.</p>
      : <>
        <p><strong>{product} 예상 판매량 · {formatNumber(low)}~{formatNumber(high)}개</strong></p>
        <p className="muted">{basis === 'WEATHER'
          ? `같은 요일에 강수 여부가 같았던 ${samples.length}일의 판매 범위예요.`
          : `날씨까지 같은 비교일이 부족해 같은 요일 ${samples.length}일의 판매 범위를 참고했어요.`}</p>
        <p className="muted">아래 발주 품목에서 메뉴 한 개당 재료 사용량을 적으면 준비할 양을 계산해요.</p>
      </>}
    {historical && actualSales !== null && <p>선택한 날짜의 실제 POS 판매량 {formatNumber(actualSales)}개</p>}
    {samples.length > 0 && <details>
      <summary>비교한 POS 기록 {samples.length}일 보기</summary>
      <ul>{samples.map(sample => <li key={sample.date}>
        {sample.date} · {formatNumber(sample.quantity)}개
        {sample.precipitation !== null && (sample.precipitation ? ' · 강수 관측됨' : ' · 강수 기록 없음')}
        {sample.rainfallMm !== null && ` · 강수량 ${sample.rainfallMm}mm`}
      </li>)}</ul>
    </details>}
    {observationSourceUrl && <small className="muted">
      {station} 관측소 · <a href={observationSourceUrl} target="_blank" rel="noopener noreferrer">기상청 과거 관측 출처</a>
    </small>}
  </div>
}

export function InventoryReview({ auth, planId, items, analysis, reviewDate, onChange, onSave }: {
  auth?: string
  planId?: string
  items: InventoryItem[]
  analysis: Analysis
  reviewDate: string
  onChange: (items: InventoryItem[]) => void
  onSave?: (items: InventoryItem[]) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [estimate, setEstimate] = useState<InventoryDemandEstimate | null>(null)
  const [recipe, setRecipe] = useState<Record<string, { product: string; amount: string }>>({})
  const range = estimate && estimate.low !== null && estimate.high !== null
    ? { product: estimate.product, low: estimate.low, high: estimate.high } : null
  const months = analysis.monthly.slice(-2)
  const recorded = items.filter((item) =>
    item.name.trim() && item.unit.trim() && shortageOf(item) !== null,
  ).length

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
    updateItems([...items, {
      id: crypto.randomUUID(),
      name: '',
      unit: '',
      stock: '',
      expectedUse: '',
      incoming: '',
      finalOrder: '',
    }])
  }

  return <section className="execution-material inventory-review">
    <div className="section-top ruled">
      <h2>발주량 검토표</h2>
      <span className="badge" aria-live="polite">{recorded} / {items.length}품목 기록</span>
    </div>
    <div className="receipt">
      <p>다음 발주분이 들어오기 전까지 쓸 양과 그전에 들어올 물량을 입력해 주세요. 예정된 입고가 없다면 0을 입력해요.</p>
      <p className="muted">발주 검토 예정일 · {reviewDate}</p>
      {auth && planId && <InventoryForecast auth={auth} planId={planId}
        menus={analysis.productSales?.map(product => product.productName) ?? []}
        onEstimate={setEstimate} />}
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
      <fieldset disabled={saving} aria-label="발주 검토 입력">
      <InventoryImport onImport={(imported) => updateItems([...items, ...imported])} />
      <div className="inventory-rows">
        {items.map((item, index) => {
          const shortage = item.shortage ?? shortageOf(item)
          const unit = item.unit.trim()
          const savedRecipe = recipe[item.id]
          const perServing = savedRecipe && savedRecipe.product === range?.product ? savedRecipe.amount : ''
          const preparation = range && preparationFor(item, perServing, range.low, range.high)
          function update(field: Exclude<keyof InventoryItem, 'id' | 'shortage'>, value: string) {
            updateItems(items.map((row) => row.id === item.id ? { ...row, [field]: value, shortage: undefined } : row))
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
              <button type="button" className="text-button inventory-remove" aria-label={`품목 ${index + 1} 삭제`} onClick={() => updateItems(items.filter((row) => row.id !== item.id))}>삭제</button>
            </div>
            {range && <div className="ruled-block form-stack">
              <label>{range.product} 한 개당 재료 사용량{unit && ` (${unit})`}
                <input type="number" inputMode="decimal" min="0.001" step="0.001" value={perServing}
                  onChange={event => {
                    const amount = event.target.value
                    setRecipe(current => ({ ...current, [item.id]: { product: range.product, amount } }))
                  }} />
              </label>
              {!unit && <small className="muted">위에 재고와 같은 재료 단위를 먼저 입력해 주세요.</small>}
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
      {items.length > 0 && <p className="muted inventory-hint">수량은 품목마다 같은 단위로, 소수점 셋째 자리까지 입력해 주세요. 최종 발주량은 주문 단위와 여유분을 고려해 정할 수 있어요.</p>}
      {onSave && <button type="button" className="button primary small" disabled={saving} onClick={() => void save()}>
        {saving ? '저장 중…' : '발주 검토표 저장'}
      </button>}
      {message && <p role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  </section>
}
