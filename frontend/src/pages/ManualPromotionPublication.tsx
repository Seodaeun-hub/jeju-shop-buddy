import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { saveManualPromotionPublication, type PromotionChannel, type ManualPromotionPublicationStatus } from '../api/shop'
import { promotionPublicationLabels } from '../data/promotionChannels'

const koreaDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function ManualPromotionPublication({ auth, planId, channel, endDate, resultsTo, defaultProduct, status, onStatus }: {
  auth: string
  planId: string
  channel: PromotionChannel
  endDate: string
  resultsTo?: string
  defaultProduct?: string
  status?: ManualPromotionPublicationStatus | null
  onStatus: (status: ManualPromotionPublicationStatus) => void
}) {
  const details = useRef<HTMLDetailsElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const publication = status?.publications?.[channel]
  const label = promotionPublicationLabels[channel]
  const today = koreaDate.format(new Date())
  const latestDate = endDate < today ? endDate : today

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !status) return
    const fields = new FormData(event.currentTarget)
    const publishedDate = fields.get('publishedDate')
    const productName = fields.get('productName')
    if (typeof publishedDate !== 'string' || !publishedDate) return
    setBusy(true)
    setError('')
    try {
      onStatus(await saveManualPromotionPublication(auth, planId, {
        channel, publishedDate, productName: typeof productName === 'string' ? productName.trim() : undefined,
      }))
      if (details.current) details.current.open = false
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '게시일을 저장하지 못했어요.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="promotion-manual-publication">
    {publication ? <>
      <p className="promotion-post-mode">직접 게시 · {publication.publishedDate}</p>
      <small>비교 품목 {publication.productName}</small>
      {resultsTo && <Link className="button secondary small" to={resultsTo}>판매 변화 확인</Link>}
    </> : channel !== 'INSTAGRAM' && <p className="promotion-post-mode">초안 준비 완료 · 직접 게시</p>}
    {status === null && <p className="promotion-post-mode">게시 기록을 불러오지 못했어요. 새로고침해 주세요.</p>}
    {status && <details ref={details}>
      <summary>{publication ? '직접 게시일 수정' : '실제 게시일 기록'}</summary>
      <form className="form-stack" onSubmit={event => void save(event)}>
        <label>{label} 실제 게시일
          <input name="publishedDate" type="date" min="1900-01-01" max={latestDate}
            defaultValue={publication?.publishedDate} required disabled={busy} />
        </label>
        {defaultProduct !== undefined && <label>비교할 POS 품목명
          <input name="productName" type="text" defaultValue={status.productName ?? defaultProduct}
            maxLength={255} required disabled={busy} />
        </label>}
        <p className="promotion-post-mode">세 채널 중 첫 게시일을 기준으로 판매를 한 번 비교해요. 비교 기간이나 품목이 바뀌면 POS를 다시 올려 주세요.</p>
        <button className="button secondary small" disabled={busy}>{busy ? '저장 중…' : '게시일 저장'}</button>
        {error && <p role="alert" className="error">{error}</p>}
      </form>
    </details>}
  </div>
}
