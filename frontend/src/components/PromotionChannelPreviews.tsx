import { useState } from 'react'
import type { ReactNode } from 'react'
import { PromotionReviewSources } from './PromotionReviewPoints'
import { promotionCaptionBody, promotionCaptions, promotionChannels } from '../data/promotionChannels'
import type { Plan, PromotionChannelCopy, PromotionDraft } from '../data/shop'

const basisNotes = {
  WEB: '확인한 매장 공개 정보를 바탕으로 AI가 작성했어요.',
  WEB_AND_PHOTO: '확인한 매장 공개 정보와 등록한 사진을 바탕으로 AI가 작성했어요.',
  PHOTO: '메뉴와 등록한 사진을 바탕으로 AI가 작성했어요. 확인된 웹 출처는 없어요.',
  MENU: '저장한 매장명과 메뉴를 바탕으로 AI가 작성했어요.',
  BASIC: 'AI 문구 생성이 완료되지 않아 기본 초안을 보여드려요.',
}

const channelLinks = {
  naver: 'https://smartplace.naver.com/',
  daangn: 'https://business.daangn.com/',
}

export function PromotionChannelPreviews({ plan, draft, generatedImage, imageFailed, instagramImage, instagramCaption, instagramUsername, instagramPublishing, manualPublishing }: {
  plan: Plan
  draft: PromotionDraft
  generatedImage?: string
  imageFailed: boolean
  instagramImage?: string | null
  instagramCaption: string
  instagramUsername?: string
  instagramPublishing?: ReactNode
  manualPublishing?: (channel: keyof PromotionChannelCopy) => ReactNode
}) {
  const captions = { ...promotionCaptions(plan, draft), instagram: instagramCaption }
  const offer = draft.channels?.offer
  const checkedChannels = draft.channels?.sourceCheckVersion ? draft.channels : undefined
  const findings = checkedChannels?.findings ?? []
  const basis = checkedChannels?.basis
  const note = basis ? basisNotes[basis] : '이 초안에는 확인된 웹 출처가 표시되지 않아요.'
  const [status, setStatus] = useState<{ channel: keyof PromotionChannelCopy; caption: string; message: string }>()
  const weather = draft.weatherContext

  async function copy(channel: keyof PromotionChannelCopy) {
    const caption = captions[channel]
    try {
      await navigator.clipboard.writeText(caption)
      setStatus({ channel, caption, message: '문구를 복사했어요.' })
    } catch {
      setStatus({ channel, caption, message: '문구를 선택해 직접 복사해 주세요.' })
    }
  }

  return <div className="promotion-previews">
    {draft.reviewSelection ? <div className="promotion-review-applied">
      <strong>사장님이 고른 홍보 포인트</strong>
      <ul>{draft.reviewSelection.points.map(point => <li key={point.id}>{point.sentence}</li>)}</ul>
      <PromotionReviewSources sources={draft.reviewSelection.sources} />
    </div> : <p className="muted promotion-preview-note">{note}</p>}
    {weather && <p className="muted promotion-preview-note">
      게시일 {weather.date} · {weather.area} · {weather.season}
      {weather.forecast ? <> · {weather.forecast}
        {weather.sourceUrl && <> · <a href={weather.sourceUrl} target="_blank" rel="noopener noreferrer">Open-Meteo 예보 출처</a></>}</>
        : ' · 게시일 예보 없이 계절만 반영'}
    </p>}
    <div className="promotion-preview-grid">
      {promotionChannels.map(({ id, label, placement }) => {
        const instagram = id === 'instagram'
        const text = promotionCaptionBody(captions[id], offer)
        const firstBreak = text.indexOf('\n')
        const hasTitle = !instagram && firstBreak > 0 && firstBreak <= 65
        const title = hasTitle ? text.slice(0, firstBreak).replace(/^\[(.*)\]$/, '$1') : draft.headline
        const body = hasTitle ? text.slice(firstBreak + 1).trimStart() : text
        const photo = instagram ? instagramImage ?? generatedImage : generatedImage
        const showOffer = Boolean(offer && captions[id] !== text)
        const image = photo ? <img className="promotion-post-photo" src={photo} alt={`${draft.headline} 홍보 이미지`} />
          : <div className="promotion-post-photo promotion-post-no-photo">
              {imageFailed ? '홍보 이미지를 불러오지 못했어요.' : '홍보 이미지를 준비하고 있어요…'}
            </div>
        return <article className={`promotion-post promotion-post-${id}`} key={id} aria-label={`${label} 홍보 초안`}>
          <header className="promotion-post-header">
            <h3>{label}</h3><span>{placement}</span>
          </header>
          <div className="promotion-post-byline">
            <span className="promotion-post-avatar" aria-hidden="true">{draft.storeName.slice(0, 1)}</span>
            <strong>{instagram && instagramUsername ? `@${instagramUsername}` : draft.storeName}</strong>
          </div>
          {instagram && image}
          <div className="promotion-post-text">
            {!instagram && <h4>{title}</h4>}
            {id === 'naver' && image}
            <p>{body}</p>
            {showOffer && <p className="promotion-post-offer">{offer}</p>}
          </div>
          {id === 'daangn' && image}
          <footer className="promotion-post-footer">
            {!instagram && !manualPublishing && <p className="promotion-post-mode">초안 준비 완료 · 직접 게시</p>}
            <div className="promo-actions">
              <button type="button" className="button secondary small" aria-label={`${label} 문구 복사`}
                onClick={() => void copy(id)}>문구 복사</button>
              {photo ? <a className="button secondary small" aria-label={`${label} 이미지 저장`} href={photo}
                download={`가게짝꿍-${label}-홍보물.jpg`}>이미지 저장</a>
                : <button type="button" className="button secondary small" disabled>이미지 저장</button>}
              {!instagram && <a className="button secondary small" aria-label={`${label} 채널 열기`}
                href={channelLinks[id]} target="_blank" rel="noopener noreferrer">채널 열기 <span aria-hidden="true">↗</span></a>}
            </div>
            {status?.channel === id && status.caption === captions[id] && <small role="status">{status.message}</small>}
            {instagram && instagramPublishing}
            {manualPublishing?.(id)}
          </footer>
        </article>
      })}
    </div>
    {findings.length > 0 && <details className="promotion-channel-research">
      <summary>초안에 참고한 매장 정보와 출처</summary>
      <ul>{findings.map(({ kind, text, url }) => <li key={`${url}:${text}`}>
        {text} · <a href={url} target="_blank" rel="noopener noreferrer">출처 보기</a>
        {kind === 'HOURS' && <small className="muted">게시 전에 주문 가능한 시간을 확인해 주세요.</small>}
      </li>)}</ul>
    </details>}
  </div>
}
