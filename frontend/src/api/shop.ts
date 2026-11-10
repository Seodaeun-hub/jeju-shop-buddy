import type { Review, ReviewTopic } from '../data/reviews'
import type { Analysis, InventoryItem, MonthlySales, Plan, ProductSale, PromotionDraft, PromotionDraftInput, PromotionReview, PromotionReviewInput, SalesResult, TimeSeries } from '../data/shop'
import { formatEvidence } from '../data/strategyEvidence'

export type Area = { code: string; name: string }
export type StoreInput = {
  name: string
  address: string
  addressSource: 'SEARCH' | 'MANUAL'
  areaCode: string
  industryCode: string
  customIndustryName?: string
}
export type Store = StoreInput & { id: string; areaName: string }
type ApiTimeSeries = { metric: 'COUNT' | 'AMOUNT'; rows: TimeSeries['rows'] }
type SavedAnalysis = {
  id: string
  storeId: string
  concern?: string
  monthlySales: MonthlySales[]
  timeSeries?: ApiTimeSeries
  productSales?: ProductSale[]
}

async function send(path: string, authorization?: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<Response> {
  const headers = new Headers({ Accept: 'application/json' })
  if (authorization) {
    if (authorization !== ownerSession) headers.set('Authorization', authorization)
    headers.set('X-Requested-With', 'XMLHttpRequest')
  }
  if (body !== undefined) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { method, headers, body: JSON.stringify(body), signal, cache: 'no-store', credentials: authorization ? 'same-origin' : 'omit' })
    .catch((error: unknown) => {
      if (signal?.aborted) throw error
      throw new Error('서버에 연결할 수 없어요. 잠시 후 다시 시도해 주세요.')
    })
  if (response.status === 401) throw new Error('이메일과 비밀번호를 확인하거나 다시 로그인해 주세요.')
  if (!response.ok) {
    const error = await response.json().catch(() => undefined)
    throw new Error(error?.message || '요청을 처리할 수 없어요. 잠시 후 다시 시도해 주세요.')
  }
  return response
}

async function request<T>(...args: Parameters<typeof send>): Promise<T> {
  return (await send(...args)).json()
}

export type InstagramPublication = {
  state: 'SCHEDULED' | 'PUBLISHING' | 'PUBLISHED' | 'FAILED' | 'VERIFY_REQUIRED'
  username: string
  mediaId?: string | null
  permalink?: string | null
  caption?: string | null
  imageDataUrl?: string | null
  scheduledAt?: string | null
  publishedAt?: string | null
}
export type InstagramPublicationStatus = {
  available: boolean
  username: string
  publication?: InstagramPublication | null
}
const instagramPublicationPath = (planId: string) => `/api/plans/${encodeURIComponent(planId)}/instagram-publication`
export const fetchInstagramPublication = (auth: string, planId: string, signal?: AbortSignal) =>
  request<InstagramPublicationStatus>(instagramPublicationPath(planId), auth, 'GET', undefined, signal)
export const publishInstagram = (auth: string, planId: string, input: { username: string; caption: string; image: string; scheduledAt?: string }) =>
  request<InstagramPublication>(instagramPublicationPath(planId), auth, 'POST', input)
export const cancelInstagramSchedule = (auth: string, planId: string) =>
  request<InstagramPublicationStatus>(instagramPublicationPath(planId), auth, 'DELETE')

function basicAuthorization(email: string, password: string) {
  const bytes = new TextEncoder().encode(email.trim() + ':' + password)
  return 'Basic ' + btoa(String.fromCharCode(...bytes))
}

export const ownerSession = 'session'
export const loginOwner = (email: string, password: string) =>
  request<{ email: string }>('/api/session', basicAuthorization(email, password), 'POST')
export const fetchOwnerSession = (signal: AbortSignal) =>
  request<{ email: string }>('/api/session', ownerSession, 'GET', undefined, signal)
export const logoutOwner = () => send('/api/session', ownerSession, 'DELETE')

export const listStores = (auth: string, signal?: AbortSignal) => request<Store[]>('/api/stores', auth, 'GET', undefined, signal)
export type StoreAnalysisSummary = {
  id: string
  beforeMonth: string
  afterMonth: string
  concern?: string | null
  createdAt: string
  plans: { id: string; title?: string | null; startDate: string; endDate: string; hasResult: boolean }[]
}
export const listStoreAnalyses = (auth: string, storeId: string, signal: AbortSignal) =>
  request<StoreAnalysisSummary[]>(`/api/stores/${encodeURIComponent(storeId)}/analyses`, auth, 'GET', undefined, signal)

