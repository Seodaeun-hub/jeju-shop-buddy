import { useEffect, useRef, useState } from 'react'

type SearchMode = 'address' | 'place'
type AddressMatch = { address: string; area: string; name?: string }

// Spring resolves the NAVER result to the same district used in the market data.
async function searchAddresses(query: string, mode: SearchMode, signal: AbortSignal): Promise<AddressMatch[]> {
  const params = new URLSearchParams({ query })
  const endpoint = mode === 'place' ? '/api/addresses/places' : '/api/addresses'
  const response = await fetch(`${endpoint}?${params}`, { signal })
  if (!response.ok) throw new Error('Address search is unavailable')
  const results: unknown = await response.json()
  if (!Array.isArray(results) || !results.every((match) => match &&
    typeof match.address === 'string' && typeof match.area === 'string' &&
    (mode === 'address' || (typeof match.name === 'string' && match.name.length > 0)))) {
    throw new Error('Invalid address results')
  }
  return results
}

export function AddressField({ address, area, onChange }: {
  address: string
  area?: string
  onChange: (address: string, area?: string) => void
}) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<SearchMode>('address')
  const [manual, setManual] = useState(false)
  const [results, setResults] = useState<AddressMatch[]>([])
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const request = useRef<AbortController | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const addressInput = useRef<HTMLInputElement>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  useEffect(() => () => request.current?.abort(), [])

  function resetSearch() {
    request.current?.abort()
    setLoading(false)
    setResults([])
    setMessage('')
  }

  function openSearch() {
    if (!dialog.current || dialog.current.open) return
    resetSearch()
    setMode('address')
    setQuery(address.slice(0, 200))
    dialog.current.showModal()
    searchInput.current?.focus()
  }

  function changeMode(nextMode: SearchMode) {
    if (mode === nextMode) return
    resetSearch()
    setMode(nextMode)
    setQuery('')
    searchInput.current?.focus()
  }

  function enterManually() {
    dialog.current?.close()
    setManual(true)
    addressInput.current?.focus()
  }

  async function search() {
    const searchTerm = query.trim()
    if (searchTerm.length < 2) {
      setMessage('검색어를 두 글자 이상 입력해 주세요.')
      return
    }
    resetSearch()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    try {
      const matches = await searchAddresses(searchTerm, mode, controller.signal)
      if (controller.signal.aborted) return
      setResults(matches)
      setMessage(matches.length ? '목록에서 가게 주소를 골라주세요.' : '검색 결과가 없어요. 검색어를 바꾸거나 주소를 직접 입력해 주세요.')
    } catch {
      if (!controller.signal.aborted) {
        setMessage(mode === 'place'
          ? '가게 이름 검색에 연결할 수 없어요. 도로명·지번으로 검색하거나 주소를 직접 입력해 주세요.'
          : '주소 검색에 연결할 수 없어요. 주소를 직접 입력할 수 있어요.')
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  return <div className="address-field">
    <label htmlFor="store-address">매장 주소</label>
    <div className="address-search">
      <input ref={addressInput} id="store-address" required maxLength={255} value={address} readOnly={!manual}
        placeholder={manual ? '도로명이나 지번을 입력하세요' : '눌러서 주소를 검색하세요'}
        aria-haspopup={manual ? undefined : 'dialog'}
        onClick={manual ? undefined : openSearch}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (!manual && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            openSearch()
          }
        }} />
      <button className="button secondary" type="button" aria-haspopup="dialog" onClick={openSearch}>주소 검색</button>
    </div>
    {!manual && <button className="text-button" type="button" onClick={enterManually}>주소 직접 입력</button>}
    {area && <small className="address-area">상권 비교 지역 · {area}</small>}
    <dialog ref={dialog} className="time-dialog" aria-labelledby="address-search-title" onClose={resetSearch}>
      <div className="form-stack">
        <div className="section-top">
          <h2 id="address-search-title">매장 주소 검색</h2>
          <button className="button small secondary" type="button" onClick={() => dialog.current?.close()}>닫기</button>
        </div>
        <div className="chips" role="group" aria-label="검색 방법">
          <button className="chip" type="button" aria-pressed={mode === 'address'} onClick={() => changeMode('address')}>도로명·지번</button>
          <button className="chip" type="button" aria-pressed={mode === 'place'} onClick={() => changeMode('place')}>가게 이름</button>
        </div>
        <label htmlFor="address-query">{mode === 'place' ? '제주 가게 이름' : '도로명 또는 지번'}</label>
        <div className="address-search">
          <input ref={searchInput} id="address-query" maxLength={200} value={query}
            placeholder={mode === 'place' ? '예: 애월 가게이름' : '예: 애월해안로 123'}
            onChange={event => {
              resetSearch()
              setQuery(event.target.value)
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                event.preventDefault()
                if (!loading) void search()
              }
            }} />
          <button className="button primary" type="button" disabled={loading} onClick={() => void search()}>
            {loading ? '검색 중…' : '검색'}
          </button>
        </div>
        {message && <p className="muted" role="status">{message}</p>}
        {results.length > 0 && <ul className="address-results" aria-label="주소 검색 결과">
          {results.map(match => <li key={`${match.name ?? ''}/${match.address}/${match.area}`}><button type="button" onClick={() => {
            onChange(match.address, match.area || undefined)
            setManual(false)
            dialog.current?.close()
            addressInput.current?.focus()
          }}>{match.name && <><strong>{match.name}</strong><br /></>}{match.address}</button></li>)}
        </ul>}
        <button className="text-button" type="button" onClick={enterManually}>주소 직접 입력</button>
      </div>
    </dialog>
  </div>
}
