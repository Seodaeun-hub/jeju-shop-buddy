import type { Review, ReviewTopic } from '../data/reviews'
import type { Analysis, CustomerNotice, InventoryItem, MonthlySales, Plan, ProductSale, PromotionDraft, PromotionDraftInput, PromotionReview, PromotionReviewInput, PromotionReviewResearch, PromotionTone, SalesResult, TimeSeries } from '../data/shop'
import { formatEvidence } from '../data/strategyEvidence'

export type Area = { code: string; name: string }
type InventoryDemandSample = { date: string; quantity: number; rainfallMm: number | null; precipitation: boolean | null }
type InventoryDemandBounds = {
  basis: 'WEATHER' | 'WEEKDAY' | 'INSUFFICIENT'
  low: number | null
  high: number | null
}
export type InventoryDemandEstimate = {
  product: string
  historical: boolean
  actualSales: number | null
  samples: InventoryDemandSample[]
  candidates: InventoryDemandSample[]
  excludedDates: string[]
  originalBounds: InventoryDemandBounds | null
  weatherMatches: number
  precipitation: boolean | null
  observedRainfallMm: number | null
  station: string | null
  observationSourceUrl: string | null
  requiredPos: { start: string; end: string; kind: 'PRODUCT'; minimumDays: number } | null
} & InventoryDemandBounds

export type InventoryWeather = {
  date: string
  area: string
  sourceUrl: string | null
  forecast: {
    label: string
    issuedAt: string
    minTemperature: number | null
    maxTemperature: number | null
    maxPrecipitationProbability: number | null
  } | null
  estimate: InventoryDemandEstimate | null
}

export type InventoryRecipe = { ingredientName: string; unit: string; amount: string }
export type InventoryEstimateInput = {
  date: string
  product: string
  low: number
  high: number
  basis: 'WEATHER' | 'WEEKDAY'
  excludedDates?: string[]
}
export type InventoryEstimateComparison = {
  estimate: InventoryEstimateInput & { savedAt: string }
  actualSales: number | null
  status: 'PENDING_DATE' | 'POS_REQUIRED' | 'WITHIN_RANGE' | 'BELOW_RANGE' | 'ABOVE_RANGE'
  currentPlan: boolean
  note: string | null
  excludedDates: string[]
}
export type InventoryEstimateNote = { date: string; product: string; note: string }

const inventoryEstimatesPath = (planId: string) =>
  `/api/plans/${encodeURIComponent(planId)}/inventory-review/estimates`

export const fetchInventoryEstimates = (auth: string, planId: string, signal?: AbortSignal) =>
  request<InventoryEstimateComparison[]>(`${inventoryEstimatesPath(planId)}?includeHistory=true`, auth, 'GET', undefined, signal)

export const saveInventoryEstimate = (auth: string, planId: string, estimate: InventoryEstimateInput) =>
  send(inventoryEstimatesPath(planId), auth, 'PUT', estimate)

export const saveInventoryEstimateNote = (auth: string, planId: string, input: InventoryEstimateNote) =>
  request<InventoryEstimateNote>(`/api/plans/${encodeURIComponent(planId)}/inventory-review/estimate-note`, auth, 'PUT', input)

const inventoryRecipesPath = (planId: string, productName: string) =>
  `/api/plans/${encodeURIComponent(planId)}/inventory-review/recipes?${new URLSearchParams({ productName })}`

export const fetchInventoryRecipes = (auth: string, planId: string, productName: string, signal: AbortSignal) =>
  request<InventoryRecipe[]>(inventoryRecipesPath(planId, productName), auth, 'GET', undefined, signal)

export const saveInventoryRecipe = (auth: string, planId: string, productName: string, recipe: InventoryRecipe) =>
  request<InventoryRecipe>(inventoryRecipesPath(planId, productName), auth, 'PUT', recipe)

export function fetchInventoryWeather(auth: string, planId: string, date: string, productName: string, excludedDates: string[], signal: AbortSignal) {
  const params = new URLSearchParams({ date })
  if (productName) params.set('productName', productName)
  for (const day of excludedDates) params.append('excludedDates', day)
  return request<InventoryWeather>(`/api/plans/${encodeURIComponent(planId)}/inventory-review/forecast?${params}`, auth, 'GET', undefined, signal)
}

