import { useEffect, useState } from 'react'
import { listStoreAnalyses, listStores } from '../api/shop'
import type { Store, StoreAnalysisSummary } from '../api/shop'
import { monthLabel } from '../data/shop'
import type { Analysis } from '../data/shop'

const savedAt = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Asia/Seoul',
})

function comparePeriod(before: string, after: string) {
  return `${monthLabel(before)} → ${monthLabel(after)}`
}

function AnalysisOptions({ auth, storeId, analysisId, onOpen }: {
  auth: string
  storeId: string
  analysisId?: string
  onOpen: (id: string) => void
}) {
  const [history, setHistory] = useState<StoreAnalysisSummary[]>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listStoreAnalyses(auth, storeId, controller.signal).then((items) => {
      if (!controller.signal.aborted) setHistory(items)
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => controller.abort()
  }, [auth, storeId, retry])

  if (error) return <div role="alert" className="error">{error} <button type="button" className="text-button" onClick={() => {
    setError('')
    setRetry(value => value + 1)
  }}>분석 이력 다시 불러오기</button></div>
  if (!history) return <p role="status">분석 이력을 불러오는 중이에요.</p>
  if (!history.length) return <p className="muted">이 매장에 저장한 분석이 없어요.</p>

  const current = history.find(item => item.id === analysisId)
  return <label>저장된 분석<select value={current?.id ?? ''} onChange={event => onOpen(event.target.value)}>
    <option value="" disabled>분석 이름, 비교 기간, 저장일로 선택</option>
    {history.map(item => <option key={item.id} value={item.id}>
      {item.name || '이름 없는 분석'} · {comparePeriod(item.beforeMonth, item.afterMonth)} · {savedAt.format(new Date(item.createdAt))}
    </option>)}
  </select></label>
}

export function AnalysisSwitcher({ auth, analysis, analysisId, onOpen, currentLabel = '현재 보는 분석' }: {
  auth: string
  analysis?: Analysis
  analysisId?: string
  onOpen: (id: string) => void
  currentLabel?: string
}) {
  const [stores, setStores] = useState<Store[]>()
  const [storeChoice, setStoreChoice] = useState<{ id: string; analysisId?: string }>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const storeId = storeChoice && storeChoice.analysisId === analysisId ? storeChoice.id : analysis?.storeId ?? stores?.[0]?.id
  const [before, after] = analysis?.monthly.slice(-2) ?? []

  useEffect(() => {
    const controller = new AbortController()
    listStores(auth, controller.signal).then((items) => {
      if (!controller.signal.aborted) setStores(items)
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => controller.abort()
  }, [auth, retry])

  const selectors = <>
    {error ? <div role="alert" className="error">{error} <button type="button" className="text-button" onClick={() => {
      setError('')
      setRetry(value => value + 1)
    }}>매장 다시 불러오기</button></div>
      : !stores ? <p role="status">매장을 불러오는 중이에요.</p>
      : !stores.length ? <p className="muted">등록한 매장이 없어요.</p>
      : <div className="analysis-selectors">
        <label>매장 선택<select value={storeId ?? ''} onChange={event => setStoreChoice({ id: event.target.value, analysisId })}>
          {stores.map(store => <option key={store.id} value={store.id}>{store.name} · {store.areaName}</option>)}
        </select></label>
        {storeId && <AnalysisOptions key={storeId} auth={auth} storeId={storeId} analysisId={analysisId} onOpen={id => {
          setStoreChoice({ id: storeId, analysisId: id })
          onOpen(id)
        }} />}
      </div>}
  </>

  return <section className="analysis-switcher" aria-label="매출 분석 선택">
    {analysis && <div className="analysis-current">
      <span className="analysis-current-label">{analysis.demo ? '시연 예시' : currentLabel}</span>
      <dl>
        {!analysis.demo && <div><dt>분석 이름</dt><dd>{analysis.name || '이름 없는 분석'}</dd></div>}
        <div><dt>매장명</dt><dd>{analysis.store}</dd></div>
        {before && after && <div><dt>비교 기간</dt><dd>{comparePeriod(before.month, after.month)}</dd></div>}
        {analysis.createdAt && <div><dt>저장일</dt><dd><time dateTime={analysis.createdAt}>{savedAt.format(new Date(analysis.createdAt))}</time></dd></div>}
      </dl>
    </div>}
    {analysis ? <details className="analysis-switcher-controls">
      <summary>다른 분석 보기</summary>
      {selectors}
    </details> : selectors}
  </section>
}
