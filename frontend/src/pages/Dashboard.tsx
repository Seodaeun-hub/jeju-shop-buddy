import { useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { Citrus, PageTitle } from '../components/ui'
import { changeRate, example, formatNumber, formatRate, monthLabel, won } from '../data/shop'
import type { Analysis, TimeSeries } from '../data/shop'
import { TimeDialog } from './Intake'
import '../styles/dashboard.css'

const marketRate = 7.34

type Topic = {
  title: string
  suggestion: string
  answer: string
  source: string
  figure?: string
}

function MarketChart({ storeRate }: { storeRate: number | null }) {
  const limit = Math.max(10, Math.ceil(Math.max(Math.abs(storeRate ?? 0), marketRate) / 10) * 10)
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

export function Dashboard({ data, onSaveTimeSeries, strategyTo }: {
  data: Analysis
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
    title: '월별 매출',
    suggestion: '매출이 얼마나 달라졌나요?',
    answer: summary,
    figure: `${won(before.amount)} → ${won(after.amount)}`,
    source: data.demo ? '가상 매장 POS 시연 자료' : '직접 입력한 월별 매출',
  }
  const comparisonTopic: Topic = {
    title: '상권 비교',
    suggestion: '상권과 왜 다르게 움직였나요?',
    answer: '같은 기간 애월읍 한식 음식점업 카드 이용액은 늘고, 우리 가게 매출은 줄었어요. 두 지표의 차이만으로 원인을 판단하기 어려워요.',
    source: '가상 매장 POS 시연 자료 · 제주데이터허브',
  }
  const timeTopic: Topic = {
    title: timeTitle,
    suggestion: biggestDrop ? `왜 ${biggestDrop.label} 구간을 먼저 봐야 하나요?` : '어느 시간대가 달라졌나요?',
    answer: biggestDrop ? '비교한 시간대 중 감소 폭이 가장 컸어요. 영업일 수나 영업시간이 달랐는지도 확인해 보세요.' : '비교한 구간에서 감소한 시간대는 없어요.',
    figure: biggestDrop ? `${formatTime(biggestDrop.before)} → ${formatTime(biggestDrop.after)} · ${formatTime(biggestDrop.before - biggestDrop.after)} 감소` : undefined,
    source: series === example.timeSeries ? '가상 매장 POS 결제 자료' : '직접 입력한 시간대별 자료',
  }
  const suggestedTopic = series ? timeTopic : data.demo ? comparisonTopic : monthlyTopic

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
          <div><span>상권 카드 이용액 변화</span><strong className={data.demo ? 'up' : 'muted'}>{data.demo ? formatRate(marketRate) : '비교 자료 없음'}</strong></div>
        </div>
        <section className="ruled-block">
          <div className="section-top">
            <h2>우리 가게와 상권 비교</h2>
            {data.demo && <AskButton label="상권 비교 차트 질문" onClick={(button) => openTopic(comparisonTopic, button)} />}
          </div>
          {data.demo ? <>
            <MarketChart storeRate={delta} />
            <p className="muted dashboard-source">제주시 애월읍 · 한식 음식점업 · 제주데이터허브</p>
          </> : <p className="muted dashboard-source">입력한 기간의 상권 비교 자료를 사용할 수 있게 되면 여기에 표시돼요.</p>}
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
          <div className="section-top"><h2>{timeTitle}</h2>{series && <AskButton label="시간대 차트 질문" onClick={(button) => openTopic(timeTopic, button)} />}</div>
          {series ? <>
            <TimeChart series={series} labels={[monthLabel(before.month), monthLabel(after.month)]} format={formatTime} highlight={biggestDrop} />
            <button type="button" className="button secondary small" onClick={() => setTimeOpen(true)}>시간대별 자료 수정</button>
          </> : <div className="empty-state compact dashboard-empty">
            <strong>어느 시간대에 매출이 달라졌는지 보고 싶으세요?</strong>
            <p>POS 파일을 선택하거나 두 달의 시간대별 합계를 직접 입력해 주세요.</p>
            <button type="button" className="button secondary" onClick={() => setTimeOpen(true)}>시간대별 자료 추가</button>
          </div>}
        </section>
      </div>
      <aside tabIndex={-1} ref={panel} className="dashboard-aside form-stack">
        {question ? <Questions key={question.topic.title} topic={question.topic} showExample={question.showExample} period={period} onClose={closeTopic} /> : <>
          <section className="receipt dashboard-receipt">
            <div className="section-top"><h2>짝꿍의 한눈 요약</h2><Citrus stamp /></div>
            <p className="dashboard-summary">{biggestDrop
              ? <><strong>{biggestDrop.label}</strong>에 {unit} 감소 폭이 가장 컸어요.</>
              : data.demo ? '상권 카드 이용액은 늘고, 우리 가게 매출은 줄었어요.' : summary}</p>
            {biggestDrop && <p className="muted">{formatTime(biggestDrop.before)} → {formatTime(biggestDrop.after)}</p>}
          </section>
          <section className="ruled-block dashboard-bsi">
            <h2>제주 경기동향</h2>
            {data.demo ? <><strong className="bsi up">63.1 → 64.4</strong><p className="muted">체감 BSI · 보합 기준 100</p></>
              : <p className="muted">비교 기간의 경기동향 자료가 준비되면 표시돼요.</p>}
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
      setQuestion(undefined)
    }} />}
  </>
}
