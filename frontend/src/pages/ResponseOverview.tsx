import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { fetchExecutionOutcome, fetchInventoryEstimates, fetchMarketContext, fetchPlan, listStoreAnalyses, toPlan } from '../api/shop'
import type { MarketContext } from '../api/shop'
import { Citrus } from '../components/ui'
import { analysisMaterial, largestMenuDecline, largestTimeDecline, matchingEstimate, planChoices } from '../data/responseOverview'
import type { OverviewPlan } from '../data/responseOverview'
import { marketSource } from '../data/marketSources'
import { changeRate, formatNumber, formatRate, monthLabel, won } from '../data/shop'
import type { Analysis } from '../data/shop'
import '../styles/response-overview.css'

const stages = ['감소 발견', '대응 준비', '결과 확인']
const messages = ['상권과 매장 수치를 비교하고 감소한 메뉴·시간대를 확인해요.', '근거와 연결된 발주 검토·홍보 계획을 열어볼 수 있어요.', '저장한 예상과 실행 기록을 비교해 다음 판단에 활용해요.']
const problem = (e: unknown) => e instanceof Error ? e.message : '자료를 불러오지 못했어요.'
const planPath = (row: OverviewPlan, route: 'execution' | 'results') => `/${route}?${new URLSearchParams({ id: row.plan.id, analysisId: row.plan.analysisId! })}`

function Material({ children, real = false }: { children: ReactNode; real?: boolean }) {
  return <span className={`overview-material${real ? ' public' : ''}`}>{children}</span>
}

function Pair({ label, before, after, unit = '', money = false }: { label: string; before: number; after: number; unit?: string; money?: boolean }) {
  const scale = Math.max(before, after, 1)
  const format = (n: number) => money ? won(n) : `${formatNumber(n)}${unit}`
  return <div className="overview-pair">
    <h3>{label}</h3>
    <div className="overview-pair-value"><span>{format(before)}</span><span aria-hidden="true">→</span><strong>{format(after)}</strong></div>
    <div className="overview-pair-bars" aria-hidden="true">
      <span><i style={{ width: `${before / scale * 100}%` }} /></span>
      <span><i style={{ width: `${after / scale * 100}%` }} /></span>
    </div>
  </div>
}

function Selector({ rows, value, onChange, label }: { rows: OverviewPlan[]; value?: string; onChange: (id: string) => void; label: string }) {
  if (rows.length < 2) return null
  return <label className="overview-selector">{label}<select value={value} onChange={e => onChange(e.target.value)}>
    {rows.map(({ plan }) => <option key={plan.id} value={plan.id}>{plan.title} · {plan.startDate}~{plan.endDate} · {plan.id.slice(0, 6)}</option>)}
  </select></label>
}

function PlanSources({ row }: { row: OverviewPlan }) {
  const draft = row.plan.promotionDraft
  const reviews = draft?.reviewSelection?.sources ?? []
  const findings = draft?.channels?.findings ?? []
  const event = draft?.localEvent
  return <details className="overview-sources"><summary>저장한 추천 근거·출처</summary>
    {row.plan.recommendation ? <>
      <p>{row.plan.recommendation.reason}</p>
      <ul>{[...row.plan.recommendation.evidence, ...row.plan.recommendation.contextEvidence].map((item, i) => <li key={i}>{item}</li>)}</ul>
    </> : <p>사장님이 저장한 계획이에요. 별도로 저장된 추천 근거는 없어요.</p>}
    {!!reviews.length && <><Material real>공개 후기 원문 · 가상 POS와 별개</Material><ul>{reviews.map(source => <li key={source.id}>
      <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a> · {source.dateLabel}
    </li>)}</ul></>}
    {!!findings.length && <ul>{findings.map((source, i) => <li key={i}><a href={source.url} target="_blank" rel="noreferrer">{source.text}</a></li>)}</ul>}
    {event && <p><a href={event.sourceUrl} target="_blank" rel="noreferrer">{event.name}</a> · {event.startDate}~{event.endDate}</p>}
  </details>
}

