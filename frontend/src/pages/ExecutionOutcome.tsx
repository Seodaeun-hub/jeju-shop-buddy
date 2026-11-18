import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { fetchExecutionOutcome, fetchInventoryEstimates, saveExecutionOutcome } from '../api/shop'
import type { InventoryEstimateComparison } from '../api/shop'
import { importOutcomePeriod, outcomeSource } from '../data/executionOutcome'
import type { ExecutionOutcome as Outcome, OutcomeComparison } from '../data/executionOutcome'
import { importPromotionProduct } from '../data/pos'
import { rehearsalDate } from '../data/rehearsalDate'
import { seoulDate } from '../data/promotionArchive'
import { addDays, formatNumber, won } from '../data/shop'
import type { Plan } from '../data/shop'

const errorText = (error: unknown) => error instanceof Error ? error.message : '자료를 처리할 수 없어요.'

function ComparisonTable({ value }: { value: OutcomeComparison }) {
  const rows = [
    ['영업일', 'days', '일'], ['매장 매출', 'amount', '원'], ['전체 결제', 'count', '건'],
    ['오후 2~5시 결제', 'afternoonCount', '건'], [`${value.product} 판매량 (POS 수량)`, 'quantity', ''],
    [`${value.product} 매출`, 'productAmount', '원'],
  ] as const
  return <>
    <p>실행 전 {value.before.start} ~ {value.before.end}<br />실행 후 {value.after.start} ~ {value.after.end}</p>
    <div className="outcome-table-wrap"><table className="outcome-table">
      <thead><tr><th>비교 항목</th><th>실행 전</th><th>실행 후</th></tr></thead>
      <tbody>{rows.map(([title, key, unit]) => <tr key={key}><th scope="row">{title}</th>
        <td>{unit === '원' ? won(value.before[key]) : `${formatNumber(value.before[key])}${unit}`}</td>
        <td>{unit === '원' ? won(value.after[key]) : `${formatNumber(value.after[key])}${unit}`}</td></tr>)}</tbody>
    </table></div>
    <p>하루 평균 매출 {won(Math.round(value.before.amount / value.before.days))} → {won(Math.round(value.after.amount / value.after.days))},
      하루 평균 결제 {(value.before.count / value.before.days).toFixed(2)} → {(value.after.count / value.after.days).toFixed(2)}건</p>
    <p className="muted">금액·건수는 파일 합계예요. 영업일이 다르면 하루 평균도 함께 보세요. 요일별 영업 여부·영업시간·메뉴 가격이 같은지는 원본과 대조해 주세요. 전후 변화만으로 홍보나 안내의 효과를 입증할 수 없어요.</p>
    <details><summary>집계 출처와 파일 확인값</summary><ul>{value.sources.map((source, index) => <li key={index}>
      {source.name}<br /><small className="outcome-hash">SHA-256 {source.sha256}</small>
    </li>)}</ul></details>
  </>
}

