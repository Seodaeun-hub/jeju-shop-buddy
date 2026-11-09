import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { Citrus, PageTitle } from '../components/ui'
import { formatNumber, won } from '../data/shop'
import type { Plan } from '../data/shop'
import { InventoryReview } from './InventoryReview'
import '../styles/execution.css'

function shortDate(date: string) {
  const [, month, day] = date.split('-')
  return `${Number(month)}월 ${Number(day)}일`
}

function getDraft(plan: Plan) {
  const { store, strategy, timeLabel, tasks, budget, endDate, demo } = plan
  const start = tasks[strategy === 'promotion' ? 1 : 2].date
  const period = `${shortDate(start)} ~ ${shortDate(endDate)}`
  const isPromotion = strategy === 'promotion'
  const sampleLimit = demo && isPromotion ? Math.min(50, Math.floor(budget / 1000)) : 0
  const headline = isPromotion ? '한정 시간대 방문 안내' : '우리 가게 소식'
  const feature = sampleLimit ? '1,000원 할인' : isPromotion ? '가볍게 들러보세요!' : '오늘도 문 열었어요!'
  const detail = [period, isPromotion ? timeLabel : undefined].filter(Boolean).join(' · ')
  const caption = [
    `${store}에서 소식을 전해요.`,
    isPromotion ? `${detail}, 편하게 들러보세요.` : '가게 소식이 궁금하다면 매장에서 확인해 주세요.',
    sampleLimit ? `식사 주문 시 1,000원 할인 · 행사 기간 총 ${formatNumber(sampleLimit)}건 한정` : '',
  ].filter(Boolean).join('\n')
  return { headline, feature, detail, caption }
}

function PromoDraft({ plan }: { plan: Plan }) {
  const { headline, feature, detail, caption } = getDraft(plan)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('')
  const instagram = plan.channel === '인스타그램'

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    const font = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif'
    context.fillStyle = '#fff3db'
    context.fillRect(0, 0, 1080, 1080)
    context.strokeStyle = '#b74612'
    context.lineWidth = 5
    context.strokeRect(54, 54, 972, 972)
    context.textAlign = 'center'
    context.fillStyle = '#273a26'
    context.font = `700 45px ${font}`
    context.fillText(plan.store, 540, 195, 860)
    context.fillStyle = '#3e2718'
    context.font = `700 70px ${font}`
    context.fillText(headline, 540, 310, 860)
    context.fillStyle = '#b74612'
    context.fillRect(112, 362, 856, 145)
    context.fillStyle = '#fff8e9'
    context.font = `700 83px ${font}`
    context.fillText(feature, 540, 461, 794)
    context.fillStyle = '#3e2718'
    context.font = `700 45px ${font}`
    context.fillText(detail, 540, 606, 860)

    context.fillStyle = '#ed7b18'
    context.beginPath()
    context.ellipse(540, 807, 127, 104, 0, 0, 2 * Math.PI)
    context.fill()
    context.fillStyle = '#fff1ce'
    context.beginPath()
    context.ellipse(480, 765, 16, 27, .8, 0, 2 * Math.PI)
    context.fill()
    context.fillStyle = '#2e6539'
    context.beginPath()
    context.ellipse(578, 710, 62, 24, -.43, 0, 2 * Math.PI)
    context.fill()
    context.fillStyle = '#273a26'
    context.font = `700 27px ${font}`
    context.fillText('가게짝꿍 · 홍보 초안', 540, 975, 860)
  }, [detail, feature, headline, plan.store])

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(caption)
      setStatus('홍보 문구를 복사했어요.')
    } catch {
      setStatus('화면에서 문구를 선택해 직접 복사해 주세요.')
    }
  }

  function saveImage() {
    canvas.current?.toBlob((file) => {
      if (!file) {
        setStatus('이미지를 만들 수 없어요. 다시 시도해 주세요.')
        return
      }
      const url = URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = '가게짝꿍-홍보-초안.png'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setStatus('PNG 다운로드를 시작했어요.')
    }, 'image/png')
  }

  return <section className="execution-material">
    <div className="ruled"><h2>{plan.channel} 홍보 초안</h2></div>
    <div className="receipt promo-draft">
      <canvas ref={canvas} width="1080" height="1080" role="img" aria-label={`${plan.store} 홍보 이미지 · ${feature} · ${detail}`} />
      <div className="promo-copy">
        <span className="badge">초안</span>
        <p>{caption}</p>
        <div className="promo-actions">
          <button type="button" className="button secondary small" onClick={saveImage}>이미지 저장</button>
          <button type="button" className="button secondary small" onClick={copyCaption}>문구 복사</button>
        </div>
        {instagram && <a href="https://www.instagram.com/" target="_blank" rel="noreferrer">인스타그램 열기 ↗</a>}
        <small className="muted">게시 전 날짜와 안내 내용을 확인해 주세요.</small>
        <small role="status">{status}</small>
      </div>
    </div>
  </section>
}

