import type { ExecutionGuide } from '../api/shop'
import { exampleReviews } from './reviews'
import type { Review, ReviewTopic } from './reviews'

export type MonthlySales = { month: string; amount: number }
export type TimeSeries = {
  metric: 'amount' | 'count'
  rows: { label: string; before: number; after: number }[]
}
export type Analysis = {
  store: string
  name?: string
  storeId?: string
  createdAt?: string
  address?: string
  area?: string
  industry: string
  concern: string
  monthly: MonthlySales[]
  timeSeries?: TimeSeries
  productSales?: ProductSale[]
  reviews?: Review[]
  demo: boolean
}

export type ProductSale = {
  productName: string
  before: number
  after: number
  priceWon?: number
  beforeRevenue?: number
  afterRevenue?: number
}

export const timeSlots = ['오후 2시 전', '오후 2~5시', '오후 5시 이후']

export const example: Analysis = {
  store: '애월 가상 한식당',
  address: '제주시 애월읍 (가상 매장)',
  area: '제주시 애월읍',
  industry: '한식 음식점업',
  concern: '평일 오후에 손님이 줄었어요.',
  monthly: [
    { month: '2021-04', amount: 32_379_500 },
    { month: '2021-05', amount: 29_581_000 },
  ],
  timeSeries: {
    metric: 'count',
    rows: [
      { label: timeSlots[0], before: 248, after: 228 },
      { label: timeSlots[1], before: 233, after: 69 },
      { label: timeSlots[2], before: 185, after: 165 },
    ],
  },
  demo: true,
  reviews: exampleReviews,
}

export const formatNumber = new Intl.NumberFormat('ko-KR').format
export const won = (value: number) => `${formatNumber(value)}원`
export const monthLabel = (month: string) => {
  const [year, number] = month.split('-')
  return `${year}년 ${Number(number)}월`
}
export const changeRate = (before: number, after: number) =>
  before === 0 ? null : ((after - before) / before) * 100
export const formatRate = (value: number | null) =>
  value === null ? '비교 기준 없음' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`

export const strategies = [
  { id: 'promotion', name: '한정 시간대 프로모션', description: '결제가 줄어든 시간대에 혜택을 시험해봐요.' },
  { id: 'outreach', name: '가게 소식 알리기', description: '메뉴와 영업 소식을 손님에게 알려요.' },
  { id: 'inventory', name: '발주량 점검하기', description: '재고와 사용량을 확인해 다음 발주를 검토해요.' },
] as const

export function addDays(date: string, days: number) {
  const result = new Date(date)
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

export type InventoryItem = {
  id: string
  name: string
  unit: string
  stock: string
  expectedUse: string
  incoming: string
  finalOrder: string
  shortage?: number | null
}

export type SalesPeriod = {
  start: string
  end: string
  days: number
  amount?: number
  count?: number
}

export type SalesResult = { before: SalesPeriod; after: SalesPeriod }

export type PromotionReviewInput = {
  productName: string
  priceWon: number
  costWon: number
  discountWon: number
  budgetWon: number
}

export type PromotionReview = PromotionReviewInput & {
  discountedPriceWon: number
  marginPerItemWon: number
  maxDiscountQuantity: number
}

export const promotionTones = [
  {value: 'PLAIN', label: '담백한 안내'},
  {value: 'FRIENDLY', label: '친근한 동네 가게'},
  {value: 'SHORT', label: '짧은 공지'},
] as const
export type PromotionTone = (typeof promotionTones)[number]['value']

export type PromotionDraft = {
  tone?: PromotionTone
  storeName: string
  headline: string
  feature: string
  discountedPrice: string
  detail: string
  caption: string
  publishDate: string
  publishTime: string
  timeZone: 'Asia/Seoul'
  copySource: 'GPT' | 'TEMPLATE' | 'EDITED'
  photoDataUrl: string | null
  templateVersion: number
}

export type PromotionDraftInput = {
  review?: PromotionReview
  subject?: string
  publishDate: string
  publishTime: string
  photoDataUrl?: string
  useSavedPhoto: boolean
  caption?: string
}

export type CustomerNotice = { concern: string; text: string; placement: string }

export type Plan = {
  marketing?: boolean
  customerNotice?: CustomerNotice
  id?: string
  analysisId?: string
  missingInputs?: string[]
  salesResult?: SalesResult
  reviewAction?: true
  reviewEvidence?: Review[]
  reviewTopic?: ReviewTopic
  remainingStock?: Record<string, { unit: string; quantity: string }>
  inventoryItems?: InventoryItem[]
  promotionReview?: PromotionReview
  promotionDraft?: PromotionDraft
  strategy: (typeof strategies)[number]['id'] | 'custom'
  title: string
  store: string
  demo: boolean
  duration: string
  startDate: string
  endDate: string
  timeLabel?: string
  followUp: string
  recommendation?: { reason: string; evidence: string[]; contextEvidence: string[] }
  executionGuide?: ExecutionGuide
  budget: number
  channel: string
  tasks: { id?: string; label: string; date: string }[]
  done: number[]
}
