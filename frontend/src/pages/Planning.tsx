import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { changeRate, formatRate, strategies, won } from '../data/shop'
import type { Analysis, Plan } from '../data/shop'
import { Citrus, PageTitle } from '../components/ui'

const taskTemplates = {
  promotion: ['혜택과 예산 확정', '행사 소식 올리기', '중간 결제 건수 점검', '행사 종료 및 매출 자료 준비'],
  outreach: ['소개할 메뉴와 소식 정하기', '홍보 문구 확인하기', '가게 소식 올리기', '게시 결과 확인하기'],
  inventory: ['점검할 품목과 재고 확인', '최근 사용량과 입고 예정량 기록', '다음 발주량 검토', '사용량과 남은 재고 다시 확인'],
}

export function Strategy({ data, onPlan }: { data: Analysis; onPlan: (value: Plan) => void }) {
  const [before, after] = data.monthly.slice(-2)
  const drop = data.timeSeries?.rows
    .filter((row) => row.before > row.after)
    .sort((a, b) => (b.before - b.after) - (a.before - a.after))[0]
  const [choice, setChoice] = useState<Plan['strategy']>(drop ? 'promotion' : 'outreach')
  const selected = strategies.find(({ id }) => id === choice)!
  const unit = data.timeSeries?.metric === 'count' ? '결제 건수' : '매출액'

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    onPlan({ strategy: choice, duration: String(fields.get('duration')), budget: Number(fields.get('budget') ?? 0),
      channel: String(fields.get('channel') ?? ''), tasks: taskTemplates[choice], done: [] })
  }

  return <>
    <PageTitle title="대응 전략 선택" detail="우리 가게에 맞는 방법을 골라보세요." />
    <div className="receipt summary-strip"><Citrus stamp /><strong>짝꿍이 찾은 변화</strong><span>{drop ? `${drop.label} ${unit}의 감소 폭이 가장 컸어요.` : `비교한 두 달의 매출 변화 ${formatRate(changeRate(before.amount, after.amount))}`}</span></div>
    <form className="split planning" onSubmit={submit}>
      <fieldset className="form-stack strategy-options">
        <legend>어떤 전략을 해볼까요?</legend>
        {strategies.map((strategy) => <div key={strategy.id} className={choice === strategy.id ? 'strategy-option highlight' : 'strategy-option'}>
          <label><input type="radio" name="strategy" value={strategy.id} checked={choice === strategy.id} onChange={() => setChoice(strategy.id)} /><strong>{strategy.name}</strong>{strategy.id === 'promotion' && drop && <span className="badge">추천</span>}</label>
          <p>{strategy.id === 'promotion' && !drop ? '시간대 자료를 추가하면 혜택을 적용할 구간을 고를 수 있어요.' : strategy.description}</p>
          {choice === 'promotion' && strategy.id === 'promotion' && drop && <dl className="reason">
            <dt>확인한 변화</dt><dd>{drop.label} {unit} {drop.before.toLocaleString('ko-KR')} → {drop.after.toLocaleString('ko-KR')}</dd>
            <dt>추천 이유</dt><dd>감소 폭이 큰 구간에 혜택을 제공하고 반응을 살펴봐요.</dd>
            <dt>실행 후 확인</dt><dd>같은 요일·시간대의 영업일 하루 평균 {unit}을 비교해요.</dd>
          </dl>}
          {choice === 'inventory' && strategy.id === 'inventory' && <p className="muted">발주량을 계산하려면 현재 재고, 최근 사용량과 입고 예정 정보가 필요해요.</p>}
        </div>)}
        <Link to="/analysis">← 매출 분석 다시 보기</Link>
      </fieldset>
      <section className="form-stack">
        <div className="ruled"><h2>실행 조건 정하기</h2></div>
        <p className="badge">{selected.name}</p>
        <label>실행 기간<select name="duration" defaultValue="2주"><option>1주</option><option>2주</option><option>4주</option></select></label>
        {choice !== 'inventory' && <>
          <label>예산 한도 (원)<input name="budget" type="number" min="0" step="1" max={Number.MAX_SAFE_INTEGER} defaultValue="50000" required /></label>
          <label>홍보 채널<select name="channel"><option>인스타그램</option><option>매장 안내</option></select></label>
        </>}
        <p className="notice">실행 점검표{choice === 'inventory' ? '와 발주 검토 항목' : '와 홍보 문구 예시'}를 볼 수 있어요.</p>
        <button className="button primary">이 전략으로 계획 만들기 <span aria-hidden="true">→</span></button>
      </section>
    </form>
  </>
}

