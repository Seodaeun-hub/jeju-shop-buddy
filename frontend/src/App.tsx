import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { fetchAnalysis, fetchOwnerSession, fetchPlan, loginOwner, logoutOwner, ownerSession, saveInventoryReview, saveTimeSeries, toPlan, updateChecklistItem } from './api/shop'
import { Dashboard } from './pages/Dashboard'
import { ExistingStoreIntake, Intake } from './pages/Intake'
import { MyStores } from './pages/MyStores'
import { Execution } from './pages/Execution'
import { Results } from './pages/Results'
import { SavedStrategyPage, Strategy } from './pages/Strategy'
import { example } from './data/shop'
import type { Analysis, InventoryItem, Plan, TimeSeries } from './data/shop'
import { Citrus } from './components/ui'

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

function Home({ onDemo }: { onDemo: () => void }) {
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">제주 소상공인을 위한 매출 짝꿍</p>
          <h1>매출이 줄었을 때,<br />무엇부터 해볼까요?</h1>
          <p className="hero-description">우리 가게 매출과 제주 상권을 함께 보고, 오늘 할 일을 정해요.</p>
          <div className="actions">
            <Link to="/sales" className="button primary">가게짝꿍 시작하기 <span aria-hidden="true">→</span></Link>
            <button className="button secondary" onClick={onDemo}>분석 예시 보기</button>
          </div>
        </div>
        <div className="receipt hero-receipt">
          <div className="section-top"><h2>짝꿍의 한눈 요약</h2><Citrus stamp /></div>
          <div className="receipt-line"><span>우리 가게</span><strong className="down">−8.64%</strong></div>
          <div className="receipt-line"><span>상권 카드 이용액</span><strong className="up">+7.34%</strong></div>
          <p className="muted">가상 매장 분석 예시</p>
        </div>
      </section>
      <ol className="home-steps">
        <li><span>01</span> 매출 입력</li><li><span>02</span> 상권과 비교</li><li><span>03</span> 실행 계획 만들기</li>
      </ol>
    </>
  )
}

