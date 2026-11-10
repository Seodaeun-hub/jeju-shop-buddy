import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { fetchInstagramPublication, type InstagramPublicationStatus } from '../api/shop'
import { CustomerNoticeDetails } from '../components/CustomerNotice'
import { Citrus, PageTitle } from '../components/ui'
import { ExecutionGuideSteps } from '../components/ExecutionGuidePanel'
import { drawPromotionCard } from '../data/promotionCard'
import { formatNumber, won } from '../data/shop'
import type { Analysis, InventoryItem, Plan, PromotionDraftInput, PromotionReviewInput, PromotionTone } from '../data/shop'
import { InventoryReview } from './InventoryReview'
import { PromotionReview } from './PromotionReview'
import { InstagramPublish } from './InstagramPublish'
import { PromotionDraftForm } from './PromotionDraftForm'
import '../styles/execution.css'

function shortDate(date: string) {
  const [, month, day] = date.split('-')
  return `${Number(month)}월 ${Number(day)}일`
}

function getDraft(plan: Plan) {
  const { store, strategy, timeLabel, tasks, budget, endDate, demo } = plan
  const start = tasks[strategy === 'promotion' ? 1 : 2].date
  const period = `${shortDate(start)} ~ ${shortDate(endDate)}`
  if (plan.reviewAction) {
    return {
      headline: '오후 식사 주문 안내',
      feature: '오후 2~5시 주문 가능',
      detail: period,
      caption: store + '에서는 오후 2~5시에도 식사 주문을 받아요. 이용 가능한 메뉴는 매장에 문의해 주세요.',
    }
  }
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

function PromoDraft({ plan, auth, instagramStatus, onInstagramStatus }: {
  plan: Plan
  auth?: string
  instagramStatus?: InstagramPublicationStatus
  onInstagramStatus?: (status: InstagramPublicationStatus) => void
}) {
  const saved = plan.promotionDraft
  const { headline, feature, detail, caption: draftCaption } = saved ?? getDraft(plan)
  const publication = instagramStatus?.publication
  const caption = publication?.caption ?? draftCaption
  const postedImage = publication?.imageDataUrl
  const store = saved?.storeName ?? plan.store
  const canvas = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('')
  const [rendered, setRendered] = useState<{ photo: string | null; draft: typeof saved }>()
  const photoUrl = saved?.photoDataUrl ?? null
  const instagram = Boolean(saved) || plan.channel === '인스타그램'
  const ready = rendered?.photo === photoUrl && rendered.draft === saved

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    if (saved && saved.templateVersion >= 2) {
      drawPromotionCard(context, saved)
      if (!photoUrl) {
        setRendered({ photo: null, draft: saved })
        return
      }
      const photo = new Image()
      photo.onload = () => {
        drawPromotionCard(context, saved, photo)
        setRendered({ photo: photoUrl, draft: saved })
      }
      photo.onerror = () => setStatus('저장된 사진을 표시하지 못했어요.')
      photo.src = photoUrl
      return () => { photo.onload = null; photo.onerror = null }
    }
    const font = '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif'
    context.fillStyle = '#fff3db'
    context.fillRect(0, 0, 1080, 1080)
    context.strokeStyle = '#b74612'
    context.lineWidth = 5
    context.strokeRect(54, 54, 972, 972)
    context.textAlign = 'center'
    context.fillStyle = '#273a26'
    context.font = `700 45px ${font}`
    context.fillText(store, 540, 195, 860)
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

    if (saved) {
      context.font = `700 36px ${font}`
      context.fillText('할인 후 ' + saved.discountedPrice, 540, 662, 860)
    }
    context.fillStyle = '#273a26'
    context.font = `700 27px ${font}`
    context.fillText('가게짝꿍 · 홍보 초안', 540, 975, 860)
    if (!photoUrl) {
      context.fillStyle = '#ed7b18'
      context.beginPath()
      context.ellipse(540, 815, 112, 90, 0, 0, 2 * Math.PI)
      context.fill()
      context.fillStyle = '#2e6539'
      context.beginPath()
      context.ellipse(578, 737, 53, 21, -.43, 0, 2 * Math.PI)
      context.fill()
      setRendered({ photo: null, draft: saved })
      return
    }
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(680 / image.width, 245 / image.height)
      const width = image.width * scale
      const height = image.height * scale
      context.drawImage(image, (1080 - width) / 2, 695 + (245 - height) / 2, width, height)
      setRendered({ photo: photoUrl, draft: saved })
    }
    image.onerror = () => setStatus('저장된 사진을 표시하지 못했어요.')
    image.src = photoUrl
    return () => { image.onload = null; image.onerror = null }
  }, [detail, feature, headline, photoUrl, saved, store])

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
    <div className="ruled"><h2>{publication?.state === 'PUBLISHED' ? '게시한 인스타그램 홍보물' : `${saved ? '인스타그램' : plan.channel} 홍보 초안`}</h2></div>
    <div className="receipt promo-draft">
      {postedImage && <img src={postedImage} alt={`${store} 게시 당시 홍보 이미지`} width={1080} height={1080} />}
      <canvas hidden={Boolean(postedImage)} ref={canvas} width="1080" height="1080" role="img" aria-label={`${store} 홍보 이미지 · ${headline}${saved ? ` · ${saved.discountedPrice}` : ""} · ${feature} · ${detail}`} />
      <div className="promo-copy">
        <span className="badge">{saved?.copySource === 'EDITED' ? '직접 작성' : saved?.copySource === 'GPT' ? 'GPT 문구' : saved ? '기본 문구' : '초안'}</span>
        {saved && !publication && <p><strong>초안 게시 예정</strong> · {saved.publishDate} {saved.publishTime.slice(0, 5)} 한국 시간</p>}
        <p>{caption}</p>
        <div className="promo-actions">
          {postedImage ? <a className="button secondary small" href={postedImage} download="가게짝꿍-게시한-홍보물.jpg">이미지 저장</a>
            : <button type="button" className="button secondary small" disabled={!ready} onClick={saveImage}>이미지 저장</button>}
          <button type="button" className="button secondary small" onClick={copyCaption}>문구 복사</button>
        </div>
        {saved && plan.id && auth && onInstagramStatus && (ready || postedImage) &&
          <InstagramPublish key={plan.id} auth={auth} planId={plan.id} caption={caption} hasPhoto={Boolean(photoUrl)} endDate={plan.endDate}
            image={() => postedImage ?? canvas.current?.toDataURL('image/jpeg', 0.88)} state={instagramStatus}
            onStatus={onInstagramStatus} />}
        {instagram && <a href="https://www.instagram.com/" target="_blank" rel="noreferrer">인스타그램 열기 ↗</a>}
        {!publication && <small className="muted">게시 전 날짜와 안내 내용을 확인해 주세요.</small>}
        <small role="status">{status}</small>
      </div>
    </div>
  </section>
}

