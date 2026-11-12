import { useEffect, useState } from 'react'
import { fetchPushTestConfig, sendPushTest } from '../api/shop'
import { useStandaloneApp } from './useStandaloneApp'

type PushSettings = {
  manager: PushManager
  key: Uint8Array<ArrayBuffer>
}

export function PushTestControl({ auth }: { auth: string }) {
  const standalone = useStandaloneApp()
  const [settings, setSettings] = useState<PushSettings>()
  const [sending, setSending] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const [message, setMessage] = useState('')
  const supported = standalone && 'standalone' in navigator && navigator.standalone === true
    && window.isSecureContext && 'serviceWorker' in navigator
    && 'PushManager' in window && 'Notification' in window

  useEffect(() => {
    if (!supported) return
    const controller = new AbortController()
    Promise.all([fetchPushTestConfig(auth, controller.signal), navigator.serviceWorker.ready])
      .then(([config, registration]) => {
        if (!config.publicKey || controller.signal.aborted) return
        const base64 = config.publicKey.replace(/-/g, '+').replace(/_/g, '/')
        const bytes = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
        setSettings({ manager: registration.pushManager, key: Uint8Array.from(bytes, value => value.charCodeAt(0)) })
      }).catch(() => { /* The existing in-app notifications remain available. */ })
    return () => controller.abort()
  }, [auth, supported])

  useEffect(() => {
    if (!retryAt) return
    const timer = window.setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [retryAt])

  if (!supported || !settings) return null

  async function test(settings: PushSettings) {
    setSending(true)
    setMessage('')
    try {
      const subscription = await settings.manager.subscribe({ userVisibleOnly: true, applicationServerKey: settings.key })
      const { delaySeconds } = await sendPushTest(auth, subscription.toJSON())
      setRetryAt(Date.now() + (delaySeconds + 10) * 1000)
      setMessage(`${delaySeconds}초 뒤에 테스트 알림을 보내요. 홈 화면으로 나가 아이폰을 잠가 보세요.`)
    } catch (error) {
      setMessage(Notification.permission === 'denied'
        ? '아이폰 설정의 알림에서 가게짝꿍 알림을 허용해 주세요.'
        : error instanceof Error && error.name !== 'NotAllowedError' ? error.message : '알림을 허용한 뒤 다시 눌러 주세요.')
    } finally {
      setSending(false)
    }
  }

  return <div className="workspace-push-test">
    <button type="button" className="text-button" disabled={sending || retryAt > Date.now()}
      onClick={() => void test(settings)}>{sending ? '알림 준비 중…' : '아이폰 테스트 알림 받기'}</button>
    {message && <p role="status">{message}</p>}
  </div>
}
