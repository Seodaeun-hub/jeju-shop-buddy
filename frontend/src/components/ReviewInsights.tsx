import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { addReview, createReviewPlan, fetchReviewInsight, toPlan } from '../api/shop'
import type { ReviewInsight } from '../api/shop'
import { addDays } from '../data/shop'
import type { Plan } from '../data/shop'
import { findAfternoonOrderComplaints, incomingExampleReview } from '../data/reviews'
import type { Review } from '../data/reviews'

export function ReviewInsights({ store, reviews, onReviews, onPlan }: {
  store: string
  reviews: Review[]
  onReviews: (reviews: Review[]) => void
  onPlan: (plan: Plan) => void
}) {
  const [confirmed, setConfirmed] = useState(false)
  const received = reviews.some(({ id }) => id === incomingExampleReview.id)
  const complaints = findAfternoonOrderComplaints(reviews)
  const repeated = complaints.length >= 2

  function makePlan() {
    if (!confirmed || !repeated) return
    const startDate = addDays(incomingExampleReview.date, 1)
    onPlan({
      strategy: 'outreach',
      title: '오후 식사 주문 안내 개선',
      store,
      demo: true,
      duration: '1주',
      startDate,
      endDate: addDays(startDate, 6),
      budget: 0,
      channel: '매장 안내',
      reviewAction: true,
      followUp: '같은 요일·오후 2~5시의 하루 평균 결제 건수를 비교해요.',
      tasks: [
        { date: startDate, label: '오후에 주문받는 시간과 메뉴 확인하기' },
        { date: addDays(startDate, 1), label: '안내 문구 확인하기' },
        { date: addDays(startDate, 2), label: '매장 입구와 지도에 주문 안내 추가하기' },
        { date: addDays(startDate, 6), label: '오후 2~5시 결제 건수 확인하기' },
      ],
      done: [],
    })
  }

  return <section className="ruled-block dashboard-reviews" aria-labelledby="review-heading">
    <div className="section-top">
      <h2 id="review-heading">손님 리뷰에서 찾은 불편</h2>
      <span className="badge">가상 리뷰</span>
    </div>
    <p className="muted">애월 가상 한식당 · 2021년 4~5월</p>
    <button type="button" className="button secondary small" disabled={received}
      onClick={() => onReviews([...reviews, incomingExampleReview])}>
      {received ? '새 리뷰 1건 받았어요' : '새 리뷰 받아보기 (시연)'}
    </button>
    <p className="review-count" role="status">
      {reviews.length}건 중 <strong>{complaints.length}건</strong>에서 오후 식사 주문 안내가 헷갈렸다는 의견이 나왔어요.
    </p>
    {received && <p className="review-latest"><strong>방금 받은 리뷰</strong> “{incomingExampleReview.text}”</p>}
    <details>
      <summary>해당 의견 {complaints.length}건 보기</summary>
      <ul className="review-evidence">{complaints.map((review) => <li key={review.id}>
        <time dateTime={review.date}>{review.date}</time><span>{review.text}</span>
      </li>)}</ul>
    </details>
    {repeated && <div className="review-action">
      <h3>오후 식사 주문이 가능하다면 안내를 추가해보세요</h3>
      <p>가게 입구와 지도에 실제 주문 가능 시간과 메뉴를 적어요. 이 의견은 확인할 단서예요.</p>
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> 오후 2~5시에도 식사 주문을 받아요.</label>
      <button type="button" className="button secondary small" disabled={!confirmed} onClick={makePlan}>안내 개선 계획 만들기 →</button>
    </div>}
  </section>
}

export function SavedReviewInsights({ auth, analysisId, store, onPlan }: {
  auth: string
  analysisId: string
  store: string
  onPlan: (plan: Plan) => void
}) {
  const [insight, setInsight] = useState<ReviewInsight>()
  const [date, setDate] = useState(() => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format())
  const [text, setText] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState<'review' | 'plan'>()
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchReviewInsight(auth, analysisId, controller.signal).then((value) => {
      if (!controller.signal.aborted) setInsight(value)
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setLoadError(error.message)
    })
    return () => controller.abort()
  }, [auth, analysisId, refresh])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending || !text.trim()) return
    setPending('review')
    setError('')
    try {
      await addReview(auth, analysisId, date, text.trim())
      setText('')
      setInsight(undefined)
      setLoadError('')
      setRefresh((value) => value + 1)
    } catch (error) {
      setError(error instanceof Error ? error.message : '리뷰를 저장할 수 없어요.')
    } finally {
      setPending(undefined)
    }
  }

  async function makePlan() {
    if (pending || !confirmed || !insight?.repeated) return
    setPending('plan')
    setError('')
    try {
      const plan = await createReviewPlan(auth, analysisId)
      onPlan(toPlan(plan, store))
    } catch (error) {
      setError(error instanceof Error ? error.message : '개선 계획을 저장할 수 없어요.')
    } finally {
      setPending(undefined)
    }
  }

  return <section className="ruled-block dashboard-reviews" aria-labelledby="review-heading">
    <div className="section-top"><h2 id="review-heading">손님 리뷰에서 찾은 불편</h2></div>
    <form className="form-stack" onSubmit={save}>
      <label>리뷰 날짜<input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
      <label>리뷰 내용<textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} required /></label>
      <button type="submit" className="button secondary small fit" disabled={!!pending || !text.trim()}>
        {pending === 'review' ? '리뷰 저장 중…' : '리뷰 추가하기'}
      </button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
    {insight ? <>
      <p className="review-count" role="status">
        등록된 리뷰 {insight.total}건 중 <strong>{insight.evidence.length}건</strong>에서 오후 주문 안내가 헷갈렸다는 의견이 나왔어요.
      </p>
      {insight.evidence.length > 0 && <details>
        <summary>해당 의견 {insight.evidence.length}건 보기</summary>
        <ul className="review-evidence">{insight.evidence.map((review) => <li key={review.id}>
          <time dateTime={review.date}>{review.date}</time><span>{review.text}</span>
        </li>)}</ul>
      </details>}
      {insight.repeated && <div className="review-action">
        <h3>오후 식사 주문이 가능하다면 안내를 추가해보세요</h3>
        <p>매장 입구와 지도에 실제 주문 가능 시간과 메뉴를 적어요.</p>
        <label><input type="checkbox" checked={confirmed} disabled={!!pending} onChange={(event) => setConfirmed(event.target.checked)} /> 오후 2~5시에도 식사 주문을 받아요.</label>
        <button type="button" className="button secondary small" disabled={!confirmed || !!pending} onClick={() => void makePlan()}>
          {pending === 'plan' ? '개선 계획 저장 중…' : '안내 개선 계획 만들기'}
        </button>
      </div>}
    </> : loadError ? <div>
      <p className="error" role="alert">{loadError}</p>
      <button type="button" className="button secondary small" onClick={() => {
        setLoadError('')
        setRefresh((value) => value + 1)
      }}>리뷰 다시 불러오기</button>
    </div> : <p className="muted" role="status">리뷰를 불러오는 중이에요.</p>}
  </section>
}
