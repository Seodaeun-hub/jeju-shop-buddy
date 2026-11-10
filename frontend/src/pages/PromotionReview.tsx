import { useEffect, useId, useState } from 'react'
import { fetchPromotionDefaults, type PromotionDefaults } from '../api/shop'
import type { FormEvent } from 'react'
import { formatNumber, monthLabel, won } from '../data/shop'
import type { Analysis, PromotionReview as SavedReview, PromotionReviewInput } from '../data/shop'

const moneyFields = [
  { key: 'priceWon', label: '판매가 (원)', min: 1 },
  { key: 'costWon', label: '원가 (원)', min: 0 },
  { key: 'discountWon', label: '개당 할인액 (원)', min: 1 },
  { key: 'budgetWon', label: '할인 예산 (원)', min: 0 },
] as const

export function PromotionReview({ analysis, saved, initialBudget, onSave, readOnly = false, auth, planId }: {
  analysis: Analysis
  saved?: SavedReview
  initialBudget: number
  auth?: string
  planId?: string
  readOnly?: boolean
  onSave?: (input: PromotionReviewInput) => Promise<void>
}) {
  const suggestions = useId()
  const [draft, setDraft] = useState({
    productName: saved?.productName ?? '',
    priceWon: saved ? String(saved.priceWon) : '',
    costWon: saved ? String(saved.costWon) : '',
    discountWon: saved ? String(saved.discountWon) : '',
    budgetWon: String(saved?.budgetWon ?? initialBudget),
  })
  const [defaults, setDefaults] = useState<PromotionDefaults>()
  const [loadingDefaults, setLoadingDefaults] = useState(Boolean(auth && planId && !saved))
  const [defaultsError, setDefaultsError] = useState(false)
  const [saving, setSaving] = useState(false)
  const hasSavedReview = Boolean(saved)

  useEffect(() => {
    if (!auth || !planId) return
    const controller = new AbortController()
    fetchPromotionDefaults(auth, planId, controller.signal).then((result) => {
      if (controller.signal.aborted) return
      setDefaults(result)
      if (!hasSavedReview && result.budgetWon != null) setDraft(current => ({ ...current, budgetWon: String(result.budgetWon) }))
    }).catch(() => {
      if (!controller.signal.aborted) setDefaultsError(true)
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingDefaults(false)
    })
    return () => controller.abort()
  }, [auth, planId, hasSavedReview])
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [priceWon, costWon, discountWon, budgetWon] = moneyFields.map(({ key }) =>
    /^\d+$/.test(draft[key]) ? Number(draft[key]) : NaN)
  const valid = [priceWon, costWon, discountWon, budgetWon].every(Number.isSafeInteger)
    && priceWon > 0 && discountWon > 0 && discountWon <= priceWon
  const margin = priceWon - discountWon - costWon

  const selectedProduct = analysis.productSales?.find(product => product.productName === draft.productName.trim())
  const posPrice = selectedProduct?.priceWon

  function selectProduct(value: string) {
    const name = value.trim()
    const price = analysis.productSales?.find(product => product.productName === name)?.priceWon
    const cost = saved?.productName === name ? saved.costWon
      : defaults?.costs.find(product => product.productName === name)?.costWon
    setDraft(current => current.productName.trim() === name ? { ...current, productName: value } : {
      ...current, productName: value,
      priceWon: price == null ? '' : String(price),
      costWon: cost == null ? '' : String(cost),
    })
    setMessage('')
    setError('')
  }

  function update(key: keyof typeof draft, value: string) {
    setDraft((current) => ({ ...current, [key]: value }))
    setMessage('')
    setError('')
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!onSave || readOnly || saving || !valid || !draft.productName.trim()) return
    setSaving(true)
    setMessage('')
    setError('')
    try {
      await onSave({ productName: draft.productName.trim(), priceWon, costWon, discountWon, budgetWon })
      setMessage('프로모션 검토를 저장했어요.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '프로모션 검토를 저장할 수 없어요.')
    } finally {
      setSaving(false)
    }
  }

  return <section className="execution-material">
    <div className="section-top ruled"><h2>프로모션 검토</h2></div>
    {analysis.productSales?.length ? <details className="ruled-block" open>
      <summary>POS 품목별 판매량 참고</summary>
      <table className="input-table" aria-label="프로모션 검토용 POS 품목별 판매량">
        <thead><tr><th scope="col">상품명</th>
          {analysis.monthly.slice(-2).map(({ month }) => <th scope="col" key={month}>{monthLabel(month)}</th>)}
        </tr></thead>
        <tbody>{analysis.productSales.map(({ productName, before, after }) => <tr key={productName}>
          <th scope="row">{productName}</th><td>{formatNumber(before)}개</td><td>{formatNumber(after)}개</td>
        </tr>)}</tbody>
      </table>
    </details> : <p className="muted">저장된 POS 품목별 판매량이 없어요. 품목명은 직접 입력할 수 있어요.</p>}
    <form className="receipt form-stack" onSubmit={submit}>
      {loadingDefaults && <p role="status">지난 행사 입력값을 불러오는 중이에요.</p>}
      {defaultsError && <p role="status">지난 행사 입력값을 불러오지 못했어요. 직접 입력할 수 있어요.</p>}
      <fieldset disabled={readOnly || saving || loadingDefaults} className="form-stack">
        <label>검토할 품목<input list={suggestions} maxLength={255} required value={draft.productName}
          onChange={(event) => selectProduct(event.target.value)} /></label>
        <datalist id={suggestions}>{analysis.productSales?.map(({ productName }) =>
          <option key={productName} value={productName} />)}</datalist>
        {posPrice != null && draft.priceWon === String(posPrice) && <small className="muted">POS에 기록된 최근 판매가예요. 현재 판매가가 다르면 바꿔 주세요.</small>}
        {moneyFields.map(({ key, label, min }) => <label key={key}>{label}
          <input type="number" inputMode="numeric" min={min} max={key === 'discountWon' && priceWon > 0 ? priceWon : Number.MAX_SAFE_INTEGER}
            step="1" required value={draft[key]} onChange={(event) => update(key, event.target.value)} />
        </label>)}
      </fieldset>
      {valid ? <div aria-live="polite">
        <dl>
          <div><dt>할인 후 판매가</dt><dd>{won(priceWon - discountWon)}</dd></div>
          <div><dt>할인 후 개당 남는 금액</dt><dd className={margin < 0 ? 'down' : undefined}>{won(margin)}</dd></div>
          <div><dt>예산으로 할인 가능한 최대 수량</dt><dd>{formatNumber(Math.floor(budgetWon / discountWon))}개</dd></div>
        </dl>
        {margin < 0 && <p className="down">이 할인 조건에서는 판매할 때마다 원가를 회수하지 못해요.</p>}
      </div> : <p className="muted">판매가·원가·개당 할인액·예산을 입력해 주세요. 할인액은 판매가 이하여야 해요.</p>}
      <p className="muted">남는 금액은 할인 후 판매가에서 입력한 원가를 뺀 값이에요. 최대 수량은 할인 예산을 개당 할인액으로 나눈 몫이에요.</p>
      {onSave && !readOnly && <button className="button primary small" disabled={saving || loadingDefaults || !valid || !draft.productName.trim()}>
        {saving ? '저장 중…' : '프로모션 검토 저장'}
      </button>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  </section>
}
