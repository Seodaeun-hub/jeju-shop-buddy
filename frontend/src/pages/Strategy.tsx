import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { createPlan, generateRecommendation, strategyIds, toPlan } from '../api/shop'
import type { SavedStrategy, StrategyEvidence, StrategyResponse } from '../api/shop'
import { CustomerNoticeDetails, suggestCustomerNotice } from '../components/CustomerNotice'
import { addDays, changeRate, formatNumber, formatRate, monthLabel, strategies, won } from '../data/shop'
import { bsiSource, marketSource } from '../data/marketSources'
import { formatEvidence } from '../data/strategyEvidence'
import { ExecutionGuidePanel } from '../components/ExecutionGuidePanel'
import type { Analysis, Plan, TimeSeries } from '../data/shop'
import '../styles/strategy.css'

type StrategyId = Plan['strategy']
const initialBudget = 50_000
type StrategyCard = {
  marketing?: boolean
  name: string
  observation: string
  evidence?: { text: string; source: StrategyEvidence['source'] }[]
  reason: string
  followUp: string
  nextAction?: string
  steps?: string[]
  status?: SavedStrategy['status']
}

export function SavedStrategyPage({ auth, analysisId, data, backTo, onPlan }: {
  auth: string
  analysisId: string
  data: Analysis
  backTo: string
  onPlan: (value: Plan) => void
}) {
  const [response, setResponse] = useState<StrategyResponse>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    generateRecommendation(auth, analysisId, controller.signal).then((value) => {
      if (!controller.signal.aborted) setResponse(value)
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setError(error.message)
    })
    return () => controller.abort()
  }, [auth, analysisId, retry])

  if (response?.strategies.length) return <Strategy key={response.recommendationId ?? analysisId}
    data={data} backTo={backTo} onPlan={onPlan} saved={{ auth, analysisId, response }} />

  return <section className="empty-state">
      {error ? <><p className="error" role="alert">{error}</p><button className="button secondary" onClick={() => {
        setError('')
        setRetry((value) => value + 1)
      }}>다시 불러오기</button></> : <p role="status">{response ? '조회된 전략이 없어요.' : '저장한 분석의 대응 전략을 불러오는 중이에요.'}</p>}
      <Link className="strategy-back" to={backTo}>← 매출 분석 다시 보기</Link>
  </section>
}

const taskTemplates: Record<Exclude<StrategyId, 'custom'>, string[]> = {
  promotion: ['혜택과 예산 확정', '행사 소식 올리기', '중간 결제 건수 점검', '행사 종료 및 매출 자료 준비'],
  outreach: ['실제 주문 가능 시간 확인', '매장 입구와 메뉴판 안내 확인', '안내가 다르면 문구 수정', '안내 후 매출 흐름 확인'],
  inventory: ['점검할 품목과 재고 확인', '최근 사용량과 입고 예정량 기록', '다음 발주량 검토', '사용량과 남은 재고 다시 확인'],
}

function getStrategyEvidence(data: Analysis) {
  const [before, after] = data.monthly.slice(-2)
  const rate = changeRate(before.amount, after.amount)
  const salesFell = after.amount < before.amount
  const monthlyAmounts = `${monthLabel(before.month)} ${won(before.amount)} → ${monthLabel(after.month)} ${won(after.amount)}`
  const monthlyChange = rate === null ? monthlyAmounts : `${monthlyAmounts} (${formatRate(rate)})`
  const series = data.timeSeries
  const drop = series?.rows.reduce<TimeSeries['rows'][number] | undefined>((largest, row) => {
    const decrease = row.before - row.after
    return decrease > (largest ? largest.before - largest.after : 0) ? row : largest
  }, undefined)
  const unit = series?.metric === 'count' ? '결제 건수' : '매출액'
  const format = series?.metric === 'count' ? (value: number) => `${formatNumber(value)}건` : won
  const timeChange = drop ? `${drop.label} ${unit} ${format(drop.before)} → ${format(drop.after)}` : undefined
  const recommendation: StrategyId | undefined = drop ? 'promotion' : salesFell ? 'outreach' : undefined
  const promotionName = drop ? `${drop.label} 한정 프로모션` : strategies[0].name

  return {
    summary: timeChange ?? monthlyAmounts,
    change: drop ? `−${format(drop.before - drop.after)}` : rate === null ? undefined : formatRate(rate),
    recommendation,
    timeLabel: drop?.label,
    timeMetric: unit,
    cards: {
      promotion: {
        name: promotionName,
        observation: timeChange ?? (series
          ? '입력한 시간대 중 감소한 구간이 없어요.'
          : `${monthlyChange} · 시간대별 자료 없음`),
        reason: drop
          ? '감소 폭이 가장 큰 구간에만 혜택을 주고 반응을 살펴봐요.'
          : '혜택을 줄 시간대를 정하려면 시간대별 자료나 사장님의 현장 판단이 필요해요.',
        followUp: `같은 요일·시간대의 영업일 하루 평균 ${unit} 변화를 비교해요.`,
      },
      outreach: {
        name: strategies[1].name,
        observation: monthlyChange,
        reason: salesFell
          ? '매출이 줄어든 상황에서 메뉴나 영업 소식을 알리고 반응을 살펴봐요.'
          : '현재 매출을 기준으로 메뉴나 영업 소식을 알린 뒤 반응을 살펴봐요.',
        followUp: '게시 후 같은 요일의 하루 평균 매출을 이전과 비교해요.',
      },
      inventory: {
        name: strategies[2].name,
        observation: monthlyChange,
        reason: salesFell
          ? '매출이 줄어든 뒤에도 이전과 같은 양을 발주하고 있는지 품목별로 점검해요.'
          : '현재 매출 추이와 품목별 사용량을 함께 보며 다음 발주량을 점검해요.',
        followUp: '다음 발주 전에 품목별 발주량을 점검해요.',
      },
    },
  }
}

