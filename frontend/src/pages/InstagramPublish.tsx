import { useEffect, useRef, useState } from 'react'
import { fetchInstagramPublication, publishInstagram, type InstagramPublicationStatus } from '../api/shop'

export function InstagramPublish({ auth, planId, caption, image, hasPhoto }: {
  auth: string
  planId: string
  caption: string
  image: () => string | undefined
  hasPhoto: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [state, setState] = useState<InstagramPublicationStatus>()
  const [preview, setPreview] = useState<{ jpeg: string; caption: string; username?: string }>()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetchInstagramPublication(auth, planId, controller.signal).then(setState).catch(() => undefined)
    return () => controller.abort()
  }, [auth, planId])

  useEffect(() => {
    if (preview && dialog.current && !dialog.current.open) dialog.current.showModal()
  }, [preview])

  function openPreview() {
    const jpeg = image()
    if (!jpeg?.startsWith('data:image/jpeg;base64,')) {
      setMessage('홍보 이미지를 만들지 못했어요. 다시 시도해 주세요.')
      return
    }
    setMessage('')
    setPreview({ jpeg, caption, username: state?.username })
  }

  async function publish() {
    if (!state?.available || state.publication || !hasPhoto || busy || !preview?.username || preview.caption !== caption) return
    setBusy(true)
    setMessage('')
    try {
      const { username, caption, jpeg } = preview
      const publication = await publishInstagram(auth, planId, { username, caption, image: jpeg })
      setState({ ...state, publication })
      dialog.current?.close()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '게시 상태를 확인해 주세요.')
      await fetchInstagramPublication(auth, planId).then(setState).catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  const publication = state?.publication
  return <div className="instagram-publish">
    <button type="button" className="button small" onClick={openPreview}>게시 전 최종 미리보기</button>
    {publication?.state === 'PUBLISHED' && <>
      <p role="status">@{publication.username} 게시 완료</p>
      <a href={publication.permalink ?? `https://www.instagram.com/${publication.username}/`} target="_blank" rel="noreferrer">
        인스타그램에서 보기 ↗
      </a>
    </>}
    {publication && publication.state !== 'PUBLISHED' &&
      <p role="status">게시 상태를 확인 중이에요. 인스타그램 피드를 확인해 주세요.</p>}
    {!preview && message && <p role="alert">{message}</p>}
    <dialog ref={dialog} className="instagram-preview" aria-labelledby="instagram-preview-title"
      onClose={() => { setPreview(undefined); setMessage('') }} onCancel={event => { if (busy) event.preventDefault() }}>
      <h2 id="instagram-preview-title">게시 전 최종 미리보기</h2>
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
        {message && <p role="alert">{message}</p>}
        <div className="promo-actions">
          <button type="button" className="button secondary small" autoFocus disabled={busy} onClick={() => dialog.current?.close()}>닫기</button>
          {state?.available && !publication && hasPhoto && <button type="button" className="button primary small"
            disabled={busy || preview.caption !== caption || !preview.username} onClick={publish}>{busy ? '게시 중…' : '지금 게시'}</button>}
        </div>
      </>}
    </dialog>
  </div>
}
