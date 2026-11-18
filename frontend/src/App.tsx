import { startTransition, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { createPromotionDraft, fetchAnalysis, fetchOwnerSession, fetchPlan, logoutOwner, ownerSession, type OwnerSession, regeneratePromotionCaption, saveInventoryReview, savePromotionReview, saveTimeSeries, toPlan, updateChecklistItem, updateRehearsalDate } from './api/shop'
import { RehearsalDateControl } from './components/RehearsalDateControl'
import { setRehearsalDate } from './data/rehearsalDate'
import { Dashboard } from './pages/Dashboard'
import { AnalysisSwitcher } from './components/AnalysisSwitcher'
import { WorkspaceNotifications } from './components/WorkspaceNotifications'
import { Home } from './pages/Home'
import { Account } from './pages/Account'
import { Intake } from './pages/Intake'
import { StoreRegistration } from './pages/StoreRegistration'
import { MyStores } from './pages/MyStores'
import { MyPage } from './pages/MyPage'
import { Execution } from './pages/Execution'
import { Results } from './pages/Results'
import { SavedStrategyPage, Strategy } from './pages/Strategy'
import { addDays, monthLabel } from './data/shop'
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

function AccountMenu({ name, onLogout }: { name: string; onLogout: () => void }) {
  const menu = useRef<HTMLDetailsElement>(null)
  const trigger = useRef<HTMLElement>(null)
  const ownerName = name.trim() || '사장님'
  const label = ownerName.endsWith('님') ? ownerName : `${ownerName}님`

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      const details = menu.current
      if (details?.open && event.target instanceof Node && !details.contains(event.target)) details.open = false
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])

  function closeMenu() {
    if (menu.current) menu.current.open = false
    trigger.current?.focus()
  }

  return <details className="owner-menu" ref={menu} onKeyDown={event => {
    if (event.key === 'Escape' && menu.current?.open) {
      event.preventDefault()
      closeMenu()
    }
  }} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
  }}>
    <summary ref={trigger} aria-label={`${label} 계정 메뉴`}>
      <span className="owner-initial" aria-hidden="true">{Array.from(ownerName)[0]}</span>
      <span className="owner-name">{label}</span>
    </summary>
    <div className="owner-menu-links">
      <Link to="/my-page" onClick={closeMenu}>마이페이지</Link>
      <button type="button" onClick={() => { closeMenu(); onLogout() }}>로그아웃</button>
    </div>
  </details>
}

