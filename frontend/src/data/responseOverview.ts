import type { Analysis, Plan } from './shop'
import type { InventoryEstimateComparison } from '../api/shop'
import type { ExecutionOutcome } from './executionOutcome'

// Rank by observed revenue, never by a price multiplied into historical quantities.
export function largestMenuDecline(data: Analysis) {
  return data.productSales?.filter(row => row.beforeRevenue != null && row.afterRevenue != null && row.beforeRevenue > row.afterRevenue)
    .sort((a, b) => (b.beforeRevenue! - b.afterRevenue!) - (a.beforeRevenue! - a.afterRevenue!))[0]
}

export function largestTimeDecline(data: Analysis) {
  return data.timeSeries?.rows.filter(row => row.before > row.after)
    .sort((a, b) => (b.before - b.after) - (a.before - a.after))[0]
}

export function analysisMaterial(data: Analysis) {
  // A historical date alone does not mean the owner's data is simulated.
  return data.demo || /가상|SIMULATED/i.test(data.name ?? '') ? '가상 시연 POS' : '매장 입력 · 실제/가상 미확인'
}

export type OverviewPlan = {
  plan: Plan & { id: string }
  outcome?: ExecutionOutcome | null
  pendingUntil?: string | null
  estimates?: InventoryEstimateComparison[]
  errors: string[]
}

export function matchingEstimate(row: OverviewPlan) {
  const target = row.outcome?.inventory
  const candidates = row.estimates?.filter(item => item.currentPlan) ?? []
  if (target) return candidates.find(item => item.estimate.date === target.date && item.estimate.product === target.product)?.estimate
  return candidates.sort((a, b) => b.estimate.date.localeCompare(a.estimate.date) || b.estimate.savedAt.localeCompare(a.estimate.savedAt))[0]?.estimate
}

export function planChoices(rows: OverviewPlan[], kind: 'inventory' | 'promotion') {
  return rows.filter(({ plan }) => kind === 'inventory' ? plan.strategy === 'inventory'
    : plan.strategy !== 'inventory' && (plan.marketing || plan.strategy === 'promotion' || plan.promotionDraft))
    .sort((a, b) => Number(Boolean(b.outcome)) - Number(Boolean(a.outcome))
      || Number(Boolean(b.plan.promotionDraft)) - Number(Boolean(a.plan.promotionDraft))
      || b.plan.startDate.localeCompare(a.plan.startDate) || a.plan.id.localeCompare(b.plan.id))
}
