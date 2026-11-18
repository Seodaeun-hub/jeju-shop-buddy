import { useRef, useState, type FormEvent } from 'react'
import { actualSeoulDate } from '../data/promotionArchive'
import '../styles/rehearsal-date.css'

export function RehearsalDateControl({ date, onChange }: {
  date: string | null; onChange: (date: string | null) => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState(date ?? '2021-06-01')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save(value: string | null) {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      await onChange(value)
      dialog.current?.close()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '시연 기준일을 저장하지 못했어요.')
    } finally {
      setSaving(false)
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    void save(draft)
  }

  return <>
    <details className={`rehearsal-date-menu${date ? ' is-rehearsing' : ''}`}>
      <summary className="rehearsal-date-summary">
        <span>시연 기준일</span>
        <small>{date ? date.replaceAll('-', '.') : '실제 날짜'}</small>
      </summary>
      <div className="rehearsal-date-options">
      <p>{date ? '계획과 일정을 선택한 날짜 기준으로 보여줘요.' : '과거 자료로 시연할 날짜를 설정할 수 있어요.'}</p>
      <button type="button" className="button secondary small" aria-haspopup="dialog" onClick={() => {
        setDraft(date ?? '2021-06-01')
        setError('')
        dialog.current?.showModal()
      }}>{date ? '날짜 변경' : '시연 기준일 설정'}</button>
      </div>
    </details>
    <dialog ref={dialog} className="rehearsal-date-dialog" aria-labelledby="rehearsal-date-title"
      onCancel={event => { if (saving) event.preventDefault() }}>
      <form className="form-stack" onSubmit={submit}>
        <h2 id="rehearsal-date-title">시연 기준일 설정</h2>
        <p>이 계정의 계획 시작일, 진행 상태, POS 달력과 결과 확인 시점을 선택한 날짜 기준으로 보여줘요.</p>
        <label>시연 기준일<input type="date" value={draft} min="1900-01-01" max={actualSeoulDate()} required
          disabled={saving} onChange={event => setDraft(event.target.value)} /></label>
        <button type="button" className="text-button" disabled={saving} onClick={() => setDraft('2021-06-01')}>애월 시연 · 2021년 6월 1일</button>
        <p className="muted">설정은 같은 계정의 PC·아이폰에서 새로고침하면 적용돼요. 로그인과 저장 시각은 실제 시간을 사용해요. 과거 날씨는 당시 관측을 활용한 재현이며 당시 예보가 아니에요.</p>
        <p className="muted">날짜를 바꾸기 전에 입력 중인 내용을 저장해 주세요.</p>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="actions end">
          <button type="button" className="button secondary" disabled={saving} onClick={() => dialog.current?.close()}>취소</button>
          <button type="submit" className="button primary" disabled={saving}>{saving ? '저장 중…' : '시연 날짜 적용'}</button>
        </div>
        {date && <button type="button" className="text-button" disabled={saving} onClick={() => void save(null)}>실제 날짜로 돌아가기</button>}
      </form>
    </dialog>
  </>
}
