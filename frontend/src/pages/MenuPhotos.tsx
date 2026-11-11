import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { fetchMenuPhoto, listMenuPhotos, saveMenuPhoto } from '../api/shop'
import { prepareMenuPhoto } from '../data/menuPhoto'

type MenuItem = { productName: string; hasPhoto: boolean; photoDataUrl?: string }

function MenuPhotoCard({ auth, storeId, productName, hasPhoto, photoDataUrl }: MenuItem & { auth: string; storeId: string }) {
  const card = useRef<HTMLElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState(photoDataUrl ?? null)
  const [pending, setPending] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!hasPhoto || photoDataUrl || !card.current) return
    const controller = new AbortController()
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      fetchMenuPhoto(auth, storeId, productName, controller.signal).then(({ photoDataUrl }) => {
        if (!controller.signal.aborted) setPhoto(current => current ?? photoDataUrl)
      }).catch(() => {
        if (!controller.signal.aborted) setError('저장한 사진을 불러오지 못했어요.')
      })
    }, { rootMargin: '160px' })
    observer.observe(card.current)
    return () => {
      observer.disconnect()
      controller.abort()
    }
  }, [auth, storeId, productName, hasPhoto, photoDataUrl])

  async function upload(file: File) {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      setPending(await prepareMenuPhoto(file))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '사진을 읽지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!pending || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await saveMenuPhoto(auth, storeId, productName, pending)
      setPhoto(result.photoDataUrl)
      setPending(undefined)
      setStatus('저장했어요.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '메뉴 사진을 저장하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  const preview = pending ?? photo
  const action = pending ? '다른 사진 선택' : '사진 바꾸기'

  return <article ref={card} className="menu-photo-card" aria-label={productName}>
    <div className="menu-photo-frame">
      {preview ? <img src={preview} alt={`${productName} ${pending ? '미리보기' : '사진'}`} />
        : hasPhoto ? <div className="menu-photo-placeholder">{error ? '사진을 표시할 수 없어요' : '사진 불러오는 중…'}</div>
          : <button type="button" className="menu-photo-placeholder menu-photo-upload" disabled={busy}
            aria-label={`${productName} 사진 업로드`} onClick={() => fileInput.current?.click()}>
            <span aria-hidden="true">+</span>사진을 업로드해 주세요
          </button>}
    </div>
    <div className="menu-photo-card-body">
      <h3>{productName}</h3>
      <input ref={fileInput} type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={event => {
        const file = event.target.files?.[0]
        if (file) void upload(file)
        event.target.value = ''
      }} />
      {(preview || hasPhoto) && <div className="menu-photo-actions">
        <button type="button" className="button secondary small" disabled={busy} aria-label={`${productName} ${action}`}
          onClick={() => fileInput.current?.click()}>{action}</button>
        {pending && <>
          <button type="button" className="button primary small" disabled={busy} onClick={() => void save()}>사진 저장</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => { setPending(undefined); setError('') }}>취소</button>
        </>}
      </div>}
      {busy && <p className="muted" role="status">사진 처리 중…</p>}
      {status && <p className="muted" role="status">{status}</p>}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  </article>
}

function AddMenuPhoto({ auth, storeId, menu, onAdd }: {
  auth: string
  storeId: string
  menu: MenuItem[]
  onAdd: (item: MenuItem) => void
}) {
  const [name, setName] = useState('')
  const [preview, setPreview] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  async function upload(file: File) {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      setPreview(await prepareMenuPhoto(file))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '사진을 읽지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const productName = name.trim()
    if (!productName || !preview || busy) return
    setError('')
    if (menu.some(item => item.productName === productName)) {
      setError('이미 있는 메뉴예요. 위 카드에서 사진을 올리거나 바꿔 주세요.')
      return
    }
    setBusy(true)
    try {
      const { photoDataUrl } = await saveMenuPhoto(auth, storeId, productName, preview)
      onAdd({ productName, hasPhoto: true, photoDataUrl: photoDataUrl ?? preview })
      setName('')
      setPreview(undefined)
      setStatus(`‘${productName}’ 메뉴를 추가했어요.`)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '메뉴를 추가하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return <form className="receipt form-stack add-menu-photo" onSubmit={add} aria-labelledby="add-menu-title">
    <div>
      <h3 id="add-menu-title">메뉴 추가</h3>
      <p className="muted">POS 목록에 없는 메뉴는 이름과 사진을 직접 등록할 수 있어요.</p>
    </div>
    <fieldset className="add-menu-fields" disabled={busy}>
      <label>메뉴 이름<input required maxLength={255} value={name} onChange={event => { setName(event.target.value); setStatus(''); setError('') }} /></label>
      <label>메뉴 사진<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
        const file = event.target.files?.[0]
        if (file) void upload(file)
        event.target.value = ''
      }} /></label>
    </fieldset>
    {preview && <div className="add-menu-preview">
      <img src={preview} alt="추가할 메뉴 사진 미리보기" />
      <button type="button" className="text-button" disabled={busy} onClick={() => setPreview(undefined)}>사진 선택 취소</button>
    </div>}
    <button type="submit" className="button primary fit" disabled={busy || !name.trim() || !preview}>메뉴 추가하기</button>
    {busy && <p className="muted" role="status">사진 처리 중…</p>}
    {status && <p className="muted" role="status">{status}</p>}
    {error && <p className="error" role="alert">{error}</p>}
  </form>
}

export function MenuPhotos({ auth, storeId }: { auth: string; storeId: string }) {
  const [menu, setMenu] = useState<MenuItem[]>()
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listMenuPhotos(auth, storeId, controller.signal).then(value => {
      if (!controller.signal.aborted) setMenu(value)
    }).catch(() => {
      if (!controller.signal.aborted) setError(true)
    })
    return () => controller.abort()
  }, [auth, storeId, retry])

  return <section className="form-stack" aria-labelledby="menu-photos-title">
    <div>
      <h2 id="menu-photos-title">메뉴 사진 관리</h2>
      <p className="muted">여기서 등록한 메뉴 사진은 이 매장의 홍보 초안에서 다시 쓸 수 있어요.</p>
    </div>
    {error ? <p role="alert" className="error">메뉴 목록을 불러오지 못했어요. <button type="button" className="text-button"
      onClick={() => { setError(false); setRetry(value => value + 1) }}>다시 불러오기</button></p>
      : !menu ? <p role="status">메뉴를 불러오는 중이에요.</p>
        : <>
          {menu.length === 0 ? <p>상품 주문 내역이 포함된 POS 파일을 올리면 분석한 메뉴가 여기에 표시돼요.</p>
            : <div className="menu-photo-grid">
              {menu.map(item => <MenuPhotoCard key={item.productName} auth={auth} storeId={storeId} {...item} />)}
            </div>}
          <AddMenuPhoto auth={auth} storeId={storeId} menu={menu} onAdd={item => {
            setMenu(current => current && [...current, item].sort((a, b) => a.productName.localeCompare(b.productName, 'ko')))
          }} />
        </>}
  </section>
}
