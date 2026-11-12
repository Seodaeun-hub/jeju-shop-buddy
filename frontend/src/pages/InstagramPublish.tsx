import { useEffect, useRef, useState } from 'react'
import { cancelInstagramSchedule, fetchInstagramPublication, publishInstagram, type InstagramPublicationStatus } from '../api/shop'

const koreaDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
const koreaSchedule = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' })

export function InstagramPublish({ auth, planId, caption, image, hasPhoto, endDate, state, onStatus }: {
  auth: string
  planId: string
  caption: string
  image?: string
  hasPhoto: boolean
  endDate: string
  state?: InstagramPublicationStatus
  onStatus: (status: InstagramPublicationStatus) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [preview, setPreview] = useState<{ jpeg: string; caption: string; username?: string }>()
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const publication = state?.publication
  const publicationState = publication?.state
  const canPublish = Boolean(state?.available && !publication && hasPhoto)
  const today = koreaDate.format(new Date())
  const scheduledAt = date && time ? `${date}T${time}:00+09:00` : undefined

  useEffect(() => {
    if (preview && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [preview])

  useEffect(() => {
    if (busy || (publicationState !== 'SCHEDULED' && publicationState !== 'PUBLISHING')) return
    const controller = new AbortController()
    let timer: number
    async function refresh() {
      try {
        const status = await fetchInstagramPublication(auth, planId, controller.signal)
        if (!controller.signal.aborted) onStatus(status)
      } catch {
        // The next poll can recover from a temporary connection failure.
      }
      if (!controller.signal.aborted) timer = window.setTimeout(refresh, 3000)
    }
    timer = window.setTimeout(refresh, 3000)
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [auth, planId, publicationState, onStatus, busy])

  function openPreview() {
    const jpeg = image
    if (!jpeg?.startsWith('data:image/jpeg;base64,')) {
      setMessage('홍보 이미지를 만들지 못했어요. 다시 시도해 주세요.')
      return
    }
    setMessage('')
    setPreview({ jpeg, caption, username: publication?.username ?? state?.username })
  }

  async function publish(due?: string) {
    if (!state || !canPublish || busy || !preview?.username || preview.caption !== caption) return
    if (due && (date > endDate || new Date(due).getTime() <= Date.now())) {
      setMessage('예약 시간은 현재 이후부터 행사 종료일까지 선택해 주세요.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const { username, caption, jpeg } = preview
      const receipt = await publishInstagram(auth, planId, { username, caption, image: jpeg, scheduledAt: due })
      onStatus({ ...state, publication: receipt })
      dialog.current?.close()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '게시 상태를 확인해 주세요.')
      await fetchInstagramPublication(auth, planId).then(onStatus).catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      onStatus(await cancelInstagramSchedule(auth, planId))
      setDate('')
      setTime('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '예약 상태를 확인해 주세요.')
      await fetchInstagramPublication(auth, planId).then(onStatus).catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  const scheduleLabel = publication?.scheduledAt ? koreaSchedule.format(new Date(publication.scheduledAt)) : undefined
  return <div className="instagram-publish">
    <div className="promo-actions">
      <button type="button" className="button primary small" disabled={!image} aria-haspopup="dialog" onClick={openPreview}>게시 관리</button>
      {state?.available === false && !publication && <a className="button secondary small" href="https://www.instagram.com/"
        target="_blank" rel="noopener noreferrer">인스타그램 열기 <span aria-hidden="true">↗</span></a>}
    </div>
    {!publication && <p className="promotion-post-mode">
      {state?.available ? '초안 준비 완료' : state ? '계정 연결 필요' : '계정 연결 확인 중'}
    </p>}
    {publicationState === 'SCHEDULED' && <>
      <p role="status">{scheduleLabel} (한국 시간) 예약됨</p>
      <button type="button" className="button secondary small" disabled={busy} onClick={cancel}>예약 취소</button>
    </>}
    {publicationState === 'FAILED' && <>
      <p role="status">예약 게시를 시작하지 못했어요. 예약을 다시 설정할 수 있어요.</p>
      <button type="button" className="button secondary small" disabled={busy} onClick={cancel}>예약 초기화</button>
    </>}
    {publication?.state === 'PUBLISHED' && <>
      <p role="status">@{publication.username} 게시 완료</p>
      <a href={publication.permalink ?? `https://www.instagram.com/${publication.username}/`} target="_blank" rel="noreferrer">
        인스타그램에서 보기 ↗
      </a>
    </>}
    {publicationState === 'PUBLISHING' && <p role="status">인스타그램에 게시 중이에요.</p>}
    {publicationState === 'VERIFY_REQUIRED' &&
      <p role="status"><strong>확인 필요</strong> · 인스타그램 피드에서 게시 여부를 확인해 주세요.</p>}
    {!preview && message && <p role="alert">{message}</p>}
    <dialog ref={dialog} className="instagram-preview" aria-labelledby="instagram-preview-title"
      onClose={() => { setPreview(undefined); setMessage('') }} onCancel={event => { if (busy) event.preventDefault() }}>
      <h2 id="instagram-preview-title">
        {publicationState === 'PUBLISHED' ? '게시한 홍보물' : publicationState === 'SCHEDULED' ? '예약한 홍보물' : '게시 전 최종 미리보기'}
      </h2>
      {preview && <>
        <div className="instagram-preview-body">
          <img src={preview.jpeg} alt="인스타그램에 게시할 홍보 카드" width={1080} height={1080} />
          <div>
            {preview.username && <p>게시 계정 <strong>@{preview.username}</strong></p>}
            <p className="instagram-preview-caption">{preview.caption}</p>
          </div>
        </div>
        {!hasPhoto && <p className="muted">메뉴 사진을 등록하고 초안을 저장하면 게시할 수 있어요.</p>}
        {hasPhoto && !state?.available && !publication && <p className="muted">인스타그램 연결이 준비되면 이 화면에서 게시할 수 있어요.</p>}
        {canPublish && <fieldset className="form-stack instagram-schedule" disabled={busy}>
          <legend>예약 게시 · 한국 시간</legend>
          <label>예약 날짜<input type="date" min={today} max={endDate} value={date} onChange={event => setDate(event.target.value)} /></label>
          <label>예약 시간<input type="time" value={time} onChange={event => setTime(event.target.value)} /></label>
        </fieldset>}
        {message && <p role="alert">{message}</p>}
        <div className="promo-actions">
          <button type="button" className="button secondary small" autoFocus disabled={busy} onClick={() => dialog.current?.close()}>닫기</button>
          {canPublish && <>
            <button type="button" className="button secondary small" disabled={busy || !preview.username || preview.caption !== caption}
              onClick={() => void publish()}>지금 게시</button>
            <button type="button" className="button primary small" disabled={busy || !scheduledAt || !preview.username || preview.caption !== caption}
              onClick={() => void publish(scheduledAt)}>예약 게시</button>
          </>}
        </div>
      </>}
    </dialog>
  </div>
}
