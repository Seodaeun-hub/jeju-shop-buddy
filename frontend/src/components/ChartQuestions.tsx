import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { fetchQuestions, sendQuestion } from '../api/shop'
import type { QuestionAction, QuestionChart, QuestionEvidence, QuestionInput, QuestionTurn } from '../api/shop'
import { formatNumber } from '../data/shop'
import { Citrus } from './ui'

function quantity(value: number, unit: string) {
  const formatted = unit === 'INDEX' ? value.toFixed(1) : formatNumber(value)
  return formatted + (unit === 'KRW' ? '원' : unit === 'COUNT' ? '건' : '')
}

function Evidence({ item }: { item: QuestionEvidence }) {
  const source = item.source
  return <li>
    <strong>{item.label}</strong>
    {item.kind === 'METRIC' && <>
      <div>{quantity(item.before, item.unit)} → {quantity(item.after, item.unit)}</div>
      <small>{[item.period && `${item.period.before} → ${item.period.after}`, item.scope].filter(Boolean).join(' · ')}</small>
    </>}
    {item.kind === 'REVIEW' && <div><time>{item.date}</time> · “{item.excerpt}”</div>}
    {item.kind === 'PLAN' && <div>{item.completed}/{item.total} 완료 · {item.startDate} ~ {item.endDate}</div>}
    {item.kind === 'RESULT' && <div>
      <div>{item.scope}</div>
      <small>{item.before.start} ~ {item.before.end} ({item.before.businessDays}영업일) → {item.after.start} ~ {item.after.end} ({item.after.businessDays}영업일)</small>
    </div>}
    {item.kind === 'GUIDE' && item.when && <div>{item.when}</div>}
    {source && <small>출처 · {source.url?.startsWith('https://')
      ? <a href={source.url} target="_blank" rel="noreferrer">{source.label}</a>
      : source.label}</small>}
  </li>
}

