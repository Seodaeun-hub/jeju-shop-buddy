import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { createPromotionDraft, fetchAnalysis, fetchOwnerSession, fetchPlan, logoutOwner, ownerSession, type OwnerSession, regeneratePromotionCaption, saveInventoryReview, savePromotionReview, saveTimeSeries, toPlan, updateChecklistItem } from './api/shop'
import { Dashboard } from './pages/Dashboard'
import { AnalysisSwitcher } from './components/AnalysisSwitcher'
import { Home } from './pages/Home'
import { Account } from './pages/Account'
import { ExistingStoreIntake, Intake } from './pages/Intake'
import { MyStores } from './pages/MyStores'
import { MyPage } from './pages/MyPage'
import { Execution } from './pages/Execution'
import { Results } from './pages/Results'
import { SavedStrategyPage, Strategy } from './pages/Strategy'
import { monthLabel } from './data/shop'
import type { Analysis, InventoryItem, Plan, PromotionDraftInput, PromotionReviewInput, PromotionTone, TimeSeries } from './data/shop'
import { Citrus, PageTitle } from './components/ui'

const navigation = [
  { to: '/stores', label: '내 매장' },
  { to: '/sales', label: '매출 입력' },
  { to: '/analysis', label: '매출 분석' },
  { to: '/strategy', label: '대응 전략' },
  { to: '/execution', label: '실행 관리' },
]

function Placeholder({ children, to, action }: { children: ReactNode; to: string; action: string }) {
  return <section className="empty-state"><h1>{children}</h1><Link className="button primary" to={to}>{action} <span aria-hidden="true">→</span></Link></section>
}

