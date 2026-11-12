import { formatNumber, won } from './shop'
import type { Plan, PromotionChannelCopy, PromotionDraft } from './shop'

export const promotionPublicationLabels = {
  INSTAGRAM: '인스타그램',
  NAVER: '네이버 플레이스',
  DAANGN: '당근',
} as const

export const promotionChannels = [
  { id: 'instagram', label: '인스타그램', placement: '피드' },
  { id: 'naver', label: '네이버 플레이스', placement: '새소식' },
  { id: 'daangn', label: '당근', placement: '동네 소식' },
] as const

export function promotionCaptions(plan: Plan, draft: PromotionDraft): PromotionChannelCopy {
  if (draft.channels) return draft.channels.drafts
  const { headline, storeName } = draft
  const review = plan.promotionReview
  const offer = review ? `\n\n${headline} ${won(review.discountedPriceWon)} · 개당 ${won(review.discountWon)} 할인 · ${formatNumber(review.maxDiscountQuantity)}개 한정\n행사 기간 ${plan.startDate} ~ ${plan.endDate}` : ''
  return {
    instagram: draft.caption,
    naver: `[${headline}${review ? ' 할인 행사' : ' 소식'}]\n${storeName}${offer}`,
    daangn: `동네 이웃 여러분, ${storeName}입니다.\n${headline}${review ? ' 할인 소식을 전해요.' : ' 소식을 전해요.'}${offer}`,
  }
}

export function promotionCaptionBody(caption: string, offer?: string | null) {
  const footer = `\n\n${offer}`
  return offer && caption.endsWith(footer) ? caption.slice(0, -footer.length) : caption
}