export function Execution({ plan, onChange, onToggleChecklist, analysis, onSaveInventory, onSavePromotion, auth, onSavePromotionDraft, onRegeneratePromotionCaption, resultsTo }: {
  plan: Plan
  onChange: (value: Plan) => void
  onToggleChecklist: (index: number, completed: boolean) => Promise<void>
  analysis: Analysis
  onSaveInventory?: (items: InventoryItem[]) => Promise<void>
  onSavePromotion?: (input: PromotionReviewInput) => Promise<void>
  auth?: string
  onSavePromotionDraft?: (input: PromotionDraftInput) => Promise<void>
  onRegeneratePromotionCaption: (tone: PromotionTone) => Promise<void>
  resultsTo: string
}) {
  const [savingIndex, setSavingIndex] = useState<number>()
  const [checklistError, setChecklistError] = useState('')
  const [instagramStatus, setInstagramStatus] = useState<InstagramPublicationStatus>()
  const trackInstagram = plan.strategy === 'promotion' && Boolean(auth && plan.id)
  const locked = Boolean(instagramStatus?.publication)
  const loadingInstagram = trackInstagram && !instagramStatus

  useEffect(() => {
    if (!trackInstagram || !auth || !plan.id) return
    const controller = new AbortController()
    fetchInstagramPublication(auth, plan.id, controller.signal).then(setInstagramStatus).catch(() => {
      if (!controller.signal.aborted) setInstagramStatus({ available: false, username: '' })
    })
    return () => controller.abort()
  }, [trackInstagram, auth, plan.id])

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
    {plan.recommendation && <section className="receipt ruled-block" aria-label="저장된 AI 추천">
      <h2>선택한 AI 추천</h2>
      <dl className="reason">
        <dt>추천 이유</dt><dd>{plan.recommendation.reason}</dd>
        <dt>확인한 변화</dt>
        <dd><ul>{plan.recommendation.evidence.map((item) => <li key={item}>{item}</li>)}</ul></dd>
        {plan.recommendation.contextEvidence.length > 0 && <>
          <dt>경기 참고</dt>
          <dd><ul>{plan.recommendation.contextEvidence.map((item) => <li key={item}>{item}</li>)}</ul></dd>
        </>}
      </dl>
    </section>}
    {plan.customerNotice && <section className="receipt ruled-block" aria-label="손님 안내 제안">
      <h2>손님 안내 제안</h2>
      <p>{plan.customerNotice.concern}</p>
      <CustomerNoticeDetails notice={plan.customerNotice} />
    </section>}
    {plan.executionGuide && <section className="receipt ruled-block execution-guide" aria-label="저장된 실행 가이드">
      <h2>저장된 실행 가이드</h2>
      <p>{plan.executionGuide.channel === 'NAVER' ? '네이버 안내' : '매장 안내'}</p>
      <ExecutionGuideSteps guide={plan.executionGuide} />
    </section>}
    <div className="split planning execution-layout">
      <section>
        <div className="section-top ruled">
          <h2>실행 일정과 점검표</h2>
          <span className="badge" aria-live="polite">{plan.done.length} / {plan.tasks.length} 완료</span>
        </div>
        {plan.reviewEvidence && <details className="ruled-block">
          <summary>이 계획의 리뷰 근거 {plan.reviewEvidence.length}건 보기</summary>
          <ul className="review-evidence">{plan.reviewEvidence.map((review) => <li key={review.id}>
            <time dateTime={review.date}>{review.date}</time><span>{review.text}</span>
          </li>)}</ul>
        </details>}
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
        {plan.strategy === 'promotion' && <PromotionReview key={locked ? 'locked' : 'editable'} analysis={analysis}
          saved={plan.promotionReview} initialBudget={plan.budget} readOnly={locked || loadingInstagram} onSave={onSavePromotion} />}
        {plan.strategy === 'promotion' && auth && onSavePromotionDraft && <>
          {locked && <p className="muted">인스타그램 게시를 예약했거나 시작한 계획의 할인 조건과 홍보물은 수정할 수 없어요.</p>}
          {!locked && !loadingInstagram &&
            <PromotionDraftForm key={plan.promotionReview?.productName} plan={plan} auth={auth} onSave={onSavePromotionDraft} onRegenerate={onRegeneratePromotionCaption} />}
          {plan.promotionDraft && <PromoDraft plan={plan} auth={auth} instagramStatus={instagramStatus}
            onInstagramStatus={setInstagramStatus} />}
        </>}
        {inventory ? <InventoryReview
          items={plan.inventoryItems ?? []}
          analysis={analysis}
          onSave={onSaveInventory}
          reviewDate={shortDate(plan.tasks[2].date)}
          onChange={(inventoryItems) => onChange({ ...plan, inventoryItems })}
        /> : !(plan.id && plan.strategy === 'promotion') && !needsPromotionInputs
          && (!plan.reviewTopic || plan.reviewTopic === 'AFTERNOON_ORDER') && <PromoDraft plan={plan} />}
        <section>
          <h2>실행 후 확인할 지표</h2>
          <p className="execution-metric">{plan.followUp}</p>
        </section>
        <Link className="button secondary full execution-results" to={resultsTo}>실행 결과 확인 <span aria-hidden="true">→</span></Link>
      </div>
    </div>
  </>
}
