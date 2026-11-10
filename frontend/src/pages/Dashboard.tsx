import { ReviewInsights, SavedReviewInsights } from '../components/ReviewInsights'
import { ChartQuestions } from '../components/ChartQuestions'
import type { Plan } from '../data/shop'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { Citrus, PageTitle } from '../components/ui'
import { changeRate, example, formatNumber, formatRate, monthLabel, won } from '../data/shop'
import type { Analysis, TimeSeries } from '../data/shop'
import { fetchMarketContext } from '../api/shop'
import type { MarketContext, QuestionChart } from '../api/shop'
import { bsiSource, marketSource } from '../data/marketSources'
import { TimeDialog } from './Intake'
import '../styles/dashboard.css'

const bsiFormat = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format

type Topic = {
  chart: QuestionChart
  title: string
  suggestion: string
  answer: string
  source: string
  figure?: string
}

function MarketChart({ storeRate, marketRate }: { storeRate: number | null; marketRate: number | null }) {
  const limit = Math.max(10, Math.ceil(Math.max(Math.abs(storeRate ?? 0), Math.abs(marketRate ?? 0)) / 10) * 10)
  const items = [
    { label: '우리 가게 매출', rate: storeRate },
    { label: '상권 카드 이용액', rate: marketRate },
  ]

  return <>
    <ul className="market-chart" aria-label="우리 가게와 상권의 증감률 비교">
      {items.map(({ label, rate }) => {
        const size = (Math.abs(rate ?? 0) / limit) * 50
        const direction = rate !== null && rate < 0 ? 'down' : 'up'
        return <li key={label}>
          <span>{label}</span>
          <span className="market-track" aria-hidden="true">
            <span className={`market-bar ${direction}`} style={{ width: `${size}%`, left: `${direction === 'down' ? 50 - size : 50}%` }} />
          </span>
          <strong className={rate === null ? 'muted' : direction}>{formatRate(rate)}</strong>
        </li>
      })}
    </ul>
    <div className="market-axis muted" aria-hidden="true"><span>−{limit}%</span><span>0%</span><span>+{limit}%</span></div>
  </>
}

function BsiChart({ months, values }: { months: [string, string]; values: [number, number] }) {
  const difference = values[1] - values[0]
  return <>
    <strong className={`bsi ${difference < 0 ? 'down' : 'up'}`}>{values.map(bsiFormat).join(' → ')}</strong>
    <p className="muted">제주 전체 소상공인 체감 BSI · {difference > 0 ? '+' : ''}{bsiFormat(difference)}p</p>
    <ul className="bsi-chart" aria-label="월별 제주 소상공인 체감 BSI">
      {months.map((month, index) => <li key={month}>
        <span>{monthLabel(month)}</span>
        <span className="bsi-track" aria-hidden="true"><span style={{ width: `${values[index] / 2}%` }} /></span>
        <strong>{bsiFormat(values[index])}</strong>
      </li>)}
    </ul>
    <p className="muted">보합 기준 100 · <a href={bsiSource}>소상공인시장진흥공단</a></p>
  </>
}

function TimeChart({ series, labels, format, highlight }: {
  series: TimeSeries
  labels: [string, string]
  format: (value: number) => string
  highlight?: TimeSeries['rows'][number]
}) {
  const max = Math.max(1, ...series.rows.flatMap(({ before, after }) => [before, after]))

  return <>
    <div className="time-legend"><span>{labels[0]}</span><span>{labels[1]}</span></div>
    <ul className="time-comparison" aria-label="시간대별 두 달의 합계">
      {series.rows.map((row) => <li className={highlight === row ? 'highlight' : ''} key={row.label}>
        <h3>{row.label}</h3>
        <div className="time-pair">
          {[row.before, row.after].map((value, index) => <div key={labels[index]}>
            <span className="time-track" aria-hidden="true"><span style={{ width: `${(value / max) * 100}%` }} /></span>
            <strong aria-label={`${labels[index]} ${format(value)}`}>{format(value)}</strong>
          </div>)}
        </div>
        {highlight === row && <strong className="time-drop down">−{format(row.before - row.after)}</strong>}
      </li>)}
    </ul>
  </>
}