export type QuestionChart = 'MONTHLY_SALES' | 'MARKET_CARD_SALES' | 'JEJU_BSI' | 'TIME_SERIES'
type QuestionSource = { label: string; url?: string }
type QuestionPeriod = { start: string; end: string; businessDays: number }
type DailyQuestionMetric = { before: number; after: number; unit: 'KRW' | 'COUNT'; changePercent?: number }
type QuestionEvidenceBase = { id: string; label?: string; source?: QuestionSource }
export type QuestionEvidence = QuestionEvidenceBase & (
  | { kind: 'METRIC'; before: number; after: number; unit: 'KRW' | 'COUNT' | 'INDEX' | 'QUANTITY'; scope?: string; period?: { before: string; after: string } }
  | { kind: 'STRATEGY'; reason?: string }
  | { kind: 'GUIDE'; when?: string }
  | { kind: 'REVIEW'; date: string; excerpt: string }
  | { kind: 'PLAN'; completed: number; total: number; startDate?: string; endDate?: string }
  | { kind: 'RESULT'; scope: string; before: QuestionPeriod; after: QuestionPeriod; dailyAverageSales?: DailyQuestionMetric; dailyAveragePayments?: DailyQuestionMetric }
)
export type QuestionAction = { type: 'ADD_TIME_SERIES' | 'OPEN_REVIEWS' | 'OPEN_STRATEGY' | 'OPEN_EXECUTION_GUIDE' | 'OPEN_PLAN_RESULTS' | 'SELECT_PLAN'; targetId: string }
export type QuestionTurn = {
  conversationId: string
  turnId: string
  question: string
  chart: QuestionChart
  answer: {
    status: string
    sections: { kind: 'OBSERVATION' | 'HYPOTHESIS' | 'ACTION'; text: string; evidenceIds: string[] }[]
    evidence: QuestionEvidence[]
    missingInputs: { code: string; label: string }[]
    actions: QuestionAction[]
  }
}
export type QuestionInput = { clientMessageId: string; conversationId?: string; chart: QuestionChart; question: string; planId?: string }
export function fetchQuestions(auth: string, id: string, signal: AbortSignal) {
  return request<{ conversationId: string | null; turns: QuestionTurn[] }>(`/api/analyses/${encodeURIComponent(id)}/questions`, auth, 'GET', undefined, signal)
}
export function sendQuestion(auth: string, id: string, input: QuestionInput) {
  return request<QuestionTurn>(`/api/analyses/${encodeURIComponent(id)}/questions`, auth, 'POST', input)
}
export const listAreas = (signal: AbortSignal) => request<Area[]>('/api/areas', undefined, 'GET', undefined, signal)
export const registerStore = (auth: string, input: StoreInput) => request<Store>('/api/stores', auth, 'POST', input)

function toApiTimeSeries(value: TimeSeries): ApiTimeSeries {
  return { metric: value.metric === 'count' ? 'COUNT' : 'AMOUNT', rows: value.rows }
}

export function saveAnalysis(auth: string, storeId: string, monthlySales: MonthlySales[], concern: string,
  timeSeries?: TimeSeries, productSales?: ProductSale[]) {
  return request<SavedAnalysis>(`/api/stores/${storeId}/analyses`, auth, 'POST', {
    monthlySales, concern: concern || undefined, timeSeries: timeSeries && toApiTimeSeries(timeSeries), productSales,
  })
}

export async function fetchAnalysis(auth: string, id: string, signal: AbortSignal): Promise<Analysis> {
  const saved = await request<SavedAnalysis>(`/api/analyses/${encodeURIComponent(id)}`, auth, 'GET', undefined, signal)
  const store = (await listStores(auth, signal)).find(({ id }) => id === saved.storeId)
  if (!store) throw new Error('분석에 연결된 매장을 찾을 수 없어요.')
  return {
    store: store.name, address: store.address, area: store.areaName,
    industry: store.customIndustryName ?? industryOptions.find(({ code }) => code === store.industryCode)?.name ?? store.industryCode,
    concern: saved.concern ?? '', monthly: saved.monthlySales,
    productSales: saved.productSales,
    timeSeries: saved.timeSeries && {
      metric: saved.timeSeries.metric === 'COUNT' ? 'count' : 'amount', rows: saved.timeSeries.rows,
    },
    demo: false,
  }
}