export function Execution({ plan, onChange, onToggleChecklist, resultsTo }: {
  plan: Plan
  onChange: (value: Plan) => void
  onToggleChecklist: (index: number, completed: boolean) => Promise<void>
  resultsTo: string
}) {
  const [savingIndex, setSavingIndex] = useState<number>()
  const [checklistError, setChecklistError] = useState('')

  async function toggleChecklist(index: number, completed: boolean) {
    if (savingIndex !== undefined) return
    setSavingIndex(index)
    setChecklistError('')
    try {
      await onToggleChecklist(index, completed)
    } catch (error) {
      setChecklistError(error instanceof Error ? error.message : '점검 상태를 저장할 수 없어요. 다시 시도해 주세요.')
    } finally {
      setSavingIndex(undefined)
    }
  }

  const next = plan.tasks.findIndex((_, index) => !plan.done.includes(index))
  const inventory = plan.strategy === 'inventory'
  const needsPromotionInputs = plan.strategy === 'promotion' && !!plan.missingInputs?.length
  const dateRange = `${plan.startDate.replaceAll('-', '.')} ~ ${plan.endDate.replaceAll('-', '.')}`

  return <>
    <PageTitle title="실행 계획 · 진행 관리" detail={`${plan.store}${plan.demo ? ' · 시연 예시' : ''}`} />
    <section className="receipt summary-strip execution-summary" aria-label="선택한 실행 계획">
      <Citrus stamp />
      <strong>{plan.title}</strong>
      <span className="execution-period">{dateRange} · {plan.duration}{!inventory && ` · 예산 한도 ${won(plan.budget)}`}</span>
      <span className="badge">{next === -1 ? '완료' : '진행 중'}</span>
    </section>
    <div className="split planning execution-layout">
      <section>
        <div className="section-top ruled">
          <h2>실행 일정과 점검표</h2>
          <span className="badge" aria-live="polite">{plan.done.length} / {plan.tasks.length} 완료</span>
        </div>
        <ul className="execution-checklist">{plan.tasks.map(({ id, label, date }, index) => <li key={id ?? index} className={next === index ? 'highlight' : ''}>
          <label>
            <input type="checkbox" checked={plan.done.includes(index)} disabled={savingIndex !== undefined}
              onChange={(event) => void toggleChecklist(index, event.target.checked)} />
            <time dateTime={date}>{shortDate(date)}</time>
            <strong>{label}</strong>
            {next === index && <span className="badge">다음 할 일</span>}
          </label>
        </li>)}</ul>
        {savingIndex !== undefined && <p className="muted" role="status">점검 상태를 저장하는 중이에요.</p>}
        {checklistError && <p className="error" role="alert">{checklistError}</p>}
        {plan.strategy === 'promotion' && !plan.timeLabel && <p className="muted execution-note">행사 소식을 올리기 전에 혜택을 적용할 시간대를 정해 주세요.</p>}
      </section>
      <div className="form-stack execution-aside">
        {inventory ? <InventoryReview
          items={plan.inventoryItems ?? []}
          reviewDate={shortDate(plan.tasks[2].date)}
          onChange={(inventoryItems) => onChange({ ...plan, inventoryItems })}
        /> : needsPromotionInputs ? <section className="execution-material">
          <div className="ruled"><h2>혜택을 정하기 전에 확인할 자료</h2></div>
          <ul>{plan.missingInputs?.map((input) => <li key={input}>{input}</li>)}</ul>
        </section> : <PromoDraft plan={plan} />}
        <section>
          <h2>실행 후 확인할 지표</h2>
          <p className="execution-metric">{plan.followUp}</p>
        </section>
        <Link className="button secondary full execution-results" to={resultsTo}>실행 결과 확인 <span aria-hidden="true">→</span></Link>
      </div>
    </div>
  </>
}