function OutcomeStatus({ row, children }: { row: OverviewPlan; children: ReactNode }) {
  if (row.errors.length) return <div role="alert" className="overview-unavailable">{row.errors.map((text, i) => <p key={i}>{text}</p>)}</div>
  if (row.pendingUntil) return <p className="overview-unavailable">저장한 결과는 {row.pendingUntil}부터 볼 수 있어요.</p>
  if (!row.outcome) return <p className="overview-unavailable">아직 실행 결과를 기록하지 않았어요.</p>
  return <><Material>{row.outcome.simulated ? '가상 시연 결과' : '사용자가 입력한 운영 기록'}</Material>{children}</>
}

export function ResponseOverview({ data, analysisId, auth }: { data: Analysis; analysisId: string; auth: string }) {
  const [loaded, setLoaded] = useState<{ market?: MarketContext; rows: OverviewPlan[]; errors: string[] }>()
  const [retry, setRetry] = useState(0)
  const [inventoryId, setInventoryId] = useState('')
  const [promotionId, setPromotionId] = useState('')
  const [active, setActive] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [motion, setMotion] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [before, after] = data.monthly.slice(-2)

  useEffect(() => {
    const controller = new AbortController()
    setLoaded(undefined)
    const signal = controller.signal
    async function load() {
      const [context, listing] = await Promise.allSettled([
        before && after ? fetchMarketContext(data.area ?? '', data.industry, before.month, after.month, signal) : Promise.resolve(undefined),
        data.storeId ? listStoreAnalyses(auth, data.storeId, signal) : Promise.reject(new Error('분석에 연결된 매장이 없어요.')),
      ])
      const errors: string[] = []
      if (context.status === 'rejected') errors.push(`상권 자료: ${problem(context.reason)}`)
      if (listing.status === 'rejected') errors.push(`계획 목록: ${problem(listing.reason)}`)
      const summaries = listing.status === 'fulfilled' ? listing.value.find(item => item.id === analysisId)?.plans ?? [] : []
      const results = await Promise.allSettled(summaries.map(async summary => {
        const saved = await fetchPlan(auth, summary.id, signal)
        if (saved.analysisId !== analysisId) throw new Error('분석과 계획의 연결이 달라요.')
        const plan = { ...toPlan(saved, data.store), id: saved.id }
        const [outcome, estimates] = await Promise.allSettled([
          fetchExecutionOutcome(auth, plan.id, signal),
          plan.strategy === 'inventory' ? fetchInventoryEstimates(auth, plan.id, signal) : Promise.resolve([]),
        ])
        return { plan, errors: [outcome.status === 'rejected' ? `실행 기록: ${problem(outcome.reason)}` : '',
          estimates.status === 'rejected' ? `저장한 예상: ${problem(estimates.reason)}` : ''].filter(Boolean),
          ...(outcome.status === 'fulfilled' ? outcome.value : {}),
          estimates: estimates.status === 'fulfilled' ? estimates.value : undefined } satisfies OverviewPlan
      }))
      if (signal.aborted) return
      const rows: OverviewPlan[] = []
      results.forEach((result, i) => {
        if (result.status === 'fulfilled') rows.push(result.value)
        else errors.push(`${summaries[i].title || '계획'}: ${problem(result.reason)}`)
      })
      setLoaded({ market: context.status === 'fulfilled' ? context.value : undefined, rows, errors })
    }
    void load().catch(e => { if (!signal.aborted) setLoaded({ rows: [], errors: [problem(e)] }) })
    return () => controller.abort()
  }, [auth, analysisId, data.storeId, data.store, data.area, data.industry, before?.month, after?.month, retry])

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const stop = () => { if (preference.matches) { setMotion(false); setPlaying(false) } }
    preference.addEventListener('change', stop)
    return () => preference.removeEventListener('change', stop)
  }, [])
  useEffect(() => {
    if (!playing || !motion) return
    const timer = window.setTimeout(() => {
      if (active === stages.length - 1) setPlaying(false)
      else setActive(n => n + 1)
    }, 2600)
    return () => window.clearTimeout(timer)
  }, [playing, active, motion])

  if (!before || !after) return <p>비교할 두 달의 매출 분석을 먼저 저장해 주세요.</p>
  const inventoryRows = planChoices(loaded?.rows ?? [], 'inventory')
  const promotionRows = planChoices(loaded?.rows ?? [], 'promotion')
  const inventory = inventoryRows.find(row => row.plan.id === inventoryId) ?? inventoryRows[0]
  const promotion = promotionRows.find(row => row.plan.id === promotionId) ?? promotionRows[0]
  const estimate = inventory && matchingEstimate(inventory)
  const inventoryResult = inventory?.outcome?.inventory
  const comparison = promotion?.outcome?.comparison
  const product = largestMenuDecline(data)
  const time = largestTimeDecline(data)
  const market = loaded?.market?.card
  const reference = !market ? loaded?.market?.cardReference : undefined
  const rate = changeRate(before.amount, after.amount)
  const material = analysisMaterial(data)
  const period = `${monthLabel(before.month)} → ${monthLabel(after.month)}`

  return <div className="response-overview" data-motion={motion ? 'on' : 'off'} data-playing={playing} data-stage={active}>
    <header className="overview-hero">
      <div><span className="overview-eyebrow"><Citrus /> 데이터에서 다음 행동까지</span>
        <h1>우리 가게 대응<br className="overview-title-break" /> 한눈에 보기</h1>
        <p>{data.store} · {period}</p>
      </div>
      <div className="overview-controls">
        <button type="button" className="button overview-play" disabled={!motion || !loaded} onClick={() => {
          if (playing) setPlaying(false)
          else { setActive(0); setPlaying(true) }
        }}><span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span> {playing ? '재생 멈추기' : '흐름 재생'}</button>
        <label><input type="checkbox" checked={motion} onChange={e => { setMotion(e.target.checked); setPlaying(false) }} /> 움직임 효과</label>
        <span>강조만 바뀌며 수치·기록은 그대로예요.</span>
      </div>
    </header>

    <div className="overview-provenance"><Material real>실제 공개자료 · 상권 카드 이용액</Material><Material>{material}</Material>
      <span>실행 결과의 자료 구분은 각 저장 기록을 따라요.</span></div>
    {loaded?.errors.map((text, i) => <p className="error" role="alert" key={i}>{text}</p>)}
    {!loaded ? <p role="status">저장된 근거·계획·결과를 연결하고 있어요.</p>
      : <button type="button" className="text-button overview-refresh" onClick={() => { setPlaying(false); setRetry(n => n + 1) }}>저장 기록 새로 불러오기 ↻</button>}

    <nav className="overview-steps" aria-label="대응 흐름">
      {stages.map((name, index) => <button key={name} type="button" aria-current={active === index ? 'step' : undefined}
        onClick={() => {
          setPlaying(false); setActive(index)
          if (window.matchMedia('(max-width: 760px)').matches) {
            document.getElementById(['overview-discovery', 'overview-action', 'overview-outcome'][index])
              ?.scrollIntoView({ behavior: motion ? 'smooth' : 'auto', block: 'start' })
          }
        }}><span>0{index + 1}</span>{name}<i aria-hidden="true">→</i></button>)}
    </nav>
    <p className="overview-stage-caption" role="status">{messages[active]}</p>
    <div className="overview-flow">
      <section className="overview-column" data-active={active === 0} aria-labelledby="overview-discovery">
        <div className="overview-column-heading"><span>01 / EVIDENCE</span><h2 id="overview-discovery">어디에서 줄었을까?</h2></div>
        <article className="overview-card overview-market">
          <div className="overview-market-vs">
            <div><Material real>실제 공개자료</Material><h3>상권 카드 이용액</h3>
              <strong className="overview-big">{market ? formatRate(changeRate(market.before, market.after)) : loaded ? '자료 없음' : '조회 중'}</strong></div>
            <div className="overview-store"><Material>{material}</Material><h3>우리 가게 매출</h3>
              <strong className="overview-big">{formatRate(rate)}</strong></div>
          </div>
          <p>{data.area} · {data.industry}</p>
          <Pair label="매장 매출 합계" before={before.amount} after={after.amount} money />
          <p className="overview-period">{period}</p>
          <details className="overview-sources"><summary>금액과 공공데이터 출처</summary>
            {market && <p>{won(market.before)} → {won(market.after)}</p>}
            <a href={marketSource} target="_blank" rel="noreferrer">제주데이터허브 · 지역별 업종별 카드 이용액</a>
            <p>카드 이용액은 매장의 실매출·방문객 수와 다른 지표예요.</p>
            {reference && <p>동일 세부 업종 자료가 없어 직접 비교하지 않아요. 참고 범위: {reference.scope} · {won(reference.before)} → {won(reference.after)} <a href={reference.source.url}>출처</a></p>}
          </details>
        </article>
        <article className="overview-card">
          <h3>감소 근거 좁히기</h3>
          {product ? <><Pair label={product.productName} before={product.before} after={product.after} unit=" (POS 수량)" />
            <p>{won(product.beforeRevenue!)} → {won(product.afterRevenue!)}</p><small>매출 자료가 있는 메뉴 중 매출 감소액이 가장 커요.</small></> : <p>비교 가능한 메뉴 매출 감소 자료가 없어요.</p>}
          {time ? <Pair label={time.label} before={time.before} after={time.after} unit={data.timeSeries?.metric === 'count' ? '건' : '원'} /> : <p>시간대별 감소 자료가 없어요.</p>}
          <details className="overview-sources"><summary>분석 근거 확인</summary><p>출처: 저장된 분석 「{data.name || '이름 없는 분석'}」의 월별 매출·상품 판매·시간대 집계.</p>
            <p>{material === '가상 시연 POS' ? '가상 표시는 체험 데이터 또는 분석 이름의 가상·SIMULATED 표시에 근거해요.' : '실제 매장 자료인지 가상 자료인지는 원본에서 확인해 주세요.'}</p>
            <p>메뉴와 시간대는 각각의 집계예요. 특정 메뉴가 해당 시간에 줄었다는 교차 분석은 아니에요.</p></details>
          <Link to={`/analysis?${new URLSearchParams({ id: analysisId })}`}>매출 분석에서 근거 보기 →</Link>
        </article>
      </section>

      <section className="overview-column" data-active={active === 1} aria-labelledby="overview-action">
        <div className="overview-column-heading"><span>02 / ACTION</span><h2 id="overview-action">근거를 다음 행동으로</h2></div>
        <article className="overview-card">
          <span className="overview-action-icon" aria-hidden="true">↘</span><h3>발주량 검토</h3>
          <Selector rows={inventoryRows} value={inventory?.plan.id} onChange={setInventoryId} label="연결할 발주 계획" />
          {inventory ? <>
            <p className="overview-plan-title">{inventory.plan.title}</p>
            {estimate ? <><p>{estimate.date} · {estimate.product}</p><div className="overview-number">{estimate.low}–{estimate.high}<small>예상 POS 수량</small></div>
              <p className="overview-explain">{estimate.basis === 'WEEKDAY' ? '같은 요일 판매·추세를 참고한 저장 예상' : '강수 조건을 참고한 저장 예상'}</p></>
              : <p className="overview-unavailable">이 결과 날짜·메뉴와 일치하는 저장 예상이 없어요.</p>}
            <p>예상 사용량에서 현재 재고·기존 입고 예정량을 고려해 품목별 준비량을 검토해요.</p>
            <PlanSources row={inventory} />
            <Link className="button secondary" to={planPath(inventory, 'execution')}>발주 검토 열기 →</Link>
          </> : <p className="overview-unavailable">{loaded ? '저장한 발주 계획이 없어요.' : '계획을 불러오는 중이에요.'}</p>}
        </article>
        <article className="overview-card">
          <span className="overview-action-icon" aria-hidden="true">↗</span><h3>가게 소식 홍보</h3>
          <Selector rows={promotionRows} value={promotion?.plan.id} onChange={setPromotionId} label="연결할 홍보 계획" />
          {promotion ? <>
            <p className="overview-plan-title">{promotion.plan.title}</p>
            <p className="overview-period">{promotion.plan.startDate} ~ {promotion.plan.endDate}</p>
            {promotion.plan.promotionDraft ? <>
              <blockquote>{promotion.plan.promotionDraft.headline}</blockquote>
              <div className="overview-channels">{(['instagram', 'naver', 'daangn'] as const).map((channel, i) =>
                <span key={channel}>{['인스타', '네이버', '당근'][i]} {promotion.plan.promotionDraft?.channels?.drafts[channel]?.trim() ? '초안 저장' : '초안 미저장'}</span>)}</div>
              {promotion.plan.promotionDraft.localEvent && <p>연결한 소식 · {promotion.plan.promotionDraft.localEvent.name}</p>}
            </> : <p className="overview-unavailable">홍보 초안을 아직 저장하지 않았어요.</p>}
            <p className="overview-explain">공개 후기·행사 근거는 출처에서 확인해요. 초안 저장은 실제 게시 완료를 뜻하지 않아요.</p>
            <PlanSources row={promotion} />
            <Link className="button secondary" to={planPath(promotion, 'execution')}>홍보 초안 열기 →</Link>
          </> : <p className="overview-unavailable">{loaded ? '저장한 홍보 계획이 없어요.' : '계획을 불러오는 중이에요.'}</p>}
        </article>
        <Link className="overview-strategy-link" to={`/strategy?${new URLSearchParams({ id: analysisId })}`}>AI 대응 전략과 추천 근거 보기 →</Link>
      </section>

      <section className="overview-column" data-active={active === 2} aria-labelledby="overview-outcome">
        <div className="overview-column-heading"><span>03 / FOLLOW-UP</span><h2 id="overview-outcome">실행 후, 무엇을 확인했나?</h2></div>
        <article className="overview-card">
          <h3>발주 · 예상과 기록 비교</h3>
          {inventory ? <><OutcomeStatus row={inventory}>
            {inventoryResult ? <>
              <p>{inventoryResult.date} · {inventoryResult.product}</p>
              <div className="overview-forecast"><div><span>저장 예상</span><strong>{estimate ? `${estimate.low}–${estimate.high}` : '자료 없음'}</strong></div>
                <span aria-hidden="true">↔</span><div><span>기록한 판매</span><strong>{inventoryResult.actualQuantity == null ? '미입력' : formatNumber(inventoryResult.actualQuantity)}</strong></div></div>
              <p className="overview-explain">POS 수량 · 같은 계획·날짜·메뉴가 일치하는 예상만 비교해요.</p>
              <details className="overview-sources"><summary>남은 재료와 기록 범위</summary><p>{inventory.outcome?.note}</p>
                <ul>{inventoryResult.remaining.map((item, i) => <li key={i}>{item.name}: {formatNumber(item.quantity)} {item.unit}</li>)}</ul>
                <p>남은 양만으로 폐기량이나 절감 효과를 판단할 수 없어요.</p></details>
            </> : <p>하루 판매·재고 결과가 아직 없어요.</p>}
          </OutcomeStatus><Link to={planPath(inventory, 'results')}>발주 실행 기록 확인 →</Link></> : <p className="overview-unavailable">연결할 발주 계획이 없어요.</p>}
        </article>
        <article className="overview-card">
          <h3>홍보 · 실행 전후 비교</h3>
          {promotion ? <><OutcomeStatus row={promotion}>
            {comparison ? <>
              <p className="overview-period">{comparison.before.start}~{comparison.before.end}<br />→ {comparison.after.start}~{comparison.after.end}</p>
              <Pair label={comparison.product} before={comparison.before.quantity} after={comparison.after.quantity} unit=" (POS 수량)" />
              <Pair label="오후 2~5시 결제" before={comparison.before.afternoonCount} after={comparison.after.afternoonCount} unit="건" />
              <p>기록된 영업일 {comparison.before.days} → {comparison.after.days}일</p>
              <details className="overview-sources"><summary>원본 파일·기록 범위</summary><p>{promotion.outcome?.note}</p>
                <ul>{comparison.sources.map((source, i) => <li key={i}>{source.name}<small>SHA-256 {source.sha256}</small></li>)}</ul>
                <p>영업일·영업시간·가격 조건은 원본에서 확인해 주세요. 영업일이 다르면 합계만으로 비교할 수 없어요.</p>
                <p>하루 평균 판매량 {(comparison.before.quantity / comparison.before.days).toFixed(2)} → {(comparison.after.quantity / comparison.after.days).toFixed(2)},
                  오후 결제 {(comparison.before.afternoonCount / comparison.before.days).toFixed(2)} → {(comparison.after.afternoonCount / comparison.after.days).toFixed(2)}건</p></details>
            </> : <p>실행 전후 비교 POS가 아직 없어요.</p>}
          </OutcomeStatus><Link to={planPath(promotion, 'results')}>홍보 실행 기록 확인 →</Link></> : <p className="overview-unavailable">연결할 홍보 계획이 없어요.</p>}
        </article>
        <p className="overview-limitation">가상 시연 결과는 실제 매장 성과가 아니에요. 전후 변화만으로 홍보의 효과를 입증할 수 없어요.</p>
      </section>
    </div>
    <footer className="overview-footer"><Citrus /><p>데이터를 근거로 제안하고, 사장님이 결정하고, 실행 기록으로 다시 확인해요.</p></footer>
  </div>
}
