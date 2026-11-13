import { useEffect, useState, type FormEvent } from 'react'
import { fetchBreakEven, saveBreakEven, type BreakEvenReview, type BreakEvenSettings } from '../api/shop'
import { monthLabel, won } from '../data/shop'

const percent = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 })

function dailyTarget(fixed: number, operatingDays: number, ingredient: number | null | undefined, other: number) {
  if (ingredient == null || !Number.isSafeInteger(fixed) || fixed < 0 || !Number.isInteger(operatingDays) || operatingDays < 1
    || !Number.isFinite(ingredient) || !Number.isFinite(other) || ingredient < 0 || other < 0) return null
  const margin = 100_000_000n - BigInt(Math.round(ingredient * 1_000_000)) - BigInt(Math.round(other * 1_000_000))
  if (margin <= 0n) return null
  const divisor = margin * BigInt(operatingDays)
  const amount = (BigInt(fixed) * 100_000_000n + divisor - 1n) / divisor
  return amount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(amount) : null
}

export function BreakEven({ auth, storeId }: { auth: string; storeId: string }) {
  const [review, setReview] = useState<BreakEvenReview>()
  const [draft, setDraft] = useState<BreakEvenSettings>()
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const request = new AbortController()
    fetchBreakEven(auth, storeId, request.signal).then(result => {
      if (request.signal.aborted) return
      setReview(result)
      setDraft(result.settings)
    }).catch(failure => {
      if (!request.signal.aborted) setError(failure.message)
    })
    return () => request.abort()
  }, [auth, storeId, retry])

  const evidence = review?.evidence
  const fixed = draft ? draft.rentWon + draft.payrollWon + draft.otherWon : 0
  const ingredient = draft?.ingredientPercentOverride ?? evidence?.ingredientPercent
  const margin = ingredient == null || !draft ? null : 100 - ingredient - draft.extraVariablePercent
  const safeDaily = draft ? dailyTarget(fixed, draft.operatingDays, ingredient, draft.extraVariablePercent) : null
  const recentDaily = evidence && draft && draft.operatingDays > 0 ? Math.round(evidence.salesWon / draft.operatingDays) : null
  const progress = safeDaily != null && safeDaily > 0 && recentDaily != null ? Math.floor(recentDaily / safeDaily * 100) : null

  function change(key: keyof BreakEvenSettings, raw: string) {
    setMessage('')
    setDraft(current => current && ({ ...current, [key]: key === 'ingredientPercentOverride' && raw === '' ? null : Number(raw) }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || saving) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const saved = await saveBreakEven(auth, storeId, draft)
      setReview(saved)
      setDraft(saved.settings)
      setMessage('손익분기점 설정을 저장했어요.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '설정을 저장하지 못했어요.')
    } finally {
      setSaving(false)
    }
  }

  return <section className="form-stack menu-costs" aria-labelledby="break-even-title">
    <div className="section-top ruled">
      <div><h2 id="break-even-title">손익분기점</h2>
        <p className="muted">고정비와 매출에 따라 달라지는 비용을 반영해 하루 목표 매출을 계산해요.</p>
      </div>
    </div>
    {!draft ? error ? <p className="error" role="alert">{error}{' '}
      <button className="text-button" type="button" onClick={() => { setError(''); setRetry(n => n + 1) }}>다시 불러오기</button>
    </p> : <p role="status">설정을 불러오는 중이에요.</p> : <form className="form-stack" onSubmit={submit}>
      <div className="break-even-fields">
        <label>월 임대료 (원)<input type="number" inputMode="numeric" min={0} max={1000000000000}
          value={draft.rentWon} onChange={e => change('rentWon', e.target.value)} required disabled={saving} /></label>
        <label>월 고정 인건비 (원)<input type="number" inputMode="numeric" min={0} max={1000000000000}
          value={draft.payrollWon} onChange={e => change('payrollWon', e.target.value)} required disabled={saving} /></label>
        <label>기타 월 고정비 (원)<input type="number" inputMode="numeric" min={0} max={1000000000000}
          value={draft.otherWon} onChange={e => change('otherWon', e.target.value)} required disabled={saving} /></label>
        <label>한 달 영업일 (일)<input type="number" inputMode="numeric" min={1} max={31}
          value={draft.operatingDays || ''} onChange={e => change('operatingDays', e.target.value)} required disabled={saving} /></label>
        <label>추가 변동비율 (%)<input type="number" inputMode="decimal" min={0} max={99.99} step="0.01"
          value={draft.extraVariablePercent} onChange={e => change('extraVariablePercent', e.target.value)} required disabled={saving} />
          <small className="muted">매출에 비례하는 수수료나 포장비를 입력해요.</small></label>
        <label>예상 재료비율 직접 입력 (%)<input type="number" inputMode="decimal" min={0} max={99.99} step="0.01"
          value={draft.ingredientPercentOverride ?? ''} onChange={e => change('ingredientPercentOverride', e.target.value)} disabled={saving} />
          <small className="muted">비워두면 POS와 저장한 메뉴 원가로 계산해요.</small></label>
      </div>
      <dl className="menu-cost-totals" aria-live="polite">
        <div><dt>하루 목표 매출</dt><dd>{safeDaily == null ? '—' : won(safeDaily)}</dd></div>
        <div><dt>월 고정비 합계</dt><dd>{won(fixed)}</dd></div>
        <div><dt>재료비율</dt><dd>{ingredient == null ? '—' : percent.format(ingredient) + '%'}</dd></div>
        {recentDaily != null && <div><dt>같은 영업일로 환산한 최근 하루 매출</dt><dd>{won(recentDaily)}</dd></div>}
      </dl>
      {progress != null && <div className="break-even-progress">
        <label htmlFor="break-even-progress">최근 하루 매출의 목표 달성률 · {progress}%</label>
        <progress id="break-even-progress" max={100} value={Math.min(progress, 100)} />
      </div>}
      {evidence && <p className="muted">{monthLabel(evidence.month)} 저장 분석 기준 · 전체 매출 {won(evidence.salesWon)} · 원가가 연결된 품목 매출 {won(evidence.coveredRevenueWon)}
        {evidence.missingProducts > 0 && ' · 원가 또는 매출 자료가 빠진 품목 ' + evidence.missingProducts + '개'}</p>}
      {ingredient == null && <p>품목별 실판매금액이 포함된 POS와 메뉴 원가를 저장하거나 예상 재료비율을 직접 입력해 주세요.</p>}
      {margin != null && margin <= 0 && <p role="status">매출에서 변동비를 빼면 남는 금액이 없어요. 재료비율과 추가 변동비율을 확인해 주세요.</p>}
      <p className="muted">월 고정비 ÷ (1 − 재료비율 − 추가 변동비율) ÷ 영업일. 입력한 비용으로 계산한 예상치예요.</p>
      <div className="actions"><button className="button primary" disabled={saving}>{saving ? '저장 중…' : '설정 저장'}</button></div>
      {message && <p role="status">{message}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </form>}
  </section>
}
