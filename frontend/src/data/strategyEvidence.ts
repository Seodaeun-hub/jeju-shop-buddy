import type { StrategyEvidence } from '../api/shop'
import { formatNumber, monthLabel, won } from './shop'

export function formatEvidence(item: StrategyEvidence, beforeMonth: string, afterMonth: string) {
  if (item.source === 'MONTHLY_SALES') {
    return `월별 매출 · ${monthLabel(beforeMonth)} ${won(item.before)} → ${monthLabel(afterMonth)} ${won(item.after)}`
  }
  if (item.source === 'MARKET_CARD_SALES') {
    return `같은 읍·면·동·업종 카드 이용액 · ${monthLabel(beforeMonth)} ${won(item.before)} → ${monthLabel(afterMonth)} ${won(item.after)}`
  }
  if (item.source === 'JEJU_BSI') {
    return `제주 전체 소상공인 체감 BSI · ${monthLabel(beforeMonth)} ${item.before.toFixed(1)} → ${monthLabel(afterMonth)} ${item.after.toFixed(1)}`
  }
  const unit = item.metric === 'COUNT' ? '결제 건수' : '매출액'
  const format = item.metric === 'COUNT' ? (value: number) => `${formatNumber(value)}건` : won
  return `${item.label} ${unit} · ${monthLabel(beforeMonth)} ${format(item.before)} → ${monthLabel(afterMonth)} ${format(item.after)}`
}