function Account({ signup, onLogin }: { signup: boolean; onLogin: (email: string) => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const fields = new FormData(event.currentTarget)
    const email = String(fields.get('email')).trim()
    setPending(true)
    setError('')
    try {
      const session = await loginOwner(email, String(fields.get('password')))
      onLogin(session.email)
    } catch (error) {
      setError(error instanceof Error ? error.message : '로그인할 수 없어요.')
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="receipt account">
      <div className="section-top">
        <div><h1>{signup ? '회원가입' : '로그인'}</h1><p>{signup ? '가입하고 우리 가게를 등록해보세요.' : '사장님, 다시 오셨네요.'}</p></div>
        <Citrus stamp />
      </div>
      {signup ? <p className="notice">회원가입은 준비 중이에요. 등록된 사업주 계정으로 로그인할 수 있어요.</p> :
        <form className="form-stack account-fields" onSubmit={login}>
          <label>이메일<input name="email" type="email" autoComplete="username" required placeholder="이메일을 입력하세요" /></label>
          <label>비밀번호<input name="password" type="password" autoComplete="current-password" required placeholder="비밀번호를 입력하세요" /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="button primary full" disabled={pending}>{pending ? '로그인 중…' : '로그인'}</button>
        </form>}
      <p className="account-switch">{signup ? '이미 계정이 있나요?' : '처음 오셨나요?'} <Link to={signup ? '/login' : '/signup'}>{signup ? '로그인' : '회원가입'}</Link></p>
    </section>
  )
}

export function App() {
  const [analysis, setAnalysis] = useState<Analysis>()
  const [plan, setPlan] = useState<Plan>()
  const navigate = useNavigate()
  const { pathname, search, state } = useLocation()
  const [account, setAccount] = useState<{ auth: string; email: string }>()
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
  const strategyPath = analysisId ? '/strategy?' + new URLSearchParams({ id: analysisId }) : '/strategy'
  const planPath = (route: '/execution' | '/results', value: Plan) => value.id && value.analysisId
    ? route + '?' + new URLSearchParams({ id: value.id, analysisId: value.analysisId }) : route
  const publicPage = ['/', '/login', '/signup'].includes(pathname)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  useEffect(() => {
    const controller = new AbortController()
    fetchOwnerSession(controller.signal).then(({ email }) => {
      if (!controller.signal.aborted) setAccount({ auth: ownerSession, email })
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

  function login(email: string) {
    setAccount({ auth: ownerSession, email })
    navigate(typeof state?.returnTo === 'string' ? state.returnTo : '/sales', { replace: true })
  }

  function openSavedAnalysis(id: string) {
    setLastId(id)
    setLoadedId(undefined)
    setAnalysis(undefined)
    setAnalysisError('')
    setPlan(undefined)
    navigate(dashboardPath(id))
  }

  function openAnalysis(value: Analysis) {
    setLastId(undefined)
    setLoadedId(undefined)
    setAnalysisError('')
    setAnalysis(value)
    setPlan(undefined)
    navigate('/analysis')
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
  const dashboard = analysisId && !auth
    ? <Navigate to="/login" state={{ returnTo: dashboardPath(analysisId) }} replace />
    : currentAnalysis ? <Dashboard key={analysisId ?? 'demo'} data={currentAnalysis} auth={auth} analysisId={analysisId} onChange={setAnalysis} onPlan={openPlan} onSaveTimeSeries={updateTimeSeries} strategyTo={strategyPath} />
    : analysisId ? analysisStatus : <Placeholder to="/sales" action="매출 입력하기">분석할 매출을 입력해 주세요.</Placeholder>

  const strategyPage = analysisId && !auth
    ? <Navigate to="/login" state={{ returnTo: pathname + search }} replace />
    : auth && analysisId && currentAnalysis
      ? <SavedStrategyPage key={analysisId} auth={auth} analysisId={analysisId} data={currentAnalysis} backTo={dashboardPath(analysisId)} onPlan={openPlan} />
      : currentAnalysis?.demo ? <Strategy data={currentAnalysis} onPlan={openPlan} />
      : analysisId ? analysisStatus : <Placeholder to="/sales" action="매출 입력하기">매출을 분석하면 대응 전략을 볼 수 있어요.</Placeholder>

  const planPage = requestedPlanId && !auth
    ? <Navigate to="/login" state={{ returnTo: pathname + search }} replace />
    : plan && currentAnalysis && (!requestedPlanId || requestedPlanId === plan.id) && (!plan.analysisId || plan.analysisId === analysisId)
      ? pathname === '/results'
        ? <Results key={plan.id ?? 'demo'} plan={plan} onChange={setPlan} auth={auth} executionTo={planPath('/execution', plan)} />
        : <Execution key={plan.id ?? 'demo'} plan={plan} onChange={setPlan} onToggleChecklist={toggleChecklist}
          analysis={currentAnalysis} onSaveInventory={auth && plan.id ? savePlanInventory : undefined} resultsTo={planPath('/results', plan)} />
      : requestedPlanId && analysisId ? !currentAnalysis ? analysisStatus : <section className="empty-state">
        {planError?.id === requestedPlanId ? <><p role="alert" className="error">{planError.message}</p><button className="button secondary" onClick={() => {
          setPlanError(undefined)
          setPlanRetry((value) => value + 1)
        }}>다시 불러오기</button></> : <p role="status">저장한 실행 계획을 불러오는 중이에요.</p>}
      </section> : <Placeholder to={strategyPath} action="대응 전략 보기">실행할 전략을 먼저 선택해 주세요.</Placeholder>

  return (
    <>
      <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
      <header className="site-header">
        <div className="shell header-inner">
          <Link to="/" className="wordmark"><Citrus /> 가게짝꿍</Link>
          {!publicPage && <nav className="main-nav" aria-label="가게짝꿍 메뉴">
            {navigation.map(({ to, label }) => <NavLink key={to} to={to === '/analysis' && analysisId ? dashboardPath(analysisId)
              : to === '/strategy' ? strategyPath : to === '/execution' && plan ? planPath('/execution', plan) : to} className={pathname === '/results' && to === '/execution' ? 'active' : undefined}>{label}</NavLink>)}
          </nav>}
          <div className="header-actions">
            {pathname === '/' ? <><Link to="/login">로그인</Link><Link className="button small secondary" to="/signup">회원가입</Link></>
              : publicPage ? <Link to="/">← 메인으로</Link>
              : <><span className="badge">{account?.email ?? '체험 모드'}</span><button className="text-button" onClick={leavePreview}>{account ? '로그아웃' : '나가기'}</button></>}
          </div>
        </div>
      </header>
      <main id="main-content" className="shell content">
        {logoutError && <p role="alert" className="error">{logoutError}</p>}
        {sessionPending && !publicPage ? <p role="status">로그인 상태를 확인하고 있어요.</p> : <Routes>
          <Route path="/" element={<Home onDemo={() => openAnalysis(example)} />} />
          <Route path="/login" element={<Account key="login" signup={false} onLogin={login} />} />
          <Route path="/signup" element={<Account key="signup" signup onLogin={login} />} />
          <Route path="/stores" element={auth ? <MyStores key={account?.email} auth={auth} /> : <Navigate to="/login" state={{ returnTo: pathname + search }} replace />} />
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
