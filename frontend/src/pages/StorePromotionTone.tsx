import { useEffect, useState, type FormEvent } from 'react'
import { fetchStorePromotionTone, saveStorePromotionTone } from '../api/shop'
import { promotionTones, type PromotionTone } from '../data/shop'

export function StorePromotionTone({ auth, storeId }: { auth: string; storeId: string }) {
  const [tone, setTone] = useState<PromotionTone>('PLAIN')
  const [avoidPhrases, setAvoidPhrases] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetchStorePromotionTone(auth, storeId, controller.signal).then(saved => {
      if (controller.signal.aborted) return
      setTone(saved.tone ?? 'PLAIN')
      setAvoidPhrases(saved.avoidPhrases)
      setLoading(false)
    }).catch(() => {
      if (controller.signal.aborted) return
      setError('매장 말투를 불러오지 못했어요. 설정을 닫았다가 다시 열어 주세요.')
      setLoadFailed(true)
      setLoading(false)
    })
    return () => controller.abort()
  }, [auth, storeId])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading || loadFailed || saving) return
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const saved = await saveStorePromotionTone(auth, storeId, {tone, avoidPhrases})
      setAvoidPhrases(saved.avoidPhrases)
      setMessage('매장 홍보 말투를 저장했어요.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '매장 말투를 저장하지 못했어요.')
    } finally {
      setSaving(false)
    }
  }

  return <form className="receipt form-stack" onSubmit={save}>
    <h3>매장 홍보 말투</h3>
    <p className="muted">새 홍보 초안에 사용할 기본 말투예요. 4번 화면에서 게시물마다 바꿀 수 있어요.</p>
    <fieldset disabled={loading || loadFailed || saving} className="form-stack">
      <label>기본 말투<select value={tone} onChange={event => { setTone(event.target.value as PromotionTone); setMessage('') }}>
        {promotionTones.map(({value, label}) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>피하고 싶은 표현<textarea rows={2} maxLength={500} value={avoidPhrases} onChange={event => {
        setAvoidPhrases(event.target.value); setMessage('')
      }} placeholder="예: 놓치지 마세요, 지금이 기회" /></label>
      <small className="muted">쉼표나 줄바꿈으로 구분해 주세요. 메뉴명·가격·수량·기간은 유지돼요.</small>
    </fieldset>
    <button type="submit" className="button primary small" disabled={loading || loadFailed || saving}>
      {saving ? '저장 중…' : '홍보 말투 저장'}
    </button>
    {loading && <p role="status">매장 말투를 불러오는 중이에요.</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="error">{error}</p>}
  </form>
}
