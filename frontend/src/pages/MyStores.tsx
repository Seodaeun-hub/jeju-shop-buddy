import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { deleteAnalysis, deleteExecutionPlan, listStoreAnalyses, listStores } from '../api/shop'
import type { Store, StoreAnalysisSummary } from '../api/shop'
import { monthLabel } from '../data/shop'
import { notifyResultsDataChanged } from '../data/promotionArchive'
import { PageTitle } from '../components/ui'
import { useStoreSelection } from '../components/useStoreSelection'
import { MenuPhotos } from './MenuPhotos'
import { StoreQrMenu } from './StoreQrMenu'
import { MenuCosts } from './MenuCosts'
import { BreakEven } from './BreakEven'
import { StorePosFiles } from './StorePosFiles'
import { StorePromotionTone } from './StorePromotionTone'
import '../styles/my-stores.css'

const storeSections = [
  { id: 'history', label: '분석 이력' },
  { id: 'photos', label: '메뉴 사진 관리' },
  { id: 'menu-costs', label: '메뉴 원가·마진' },
  { id: 'qr-menu', label: '다국어 QR 메뉴판' },
  { id: 'break-even', label: '손익분기점' },
  { id: 'tone', label: '홍보 말투 설정' },
  { id: 'pos-files', label: 'POS 파일 관리' },
] as const

const storeRegistrationDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  dateStyle: 'short',
  timeStyle: 'medium',
})

function storeOptionLabel(store: Store) {
  return `${store.name} · ${store.areaName} · 메뉴 ${store.menuCount}개`
}

function StoreHistory({ auth, store, onAnalysisDeleted, onPlanDeleted }: {
  auth: string; store: Store; onAnalysisDeleted: (id: string) => void; onPlanDeleted: (id: string) => void
}) {
  const [history, setHistory] = useState<StoreAnalysisSummary[]>()
  const [deleting, setDeleting] = useState<string>()
  const [deleteError, setDeleteError] = useState('')
  const [deleteMessage, setDeleteMessage] = useState('')
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

  async function removeAnalysis(analysis: StoreAnalysisSummary) {
    const label = analysis.name || `${monthLabel(analysis.beforeMonth)} → ${monthLabel(analysis.afterMonth)}`
    const linked = analysis.plans.length
      ? ` 연결된 실행 계획 ${analysis.plans.length}개와 점검표·결과도 함께 삭제돼요. 이미 게시된 인스타그램 게시물은 인스타그램에 남아요.`
      : ''
    if (!window.confirm(`‘${label}’ 분석을 삭제할까요?${linked} 삭제한 분석은 되돌릴 수 없어요.`)) return
    setDeleting(analysis.id)
    setDeleteError('')
    setDeleteMessage('')
    try {
      await deleteAnalysis(auth, analysis.id)
      setHistory(items => items?.filter(item => item.id !== analysis.id))
      onAnalysisDeleted(analysis.id)
      notifyResultsDataChanged()
      setDeleteMessage('분석을 삭제했어요.')
    } catch (failure) {
      setDeleteError(failure instanceof Error ? failure.message : '분석을 삭제하지 못했어요.')
    } finally {
      setDeleting(undefined)
    }
  }

  async function removePlan(analysisId: string, plan: StoreAnalysisSummary['plans'][number]) {
    const label = plan.title || '실행 계획'
    if (!window.confirm(`‘${label}’ (${plan.startDate} ~ ${plan.endDate}) 계획을 삭제할까요? 연결된 점검표와 실행 결과도 함께 삭제돼요. 이미 게시된 인스타그램 게시물은 인스타그램에 남아요.`)) return
    setDeleting(plan.id)
    setDeleteError('')
    setDeleteMessage('')
    try {
      await deleteExecutionPlan(auth, plan.id)
      setHistory(items => items?.map(item => item.id === analysisId
        ? { ...item, plans: item.plans.filter(value => value.id !== plan.id) } : item))
      onPlanDeleted(plan.id)
      notifyResultsDataChanged()
      setDeleteMessage(`‘${label}’ 계획을 삭제했어요.`)
    } catch (failure) {
      setDeleteError(failure instanceof Error ? failure.message : '실행 계획을 삭제하지 못했어요.')
    } finally {
      setDeleting(undefined)
    }
  }

  return <section className="form-stack" aria-labelledby="analysis-history">
    <div className="section-top ruled">
      <h2 id="analysis-history">분석 이력</h2>
      <Link className="button primary" to={'/sales?' + new URLSearchParams({ storeId: store.id })}>새 POS 올리기</Link>
    </div>
    {deleteError && <p role="alert" className="error">{deleteError}</p>}
    {deleteMessage && <p role="status">{deleteMessage}</p>}
    {error ? <div role="alert" className="error">{error} <button type="button" className="text-button" onClick={() => {
      setError('')
      setRetry((value) => value + 1)
    }}>다시 불러오기</button></div>
      : !history ? <p role="status">매장의 분석 이력을 불러오는 중이에요.</p>
        : history.length === 0 ? <p>아직 저장한 분석이 없어요. POS 파일을 올려 첫 분석을 시작해 보세요.</p>
          : history.map((analysis) => <details className="receipt analysis-history-entry" name="store-analysis-history" key={analysis.id}>
            <summary className="analysis-history-summary">
              <span className="analysis-history-meta">
                <strong>{analysis.name || '이름 없는 분석'}</strong>
                <span className="muted">
                  <span>{monthLabel(analysis.beforeMonth)} → {monthLabel(analysis.afterMonth)}</span>
                  <time dateTime={analysis.createdAt}>저장일 · {new Date(analysis.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}</time>
                </span>
              </span>
              <span className="muted analysis-history-count">실행 계획 {analysis.plans.length}개</span>
            </summary>
            <div className="form-stack analysis-history-body">
              <div className="actions">
                <Link className="button secondary small" to={'/analysis?' + new URLSearchParams({ id: analysis.id })}>매출 분석 열기</Link>
                <button type="button" className="text-button" disabled={Boolean(deleting)}
                  onClick={() => void removeAnalysis(analysis)}>{deleting === analysis.id ? '삭제 중…' : '분석 삭제'}</button>
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
                        <button type="button" className="text-button" disabled={Boolean(deleting)}
                          onClick={() => void removePlan(analysis.id, plan)}>{deleting === plan.id ? '삭제 중…' : '실행 계획 삭제'}</button>
                      </div>
                    </div>
                  </li>
                })}
              </ul>}
            </div>
          </details>)}
  </section>
}

