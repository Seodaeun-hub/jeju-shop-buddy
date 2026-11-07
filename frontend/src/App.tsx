import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { Dashboard } from './pages/Dashboard'
import { Intake } from './pages/Intake'
import { Execution } from './pages/Execution'
import { Results } from './pages/Results'
import { Strategy } from './pages/Strategy'
import { example } from './data/shop'
import type { Analysis, Plan } from './data/shop'
import { Citrus } from './components/ui'

const navigation = [
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
            <Link to="/signup" className="button primary">가게짝꿍 시작하기 <span aria-hidden="true">→</span></Link>
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

function Account({ signup }: { signup: boolean }) {
  return (
    <section className="receipt account">
      <div className="section-top">
        <div><h1>{signup ? '회원가입' : '로그인'}</h1><p>{signup ? '가입하고 우리 가게를 등록해보세요.' : '사장님, 다시 오셨네요.'}</p></div>
        <Citrus stamp />
      </div>
      <p className="notice">화면 미리보기입니다. 매출 입력은 체험 모드에서 진행할 수 있어요.</p>
      <fieldset className="form-stack account-fields" disabled aria-label={signup ? '회원가입 입력 예시' : '로그인 입력 예시'}>
        {signup && <label>이름<input type="text" placeholder="이름을 입력하세요" /></label>}
        <label>이메일<input type="email" placeholder="이메일을 입력하세요" /></label>
        <label>비밀번호<input type="password" placeholder="비밀번호를 입력하세요" /></label>
        {signup && <label>비밀번호 확인<input type="password" placeholder="비밀번호를 한 번 더 입력하세요" /></label>}
      </fieldset>
      <Link className="button primary full" to="/sales">체험 모드로 시작하기 <span aria-hidden="true">→</span></Link>
      <p className="account-switch">{signup ? '이미 계정이 있나요?' : '처음 오셨나요?'} <Link to={signup ? '/login' : '/signup'}>{signup ? '로그인' : '회원가입'}</Link></p>
    </section>
  )
}

export function App() {
  const [analysis, setAnalysis] = useState<Analysis>()
  const [plan, setPlan] = useState<Plan>()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const publicPage = ['/', '/login', '/signup'].includes(pathname)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  function openAnalysis(value: Analysis) {
    setAnalysis(value)
    setPlan(undefined)
    navigate('/analysis')
  }

  function openPlan(value: Plan) {
    setPlan(value)
    navigate('/execution')
  }

  function leavePreview() {
    setAnalysis(undefined)
    setPlan(undefined)
    navigate('/')
  }

  return (
    <>
      <a href="#main-content" className="skip-link">본문으로 건너뛰기</a>
      <header className="site-header">
        <div className="shell header-inner">
          <Link to="/" className="wordmark"><Citrus /> 가게짝꿍</Link>
          {!publicPage && <nav className="main-nav" aria-label="가게짝꿍 메뉴">
            {navigation.map(({ to, label }) => <NavLink key={to} to={to} className={pathname === '/results' && to === '/execution' ? 'active' : undefined}>{label}</NavLink>)}
          </nav>}
          <div className="header-actions">
            {pathname === '/' ? <><Link to="/login">로그인</Link><Link className="button small secondary" to="/signup">회원가입</Link></>
              : publicPage ? <Link to="/">← 메인으로</Link>
              : <><span className="badge">체험 모드</span><button className="text-button" onClick={leavePreview}>나가기</button></>}
          </div>
        </div>
      </header>
      <main id="main-content" className="shell content">
        <Routes>
          <Route path="/" element={<Home onDemo={() => openAnalysis(example)} />} />
          <Route path="/login" element={<Account signup={false} />} />
          <Route path="/signup" element={<Account signup />} />
          <Route path="/sales" element={<Intake onAnalyze={openAnalysis} />} />
          <Route path="/analysis" element={analysis ? <Dashboard data={analysis} onChange={setAnalysis} /> : <Placeholder to="/sales" action="매출 입력하기">분석할 매출을 입력해 주세요.</Placeholder>} />
          <Route path="/strategy" element={analysis ? <Strategy data={analysis} onPlan={openPlan} /> : <Placeholder to="/sales" action="매출 입력하기">매출을 분석하면 대응 전략을 볼 수 있어요.</Placeholder>} />
          <Route path="/execution" element={plan && analysis ? <Execution plan={plan} onChange={setPlan} /> : <Placeholder to="/strategy" action="대응 전략 보기">실행할 전략을 먼저 선택해 주세요.</Placeholder>} />
          <Route path="/results" element={plan && analysis ? <Results plan={plan} onChange={setPlan} /> : <Navigate to="/execution" replace />} />
          <Route path="*" element={<Placeholder to="/" action="메인으로">요청한 화면을 찾을 수 없어요.</Placeholder>} />
        </Routes>
      </main>
    </>
  )
}