export function ChartQuestions({ auth, analysisId, chart, title, period, suggestion, strategyTo, onRestore, onClose, onTime, onReviews }: {
  auth: string
  analysisId: string
  chart?: QuestionChart
  title?: string
  period: string
  suggestion?: string
  strategyTo: string
  onRestore: (chart: QuestionChart) => void
  onClose: () => void
  onTime: () => void
  onReviews: () => void
}) {
  const [turns, setTurns] = useState<QuestionTurn[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [failed, setFailed] = useState<QuestionInput>()
  const [reload, setReload] = useState(0)
  const [historyFailed, setHistoryFailed] = useState(false)
  const restoring = useRef(onRestore)
  const thread = useRef<HTMLDivElement>(null)
  restoring.current = onRestore

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setHistoryFailed(false)
    setError('')
    fetchQuestions(auth, analysisId, controller.signal).then(({ turns }) => {
      if (controller.signal.aborted) return
      setTurns(turns)
      const latest = turns.at(-1)
      if (latest) restoring.current(latest.chart)
    }).catch((failure: Error) => {
      if (controller.signal.aborted) return
      setHistoryFailed(true)
      setError(failure.message)
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false)
    })
    return () => controller.abort()
  }, [auth, analysisId, reload])

  useEffect(() => {
    const list = thread.current
    if (list) list.scrollTop = list.scrollHeight
  }, [turns.length, chart])

  async function submit(input: QuestionInput) {
    if (pending || loading || historyFailed) return
    setPending(true)
    setError('')
    setFailed(undefined)
    try {
      const turn = await sendQuestion(auth, analysisId, input)
      setTurns((previous) => previous.some(({ turnId }) => turnId === turn.turnId) ? previous : [...previous, turn])
      setDraft('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '질문을 보내지 못했어요.')
      setFailed(input)
    } finally {
      setPending(false)
    }
  }

  function ask(question: string, planId?: string) {
    if (!chart || !question.trim()) return
    void submit({ clientMessageId: crypto.randomUUID(), conversationId: turns.at(-1)?.conversationId, chart, question: question.trim(), planId })
  }

  function actionButton(action: QuestionAction, turn: QuestionTurn) {
    const { type, targetId } = action
    const key = type + targetId
    if (type === 'ADD_TIME_SERIES') return <button key={key} type="button" className="button secondary small" onClick={onTime}>시간대별 자료 추가</button>
    if (type === 'OPEN_REVIEWS') return <button key={key} type="button" className="button secondary small" onClick={onReviews}>리뷰 보기·등록</button>
    if (type === 'OPEN_STRATEGY' || type === 'OPEN_EXECUTION_GUIDE') return <Link key={key} className="button secondary small" to={strategyTo}>대응 전략 보기</Link>
    if (type === 'OPEN_PLAN_RESULTS') {
      const query = new URLSearchParams({ id: targetId, analysisId })
      return <Link key={key} className="button secondary small" to={`/results?${query}`}>실행 결과 보기</Link>
    }
    if (type === 'SELECT_PLAN') {
      const plan = turn.answer.evidence.find(({ id }) => id === 'plan-' + targetId)
      return <button key={key} type="button" className="button secondary small" disabled={pending} onClick={() => ask(turn.question, targetId)}>{plan?.label ?? '이 계획 선택'}</button>
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    ask(draft)
  }

  return <div hidden={!chart}>
    <section className="question-panel dashboard-chat" aria-label="짝꿍에게 질문하기">
      <div className="section-top dashboard-chat-heading">
        <h2><Citrus /> 짝꿍에게 질문하기</h2>
        <button type="button" aria-label="질문 패널 닫기" className="text-button close" onClick={onClose}>×</button>
      </div>
      <p className="badge">{title} · {period}</p>
      {loading && <p role="status">대화를 불러오는 중이에요.</p>}
      <div className="chat-messages chart-question-history" ref={thread} aria-live="polite">
        {turns.map((turn) => <div key={turn.turnId}>
          <p className="question-bubble">{turn.question}</p>
          <div className="answer-bubble">
            <strong>가게짝꿍</strong>
            {turn.answer.sections.map((section, index) => <p key={index}>
              {section.kind === 'HYPOTHESIS' && <strong>확인할 점 · </strong>}{section.text}
            </p>)}
            {turn.answer.evidence.length > 0 && <details className="chart-question-evidence">
              <summary>이 답변에 사용한 근거 {turn.answer.evidence.length}개</summary>
              <ul>{turn.answer.evidence.map((item) => <Evidence key={item.id} item={item} />)}</ul>
            </details>}
            {turn.answer.missingInputs.length > 0 && <div className="chart-question-missing">
              <strong>더 필요한 자료</strong>
              <ul>{turn.answer.missingInputs.map((item) => <li key={item.code}>{item.label}</li>)}</ul>
            </div>}
            <div className="chart-question-actions">{turn.answer.actions
              .filter((action, index, all) => action.type !== 'OPEN_EXECUTION_GUIDE' || !all.slice(0, index).some(({ type }) => type === 'OPEN_STRATEGY' || type === 'OPEN_EXECUTION_GUIDE'))
              .map((action) => actionButton(action, turn))}</div>
          </div>
        </div>)}
        {pending && <p role="status">자료를 확인하고 있어요.</p>}
      </div>
      {error && <div role="alert"><p>{error}</p>
        {historyFailed && <button type="button" className="text-button" onClick={() => setReload(reload + 1)}>대화 다시 불러오기</button>}
        {failed && <button type="button" className="text-button" onClick={() => void submit(failed)}>같은 질문 다시 보내기</button>}
      </div>}
      {!turns.length && suggestion && <button type="button" className="chip" disabled={pending || loading || historyFailed} onClick={() => ask(suggestion)}>{suggestion}</button>}
      <form className="chat-form" onSubmit={onSubmit}>
        <input aria-label="질문 입력" placeholder="궁금한 점을 물어보세요" value={draft} maxLength={1000} onChange={(event) => setDraft(event.target.value)} />
        <button className="button primary small" disabled={pending || loading || historyFailed || !draft.trim()}>보내기</button>
      </form>
    </section>
  </div>
}