export function MyStores({ auth, ownerEmail, onAnalysisDeleted, onPlanDeleted }: {
  auth: string
  ownerEmail: string
  onAnalysisDeleted: (id: string) => void
  onPlanDeleted: (id: string) => void
}) {
  const [params, setParams] = useSearchParams()
  const [stores, setStores] = useState<Store[]>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const selected = useStoreSelection(ownerEmail, stores, params.get('storeId'), true)
  const section = storeSections.find(item => item.id === params.get('section'))?.id ?? 'history'
  const resultPlanId = params.get('resultPlanId')
  const resultAnalysisId = params.get('resultAnalysisId')
  const inventoryPlanId = params.get('inventoryPlanId')
  const inventoryAnalysisId = params.get('inventoryAnalysisId')
  const inventoryDate = params.get('inventoryDate')
  const inventoryProduct = params.get('inventoryProduct')
  const upload = params.get('focus') === 'upload' ? {
    missingStart: params.get('missingStart'),
    resultTo: resultPlanId && resultAnalysisId
      ? '/results?' + new URLSearchParams({ id: resultPlanId, analysisId: resultAnalysisId })
      : undefined,
    inventoryTo: inventoryPlanId && inventoryAnalysisId && inventoryDate && inventoryProduct
      ? '/execution?' + new URLSearchParams({
        id: inventoryPlanId, analysisId: inventoryAnalysisId, inventoryDate, inventoryProduct,
      })
      : undefined,
  } : undefined

  function storeQuery(storeId: string, activeSection: typeof section) {
    const query = new URLSearchParams({ storeId })
    if (activeSection !== 'history') query.set('section', activeSection)
    return query
  }

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
    <PageTitle title="내 매장" />
    <div className="form-stack my-stores">
      <div className="store-picker">
        {stores?.length ? <label>매장 선택<select value={selected?.id ?? ''} onChange={event => setParams(storeQuery(event.target.value, section))}>
          {!selected && <option value="" disabled>매장을 선택해 주세요</option>}
          {stores.map(store => {
            const label = storeOptionLabel(store)
            const duplicate = stores.some(other => other.id !== store.id && storeOptionLabel(other) === label)
            return <option key={store.id} value={store.id}>
              {duplicate ? `${label} · 등록 ${storeRegistrationDate.format(new Date(store.createdAt))}` : label}
            </option>
          })}
        </select></label> : <h2>등록한 매장</h2>}
        <Link className="button secondary" to="/stores/new">새 매장 등록</Link>
      </div>
      {error ? <div role="alert" className="error">{error} <button type="button" className="text-button" onClick={() => {
        setError('')
        setRetry((value) => value + 1)
      }}>다시 불러오기</button></div>
        : !stores ? <p role="status">매장을 불러오는 중이에요.</p>
          : stores.length === 0 && <p>등록한 매장이 없어요. 새 매장을 등록해 주세요.</p>}
      {selected && <>
        <p className="muted store-address">{selected.address}</p>
        <nav className="store-sections" aria-label="선택한 매장 관리">
          {storeSections.map(({ id, label }) => <Link key={id} to={'?' + storeQuery(selected.id, id)}
            preventScrollReset aria-current={section === id ? 'page' : undefined}>{label}</Link>)}
        </nav>
        {section === 'history' && <StoreHistory key={selected.id} auth={auth} store={selected}
          onAnalysisDeleted={onAnalysisDeleted} onPlanDeleted={onPlanDeleted} />}
        {section === 'pos-files' && <StorePosFiles key={selected.id + ':' + params}
          auth={auth} storeId={selected.id} storeName={selected.name}
          initialDate={params.get('date')} initialKind={params.get('kind')} uploadRequest={upload} />}
        {section === 'photos' && <MenuPhotos key={selected.id} auth={auth} storeId={selected.id} />}
        {section === 'qr-menu' && <StoreQrMenu key={selected.id} auth={auth} storeId={selected.id} />}
        {section === 'menu-costs' && <MenuCosts key={selected.id} auth={auth} storeId={selected.id} />}
        {section === 'break-even' && <BreakEven key={selected.id} auth={auth} storeId={selected.id} />}
        {section === 'tone' && <section className="store-tone-panel" aria-label="홍보 말투 설정">
          <StorePromotionTone key={selected.id} auth={auth} storeId={selected.id} />
        </section>}
      </>}
    </div>
  </>
}
