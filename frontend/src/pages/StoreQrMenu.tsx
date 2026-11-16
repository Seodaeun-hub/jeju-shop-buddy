import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Link } from 'react-router'
import { fetchQrMenu, publishQrMenu, translateQrMenu, unpublishQrMenu } from '../api/shop'
import { translationLanguages, type MenuEditor, type MenuTranslation } from '../data/qrMenu'
import { won } from '../data/shop'
import '../styles/qr-menu.css'

export function StoreQrMenu({ auth, storeId }: { auth: string; storeId: string }) {
  const [editor, setEditor] = useState<MenuEditor>()
  const [translations, setTranslations] = useState<MenuTranslation[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const request = new AbortController()
    void fetchQrMenu(auth, storeId, request.signal).then(data => {
      if (request.signal.aborted) return
      setEditor(data)
      setTranslations(data.published?.version === data.version ? data.published.translations
        : data.items.map((_, index) => ({ index, en: '', zh: '', ja: '' })))
    }).catch(failure => {
      if (!request.signal.aborted) setError(failure.message)
    })
    return () => request.abort()
  }, [auth, storeId, retry])

  async function run(status: string, action: () => Promise<void>) {
    if (busy) return
    setBusy(status)
    setMessage('')
    setError('')
    try {
      await action()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '요청을 처리하지 못했어요.')
    } finally {
      setBusy('')
    }
  }

  function reload() {
    setEditor(undefined)
    setError('')
    setMessage('')
    setConfirmed(false)
    setRetry(value => value + 1)
  }

  const publicUrl = editor?.published && new URL('/menu/' + editor.published.publicId,
    import.meta.env.VITE_PUBLIC_MENU_ORIGIN || window.location.origin).href
  const ready = translations.length > 0 && translations.every(item => item.en.trim() && item.zh.trim() && item.ja.trim())

  return <section className="qr-editor form-stack" aria-labelledby="qr-editor-title">
    <div className="section-top ruled">
      <div><h2 id="qr-editor-title">다국어 QR 메뉴판</h2>
        <p className="muted">저장된 메뉴와 사진, 최근 POS 판매가를 불러와요. 번역을 확인하고 공개하면 손님이 QR로 열 수 있어요.</p>
      </div>
      {editor && <button type="button" className="button secondary small" onClick={reload} disabled={Boolean(busy)}>목록 다시 불러오기</button>}
    </div>
    {editor && publicUrl && <div className="qr-share">
      <QRCodeSVG value={publicUrl} size={192} level="M" marginSize={4} title="공개 메뉴판 QR 코드" />
      <div>
        <h3>공개 메뉴판</h3>
        <p className="muted">손님은 로그인 없이 네 가지 언어로 볼 수 있어요.</p>
        {editor.published?.version !== editor.version && <p className="muted">메뉴 정보가 바뀌었어요. 새 내용을 확인하고 다시 공개해 주세요.</p>}
        <div className="actions">
          <a className="button secondary small" href={publicUrl} target="_blank" rel="noopener noreferrer">공개 메뉴판 열기</a>
          <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => void run('공개를 중지하고 있어요.', async () => {
            await unpublishQrMenu(auth, storeId)
            setEditor({ ...editor, published: null })
            setMessage('메뉴판 공개를 중지했어요.')
          })}>공개 중지</button>
        </div>
      </div>
    </div>}
    {!editor && !error && <p role="status">저장된 메뉴를 불러오고 있어요.</p>}
    {!editor && error && <button className="button secondary small" type="button" onClick={reload}>다시 불러오기</button>}
    {editor && editor.items.length === 0 && <p>아직 등록한 메뉴가 없어요. <Link to="/sales">POS 매출 입력</Link>에서 상품 주문을 불러와 주세요.</p>}
    {editor && editor.items.length > 0 && <>
      <div className="actions"><button type="button" className="button secondary" disabled={Boolean(busy) || editor.items.length > 60}
        onClick={() => void run('세 언어의 초안을 만들고 있어요.', async () => {
          const result = await translateQrMenu(auth, storeId, editor.version)
          setTranslations(result.items)
          setConfirmed(false)
          setMessage('초안이 준비됐어요. 손님에게 보여줄 메뉴명을 확인해 주세요.')
        })}>영어·중국어·일본어 초안 만들기</button></div>
      {editor.items.length > 60 && <p className="muted">메뉴가 60개를 넘으면 번역을 직접 입력할 수 있어요.</p>}
      <ul className="qr-editor-list">
        {editor.items.map((item, index) => <li key={item.name}>
          <div className="qr-editor-original">
            {item.photoDataUrl && <img src={item.photoDataUrl} alt={item.name} loading="lazy" />}
            <div><h3>{item.name}</h3><p className="muted">{item.priceWon == null ? 'POS 판매가 없음' : won(item.priceWon)}</p></div>
          </div>
          <fieldset disabled={Boolean(busy)} className="qr-translation-fields" aria-label={item.name + ' 번역'}>
            {translationLanguages.map(language => <label key={language.id}>{language.label}
              <input lang={language.locale} value={translations[index]?.[language.id] ?? ''} maxLength={255}
                onChange={event => {
                  const value = event.target.value
                  setTranslations(items => items.map(item => item.index === index ? { ...item, [language.id]: value } : item))
                  setConfirmed(false)
                }} />
            </label>)}
          </fieldset>
        </li>)}
      </ul>
      <label className="qr-confirm"><input type="checkbox" checked={confirmed} disabled={!ready || Boolean(busy)}
        onChange={event => setConfirmed(event.target.checked)} /> 세 언어의 메뉴명과 사진·가격을 확인했어요.</label>
      <div className="actions"><button type="button" className="button primary" disabled={!confirmed || !ready || Boolean(busy)}
        onClick={() => void run('메뉴판을 공개하고 있어요.', async () => {
          const published = await publishQrMenu(auth, storeId, editor.version, translations)
          setEditor({ ...editor, published })
          setTranslations(published.translations)
          setConfirmed(false)
          setMessage('메뉴판을 공개했어요.')
        })}>{publicUrl ? '변경 내용 공개' : '메뉴판 공개'}</button></div>
    </>}
    {error && <p className="error" role="alert">{error}</p>}
    {(busy || message) && <p role="status">{busy || message}</p>}
  </section>
}
