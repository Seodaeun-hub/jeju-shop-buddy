import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { listStoreAnalyses, type StoreAnalysisSummary } from '../api/shop'

export function ExecutionPlanSwitcher({ auth, storeId, analysisId, planId }: {
  auth: string
  storeId: string
  analysisId: string
  planId: string
}) {
  const navigate = useNavigate()
  const [plans, setPlans] = useState<StoreAnalysisSummary['plans']>()
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    listStoreAnalyses(auth, storeId, controller.signal).then(history => {
      if (!controller.signal.aborted) setPlans(history.find(item => item.id === analysisId)?.plans ?? [])
    }).catch((failure: Error) => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => controller.abort()
  }, [auth, storeId, analysisId, retry])

  if (error) return <div className="execution-plan-switcher">
    <p role="alert" className="error">{error}</p>
    <button type="button" className="text-button" onClick={() => {
      setError('')
      setRetry(value => value + 1)
    }}>계획 목록 다시 불러오기</button>
  </div>
  if (!plans) return <p className="muted" role="status">실행 계획 목록을 불러오는 중이에요.</p>

  const planLabel = ({ title, startDate, endDate }: StoreAnalysisSummary['plans'][number]) =>
    (title || '실행 계획') + ' · ' + startDate.replaceAll('-', '.') + ' ~ ' + endDate.replaceAll('-', '.')
  const labels = plans.map(planLabel)
  const hasCurrentPlan = plans.some(item => item.id === planId)
  if (!plans.some(item => item.id !== planId)) return null

  return <label className="execution-plan-switcher">
    다른 계획 보기
    <select value={hasCurrentPlan ? planId : ''} onChange={event => {
      const id = event.target.value
      if (id) navigate('/execution?' + new URLSearchParams({ id, analysisId }))
    }}>
      {!hasCurrentPlan && <option value="" disabled>실행 계획 선택</option>}
      {plans.map((item, index) => <option key={item.id} value={item.id}>
        {labels[index]}{labels.indexOf(labels[index]) !== labels.lastIndexOf(labels[index]) ? ' (' + (index + 1) + ')' : ''}
        {item.id === planId ? ' · 현재 보는 계획' : ''}
      </option>)}
    </select>
  </label>
}
