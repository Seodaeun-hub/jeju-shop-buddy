import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { updateOwnerName, updateOwnerPassword, type OwnerSession } from '../api/shop'
import { Citrus } from '../components/ui'

export function MyPage({ account, onUpdate }: {
  account: OwnerSession
  onUpdate: (session: OwnerSession) => void
}) {
  const [name, setName] = useState(account.name ?? '')
  const [savingName, setSavingName] = useState(false)
  const [nameNotice, setNameNotice] = useState('')
  const [nameError, setNameError] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [passwordNotice, setPasswordNotice] = useState('')
  const [passwordError, setPasswordError] = useState('')

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingName || !name.trim() || name.trim() === account.name) return
    setSavingName(true)
    setNameNotice('')
    setNameError('')
    try {
      const updated = await updateOwnerName(name.trim())
      onUpdate(updated)
      setName(updated.name)
      setNameNotice('이름을 변경했어요.')
    } catch (error) {
      setNameError(error instanceof Error ? error.message : '이름을 저장하지 못했어요.')
    } finally {
      setSavingName(false)
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (savingPassword) return
    const form = event.currentTarget
    const fields = new FormData(form)
    const current = String(fields.get('currentPassword'))
    const next = String(fields.get('newPassword'))
    setPasswordNotice('')
    setPasswordError('')
    if (next !== fields.get('confirmPassword')) {
      setPasswordError('새 비밀번호와 확인 값이 일치하지 않아요.')
      return
    }
    setSavingPassword(true)
    try {
      await updateOwnerPassword(current, next)
      form.reset()
      setPasswordNotice('비밀번호를 변경했어요.')
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : '비밀번호를 변경하지 못했어요.')
    } finally {
      setSavingPassword(false)
    }
  }

  return <section className="receipt account">
    <div className="section-top">
      <div><h1>마이페이지</h1><p>내 계정 정보를 확인하고 바꿀 수 있어요.</p></div>
      <Citrus stamp />
    </div>
    <form className="form-stack account-fields" aria-labelledby="profile-title" onSubmit={saveName}>
      <h2 id="profile-title">내 프로필</h2>
      <label>로그인 이메일<input type="email" value={account.email} readOnly /></label>
      <label>사장님 이름 또는 별명<input autoComplete="nickname" required maxLength={30} value={name}
        onChange={event => { setName(event.target.value); setNameNotice(''); setNameError('') }} /></label>
      <button className="button primary" disabled={savingName || !name.trim() || name.trim() === account.name}>이름 저장</button>
      {nameNotice && <p role="status">{nameNotice}</p>}
      {nameError && <p className="error" role="alert">{nameError}</p>}
    </form>
    <form className="form-stack account-fields" aria-labelledby="password-title" onSubmit={savePassword}>
      <h2 id="password-title">비밀번호 변경</h2>
      <label>현재 비밀번호<input name="currentPassword" type="password" autoComplete="current-password" required /></label>
      <label>새 비밀번호<input name="newPassword" type="password" autoComplete="new-password" minLength={8} required /></label>
      <label>새 비밀번호 확인<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} required /></label>
      <button className="button secondary" disabled={savingPassword}>비밀번호 변경</button>
      {passwordNotice && <p role="status">{passwordNotice}</p>}
      {passwordError && <p className="error" role="alert">{passwordError}</p>}
    </form>
    <div className="account-switch"><Link to="/stores">내 매장 관리로 이동 →</Link></div>
  </section>
}
