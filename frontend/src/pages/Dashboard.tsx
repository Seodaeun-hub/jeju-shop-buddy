import { ChartQuestions } from '../components/ChartQuestions'
import { MonthlySalesChart } from '../components/MonthlySalesChart'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { Citrus } from '../components/ui'
import { changeRate, example, formatNumber, formatRate, monthLabel, won } from '../data/shop'
import type { Analysis, TimeSeries } from '../data/shop'
import { attachHourlySales, checkConcern, fetchMarketContext } from '../api/shop'
import type { ConcernCheck, MarketContext, QuestionChart } from '../api/shop'
import { bsiSource, marketSource } from '../data/marketSources'
import { importPos } from '../data/pos'
import { TimeDialog } from './Intake'
import '../styles/dashboard.css'

const bsiFormat = new Intl.NumberFormat('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format
type DashboardInsight = 'bsi' | 'time' | 'concern' | 'products'

type Topic = {
  chart: QuestionChart
  title: string
  suggestion: string
  answer: string
  source: string
  figure?: string
}

function MarketChart({ storeRate, marketRate, label = '상권 카드 이용액' }: {
  storeRate: number | null; marketRate: number | null; label?: string
}) {
  const limit = Math.max(10, Math.ceil(Math.max(Math.abs(storeRate ?? 0), Math.abs(marketRate ?? 0)) / 10) * 10)
  const items = [
    { label: '우리 가게 매출', rate: storeRate },
    { label, rate: marketRate },
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

function BsiChart({ months, values, sources }: {
  months: [string, string]; values: [number, number]; sources?: MarketContext['bsiSources']
}) {
  const difference = values[1] - values[0]
  return <>
    <strong className="bsi">{values.map(bsiFormat).join(' → ')}</strong>
    <p className="muted">제주 전체 소상공인 체감 BSI · {difference > 0 ? '+' : ''}{bsiFormat(difference)}p</p>
    <ul className="bsi-chart" aria-label="월별 제주 소상공인 체감 BSI">
      {months.map((month, index) => <li key={month}>
        <span>{monthLabel(month)}</span>
        <span className="bsi-track" aria-hidden="true"><span style={{ width: `${values[index] / 2}%` }} /></span>
        <strong>{bsiFormat(values[index])}</strong>
      </li>)}
    </ul>
    <p className="muted">보합 기준 100</p>
    <details className="source-details">
      <summary>자료 출처 보기</summary>
      {(sources ?? [{ label: '소상공인시장진흥공단', url: bsiSource }]).map(source =>
        <div key={source.url}><a href={source.url}>{source.label}</a></div>)}
    </details>
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

function Questions({ topic, period, onClose }: { topic: Topic; period: string; onClose: () => void }) {
  const [draft, setDraft] = useState('')
  const [asked, setAsked] = useState('')

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
      <div className="chat-turn">
        <p className="question-bubble">{asked}</p>
        <div className="chat-reply">
          <Citrus />
          <div className="answer-bubble chat-answer">
            <strong className="chat-answer-name">가게짝꿍 · 답변 예시</strong>
            {showAnswer && topic.figure && <p className="dashboard-chat-figure">{topic.figure}</p>}
            <p>{showAnswer ? topic.answer : '지금은 아래 예시 질문에 답할 수 있어요.'}</p>
            {showAnswer && <details className="source-details">
              <summary>자료 출처 보기</summary>
              <small>{topic.source}</small>
            </details>}
          </div>
        </div>
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
  return <button type="button" className="text-button dashboard-ask" aria-label={label} onClick={(event) => onClick(event.currentTarget)}>이 차트 질문</button>
}

function reviewExampleConcern(concern: string, before: Analysis['monthly'][number], after: Analysis['monthly'][number], series?: TimeSeries) {
  const text = concern.trim().replace(/[.!?。]+$/, '')
  if (/^(지난달보다 )?매출(이|은) (줄었어요|감소했어요)$/.test(text)) {
    const monthIndex = (month: string) => Number(month.slice(0, 4)) * 12 + Number(month.slice(5))
    if (text.startsWith('지난달보다') && monthIndex(after.month) - monthIndex(before.month) !== 1) {
      return { status: '자료 부족', detail: '지난달과 비교하려면 연속된 두 달의 매출이 필요해요.' }
    }
    return {
      status: after.amount < before.amount ? '매출 감소 확인' : '매출 감소 없음',
      detail: `${monthLabel(before.month)} ${won(before.amount)} → ${monthLabel(after.month)} ${won(after.amount)}`,
    }
  }

  if (text === '평일 오후에 손님이 줄었어요') {
    const afternoon = series?.metric === 'count' && series.rows.find(({ label }) => label === '오후 2~5시')
    if (afternoon) {
      return {
        status: '참고 지표 · 오후 결제 건수',
        detail: `오후 2~5시 전체 결제 건수는 ${formatNumber(afternoon.before)}건 → ${formatNumber(afternoon.after)}건이에요. 평일 방문객 수를 확인하려면 요일별 방문 자료가 필요해요.`,
      }
    }
    return { status: '자료 부족', detail: '평일 오후 방문객 수를 비교할 자료가 필요해요.' }
  }

  if (text === '잘 팔리지 않는 품목의 재고가 남아요' || text === '재고가 남아요') {
    return { status: '자료 부족', detail: '판매 자료와 함께 품목별 현재 재고를 확인해야 해요.' }
  }

  return { status: '추가 확인 필요', detail: '현재 매출 자료만으로 이 고민을 판단하기 어려워요.' }
}

function ConcernResult({ result, onUpload, checking }: {
  result: ConcernCheck
  onUpload: (file: File, months: [string, string]) => void
  checking: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const { status, before, after, beforeMonth, afterMonth, startHour, endHour, changeRate, posMonths } = result
  const compared = status === 'COMPARED' && before != null && after != null && beforeMonth && afterMonth
  const metric = result.metric === 'COUNT' ? '결제 건수' : result.metric === 'PRODUCT' ? '판매량'
    : result.metric === 'PRODUCT_REVENUE' ? '실판매금액' : '매출액'
  const format = result.metric === 'COUNT' ? (value: number) => `${formatNumber(value)}건`
    : result.metric === 'PRODUCT' ? (value: number) => `${formatNumber(value)}개` : won
  const headline = result.answer ?? (status === 'MISSING_DATA' ? '확인할 자료가 더 필요해요.'
    : status === 'CLARIFICATION_REQUIRED' ? '어떤 점이 궁금한지 조금 더 알려 주세요.'
      : status === 'UNAVAILABLE' ? '지금은 고민을 확인하지 못했어요.' : undefined)

  return <li className="dashboard-concern-result">
    {result.question && <p className="dashboard-concern-question">{result.question}</p>}
    {headline && <p><strong>{headline}</strong></p>}
    {compared && <div>
      <p>{result.productName && `${result.productName} `}{metric} 비교
        {startHour != null && endHour != null ? ` · ${startHour}:00~${endHour}:00` : ''}</p>
      <p>{monthLabel(beforeMonth)} {format(before)} → {monthLabel(afterMonth)} {format(after)}
        {changeRate != null ? ` · ${formatRate(changeRate)}` : ' · 기준값이 0이라 증감률은 계산할 수 없어요.'}</p>
    </div>}
    {result.detail && <p className="muted">{result.detail}</p>}
    {status === 'MISSING_DATA' && posMonths && <>
      <button className="button secondary small" type="button" disabled={checking} onClick={() => input.current?.click()}>
        POS 다시 올리기
      </button>
      <input ref={input} type="file" accept=".xlsx,.csv" hidden onChange={event => {
        const file = event.currentTarget.files?.[0]
        event.currentTarget.value = ''
        if (file) onUpload(file, posMonths)
      }} />
    </>}
  </li>
}

export function Dashboard({ data, auth, analysisId, onSaveTimeSeries, strategyTo }: {
  data: Analysis
  auth?: string
  analysisId?: string
  onSaveTimeSeries: (value: TimeSeries) => Promise<void>
  strategyTo: string
}) {
  const [question, setQuestion] = useState<Topic>()
  const [chatOpen, setChatOpen] = useState(false)
  const [chartEntry, setChartEntry] = useState<number>()
  const nextChartEntry = useRef(0)
  const [timeOpen, setTimeOpen] = useState(false)
  const returnToTimeInsight = useRef(false)
  const [activeInsight, setActiveInsight] = useState<DashboardInsight>()
  const insightDialog = useRef<HTMLDialogElement>(null)
  const insightTrigger = useRef<HTMLButtonElement>(null)
  const dashboardGrid = useRef<HTMLDivElement>(null)
  const chatPanel = useRef<HTMLDivElement>(null)
  const questionTrigger = useRef<HTMLButtonElement>(null)
  const chatLauncher = useRef<HTMLButtonElement>(null)
  const [before, after] = data.monthly.slice(-2)
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
  const reference = context?.cardReference
  const bsi = context?.bsi
  const missingContext = context === undefined ? '비교 자료를 불러오는 중이에요.'
    : context === null ? '비교 자료를 불러오지 못했어요.' : undefined
  const summary = delta === null ? '비교 기준 월의 매출이 0원이라 증감률을 계산할 수 없어요.'
    : delta === 0 ? '비교한 두 달의 매출이 같아요.'
      : `비교한 두 달 사이에 매출이 ${Math.abs(delta).toFixed(2)}% ${delta < 0 ? '줄었어요' : '늘었어요'}.`
  const series = data.timeSeries
  const concern = data.concern.trim()
  const exampleConcern = data.demo && concern ? reviewExampleConcern(concern, before, after, series) : undefined
  const [concernResults, setConcernResults] = useState<ConcernCheck[]>([])
  const [checkingConcern, setCheckingConcern] = useState(false)
  const [posAttachError, setPosAttachError] = useState('')
  const concernRequest = useRef<AbortController>(null)
  useEffect(() => () => concernRequest.current?.abort(), [])

  async function verifyConcern(upload?: { file: File; months: [string, string] }) {
    if (!analysisId || !auth || concernRequest.current) return
    const controller = new AbortController()
    concernRequest.current = controller
    setCheckingConcern(true)
    setPosAttachError('')
    try {
      if (upload) {
        const { file, months } = upload
        const imported = await importPos(file, months)
        if (controller.signal.aborted) return
        const hourlySales = Object.fromEntries(months.map(month => [month, imported.hourlySales[month]]))
        await attachHourlySales(auth, analysisId, hourlySales, controller.signal)
      }
      const results = await checkConcern(auth, analysisId, controller.signal)
      if (!controller.signal.aborted) setConcernResults(results)
    } catch (error) {
      if (!controller.signal.aborted) {
        if (upload) setPosAttachError(error instanceof Error ? error.message : 'POS 파일을 추가할 수 없어요.')
        else setConcernResults([{ status: 'UNAVAILABLE', detail: '고민 확인에 실패했어요. 다시 시도해 주세요.' }])
      }
    } finally {
      if (!controller.signal.aborted) {
        concernRequest.current = null
        setCheckingConcern(false)
      }
    }
  }
  const biggestDrop = series?.rows.reduce<TimeSeries['rows'][number] | undefined>((largest, row) => {
    const drop = row.before - row.after
    return drop > (largest ? largest.before - largest.after : 0) ? row : largest
  }, undefined)
  const unit = series?.metric === 'count' ? '결제 건수' : '매출'
  const timeTitle = biggestDrop
    ? series?.metric === 'count' ? '결제가 줄어든 시간대' : '매출이 줄어든 시간대'
    : `시간대별 ${series ? unit : '매출 분석'}`
  const formatTime = series?.metric === 'count' ? (value: number) => `${formatNumber(value)}건` : won
  const timeChartProps = { labels: [monthLabel(before.month), monthLabel(after.month)] as [string, string], format: formatTime, highlight: biggestDrop }
  const productSales = data.productSales ?? []
  const [bestSellingProduct] = [...productSales].sort((first, second) => second.after - first.after)
  const insights: { id: DashboardInsight; label: string; preview: string }[] = [
    { id: 'time', label: '시간대별 변화', preview: biggestDrop ? `${biggestDrop.label} · ${formatTime(biggestDrop.before - biggestDrop.after)} 감소` : series ? '감소한 시간대 없음' : '시간대별 자료 추가' },
    { id: 'bsi', label: '제주 경기동향', preview: bsi ? `${bsiFormat(bsi.before)} → ${bsiFormat(bsi.after)}` : missingContext ?? '비교 자료 없음' },
    { id: 'products', label: '품목별 판매량', preview: bestSellingProduct ? `${bestSellingProduct.productName} · ${formatNumber(bestSellingProduct.after)}개` : '상품 주문 자료 없음' },
    ...(concern ? [{ id: 'concern' as const, label: '사장님이 적은 고민', preview: concern }] : []),
  ]
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
    source: context?.bsiSources?.map(item => item.label).join(' · ') ?? '소상공인시장진흥공단',
  }
  const saved = Boolean(auth && analysisId)
  const suggestedTopic = series ? timeTopic : market ? comparisonTopic : monthlyTopic

  useLayoutEffect(() => {
    const dialog = insightDialog.current
    if (activeInsight && !timeOpen && dialog && !dialog.open) {
      insightTrigger.current?.focus()
      dialog.showModal()
    }
  }, [activeInsight, timeOpen])

  function editTimeFromInsight() {
    returnToTimeInsight.current = true
    insightDialog.current?.close()
    setActiveInsight(undefined)
    setTimeOpen(true)
  }

  function closeTimeEditor() {
    setTimeOpen(false)
    if (returnToTimeInsight.current) {
      returnToTimeInsight.current = false
      setActiveInsight('time')
    }
  }

  function openTopic(topic: Topic, button: HTMLButtonElement, fromChart = true) {
    setChartEntry(fromChart ? ++nextChartEntry.current : undefined)
    questionTrigger.current = activeInsight ? insightTrigger.current : button
    insightDialog.current?.close()
    setQuestion(topic)
    setChatOpen(true)
    requestAnimationFrame(() => chatPanel.current?.focus())
  }

  const closeTopic = useCallback(() => {
    setChatOpen(false)
    requestAnimationFrame(() => {
      const trigger = questionTrigger.current
      if (trigger?.isConnected) trigger.focus()
      else chatLauncher.current?.focus()
    })
  }, [])

  useEffect(() => {
    if (!chatOpen || timeOpen || activeInsight) return
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !event.defaultPrevented) closeTopic()
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [activeInsight, chatOpen, timeOpen, closeTopic])

  useLayoutEffect(() => {
    const panels = dashboardGrid.current?.querySelectorAll<HTMLElement>('[data-dashboard-chart]')
    if (!panels || typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver((entries) => {
      for (const { isIntersecting, target } of entries) {
        if (!isIntersecting || !(target instanceof HTMLElement)) continue
        target.dataset.chartMotion = 'visible'
        observer.unobserve(target)
      }
    }, { rootMargin: '0px 0px -36px 0px' })

    panels.forEach(panel => {
      panel.dataset.chartMotion = 'pending'
      observer.observe(panel)
    })
    return () => {
      observer.disconnect()
      panels.forEach(panel => { delete panel.dataset.chartMotion })
    }
  }, [])

  return <>
    <div className="analysis-dashboard" ref={dashboardGrid}>
    <section className="dashboard-overview" aria-label="매출 요약">
      <dl className="dashboard-totals">
        <div className="dashboard-kpi dashboard-kpi-primary">
          <dt>우리 가게 매출</dt>
          <dd>{won(after.amount)}</dd>
          <dd className="dashboard-kpi-note">{monthLabel(after.month)}</dd>
        </div>
        <div className="dashboard-kpi">
          <dt>우리 가게 매출 변화</dt>
          <dd className={delta === null ? 'muted' : delta < 0 ? 'down' : delta > 0 ? 'up' : ''}>{formatRate(delta)}</dd>
          <dd className="dashboard-kpi-note">{monthLabel(before.month)} 대비{delta === null ? ' · 기준 매출 0원' : delta < 0 ? ' 감소' : delta > 0 ? ' 증가' : ' 변화 없음'}</dd>
        </div>
        <div className="dashboard-kpi">
          <dt>같은 기간 상권 변화</dt>
          <dd className={!market || market.rate === null ? 'muted' : market.rate < 0 ? 'down' : market.rate > 0 ? 'up' : ''}>
            {market ? formatRate(market.rate) : context === undefined ? '불러오는 중' : '비교 자료 없음'}
          </dd>
          <dd className="dashboard-kpi-note">{reference ? '같은 지역·세부 업종 자료 없음' : '같은 지역·업종 카드 이용액'}</dd>
        </div>
      </dl>
      <Link className="button primary small dashboard-next" to={strategyTo}>대응 전략 보기 <span aria-hidden="true">→</span></Link>
    </section>
      <section className="dashboard-panel dashboard-monthly-chart" data-dashboard-chart>
        <div className="section-top"><h2>우리 가게 월별 매출</h2><AskButton label="월별 매출 차트 질문" onClick={(button) => openTopic(monthlyTopic, button)} /></div>
        <MonthlySalesChart monthly={data.monthly} />
      </section>
      <section className="dashboard-panel dashboard-market" data-dashboard-chart>
        <div className="section-top">
          <h2>상권과 비교</h2>
          {(market || saved) && <AskButton label="상권 비교 차트 질문" onClick={(button) => openTopic(comparisonTopic, button)} />}
        </div>
        {market ? <>
          <p className="muted">{data.area} · {data.industry}</p>
          <MarketChart storeRate={delta} marketRate={market.rate} />
          <details className="source-details dashboard-market-details">
            <summary>상권 금액과 출처 보기</summary>
            <p>{won(market.before)} → {won(market.after)}</p>
            <a href={marketSource}>제주데이터허브</a>
          </details>
        </> : reference ? <>
          <p className="muted">{reference.scope} 카드 소비 · 세부 업종 비교 자료 없음</p>
          <MarketChart storeRate={delta} marketRate={changeRate(reference.before, reference.after)} label="음식점업 전체" />
          <details className="source-details dashboard-market-details">
            <summary>참고 금액과 출처 보기</summary>
            <p>{won(reference.before)} → {won(reference.after)}</p>
            <a href={reference.source.url}>{reference.source.label}</a>
          </details>
        </> : <p className="muted dashboard-source">{missingContext ?? '같은 지역·업종의 두 달치 카드 이용 자료가 없어요.'}</p>}
      </section>
      <div className="dashboard-insights" role="group" aria-label="세부 분석">
        {insights.map(({ id, label, preview }) => <button key={id} type="button" className="dashboard-insight-trigger"
          aria-haspopup="dialog" aria-controls="dashboard-insight-dialog"
          onClick={(event) => {
            insightTrigger.current = event.currentTarget
            setActiveInsight(id)
          }}>
          <span className="dashboard-insight-label">{label}</span>
          <span className="dashboard-insight-preview">{preview}</span>
        </button>)}
      </div>
    </div>
    <dialog id="dashboard-insight-dialog" ref={insightDialog} className="time-dialog dashboard-detail-dialog"
      aria-labelledby="dashboard-insight-title" onClose={(event) => {
        if (!event.currentTarget.open) setActiveInsight(undefined)
      }}>
      <div className="section-top dashboard-insight-heading">
        <h2 id="dashboard-insight-title">{activeInsight === 'time' ? timeTitle : insights.find(({ id }) => id === activeInsight)?.label}</h2>
        <button className="button secondary small" type="button" autoFocus onClick={() => insightDialog.current?.close()}>닫기</button>
      </div>
      {activeInsight === 'bsi' && <section className="dashboard-bsi" data-chart-motion="visible">
        <div className="dashboard-panel-actions"><AskButton label="제주 경기동향 차트 질문" onClick={(button) => openTopic(bsiTopic, button)} /></div>
        {bsi
          ? <BsiChart months={[before.month, after.month]} values={[bsi.before, bsi.after]} sources={context?.bsiSources} />
          : <p className="muted">{missingContext ?? '비교한 두 달의 제주 체감 BSI 자료가 없어요.'}</p>}
      </section>}
      {activeInsight === 'time' && <section className="dashboard-time" data-chart-motion="visible">
          {(series || saved) && <div className="dashboard-panel-actions"><AskButton label="시간대 차트 질문" onClick={(button) => openTopic(timeTopic, button)} /></div>}
          {biggestDrop && <p className="dashboard-time-finding">
            <strong>{biggestDrop.label}</strong>에 감소 폭이 가장 컸어요. {formatTime(biggestDrop.before)} → {formatTime(biggestDrop.after)}
          </p>}
          {series ? <>
            <TimeChart series={series} {...timeChartProps} />
            <div className="dashboard-panel-actions">
              <button type="button" className="text-button dashboard-detail-link" onClick={editTimeFromInsight}>시간대별 자료 수정</button>
            </div>
          </> : <div className="empty-state compact dashboard-empty">
            <strong>어느 시간대에 매출이 달라졌는지 보고 싶으세요?</strong>
            <p>POS 파일을 선택하거나 두 달의 시간대별 합계를 직접 입력해 주세요.</p>
            <button type="button" className="button secondary" onClick={editTimeFromInsight}>시간대별 자료 추가</button>
          </div>}
      </section>}
        {activeInsight === 'concern' && concern && <section className="dashboard-concern">
          <div className="section-top dashboard-concern-heading">
            <div><p className="dashboard-concern-text">{concern}</p></div>
            {analysisId && auth && <button className="button secondary small" type="button" disabled={checkingConcern}
              onClick={() => void verifyConcern()}>{checkingConcern ? '고민을 확인하고 있어요…' : 'AI에게 고민 확인하기'}</button>}
          </div>
          {exampleConcern && <p><strong>{exampleConcern.status}</strong> · {exampleConcern.detail}</p>}
          <div className="dashboard-concern-results" aria-live="polite" aria-busy={checkingConcern}>
            {concernResults.length > 0 && <ol aria-label="고민별 답변">
              {concernResults.map((result, index) => <ConcernResult key={index} result={result} checking={checkingConcern}
                onUpload={(file, months) => void verifyConcern({ file, months })} />)}
            </ol>}
          </div>
          {posAttachError && <p className="error" role="alert">{posAttachError}</p>}
        </section>}
      {activeInsight === 'products' && <section className="dashboard-products">
          {productSales.length ? <>
              <p className="muted">토스포스 상품 주문 시트 · 결제 완료 수량 합계</p>
              <div className="dashboard-product-table"><table className="input-table" aria-label="품목별 판매량 비교">
              <thead><tr>
                <th scope="col">품목</th><th scope="col">{monthLabel(before.month)}</th>
                <th scope="col">{monthLabel(after.month)}</th><th scope="col">수량 변화</th>
              </tr></thead>
              <tbody>{productSales.map(({ productName, before, after }) => {
                const difference = after - before
                return <tr key={productName}>
                  <th scope="row">{productName}</th>
                  <td>{formatNumber(before)}개</td><td>{formatNumber(after)}개</td>
                  <td className={difference < 0 ? 'down' : difference > 0 ? 'up' : 'muted'}>
                    {difference > 0 ? '+' : ''}{formatNumber(difference)}개
                  </td>
                </tr>
              })}</tbody>
              </table></div>
          </> : <p className="muted">상품 주문 자료가 포함된 POS 엑셀이나 상품 주문 CSV를 올리면 품목별 판매량을 볼 수 있어요.</p>}
      </section>}
    </dialog>
    <div className="dashboard-chat-widget">
      <div id="dashboard-chat-panel" className="dashboard-chat-window" ref={chatPanel}
        hidden={!chatOpen} tabIndex={-1}>
        {question && (auth && analysisId ? <ChartQuestions key={chartEntry ?? "general"} fromChart={chartEntry !== undefined} auth={auth} analysisId={analysisId} open={chatOpen}
          chart={question.chart} title={question.title} suggestion={question.suggestion}
          period={period} strategyTo={strategyTo} onClose={closeTopic} onTime={() => setTimeOpen(true)} /> : <Questions key={chartEntry ?? question.chart} topic={question} period={period} onClose={closeTopic} />)}
      </div>
      <button ref={chatLauncher} type="button" className="dashboard-chat-launcher"
        aria-label={chatOpen ? '짝꿍 대화 닫기' : '짝꿍 대화 열기'} aria-expanded={chatOpen}
        aria-controls="dashboard-chat-panel" aria-describedby={chatOpen ? undefined : 'dashboard-chat-tip'}
        onClick={(event) => chatOpen ? closeTopic() : openTopic(suggestedTopic, event.currentTarget, false)}>
        <Citrus />
      </button>
      {!chatOpen && <span id="dashboard-chat-tip" role="tooltip" className="dashboard-chat-tooltip">
        궁금한 건 짝꿍에게 질문하세요!
      </span>}
    </div>
    {timeOpen && <TimeDialog monthly={data.monthly} initial={series} onClose={closeTimeEditor} onSave={async (value) => {
      await onSaveTimeSeries(value)
      closeTimeEditor()
      if (!saved && question?.chart === 'TIME_SERIES') {
        setQuestion(undefined)
        if (chatOpen) closeTopic()
      }
    }} />}
  </>
}
