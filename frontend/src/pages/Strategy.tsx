import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { createPlan, generateRecommendation, strategyIds, toPlan } from '../api/shop'
import type { SavedStrategy, StrategyEvidence, StrategyResponse } from '../api/shop'
import { Citrus, PageTitle } from '../components/ui'
import { addDays, changeRate, formatNumber, formatRate, monthLabel, strategies, won } from '../data/shop'
import { bsiSource, marketSource } from '../data/marketSources'
import { formatEvidence } from '../data/strategyEvidence'
import { ExecutionGuidePanel } from '../components/ExecutionGuidePanel'
import type { Analysis, Plan, TimeSeries } from '../data/shop'
import '../styles/strategy.css'

type StrategyId = Plan['strategy']
type StrategyCard = {
  name: string
  observation: string
  evidence?: { text: string; source: StrategyEvidence['source'] }[]
  reason: string
  followUp: string
  nextAction?: string
  status?: SavedStrategy['status']
  missingInputs?: string[]
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

  if (response?.strategies.length) return <Strategy data={data} backTo={backTo} onPlan={onPlan} saved={{ auth, analysisId, response }} />

  return <>
    <PageTitle title="대응 전략 선택" detail="우리 가게에 맞는 방법을 골라보세요." />
    <section className="empty-state">
      {error ? <><p className="error" role="alert">{error}</p><button className="button secondary" onClick={() => {
        setError('')
        setRetry((value) => value + 1)
      }}>다시 불러오기</button></> : <p role="status">{response ? '조회된 전략이 없어요.' : '저장한 분석의 대응 전략을 불러오는 중이에요.'}</p>}
      <Link className="strategy-back" to={backTo}>← 매출 분석 다시 보기</Link>
    </section>
  </>
}

