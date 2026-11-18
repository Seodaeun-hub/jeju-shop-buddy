import { useEffect, useId, useRef, useState } from 'react'
import { cancelInstagramSchedule, fetchInstagramPublication, publishInstagram, type InstagramPublicationStatus } from '../api/shop'
import { rehearsalDate } from '../data/rehearsalDate'

const koreaDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
const koreaSchedule = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' })

async function testPreviewImage(source: string): Promise<string> {
  const photo = new Image()
  photo.src = source
  await photo.decode()
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 1080
  const context = canvas.getContext('2d')
  if (!context) throw new Error('테스트 게시 이미지를 만들지 못했어요.')
  context.fillStyle = '#fffdf9'
  context.fillRect(0, 0, 1080, 1080)
  context.fillStyle = '#254933'
  context.fillRect(0, 0, 1080, 140)
  context.fillStyle = '#ffffff'
  context.textAlign = 'center'
  context.font = 'bold 35px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif'
  context.fillText('가상 시연 · 현재 진행하는 판매 행사 아님', 540, 57, 1000)
  context.font = '29px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif'
  context.fillText('과거 자료 재현 / 음식 사진은 AI 예시', 540, 108, 1000)
  context.drawImage(photo, 70, 140, 940, 940)
  return canvas.toDataURL('image/jpeg', 0.88)
}

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
  const [preview, setPreview] = useState<{ jpeg: string; caption: string; sourceCaption: string; username?: string; test?: boolean }>()
  const [testConfirmed, setTestConfirmed] = useState(false)
  const confirmation = useId()
  const [date, setDate] = useState('')
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const publication = state?.publication
  const publicationState = publication?.state
  const canPublish = Boolean(!rehearsalDate() && state?.available && !publication && hasPhoto)
  const canTestPublish = Boolean(rehearsalDate() && state?.rehearsalTestAvailable && state.rehearsalTestNotice && !publication && hasPhoto)
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

  async function openPreview() {
    const jpeg = image
    if (!jpeg?.startsWith('data:image/jpeg;base64,')) {
      setMessage('홍보 이미지를 만들지 못했어요. 다시 시도해 주세요.')
      return
    }
    setMessage('')
    setTestConfirmed(false)
    if (canTestPublish) {
      setBusy(true)
      try {
        setPreview({ jpeg: await testPreviewImage(jpeg), caption: state!.rehearsalTestNotice + '\n\n' + caption,
          sourceCaption: caption, username: state?.username, test: true })
      } catch {
        setMessage('테스트 게시 이미지를 만들지 못했어요. 다시 열어 주세요.')
      } finally { setBusy(false) }
    } else setPreview({ jpeg, caption, sourceCaption: caption, username: publication?.username ?? state?.username })
  }

  async function publish(due?: string) {
    if (!state || !(canPublish || canTestPublish) || busy || !preview?.username || preview.sourceCaption !== caption) return
    if (preview.test && (!testConfirmed || due || Array.from(preview.caption).length > 2200)) return
    if (due && (date > endDate || new Date(due).getTime() <= Date.now())) {
      setMessage('예약 시간은 현재 이후부터 행사 종료일까지 선택해 주세요.')
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const { username, caption, jpeg } = preview
      const receipt = await publishInstagram(auth, planId, { username, caption, image: jpeg, scheduledAt: due,
        testPublication: preview.test, testConfirmed: preview.test ? testConfirmed : undefined })
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
      <button type="button" className="button primary small" disabled={!image || busy} aria-haspopup="dialog" onClick={() => void openPreview()}>{busy && !preview ? '미리보기 준비 중…' : '게시 관리'}</button>
      {state?.available === false && !publication && !rehearsalDate() && <a className="button secondary small" href="https://www.instagram.com/"
        target="_blank" rel="noopener noreferrer">인스타그램 열기 <span aria-hidden="true">↗</span></a>}
    </div>
    {!publication && <p className="promotion-post-mode">
      {rehearsalDate() ? canTestPublish ? '과거 자료 시연 · 테스트 계정에 오늘 게시 가능' : '시연 중 · 테스트 게시 계정 연결 필요' : state?.available ? '초안 준비 완료' : state ? '계정 연결 필요' : '계정 연결 확인 중'}
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
        {hasPhoto && !state?.available && !canTestPublish && !publication && <p className="muted">{rehearsalDate()
          ? '시연 중에는 일반 게시와 예약을 하지 않아요. 연결한 테스트 계정에서만 테스트 게시를 진행할 수 있어요.'
          : '인스타그램 연결이 준비되면 이 화면에서 게시할 수 있어요.'}</p>}
        {preview.test && <div className="form-stack instagram-test-confirmation">
          <p>분석 기준일과 홍보 기간은 과거 날짜로 유지해요. 아래 테스트 게시물은 오늘 실제 인스타그램에 올라가요.</p>
          <label htmlFor={confirmation}><input id={confirmation} type="checkbox" checked={testConfirmed} disabled={busy}
            onChange={event => setTestConfirmed(event.target.checked)} /><span>시연 안내와 AI 예시 표시를 확인했고, @{preview.username} 테스트 계정에 오늘 게시할게요.</span></label>
          {Array.from(preview.caption).length > 2200 && <p role="alert">시연 안내를 포함한 문구가 길어요. 초안 문구를 줄인 뒤 다시 열어 주세요.</p>}
        </div>}
        {canPublish && <fieldset className="form-stack instagram-schedule" disabled={busy}>
          <legend>예약 게시 · 한국 시간</legend>
          <label>예약 날짜<input type="date" min={today} max={endDate} value={date} onChange={event => setDate(event.target.value)} /></label>
          <label>예약 시간<input type="time" value={time} onChange={event => setTime(event.target.value)} /></label>
        </fieldset>}
        {message && <p role="alert">{message}</p>}
        <div className="promo-actions">
          <button type="button" className="button secondary small" autoFocus disabled={busy} onClick={() => dialog.current?.close()}>닫기</button>
          {canPublish && <>
            <button type="button" className="button secondary small" disabled={busy || !preview.username || preview.sourceCaption !== caption}
              onClick={() => void publish()}>지금 게시</button>
            <button type="button" className="button primary small" disabled={busy || !scheduledAt || !preview.username || preview.sourceCaption !== caption}
              onClick={() => void publish(scheduledAt)}>예약 게시</button>
          </>}
          {canTestPublish && preview.test && <button type="button" className="button primary small"
            disabled={busy || !testConfirmed || !preview.username || preview.sourceCaption !== caption || Array.from(preview.caption).length > 2200}
            onClick={() => void publish()}>{busy ? '테스트 게시 중…' : '테스트 계정에 지금 게시'}</button>}
        </div>
      </>}
    </dialog>
  </div>
}
