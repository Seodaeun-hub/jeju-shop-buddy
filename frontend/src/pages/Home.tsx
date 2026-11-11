import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Citrus } from '../components/ui'
import { LandingIllustration } from '../components/LandingIllustration'
import { changeRate, example, formatNumber, formatRate, monthLabel, won } from '../data/shop'
import type { Analysis, MonthlySales } from '../data/shop'
import '../styles/home.css'

const promotionPhoto = new URL('../assets/gogi-guksu.jpg', import.meta.url).href
const noticeDoorPhoto = new URL('../assets/jeju-shop-door.jpg', import.meta.url).href
const noticeArtwork = new URL('../assets/store-order-notice.png', import.meta.url).href
const timeRows = example.timeSeries?.rows
const afternoon = timeRows?.find(({ label }) => label === '오후 2~5시')
const months = example.monthly.slice(-2)
const shortMonth = (month: string) => Number(month.split('-')[1]) + '월'
const promotionOutcome = [
  { label: '판매량', unit: '그릇', before: 214, after: 280 },
  { label: '실판매금액', unit: '원', before: 1_853_500, after: 2_100_000 },
]

function useLandingReveal<T extends HTMLElement = HTMLElement>(threshold: number) {
  const ref = useRef<T>(null)
  const [revealed, setRevealed] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (typeof IntersectionObserver === 'undefined') {
      setRevealed(true)
      return
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && entry.intersectionRatio >= threshold) setRevealed(true)
      else if (entry.boundingClientRect.top >= 0) setRevealed(false)
    }, { threshold })
    observer.observe(element)
    return () => observer.disconnect()
  }, [threshold])

  return { ref, revealed }
}

function PlotGuides({ ticks, format }: { ticks: number[]; format: (value: number) => string }) {
  return <div className="landing-plot-guides" aria-hidden="true">
    {ticks.map((tick, index) => <span key={tick} style={{ top: (index / (ticks.length - 1) * 100) + '%' }}>
      <span>{format(tick)}</span>
    </span>)}
  </div>
}

function LandingComparisonCharts({ months, timeRows }: {
  months: MonthlySales[]
  timeRows: NonNullable<Analysis['timeSeries']>['rows']
}) {
  const salesChart = useLandingReveal<HTMLElement>(.35)
  const paymentChart = useLandingReveal<HTMLElement>(.35)
  const salesStep = 10_000_000
  const salesMax = Math.max(salesStep, Math.ceil(Math.max(...months.map(({ amount }) => amount)) / salesStep) * salesStep)
  const salesMin = Math.min(salesMax - salesStep, Math.floor(Math.min(...months.map(({ amount }) => amount)) / salesStep) * salesStep)
  const salesPoints = months.map(({ amount }) => (salesMax - amount) / (salesMax - salesMin) * 100)
  const [firstPoint, secondPoint] = salesPoints
  const maxPaymentCount = Math.max(...timeRows.flatMap(({ before, after }) => [before, after]))
  const paymentStep = Math.max(50, Math.ceil(maxPaymentCount / 150) * 50)
  const paymentMax = paymentStep * 3

  return <div className="landing-report">
    <header className="landing-report-header">
      <p>매출 분석</p>
      <p>{monthLabel(months[0].month)} → {shortMonth(months[1].month)}</p>
    </header>

    <figure className="landing-chart landing-sales-chart" ref={salesChart.ref} data-revealed={salesChart.revealed}>
      <figcaption>
        <span>월별 매출</span>
        <strong>{formatRate(changeRate(months[0].amount, months[1].amount))}</strong>
      </figcaption>
      <div className="landing-chart-plot">
        <PlotGuides ticks={[salesMax, (salesMax + salesMin) / 2, salesMin]} format={(value) => formatNumber(value / 10_000) + '만'} />
        <span className="landing-sales-line" aria-hidden="true">
          <span style={{
            clipPath: 'polygon(0 ' + firstPoint + '%, 100% ' + secondPoint + '%, 100% calc('
              + secondPoint + '% + 2px), 0 calc(' + firstPoint + '% + 2px))',
          }} />
        </span>
        <dl className="landing-sales-points">
          {months.map(({ month, amount }, index) => <div key={month}>
            <dt>{shortMonth(month)}</dt>
            <dd style={{ top: salesPoints[index] + '%' }}><strong>{won(amount)}</strong></dd>
          </div>)}
        </dl>
      </div>
    </figure>

    <figure className="landing-chart landing-payment-chart" ref={paymentChart.ref} data-revealed={paymentChart.revealed}>
      <figcaption>
        <span>시간대별 결제 건수</span>
        <span className="landing-chart-legend" aria-hidden="true">
          {months.map(({ month }) => <span key={month}>{shortMonth(month)}</span>)}
        </span>
      </figcaption>
      <div className="landing-chart-plot">
        <PlotGuides ticks={[paymentMax, paymentStep * 2, paymentStep, 0]} format={(value) => formatNumber(value)} />
        <div className="landing-payment-groups">
          {timeRows.map(({ label, before, after }) => <div
            className="landing-payment-group"
            data-highlighted={label === afternoon?.label}
            key={label}
          >
            <h3>{label}</h3>
            <dl>
              {[before, after].map((count, index) => <div className="landing-payment-column" key={months[index].month}
                style={{ height: (count / paymentMax * 100) + '%' }}>
                <dt className="landing-chart-sr-only">{shortMonth(months[index].month)}</dt>
                <dd>
                  <span className="landing-chart-bar" aria-hidden="true" />
                  <strong>{formatNumber(count)}<span className="landing-chart-sr-only">건</span></strong>
                </dd>
              </div>)}
            </dl>
          </div>)}
        </div>
      </div>
    </figure>
  </div>
}

