import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { fetchPromotionPhoto } from '../api/shop'
import { PromotionReviewPoints, usePromotionReviews } from '../components/PromotionReviewPoints'
import type { PromotionReviewSearch } from '../components/PromotionReviewPoints'
import { prepareMenuPhoto } from '../data/menuPhoto'
import { editablePromotionCaption, promotionCaptionLimit, promotionCaptions, promotionChannels, promotionOffer } from '../data/promotionChannels'
import { formatNumber, promotionTones, won } from '../data/shop'
import type { Plan, PromotionChannelCopy, PromotionDraftInput, PromotionTone } from '../data/shop'

export function PromotionDraftForm({ plan, auth, productNames, reviewFirst, onSave, onRegenerate }: {
  plan: Plan
  auth: string
  productNames?: string[]
  reviewFirst: boolean
  onSave: (input: PromotionDraftInput) => Promise<void>
  onRegenerate: (tone: PromotionTone) => Promise<void>
}) {
  const review = plan.promotionReview
  const marketing = plan.marketing === true
  const draft = plan.promotionDraft
  const [subject, setSubject] = useState(marketing && !reviewFirst ? draft?.headline ?? '' : '')
  const menus = [...new Set(productNames)]
  const [customSubject, setCustomSubject] = useState(false)
  const trimmedSubject = subject.trim()
  const currentDraft = !marketing || draft?.headline === trimmedSubject ? draft : undefined
  const productName = marketing ? trimmedSubject : review?.productName
  const [search, setSearch] = useState<PromotionReviewSearch>()
  const activeSearch = reviewFirst && search?.subject === productName ? search : undefined
  const reviews = usePromotionReviews(auth, plan.id, activeSearch)
  const photoProduct = reviewFirst ? activeSearch?.subject : productName
  const [selection, setSelection] = useState<{ id: string; points: string[] }>()
  const selectedPoints = selection?.id === reviews.result?.id ? selection?.points ?? [] : []
  const canSkipReviews = reviewFirst && (Boolean(reviews.error) || reviews.result?.points.length === 0)
  const canPrepareDraft = !reviewFirst || Boolean(reviews.result || reviews.error)
  const [publishDate, setPublishDate] = useState(draft?.publishDate ?? plan.startDate)
  const [publishTime, setPublishTime] = useState(draft?.publishTime.slice(0, 5) ?? '11:00')
  const [photoOptions, setPhotoOptions] = useState<{ product: string; dataUrl: string | null }>()
  const savedPhoto = photoOptions?.product === productName ? photoOptions?.dataUrl : undefined
  const [photo, setPhoto] = useState<string>()
  const [channelEdits, setChannelEdits] = useState<Partial<PromotionChannelCopy>>({})
  const [sourcePageUrl, setSourcePageUrl] = useState('')
  const [defaultTone, setDefaultTone] = useState<PromotionTone | null>(null)
  const [toneChoice, setToneChoice] = useState<PromotionTone>()
  const [toneMessage, setToneMessage] = useState('')
  const tone = toneChoice ?? currentDraft?.tone ?? defaultTone ?? 'PLAIN'
  const [useSavedPhoto, setUseSavedPhoto] = useState(draft ? Boolean(draft.photoDataUrl) : true)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!plan.id || !photoProduct) return
    const controller = new AbortController()
    const id = plan.id
    const timer = window.setTimeout(() => fetchPromotionPhoto(auth, id, controller.signal, marketing ? photoProduct : undefined)
      .then(({ photoDataUrl, defaultTone }) => {
      if (controller.signal.aborted) return
      setPhotoOptions({ product: photoProduct, dataUrl: photoDataUrl })
      setDefaultTone(defaultTone)
    }).catch(() => {
      if (!controller.signal.aborted) setError('저장된 메뉴 사진을 불러오지 못했어요.')
    }), marketing ? 250 : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [auth, marketing, plan.id, photoProduct])

  if (!marketing && !review) return <p className="muted">할인 조건을 저장하면 인스타 홍보 초안을 만들 수 있어요.</p>
  const availablePhoto = savedPhoto ?? currentDraft?.photoDataUrl
  const preview = photo ?? (useSavedPhoto ? availablePhoto : null)
  const cannotSave = marketing ? !trimmedSubject : review?.maxDiscountQuantity === 0
  const captions = currentDraft && promotionCaptions(plan, currentDraft)
  const offer = currentDraft && promotionOffer(plan, currentDraft)
  const captionLimit = promotionCaptionLimit(offer)
  const hasEdits = Object.values(channelEdits).some(value => value !== undefined)
  const oldCopy = currentDraft && currentDraft.copySource !== 'EDITED'
    && (currentDraft.channels?.basis === 'BASIC' || (!currentDraft.channels?.basis && !currentDraft.channels?.researched)
      || (currentDraft.channels?.basis && (currentDraft.channels.sourceCheckVersion ?? 0) < 2))
  const canSuggestSource = !currentDraft || (currentDraft.copySource !== 'EDITED' && !currentDraft.channels?.researched)

  function changeSubject(value: string, searchNow = false) {
    setSubject(value)
    setSearch(searchNow ? { subject: value.trim() } : undefined)
    setChannelEdits({})
    setSelection(undefined)
    setPhoto(undefined)
    setUseSavedPhoto(true)
    setToneChoice(undefined)
    setToneMessage('')
    setError('')
  }

  function findReviews() {
    if (!productName) return
    setSelection(undefined)
    setSearch({ subject: productName })
  }

  async function upload(file: File) {
    setBusy(true)
    setError('')
    try {
      setPhoto(await prepareMenuPhoto(file))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '사진을 읽을 수 없어요.')
    } finally {
      setBusy(false)
    }
  }

  async function regenerate() {
    if (!currentDraft || busy) return
    setBusy(true)
    setError('')
    setToneMessage('')
    try {
      await onRegenerate(tone)
      setChannelEdits(({ naver, daangn }) => ({ naver, daangn }))
      setToneChoice(undefined)
      setToneMessage('인스타그램 문구의 말투를 바꿨어요.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '문구를 다시 만들지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || cannotSave || (reviewFirst && !selectedPoints.length && !canSkipReviews)) return
    setBusy(true)
    setSaving(true)
    setError('')
    try {
      await onSave({ review, subject: marketing ? trimmedSubject : undefined, publishDate, publishTime,
        photoDataUrl: photo, useSavedPhoto, channelEdits: currentDraft ? channelEdits : undefined,
        sourcePageUrl: canSuggestSource && !hasEdits ? sourcePageUrl.trim() || undefined : undefined,
        generateNewCopy: reviewFirst || undefined, reviewResearchId: selectedPoints.length ? reviews.result?.id : undefined,
        reviewPointIds: selectedPoints.length ? selectedPoints : undefined })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '홍보 초안을 저장하지 못했어요.')
    } finally {
      setBusy(false)
      setSaving(false)
    }
  }

  return <div className="execution-material">
    <form className="form-stack" onSubmit={submit}>
      {!reviewFirst && !currentDraft && <p className="muted">매장 공개 정보를 찾아 인스타그램·네이버 플레이스·당근 초안을 함께 만들어요.</p>}
      {!reviewFirst && oldCopy && !hasEdits && <p className="muted">기본 문구에 직접 손대지 않고 저장하면 AI가 매장 정보와 등록한 사진을 참고해 세 채널 문구를 채워요.</p>}
      <fieldset disabled={busy} className="form-stack">
        {marketing && reviewFirst && <>
          {menus.length > 0 && <label>소개할 메뉴
            <select required value={customSubject ? 'custom' : menus.includes(subject) ? `menu:${subject}` : ''}
              onChange={event => {
                const value = event.target.value
                setCustomSubject(value === 'custom')
                const menu = value.startsWith('menu:') ? value.slice(5) : ''
                changeSubject(menu, Boolean(menu))
              }}>
              <option value="" disabled>메뉴를 선택해 주세요</option>
              {menus.map(name => <option key={name} value={`menu:${name}`}>{name}</option>)}
              <option value="custom">메뉴나 가게 소식 직접 입력</option>
            </select>
          </label>}
          {(menus.length === 0 || customSubject) && <>
            <label>소개할 메뉴나 가게 소식
              <input type="text" required maxLength={80} value={subject} placeholder="예시. 제철 감귤 에이드"
                onChange={event => changeSubject(event.target.value)} />
            </label>
            {!activeSearch && <button type="button" className="button secondary small" disabled={!productName}
              onClick={findReviews}>공개 후기 찾기</button>}
          </>}
          {!productName && <p className="muted">소개할 메뉴를 고르면 그 메뉴의 공개 후기를 찾아요.</p>}
        </>}
        {review && <p>{review.productName} · {won(review.discountWon)} 할인 · {won(review.discountedPriceWon)} · {formatNumber(review.maxDiscountQuantity)}개 한정</p>}
        {reviewFirst && !marketing && !activeSearch && <button type="button" className="button secondary small"
          onClick={findReviews}>이 메뉴 후기 찾기</button>}
        {reviewFirst && <PromotionReviewPoints reviews={reviews} selected={selectedPoints}
          onToggle={point => {
            if (!reviews.result) return
            setSelection({ id: reviews.result.id, points: selectedPoints.includes(point)
              ? selectedPoints.filter(id => id !== point) : [...selectedPoints, point] })
          }} />}
        {canPrepareDraft && <>
          <p className="muted">{marketing ? '실행 기간' : '행사 기간'} {plan.startDate} ~ {plan.endDate} · 게시 일정은 한국 시간으로 저장해요.</p>
          <div className="promotion-datetime">
            <label>게시 날짜<input type="date" required max={plan.endDate} value={publishDate} onChange={event => setPublishDate(event.target.value)} /></label>
            <label>게시 시간<input type="time" required value={publishTime} onChange={event => setPublishTime(event.target.value)} /></label>
          </div>
          <small className="muted">게시일의 제주 계절과 확인된 예보를 세 채널 문구에 반영해요.</small>
          {!reviewFirst && canSuggestSource && !hasEdits && <details>
            <summary>참고할 매장 페이지 추가</summary>
            <label>공개 매장 페이지 링크 (선택)
              <input type="url" maxLength={1000} value={sourcePageUrl}
                onChange={event => setSourcePageUrl(event.target.value)} placeholder="https://" />
            </label>
            <small className="muted">상호와 도로명 주소가 표시된 비짓제주나 네이버 플레이스 소개 링크를 넣을 수 있어요.</small>
          </details>}
          {!reviewFirst && currentDraft && <div className="form-stack">
            <label>인스타그램 게시물 말투<select value={tone} onChange={event => {
              setToneChoice(event.target.value as PromotionTone)
              setToneMessage('')
            }}>
              {promotionTones.map(({value, label}) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <button type="button" className="button secondary small" onClick={() => void regenerate()}>이 말투로 문구 다시 만들기</button>
            {toneMessage && <p role="status">{toneMessage}</p>}
          </div>}
          {!reviewFirst && captions && <>
            <small className="muted">날씨 안내{offer ? '와 행사 조건' : ''}가 들어갈 자리를 남겨서 채널마다 {formatNumber(captionLimit)}자까지 편집할 수 있어요.</small>
            <div className="promotion-edit-captions">
              {promotionChannels.map(({ id, label }) => <label key={id}>{label} 문구
                <textarea rows={7} required maxLength={captionLimit}
                  value={channelEdits[id] ?? editablePromotionCaption(captions[id], offer, currentDraft?.weatherContext?.leads[id])}
                  onChange={event => setChannelEdits({ ...channelEdits, [id]: event.target.value })} />
              </label>)}
            </div>
          </>}
          {offer && <p className="muted">행사 조건은 세 채널 문구에 자동으로 붙어요.</p>}
          <label>{marketing ? '홍보에 사용할 사진 올리기' : '음식 사진 올리기'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
            const file = event.target.files?.[0]
            if (file) void upload(file)
            event.target.value = ''
          }} /></label>
          {photo ? <button className="text-button" type="button" onClick={() => setPhoto(undefined)}>새 사진 선택 취소</button>
            : availablePhoto && <label><input type="checkbox" checked={useSavedPhoto} onChange={event => setUseSavedPhoto(event.target.checked)} /> {marketing ? '저장된 사진 사용' : '저장된 메뉴 사진 사용'}</label>}
        </>}
      </fieldset>
      {canPrepareDraft && preview && <img src={preview} alt={productName + ' 사진 미리보기'} width={160} />}
      {review?.maxDiscountQuantity === 0 && <p className="muted">할인 예산으로 최소 한 개를 할인할 수 있어야 해요.</p>}
      {canSkipReviews && <p className="muted">AI에 연결하기 어려우면 매장 이름과 메뉴를 넣은 기본 초안을 저장해요.</p>}
      {canPrepareDraft && <button className="button primary small" disabled={busy || cannotSave || (reviewFirst && !selectedPoints.length && !canSkipReviews)}>
        {busy ? '준비 중…' : reviewFirst
          ? canSkipReviews ? '후기 없이 세 채널 초안 만들기' : '선택한 포인트로 세 채널 초안 만들기'
          : '홍보 초안 변경 저장'}
      </button>}
      {saving && <p role="status">{reviewFirst ? '선택한 내용과 매장 정보를 바탕으로 세 채널 문구를 쓰고 있어요…'
        : '홍보 초안을 저장하고 있어요…'}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  </div>
}
