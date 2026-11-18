import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { deleteAnalysis, deleteExecutionPlan, deleteStore, listStoreAnalyses, listStores } from '../api/shop'
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
  { id: 'menu-costs', label: '메뉴 재료·원가' },
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

function DeleteStoreDialog({ auth, store, onClose, onDeleted }: {
  auth: string; store: Store; onClose: () => void; onDeleted: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  async function confirmDelete() {
    if (deleting) return
    setDeleting(true)
    setError('')
    try {
      await deleteStore(auth, store.id)
      onDeleted()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '매장을 삭제하지 못했어요.')
      setDeleting(false)
    }
  }

  return <dialog ref={dialog} className="store-delete-dialog" aria-labelledby="store-delete-title"
    aria-describedby="store-delete-description"
    onCancel={event => { event.preventDefault(); if (!deleting) onClose() }}>
    <div className="form-stack">
      <h2 id="store-delete-title">매장을 삭제할까요?</h2>
      <div className="store-delete-target"><strong>{store.name}</strong><p>{store.address}</p></div>
      <div id="store-delete-description">
        <p>이 매장의 자료가 함께 삭제되며 복구할 수 없어요.</p>
        <ul>
          <li>POS 파일, 매출 분석, 질문 이력과 리뷰</li>
          <li>실행 계획, 발주·홍보 자료와 실행 결과</li>
          <li>메뉴 사진, 원가·재고 설정과 공개 QR 메뉴판</li>
        </ul>
        <p>공개한 QR 주소는 더 이상 열리지 않아요. 이미 SNS에 게시한 홍보물은 해당 서비스에 남아요.</p>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="actions end">
        <button type="button" className="button secondary" autoFocus disabled={deleting} onClick={onClose}>취소</button>
        <button type="button" className="button store-delete-confirm" disabled={deleting}
          onClick={() => void confirmDelete()}>{deleting ? '삭제 중…' : '매장과 자료 삭제'}</button>
      </div>
    </div>
  </dialog>
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

export function MyStores({ auth, ownerEmail, onAnalysisDeleted, onPlanDeleted, onStoreDeleted }: {
  auth: string
  ownerEmail: string
  onAnalysisDeleted: (id: string) => void
  onPlanDeleted: (id: string) => void
  onStoreDeleted: (id: string) => void
}) {
  const [params, setParams] = useSearchParams()
  const [stores, setStores] = useState<Store[]>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [deleteTarget, setDeleteTarget] = useState<Store>()
  const [deleteMessage, setDeleteMessage] = useState('')
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

  function storeDeleted(store: Store) {
    const remaining = stores?.filter(item => item.id !== store.id) ?? []
    setStores(remaining)
    setDeleteTarget(undefined)
    setDeleteMessage(`‘${store.name}’ 매장과 연결된 자료를 삭제했어요.`)
    const selectionKey = 'shop-buddy:selected-store:' + ownerEmail
    if (localStorage.getItem(selectionKey) === store.id) localStorage.removeItem(selectionKey)
    if (sessionStorage.getItem(selectionKey) === store.id) sessionStorage.removeItem(selectionKey)
    setParams(remaining.length ? storeQuery(remaining[0].id, section) : new URLSearchParams(), { replace: true })
    onStoreDeleted(store.id)
    notifyResultsDataChanged()
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
        {selected && <button type="button" className="button secondary store-delete-button"
          onClick={() => setDeleteTarget(selected)}>매장 삭제</button>}
      </div>
      {deleteMessage && <p role="status">{deleteMessage}</p>}
      {deleteTarget && <DeleteStoreDialog auth={auth} store={deleteTarget} onClose={() => setDeleteTarget(undefined)}
        onDeleted={() => storeDeleted(deleteTarget)} />}
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
        {section === 'menu-costs' && <MenuCosts key={selected.id + ':' + (params.get('productName') ?? '')}
          auth={auth} storeId={selected.id} initialProduct={params.get('productName') ?? undefined}
          onProduct={product => setParams(current => {
            const next = new URLSearchParams(current)
            next.set('productName', product)
            if (inventoryPlanId && inventoryAnalysisId) next.set('inventoryProduct', product)
            return next
          }, { replace: true, preventScrollReset: true })}
          backTo={inventoryPlanId && inventoryAnalysisId
            ? '/execution?' + new URLSearchParams({ id: inventoryPlanId, analysisId: inventoryAnalysisId,
              ...(inventoryDate && inventoryProduct ? { inventoryDate, inventoryProduct } : {}) })
            : undefined} />}
        {section === 'break-even' && <BreakEven key={selected.id} auth={auth} storeId={selected.id} />}
        {section === 'tone' && <section className="store-tone-panel" aria-label="홍보 말투 설정">
          <StorePromotionTone key={selected.id} auth={auth} storeId={selected.id} />
        </section>}
      </>}
    </div>
  </>
}
