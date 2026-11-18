import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { listStoreAnalyses, listStores } from '../api/shop'
import type { Store, StoreAnalysisSummary } from '../api/shop'
import { PageTitle } from '../components/ui'
import { seoulDate } from '../data/promotionArchive'
import { monthLabel } from '../data/shop'
import '../styles/execution-plans.css'

type PlanRow = StoreAnalysisSummary['plans'][number] & {
  store: Store; analysis: Omit<StoreAnalysisSummary, 'plans'>
}
type Listing = { stores: Store[]; plans: PlanRow[]; failures: string[] }

export function ExecutionPlans({ auth }: { auth: string }) {
  const [listing, setListing] = useState<Listing>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [storeId, setStoreId] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    setListing(undefined)
    setError('')
    listStores(auth, controller.signal).then(async stores => {
      const results = await Promise.allSettled(stores.map(store => listStoreAnalyses(auth, store.id, controller.signal)))
      if (controller.signal.aborted) return
      const plans: PlanRow[] = [], failures: string[] = []
      results.forEach((result, index) => {
        const store = stores[index]
        if (result.status === 'fulfilled') {
          for (const { plans: savedPlans, ...analysis } of result.value) {
            plans.push(...savedPlans.map(plan => ({ ...plan, store, analysis })))
          }
        } else failures.push(`${store.name}: ${result.reason instanceof Error ? result.reason.message : '계획을 불러오지 못했어요.'}`)
      })
      setListing({ stores, plans, failures })
    }).catch((failure: Error) => { if (!controller.signal.aborted) setError(failure.message) })
    return () => controller.abort()
  }, [auth, retry])

  const today = seoulDate()
  const status = (plan: PlanRow) => today < plan.startDate ? '예정' : today > plan.endDate ? '기간 종료' : '진행 중'
  const priority = (plan: PlanRow) => status(plan) === '진행 중' ? 0 : status(plan) === '예정' ? 1 : 2
  const plans = listing?.plans.filter(plan => !storeId || plan.store.id === storeId)
    .sort((a, b) => priority(a) - priority(b) || b.startDate.localeCompare(a.startDate)
      || b.analysis.createdAt.localeCompare(a.analysis.createdAt))

  return <section className="execution-plans-page">
    <PageTitle title="실행 관리" detail="저장한 계획을 열어 실행 내용을 이어서 확인하세요." />
    <p className="muted">{today} 기준으로 진행 상태를 표시해요. 기간이 끝난 계획도 실행 관리와 결과 확인에서 다시 열 수 있어요.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {(error || !!listing?.failures.length) && <>
      {listing?.failures.map(message => <p className="error" role="alert" key={message}>{message}</p>)}
      <button type="button" className="button secondary" onClick={() => setRetry(n => n + 1)}>계획 목록 다시 불러오기</button>
    </>}
    {!listing && !error && <p role="status">저장한 실행 계획을 불러오는 중이에요.</p>}
    {listing && <>
      {listing.stores.length > 1 && <label className="execution-plans-filter">매장 선택<select value={storeId} onChange={e => setStoreId(e.target.value)}>
        <option value="">전체 매장</option>{listing.stores.map(store => <option key={store.id} value={store.id}>{store.name} · {store.areaName}</option>)}
      </select></label>}
      {!!plans?.length && <ul className="execution-plans-list">{plans.map(plan => {
        const query = new URLSearchParams({ id: plan.id, analysisId: plan.analysis.id })
        return <li key={plan.id} className="receipt">
          <div className="section-top"><strong>{plan.store.name}</strong><span className="badge">{status(plan)}</span></div>
          <h2>{plan.title || '저장한 실행 계획'}</h2>
          <p>{plan.startDate} ~ {plan.endDate}</p>
          <p className="muted">{plan.analysis.name || '저장한 매출 분석'} · {monthLabel(plan.analysis.beforeMonth)} → {monthLabel(plan.analysis.afterMonth)}</p>
          <div className="execution-plans-actions">
            <Link className="button primary" to={'/execution?' + query}>실행 관리 열기</Link>
            <Link className="button secondary" to={'/results?' + query}>결과 확인</Link>
          </div>
        </li>
      })}</ul>}
      {!plans?.length && !listing.failures.length && <section className="empty-state compact">
        <h2>아직 저장한 실행 계획이 없어요.</h2>
        <p>대응 전략에서 계획을 선택하면 이 목록에 표시돼요.</p>
        <Link className="button primary" to="/strategy">대응 전략 보기</Link>
      </section>}
    </>}
  </section>
}
