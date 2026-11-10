import { useEffect, useState } from 'react'
import { fetchMenuPhoto, listMenuPhotos, saveMenuPhoto } from '../api/shop'
import { prepareMenuPhoto } from '../data/menuPhoto'

export function MenuPhotos({ auth, storeId }: { auth: string; storeId: string }) {
  const [menu, setMenu] = useState<{ productName: string; hasPhoto: boolean }[]>()
  const [selected, setSelected] = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [pending, setPending] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    listMenuPhotos(auth, storeId, controller.signal).then(value => {
      if (!controller.signal.aborted) setMenu(value)
    }).catch(() => {
      if (!controller.signal.aborted) setError('메뉴 목록을 불러오지 못했어요.')
    })
    return () => controller.abort()
  }, [auth, storeId])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    fetchMenuPhoto(auth, storeId, selected, controller.signal).then(({ photoDataUrl }) => {
      if (!controller.signal.aborted) setPhoto(photoDataUrl)
    }).catch(() => {
      if (!controller.signal.aborted) setError('메뉴 사진을 불러오지 못했어요.')
    })
    return () => controller.abort()
  }, [auth, storeId, selected])

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
    if (!selected || !pending || busy) return
    setBusy(true)
    setError('')
    try {
      const result = await saveMenuPhoto(auth, storeId, selected, pending)
      setPhoto(result.photoDataUrl)
      setMenu(current => current?.map(item => item.productName === selected ? { ...item, hasPhoto: true } : item))
      setPending(undefined)
      setStatus('메뉴 사진을 저장했어요.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '메뉴 사진을 저장하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  const preview = pending ?? photo
  return <section className="receipt form-stack" aria-label="메뉴 사진 관리">
    <h3>메뉴 사진 관리</h3>
    <p>POS에서 가져온 메뉴의 사진을 한 번 등록하면 같은 매장의 홍보 초안에서 재사용할 수 있어요.</p>
    {menu?.length ? <>
      <label>사진을 등록할 메뉴<select disabled={busy} value={selected} onChange={event => {
        setSelected(event.target.value)
        setPhoto(null)
        setPending(undefined)
        setError('')
        setStatus('')
      }}>
        <option value="">메뉴 선택</option>
        {menu.map(({ productName, hasPhoto }) => <option value={productName} key={productName}>
          {productName}{hasPhoto ? ' · 사진 등록됨' : ''}
        </option>)}
      </select></label>
      {selected && <>
        <label>메뉴 사진 파일<input type="file" disabled={busy} accept="image/jpeg,image/png,image/webp" onChange={event => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
          event.target.value = ''
        }} /></label>
        {preview && <img src={preview} width={160} alt={selected + ' 메뉴 사진'} />}
        <button type="button" className="button primary small" disabled={!pending || busy} onClick={() => void save()}>메뉴 사진 저장</button>
      </>}
    </> : menu ? <p>상품 주문 시트가 포함된 POS 파일을 먼저 올려 주세요.</p>
      : !error && <p role="status">메뉴를 불러오는 중이에요.</p>}
    {status && <p role="status">{status}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>
}
