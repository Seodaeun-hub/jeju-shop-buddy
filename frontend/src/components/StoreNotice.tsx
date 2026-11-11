import { useEffect, useRef, useState } from 'react'
import { generateStoreNotice, type StoreNoticeDraft } from '../api/shop'
import type { CustomerNotice } from '../data/shop'
import { suggestCustomerNotice } from './CustomerNotice'
import { Citrus } from './ui'

const fieldPattern = /\[([^\[\]\n]+)\]/g
const defaultNotice = suggestCustomerNotice('주문 가능 시간')

export function StoreNotice({ store, suggestion, auth, planId }: {
  store: string
  suggestion?: CustomerNotice
  auth?: string
  planId?: string
}) {
  const notice = suggestion ?? defaultNotice
  const template = notice?.text ?? ''
  const fields = Array.from(new Set(Array.from(template.matchAll(fieldPattern), match => match[1])))
  const previewDialog = useRef<HTMLDialogElement>(null)
  const pending = useRef<AbortController | null>(null)
  const [draft, setDraft] = useState<StoreNoticeDraft>()
  const [loading, setLoading] = useState(false)
  const [fallback, setFallback] = useState(false)
  useEffect(() => () => pending.current?.abort(), [])
  const [values, setValues] = useState<Record<string, string>>({})
  const [customText, setCustomText] = useState(template)
  const complete = fields.length === 0
    ? Boolean(customText.trim())
    : fields.every(field => Boolean(values[field]?.trim()))
  const message = fields.length > 0
    ? template.replace(fieldPattern, (_, field: string) => values[field]?.trim() ?? '')
    : customText.trim()

  async function makeNotice() {
    if (!complete || pending.current) return
    const localDraft = { title: fields.includes('주문 가능 시간') ? '식사 주문 안내' : '손님 안내', message }
    if (!auth || !planId) {
      setDraft(localDraft)
      return
    }

    const controller = new AbortController()
    pending.current = controller
    setLoading(true)
    setFallback(false)
    setDraft(undefined)
    try {
      const inputs = Object.fromEntries(fields.map(field => [field, values[field].trim()]))
      const result = await generateStoreNotice(auth, planId, fields.length > 0 ? template : message, inputs, controller.signal)
      if (!controller.signal.aborted) setDraft(result)
    } catch {
      if (!controller.signal.aborted) {
        setDraft(localDraft)
        setFallback(true)
      }
    } finally {
      pending.current = null
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  function clearDraft() {
    setDraft(undefined)
    setFallback(false)
  }

  const [primaryField, ...otherFields] = fields
  const noticeContent = <span className="store-notice-paper">
    <span className="store-notice-paper-title">{draft?.title}</span>
    {primaryField && <span className="store-notice-primary">
      <span>{primaryField}</span>
      <strong>{values[primaryField]?.trim()}</strong>
    </span>}
    {otherFields.length > 0 && <span className="store-notice-facts">{otherFields.map(field =>
      <span className="store-notice-fact" key={field}>
        <span>{field === '마감 시간' && primaryField === '주문 가능 시간' ? '마지막 주문' : field}</span>
        <strong>{values[field]?.trim()}</strong>
      </span>
    )}</span>}
    <span className="store-notice-message">{draft?.message}</span>
    <span className="store-notice-footer"><Citrus /><span>{store}</span></span>
  </span>


  return <section className="form-stack store-notice" aria-labelledby="store-notice-title">
    <div className="ruled"><h2 id="store-notice-title">매장에 붙일 안내문</h2></div>
    {notice?.placement && <p><strong>붙일 곳</strong> · {notice.placement}</p>}
    {fields.length > 0 ? fields.map(field => <label key={field}>
      {field}
      <input type="text" value={values[field] ?? ''} maxLength={120} disabled={loading}
        onChange={event => {
          const value = event.target.value
          setValues(current => ({ ...current, [field]: value }))
          clearDraft()
        }} />
    </label>) : <label>안내 문구
      <textarea rows={3} maxLength={500} value={customText} disabled={loading} onChange={event => {
        setCustomText(event.target.value)
        clearDraft()
      }} />
    </label>}
    <button type="button" className="button primary" disabled={!complete || loading} onClick={() => void makeNotice()}>
      {loading ? '안내문 만드는 중…' : draft ? '안내문 다시 만들기' : '안내문 만들기'}
    </button>
    {loading && <p role="status">짝꿍이 입력한 매장 정보로 안내문을 만들고 있어요.</p>}
    {fallback && <p role="status">AI 연결이 원활하지 않아 입력한 정보로 기본 안내문을 만들었어요.</p>}
    {draft && <>
      <button type="button" className="store-notice-print" aria-label="안내문 확대 보기"
        aria-haspopup="dialog" onClick={() => previewDialog.current?.showModal()}>
        {noticeContent}
        <span className="store-notice-zoom">확대 보기</span>
      </button>
      <dialog ref={previewDialog} className="store-notice-dialog" aria-labelledby="store-notice-preview-title">
        <div className="section-top">
          <h3 id="store-notice-preview-title">안내문 미리보기</h3>
          <form method="dialog"><button type="submit" className="button secondary small">닫기</button></form>
        </div>
        {noticeContent}
      </dialog>
    </>}
    <button type="button" className="button secondary" disabled={!draft || loading} onClick={() => window.print()}>
      인쇄 / PDF 저장
    </button>
  </section>
}
