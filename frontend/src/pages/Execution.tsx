import { useEffect, useRef, useState } from 'react'
import { notifyResultsDataChanged } from '../data/promotionArchive'
import { Link } from 'react-router'
import { fetchInstagramPublication, fetchManualPromotionPublication, type InstagramPublicationStatus, type ManualPromotionPublicationStatus } from '../api/shop'
import { CustomerNoticeDetails } from '../components/CustomerNotice'
import { Citrus, PageTitle } from '../components/ui'
import { ExecutionGuideSteps } from '../components/ExecutionGuidePanel'
import { StoreNotice } from '../components/StoreNotice'
import { ExecutionPlanSwitcher } from '../components/ExecutionPlanSwitcher'
import { PromotionChannelPreviews } from '../components/PromotionChannelPreviews'
import { drawPromotionCard } from '../data/promotionCard'
import { formatNumber, won } from '../data/shop'
import type { Analysis, InventoryItem, Plan, PromotionDraftInput, PromotionReviewInput, PromotionTone } from '../data/shop'
import { InventoryReview } from './InventoryReview'
import { PromotionReview } from './PromotionReview'
import { InstagramPublish } from './InstagramPublish'
import { PromotionDraftForm } from './PromotionDraftForm'
import { ManualPromotionPublication } from './ManualPromotionPublication'
import '../styles/execution.css'

function shortDate(date: string) {
  const [, month, day] = date.split('-')
  return `${Number(month)}월 ${Number(day)}일`
}

const publicationLabels = {
  SCHEDULED: '예약됨',
  PUBLISHING: '게시 중',
  PUBLISHED: '게시 완료',
  FAILED: '예약 실패',
  VERIFY_REQUIRED: '게시 확인 필요',
}
const instagramSchedule = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
})

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

