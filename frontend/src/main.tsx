import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router'
import { App } from './App'
import { GuestQrMenu } from './pages/GuestQrMenu'
import './styles/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('React root is missing')

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/menu/:publicId" element={<GuestQrMenu />} />
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)

if (window.isSecureContext && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch((error: unknown) => {
    console.warn('가게짝꿍 오프라인 안내를 등록하지 못했어요.', error)
  })
}