const taskTemplates: Record<StrategyId, string[]> = {
  promotion: ['혜택과 예산 확정', '행사 소식 올리기', '중간 결제 건수 점검', '행사 종료 및 매출 자료 준비'],
  outreach: ['소개할 메뉴와 소식 정하기', '홍보 문구 확인하기', '가게 소식 올리기', '게시 결과 확인하기'],
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
        observation: `${monthlyChange} · 품목별 재고와 사용량 확인 필요`,
        reason: salesFell
          ? '매출이 줄어든 뒤에도 이전과 같은 양을 발주하고 있는지 품목별로 점검해요.'
          : '현재 매출 추이와 품목별 사용량을 함께 보며 다음 발주량을 점검해요.',
        followUp: '품목별 사용량·남은 재고·입고 예정량을 확인한 뒤 발주량을 검토해요.',
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
  const serverCards = saved?.response.strategies
  const recommended = serverCards?.find(({ status }) => status === 'RECOMMENDED')
  const cards: { id: StrategyId; card: StrategyCard }[] = saved
    ? saved.response.strategies.map((strategy) => ({
      id: strategyIds[strategy.code],
      card: {
        name: strategy.title,
        observation: formatEvidence(strategy.evidence[0], saved.response.beforeMonth, saved.response.afterMonth),
        evidence: strategy.evidence.map((item) => ({
          source: item.source,
          text: formatEvidence(item, saved.response.beforeMonth, saved.response.afterMonth),
        })),
        reason: strategy.reason, followUp: strategy.followUp, nextAction: strategy.nextAction,
        status: strategy.status, missingInputs: strategy.missingInputs,
      },
    }))
    : strategies.map(({ id }) => ({ id, card: demo!.cards[id] }))
  const recommendation = recommended ? strategyIds[recommended.code] : demo?.recommendation
  const [choice, setChoice] = useState<StrategyId>(recommendation ?? cards[0].id)
  const [budget, setBudget] = useState('50000')
  const [channel, setChannel] = useState('인스타그램')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const mounted = useRef(false)
  const selected = cards.find(({ id }) => id === choice)?.card ?? cards[0].card
  const summary = demo?.summary ?? (cards.find(({ id }) => id === recommendation) ?? cards[0]).card.observation
  const response = saved?.response
  const bsi = response?.contextEvidence?.find(({ source }) => source === 'JEJU_BSI')

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const duration = String(fields.get('duration'))
    const durationWeeks = Number.parseInt(duration, 10)
    if (saved) {
      if (pending.current) return
      const selectedStrategy = saved.response.strategies.find(({ code }) => strategyIds[code] === choice)
      if (!selectedStrategy) return
      pending.current = true
      setSaving(true)
      setError('')
      try {
        const plan = await createPlan(saved.auth, saved.analysisId, selectedStrategy.code, choice === 'inventory'
          ? { durationWeeks }
          : { durationWeeks, budgetWon: Number(budget), channel: channel === '인스타그램' ? 'INSTAGRAM' : 'STORE_NOTICE' },
          saved.response.recommendationId)
        if (mounted.current) onPlan(toPlan(plan, data.store))
      } catch (error) {
        if (mounted.current) setError(error instanceof Error ? error.message : '실행 계획을 저장할 수 없어요.')
      } finally {
        pending.current = false
        if (mounted.current) setSaving(false)
      }
      return
    }
    const days = durationWeeks * 7
    const startDate = '2021-06-01'
    const endDate = addDays(startDate, days - 1)
    const offsets = [0, 1, Math.floor(days / 2), days - 1]
    const taskLabels = [...taskTemplates[choice]]
    if (choice === 'promotion') {
      taskLabels[1] = channel === '인스타그램' ? '인스타그램에 소식 올리기' : '매장에 행사 안내 붙이기'
      taskLabels[2] = '중간 ' + (demo?.timeLabel ? demo.timeMetric : '행사 시간대 매출액') + ' 점검'
    } else if (choice === 'outreach') {
      taskLabels[2] = channel === '인스타그램' ? '인스타그램에 소식 올리기' : '매장에 안내 붙이기'
      if (channel === '매장 안내') taskLabels[3] = '안내 후 매출 확인하기'
    }
    onPlan({
      strategy: choice,
      title: selected.name,
      store: data.store,
      demo: data.demo,
      duration,
      startDate,
      endDate,
      timeLabel: demo?.timeLabel,
      followUp: selected.followUp,
      budget: choice === 'inventory' ? 0 : Number(budget),
      channel: choice === 'inventory' ? '' : channel,
      tasks: taskLabels.map((label, index) => ({ label, date: addDays(startDate, offsets[index]) })),
      done: [],
    })
  }

  return <>
    <PageTitle title="대응 전략 선택" detail="우리 가게에 맞는 방법을 골라보세요." />
    <section className="receipt summary-strip strategy-summary" aria-label="짝꿍이 찾은 변화">
      <Citrus stamp />
      <strong>짝꿍이 찾은 변화</strong>
      {response?.recommendationSource && <span className="badge">
        {response.recommendationSource === 'AGENT' ? 'AI 추천' : '기본 추천'}
      </span>}
      <span className="strategy-summary-detail">{summary}</span>
      {demo?.change && <strong className="strategy-summary-change">{demo.change}</strong>}
    </section>
    {response && bsi && <p className="strategy-summary-detail">
      경기 참고 · {formatEvidence(bsi, response.beforeMonth, response.afterMonth)} · <a href={bsiSource}>소상공인시장진흥공단</a>
    </p>}
    <form className="split planning strategy-layout" onSubmit={submit}>
      <fieldset className="strategy-options" disabled={saving}>
        <legend>어떤 전략을 해볼까요?</legend>
        {cards.map(({ id, card }) => {
          const selectedCard = choice === id
          return <div key={id} className={selectedCard ? 'strategy-option highlight' : 'strategy-option'}>
            <label>
              <input type="radio" name="strategy" value={id} checked={selectedCard} onChange={() => setChoice(id)} />
              <strong>{card.name}</strong>
              {recommendation === id && <span className="badge strategy-recommended">추천</span>}
              {card.status === 'NEEDS_INPUT' && <span className="badge">추가 확인 필요</span>}
            </label>
            <dl className="reason strategy-evidence">
              <dt>확인한 변화</dt>
              <dd>{card.evidence && card.evidence.length > 1 ? <ul className="strategy-evidence-list">
                {card.evidence.map(({ text, source }) => <li key={text}>{text}
                  {source === 'MARKET_CARD_SALES' && <> · <a href={marketSource}>제주데이터허브</a></>}
                  {source === 'JEJU_BSI' && <> · <a href={bsiSource}>소상공인시장진흥공단</a></>}
                </li>)}
              </ul> : card.observation}</dd>
              <dt>{recommendation === id ? '추천 이유' : '제안 이유'}</dt><dd>{card.reason}</dd>
              {card.nextAction && <><dt>먼저 할 일</dt><dd>{card.nextAction}</dd></>}
              {!!card.missingInputs?.length && <><dt>필요한 자료</dt><dd>{card.missingInputs.join(' · ')}</dd></>}
              {selectedCard && <><dt>실행 후 확인</dt><dd>{card.followUp}</dd></>}
            </dl>
            {saved && id === 'outreach' && <ExecutionGuidePanel
              key={saved.response.recommendationId ?? saved.analysisId}
              auth={saved.auth} analysisId={saved.analysisId} recommendationId={saved.response.recommendationId} />}
          </div>
        })}
        <Link className="strategy-back" to={backTo}>← 매출 분석 다시 보기</Link>
      </fieldset>
      <section className="form-stack strategy-settings">
        <div className="ruled"><h2>실행 조건 정하기</h2></div>
        <p className="strategy-selected">{selected.name}</p>
        <label>실행 기간<select name="duration" defaultValue="2주" disabled={saving}><option>1주</option><option>2주</option><option>4주</option></select></label>
        {choice !== 'inventory' && <>
          <label>예산 한도 (원)<input type="number" min="0" step="1" disabled={saving} max={Number.MAX_SAFE_INTEGER} value={budget} onChange={(event) => setBudget(event.target.value)} required /></label>
          <label>홍보 채널<select disabled={saving} value={channel} onChange={(event) => setChannel(event.target.value)}><option>인스타그램</option><option>매장 안내</option></select></label>
        </>}
        <div className="strategy-output">
          <strong>생성할 결과물</strong>
          <span>실행 일정 · 점검표 · {choice === 'inventory' ? '발주량 검토표' : selected.status === 'NEEDS_INPUT' ? '혜택 검토 항목' : '홍보 초안'}</span>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="button primary strategy-submit" disabled={saving}>{saving ? '계획 저장 중…' : '이 전략으로 계획 만들기'} <span aria-hidden="true">→</span></button>
      </section>
    </form>
  </>
}
