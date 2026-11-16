import { useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { fetchGuestMenu } from '../api/shop'
import { guestMenuPath, menuLanguages, type GuestMenu } from '../data/qrMenu'
import '../styles/qr-menu.css'

export function GuestQrMenu() {
  const { publicId = '' } = useParams()
  return <MenuPage key={publicId} publicId={publicId} />
}

function MenuPage({ publicId }: { publicId: string }) {
  const [menu, setMenu] = useState<GuestMenu>()
  const [error, setError] = useState('')
  const [language, setLanguage] = useState(() =>
    menuLanguages.find(option => option.id === navigator.language.split('-')[0]) ?? menuLanguages[0])
  const price = new Intl.NumberFormat(language.locale, { style: 'currency', currency: 'KRW' })

  useEffect(() => {
    const request = new AbortController()
    void fetchGuestMenu(publicId, request.signal).then(data => {
      if (!request.signal.aborted) setMenu(data)
    }).catch(failure => {
      if (!request.signal.aborted) setError(failure.message)
    })
    return () => request.abort()
  }, [publicId])

  useEffect(() => {
    if (!menu) return
    const title = document.title
    const pageLanguage = document.documentElement.lang
    document.title = `${menu.storeName} · ${language.heading}`
    document.documentElement.lang = language.locale
    return () => {
      document.title = title
      document.documentElement.lang = pageLanguage
    }
  }, [menu, language])

  return <main className="guest-menu-page" lang={language.locale}>
    {menu ? <>
      <header className="guest-menu-header">
        <h1 lang="ko">{menu.storeName}</h1>
        <nav className="guest-menu-languages" aria-label="Language">
          {menuLanguages.map(option => <button type="button" key={option.id} lang={option.locale}
            aria-pressed={language.id === option.id} onClick={() => setLanguage(option)}>{option.label}</button>)}
        </nav>
      </header>
      <h2>{language.heading}</h2>
      <ul className="guest-menu-list">
        {menu.items.map(item => <li key={item.name}>
          <div>
            <h3>{language.id === 'ko' ? item.name : item.translation[language.id]}</h3>
            {language.id !== 'ko' && <p className="muted" lang="ko">{item.name}</p>}
            <p className="guest-menu-price">{item.priceWon == null ? language.ask : price.format(item.priceWon)}</p>
          </div>
          {item.hasPhoto && <img src={`${guestMenuPath(publicId)}/photos/${item.translation.index}?version=${menu.version}`}
            alt="" width={92} height={92} loading="lazy" />}
        </li>)}
      </ul>
    </> : error ? <p role="alert" lang="ko">{error}</p> : <p role="status">Loading menu…</p>}
  </main>
}