export function ExecutionOutcome({ plan, auth }: { plan: Plan & { id: string }; auth: string }) {
  const [saved, setSaved] = useState<Outcome | null>()
  const [estimates, setEstimates] = useState<InventoryEstimateComparison[]>([])
  const [retry, setRetry] = useState(0)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pendingUntil, setPendingUntil] = useState<string | null>()
  const [comparison, setComparison] = useState<OutcomeComparison | null>(null)
  const [actual, setActual] = useState<string>('')
  const [product, setProduct] = useState(plan.promotionReview?.productName ?? '')
  const [inventoryDay, setInventoryDay] = useState(plan.startDate)
  const [simulated, setSimulated] = useState(Boolean(rehearsalDate()))
  const isInventory = plan.strategy === 'inventory'
  const isReview = !!plan.reviewTopic || !!plan.reviewAction || /리뷰|후기/.test(plan.title)
  useEffect(() => {
    const controller = new AbortController()
    setSaved(undefined)
    setError('')
    Promise.all([fetchExecutionOutcome(auth, plan.id, controller.signal),
      isInventory ? fetchInventoryEstimates(auth, plan.id, controller.signal) : Promise.resolve([])]).then(([{ outcome, pendingUntil }, snapshots]) => {
      if (controller.signal.aborted) return
      setSaved(outcome)
      setPendingUntil(pendingUntil)
      setComparison(outcome?.comparison ?? null)
      setSimulated(outcome?.simulated ?? Boolean(rehearsalDate()))
      setEstimates(snapshots)
      const snapshot = snapshots.find(row => row.currentPlan)?.estimate
      setProduct(outcome?.inventory?.product ?? outcome?.comparison?.product ?? snapshot?.product ?? plan.promotionReview?.productName ?? '')
      setInventoryDay(outcome?.inventory?.date ?? snapshot?.date ?? plan.startDate)
      setActual(String(outcome?.inventory?.actualQuantity ?? ''))
    }).catch(e => { if (!controller.signal.aborted) setError(errorText(e)) })
    return () => controller.abort()
  }, [auth, plan.id, isInventory, retry])

  const snapshot = estimates.find(row => row.currentPlan && row.estimate.date === (!editing && saved?.inventory ? saved.inventory.date : inventoryDay)
    && row.estimate.product === (!editing && saved?.inventory ? saved.inventory.product : product))?.estimate

  async function summarize(form: HTMLFormElement) {
    const data = new FormData(form)
    const files = ['beforePayment', 'beforeProduct', 'afterPayment', 'afterProduct'].map(key => data.get(key))
    if (files.some(file => !(file instanceof File) || !file.size)) throw new Error('실행 전·후 결제와 상품 주문 CSV 네 개를 선택해 주세요.')
    if (!data.get('coverage')) throw new Error('두 기간의 영업일·영업시간과 파일 범위를 확인해 주세요.')
    const [bp, bo, ap, ao] = files as File[]
    if (!simulated && files.some(file => (file as File).name.toUpperCase().includes('SIMULATED'))) throw new Error('가상 CSV는 자료 구분에서 가상 시연 자료를 선택해 주세요.')
    const start = String(data.get('beforeStart')), end = String(data.get('beforeEnd'))
    const afterStart = String(data.get('afterStart')), afterEnd = String(data.get('afterEnd'))
    if (end >= afterStart) throw new Error('실행 전·후 비교 기간이 겹치지 않도록 정해 주세요.')
    if (afterEnd >= seoulDate()) throw new Error('실행 후 기간이 지난 다음에 비교해 주세요. 과거 시연은 사이드바에서 기준일을 조정할 수 있어요.')
    const [before, after, sources] = await Promise.all([
      importOutcomePeriod(bp, bo, start, end, product.trim()), importOutcomePeriod(ap, ao, afterStart, afterEnd, product.trim()),
      Promise.all((files as File[]).map(outcomeSource)),
    ])
    setComparison({ product: product.trim(), before, after, sources })
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const data = new FormData(event.currentTarget)
      if (!isInventory && !comparison && ['beforePayment', 'beforeProduct', 'afterPayment', 'afterProduct']
        .some(key => { const file = data.get(key); return file instanceof File && file.size > 0 })) {
        throw new Error('파일을 선택했다면 먼저 선택한 CSV로 집계하기를 눌러 결과를 확인해 주세요.')
      }
      if (String(data.get('reviewedCount') ?? '') !== '' && !String(data.get('reviewSource') ?? '').trim()) {
        throw new Error('후기 수를 입력했다면 확인한 기간과 원문 출처도 적어 주세요.')
      }
      const remaining: NonNullable<Outcome['inventory']>['remaining'] = []
      for (const item of plan.inventoryItems ?? []) {
        const value = String(data.get(`remaining-${item.id}`) ?? '')
        if (value !== '') remaining.push({ name: item.name, unit: item.unit, quantity: Number(value) })
      }
      const next: Outcome = {
        simulated, executedOn: String(data.get('executedOn')), action: String(data.get('action')).trim(),
        note: String(data.get('note')).trim(), reviewSource: String(data.get('reviewSource') ?? '').trim(),
        reviewedCount: String(data.get('reviewedCount') ?? '') === '' ? null : Number(data.get('reviewedCount')),
        comparison: isInventory ? null : comparison,
        inventory: isInventory ? { date: inventoryDay, product: product.trim(), actualQuantity: actual === '' ? null : Number(actual), remaining } : null,
      }
      const value = await saveExecutionOutcome(auth, plan.id, next)
      setSaved(value.outcome); setEditing(false)
    } catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }

  if (saved === undefined) return <section className="receipt"><p role="status">실행 기록을 불러오는 중이에요.</p>{error && <>
    <p className="error" role="alert">{error}</p><button className="button secondary" onClick={() => setRetry(n => n + 1)}>다시 불러오기</button></>}</section>
  if (pendingUntil) return <section className="receipt"><h2>아직 결과 확인일 전이에요</h2>
    <p>저장한 실행 결과는 {pendingUntil}부터 볼 수 있어요. 기존 기록은 보존돼요.</p>
    {rehearsalDate() && <p className="muted">실행 결과 시연 단계라면 사이드바에서 시연 기준일을 조정해 주세요.</p>}</section>

  return <section className="receipt execution-outcome">
    <div className="section-top"><h2>실행 기록과 결과</h2>{saved && <span className="badge">{saved.simulated ? '가상 실행 결과' : '입력한 운영 기록'}</span>}</div>
    {!saved && !isInventory && seoulDate() <= plan.endDate && <p className="notice">실행 후 POS 비교는 {addDays(plan.endDate, 1)}부터 진행해 주세요. 그 전에는 실행 내용만 기록할 수 있어요.</p>}
    {saved && !editing ? <>
      <p><strong>{saved.executedOn}</strong> · {saved.action}</p>
      {saved.note && <p className="outcome-note">{saved.note}</p>}
      {saved.simulated && <p className="notice">가상 POS·운영 기록으로 확인한 시연이에요. 실제 매장의 매출 개선이나 공개 후기 결과가 아니에요.</p>}
      {saved.comparison ? <ComparisonTable value={saved.comparison} /> : !isInventory && <p className="muted">비교 POS가 없어 매출·결제 변화는 아직 판단할 수 없어요.</p>}
      {saved.inventory && <>
        <h3>{saved.inventory.date} · {saved.inventory.product} 하루 결과</h3>
        <p>저장한 예상 {snapshot ? `${snapshot.low}~${snapshot.high}` : '자료 없음'} · 기록한 판매 {saved.inventory.actualQuantity == null ? '미입력' : saved.inventory.actualQuantity} (POS 수량)</p>
        <p className="muted">남은 재고만으로 폐기량이나 절감 효과를 알 수 없어요. 아래 수량은 입력한 단위 그대로예요.</p>
        <ul>{saved.inventory.remaining.map((item, i) => <li key={i}>{item.name}: {item.quantity} {item.unit}</li>)}</ul>
      </>}
      {isReview && <section className="notice"><strong>{saved.reviewedCount == null || saved.reviewedCount === 0 ? '자료 부족 · 추가 관찰 필요' : '추가 관찰 필요'}</strong>
        <p>{saved.reviewedCount == null ? '실행 후 후기 수가 입력되지 않았어요.' : `입력한 실행 후 후기 ${saved.reviewedCount}건.`} 같은 기간의 실제 후기 원문과 이전 불편 내용을 대조해야 해요. 불편이 해소됐다고 단정하지 않아요.</p>
        {saved.reviewSource && <p className="outcome-note">확인 범위·출처: {saved.reviewSource}</p>}</section>}
      <button className="button secondary" onClick={() => {
        setError(''); setEditing(true); setComparison(saved.comparison ?? null); setSimulated(saved.simulated)
        setInventoryDay(saved.inventory?.date ?? inventoryDay)
        setProduct(saved.inventory?.product ?? saved.comparison?.product ?? product)
        setActual(String(saved.inventory?.actualQuantity ?? ''))
      }}>실행 기록 수정</button>
    </> : <form onSubmit={save} className="form-stack">
      <label>자료 구분<select value={simulated ? 'SIMULATED' : 'OBSERVED'} onChange={e => setSimulated(e.target.value === 'SIMULATED')}>
        <option value="OBSERVED">직접 확인한 운영 기록</option><option value="SIMULATED">가상 시연 자료</option></select></label>
      <label>실행한 날짜<input name="executedOn" type="date" required max={seoulDate()} defaultValue={saved?.executedOn ?? (isInventory ? inventoryDay : plan.startDate)} /></label>
      <label>무엇을 실행했나요?<input name="action" required maxLength={1000} defaultValue={saved?.action ?? ''} placeholder="예: 오후 주문 가능 시간 안내문을 점검하고 수정" /></label>
      <label>실행 범위와 확인한 내용<textarea name="note" maxLength={2000} defaultValue={saved?.note ?? ''}
        placeholder="자료 출처, 실제 게시 여부, 관찰 기간이나 재료 배정 범위를 기록해 주세요." /></label>
      {!isInventory && <details className="result-direct-entry" open={!saved?.comparison || undefined}>
        <summary>POS로 실행 전·후 비교하기</summary>
        <label>비교할 POS 메뉴명<input required={!!comparison} value={product} maxLength={255} onChange={e => { setProduct(e.target.value); setComparison(null) }} /></label>
        <div className="result-form-grid">{(['before', 'after'] as const).map(phase => <fieldset className="result-fields" key={phase} onChange={() => setComparison(null)}>
          <legend>{phase === 'before' ? '실행 전' : '실행 후'}</legend>
          <label>시작일<input name={`${phase}Start`} type="date" defaultValue={saved?.comparison?.[phase].start ?? (phase === 'before' ? addDays(plan.startDate, -14) : plan.startDate)} /></label>
          <label>종료일<input name={`${phase}End`} type="date" defaultValue={saved?.comparison?.[phase].end ?? (phase === 'before' ? addDays(plan.startDate, -1) : plan.endDate)} /></label>
          <label>결제 CSV<input name={`${phase}Payment`} type="file" accept=".csv" /></label>
          <label>상품 주문 CSV<input name={`${phase}Product`} type="file" accept=".csv" /></label>
        </fieldset>)}</div>
        <label className="outcome-confirm"><input type="checkbox" name="coverage" />해당 기간의 전체 영업 자료이고, 두 기간의 요일·영업시간을 확인했어요.</label>
        <button type="button" className="button secondary" disabled={busy} onClick={async e => {
          const form = e.currentTarget.form!
          setBusy(true); setError('')
          try { await summarize(form) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
        }}>선택한 CSV로 집계하기</button>
      </details>}
      {!isInventory && comparison && <ComparisonTable value={comparison} />}
      {isInventory && <>
        <p className="notice">발주 결과는 검토한 하루와 같은 메뉴 기준으로 기록해 주세요. 여러 메뉴가 공유한 재료는 배정량과 다른 사용·폐기·이동을 구분해 주세요.</p>
        <div className="result-form-grid"><label>발주를 검토한 하루<input type="date" required max={addDays(seoulDate(), -1)} value={inventoryDay} onChange={e => { setInventoryDay(e.target.value); setActual('') }} /></label>
          <label>메뉴명<input required maxLength={255} value={product} onChange={e => { setProduct(e.target.value); setActual('') }} /></label></div>
        <p>이 날짜·메뉴의 저장된 예상: {snapshot ? `${snapshot.low}~${snapshot.high} (POS 수량)` : '자료 없음 — 실행 관리에서 예상 범위를 먼저 저장해 주세요.'}</p>
        <label>하루 상품 주문 CSV로 판매량 채우기<input type="file" accept=".csv,.xlsx" disabled={busy} onChange={async e => {
          const file = e.currentTarget.files?.[0]
          if (!file) return
          setBusy(true); setError('')
          try {
            if (!simulated && file.name.toUpperCase().includes('SIMULATED')) throw new Error('가상 파일은 가상 시연 자료로 표시해 주세요.')
            setActual(String((await importPromotionProduct(file, product, inventoryDay, inventoryDay)).quantity))
          } catch (e) { setActual(''); setError(errorText(e)) } finally { setBusy(false) }
        }} /></label>
        <label>기록한 하루 판매량 (POS 수량)<input type="number" min="0" step="1" value={actual} onChange={e => setActual(e.target.value)} /></label>
        <details><summary>품목별 남은 재고 입력 ({plan.inventoryItems?.length ?? 0}품목)</summary>
          <div className="result-form-grid">{plan.inventoryItems?.map(item => <label key={item.id}>{item.name} ({item.unit})
            <span className="muted">검토 당시 {item.stock} · 기존 입고 예정 {item.incoming} · 추가 발주 {item.finalOrder}</span>
            <input name={`remaining-${item.id}`} type="number" min="0" max="1000000000" step="0.001"
              defaultValue={saved?.inventory?.remaining.find(r => r.name === item.name && r.unit === item.unit)?.quantity ?? ''} /></label>)}</div>
        </details>
      </>}
      {isReview && <>
        <label>실행 후 확인한 후기 수 (선택)<input name="reviewedCount" type="number" min="0" max="10000" step="1" defaultValue={saved?.reviewedCount ?? ''} /></label>
        <label>후기 확인 기간·출처 (건수 입력 시 필수)<textarea name="reviewSource" maxLength={2000} defaultValue={saved?.reviewSource ?? ''} placeholder="후기가 없다고 확인했다면 검색 범위와 출처를 기록해 주세요. 가상 후기는 가상이라고 명시해 주세요." /></label>
        <p className="muted">실행 기록만으로 불편 해소 여부를 판단하지 않아요. 실행 후 후기 원문이 없으면 자료 부족으로 남겨요.</p>
      </>}
      <div className="result-form-actions"><button className="button primary" disabled={busy}>{busy ? '처리 중…' : '실행 기록과 결과 저장'}</button>
        {saved && <button type="button" className="button secondary" disabled={busy} onClick={() => { setEditing(false); setComparison(saved.comparison ?? null); setSimulated(saved.simulated) }}>취소</button>}</div>
    </form>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>
}
