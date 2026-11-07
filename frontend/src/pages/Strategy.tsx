import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router'
import { Citrus, PageTitle } from '../components/ui'
import { addDays, changeRate, formatNumber, formatRate, monthLabel, strategies, won } from '../data/shop'
import type { Analysis, Plan, TimeSeries } from '../data/shop'
import '../styles/strategy.css'

type StrategyId = Plan['strategy']

const taskTemplates: Record<StrategyId, string[]> = {
  promotion: ['혜택과 예산 확정', '행사 소식 올리기', '중간 결제 건수 점검', '행사 종료 및 매출 자료 준비'],
  outreach: ['소개할 메뉴와 소식 정하기', '홍보 문구 확인하기', '가게 소식 올리기', '게시 결과 확인하기'],
  inventory: ['점검할 품목과 재고 확인', '최근 사용량과 입고 예정량 기록', '다음 발주량 검토', '사용량과 남은 재고 다시 확인'],
}

function getStrategyEvidence(data: Analysis) {
  const [before, after] = data.monthly.slice(-2)
  const rate = changeRate(before.amount, after.amount)
  const salesFell = after.amount < before.amount
  const monthlyAmounts = `${monthLabel(before.month)} ${won(before.amount)} → ${monthLabel(after.month)} ${won(after.amount)}`
  const monthlyChange = rate === null ? monthlyAmounts : `${monthlyAmounts} (${formatRate(rate)})`
  const series = data.timeSeries
  const drop = series?.rows.reduce<TimeSeries['rows'][number] | undefined>((largest, row) => {
    const decrease = row.before - row.after
    return decrease > (largest ? largest.before - largest.after : 0) ? row : largest
  }, undefined)
  const unit = series?.metric === 'count' ? '결제 건수' : '매출액'
  const format = series?.metric === 'count' ? (value: number) => `${formatNumber(value)}건` : won
  const timeChange = drop ? `${drop.label} ${unit} ${format(drop.before)} → ${format(drop.after)}` : undefined
  const recommendation: StrategyId | undefined = drop ? 'promotion' : salesFell ? 'outreach' : undefined
  const promotionName = drop ? `${drop.label} 한정 프로모션` : strategies[0].name

  return {
    summary: timeChange ?? monthlyAmounts,
    change: drop ? `−${format(drop.before - drop.after)}` : rate === null ? undefined : formatRate(rate),
    recommendation,
    timeLabel: drop?.label,
    timeMetric: unit,
    cards: {
      promotion: {
        name: promotionName,
        observation: timeChange ?? (series
          ? '입력한 시간대 중 감소한 구간이 없어요.'
          : `${monthlyChange} · 시간대별 자료 없음`),
        reason: drop
          ? '감소 폭이 가장 큰 구간에만 혜택을 주고 반응을 살펴봐요.'
          : '혜택을 줄 시간대를 정하려면 시간대별 자료나 사장님의 현장 판단이 필요해요.',
        followUp: `같은 요일·시간대의 영업일 하루 평균 ${unit} 변화를 비교해요.`,
      },
      outreach: {
        name: strategies[1].name,
        observation: monthlyChange,
        reason: salesFell
          ? '매출이 줄어든 상황에서 메뉴나 영업 소식을 알리고 반응을 살펴봐요.'
          : '현재 매출을 기준으로 메뉴나 영업 소식을 알린 뒤 반응을 살펴봐요.',
        followUp: '게시 후 같은 요일의 하루 평균 매출을 이전과 비교해요.',
      },
      inventory: {
        name: strategies[2].name,
        observation: `${monthlyChange} · 품목별 재고와 사용량 확인 필요`,
        reason: salesFell
          ? '매출이 줄어든 뒤에도 이전과 같은 양을 발주하고 있는지 품목별로 점검해요.'
          : '현재 매출 추이와 품목별 사용량을 함께 보며 다음 발주량을 점검해요.',
        followUp: '품목별 사용량·남은 재고·입고 예정량을 확인한 뒤 발주량을 검토해요.',
      },
    },
  }
}