export async function saveTimeSeries(auth: string, id: string, value: TimeSeries) {
  await request<SavedAnalysis>(`/api/analyses/${encodeURIComponent(id)}/time-series`, auth, 'PUT', toApiTimeSeries(value))
}

export type StrategyCode = 'OUTREACH' | 'PROMOTION' | 'INVENTORY'
export type MarketContext = {
  card?: { before: number; after: number }
  bsi?: { before: number; after: number }
}

export function fetchMarketContext(area: string, industry: string, beforeMonth: string, afterMonth: string, signal: AbortSignal) {
  const query = new URLSearchParams({ area, industry, beforeMonth, afterMonth })
  return request<MarketContext>(`/api/market-context?${query}`, undefined, 'GET', undefined, signal)
}

export type StrategyEvidence = {
  source: 'MONTHLY_SALES' | 'TIME_SERIES' | 'MARKET_CARD_SALES' | 'JEJU_BSI'
  metric: 'AMOUNT' | 'COUNT' | 'INDEX'
  label?: string
  before: number
  after: number
}
export type SavedStrategy = {
  code: StrategyCode
  title: string
  status: 'RECOMMENDED' | 'AVAILABLE' | 'NEEDS_INPUT'
  reason: string
  evidence: StrategyEvidence[]
  reviewEvidence?: Review[]
  reviewTopic?: ReviewTopic
  missingInputs: string[]
  followUp: string
  nextAction?: string
  executionGuide?: ExecutionGuide
  recommendation?: {
    id: string
    beforeMonth: string
    afterMonth: string
    contextEvidence: StrategyEvidence[]
  }
}
export type StrategyResponse = {
  beforeMonth: string
  afterMonth: string
  strategies: SavedStrategy[]
  recommendationSource?: 'AGENT' | 'RULES'
  contextEvidence?: StrategyEvidence[]
  recommendationId?: string
}
export type PlanConditions = { durationWeeks: number; budgetWon?: number; channel?: 'INSTAGRAM' | 'STORE_NOTICE' }
type ChecklistItem = { id: string; title: string; dueDate: string; completed: boolean }
type SavedPlan = {
  inventoryItems?: InventoryItem[]
  promotionReview?: PromotionReview
  promotionDraft?: PromotionDraft
  id: string
  analysisId: string
  strategy: SavedStrategy
  conditions: PlanConditions
  startDate: string
  endDate: string
  checklist: ChecklistItem[]
}

export const strategyIds = { OUTREACH: 'outreach', PROMOTION: 'promotion', INVENTORY: 'inventory' } as const

export function generateRecommendation(auth: string, id: string, signal: AbortSignal) {
  return request<StrategyResponse>(`/api/analyses/${encodeURIComponent(id)}/recommendations`, auth, 'POST', undefined, signal)
}

export type ExecutionGuideChannel = 'NAVER' | 'IN_STORE'

export type ExecutionGuide = {
  guideId: string
  channel: ExecutionGuideChannel
  status: 'OK' | 'NO_RELEVANT_GUIDE' | 'CURATED_FALLBACK'
  message: string | null
  steps: { kind: 'STORE_CHECK' | 'OFFICIAL_GUIDE'; text: string; when: string | null; sourceIds: string[] }[]
  sources: { id: string; title: string; publisher: string; url: string; revision: number }[]
}

export function fetchExecutionGuide(auth: string, id: string, channel: ExecutionGuideChannel,
  recommendationId: string | undefined, signal: AbortSignal) {
  return request<ExecutionGuide>(`/api/analyses/${encodeURIComponent(id)}/execution-guide`, auth, 'POST',
    { strategyCode: 'OUTREACH', channel, recommendationId }, signal)
}

export function createPlan(auth: string, id: string, strategyCode: StrategyCode, conditions: PlanConditions,
  recommendationId?: string, executionGuideId?: string) {
  return request<SavedPlan>(`/api/analyses/${encodeURIComponent(id)}/plans`, auth, 'POST',
    { strategyCode, conditions, recommendationId, executionGuideId })
}