function Questions({ topic, period, showExample, onClose }: { topic: Topic; period: string; showExample: boolean; onClose: () => void }) {
  const [draft, setDraft] = useState('')
  const [asked, setAsked] = useState(showExample ? topic.suggestion : '')

  function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.trim()) return
    setAsked(draft.trim())
    setDraft('')
  }

  const showAnswer = asked === topic.suggestion

  return <section className="question-panel dashboard-chat" aria-label="짝꿍에게 질문하기">
    <div className="section-top dashboard-chat-heading">
      <h2><Citrus /> 짝꿍에게 질문하기</h2>
      <button type="button" aria-label="질문 패널 닫기" className="text-button close" onClick={onClose}>×</button>
    </div>
    <p className="badge">{topic.title} · {period}</p>
    <p className="muted">예시 질문으로 답변을 미리 볼 수 있어요.</p>
    {asked && <div className="chat-messages" aria-live="polite">
      <p className="question-bubble">{asked}</p>
      <div className="answer-bubble">
        <strong>가게짝꿍 · 답변 예시</strong>
        {showAnswer && topic.figure && <p className="dashboard-chat-figure">{topic.figure}</p>}
        <p>{showAnswer ? topic.answer : '지금은 아래 예시 질문에 답할 수 있어요.'}</p>
        {showAnswer && <small>근거 · {topic.source}</small>}
      </div>
    </div>}
    {!showAnswer && <button type="button" className="chip" onClick={() => setAsked(topic.suggestion)}>{topic.suggestion}</button>}
    <form className="chat-form" onSubmit={ask}>
      <input aria-label="질문 입력" placeholder="궁금한 점을 물어보세요" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button className="button primary small">보내기</button>
    </form>
  </section>
}

function AskButton({ onClick, label }: { onClick: (button: HTMLButtonElement) => void; label: string }) {
  return <button type="button" className="button small dashboard-ask" aria-label={label} onClick={(event) => onClick(event.currentTarget)}>이 차트 질문</button>
}