export function Strategy({ data, onPlan, backTo = '/analysis', saved }: {
  data: Analysis
  onPlan: (value: Plan) => void
  backTo?: string
  saved?: { auth: string; analysisId: string; response: StrategyResponse }
}) {
  const demo = saved ? undefined : getStrategyEvidence(data)
  const cards: { id: StrategyId; card: StrategyCard }[] = saved
    ? saved.response.strategies.map((strategy) => ({
      id: strategyIds[strategy.code],
      card: {
        name: strategy.title,
        marketing: strategy.marketing,
        observation: formatEvidence(strategy.evidence[0], saved.response.beforeMonth, saved.response.afterMonth),
        evidence: strategy.evidence.map((item) => ({
          source: item.source,
          text: formatEvidence(item, saved.response.beforeMonth, saved.response.afterMonth),
        })),
        reason: strategy.reason, followUp: strategy.followUp, nextAction: strategy.nextAction, steps: strategy.steps,
        status: strategy.status,
      },
    }))
    : strategies.map(({ id }) => ({ id, card: demo!.cards[id] }))
  const recommendedIndex = cards.findIndex(({ id, card }) => saved ? card.status === 'RECOMMENDED' : id === demo?.recommendation)
  const [selectedIndex, setSelectedIndex] = useState<number>()
  const selection = selectedIndex === undefined ? undefined : cards[selectedIndex]
  const choice = selection?.id
  const selected = selection?.card
  const settingsDialog = useRef<HTMLDialogElement>(null)
  const settingsHeading = useRef<HTMLHeadingElement>(null)
  const [duration, setDuration] = useState('2주')
  const [viewedGuideId, setViewedGuideId] = useState<string>()
  const planBudget = choice === 'promotion' ? initialBudget : 0
  const [channel, setChannel] = useState('인스타그램')
  const planChannel = choice === 'outreach' ? '매장 안내' : channel
  const [customerConcern, setCustomerConcern] = useState('')
  const customerNotice = suggestCustomerNotice(customerConcern)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const mounted = useRef(false)
  const summary = demo?.summary ?? (cards[recommendedIndex] ?? cards[0]).card.observation
  const response = saved?.response
  const bsi = response?.contextEvidence?.find(({ source }) => source === 'JEJU_BSI')
  const hasPosPrices = data.productSales?.some(product => product.priceWon != null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const dialog = settingsDialog.current
    if (selectedIndex === undefined || !dialog || dialog.open) return
    dialog.showModal()
    settingsHeading.current?.focus({ preventScroll: true })
  }, [selectedIndex])

  function chooseStrategy(index: number) {
    setError('')
    setDuration('2주')
    setViewedGuideId(undefined)
    setChannel('인스타그램')
    setCustomerConcern('')
    setSelectedIndex(index)
  }

  function closeSettings() {
    if (!pending.current) settingsDialog.current?.close()
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!choice || !selected) return
    const durationWeeks = Number.parseInt(duration, 10)
    if (saved) {
      if (pending.current) return
      const selectedStrategy = selectedIndex === undefined ? undefined : saved.response.strategies[selectedIndex]
      if (!selectedStrategy) return
      pending.current = true
      setSaving(true)
      setError('')
      try {
        const plan = await createPlan(saved.auth, saved.analysisId, selectedStrategy.code, choice === 'inventory' || choice === 'custom'
          ? { durationWeeks }
          : { durationWeeks, budgetWon: planBudget, channel: planChannel === '인스타그램' ? 'INSTAGRAM' : 'STORE_NOTICE' },
          saved.response.recommendationId, choice === 'outreach' ? viewedGuideId : undefined,
          choice === 'custom' ? undefined : customerNotice, choice === 'custom' ? selectedIndex : undefined)
        if (mounted.current) onPlan(toPlan(plan, data.store))
      } catch (error) {
        if (mounted.current) setError(error instanceof Error ? error.message : '실행 계획을 저장할 수 없어요.')
      } finally {
        pending.current = false
        if (mounted.current) setSaving(false)
      }
      return
    }
    if (choice === 'custom') return
    const days = durationWeeks * 7
    const preparationDate = '2021-06-01'
    const startDate = choice === 'outreach' ? addDays(preparationDate, 2) : preparationDate
    const endDate = addDays(startDate, days - 1)
    const offsets = choice === 'outreach' ? [0, 1, 1, days + 1] : [0, 1, Math.floor(days / 2), days - 1]
    const taskLabels = [...taskTemplates[choice]]
    if (choice === 'promotion') {
      taskLabels[1] = channel === '인스타그램' ? '인스타그램에 소식 올리기' : '매장에 행사 안내 붙이기'
      taskLabels[2] = '중간 ' + (demo?.timeLabel ? demo.timeMetric : '행사 시간대 매출액') + ' 점검'
    }
    onPlan({
      strategy: choice,
      title: selected.name,
      store: data.store,
      demo: data.demo,
      duration,
      customerNotice,
      startDate,
      endDate,
      timeLabel: demo?.timeLabel,
      followUp: selected.followUp,
      budget: choice === 'inventory' ? 0 : planBudget,
      channel: choice === 'inventory' ? '' : planChannel,
      tasks: taskLabels.map((label, index) => ({ label, date: addDays(preparationDate, offsets[index]) })),
      done: [],
    })
  }

  return <>
    <section className="strategy-summary" aria-labelledby="strategy-summary-title">
      <div className="strategy-summary-heading">
        <h2 id="strategy-summary-title">짝꿍이 찾은 변화</h2>
        {response?.recommendationSource && <span>{response.recommendationSource === 'AGENT' ? 'AI 추천' : '기본 추천'}</span>}
      </div>
      <p className="strategy-summary-detail">{summary} {demo?.change && <strong>{demo.change}</strong>}</p>
      {response && bsi && <details className="strategy-market-context">
        <summary>제주 경기동향 참고</summary>
        <p>{formatEvidence(bsi, response.beforeMonth, response.afterMonth)} · <a href={bsiSource}>소상공인시장진흥공단</a></p>
      </details>}
    </section>
    <div className="strategy-layout">
      <section className="strategy-options" aria-labelledby="strategy-options-title">
        <h2 id="strategy-options-title">어떤 전략을 해볼까요?</h2>
        {cards.map(({ id, card }, index) => {
          const cardId = id === 'custom' ? `custom-${index}` : id
          const selectedCard = selectedIndex === index
          const check = id === 'custom' ? card.nextAction : id === 'outreach' ? '실제 주문 가능 시간과 마감 시간이 매장 안내와 같은지 확인해요.'
            : id === 'promotion' ? (hasPosPrices ? '혜택을 줄 시간대와 메뉴를 확인해요.' : '혜택을 줄 시간대와 메뉴 판매가를 확인해요.')
              : '이번에 발주량을 검토할 품목을 확인해요.'
          return <article key={cardId} className={selectedCard ? 'strategy-choice is-selected' : 'strategy-choice'}>
            <div className="strategy-choice-heading">
              <h3 id={`strategy-title-${cardId}`}>{card.name}</h3>
              {recommendedIndex === index && <span className="strategy-recommended">추천</span>}
            </div>
            <button className="button secondary small strategy-choose" type="button" disabled={saving}
              aria-haspopup="dialog" aria-labelledby={`strategy-title-${cardId} strategy-action-${cardId}`}
              onClick={() => chooseStrategy(index)}><span id={`strategy-action-${cardId}`}>선택하기</span></button>
            <dl className="strategy-card-summary">
              <div><dt>{recommendedIndex === index ? '추천 이유' : '제안 이유'}</dt><dd>{card.reason}</dd></div>
              <div><dt>지금 확인할 것</dt><dd>{check}</dd></div>
            </dl>
            <details className="source-details strategy-rationale">
              <summary>근거와 출처 보기</summary>
              <dl className="reason strategy-evidence">
                <dt>확인한 변화</dt>
                <dd>{card.evidence?.length ? <ul className="strategy-evidence-list">
                  {card.evidence.map(({ text, source }) => <li key={text}>{text}
                    {source === 'MARKET_CARD_SALES' && <> · <a href={marketSource}>제주데이터허브</a></>}
                    {source === 'JEJU_BSI' && <> · <a href={bsiSource}>소상공인시장진흥공단</a></>}
                  </li>)}
                </ul> : card.observation}</dd>
                {id !== 'custom' && card.nextAction && <><dt>이어서 할 일</dt><dd>{card.nextAction}</dd></>}
                <dt>실행 후 확인</dt><dd>{card.followUp}</dd>
              </dl>
            </details>
          </article>
        })}
        <Link className="strategy-back" to={backTo}>← 매출 분석 다시 보기</Link>
      </section>
    </div>
    {selected && <dialog className="strategy-settings" ref={settingsDialog}
      aria-labelledby="strategy-settings-title" aria-describedby="strategy-settings-strategy"
      onCancel={event => { event.preventDefault(); closeSettings() }} onClose={() => setSelectedIndex(undefined)}>
      <form className="strategy-settings-form" onSubmit={submit}>
        <header className="strategy-settings-heading">
          <div>
            <h2 id="strategy-settings-title" tabIndex={-1} ref={settingsHeading}>실행 조건 정하기</h2>
            <p id="strategy-settings-strategy">{selected.name}</p>
          </div>
          <button className="button secondary small" type="button" disabled={saving} onClick={closeSettings}>닫기</button>
        </header>
        <div className="strategy-settings-body form-stack">
          <label className={choice === 'outreach' ? 'notice-review-period' : undefined}>
            <span>{choice === 'outreach' ? '안내 수정 후 확인할 기간' : '실행 기간'}</span>
            <select name="duration" value={duration} onChange={(event) => setDuration(event.target.value)} disabled={saving}>
              <option>1주</option><option>2주</option><option>4주</option>
            </select>
          </label>
          {choice === 'outreach' && <p className="muted">처음 이틀은 주문 시간과 안내문을 점검하고 수정해요. 이후 선택한 기간 동안 결제 건수나 매출 흐름을 확인해요.</p>}
          {choice === 'outreach' && saved && <ExecutionGuidePanel
            auth={saved.auth} analysisId={saved.analysisId} recommendationId={saved.response.recommendationId}
            onView={setViewedGuideId} />}
          {choice === 'promotion' && <label>홍보 채널<select disabled={saving} value={channel} onChange={(event) => setChannel(event.target.value)}><option>인스타그램</option><option>매장 안내</option></select></label>}
          {choice === 'custom' ? <div className="strategy-output">
            <strong>실행 점검표 미리보기</strong>
            <ol>{selected.steps?.map(step => <li key={step}>{step}</li>)}</ol>
            {selected.marketing && <p>실행 관리에서 홍보 문구와 이미지를 만들 수 있어요.</p>}
          </div> : <>
            <label className="customer-concern-field">
              <span>손님들이 자주 겪는 불편 <span className="muted">(선택)</span></span>
              <input value={customerConcern} onChange={(event) => setCustomerConcern(event.target.value)}
                placeholder="예: 오후에도 주문이 되는지 손님들이 자주 물어봐요" maxLength={200} disabled={saving} />
            </label>
            {customerNotice && <section className="notice" aria-label="짝꿍의 안내 제안">
              <strong>짝꿍의 안내 제안</strong>
              <CustomerNoticeDetails notice={customerNotice} />
            </section>}
            <div className="strategy-output">
              <strong>생성할 결과물</strong>
              <span>{choice === 'outreach' ? '실행 일정 · 주문 안내 점검표 · 안내 문구' : '실행 일정 · 점검표 · ' + (choice === 'inventory' ? '발주량 검토표' : selected.status === 'NEEDS_INPUT' ? '혜택 검토 항목' : '홍보 초안')}</span>
            </div>
          </>}
        </div>
        <footer className="strategy-settings-footer">
          {error && <p className="error" role="alert">{error}</p>}
          <button className="button primary strategy-submit" type="submit" disabled={saving}>{saving ? '계획 저장 중…' : '이 전략으로 계획 만들기'} <span aria-hidden="true">→</span></button>
        </footer>
      </form>
    </dialog>}
  </>
}
