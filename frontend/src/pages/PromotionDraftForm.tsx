import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { fetchPromotionPhoto } from '../api/shop'
import { prepareMenuPhoto } from '../data/menuPhoto'
import { formatNumber, promotionTones, won } from '../data/shop'
import type { Plan, PromotionDraftInput, PromotionTone } from '../data/shop'

export function PromotionDraftForm({ plan, auth, productNames, onSubjectChange, onSave, onRegenerate }: {
  plan: Plan
  auth: string
  productNames?: string[]
  onSubjectChange: (subject: string) => void
  onSave: (input: PromotionDraftInput) => Promise<void>
  onRegenerate: (tone: PromotionTone) => Promise<void>
}) {
  const review = plan.promotionReview
  const marketing = plan.marketing === true
  const draft = plan.promotionDraft
  const [subject, setSubject] = useState(marketing ? draft?.headline ?? '' : '')
  const menus = [...new Set(productNames)]
  const [customSubject, setCustomSubject] = useState(() => Boolean(subject && !menus.includes(subject)))
  const trimmedSubject = subject.trim()
  const currentDraft = !marketing || draft?.headline === trimmedSubject ? draft : undefined
  const productName = marketing ? trimmedSubject : review?.productName
  const [publishDate, setPublishDate] = useState(draft?.publishDate ?? plan.startDate)
  const [publishTime, setPublishTime] = useState(draft?.publishTime.slice(0, 5) ?? '11:00')
  const [photoOptions, setPhotoOptions] = useState<{ product: string; dataUrl: string | null }>()
  const savedPhoto = photoOptions?.product === productName ? photoOptions?.dataUrl : undefined
  const [photo, setPhoto] = useState<string>()
  const [captionEdit, setCaptionEdit] = useState<string>()
  const [defaultTone, setDefaultTone] = useState<PromotionTone | null>(null)
  const [toneChoice, setToneChoice] = useState<PromotionTone>()
  const [toneMessage, setToneMessage] = useState('')
  const tone = toneChoice ?? currentDraft?.tone ?? defaultTone ?? 'PLAIN'
  const [useSavedPhoto, setUseSavedPhoto] = useState(draft ? Boolean(draft.photoDataUrl) : true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!plan.id || !productName) return
    const controller = new AbortController()
    const id = plan.id
    const timer = window.setTimeout(() => fetchPromotionPhoto(auth, id, controller.signal, marketing ? productName : undefined)
      .then(({ photoDataUrl, defaultTone }) => {
      if (controller.signal.aborted) return
      setPhotoOptions({ product: productName, dataUrl: photoDataUrl })
      setDefaultTone(defaultTone)
    }).catch(() => {
      if (!controller.signal.aborted) setError('저장된 메뉴 사진을 불러오지 못했어요.')
    }), marketing ? 250 : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [auth, marketing, plan.id, productName])

  if (!marketing && !review) return <p className="muted">할인 조건을 저장하면 인스타 홍보 초안을 만들 수 있어요.</p>
  const availablePhoto = savedPhoto ?? currentDraft?.photoDataUrl
  const preview = photo ?? (useSavedPhoto ? availablePhoto : null)
  const cannotSave = marketing ? !trimmedSubject : review?.maxDiscountQuantity === 0

  function changeSubject(value: string) {
    setSubject(value)
    onSubjectChange(value.trim())
    setCaptionEdit(undefined)
    setPhoto(undefined)
    setUseSavedPhoto(true)
    setToneChoice(undefined)
    setToneMessage('')
    setError('')
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
    if (busy || cannotSave) return
    setBusy(true)
    setError('')
    try {
      await onSave({ review, subject: marketing ? trimmedSubject : undefined, publishDate, publishTime,
        photoDataUrl: photo, useSavedPhoto, caption: captionEdit })
      setCaptionEdit(undefined)
      if (photo && productName) {
        setPhotoOptions({ product: productName, dataUrl: photo })
        setPhoto(undefined)
        setUseSavedPhoto(true)
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '홍보 초안을 저장하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="execution-material">
    <form className="form-stack" onSubmit={submit}>
      {review && <p>{review.productName} · {won(review.discountWon)} 할인 · {won(review.discountedPriceWon)} · {formatNumber(review.maxDiscountQuantity)}개 한정</p>}
      <p className="muted">{marketing ? '실행 기간' : '행사 기간'} {plan.startDate} ~ {plan.endDate} · 게시 일정은 한국 시간으로 저장해요.</p>
      <fieldset disabled={busy} className="form-stack">
        {marketing && <>
          {menus.length > 0 && <label>소개할 메뉴
            <select required value={customSubject ? 'custom' : menus.includes(subject) ? `menu:${subject}` : ''}
              onChange={event => {
                const value = event.target.value
                setCustomSubject(value === 'custom')
                changeSubject(value.startsWith('menu:') ? value.slice(5) : '')
              }}>
              <option value="" disabled>메뉴를 선택해 주세요</option>
              {menus.map(name => <option key={name} value={`menu:${name}`}>{name}</option>)}
              <option value="custom">메뉴나 가게 소식 직접 입력</option>
            </select>
          </label>}
          {(menus.length === 0 || customSubject) && <label>소개할 메뉴나 가게 소식
            <input type="text" required maxLength={80} value={subject} placeholder="예시. 제철 감귤 에이드"
              onChange={event => changeSubject(event.target.value)} />
          </label>}
          {draft && !currentDraft && <p className="muted">새 홍보 초안을 만들면 선택한 메뉴나 소식으로 미리보기가 바뀌어요.</p>}
        </>}
        <div className="promotion-datetime">
          <label>게시 날짜<input type="date" required max={plan.endDate} value={publishDate} onChange={event => setPublishDate(event.target.value)} /></label>
          <label>게시 시간<input type="time" required value={publishTime} onChange={event => setPublishTime(event.target.value)} /></label>
        </div>
        {currentDraft && <div className="form-stack">
          <label>이번 게시물 말투<select value={tone} onChange={event => {
            setToneChoice(event.target.value as PromotionTone)
            setToneMessage('')
          }}>
            {promotionTones.map(({value, label}) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <button type="button" className="button secondary small" onClick={() => void regenerate()}>이 말투로 문구 다시 만들기</button>
          <small className="muted">이번 게시물 문구를 선택한 말투로 바꿀 수 있어요.</small>
          {toneMessage && <p role="status">{toneMessage}</p>}
        </div>}
        {currentDraft && <label>홍보 문구<textarea rows={5} required maxLength={2200} value={captionEdit ?? currentDraft.caption}
          onChange={event => setCaptionEdit(event.target.value)} /></label>}
        <label>{marketing ? '홍보에 사용할 사진 올리기' : '음식 사진 올리기'}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
          event.target.value = ''
        }} /></label>
        {photo ? <button className="text-button" type="button" onClick={() => setPhoto(undefined)}>새 사진 선택 취소</button>
          : availablePhoto && <label><input type="checkbox" checked={useSavedPhoto} onChange={event => setUseSavedPhoto(event.target.checked)} /> {marketing ? '저장된 사진 사용' : '저장된 메뉴 사진 사용'}</label>}
      </fieldset>
      {preview && <img src={preview} alt={productName + ' 사진 미리보기'} width={160} />}
      {review?.maxDiscountQuantity === 0 && <p className="muted">할인 예산으로 최소 한 개를 할인할 수 있어야 해요.</p>}
      <button className="button primary small" disabled={busy || cannotSave}>
        {busy ? '준비 중…' : currentDraft ? '홍보 초안 변경 저장' : marketing ? '홍보 초안 만들기' : '할인 조건 확정하고 홍보 초안 저장'}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
    </form>
  </div>
}
