import { useEffect, useState } from 'react'
import { fetchPromotionReviewPoints } from '../api/shop'
import type { PromotionReviewResearch, PromotionReviewSource } from '../data/shop'

export type PromotionReviews = {
  subject?: string
  result?: PromotionReviewResearch
  error?: string
  retry: () => void
}

export type PromotionReviewSearch = { subject: string }

export function usePromotionReviews(auth: string, planId?: string, search?: PromotionReviewSearch): PromotionReviews {
  const [retryFor, setRetryFor] = useState<{ search: PromotionReviewSearch; attempt: number }>()
  const attempt = retryFor && retryFor.search === search ? retryFor.attempt : 0
  const [loaded, setLoaded] = useState<{
    planId: string
    search: PromotionReviewSearch
    attempt: number
    result?: PromotionReviewResearch
    error?: string
  }>()
  useEffect(() => {
    if (!auth || !planId || !search) return
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      const key = { planId, search, attempt }
      try {
        const result = await fetchPromotionReviewPoints(auth, planId, search.subject, controller.signal, attempt > 0)
        if (!controller.signal.aborted) setLoaded({ ...key, result })
      } catch (error) {
        if (!controller.signal.aborted) setLoaded({ ...key, error: error instanceof Error ? error.message : '공개 후기를 불러오지 못했어요.' })
      }
    }, 350)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [auth, planId, search, attempt])
  const current = loaded && loaded.planId === planId && loaded.search === search && loaded.attempt === attempt ? loaded : undefined
  return {
    subject: search?.subject,
    result: current?.result,
    error: current?.error,
    retry: () => { if (search) setRetryFor({ search, attempt: attempt + 1 }) },
  }
}

export function PromotionReviewSources({ sources }: { sources: PromotionReviewSource[] }) {
  return <details className="promotion-channel-research">
    <summary>확인한 공개 후기 {sources.length}개 · 출처 보기</summary>
    <ul>{sources.map(source => <li key={source.id}>
      <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a> · {source.dateLabel}
    </li>)}</ul>
  </details>
}

export function PromotionReviewPoints({ reviews, selected, onToggle }: {
  reviews: PromotionReviews
  selected: string[]
  onToggle: (point: string) => void
}) {
  const { subject, result, error, retry } = reviews
  if (!subject) return null
  return <section className="promotion-review-points" aria-label="공개 후기에서 찾은 포인트">
    {result && <h3>‘{subject}’ 공개 후기에서 찾은 포인트</h3>}
    {!result && !error && <p role="status" className="promotion-review-loading">
      <span aria-hidden="true" />
      ‘{subject}’ 공개 후기를 찾아보고 있어요…
    </p>}
    {error && <div>
      <p role="status">{error}</p>
      <button className="button secondary small" type="button" onClick={retry}>후기 다시 찾기</button>
    </div>}
    {result && <>
      <div className="promo-actions">
        <PromotionReviewSources sources={result.sources} />
        <button className="button secondary small" type="button" onClick={retry}>후기 다시 찾기</button>
      </div>
      {result.points.length ? <>
        <p className="muted">{result.referenceDate ? `${result.referenceDate} 기준 최근 180일 후기에서 찾았어요.` : '최근 180일 후기에서 찾았어요.'} 우리 가게 홍보글에 담고 싶은 문장을 골라 주세요. 여러 개 선택할 수 있어요.</p>
        <div className="promotion-review-options">
          {result.points.map(point => <label key={point.id} className="promotion-review-option">
            <input type="checkbox" checked={selected.includes(point.id)} onChange={() => onToggle(point.id)} />
            <span>{point.sentence}</span>
          </label>)}
        </div>
      </> : <p className="muted">{result.referenceDate ? `${result.referenceDate} 기준 최근 180일 동안 ` : ''}이 메뉴에 쓸 만한 후기 포인트를 찾지 못했어요. 저장한 매장 정보와 사진으로도 초안을 만들 수 있어요.</p>}
    </>}
  </section>
}