export function Strategy({ data, onPlan }: { data: Analysis; onPlan: (value: Plan) => void }) {
  const evidence = getStrategyEvidence(data)
  const [choice, setChoice] = useState<StrategyId>(evidence.recommendation ?? 'outreach')
  const [budget, setBudget] = useState('50000')
  const [channel, setChannel] = useState('인스타그램')
  const selected = evidence.cards[choice]

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const duration = String(fields.get('duration'))
    const days = Number.parseInt(duration, 10) * 7
    const startDate = data.demo ? '2021-06-01' : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format()
    const endDate = addDays(startDate, days - 1)
    const offsets = [0, 1, Math.floor(days / 2), days - 1]
    const taskLabels = [...taskTemplates[choice]]
    if (choice === 'promotion') {
      taskLabels[1] = channel === '인스타그램' ? '인스타그램에 소식 올리기' : '매장에 행사 안내 붙이기'
      taskLabels[2] = '중간 ' + (evidence.timeLabel ? evidence.timeMetric : '행사 시간대 매출액') + ' 점검'
    } else if (choice === 'outreach') {
      taskLabels[2] = channel === '인스타그램' ? '인스타그램에 소식 올리기' : '매장에 안내 붙이기'
      if (channel === '매장 안내') taskLabels[3] = '안내 후 매출 확인하기'
    }
    onPlan({
      strategy: choice,
      title: selected.name,
      store: data.store,
      demo: data.demo,
      duration,
      startDate,
      endDate,
      timeLabel: evidence.timeLabel,
      followUp: selected.followUp,
      budget: choice === 'inventory' ? 0 : Number(budget),
      channel: choice === 'inventory' ? '' : channel,
      tasks: taskLabels.map((label, index) => ({ label, date: addDays(startDate, offsets[index]) })),
      done: [],
    })
  }

  return <>
    <PageTitle title="대응 전략 선택" detail="우리 가게에 맞는 방법을 골라보세요." />
    <section className="receipt summary-strip strategy-summary" aria-label="짝꿍이 찾은 변화">
      <Citrus stamp />
      <strong>짝꿍이 찾은 변화</strong>
      <span className="strategy-summary-detail">{evidence.summary}</span>
      {evidence.change && <strong className="strategy-summary-change">{evidence.change}</strong>}
    </section>
    <form className="split planning strategy-layout" onSubmit={submit}>
      <fieldset className="strategy-options">
        <legend>어떤 전략을 해볼까요?</legend>
        {strategies.map(({ id }) => {
          const card = evidence.cards[id]
          const selectedCard = choice === id
          return <div key={id} className={selectedCard ? 'strategy-option highlight' : 'strategy-option'}>
            <label>
              <input type="radio" name="strategy" value={id} checked={selectedCard} onChange={() => setChoice(id)} />
              <strong>{card.name}</strong>
              {evidence.recommendation === id && <span className="badge strategy-recommended">추천</span>}
            </label>
            <dl className="reason strategy-evidence">
              <dt>확인한 변화</dt><dd>{card.observation}</dd>
              <dt>{evidence.recommendation === id ? '추천 이유' : '제안 이유'}</dt><dd>{card.reason}</dd>
              {selectedCard && <><dt>실행 후 확인</dt><dd>{card.followUp}</dd></>}
            </dl>
          </div>
        })}
        <Link className="strategy-back" to="/analysis">← 매출 분석 다시 보기</Link>
      </fieldset>
      <section className="form-stack strategy-settings">
        <div className="ruled"><h2>실행 조건 정하기</h2></div>
        <p className="strategy-selected">{selected.name}</p>
        <label>실행 기간<select name="duration" defaultValue="2주"><option>1주</option><option>2주</option><option>4주</option></select></label>
        {choice !== 'inventory' && <>
          <label>예산 한도 (원)<input type="number" min="0" step="1" max={Number.MAX_SAFE_INTEGER} value={budget} onChange={(event) => setBudget(event.target.value)} required /></label>
          <label>홍보 채널<select value={channel} onChange={(event) => setChannel(event.target.value)}><option>인스타그램</option><option>매장 안내</option></select></label>
        </>}
        <div className="strategy-output">
          <strong>생성할 결과물</strong>
          <span>실행 일정 · 점검표 · {choice === 'inventory' ? '발주량 검토표' : '홍보 초안'}</span>
        </div>
        <button className="button primary strategy-submit">이 전략으로 계획 만들기 <span aria-hidden="true">→</span></button>
      </section>
    </form>
  </>
}
