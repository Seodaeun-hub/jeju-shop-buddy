import { useEffect, useId, useState } from 'react'
import { fetchExecutionGuide } from '../api/shop'
import type { ExecutionGuide, ExecutionGuideChannel } from '../api/shop'

export function ExecutionGuidePanel({ auth, analysisId, recommendationId }: {
  auth: string
  analysisId: string
  recommendationId?: string
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState<ExecutionGuideChannel>('NAVER')
  const [guides, setGuides] = useState<Partial<Record<ExecutionGuideChannel, ExecutionGuide>>>({})
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const guide = guides[channel]

  useEffect(() => {
    if (!open || guide) return
    const request = new AbortController()
    fetchExecutionGuide(auth, analysisId, channel, recommendationId, request.signal)
      .then((value) => {
        if (!request.signal.aborted) setGuides((saved) => ({ ...saved, [channel]: value }))
      })
      .catch((error: Error) => {
        if (!request.signal.aborted) setError(error.message)
      })
    return () => request.abort()
  }, [analysisId, auth, channel, guide, open, recommendationId, retry])

  return <div className="execution-guide">
    <button className="button secondary fit" type="button" aria-expanded={open} aria-controls={id}
      onClick={() => { setError(''); setOpen(!open) }}>
      어떻게 실행하나요?
    </button>
    <section id={id} aria-label="실행 가이드" hidden={!open}>
      {open && <>
        <label htmlFor={`${id}-channel`}>안내 채널</label>
        <select id={`${id}-channel`} value={channel} onChange={(event) => {
          setError('')
          setChannel(event.target.value === 'IN_STORE' ? 'IN_STORE' : 'NAVER')
        }}>
          <option value="NAVER">네이버 안내</option>
          <option value="IN_STORE">매장 안내</option>
        </select>
        {error ? <div>
          <p className="error" role="alert">{error}</p>
          <button type="button" className="button secondary fit" onClick={() => {
            setError('')
            setRetry((attempt) => attempt + 1)
          }}>다시 시도</button>
        </div> : guide ? <>
          {guide.message && <p role="status">{guide.message}</p>}
          <ol>{guide.steps.map((step, index) => <li key={index}>
            <div>{step.when && <strong>{step.when} </strong>}{step.text}</div>
            {step.sourceIds.map((sourceId) => {
              const source = guide.sources.find(({ id }) => id === sourceId)
              return source && <a key={source.id} href={source.url} target="_blank" rel="noopener noreferrer">
                {source.title} · {source.publisher}
              </a>
            })}
          </li>)}</ol>
        </> : <p role="status">실행 가이드를 불러오는 중이에요.</p>}
      </>}
    </section>
  </div>
}