export function App() {
  const [analysis, setAnalysis] = useState<Analysis>()
  const [plan, setPlan] = useState<Plan>()
  const navigate = useNavigate()
  const { pathname, search, state } = useLocation()
  const [account, setAccount] = useState<OwnerSession & { auth: string }>()
  const [sessionPending, setSessionPending] = useState(true)
  const [logoutError, setLogoutError] = useState('')
  const [lastId, setLastId] = useState<string>()
  const [loadedId, setLoadedId] = useState<string>()
  const [analysisError, setAnalysisError] = useState('')
  const [retry, setRetry] = useState(0)
  const params = new URLSearchParams(search)
  const salesStoreId = params.get('storeId')
  const planRoute = pathname === '/execution' || pathname === '/results'
  const requestedId = pathname === '/analysis' || pathname === '/strategy' ? params.get('id')
    : planRoute ? params.get('analysisId') : null
  const requestedPlanId = planRoute ? params.get('id') : null
  const [planError, setPlanError] = useState<{ id: string; message: string }>()
  const [planRetry, setPlanRetry] = useState(0)
  const analysisId = requestedId ?? lastId
  const auth = account?.auth
  const dashboardPath = (id: string) => '/analysis?' + new URLSearchParams({ id })
  const savedStrategyPath = (id: string) => '/strategy?' + new URLSearchParams({ id })
  const strategyPath = analysisId ? savedStrategyPath(analysisId) : '/strategy'
  const planPath = (route: '/execution' | '/results', value: Plan) => value.id && value.analysisId
    ? route + '?' + new URLSearchParams({ id: value.id, analysisId: value.analysisId }) : route
  const accountPage = pathname === '/login' || pathname === '/signup'
  const publicPage = accountPage || (pathname === '/' && !account)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  useEffect(() => {
    const controller = new AbortController()
    fetchOwnerSession(controller.signal).then(session => {
      if (!controller.signal.aborted) setAccount({ ...session, auth: ownerSession })
    }).catch(() => undefined).finally(() => {
      if (!controller.signal.aborted) setSessionPending(false)
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!auth || !analysisId) return
    const controller = new AbortController()
    fetchAnalysis(auth, analysisId, controller.signal).then((value) => {
      if (controller.signal.aborted) return
      setLastId(analysisId)
      setLoadedId(analysisId)
      setAnalysis(value)
      setAnalysisError('')
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setAnalysisError(error.message)
    })
    return () => controller.abort()
  }, [auth, analysisId, retry])

  function login(session: OwnerSession) {
    setAccount({ ...session, auth: ownerSession })
    const defaultDestination = pathname === '/signup' ? '/sales' : '/stores'
    navigate(typeof state?.returnTo === 'string' ? state.returnTo : defaultDestination, { replace: true })
  }

  function forgetDeletedAnalysis(id: string) {
    if (lastId !== id) return
    setLastId(undefined)
    setLoadedId(undefined)
    setAnalysis(undefined)
    setAnalysisError('')
    setPlan(undefined)
    setPlanError(undefined)
  }

  function openSavedAnalysis(id: string, destination = dashboardPath(id)) {
    setLastId(id)
    setLoadedId(undefined)
    setAnalysis(undefined)
    setAnalysisError('')
    setPlan(undefined)
    navigate(destination)
  }

  function openPlan(value: Plan) {
    setPlan(value)
    setPlanError(undefined)
    navigate(planPath('/execution', value))
  }

  async function leavePreview() {
    setLogoutError('')
    if (account) {
      try {
        await logoutOwner()
      } catch (failure) {
        setLogoutError(failure instanceof Error ? failure.message : '로그아웃하지 못했어요.')
        return
      }
    }
    setAccount(undefined)
    setPlanError(undefined)
    setLastId(undefined)
    setLoadedId(undefined)
    setAnalysisError('')
    setAnalysis(undefined)
    setPlan(undefined)
    navigate('/')
  }

  async function updateTimeSeries(value: TimeSeries) {
    if (auth && analysisId) await saveTimeSeries(auth, analysisId, value)
    setAnalysis((current) => current && { ...current, timeSeries: value })
  }

  async function savePlanInventory(items: InventoryItem[]) {
    const id = plan?.id
    if (!auth || !id) return
    const saved = await saveInventoryReview(auth, id, items)
    setPlan((current) => current?.id === id ? { ...current, inventoryItems: saved } : current)
  }

  async function savePlanPromotion(input: PromotionReviewInput) {
    const id = plan?.id
    if (!auth || !id) return
    const saved = await savePromotionReview(auth, id, input)
    setPlan((current) => current?.id === id ? {
      ...current, promotionReview: saved,
      promotionDraft: JSON.stringify(current.promotionReview) === JSON.stringify(saved) ? current.promotionDraft : undefined,
    } : current)
  }

  async function savePlanPromotionDraft(input: PromotionDraftInput) {
    const id = plan?.id
    if (!auth || !id) return
    const saved = await createPromotionDraft(auth, id, input)
    setPlan((current) => current?.id === id && current.promotionReview === input.review ? { ...current, promotionDraft: saved } : current)
  }

  async function regeneratePlanPromotionCaption(tone: PromotionTone) {
    const id = plan?.id
    if (!auth || !id) return
    const draft = await regeneratePromotionCaption(auth, id, tone)
    setPlan(current => current?.id === id && current.promotionDraft === plan.promotionDraft
      ? { ...current, promotionDraft: draft } : current)
  }

  async function toggleChecklist(index: number, completed: boolean) {
    if (!plan) return
    const planId = plan.id
    if (planId) {
      const itemId = plan.tasks[index].id
      if (!auth || !itemId) throw new Error('점검 항목을 저장할 수 없어요. 실행 계획을 다시 열어 주세요.')
      const item = await updateChecklistItem(auth, planId, itemId, completed)
      completed = item.completed
    }
    setPlan((current) => {
      if (!current || current.id !== planId) return current
      const done = current.done.filter((item) => item !== index)
      return { ...current, done: completed ? [...done, index] : done }
    })
  }

  const currentAnalysis = !analysisId || loadedId === analysisId ? analysis : undefined
  const planStore = currentAnalysis?.store
  const loadedPlanId = plan?.id
  useEffect(() => {
    if (!auth || !requestedPlanId || loadedPlanId === requestedPlanId || !planStore || !analysisId) return
    const controller = new AbortController()
    fetchPlan(auth, requestedPlanId, controller.signal).then((value) => {
      if (controller.signal.aborted) return
      if (value.analysisId !== analysisId) throw new Error('이 분석에 연결된 실행 계획을 찾을 수 없어요.')
      setPlan(toPlan(value, planStore))
    }).catch((error: Error) => {
      if (!controller.signal.aborted) setPlanError({ id: requestedPlanId, message: error.message })
    })
    return () => controller.abort()
  }, [auth, requestedPlanId, analysisId, loadedPlanId, planStore, planRetry])

  const analysisStatus = <section className="empty-state">
    {analysisError ? <><p role="alert" className="error">{analysisError}</p><button className="button secondary" onClick={() => {
      setAnalysisError('')
      setRetry((value) => value + 1)
    }}>다시 불러오기</button></> : <p role="status">저장한 매출 분석을 불러오는 중이에요.</p>}
  </section>
  const dashboardContent = analysisId && !auth
    ? <Navigate to="/login" state={{ returnTo: dashboardPath(analysisId) }} replace />
    : currentAnalysis ? <Dashboard key={analysisId ?? 'demo'} data={currentAnalysis} auth={auth} analysisId={analysisId} onSaveTimeSeries={updateTimeSeries} strategyTo={strategyPath} />
    : analysisId ? analysisStatus : <section className="empty-state"><p>저장된 분석을 선택하거나 새 매출을 입력해 주세요.</p><Link className="button primary" to="/sales">매출 입력하기 →</Link></section>
  const dashboard = <>
    <PageTitle title="매출 분석" detail={!auth && currentAnalysis
      ? `${currentAnalysis.store} · ${currentAnalysis.monthly.slice(-2).map(({ month }) => monthLabel(month)).join(' → ')} · 시연 예시`
      : undefined} />
    {auth && <AnalysisSwitcher key={account?.email} auth={auth} analysis={currentAnalysis} analysisId={analysisId} onOpen={openSavedAnalysis} />}
    {dashboardContent}
  </>

  const strategyPage = analysisId && !auth
    ? <Navigate to="/login" state={{ returnTo: pathname + search }} replace />
    : auth && analysisId && currentAnalysis
      ? <SavedStrategyPage key={analysisId} auth={auth} analysisId={analysisId} data={currentAnalysis} backTo={dashboardPath(analysisId)} onPlan={openPlan} />
      : currentAnalysis?.demo ? <Strategy data={currentAnalysis} onPlan={openPlan} />
      : analysisId ? analysisStatus : auth ? <>
        <PageTitle title="대응 전략" detail="저장한 매출 분석을 선택하면 그 분석에 맞는 전략을 볼 수 있어요." />
        <AnalysisSwitcher key={account?.email} auth={auth} onOpen={id => openSavedAnalysis(id, savedStrategyPath(id))} />
        <Link className="button secondary" to="/sales">새 매출 입력하기 <span aria-hidden="true">→</span></Link>
      </> : <Placeholder to="/sales" action="매출 입력하기">매출을 분석하면 대응 전략을 볼 수 있어요.</Placeholder>

  const planPage = requestedPlanId && !auth
    ? <Navigate to="/login" state={{ returnTo: pathname + search }} replace />
    : plan && currentAnalysis && (!requestedPlanId || requestedPlanId === plan.id) && (!plan.analysisId || plan.analysisId === analysisId)
      ? pathname === '/results'
        ? <Results key={plan.id ?? 'demo'} plan={plan} onChange={setPlan} auth={auth} executionTo={planPath('/execution', plan)} />
        : <Execution key={plan.id ?? 'demo'} plan={plan} onChange={setPlan} onToggleChecklist={toggleChecklist}
          analysis={currentAnalysis} onSaveInventory={auth && plan.id ? savePlanInventory : undefined}
          onSavePromotion={auth && plan.id ? savePlanPromotion : undefined}
          auth={auth} onSavePromotionDraft={auth && plan.id ? savePlanPromotionDraft : undefined}
          onRegeneratePromotionCaption={regeneratePlanPromotionCaption} resultsTo={planPath('/results', plan)} />
      : requestedPlanId && analysisId ? !currentAnalysis ? analysisStatus : <section className="empty-state">
        {planError?.id === requestedPlanId ? <><p role="alert" className="error">{planError.message}</p><button className="button secondary" onClick={() => {
          setPlanError(undefined)
          setPlanRetry((value) => value + 1)
        }}>다시 불러오기</button></> : <p role="status">저장한 실행 계획을 불러오는 중이에요.</p>}
      </section> : <Placeholder to={strategyPath} action="대응 전략 보기">실행할 전략을 먼저 선택해 주세요.</Placeholder>

  return (
    <>
      <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
      {!accountPage && <header className={pathname === '/' ? 'site-header landing-header' : 'site-header'}>
        <div className="shell header-inner">
          <Link to="/" className="wordmark"><Citrus /> 가게짝꿍</Link>
          {!publicPage && <nav className="main-nav" aria-label="가게짝꿍 메뉴">
            {navigation.map(({ to, label }) => <NavLink key={to} to={to === '/analysis' && analysisId ? dashboardPath(analysisId)
              : to === '/strategy' ? strategyPath : to === '/execution' && plan ? planPath('/execution', plan) : to} className={pathname === '/results' && to === '/execution' ? 'active' : undefined}>{label}</NavLink>)}
          </nav>}
          <div className="header-actions">
            {pathname === '/' && !account ? (!sessionPending && <><Link to="/login">로그인</Link><Link className="button small secondary" to="/signup">회원가입</Link></>)
              : <><span className="badge account-greeting">{account ? (account.name ? `${account.name}님, 환영해요!` : '사장님, 환영해요!') : '체험 모드'}</span>{account && <Link to="/my-page">마이페이지</Link>}<button className="text-button" onClick={leavePreview}>{account ? '로그아웃' : '나가기'}</button></>}
          </div>
        </div>
      </header>}
      <main id="main-content" className={accountPage ? 'account-content' : pathname === '/' ? 'content landing-content' : 'shell content'}>
        {logoutError && <p role="alert" className="error">{logoutError}</p>}
        {sessionPending && !publicPage ? <p role="status">로그인 상태를 확인하고 있어요.</p> : <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Account key="login" signup={false} onLogin={login} />} />
          <Route path="/signup" element={<Account key="signup" signup onLogin={login} />} />
          <Route path="/my-page" element={account
            ? <MyPage key={account.email} account={account} onUpdate={session => setAccount({ ...session, auth: ownerSession })} />
            : <Navigate to="/login" state={{ returnTo: pathname + search }} replace />} />
          <Route path="/stores" element={auth ? <MyStores key={account?.email} auth={auth} onAnalysisDeleted={forgetDeletedAnalysis} /> : <Navigate to="/login" state={{ returnTo: pathname + search }} replace />} />
          <Route path="/sales" element={auth
            ? salesStoreId ? <ExistingStoreIntake key={salesStoreId} auth={auth} storeId={salesStoreId} onAnalyze={openSavedAnalysis} />
              : <Intake auth={auth} onAnalyze={openSavedAnalysis} />
            : <Navigate to="/login" state={{ returnTo: pathname + search }} replace />} />
          <Route path="/analysis" element={dashboard} />
          <Route path="/strategy" element={strategyPage} />
          <Route path="/execution" element={planPage} />
          <Route path="/results" element={planPage} />
          <Route path="*" element={<Placeholder to="/" action="메인으로">요청한 화면을 찾을 수 없어요.</Placeholder>} />
        </Routes>}
      </main>
    </>
  )
}