function LandingFeature({ title, description, revealed, children }: {
  title: string
  description: string
  revealed: boolean
  children: ReactNode
}) {
  return <article className="landing-feature">
    <div className="landing-feature-copy">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
    <div className="landing-feature-stage" data-revealed={revealed}>
      {children}
    </div>
  </article>
}

function LandingFeatureExamples({ beforeCount, afterCount }: { beforeCount: number; afterCount: number }) {
  const section = useRef<HTMLElement>(null)
  const [revealedCount, setRevealedCount] = useState(0)

  useEffect(() => {
    const container = section.current
    if (!container) return
    const stages = container.querySelectorAll<HTMLElement>('.landing-feature-stage')
    let frame: number | undefined

    function updatePreviews() {
      frame = undefined
      const viewportHeight = window.innerHeight
      let visibleCount = 0

      for (const stage of stages) {
        const { top, height } = stage.getBoundingClientRect()
        const revealDepth = Math.min(height * .72, viewportHeight * .7)
        if (top > viewportHeight - revealDepth) break
        visibleCount++
      }

      setRevealedCount(visibleCount)
    }

    function scheduleUpdate() {
      frame ??= window.requestAnimationFrame(updatePreviews)
    }

    updatePreviews()
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)

    return () => {
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
    }
  }, [])

  return <section className="shell landing-features" ref={section} aria-labelledby="landing-features-title">
    <h2 id="landing-features-title">매출을 살핀 뒤, 이렇게 해볼 수 있어요.</h2>

    <LandingFeature title="할인 행사를 준비하고 홍보물 만들기" revealed={revealedCount > 0}
      description="할인 예산과 수량을 검토하고, 메뉴 사진으로 인스타그램 홍보 초안을 만들어요.">
      <figure className="landing-feature-preview landing-promo-preview">
        <img src={promotionPhoto} alt="돼지고기와 파를 얹은 제주 고기국수 한 그릇" loading="lazy" width="1536" height="1024" />
        <figcaption className="landing-promo-copy">
          <div>
            <span>오후 2~5시 한정</span>
            <strong>고기국수</strong>
          </div>
          <div>
            <p><s>{won(8500)}</s> <b>{won(7500)}</b></p>
            <span>30개 한정</span>
          </div>
        </figcaption>
      </figure>
    </LandingFeature>

    <LandingFeature title="재고를 보고 발주량 점검하기" revealed={revealedCount > 1}
      description="품목별 판매량을 참고하고, 재고와 입고 예정량을 입력해 얼마나 부족한지 확인해요.">
      <figure className="landing-feature-preview landing-stock-preview">
        <figcaption>국수 면 발주 검토표</figcaption>
        <table aria-label="국수 면 재고와 사용량">
          <thead>
            <tr><th scope="col">현재 재고</th><th scope="col">입고 예정</th><th scope="col">예상 사용</th></tr>
          </thead>
          <tbody>
            <tr><td>8.25 kg</td><td>2 kg</td><td>15.5 kg</td></tr>
          </tbody>
        </table>
        <dl><div><dt>부족 수량</dt><dd>5.25 kg</dd></div></dl>
      </figure>
    </LandingFeature>

    <LandingFeature title="궁금한 매출을 대화로 확인하기" revealed={revealedCount > 2}
      description="차트에서 궁금한 걸 물으면 짝꿍이 비교한 수치와 자료 출처를 함께 알려줘요.">
      <div className="landing-feature-preview landing-chat-preview" role="group" aria-label="매출 분석 대화 예시">
        <div className="landing-chat-turn">
          <p className="landing-chat-question">오후에는 결제가 얼마나 줄었어요?</p>
          <div className="landing-chat-response">
            <Citrus />
            <div>
              <p>오후 2~5시 결제가 <strong>4월 {formatNumber(beforeCount)}건에서 5월 {formatNumber(afterCount)}건</strong>으로 줄었어요.</p>
              <p className="landing-chat-source">2021년 4~5월 POS 결제 내역</p>
            </div>
          </div>
        </div>
        <div className="landing-chat-turn">
          <p className="landing-chat-question">그럼 뭘 먼저 해볼까요?</p>
          <div className="landing-chat-response">
            <Citrus />
            <div>
              <p>손님이 오후에도 주문할 수 있다는 걸 바로 알 수 있도록, <strong>가게 입구와 메뉴판의 주문 안내</strong>부터 확인해봐요.</p>
            </div>
          </div>
        </div>
      </div>
    </LandingFeature>

    <LandingFeature title="손님에게 보여줄 매장 안내문 만들기" revealed={revealedCount > 3}
      description="우리 가게의 주문 시간을 넣어 입구에 붙이거나 인쇄할 안내문을 만들어요.">
      <figure className="landing-feature-preview landing-notice">
        <img src={noticeDoorPhoto} alt="" loading="lazy" width={1536} height={1024} />
        <figcaption className="landing-notice-paper">
          <img src={noticeArtwork} alt="식사 주문 안내. 주문 가능 시간 11:00–20:00, 마지막 주문 19:30."
            loading="lazy" width={1491} height={1055} />
        </figcaption>
      </figure>
    </LandingFeature>

    <LandingFeature title="행사 결과로 다음 할인 조건 정하기" revealed={revealedCount > 4}
      description="행사 후 POS를 올려 같은 길이의 기간을 비교해요. 판매량과 실판매금액을 보고 다음 할인 조건을 검토할 수 있어요.">
      <figure className="landing-feature-preview landing-outcome-preview">
        <figcaption><strong>고기국수 행사 결과</strong><span>애월 시연 자료</span></figcaption>
        <div className="landing-outcome-metrics">
          {promotionOutcome.map(({ label, unit, before, after }) => (
            <section className="landing-outcome-metric" key={label}>
              <h4>{label}</h4>
              <p className="landing-outcome-delta">
                <strong>+{formatNumber(after - before)}</strong><span>{unit}</span>
              </p>
              <dl>
                {[{ period: '행사 전', value: before }, { period: '행사 후', value: after }].map(({ period, value }) => (
                  <div className="landing-outcome-reading" key={period}>
                    <dt>{period}</dt>
                    <dd>{formatNumber(value)}{unit}</dd>
                    <div className="landing-outcome-track" aria-hidden="true">
                      <span style={{ width: `${(value / after) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="landing-outcome-period">행사 전 5월 4~16일 <span aria-hidden="true">·</span> 행사 후 5월 18~30일</p>
      </figure>
    </LandingFeature>
  </section>
}

export function Home() {
  const conversation = useLandingReveal<HTMLHeadingElement>(.6)

  return <>
    <section className="landing-hero" aria-labelledby="landing-title">
      <LandingIllustration>
        <div className="shell landing-intro">
          <p className="landing-intro-label">제주 소상공인을 위한 매출 짝꿍</p>
          <h1 id="landing-title">매출이 줄었을 때,<br />무엇부터 해볼까요?</h1>
          <p>우리 가게 매출과 제주 상권을 함께 보고, 오늘 할 일을 정해요.</p>
          <div className="actions">
            <Link to="/stores" className="button primary">가게짝꿍 시작하기 <span aria-hidden="true">→</span></Link>
          </div>
        </div>
      </LandingIllustration>
      <a href="#landing-questions" className="landing-scroll-cue" aria-label="다음 섹션으로 이동">
        <span aria-hidden="true" />
      </a>
    </section>

    <section id="landing-questions" className="landing-dialogue" aria-labelledby="landing-questions-title">
      <div className="shell landing-question" data-revealed={conversation.revealed}>
        <h2 id="landing-questions-title" ref={conversation.ref}>사장님, 요즘 뭐가 고민이세요?</h2>
        <ul className="landing-prompts">
          <li>요즘 오후에 손님이 왜 줄었을까요?</li>
          <li>우리 가게만 매출이 줄어든 걸까요?</li>
          <li>가게에서 무엇부터 해볼까요?</li>
        </ul>
        <div className="landing-story-heading">
          <Citrus />
          <p>그럴 때 필요한 게 <strong>가게짝꿍</strong>이에요.</p>
        </div>
      </div>
    </section>

    {afternoon && timeRows && months.length === 2 && <section className="landing-story" aria-labelledby="landing-story-title">
      <div className="shell landing-answer">
        <div className="landing-answer-copy">
          <p className="landing-caption">{example.store} 분석 예시</p>
          <h2 id="landing-story-title">오후 2~5시에 결제가<br />가장 많이 줄었어요.</h2>
          <p className="landing-story-highlight">
            <strong>{formatRate(changeRate(afternoon.before, afternoon.after))}</strong>
            <span>오후 2~5시 결제 건수</span>
          </p>
          <p className="landing-story-action">결제가 줄어든 시간에 맞춰 할인 혜택을 검토하거나 주문 안내를 점검해봐요.</p>
          <p className="landing-market-summary">같은 기간 애월읍 한식업 카드 이용액 <strong>+7.34%</strong></p>
        </div>
        <LandingComparisonCharts months={months} timeRows={timeRows} />
      </div>
    </section>}

    {afternoon && <LandingFeatureExamples beforeCount={afternoon.before} afterCount={afternoon.after} />}

    <section className="landing-start" aria-labelledby="landing-start-title">
      <div className="shell landing-start-content">
        <h2 id="landing-start-title">우리 가게 매출도<br />살펴볼까요?</h2>
        <Link to="/stores" className="button primary">가게짝꿍 시작하기 <span aria-hidden="true">→</span></Link>
      </div>
    </section>
  </>
}
