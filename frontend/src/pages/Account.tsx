import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { loginOwner, signupOwner, type OwnerSession } from '../api/shop'
import { Citrus } from '../components/ui'
import '../styles/account.css'

const shopIllustration = new URL('../assets/jeju-neighborhood-shop.jpg', import.meta.url).href

export function Account({ signup, onLogin }: { signup: boolean; onLogin: (session: OwnerSession) => void }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const passwordId = signup ? 'signup-password' : 'login-password'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const fields = new FormData(event.currentTarget)
    const email = String(fields.get('email')).trim()
    const password = String(fields.get('password'))
    if (signup && new TextEncoder().encode(password).length > 72) {
      setError('비밀번호가 너무 길어요. 조금 짧게 입력해 주세요.')
      return
    }
    setPasswordVisible(false)
    setPending(true)
    setError('')
    try {
      const session = signup ? await signupOwner(String(fields.get('name')).trim(), email, password)
        : await loginOwner(email, password)
      onLogin(session)
    } catch (error) {
      setError(error instanceof Error ? error.message : (signup ? '회원가입을 완료하지 못했어요.' : '로그인할 수 없어요.'))
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="account-layout" aria-labelledby="account-title">
      <div className="account-panel">
        <Link to="/" className="wordmark"><Citrus /> 가게짝꿍</Link>
        <div className="account-panel-body">
          <div className="account-heading">
            <Link to="/" replace className="account-back">
              <span aria-hidden="true">←</span> 이전으로
            </Link>
            <h1 id="account-title">{signup ? '회원가입' : '로그인'}</h1>
            <p className="account-switch">
              {signup ? '이미 계정이 있나요?' : '처음 오셨나요?'}{' '}
              <Link to={signup ? '/login' : '/signup'}>{signup ? '로그인' : '회원가입'}</Link>
            </p>
          </div>
          <form className="account-form" onSubmit={submit}>
            {signup && <div className="account-field">
              <label htmlFor="signup-name">사장님 이름 또는 별명</label>
              <input id="signup-name" name="name" autoComplete="nickname" required maxLength={30}
                placeholder="예: 동네 맛집 사장님" aria-describedby="signup-name-hint" />
              <small id="signup-name-hint" className="muted">이 이름으로 화면 위에서 인사해요.</small>
            </div>}
            <div className="account-field">
              <label htmlFor="account-email">이메일</label>
              <input id="account-email" name="email" type="email" autoComplete="username" autoCapitalize="none" required
                maxLength={254} placeholder={signup ? 'name@example.com' : '이메일을 입력하세요'}
                aria-describedby={signup ? 'signup-email-hint' : undefined} />
              {signup && <small id="signup-email-hint" className="muted">다음에 로그인할 때 사용할 이메일이에요.</small>}
            </div>
            <div className="account-field">
              <label htmlFor={passwordId}>비밀번호</label>
              <div className="account-password-field">
                <input id={passwordId} name="password" type={passwordVisible ? 'text' : 'password'}
                  autoComplete={signup ? 'new-password' : 'current-password'} autoCapitalize="none" spellCheck={false}
                  minLength={signup ? 8 : undefined} required
                  placeholder={signup ? '비밀번호 만들기' : '비밀번호를 입력하세요'}
                  aria-describedby={signup ? 'signup-password-hint' : undefined} />
                <button type="button" aria-controls={passwordId} aria-label={passwordVisible ? '비밀번호 숨기기' : '비밀번호 보기'}
                  onClick={() => setPasswordVisible(visible => !visible)}>{passwordVisible ? '숨기기' : '보기'}</button>
              </div>
              {signup && <small id="signup-password-hint" className="muted">8자 이상 입력해 주세요.</small>}
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="button primary full" type="submit" disabled={pending}>
              {signup ? (pending ? '가입 중…' : '가입하기') : (pending ? '로그인 중…' : '로그인')}
            </button>
          </form>
        </div>
      </div>
      <aside className="account-intro" aria-labelledby="account-intro-title">
        <div className="account-intro-inner">
          <img className="account-intro-image" src={shopIllustration} alt="" width={1536} height={1024} loading="lazy" />
          <h2 id="account-intro-title">우리 가게 매출,<br /> 다음 할 일까지.</h2>
          <p>제주 상권과 비교해 매출 변화를 살피고, 재고 조정이나 할인 행사 계획을 세워요.</p>
        </div>
      </aside>
    </section>
  )
}
