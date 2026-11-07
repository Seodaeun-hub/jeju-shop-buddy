import { useEffect, useRef, useState } from 'react'

type AddressMatch = { address: string; area: string }

// Spring resolves the NAVER result to the same district used in the market data.
async function searchAddresses(query: string, signal: AbortSignal): Promise<AddressMatch[]> {
  const params = new URLSearchParams({ query })
  const response = await fetch(`/api/addresses?${params}`, { signal })
  if (!response.ok) throw new Error('Address search is unavailable')
  const results: unknown = await response.json()
  if (!Array.isArray(results) || !results.every((match) => match &&
    typeof match.address === 'string' && typeof match.area === 'string')) {
    throw new Error('Invalid address results')
  }
  return results
}

export function AddressField({ address, area, onChange }: {
  address: string
  area?: string
  onChange: (address: string, area?: string) => void
}) {
  const [results, setResults] = useState<AddressMatch[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])

  async function search() {
    const query = address.trim()
    if (query.length < 2) {
      setMessage('도로명이나 지번을 입력해 주세요.')
      return
    }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setResults([])
    setMessage('')
    try {
      const matches = await searchAddresses(query, controller.signal)
      if (controller.signal.aborted) return
      setResults(matches)
      setMessage(matches.length ? '가게 주소를 골라주세요.' : '검색 결과가 없어요. 주소를 확인해 주세요.')
    } catch {
      if (!controller.signal.aborted) setMessage('주소 검색에 연결할 수 없어요. 입력한 주소로 월별 매출 분석을 먼저 시작할 수 있어요.')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  return <div className="address-field">
    <label htmlFor="store-address">매장 주소</label>
    <div className="address-search">
      <input id="store-address" required value={address} placeholder="도로명이나 지번을 입력하세요"
        onChange={(event) => {
          request.current?.abort()
          setLoading(false)
          setResults([])
          setMessage('')
          onChange(event.target.value)
        }} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing && !area) {
            event.preventDefault()
            if (!loading) void search()
          }
        }} />
      <button className="button secondary" type="button" disabled={loading} onClick={search}>{loading ? '검색 중…' : '주소 검색'}</button>
    </div>
    {message && <small className="muted" role="status">{message}</small>}
    {results.length > 0 && <ul className="address-results" aria-label="주소 검색 결과">
      {results.map((match) => <li key={`${match.address}/${match.area}`}><button type="button" onClick={() => {
        onChange(match.address, match.area)
        setResults([])
        setMessage('')
        document.getElementById('store-address')?.focus()
      }}>{match.address}</button></li>)}
    </ul>}
    {area && <small className="address-area">상권 비교 지역 · {area}</small>}
  </div>
}