export function Dashboard({ data, auth, analysisId, onChange, onPlan, onSaveTimeSeries, strategyTo }: {
  data: Analysis
  auth?: string
  analysisId?: string
  onChange: (value: Analysis) => void
  onPlan: (value: Plan) => void
  onSaveTimeSeries: (value: TimeSeries) => Promise<void>
  strategyTo: string
}) {
  const [question, setQuestion] = useState<{ topic: Topic; showExample: boolean }>()
  const [timeOpen, setTimeOpen] = useState(false)
  const panel = useRef<HTMLElement>(null)
  const questionTrigger = useRef<HTMLButtonElement>(null)
  const previewQuestion = useRef<HTMLButtonElement>(null)
  const [before, after] = data.monthly.slice(-2)
  const monthlyMax = Math.max(1, ...data.monthly.map(({ amount }) => amount))
  const period = `${monthLabel(before.month)} → ${monthLabel(after.month)}`
  const delta = changeRate(before.amount, after.amount)
  const [context, setContext] = useState<MarketContext | null>()
  const { area, industry } = data
  useEffect(() => {
    const controller = new AbortController()
    setContext(undefined)
    fetchMarketContext(area ?? '', industry, before.month, after.month, controller.signal).then((value) => {
      if (!controller.signal.aborted) setContext(value)
    }).catch(() => {
      if (!controller.signal.aborted) setContext(null)
    })
    return () => controller.abort()
  }, [area, industry, before.month, after.month])
  const market = context?.card && { ...context.card, rate: changeRate(context.card.before, context.card.after) }
  const bsi = context?.bsi
  const missingContext = context === undefined ? '비교 자료를 불러오는 중이에요.'
    : context === null ? '비교 자료를 불러오지 못했어요.' : undefined
  const summary = delta === null ? '비교 기준 월의 매출이 0원이라 증감률을 계산할 수 없어요.'
    : delta === 0 ? '비교한 두 달의 매출이 같아요.'
      : `비교한 두 달 사이에 매출이 ${Math.abs(delta).toFixed(2)}% ${delta < 0 ? '줄었어요' : '늘었어요'}.`
  const series = data.timeSeries
  const biggestDrop = series?.rows.reduce<TimeSeries['rows'][number] | undefined>((largest, row) => {
    const drop = row.before - row.after
    return drop > (largest ? largest.before - largest.after : 0) ? row : largest
  }, undefined)
  const unit = series?.metric === 'count' ? '결제 건수' : '매출'
  const timeTitle = biggestDrop
    ? series?.metric === 'count' ? '결제가 줄어든 시간대' : '매출이 줄어든 시간대'
    : `시간대별 ${series ? unit : '매출 분석'}`
  const formatTime = series?.metric === 'count' ? (value: number) => `${formatNumber(value)}건` : won
  const monthlyTopic: Topic = {
    chart: 'MONTHLY_SALES',
    title: '월별 매출',
    suggestion: '매출이 얼마나 달라졌나요?',
    answer: summary,
    figure: `${won(before.amount)} → ${won(after.amount)}`,
    source: data.demo ? '가상 매장 POS 시연 자료' : '저장된 매장 월별 매출',
  }
  const comparisonTopic: Topic = {
    chart: 'MARKET_CARD_SALES',
    title: '상권 비교',
    suggestion: '같은 기간 상권 카드 이용액은 어떻게 달라졌나요?',
    answer: market ? `${summary} 같은 기간 ${data.area} ${data.industry} 카드 이용액은 ${formatRate(market.rate)}로 표시돼요. 변화의 원인을 알려면 영업일과 시간대별 실적을 함께 살펴봐요.` : '',
    figure: market ? `${won(market.before)} → ${won(market.after)}` : undefined,
    source: '저장된 매장 매출 · 제주데이터허브',
  }
  const timeTopic: Topic = {
    chart: 'TIME_SERIES',
    title: timeTitle,
    suggestion: biggestDrop ? `왜 ${biggestDrop.label} 구간을 먼저 봐야 하나요?` : '어느 시간대가 달라졌나요?',
    answer: biggestDrop ? '비교한 시간대 중 감소 폭이 가장 컸어요. 영업일 수나 영업시간이 달랐는지도 확인해 보세요.' : '비교한 구간에서 감소한 시간대는 없어요.',
    figure: biggestDrop ? `${formatTime(biggestDrop.before)} → ${formatTime(biggestDrop.after)} · ${formatTime(biggestDrop.before - biggestDrop.after)} 감소` : undefined,
    source: series === example.timeSeries ? '가상 매장 POS 결제 자료' : '저장된 시간대별 자료',
  }
  const bsiTopic: Topic = {
    chart: 'JEJU_BSI',
    title: '제주 경기동향',
    suggestion: '같은 기간 제주 경기동향은 어땠나요?',
    answer: bsi ? '제주 전체 소상공인의 경기 체감 지표예요.' : '비교 기간의 제주 체감 BSI 자료가 없어요.',
    figure: bsi ? `${bsi.before} → ${bsi.after}` : undefined,
    source: '소상공인시장진흥공단',
  }
  const topics = [monthlyTopic, comparisonTopic, timeTopic, bsiTopic]
  const saved = Boolean(auth && analysisId)
  const suggestedTopic = series ? timeTopic : market ? comparisonTopic : monthlyTopic

  function openTopic(value: Topic, button: HTMLButtonElement, showExample = false) {
    questionTrigger.current = button
    setQuestion({ topic: value, showExample })
    requestAnimationFrame(() => panel.current?.focus())
  }

  function closeTopic() {
    setQuestion(undefined)
    requestAnimationFrame(() => {
      const trigger = questionTrigger.current
      if (trigger?.isConnected) trigger.focus()
      else previewQuestion.current?.focus()
    })
  }

  return <>
    <PageTitle title="매출 분석" detail={`${data.store} · ${period}${data.demo ? ' · 시연 예시' : ''}`} />
    <div className="split dashboard analysis-dashboard">
      <div className="dashboard-main form-stack">
        <div className="metrics dashboard-metrics">
          <div><span>{monthLabel(after.month)} 매출</span><strong>{won(after.amount)}</strong></div>
          <div><span>우리 가게 매출 변화</span><strong className={delta === null ? 'muted' : delta < 0 ? 'down' : 'up'}>{formatRate(delta)}</strong></div>
          <div><span>상권 카드 이용액 변화</span><strong className={market?.rate == null ? 'muted' : market.rate < 0 ? 'down' : 'up'}>{market ? formatRate(market.rate) : missingContext ?? '비교 자료 없음'}</strong></div>
        </div>
        <section className="ruled-block">
          <div className="section-top">
            <h2>우리 가게와 상권 비교</h2>
            {(market || saved) && <AskButton label="상권 비교 차트 질문" onClick={(button) => openTopic(comparisonTopic, button)} />}
          </div>
          {market ? <>
            <MarketChart storeRate={delta} marketRate={market.rate} />
            <p className="dashboard-source">상권 카드 이용액 {won(market.before)} → {won(market.after)}</p>
            <p className="muted">{data.area} · {data.industry} · <a href={marketSource}>제주데이터허브</a></p>
          </> : <p className="muted dashboard-source">{missingContext ?? '같은 지역·업종의 두 달치 카드 이용 자료가 없어요.'}</p>}
        </section>
        <section className="ruled-block">
          <div className="section-top"><h2>우리 가게 월별 매출</h2><AskButton label="월별 매출 차트 질문" onClick={(button) => openTopic(monthlyTopic, button)} /></div>
          <ul className="chart-rows dashboard-months" aria-label="월별 매출 비교">
            {data.monthly.map(({ month, amount }) => <li key={month}>
              <span>{monthLabel(month)}</span>
              <span className="chart-track" aria-hidden="true"><span className={month === after.month ? '' : 'earlier'} style={{ width: `${(amount / monthlyMax) * 100}%` }} /></span>
              <strong>{won(amount)}</strong>
            </li>)}
          </ul>
        </section>
        <section className="ruled-block">
          <div className="section-top"><h2>{timeTitle}</h2>{(series || saved) && <AskButton label="시간대 차트 질문" onClick={(button) => openTopic(timeTopic, button)} />}</div>
          {series ? <>
            <TimeChart series={series} labels={[monthLabel(before.month), monthLabel(after.month)]} format={formatTime} highlight={biggestDrop} />
            <button type="button" className="button secondary small" onClick={() => setTimeOpen(true)}>시간대별 자료 수정</button>
          </> : <div className="empty-state compact dashboard-empty">
            <strong>어느 시간대에 매출이 달라졌는지 보고 싶으세요?</strong>
            <p>POS 파일을 선택하거나 두 달의 시간대별 합계를 직접 입력해 주세요.</p>
            <button type="button" className="button secondary" onClick={() => setTimeOpen(true)}>시간대별 자료 추가</button>
          </div>}
        </section>
        <section className="ruled-block">
          <div className="section-top"><h2>품목별 판매량</h2></div>
          {data.productSales?.length ? <>
            <p className="muted">토스포스 상품 주문 시트 · 결제 완료 수량 합계</p>
            <table className="input-table" aria-label="품목별 판매량 비교">
              <thead><tr>
                <th scope="col">품목</th><th scope="col">{monthLabel(before.month)}</th>
                <th scope="col">{monthLabel(after.month)}</th><th scope="col">수량 변화</th>
              </tr></thead>
              <tbody>{data.productSales.map(({ productName, before, after }) => {
                const difference = after - before
                return <tr key={productName}>
                  <th scope="row">{productName}</th>
                  <td>{formatNumber(before)}개</td><td>{formatNumber(after)}개</td>
                  <td className={difference < 0 ? 'down' : difference > 0 ? 'up' : 'muted'}>
                    {difference > 0 ? '+' : ''}{formatNumber(difference)}개
                  </td>
                </tr>
              })}</tbody>
            </table>
          </> : <p className="muted">상품 주문 시트가 포함된 POS 엑셀로 분석하면 품목별 판매량을 볼 수 있어요.</p>}
        </section>
      </div>
      <aside tabIndex={-1} ref={panel} className="dashboard-aside form-stack">
        {auth && analysisId && <ChartQuestions auth={auth} analysisId={analysisId}
          chart={question?.topic.chart} title={question?.topic.title} suggestion={question?.topic.suggestion}
          period={period} strategyTo={strategyTo} onClose={closeTopic} onTime={() => setTimeOpen(true)}
          onReviews={() => {
            setQuestion(undefined)
            requestAnimationFrame(() => document.getElementById('review-heading')?.scrollIntoView({ block: 'center' }))
          }}
          onRestore={(chart) => {
            const topic = topics.find((item) => item.chart === chart) ?? monthlyTopic
            setQuestion((current) => current ?? { topic, showExample: false })
          }} />}
        {question && !saved && <Questions key={question.topic.title} topic={question.topic} showExample={question.showExample} period={period} onClose={closeTopic} />}
        {!question && <>
          <section className="receipt dashboard-receipt">
            <div className="section-top"><h2>짝꿍의 한눈 요약</h2><Citrus stamp /></div>
            <p className="dashboard-summary">{biggestDrop
              ? <><strong>{biggestDrop.label}</strong>에 {unit} 감소 폭이 가장 컸어요.</>
              : summary}</p>
            {biggestDrop && <p className="muted">{formatTime(biggestDrop.before)} → {formatTime(biggestDrop.after)}</p>}
          </section>
          {data.demo && data.reviews && <ReviewInsights
            store={data.store}
            reviews={data.reviews}
            onReviews={(reviews) => onChange({ ...data, reviews })}
            onPlan={onPlan}
          />}
          {auth && analysisId && <SavedReviewInsights auth={auth} analysisId={analysisId} store={data.store} onPlan={onPlan} />}
          <section className="ruled-block dashboard-bsi">
            <div className="section-top"><h2>제주 경기동향</h2><AskButton label="제주 경기동향 차트 질문" onClick={(button) => openTopic(bsiTopic, button)} /></div>
            {bsi
              ? <BsiChart months={[before.month, after.month]} values={[bsi.before, bsi.after]} />
              : <p className="muted">{missingContext ?? '비교한 두 달의 제주 체감 BSI 자료가 없어요.'}</p>}
          </section>
          <section className="question-panel dashboard-question-preview">
            <h2>짝꿍에게 질문하기</h2>
            <button ref={previewQuestion} type="button" className="chip" onClick={(event) => openTopic(suggestedTopic, event.currentTarget, true)}>{suggestedTopic.suggestion}</button>
          </section>
        </>}
        <Link className="button primary full dashboard-next" to={strategyTo}>대응 전략 보기 <span aria-hidden="true">→</span></Link>
      </aside>
    </div>
    {timeOpen && <TimeDialog monthly={data.monthly} initial={series} onClose={() => setTimeOpen(false)} onSave={async (value) => {
      await onSaveTimeSeries(value)
      setTimeOpen(false)
      if (!saved) setQuestion(undefined)
    }} />}
  </>
}
