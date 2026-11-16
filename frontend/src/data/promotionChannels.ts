import { formatNumber, won } from './shop'
import type { Plan, PromotionChannelCopy, PromotionDraft, PromotionLocalEvent } from './shop'

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

// Leave room for the longest weather sentence and its line breaks, even if the posting date changes.
const weatherCaptionAllowance = 48

export function promotionCaptionLimit(offer?: string | null) {
  return 2200 - weatherCaptionAllowance - (offer ? offer.length + 2 : 0)
}

export function promotionCaptionFooter(offer?: string | null, event?: PromotionLocalEvent) {
  return event ? [event.captionLine, offer].filter(Boolean).join('\n\n') : offer
}

export function promotionOffer(plan: Plan, draft: PromotionDraft) {
  const review = plan.promotionReview
  return draft.channels?.offer ?? (review
    ? `${draft.headline} ${won(review.discountedPriceWon)} · 개당 ${won(review.discountWon)} 할인 · ${formatNumber(review.maxDiscountQuantity)}개 한정\n행사 기간 ${plan.startDate} ~ ${plan.endDate}`
    : null)
}

export function promotionCaptions(plan: Plan, draft: PromotionDraft): PromotionChannelCopy {
  if (draft.channels) return draft.channels.drafts
  const { headline, storeName } = draft
  const review = plan.promotionReview
  const offer = promotionOffer(plan, draft)
  const footer = offer ? `\n\n${offer}` : ''
  return {
    instagram: draft.caption,
    naver: `[${headline}${review ? ' 할인 행사' : ' 소식'}]\n${storeName}${footer}`,
    daangn: `동네 이웃 여러분, ${storeName}입니다.\n${headline}${review ? ' 할인 소식을 전해요.' : ' 소식을 전해요.'}${footer}`,
  }
}

export function promotionCaptionBody(caption: string, offer?: string | null) {
  const footer = `\n\n${offer}`
  return offer && caption.endsWith(footer) ? caption.slice(0, -footer.length) : caption
}

export function editablePromotionCaption(caption: string, offer?: string | null, lead?: string) {
  const body = promotionCaptionBody(caption, offer)
  if (!lead) return body
  if (body.startsWith(lead + '\n\n')) return body.slice(lead.length + 2)
  if (body.endsWith('\n\n' + lead)) return body.slice(0, -lead.length - 2)
  return body.replace('\n' + lead + '\n\n', '\n')
}