export function Execution({ plan, onChange }: { plan: Plan; onChange: (value: Plan) => void }) {
  const [copyStatus, setCopyStatus] = useState('')
  const strategy = strategies.find(({ id }) => id === plan.strategy)!
  const draft = plan.strategy === 'promotion'
    ? '한가한 시간에 가게에서 편하게 한 끼 어떠세요? 행사 시간과 혜택을 확인한 뒤 방문해 주세요.'
    : '오늘도 가게에서 기다리고 있어요. 새로 준비한 메뉴와 영업 소식을 확인해 주세요.'
  const next = plan.tasks.findIndex((_, index) => !plan.done.includes(index))

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draft)
      setCopyStatus('문구를 복사했어요.')
    } catch {
      setCopyStatus('복사 권한이 없어 문구를 직접 선택해 복사해 주세요.')
    }
  }

  return <>
    <PageTitle title="실행 계획 · 진행 관리" detail="실행 일정과 준비할 일을 확인해요." />
    <div className="receipt summary-strip"><Citrus stamp /><strong>{strategy.name}</strong><span>{plan.duration}{plan.strategy !== 'inventory' && ` · 예산 한도 ${won(plan.budget)}`}</span><span className="badge">{next === -1 ? '완료' : '진행 중'}</span></div>
    <div className="split planning">
      <section>
        <div className="section-top ruled"><h2>실행 일정과 점검표</h2><span className="badge">{plan.done.length} / {plan.tasks.length} 완료</span></div>
        <ul className="checklist">{plan.tasks.map((task, index) => <li key={task} className={next === index ? 'highlight' : ''}>
          <label><input type="checkbox" checked={plan.done.includes(index)} onChange={(event) => onChange({ ...plan, done: event.target.checked ? [...plan.done, index] : plan.done.filter((item) => item !== index) })} /><span>{task}</span>{next === index && <span className="badge">다음 할 일</span>}</label>
        </li>)}</ul>
      </section>
      <section className="form-stack">
        {plan.strategy === 'inventory'
          ? <div className="receipt"><h2>발주 검토 항목</h2><p>품목별 현재 재고와 사용량, 입고 예정량을 확인해 주세요.</p></div>
          : <><div className="ruled"><h2>{plan.channel} 홍보 초안</h2></div>
            <div className="receipt form-stack"><span className="badge">문구 예시</span><p>{draft}</p><button className="button secondary fit" onClick={copyDraft}>문구 복사</button><small role="status">{copyStatus}</small></div></>}
        <Link className="button primary full" to="/results">실행 결과 확인 <span aria-hidden="true">→</span></Link>
      </section>
    </div>
  </>
}

export function Results({ demo }: { demo: boolean }) {
  return <>
    <PageTitle title="실행 결과 확인" detail={demo ? '시연용 가상 결과' : '실행 전후 결과를 한곳에서 비교해요.'} />
    {demo ? <div className="split planning">
      <div className="form-stack">
        <section className="ruled-block"><h2>하루 평균 결제 건수</h2><div className="comparison"><div><span>행사 전</span><strong>4.9건</strong></div><div><span>행사 기간 · 가상</span><strong className="up">6.4건</strong></div></div></section>
        <section className="ruled-block"><h2>하루 평균 매출</h2><div className="comparison"><div><span>행사 전</span><strong>148,000원</strong></div><div><span>행사 기간 · 가상</span><strong className="up">172,000원</strong></div></div></section>
      </div>
      <div className="receipt"><div className="section-top"><h2>비교 기준</h2><Citrus stamp /></div><p>같은 요일 · 오후 2~5시 · 각 7영업일</p><p>행사 전 5.19–5.31 · 행사 기간 6.02–6.14</p><p className="muted">화면 시연용 예시입니다.</p></div>
    </div> : <div className="empty-state compact"><h2>아직 비교할 결과가 없어요.</h2><p>행사 기간 매출 자료를 불러오는 기능은 Spring API 연결 후 사용할 수 있어요.</p></div>}
    <div className="form-footer"><Link className="button secondary" to="/execution">← 실행 관리로 돌아가기</Link></div>
  </>
}
