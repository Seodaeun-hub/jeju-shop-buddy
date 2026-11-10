import { useEffect, useState, type FormEvent } from 'react'
import { fetchPromotionImpact, saveNextPromotionChecklist, savePromotionActuals, savePromotionImpact, type NextPromotionChecklistItem, type PromotionActuals, type PromotionImpact, type PromotionImpactPeriod, type PromotionImpactTotals } from '../api/shop'
import { NextPromotionCard } from './NextPromotionCard'
import { importPromotionProduct } from '../data/pos'
import { changeRate, formatNumber, formatRate, won } from '../data/shop'

function ImpactRow({ label, before, after, format }: {
  label: string
  before: number
  after: number
  format: (value: number) => string
}) {
  const delta = after - before
  return <tr><th scope="row">{label}</th><td>{format(before)}</td><td>{format(after)}</td>
    <td>{delta > 0 ? '+' : delta < 0 ? '−' : ''}{format(Math.abs(delta))} · {formatRate(changeRate(before, after))}</td></tr>
}

export function PromotionImpactPanel({ auth, planId }: { auth: string; planId: string }) {
  const [result, setResult] = useState<PromotionImpact>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetchPromotionImpact(auth, planId, controller.signal).then(value => {
      if (!controller.signal.aborted) setResult(value)
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => controller.abort()
  }, [auth, planId])

  async function upload(event: FormEvent<HTMLFormElement>, phase: 'BEFORE' | 'AFTER', period: PromotionImpactPeriod) {
    event.preventDefault()
    if (!result?.productName || pending) return
    const form = event.currentTarget
    const file = new FormData(form).get('pos')
    if (!(file instanceof File) || !file.size) return
    setPending(true)
    setError('')
    setNotice('')
    try {
      const totals = await importPromotionProduct(file, result.productName, period.start, period.end)
      const saved = await savePromotionImpact(auth, planId, {phase, ...period, ...totals})
      setResult(saved)
      form.reset()
      const message = phase === 'BEFORE' ? '행사 전 POS 집계를 저장했어요.' : '홍보 게시 후 POS 집계를 저장했어요.'
      setNotice(result.actuals && !saved.actuals ? message + ' 집계가 바뀌어 실제 할인 수량과 원가를 다시 입력해 주세요.' : message)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'POS 집계를 저장하지 못했어요.')
    } finally {
      setPending(false)
    }
  }

  async function saveChecklist(update?: { item: NextPromotionChecklistItem; completed: boolean }) {
    if (pending) return
    setPending(true)
    setError('')
    setNotice('')
    try {
      setResult(await saveNextPromotionChecklist(auth, planId, update ?? {}))
      if (!update) setNotice('다음 행사 점검표를 만들었어요.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '다음 행사 점검표를 저장하지 못했어요.')
    } finally {
      setPending(false)
    }
  }

  async function saveActuals(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending) return
    const form = new FormData(event.currentTarget)
    const actuals: PromotionActuals = {
      discountedQuantity: Number(form.get('discountedQuantity')),
      beforeUnitCost: Number(form.get('beforeUnitCost')),
      afterUnitCost: Number(form.get('afterUnitCost')),
    }
    setPending(true)
    setError('')
    setNotice('')
    try {
      setResult(await savePromotionActuals(auth, planId, actuals))
      setNotice('실제 할인 수량과 개당 원가를 저장했어요.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '실제 할인 수량과 원가를 저장하지 못했어요.')
    } finally {
      setPending(false)
    }
  }

  function periodForm(phase: 'BEFORE' | 'AFTER', period: PromotionImpactPeriod, totals: PromotionImpactTotals | null) {
    const before = phase === 'BEFORE'
    const label = before ? '행사 전' : '홍보 게시 후'
    const ready = before || result?.afterReady
    return <form className="receipt form-stack" onSubmit={event => void upload(event, phase, period)}>
      <h3>{label}</h3>
      <p>{period.start} ~ {period.end}</p>
      {totals && <p>저장됨 · {formatNumber(totals.quantity)}개 · {won(totals.amount)} · 주문 기록 {totals.recordedDays}일</p>}
      {ready ? <>
        <label>{label} 상품 주문 POS<input type="file" name="pos" accept=".xlsx,.csv" required disabled={pending} /></label>
        <button type="submit" className="button secondary small" disabled={pending}>{totals ? `${label} POS 바꾸기` : `${label} POS 저장`}</button>
      </> : <p className="muted">행사 종료일이 지난 뒤 이 기간의 POS를 올릴 수 있어요.</p>}
    </form>
  }

  return <section className="form-stack" aria-labelledby="promotion-impact-title">
    <div className="section-top ruled"><h2 id="promotion-impact-title">홍보 품목 판매 변화</h2></div>
    {!result && !error && <p role="status">홍보 품목의 비교 기간을 불러오는 중이에요.</p>}
    {result?.message && <p className="muted">{result.message}</p>}
    {result?.before && result.after && <>
      <p><strong>{result.productName}</strong>의 판매량과 실판매금액을 비교해요.</p>
      <p className="muted">게시 당일은 제외하고, 행사 종료일까지를 같은 요일의 행사 전 기간과 비교해요. 같은 매장의 각 기간 전체 상품 주문 내역을 올려 주세요.</p>
      <div className="result-form-grid">
        {periodForm('BEFORE', result.before, result.beforeTotals)}
        {periodForm('AFTER', result.after, result.afterTotals)}
      </div>
      {result.beforeTotals && result.afterTotals && <table className="input-table" aria-label={`${result.productName} 판매량과 매출 비교`}>
        <thead><tr><th scope="col">지표</th><th scope="col">행사 전</th><th scope="col">홍보 게시 후</th><th scope="col">변화</th></tr></thead>
        <tbody>
          <ImpactRow label="판매량" before={result.beforeTotals.quantity} after={result.afterTotals.quantity} format={value => `${formatNumber(value)}개`} />
          <ImpactRow label="매출" before={result.beforeTotals.amount} after={result.afterTotals.amount} format={won} />
        </tbody>
      </table>}
      {result.beforeTotals && result.afterTotals && result.beforeTotals.recordedDays !== result.afterTotals.recordedDays &&
        <p className="muted">두 파일의 주문 기록일 수가 달라요. 합계를 해석하기 전에 영업일과 내보낸 기간을 확인해 주세요.</p>}
      <p className="muted">결제 완료된 주문의 수량과 실판매금액을 합산해요. 기간 중 관측된 변화를 보여줘요.</p>
      {result.beforeTotals && result.afterTotals &&
        <form className="receipt form-stack" aria-label="실제 할인과 원가" onSubmit={event => void saveActuals(event)}
          key={JSON.stringify([planId, result.beforeTotals, result.afterTotals, result.actuals])}>
          <h3>실제 할인과 원가</h3>
          <p>두 POS 비교 기간에 해당하는 값을 입력해 주세요. 할인이 적용된 판매가 없으면 수량에 0을 입력해 주세요.</p>
          <div className="result-form-grid">
            <label>실제 할인 적용 수량 (개)
              <input name="discountedQuantity" type="number" min={0} max={result.afterTotals.quantity} step={1}
                defaultValue={result.actuals?.discountedQuantity} required disabled={pending} />
            </label>
            <label>행사 전 개당 원가 (원)
              <input name="beforeUnitCost" type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1}
                defaultValue={result.actuals?.beforeUnitCost} required disabled={pending} />
            </label>
            <label>행사 후 개당 원가 (원)
              <input name="afterUnitCost" type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1}
                defaultValue={result.actuals?.afterUnitCost} required disabled={pending} />
            </label>
          </div>
          <button type="submit" className="button secondary small" disabled={pending}>실제 할인과 원가 저장</button>
          {result.profit && <table className="input-table" aria-label="품목 매출총이익 비교">
            <thead><tr><th scope="col">지표</th><th scope="col">행사 전</th><th scope="col">행사 후</th><th scope="col">변화</th></tr></thead>
            <tbody><tr><th scope="row">품목 매출총이익</th><td>{won(result.profit.beforeWon)}</td>
              <td>{won(result.profit.afterWon)}</td><td>{result.profit.changeWon > 0 ? '+' : ''}{won(result.profit.changeWon)}</td></tr></tbody>
          </table>}
          <p className="muted">품목 매출총이익은 실판매금액에서 판매량 × 개당 원가를 뺀 값이에요. 실판매금액에 반영된 할인은 다시 빼지 않아요. 인건비와 임대료 등 운영비는 포함되지 않아요.</p>
        </form>}
      {result.beforeTotals && result.afterTotals && result.advice &&
        <NextPromotionCard auth={auth} planId={planId} before={result.beforeTotals} after={result.afterTotals}
          advice={result.advice} actuals={result.actuals} profit={result.profit} checklist={result.nextChecklist} pending={pending}
          onCreate={() => void saveChecklist()}
          onToggle={(item, completed) => void saveChecklist({ item, completed })} />}
    </>}
    {notice && <p role="status">{notice}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>
}