export type StoreInput = {
  name: string
  address: string
  addressSource: 'SEARCH' | 'MANUAL'
  areaCode: string
  industryCode: string
  customIndustryName?: string
}
export type Store = StoreInput & { id: string; areaName: string; createdAt: string; menuCount: number }
type ApiTimeSeries = { metric: 'COUNT' | 'AMOUNT'; rows: TimeSeries['rows'] }
type SavedAnalysis = {
  id: string
  storeId: string
  name?: string
  createdAt: string
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
  const multipart = body instanceof FormData
  if (body !== undefined && !multipart) headers.set('Content-Type', 'application/json')
  const response = await fetch(path, { method, headers, body: multipart ? body : JSON.stringify(body), signal, cache: 'no-store', credentials: authorization ? 'same-origin' : 'omit' })
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

export const fetchPushConfig = (auth: string, signal: AbortSignal) =>
  request<{ publicKey: string | null; weeklyEnabled: boolean; resultEnabled: boolean; weeklySchedule: string }>(
    '/api/push/config', auth, 'GET', undefined, signal)

export const enableWeeklyPosPush = (auth: string, subscription: PushSubscriptionJSON) =>
  send('/api/push/weekly-subscription', auth, 'PUT', subscription)

export const disableWeeklyPosPush = (auth: string) =>
  send('/api/push/weekly-subscription', auth, 'DELETE')

export const enableResultPush = (auth: string, subscription: PushSubscriptionJSON) =>
  send('/api/push/result-subscription', auth, 'PUT', subscription)

export const disableResultPush = (auth: string) =>
  send('/api/push/result-subscription', auth, 'DELETE')

export const sendPushTest = (auth: string, subscription: PushSubscriptionJSON) =>
  request<{ delaySeconds: number }>('/api/push/test', auth, 'POST', subscription)

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

export type OwnerSession = { email: string; name: string }
export const ownerSession = 'session'
export const signupOwner = (name: string, email: string, password: string) =>
  request<OwnerSession>('/api/session/signup', ownerSession, 'POST', { name, email, password })
export const loginOwner = (email: string, password: string) =>
  request<OwnerSession>('/api/session', basicAuthorization(email, password), 'POST')
export const fetchOwnerSession = (signal: AbortSignal) =>
  request<OwnerSession>('/api/session', ownerSession, 'GET', undefined, signal)
export const updateOwnerName = (name: string) =>
  request<OwnerSession>('/api/session/profile', ownerSession, 'PATCH', { name })
export async function updateOwnerPassword(currentPassword: string, newPassword: string) {
  await send('/api/session/password', ownerSession, 'PUT', { currentPassword, newPassword })
}
export const logoutOwner = () => send('/api/session', ownerSession, 'DELETE')

type StorePromotionTone = { tone: PromotionTone | null; avoidPhrases: string }
const storePromotionTonePath = (id: string) => `/api/stores/${encodeURIComponent(id)}/promotion-tone`
export const fetchStorePromotionTone = (auth: string, id: string, signal: AbortSignal) =>
  request<StorePromotionTone>(storePromotionTonePath(id), auth, 'GET', undefined, signal)
export const saveStorePromotionTone = (auth: string, id: string, settings: { tone: PromotionTone; avoidPhrases: string }) =>
  request<StorePromotionTone>(storePromotionTonePath(id), auth, 'PUT', settings)

export const listStores = (auth: string, signal?: AbortSignal) => request<Store[]>('/api/stores', auth, 'GET', undefined, signal)
export type PosFileKind = 'PAYMENT' | 'PRODUCT'
export type StoredPosFile = {
  id: string; kind: PosFileKind; filename: string; size: number; uploadedAt: string
  coverageStart?: string | null; coverageEnd?: string | null
  calendarDate?: string | null
}
const posFilesPath = (storeId: string) => `/api/stores/${encodeURIComponent(storeId)}/pos-files`
const posFilePath = (storeId: string, fileId: string) => `${posFilesPath(storeId)}/${encodeURIComponent(fileId)}`
export const updatePosFileCoverage = (auth: string, storeId: string, fileId: string, coverageStart: string, coverageEnd: string) =>
  request<StoredPosFile>(posFilePath(storeId, fileId), auth, 'PATCH', { coverageStart, coverageEnd })
export const listPosFiles = (auth: string, storeId: string, signal: AbortSignal) =>
  request<StoredPosFile[]>(posFilesPath(storeId), auth, 'GET', undefined, signal)
export function uploadPosFile(auth: string, storeId: string, kind: PosFileKind, file: File,
  options: { calendarDate?: string; coverage?: PromotionImpactPeriod } = {}) {
  const body = new FormData()
  body.append('kind', kind)
  body.append('file', file)
  if (options.calendarDate) body.append('calendarDate', options.calendarDate)
  if (options.coverage) {
    body.append('coverageStart', options.coverage.start)
    body.append('coverageEnd', options.coverage.end)
  }
  return request<StoredPosFile>(posFilesPath(storeId), auth, 'POST', body)
}
export async function readStoredPosFile(auth: string, storeId: string, file: StoredPosFile, signal?: AbortSignal) {
  const content = await (await send(posFilePath(storeId, file.id), auth, 'GET', undefined, signal)).blob()
  return new File([content], file.filename, { type: content.type })
}
export const deletePosFile = (auth: string, storeId: string, fileId: string) =>
  send(posFilePath(storeId, fileId), auth, 'DELETE')

export type StoreAnalysisSummary = {
  id: string
  name?: string | null
  beforeMonth: string
  afterMonth: string
  concern?: string | null
  createdAt: string
  plans: { id: string; title?: string | null; startDate: string; endDate: string; hasResult: boolean }[]
}
export const deleteAnalysis = (auth: string, id: string) =>
  send(`/api/analyses/${encodeURIComponent(id)}`, auth, 'DELETE')

export const deleteExecutionPlan = (auth: string, id: string) =>
  send(`/api/plans/${encodeURIComponent(id)}`, auth, 'DELETE')

export const listStoreAnalyses = (auth: string, storeId: string, signal: AbortSignal) =>
  request<StoreAnalysisSummary[]>(`/api/stores/${encodeURIComponent(storeId)}/analyses`, auth, 'GET', undefined, signal)

export type ExecutionReminder = {
  planId: string; analysisId: string; storeId: string; storeName: string; title?: string | null
  endDate: string; promotion: boolean; hasSalesResult: boolean
}
export const fetchExecutionReminders = (auth: string, signal: AbortSignal) =>
  request<ExecutionReminder[]>('/api/execution-reminders', auth, 'GET', undefined, signal)

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
export type QuestionInput = { clientMessageId: string; conversationId?: string; chart: QuestionChart; question: string; planId?: string; startFromChart?: boolean }
export function fetchQuestions(auth: string, id: string, signal: AbortSignal) {
  return request<{ conversationId: string | null; turns: QuestionTurn[] }>(`/api/analyses/${encodeURIComponent(id)}/questions`, auth, 'GET', undefined, signal)
}
export function sendQuestion(auth: string, id: string, input: QuestionInput) {
  return request<QuestionTurn>(`/api/analyses/${encodeURIComponent(id)}/questions`, auth, 'POST', input)
}
export const listAreas = (signal: AbortSignal) => request<Area[]>('/api/areas', undefined, 'GET', undefined, signal)
export const registerStore = (auth: string, input: StoreInput) => request<Store>('/api/stores', auth, 'POST', input)

export type ConcernCheck = {
  status: 'COMPARED' | 'GUIDANCE' | 'MISSING_DATA' | 'CLARIFICATION_REQUIRED' | 'UNAVAILABLE'
  question?: string | null
  detail?: string
  answer?: string
  metric?: 'AMOUNT' | 'COUNT' | 'PRODUCT' | 'PRODUCT_REVENUE'
  productName?: string | null
  startHour?: number
  endHour?: number
  beforeMonth?: string
  afterMonth?: string
  before?: number
  after?: number
  changeRate?: number | null
  posMonths?: [string, string]
}

export async function checkConcern(auth: string, id: string, signal: AbortSignal) {
  const response = await request<ConcernCheck | { results: ConcernCheck[] }>(
    `/api/analyses/${encodeURIComponent(id)}/concern-check`, auth, 'POST', undefined, signal,
  )
  return 'results' in response ? response.results : [response]
}

export async function attachHourlySales(auth: string, id: string, hourlySales: import('../data/pos').HourlySales, signal: AbortSignal) {
  await send(`/api/analyses/${encodeURIComponent(id)}/hourly-sales`, auth, 'PUT', hourlySales, signal)
}

function toApiTimeSeries(value: TimeSeries): ApiTimeSeries {
  return { metric: value.metric === 'count' ? 'COUNT' : 'AMOUNT', rows: value.rows }
}

export function saveAnalysis(auth: string, storeId: string, monthlySales: MonthlySales[], concern: string, name: string,
  timeSeries?: TimeSeries, productSales?: ProductSale[], hourlySales?: import('../data/pos').HourlySales) {
  return request<SavedAnalysis>(`/api/stores/${storeId}/analyses`, auth, 'POST', {
    monthlySales, name: name || undefined, concern: concern || undefined,
    timeSeries: timeSeries && toApiTimeSeries(timeSeries), productSales, hourlySales,
  })
}

export async function fetchAnalysis(auth: string, id: string, signal: AbortSignal): Promise<Analysis> {
  const saved = await request<SavedAnalysis>(`/api/analyses/${encodeURIComponent(id)}`, auth, 'GET', undefined, signal)
  const store = (await listStores(auth, signal)).find(({ id }) => id === saved.storeId)
  if (!store) throw new Error('분석에 연결된 매장을 찾을 수 없어요.')
  return {
    store: store.name, storeId: store.id, name: saved.name, createdAt: saved.createdAt,
    address: store.address, area: store.areaName,
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

export type StrategyCode = 'OUTREACH' | 'PROMOTION' | 'INVENTORY' | 'CUSTOM'
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
  marketing?: boolean
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
  steps?: string[]
  executionGuide?: ExecutionGuide
  customerNotice?: CustomerNotice
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

export const strategyIds = { OUTREACH: 'outreach', PROMOTION: 'promotion', INVENTORY: 'inventory', CUSTOM: 'custom' } as const

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
  recommendationId?: string, executionGuideId?: string, customerNotice?: CustomerNotice, optionIndex?: number) {
  return request<SavedPlan>(`/api/analyses/${encodeURIComponent(id)}/plans`, auth, 'POST',
    { strategyCode, conditions, recommendationId, executionGuideId, customerNotice, optionIndex })
}

export type StoreNoticeDraft = { title: string; message: string }

export function generateStoreNotice(auth: string, planId: string, template: string, values: Record<string, string>, signal: AbortSignal) {
  return request<StoreNoticeDraft>(`/api/plans/${encodeURIComponent(planId)}/store-notice`, auth, 'POST', { template, values }, signal)
}

export function fetchPlan(auth: string, id: string, signal: AbortSignal) {
  return request<SavedPlan>(`/api/plans/${encodeURIComponent(id)}`, auth, 'GET', undefined, signal)
}

export function saveInventoryReview(auth: string, id: string, items: InventoryItem[]) {
  return request<InventoryItem[]>(`/api/plans/${encodeURIComponent(id)}/inventory-review`, auth, 'PUT',
    items.map(({ shortage: _shortage, ...input }) => input))
}

export type PromotionDefaults = { budgetWon: number | null; costs: { productName: string; costWon: number }[] }

export function fetchPromotionDefaults(auth: string, id: string, signal: AbortSignal) {
  return request<PromotionDefaults>(`/api/plans/${encodeURIComponent(id)}/promotion-review/defaults`, auth, 'GET', undefined, signal)
}

export function savePromotionReview(auth: string, id: string, input: PromotionReviewInput) {
  return request<PromotionReview>(`/api/plans/${encodeURIComponent(id)}/promotion-review`, auth, 'PUT', input)
}

type MenuPhoto = { photoDataUrl: string | null }
type MenuPhotoStatus = { productName: string; hasPhoto: boolean }

export function createPromotionDraft(auth: string, id: string, input: PromotionDraftInput) {
  return request<PromotionDraft>(`/api/plans/${encodeURIComponent(id)}/promotion-draft`, auth, 'POST', input)
}

export function regeneratePromotionCaption(auth: string, id: string, tone: PromotionTone) {
  return request<PromotionDraft>(`/api/plans/${encodeURIComponent(id)}/promotion-draft/caption`, auth, 'POST', {tone})
}

export function fetchPromotionReviewPoints(auth: string, id: string, subject: string, signal: AbortSignal, refresh: boolean) {
  return request<PromotionReviewResearch>(`/api/plans/${encodeURIComponent(id)}/promotion-review-points`, auth, 'POST', { subject, refresh }, signal)
}

export function fetchPromotionPhoto(auth: string, id: string, signal: AbortSignal, subject?: string) {
  const query = subject ? '?' + new URLSearchParams({ subject }) : ''
  return request<MenuPhoto & { defaultTone: PromotionTone | null }>(`/api/plans/${encodeURIComponent(id)}/promotion-photo${query}`, auth, 'GET', undefined, signal)
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

export type PromotionChannel = 'INSTAGRAM' | 'NAVER' | 'DAANGN'
export type PromotionPublication = {
  channel: PromotionChannel
  publishedDate: string
  automatic: boolean
}
type ManualPromotionPublication = {
  channel: PromotionChannel
  publishedDate: string
  productName: string
}
export type ManualPromotionPublicationStatus = {
  publications: Partial<Record<PromotionChannel, ManualPromotionPublication>>
  productName: string | null
}
export type PromotionImpactPeriod = { start: string; end: string }
export type PromotionImpactTotals = { quantity: number; amount: number; recordedDays: number }
export type NextPromotionChecklistItem = 'DISCOUNT_QUANTITY' | 'ACTUAL_COST' | 'UPLOAD_POS'
export type PromotionImpactAdvice = {
  action: 'RETEST' | 'KEEP_TERMS' | 'REVIEW_TERMS' | 'CHECK_DATA'
  beforeAveragePrice: number | null
  afterAveragePrice: number | null
}
export type PromotionActuals = { discountedQuantity: number; beforeUnitCost: number; afterUnitCost: number }
export type PromotionProfit = { beforeWon: number; afterWon: number; changeWon: number }
export type PromotionImpact = {
  productName: string | null
  publication: PromotionPublication | null
  publications: PromotionPublication[]
  before: PromotionImpactPeriod | null
  after: PromotionImpactPeriod | null
  beforeTotals: PromotionImpactTotals | null
  afterTotals: PromotionImpactTotals | null
  afterReady: boolean
  message: string | null
  advice: PromotionImpactAdvice | null
  actuals: PromotionActuals | null
  profit: PromotionProfit | null
  nextChecklist: Partial<Record<NextPromotionChecklistItem, boolean>> | null
}
const promotionImpactPath = (planId: string) => `/api/plans/${encodeURIComponent(planId)}/promotion-impact`
export const fetchManualPromotionPublication = (auth: string, planId: string, signal: AbortSignal) =>
  request<ManualPromotionPublicationStatus>(promotionImpactPath(planId) + '/publication', auth, 'GET', undefined, signal)
export const saveManualPromotionPublication = (auth: string, planId: string,
  input: { channel: PromotionChannel; publishedDate: string; productName?: string }) =>
  request<ManualPromotionPublicationStatus>(promotionImpactPath(planId) + '/publication', auth, 'PUT', input)
export const fetchPromotionImpact = (auth: string, planId: string, signal: AbortSignal) =>
  request<PromotionImpact>(promotionImpactPath(planId), auth, 'GET', undefined, signal)
export const savePromotionImpact = (auth: string, planId: string,
  input: PromotionImpactPeriod & PromotionImpactTotals & {phase: 'BEFORE' | 'AFTER'; productName: string; onlyIfMissing?: boolean},
  signal?: AbortSignal) =>
  request<PromotionImpact>(promotionImpactPath(planId), auth, 'PUT', input, signal)

export type NextPromotionExplanation = {
  input: { before: PromotionImpactTotals; after: PromotionImpactTotals; advice: PromotionImpactAdvice; actuals: PromotionActuals | null; profit: PromotionProfit | null }
  explanation: string | null
}
export const fetchNextPromotionExplanation = (auth: string, planId: string, signal: AbortSignal) =>
  request<NextPromotionExplanation>(promotionImpactPath(planId) + '/next-explanation', auth, 'GET', undefined, signal)

export const savePromotionActuals = (auth: string, planId: string, actuals: PromotionActuals) =>
  request<PromotionImpact>(promotionImpactPath(planId) + '/actuals', auth, 'PUT', actuals)

export function createNextPromotionPlan(auth: string, planId: string, requestId: string, input: {
  action: 'KEEP_TERMS' | 'REVIEW_TERMS'; startDate: string; discountWon: number; maxDiscountQuantity: number
}) {
  return request<SavedPlan>(promotionImpactPath(planId) + '/next-plan/' + encodeURIComponent(requestId), auth, 'PUT', input)
}

export const saveNextPromotionChecklist = (auth: string, planId: string,
  update: { item: NextPromotionChecklistItem; completed: boolean } | Record<string, never>) =>
  request<PromotionImpact>(promotionImpactPath(planId) + '/next-checklist', auth, 'PUT', update)

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
    marketing: strategy.marketing,
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
    customerNotice: strategy.customerNotice,
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