export function App() {
  const [analysis, setAnalysis] = useState<Analysis>()
  const [plan, setPlan] = useState<Plan>()
  const [workspaceNavOpen, setWorkspaceNavOpen] = useState(() => !window.matchMedia('(max-width: 900px)').matches)
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
  const publicPage = pathname === '/signup' || (pathname === '/' && !account)
  const afterLogin = typeof state?.returnTo === 'string' ? state.returnTo : '/stores'

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  useEffect(() => {
    const controller = new AbortController()
    fetchOwnerSession(controller.signal).then(session => {
      if (!controller.signal.aborted) {
        setRehearsalDate(session.rehearsalDate)
        setAccount({ ...session, auth: ownerSession })
      }
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
    setRehearsalDate(session.rehearsalDate)
    setAccount({ ...session, auth: ownerSession })
    navigate(afterLogin, { replace: true })
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

  function forgetDeletedPlan(id: string) {
    setPlan(current => current?.id === id ? undefined : current)
    setPlanError(current => current?.id === id ? undefined : current)
  }

  function forgetDeletedStore(id: string) {
    if (analysis && analysis.storeId !== id) return
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
    startTransition(() => {
      navigate('/')
      setAccount(undefined)
      setRehearsalDate(null)
      setPlanError(undefined)
      setLastId(undefined)
      setLoadedId(undefined)
      setAnalysisError('')
      setAnalysis(undefined)
      setPlan(undefined)
    })
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
    : auth || currentAnalysis?.demo ? <div className="strategy-page">
      <PageTitle title="대응 전략 선택" detail={analysisId || currentAnalysis?.demo
        ? '우리 가게에 맞는 방법을 골라보세요.'
        : '저장한 매출 분석을 선택하면 그 분석에 맞는 전략을 볼 수 있어요.'} />
      {auth && <AnalysisSwitcher key={account?.email} auth={auth} analysis={currentAnalysis} analysisId={analysisId}
        currentLabel="추천 기준 분석" onOpen={id => openSavedAnalysis(id, savedStrategyPath(id))} />}
      {auth && analysisId
        ? currentAnalysis
          ? <SavedStrategyPage key={analysisId} auth={auth} analysisId={analysisId} data={currentAnalysis} backTo={dashboardPath(analysisId)} onPlan={openPlan} />
          : analysisStatus
        : currentAnalysis?.demo
          ? <Strategy data={currentAnalysis} onPlan={openPlan} />
          : <Link className="button secondary" to="/sales">새 매출 입력하기 <span aria-hidden="true">→</span></Link>}
    </div> : <Placeholder to="/sales" action="매출 입력하기">매출을 분석하면 대응 전략을 볼 수 있어요.</Placeholder>

  const planPage = requestedPlanId && !auth
    ? <Navigate to="/login" state={{ returnTo: pathname + search }} replace />
    : plan && currentAnalysis && (!requestedPlanId || requestedPlanId === plan.id) && (!plan.analysisId || plan.analysisId === analysisId)
      ? <>
        <nav className="plan-sections" aria-label="실행 계획 화면">
          <Link to={planPath('/execution', plan)} aria-current={pathname === '/execution' ? 'page' : undefined}>실행 관리</Link>
          <Link to={planPath('/results', plan)} aria-current={pathname === '/results' ? 'page' : undefined}>결과 확인</Link>
          <span>결과 확인일 <time dateTime={addDays(plan.endDate, 1)}>{addDays(plan.endDate, 1)}</time></span>
        </nav>
        {pathname === '/results'
          ? <Results key={plan.id ?? 'demo'} plan={plan} onChange={setPlan} auth={auth} storeId={currentAnalysis.storeId}
            executionTo={planPath('/execution', plan)} />
          : <Execution key={plan.id ?? 'demo'} plan={plan} onChange={setPlan} onToggleChecklist={toggleChecklist}
            analysis={currentAnalysis} onSaveInventory={auth && plan.id ? savePlanInventory : undefined}
            onSavePromotion={auth && plan.id ? savePlanPromotion : undefined}
            auth={auth} onSavePromotionDraft={auth && plan.id ? savePlanPromotionDraft : undefined}
            onRegeneratePromotionCaption={regeneratePlanPromotionCaption} resultsTo={planPath('/results', plan)} />}
      </>
      : requestedPlanId && analysisId ? !currentAnalysis ? analysisStatus : <section className="empty-state">
        {planError?.id === requestedPlanId ? <><p role="alert" className="error">{planError.message}</p><button className="button secondary" onClick={() => {
          setPlanError(undefined)
          setPlanRetry((value) => value + 1)
        }}>다시 불러오기</button></> : <p role="status">저장한 실행 계획을 불러오는 중이에요.</p>}
      </section> : <Placeholder to={strategyPath} action="대응 전략 보기">실행할 전략을 먼저 선택해 주세요.</Placeholder>

  const workspace = !accountPage && pathname !== '/'
  const activeSection = pathname === '/results' ? '/execution' : pathname
  const appMenu = <nav className="main-nav" id="workspace-menu" aria-label="가게짝꿍 메뉴" hidden={!workspaceNavOpen}>
    {navigation.map(({ to, label }) => <Link key={to} to={to === '/analysis' && analysisId ? dashboardPath(analysisId)
      : to === '/strategy' ? strategyPath : to === '/execution' && plan ? planPath('/execution', plan) : to}
      onClick={() => { if (window.matchMedia('(max-width: 900px)').matches) setWorkspaceNavOpen(false) }}
      aria-current={to === activeSection ? 'page' : undefined}>{label}</Link>)}
  </nav>
  const main = <main id="main-content" className={accountPage ? 'account-content' : workspace ? 'content workspace-main' : 'content landing-content'}>
    {account && workspace && <RehearsalDateControl date={account.rehearsalDate} onChange={async date => {
      const session = await updateRehearsalDate(date)
      setRehearsalDate(session.rehearsalDate)
      setAccount({ ...session, auth: ownerSession })
    }} />}
    {logoutError && <p role="alert" className="error">{logoutError}</p>}
    {sessionPending && !publicPage ? <p role="status">로그인 상태를 확인하고 있어요.</p> : <Routes key={account?.rehearsalDate ?? 'actual'}>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={account ? <Navigate to={afterLogin} replace />
        : <Account key="login" signup={false} onLogin={login} />} />
      <Route path="/signup" element={<Account key="signup" signup onLogin={login} />} />
      <Route path="/my-page" element={account
        ? <MyPage key={account.email} account={account} onUpdate={session => {
          setRehearsalDate(session.rehearsalDate)
          setAccount({ ...session, auth: ownerSession })
        }} />
        : <Navigate to="/login" state={{ returnTo: pathname + search }} replace />} />
      <Route path="/stores" element={account ? <MyStores key={account.email} auth={account.auth} ownerEmail={account.email}
        onAnalysisDeleted={forgetDeletedAnalysis} onPlanDeleted={forgetDeletedPlan} onStoreDeleted={forgetDeletedStore} /> : <Navigate to="/login" state={{ returnTo: pathname + search }} replace />} />
      <Route path="/stores/new" element={auth ? <StoreRegistration auth={auth} />
        : <Navigate to="/login" state={{ returnTo: pathname + search }} replace />} />
      <Route path="/sales" element={account ? <Intake key={account.email} auth={account.auth} ownerEmail={account.email} onAnalyze={openSavedAnalysis} />
        : <Navigate to="/login" state={{ returnTo: pathname + search }} replace />} />
      <Route path="/analysis" element={dashboard} />
      <Route path="/strategy" element={strategyPage} />
      <Route path="/execution" element={planPage} />
      <Route path="/results" element={planPage} />
      <Route path="*" element={<Placeholder to="/" action="메인으로">요청한 화면을 찾을 수 없어요.</Placeholder>} />
    </Routes>}
  </main>

  return (
    <>
      <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
      {!accountPage && <header className={workspace ? 'site-header workspace-header' : 'site-header landing-header'}>
        <div className="shell header-inner">
          <div className="header-brand">
            {workspace && <button className="workspace-nav-toggle workspace-nav-toggle-mobile" type="button"
              aria-label={workspaceNavOpen ? '메뉴 접기' : '메뉴 열기'} aria-expanded={workspaceNavOpen} aria-controls="workspace-menu"
              onClick={() => setWorkspaceNavOpen(open => !open)}><span aria-hidden="true" /></button>}
            <Link to="/" className="wordmark"><Citrus /> 가게짝꿍</Link>
          </div>
          <div className="header-actions">
            {account && workspace && <WorkspaceNotifications key={`${account.email}:${account.rehearsalDate}`} auth={account.auth} email={account.email} />}
            {account ? <AccountMenu key={pathname} name={account.name} onLogout={leavePreview} />
              : !sessionPending && (workspace
                ? <><span className="muted">체험 모드</span><button className="text-button" onClick={leavePreview}>나가기</button></>
                : <><Link to="/login">로그인</Link><Link className="button small secondary" to="/signup">회원가입</Link></>)}
          </div>
        </div>
      </header>}
      {workspace ? <div className={`shell workspace-layout${workspaceNavOpen ? '' : ' workspace-layout-collapsed'}`}>
        <aside className="workspace-sidebar">
          <div className="workspace-sidebar-inner">
            <button className="workspace-sidebar-toggle" type="button" title={workspaceNavOpen ? '메뉴 접기' : '메뉴 열기'}
              aria-label={workspaceNavOpen ? '메뉴 접기' : '메뉴 열기'} aria-expanded={workspaceNavOpen} aria-controls="workspace-menu"
              onClick={() => setWorkspaceNavOpen(open => !open)}>
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M9 5v14" />
                <path d={workspaceNavOpen ? 'm16 9-3 3 3 3' : 'm13 9 3 3-3 3'} />
              </svg>
              {workspaceNavOpen && <span>메뉴 접기</span>}
            </button>
            {appMenu}
          </div>
        </aside>
        {main}
      </div> : main}
    </>
  )
}