export function fetchPlan(auth: string, id: string, signal: AbortSignal) {
  return request<SavedPlan>(`/api/plans/${encodeURIComponent(id)}`, auth, 'GET', undefined, signal)
}

export function saveInventoryReview(auth: string, id: string, items: InventoryItem[]) {
  return request<InventoryItem[]>(`/api/plans/${encodeURIComponent(id)}/inventory-review`, auth, 'PUT',
    items.map(({ shortage: _shortage, ...input }) => input))
}

export function savePromotionReview(auth: string, id: string, input: PromotionReviewInput) {
  return request<PromotionReview>(`/api/plans/${encodeURIComponent(id)}/promotion-review`, auth, 'PUT', input)
}

type MenuPhoto = { photoDataUrl: string | null }
type MenuPhotoStatus = { productName: string; hasPhoto: boolean }

export function createPromotionDraft(auth: string, id: string, input: PromotionDraftInput) {
  return request<PromotionDraft>(`/api/plans/${encodeURIComponent(id)}/promotion-draft`, auth, 'POST', input)
}

export function fetchPromotionPhoto(auth: string, id: string, signal: AbortSignal) {
  return request<MenuPhoto>(`/api/plans/${encodeURIComponent(id)}/promotion-photo`, auth, 'GET', undefined, signal)
}

function menuPhotoPath(id: string) {
  return `/api/stores/${encodeURIComponent(id)}/menu-photos`
}

export function listMenuPhotos(auth: string, id: string, signal: AbortSignal) {
  return request<MenuPhotoStatus[]>(menuPhotoPath(id), auth, 'GET', undefined, signal)
}

export function fetchMenuPhoto(auth: string, id: string, productName: string, signal: AbortSignal) {
  return request<MenuPhoto>(menuPhotoPath(id) + '?' + new URLSearchParams({ productName }), auth, 'GET', undefined, signal)
}

export function saveMenuPhoto(auth: string, id: string, productName: string, photoDataUrl: string | null) {
  return request<MenuPhoto>(menuPhotoPath(id), auth, 'PUT', { productName, photoDataUrl })
}

export function updateChecklistItem(auth: string, planId: string, itemId: string, completed: boolean) {
  const path = `/api/plans/${encodeURIComponent(planId)}/checklist/${encodeURIComponent(itemId)}`
  return request<ChecklistItem>(path, auth, 'PATCH', { completed })
}

export type ResultMetric = {
  beforeDailyAverage: number
  afterDailyAverage: number
  changeRatePercent: number | null
}

export type SavedSalesResult = SalesResult & {
  id: string
  scope: string
  comparison: { amount?: ResultMetric; count?: ResultMetric }
}

function resultsPath(planId: string, resultId?: string) {
  const base = `/api/plans/${encodeURIComponent(planId)}/results`
  return resultId ? `${base}/${encodeURIComponent(resultId)}` : base
}

export async function fetchSalesResult(auth: string, planId: string, signal: AbortSignal): Promise<SavedSalesResult | null> {
  const response = await send(resultsPath(planId), auth, 'GET', undefined, signal)
  return response.status === 204 ? null : response.json()
}

export function saveSalesResult(auth: string, planId: string, result: SalesResult & { scope: string }, resultId?: string) {
  return request<SavedSalesResult>(resultsPath(planId, resultId), auth, resultId ? 'PUT' : 'POST', result)
}

export async function deleteSalesResult(auth: string, planId: string, resultId: string) {
  await send(resultsPath(planId, resultId), auth, 'DELETE')
}

export type ReviewIssue = {
  topic: ReviewTopic
  label: string
  title: string
  action: string
  confirmation: string
  evidence: Review[]
}
export type ReviewInsight = { total: number; topics: ReviewIssue[] }

export function fetchReviewInsight(auth: string, id: string, signal: AbortSignal) {
  return request<ReviewInsight>(`/api/analyses/${encodeURIComponent(id)}/reviews`, auth, 'GET', undefined, signal)
}

export function addReview(auth: string, id: string, date: string, text: string) {
  return request<Review>(`/api/analyses/${encodeURIComponent(id)}/reviews`, auth, 'POST', { date, text })
}

