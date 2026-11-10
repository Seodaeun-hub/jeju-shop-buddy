import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { listStoreAnalyses, listStores } from '../api/shop'
import type { Store, StoreAnalysisSummary } from '../api/shop'
import { monthLabel } from '../data/shop'
import { PageTitle } from '../components/ui'
import { MenuPhotos } from './MenuPhotos'

function StoreHistory({ auth, store }: { auth: string; store: Store }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [history, setHistory] = useState<StoreAnalysisSummary[]>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listStoreAnalyses(auth, store.id, controller.signal).then((value) => {
      if (!controller.signal.aborted) setHistory(value)
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => controller.abort()
  }, [auth, store.id, retry])

  return <section className="form-stack" aria-labelledby="analysis-history">
    <div className="section-top ruled">
      <div><h2 id="analysis-history">{store.name} 분석 이력</h2><p className="muted">{store.areaName} · {store.address}</p></div>
      <div className="actions">
        <button type="button" className="button secondary" aria-expanded={menuOpen}
          onClick={() => setMenuOpen(!menuOpen)}>메뉴 사진 관리</button>
        <Link className="button primary" to={'/sales?' + new URLSearchParams({ storeId: store.id })}>새 POS 올리기</Link>
      </div>
    </div>
    {menuOpen && <MenuPhotos auth={auth} storeId={store.id} />}
    {error ? <div role="alert" className="error">{error} <button type="button" className="text-button" onClick={() => {
      setError('')
      setRetry((value) => value + 1)
    }}>다시 불러오기</button></div>
      : !history ? <p role="status">매장의 분석 이력을 불러오는 중이에요.</p>
        : history.length === 0 ? <p>아직 저장한 분석이 없어요. POS 파일을 올려 첫 분석을 시작해 보세요.</p>
          : history.map((analysis) => <article className="receipt form-stack" key={analysis.id}>
            <div className="section-top">
              <div>
                <h3>{monthLabel(analysis.beforeMonth)} → {monthLabel(analysis.afterMonth)}</h3>
                <small className="muted">저장일 · {new Date(analysis.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}</small>
              </div>
              <Link className="button secondary small" to={'/analysis?' + new URLSearchParams({ id: analysis.id })}>매출 분석 열기</Link>
            </div>
            {analysis.concern && <p>{analysis.concern}</p>}
            {!analysis.plans.length ? <p className="muted">저장된 실행 계획이 없어요.</p> : <ul className="form-stack">
              {analysis.plans.map((plan) => {
                const query = new URLSearchParams({ id: plan.id, analysisId: analysis.id })
                return <li key={plan.id} className="ruled-block">
                  <div className="section-top">
                    <div><strong>{plan.title || '실행 계획'}</strong><p className="muted">{plan.startDate} ~ {plan.endDate}</p></div>
                    <div className="actions">
                      <Link className="button secondary small" to={'/execution?' + query}>실행 계획 열기</Link>
                      {plan.hasResult ? <Link className="button secondary small" to={'/results?' + query}>실행 결과 열기</Link>
                        : <span className="muted">저장된 결과 없음</span>}
                    </div>
                  </div>
                </li>
              })}
            </ul>}
          </article>)}
  </section>
}

export function MyStores({ auth }: { auth: string }) {
  const [params, setParams] = useSearchParams()
  const [stores, setStores] = useState<Store[]>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const selectedId = params.get('storeId') ?? stores?.[0]?.id
  const selected = stores?.find(({ id }) => id === selectedId)

  useEffect(() => {
    const controller = new AbortController()
    listStores(auth, controller.signal).then((value) => {
      if (!controller.signal.aborted) setStores(value)
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => controller.abort()
  }, [auth, retry])

  return <>
    <PageTitle title="내 매장" detail="매장을 선택하면 지난 매출 분석과 실행 계획을 다시 볼 수 있어요." />
    <div className="form-stack">
      <div className="section-top ruled">
        <h2>등록한 매장</h2>
        <Link className="button secondary" to="/sales">새 매장 등록</Link>
      </div>
      {error ? <div role="alert" className="error">{error} <button type="button" className="text-button" onClick={() => {
        setError('')
        setRetry((value) => value + 1)
      }}>다시 불러오기</button></div>
        : !stores ? <p role="status">매장을 불러오는 중이에요.</p>
          : stores.length === 0 ? <p>등록한 매장이 없어요. 새 매장을 등록해 주세요.</p>
            : <label>매장 선택<select value={selected?.id ?? ''} onChange={(event) => setParams({ storeId: event.target.value })}>
              {!selected && <option value="" disabled>매장을 선택해 주세요</option>}
              {stores.map((store) => <option key={store.id} value={store.id}>{store.name} · {store.areaName}</option>)}
            </select></label>}
      {selected && <StoreHistory key={selected.id} auth={auth} store={selected} />}
    </div>
  </>
}