function PromoDraft({ plan, auth, instagramStatus, onInstagramStatus, manualStatus, onManualStatus, resultsTo }: {
  plan: Plan
  auth?: string
  instagramStatus?: InstagramPublicationStatus
  onInstagramStatus?: (status: InstagramPublicationStatus) => void
  manualStatus?: ManualPromotionPublicationStatus | null
  resultsTo?: string
  onManualStatus?: (status: ManualPromotionPublicationStatus) => void
}) {
  const saved = plan.promotionDraft
  const { headline, feature, detail, caption: draftCaption } = saved ?? getDraft(plan)
  const publication = instagramStatus?.publication
  const caption = publication?.caption ?? draftCaption
  const postedImage = publication?.imageDataUrl
  const store = saved?.storeName ?? plan.store
  const canvas = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState('')
  const [rendered, setRendered] = useState<{ photo: string | null; draft: typeof saved; preview?: string }>()
  const [failedPhoto, setFailedPhoto] = useState<string>()
  const photoUrl = saved?.photoDataUrl ?? null
  const ready = rendered?.photo === photoUrl && rendered.draft === saved

  useEffect(() => {
    const card = canvas.current
    const context = card?.getContext('2d')
    if (!card || !context) return
    function savePreview(photo: string | null) {
      setRendered({ photo, draft: saved, preview: saved ? card?.toDataURL('image/jpeg', 0.88) : undefined })
    }
    function markPhotoFailed() {
      if (photoUrl) setFailedPhoto(photoUrl)
      setStatus('저장된 사진을 표시하지 못했어요.')
    }
    if (saved && saved.templateVersion >= 2) {
      drawPromotionCard(context, saved)
      if (!photoUrl) {
        savePreview(null)
        return
      }
      const photo = new Image()
      photo.onload = () => {
        drawPromotionCard(context, saved, photo)
        savePreview(photoUrl)
      }
      photo.onerror = markPhotoFailed
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
      savePreview(null)
      return
    }
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(680 / image.width, 245 / image.height)
      const width = image.width * scale
      const height = image.height * scale
      context.drawImage(image, (1080 - width) / 2, 695 + (245 - height) / 2, width, height)
      savePreview(photoUrl)
    }
    image.onerror = markPhotoFailed
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

  const generatedImage = ready ? rendered.preview : undefined
  const instagramImage = postedImage ?? generatedImage
  const previewCanvas = <canvas hidden={Boolean(saved)} ref={canvas} width="1080" height="1080" role="img"
    aria-label={`${store} 홍보 이미지 · ${headline}${saved?.discountedPrice ? ` · ${saved.discountedPrice}` : ""} · ${feature} · ${detail}`} />

  if (saved) return <section className="execution-material">
    {previewCanvas}
    <PromotionChannelPreviews plan={plan} draft={saved} instagramCaption={caption}
      generatedImage={generatedImage} imageFailed={!ready && failedPhoto === photoUrl}
      instagramImage={instagramImage} instagramUsername={publication?.username ?? instagramStatus?.username}
      instagramPublishing={plan.id && auth && onInstagramStatus && <InstagramPublish key={plan.id} auth={auth}
        planId={plan.id} caption={caption} hasPhoto={Boolean(photoUrl)} endDate={plan.endDate} image={instagramImage}
        state={instagramStatus} onStatus={onInstagramStatus} />}
      manualPublishing={id => {
        if (!auth || !plan.id || !onManualStatus) return null
        const channel = { instagram: 'INSTAGRAM', naver: 'NAVER', daangn: 'DAANGN' } as const
        const selected = channel[id]
        return <ManualPromotionPublication
          key={`${plan.id}:${selected}:${manualStatus?.publications?.[selected]?.publishedDate ?? ''}:${manualStatus?.productName ?? ''}`}
          auth={auth} planId={plan.id} channel={selected}
          endDate={plan.endDate} resultsTo={resultsTo} defaultProduct={plan.marketing ? saved.headline : undefined}
          status={manualStatus} onStatus={onManualStatus} />
      }} />
  </section>

  return <section className="execution-material">
    <div className="ruled"><h3>{plan.channel} 홍보 초안</h3></div>
    <div className="receipt promo-draft">
      {previewCanvas}
      <div className="promo-copy">
        <p>{caption}</p>
        <div className="promo-actions">
          <button type="button" className="button secondary small" disabled={!ready} onClick={saveImage}>이미지 저장</button>
          <button type="button" className="button secondary small" onClick={copyCaption}>문구 복사</button>
        </div>
        {plan.channel === '인스타그램' && <a href="https://www.instagram.com/" target="_blank" rel="noopener noreferrer">인스타그램 열기 ↗</a>}
        <small className="muted">게시 전 날짜와 안내 내용을 확인해 주세요.</small>
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
  const [manualStatus, setManualStatus] = useState<ManualPromotionPublicationStatus | null>()
  const [editingPromotion, setEditingPromotion] = useState(false)
  const [promotionOpen, setPromotionOpen] = useState(false)
  const [reviewFirst, setReviewFirst] = useState(false)
  const promotionDialog = useRef<HTMLDialogElement>(null)
  const promotionDialogHeading = useRef<HTMLHeadingElement>(null)
  const hasPromotionMaterials = plan.strategy === 'promotion' || plan.marketing === true
  const trackInstagram = hasPromotionMaterials && Boolean(auth && plan.id)
  const publication = instagramStatus?.publication
  const locked = Boolean(publication)
  const loadingInstagram = trackInstagram && !instagramStatus
  const draft = plan.promotionDraft
  const promotionEditorReady = !locked && !loadingInstagram && (plan.marketing || plan.promotionReview)
  const showPromotionEditor = promotionOpen && promotionEditorReady && (reviewFirst || editingPromotion)
  const hasManualPublication = Object.keys(manualStatus?.publications ?? {}).length > 0
  const promotionStatus = publication ? publicationLabels[publication.state]
    : hasManualPublication ? '직접 게시일 기록됨'
      : draft ? '초안 저장됨' : '작성 전'
  const promotionSchedule = publication?.state === 'SCHEDULED' && publication.scheduledAt
    ? instagramSchedule.format(new Date(publication.scheduledAt))
    : !publication && !hasManualPublication && draft ? `${shortDate(draft.publishDate)} ${draft.publishTime.slice(0, 5)} 게시 희망` : undefined

  useEffect(() => {
    if (promotionOpen && promotionDialog.current?.open) {
      promotionDialog.current.querySelector('.promotion-dialog-body')?.scrollTo({ top: 0 })
      promotionDialogHeading.current?.focus()
    }
  }, [promotionOpen, showPromotionEditor])

  useEffect(() => {
    if (!trackInstagram || !auth || !plan.id) return
    const controller = new AbortController()
    fetchInstagramPublication(auth, plan.id, controller.signal).then(setInstagramStatus).catch(() => {
      if (!controller.signal.aborted) setInstagramStatus({ available: false, username: '' })
    })
    return () => controller.abort()
  }, [trackInstagram, auth, plan.id])

  useEffect(() => {
    if (!trackInstagram || !auth || !plan.id || !draft) return
    const controller = new AbortController()
    fetchManualPromotionPublication(auth, plan.id, controller.signal).then(status => {
      if (!controller.signal.aborted) setManualStatus(status)
    }).catch(() => {
      if (!controller.signal.aborted) setManualStatus(null)
    })
    return () => controller.abort()
  }, [trackInstagram, auth, plan.id, draft])

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
  const noticeFollowUp = plan.strategy === 'outreach' && plan.tasks.some(task => task.date < plan.startDate)

  return <div className="execution-page">
    <PageTitle title="실행 계획 · 진행 관리" detail={`${plan.store}${plan.demo ? ' · 시연 예시' : ''}`} />
    <section className="receipt execution-summary" aria-labelledby="execution-current-title">
      <div className="execution-summary-mark"><Citrus /></div>
      <div className="execution-current-plan">
        <div className="execution-summary-top">
          <span>현재 보는 실행 계획</span>
          <span className="badge">{next === -1 ? '완료' : '진행 중'}</span>
        </div>
        <h2 id="execution-current-title">{plan.title}</h2>
        <p className="execution-period">
          <span>{noticeFollowUp ? '안내 수정 후 확인 기간' : '실행 기간'}</span>
          <strong>{dateRange}</strong><span>{plan.duration}</span>
          {plan.strategy === 'outreach' && plan.budget > 0 && <span>예산 한도 {won(plan.budget)}</span>}
        </p>
      </div>
    </section>
    {auth && analysis.storeId && plan.analysisId && plan.id &&
      <ExecutionPlanSwitcher auth={auth} storeId={analysis.storeId} analysisId={plan.analysisId} planId={plan.id} />}
    {(plan.recommendation || plan.customerNotice || plan.executionGuide) &&
      <details className="execution-reference receipt">
        <summary>{[
          plan.recommendation && '추천 이유',
          plan.customerNotice && '손님 안내 제안',
          plan.executionGuide && '저장된 실행 가이드',
        ].filter(Boolean).join(' · ')}</summary>
        <div className="execution-reference-body">
          {plan.recommendation && <section className="execution-plan-card" aria-labelledby="execution-recommendation">
            <h2 id="execution-recommendation">AI가 이 계획을 추천한 이유</h2>
            <p className="execution-recommendation-reason">{plan.recommendation.reason}</p>
            {(plan.recommendation.evidence.length > 0 || plan.recommendation.contextEvidence.length > 0) &&
              <details className="source-details execution-recommendation-evidence">
                <summary>추천 근거 보기</summary>
                {plan.recommendation.evidence.length > 0 && <ul>
                  {plan.recommendation.evidence.map(item => <li key={item}>{item}</li>)}
                </ul>}
                {plan.recommendation.contextEvidence.length > 0 && <>
                  <h3>경기 참고</h3>
                  <ul>{plan.recommendation.contextEvidence.map(item => <li key={item}>{item}</li>)}</ul>
                </>}
              </details>}
          </section>}
          {plan.customerNotice && <section className="execution-plan-card execution-customer-notice" aria-labelledby="execution-customer-notice">
            <h2 id="execution-customer-notice">손님 안내 제안</h2>
            <CustomerNoticeDetails notice={plan.customerNotice} />
            <p className="execution-notice-concern"><strong>손님이 겪은 불편</strong> {plan.customerNotice.concern}</p>
          </section>}
          {plan.executionGuide && <section className="execution-plan-card execution-guide" aria-label="저장된 실행 가이드">
            <h2>저장된 실행 가이드</h2>
            <p>{plan.executionGuide.channel === 'NAVER' ? '네이버 안내' : '매장 안내'}</p>
            <ExecutionGuideSteps guide={plan.executionGuide} />
          </section>}
        </div>
      </details>}
    <div className="execution-layout">
      <section className="execution-checklist-card" aria-labelledby="execution-checklist-title">
        <div className="execution-checklist-header">
          <h2 id="execution-checklist-title">실행 일정과 점검표</h2>
          <span className="badge" aria-live="polite">{plan.done.length} / {plan.tasks.length} 완료</span>
        </div>
        <div className="execution-checklist-body">
          {plan.reviewEvidence && <details className="ruled-block">
            <summary>이 계획의 리뷰 근거 {plan.reviewEvidence.length}건 보기</summary>
            <ul className="review-evidence">{plan.reviewEvidence.map((review) => <li key={review.id}>
              <time dateTime={review.date}>{review.date}</time><span>{review.text}</span>
            </li>)}</ul>
          </details>}
          <ul className="execution-checklist">{plan.tasks.map(({ id, label, date }, index) => <li key={id ?? index}>
            <label>
              <input type="checkbox" checked={plan.done.includes(index)} disabled={savingIndex !== undefined}
                onChange={(event) => void toggleChecklist(index, event.target.checked)} />
              <span className="execution-task">
                <strong>{label}</strong>
                <span className="execution-task-meta">
                  <time dateTime={date}>{shortDate(date)}</time>
                  {next === index && <span className="badge">다음 할 일</span>}
                </span>
              </span>
            </label>
          </li>)}</ul>
          {savingIndex !== undefined && <p className="muted" role="status">점검 상태를 저장하는 중이에요.</p>}
          {checklistError && <p className="error" role="alert">{checklistError}</p>}
          {plan.strategy === 'promotion' && !plan.timeLabel && <p className="muted execution-note">행사 소식을 올리기 전에 혜택을 적용할 시간대를 정해 주세요.</p>}
        </div>
      </section>
      <div className="form-stack execution-aside">
        {hasPromotionMaterials && auth && onSavePromotionDraft && <section className="receipt promotion-summary">
          <div>
            <h2>홍보</h2>
            <p className="muted">{loadingInstagram ? '인스타 게시 상태 확인 중…' : [draft?.headline, promotionStatus, promotionSchedule].filter(Boolean).join(' · ')}</p>
            {promotionEditorReady && !draft && <p className="muted">인스타그램·네이버 플레이스·당근 초안을 함께 만들어요.</p>}
            {!loadingInstagram && !draft && !promotionEditorReady &&
              <p className="muted">할인 조건을 저장하면 홍보 초안을 만들 수 있어요.</p>}
          </div>
          <div className="promo-actions">
            {draft && <button type="button" className="button secondary small" aria-haspopup="dialog"
              disabled={loadingInstagram}
              onClick={() => { setReviewFirst(false); setEditingPromotion(false); setPromotionOpen(true); promotionDialog.current?.showModal() }}>
              홍보물 보기
            </button>}
            {promotionEditorReady && <button type="button" className="button primary small" aria-haspopup="dialog"
              onClick={() => { setReviewFirst(true); setEditingPromotion(false); setPromotionOpen(true); promotionDialog.current?.showModal() }}>
              홍보물 만들기
            </button>}
          </div>
          <dialog ref={promotionDialog} className={`promotion-dialog${draft ? ' promotion-dialog-wide' : ''}`}
            onClose={() => setPromotionOpen(false)} aria-labelledby="promotion-dialog-title">
            <header className="promotion-dialog-header">
              <h2 id="promotion-dialog-title" ref={promotionDialogHeading} tabIndex={-1}>
                {reviewFirst ? '홍보물 만들기' : showPromotionEditor ? '홍보 초안 수정' : '채널별 홍보 미리보기'}
              </h2>
              <div className="promo-actions">
                {promotionEditorReady && draft && !reviewFirst && <button type="button" className="button secondary small"
                  onClick={() => setEditingPromotion(!editingPromotion)}>{editingPromotion ? '저장한 홍보물 보기' : '초안 수정하기'}</button>}
                <button type="button" className="button secondary small" autoFocus onClick={() => promotionDialog.current?.close()}>닫기</button>
              </div>
            </header>
            <div className="promotion-dialog-body">
              {showPromotionEditor && <PromotionDraftForm key={`${plan.id}:${plan.promotionReview?.productName ?? ''}`} plan={plan} auth={auth}
                  productNames={analysis.productSales?.map(product => product.productName)}
                  reviewFirst={reviewFirst}
                  onSave={async input => { await onSavePromotionDraft(input); setEditingPromotion(false); setReviewFirst(false) }}
                  onRegenerate={onRegeneratePromotionCaption} />}
              {draft && <div hidden={Boolean(showPromotionEditor)}>
                <PromoDraft plan={plan} auth={auth} instagramStatus={instagramStatus} onInstagramStatus={status => {
                    setInstagramStatus(status)
                    if (status.publication?.state === 'PUBLISHED') notifyResultsDataChanged()
                  }}
                  manualStatus={manualStatus} onManualStatus={setManualStatus} resultsTo={resultsTo} />
              </div>}
            </div>
          </dialog>
        </section>}
        {plan.strategy === 'promotion' && <PromotionReview analysis={analysis}
          saved={plan.promotionReview} initialBudget={plan.budget} auth={auth} planId={plan.id}
          readOnly={locked || loadingInstagram || hasManualPublication} onSave={onSavePromotion}
          postedManually={hasManualPublication} />}
        {inventory ? <InventoryReview
          key={plan.id ?? 'demo'}
          auth={auth}
          planId={plan.id}
          items={plan.inventoryItems ?? []}
          analysis={analysis}
          onSave={onSaveInventory}
          reviewDate={shortDate(plan.tasks[2]?.date ?? plan.endDate)}
          onChange={(inventoryItems) => onChange({ ...plan, inventoryItems })}
        /> : plan.strategy === 'outreach' ? <StoreNotice
          key={`${plan.id ?? 'demo'}:${plan.customerNotice?.text ?? ''}`}
          store={plan.store}
          suggestion={plan.customerNotice}
          auth={auth}
          planId={plan.id}
        /> : plan.strategy === 'promotion' && !plan.id && !needsPromotionInputs && <PromoDraft plan={plan} />}
        <section className="receipt execution-outcome form-stack">
          <h2>실행 후 확인할 지표</h2>
          <p className="execution-metric">{plan.followUp}</p>
          <Link className="button secondary full execution-results" to={resultsTo}>실행 결과 확인 <span aria-hidden="true">→</span></Link>
        </section>
      </div>
    </div>
  </div>
}
