import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { createNextPromotionPlan } from '../api/shop'
import { formatNumber, won, type PromotionReview } from '../data/shop'
import { seoulDate } from '../data/promotionArchive'

export function NextPromotionPlanForm({ auth, planId, action, review, pending }: {
  auth: string
  planId: string
  action: 'KEEP_TERMS' | 'REVIEW_TERMS'
  review: PromotionReview
  pending: boolean
}) {
  const navigate = useNavigate()
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [today] = useState(seoulDate)
  const [startDate, setStartDate] = useState(today)
  const [discount, setDiscount] = useState(String(review.discountWon))
  const [quantity, setQuantity] = useState(String(review.maxDiscountQuantity))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const keep = action === 'KEEP_TERMS'
  const discountWon = Number(discount)
  const maxDiscountQuantity = Number(quantity)
  const changed = discountWon !== review.discountWon || maxDiscountQuantity !== review.maxDiscountQuantity
  const budget = changed ? discountWon * maxDiscountQuantity : review.budgetWon
  const valid = Number.isSafeInteger(discountWon) && discountWon > 0 && discountWon <= review.priceWon
    && Number.isSafeInteger(maxDiscountQuantity) && maxDiscountQuantity > 0 && Number.isSafeInteger(budget)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || saving || !valid || (!keep && !changed)) return
    setSaving(true)
    setError('')
    try {
      const plan = await createNextPromotionPlan(auth, planId, requestId, { action, startDate, discountWon, maxDiscountQuantity })
      navigate('/execution?' + new URLSearchParams({ id: plan.id, analysisId: plan.analysisId }))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '다음 행사 계획을 저장하지 못했어요.')
    } finally {
      setSaving(false)
    }
  }

  function edit(setValue: (value: string) => void, value: string) {
    setValue(value)
    setRequestId(crypto.randomUUID())
    setError('')
  }

  return <details>
    <summary>새 행사 계획 만들기</summary>
    <form className="form-stack" aria-label="새 행사 계획" onSubmit={submit}>
      <p>{review.productName}의 기존 조건은 개당 {won(review.discountWon)} 할인 · 최대 {formatNumber(review.maxDiscountQuantity)}개예요.</p>
      {!keep && <p>개당 할인액이나 할인 수량 한도를 바꿔 보세요.</p>}
      <fieldset className="result-fields" disabled={pending || saving}>
        <legend>다음 행사 조건</legend>
        <label>행사 시작일<input type="date" min={today} max="9999-11-30" required value={startDate}
          onChange={event => edit(setStartDate, event.target.value)} /></label>
        <label>개당 할인액 (원)<input type="number" min={1} max={review.priceWon} step={1} required readOnly={keep}
          value={discount} onChange={event => edit(setDiscount, event.target.value)} /></label>
        <label>할인 수량 한도 (개)<input type="number" min={1} max={Number.MAX_SAFE_INTEGER} step={1} required readOnly={keep}
          value={quantity} onChange={event => edit(setQuantity, event.target.value)} /></label>
      </fieldset>
      {valid && <p>할인 후 판매가 {won(review.priceWon - discountWon)} · 할인 예산 {won(budget)}</p>}
      <p className="muted">기존 행사 기간의 길이와 홍보 채널을 사용해 별도 실행 계획을 저장해요.</p>
      <button className="button primary small" disabled={pending || saving || !valid || (!keep && !changed)}>
        {saving ? '저장 중…' : '새 행사 계획 저장'}
      </button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  </details>
}