export function createReviewPlan(auth: string, id: string, topic: ReviewTopic) {
  return request<SavedPlan>(`/api/analyses/${encodeURIComponent(id)}/review-plans`, auth, 'POST', { confirmed: true, topic })
}

export function toPlan(saved: SavedPlan, store: string): Plan {
  const { conditions, strategy, checklist } = saved
  const context = strategy.recommendation
  return {
    id: saved.id,
    analysisId: saved.analysisId,
    inventoryItems: saved.inventoryItems,
    promotionReview: saved.promotionReview,
    promotionDraft: saved.promotionDraft,
    strategy: strategyIds[strategy.code],
    title: strategy.title,
    store,
    demo: false,
    duration: `${conditions.durationWeeks}주`,
    startDate: saved.startDate,
    endDate: saved.endDate,
    timeLabel: strategy.evidence.find(({ source }) => source === 'TIME_SERIES')?.label,
    followUp: strategy.followUp,
    executionGuide: strategy.executionGuide,
    recommendation: context && {
      reason: strategy.reason,
      evidence: strategy.evidence.map((item) => formatEvidence(item, context.beforeMonth, context.afterMonth)),
      contextEvidence: context.contextEvidence.map((item) => formatEvidence(item, context.beforeMonth, context.afterMonth)),
    },
    missingInputs: strategy.missingInputs,
    reviewAction: strategy.reviewEvidence && (strategy.reviewTopic ?? 'AFTERNOON_ORDER') === 'AFTERNOON_ORDER' ? true : undefined,
    reviewTopic: strategy.reviewTopic,
    reviewEvidence: strategy.reviewEvidence,
    budget: conditions.budgetWon ?? 0,
    channel: conditions.channel === 'INSTAGRAM' ? '인스타그램' : conditions.channel === 'STORE_NOTICE' ? '매장 안내' : '',
    tasks: checklist.map(({ id, title, dueDate }) => ({ id, label: title, date: dueDate })),
    done: checklist.flatMap(({ completed }, index) => completed ? [index] : []),
  }
}


export const industryOptions = [
  ['음식점·카페', '한식 음식점', '한식 음식점업', 'KOREAN_RESTAURANT'],
  ['음식점·카페', '중식 음식점', '중식 음식점업', 'CHINESE_RESTAURANT'],
  ['음식점·카페', '일식 음식점', '일식 음식점업', 'JAPANESE_RESTAURANT'],
  ['음식점·카페', '양식 음식점', '서양식 음식점업', 'WESTERN_RESTAURANT'],
  ['음식점·카페', '기타 외국식 음식점', '기타 외국식 음식점업', 'OTHER_FOREIGN_RESTAURANT'],
  ['음식점·카페', '피자·햄버거·샌드위치', '피자, 햄버거, 샌드위치 및 유사 음식점업', 'PIZZA_BURGER_SANDWICH'],
  ['음식점·카페', '카페·음료점', '비알콜 음료점업', 'CAFE'],
  ['음식점·카페', '주점', '기타 주점업', 'BAR'],
  ['소매', '빵·과자 판매점', '빵 및 과자류 소매업', 'BAKERY_RETAIL'],
  ['소매', '슈퍼마켓', '슈퍼마켓', 'SUPERMARKET'],
  ['소매', '편의점', '체인화 편의점', 'CONVENIENCE_STORE'],
  ['소매', '과일·채소 판매점', '과실 및 채소 소매업', 'PRODUCE_RETAIL'],
  ['소매', '수산물 판매점', '수산물 소매업', 'SEAFOOD_RETAIL'],
  ['소매', '정육점', '육류 소매업', 'MEAT_RETAIL'],
  ['소매', '기념품·선물 가게', '관광 민예품 및 선물용품 소매업', 'SOUVENIR_RETAIL'],
  ['소매', '화장품 판매점', '화장품 및 방향제 소매업', 'COSMETICS_RETAIL'],
  ['숙박·관광', '호텔', '호텔업', 'HOTEL'],
  ['숙박·관광', '여관·모텔', '여관업', 'MOTEL'],
  ['숙박·관광', '휴양콘도', '휴양콘도 운영업', 'RESORT_CONDO'],
  ['숙박·관광', '여행사', '여행사업', 'TRAVEL_AGENCY'],
].map(([group, label, name, code]) => ({ group, label, name, code }))
