import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { fetchPromotionPhoto } from '../api/shop'
import { prepareMenuPhoto } from '../data/menuPhoto'
import { formatNumber, promotionTones, won } from '../data/shop'
import type { Plan, PromotionDraftInput, PromotionTone } from '../data/shop'

export function PromotionDraftForm({ plan, auth, onSave, onRegenerate }: {
  plan: Plan
  auth: string
  onSave: (input: PromotionDraftInput) => Promise<void>
  onRegenerate: (tone: PromotionTone) => Promise<void>
}) {
  const review = plan.promotionReview
  const draft = plan.promotionDraft
  const [publishDate, setPublishDate] = useState(draft?.publishDate ?? plan.startDate)
  const [publishTime, setPublishTime] = useState(draft?.publishTime.slice(0, 5) ?? '11:00')
  const [savedPhoto, setSavedPhoto] = useState<string | null>()
  const [photo, setPhoto] = useState<string>()
  const [captionEdit, setCaptionEdit] = useState<string>()
  const [defaultTone, setDefaultTone] = useState<PromotionTone | null>(null)
  const [toneChoice, setToneChoice] = useState<PromotionTone>()
  const [toneMessage, setToneMessage] = useState('')
  const tone = toneChoice ?? draft?.tone ?? defaultTone ?? 'PLAIN'
  const [useSavedPhoto, setUseSavedPhoto] = useState(draft ? Boolean(draft.photoDataUrl) : true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!plan.id || !review) return
    const controller = new AbortController()
    fetchPromotionPhoto(auth, plan.id, controller.signal).then(({ photoDataUrl, defaultTone }) => {
      if (controller.signal.aborted) return
      setSavedPhoto(photoDataUrl)
      setDefaultTone(defaultTone)
    }).catch(() => {
      if (!controller.signal.aborted) setError('저장된 메뉴 사진을 불러오지 못했어요.')
    })
    return () => controller.abort()
  }, [auth, plan.id, review?.productName])

  if (!review) return <p className="muted">할인 조건을 저장하면 인스타 홍보 초안을 만들 수 있어요.</p>
  const preview = photo ?? (useSavedPhoto ? savedPhoto : null)

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
    if (!draft || busy) return
    setBusy(true)
    setError('')
    setToneMessage('')
    try {
      await onRegenerate(tone)
      setCaptionEdit(undefined)
      setToneChoice(undefined)
      setToneMessage('이번 게시물의 문구를 다시 만들었어요.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '문구를 다시 만들지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!review || busy || review.maxDiscountQuantity === 0) return
    setBusy(true)
    setError('')
    try {
      await onSave({ review, publishDate, publishTime, photoDataUrl: photo, useSavedPhoto, caption: captionEdit })
      setCaptionEdit(undefined)
      if (photo) {
        setSavedPhoto(photo)
        setPhoto(undefined)
        setUseSavedPhoto(true)
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '홍보 초안을 저장하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return <section className="execution-material">
    <div className="ruled"><h2>인스타 게시 일정과 홍보 초안</h2></div>
    <form className="receipt form-stack" onSubmit={submit}>
      <p>{review.productName} · {won(review.discountWon)} 할인 · {won(review.discountedPriceWon)} · {formatNumber(review.maxDiscountQuantity)}개 한정</p>
      <p className="muted">행사 기간 {plan.startDate} ~ {plan.endDate} · 게시 일정은 한국 시간으로 저장해요.</p>
      <fieldset disabled={busy} className="form-stack">
        <label>게시 날짜<input type="date" required max={plan.endDate} value={publishDate} onChange={event => setPublishDate(event.target.value)} /></label>
        <label>게시 시간<input type="time" required value={publishTime} onChange={event => setPublishTime(event.target.value)} /></label>
        {draft && <div className="form-stack">
          <label>이번 게시물 말투<select value={tone} onChange={event => {
            setToneChoice(event.target.value as PromotionTone)
            setToneMessage('')
          }}>
            {promotionTones.map(({value, label}) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <button type="button" className="button secondary small" onClick={() => void regenerate()}>이 말투로 문구 다시 만들기</button>
          <small className="muted">이번 문구만 바뀌어요. 가격·수량·행사 기간은 그대로예요.</small>
          {toneMessage && <p role="status">{toneMessage}</p>}
        </div>}
        {draft && <label>홍보 문구<textarea rows={5} required maxLength={2200} value={captionEdit ?? draft.caption}
          onChange={event => setCaptionEdit(event.target.value)} /></label>}
        <label>음식 사진 올리기<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
          event.target.value = ''
        }} /></label>
        {photo ? <button className="text-button" type="button" onClick={() => setPhoto(undefined)}>새 사진 선택 취소</button>
          : savedPhoto && <label><input type="checkbox" checked={useSavedPhoto} onChange={event => setUseSavedPhoto(event.target.checked)} /> 저장된 메뉴 사진 사용</label>}
      </fieldset>
      {preview && <img src={preview} alt={review.productName + ' 사진 미리보기'} width={160} />}
      {review.maxDiscountQuantity === 0 && <p className="muted">할인 예산으로 최소 한 개를 할인할 수 있어야 해요.</p>}
      <button className="button primary small" disabled={busy || review.maxDiscountQuantity === 0}>
        {busy ? '준비 중…' : draft ? '홍보 초안 변경 저장' : '할인 조건 확정하고 홍보 초안 저장'}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  </section>
}
