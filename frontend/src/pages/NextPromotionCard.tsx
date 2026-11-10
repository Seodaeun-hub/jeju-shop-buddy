import type { NextPromotionChecklistItem, PromotionImpact, PromotionImpactAdvice, PromotionImpactTotals } from '../api/shop'
import { changeRate, formatNumber, formatRate, won } from '../data/shop'

const messages: Record<PromotionImpactAdvice['action'], { title: string; detail: string }> = {
  RETEST: {
    title: '현재 할인 조건으로 한 번 더 시험해 보세요.',
    detail: '판매량과 실판매금액이 모두 늘었어요. 실제 할인 적용 수량과 원가를 확인할 자료가 없어, 다음 행사에서 함께 기록해 보세요.',
  },
  REVIEW_TERMS: {
    title: '할인 조건을 다시 검토해 보세요.',
    detail: '판매량과 실판매금액이 함께 늘지는 않았어요. 실제 할인 적용 수량과 원가를 먼저 확인하고, 다음 행사에서 할인액이나 할인 수량 중 하나를 바꿔 비교해 보세요.',
  },
  CHECK_DATA: {
    title: '비교 자료를 먼저 확인해 보세요.',
    detail: '주문 기록일 수가 다르거나 행사 전 판매량이 0개예요. 두 POS 파일의 기간과 영업일을 확인해 주세요.',
  },
}

const checklistItems: { id: NextPromotionChecklistItem; label: string }[] = [
  { id: 'DISCOUNT_QUANTITY', label: '실제 할인 적용 수량과 할인 비용 기록하기' },
  { id: 'ACTUAL_COST', label: '품목의 실제 원가 확인하기' },
  { id: 'UPLOAD_POS', label: '행사 종료 후 상품 주문 POS 올리기' },
]

function EvidenceRow({ label, before, after, format }: {
  label: string; before: number | null; after: number | null; format: (value: number) => string
}) {
  return <tr><th scope="row">{label}</th>
    <td>{before === null ? '—' : format(before)}</td>
    <td>{after === null ? '—' : format(after)}</td>
    <td>{formatRate(before === null || after === null ? null : changeRate(before, after))}</td>
  </tr>
}

export function NextPromotionCard({ before, after, advice, checklist, pending, onCreate, onToggle }: {
  before: PromotionImpactTotals
  after: PromotionImpactTotals
  advice: PromotionImpactAdvice
  checklist: PromotionImpact['nextChecklist']
  pending: boolean
  onCreate: () => void
  onToggle: (item: NextPromotionChecklistItem, completed: boolean) => void
}) {
  const message = messages[advice.action]
  return <section className="receipt form-stack" aria-labelledby="next-promotion-title">
    <h3 id="next-promotion-title">다음 행사에서 해볼 일</h3>
    <p><strong>{message.title}</strong></p>
    <p>{message.detail}</p>
    <details>
      <summary>왜 이렇게 제안했나요?</summary>
      <table className="input-table" aria-label="다음 행사 제안 근거">
        <thead><tr><th scope="col">비교 지표</th><th scope="col">행사 전 POS</th>
          <th scope="col">행사 후 POS</th><th scope="col">변화율</th></tr></thead>
        <tbody>
          <EvidenceRow label="판매량" before={before.quantity} after={after.quantity} format={value => formatNumber(value) + '개'} />
          <EvidenceRow label="실판매금액" before={before.amount} after={after.amount} format={won} />
          <EvidenceRow label="개당 평균 실판매금액" before={advice.beforeAveragePrice} after={advice.afterAveragePrice}
            format={value => (Number.isInteger(value) ? '' : '약 ') + won(Math.round(value))} />
        </tbody>
      </table>
      <p className="muted">개당 평균 실판매금액은 실판매금액을 판매량으로 나눴어요. POS에서 관측된 판매 변화이며, 할인 적용 수량과 실제 이익은 별도 자료가 필요해요.</p>
    </details>
    {checklist === null
      ? <button type="button" className="button secondary small" disabled={pending} onClick={onCreate}>다음 행사 점검표 만들기</button>
      : <fieldset className="checklist" disabled={pending}>
        <legend>다음 행사 점검표</legend>
        {checklistItems.map(({ id, label }) => <label key={id}>
          <input type="checkbox" checked={checklist[id] ?? false} onChange={event => onToggle(id, event.target.checked)} />
          {label}
        </label>)}
      </fieldset>}
  </section>
}
