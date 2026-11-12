import { useEffect, useState } from 'react'
import { disableResultPush, disableWeeklyPosPush, enableResultPush, enableWeeklyPosPush, fetchPushConfig, sendPushTest } from '../api/shop'
import { useStandaloneApp } from './useStandaloneApp'

type PushSettings = {
  manager: PushManager
  key: Uint8Array<ArrayBuffer>
  schedule: string
}

export function PushControls({ auth }: { auth: string }) {
  const standalone = useStandaloneApp()
  const [settings, setSettings] = useState<PushSettings>()
  const [busy, setBusy] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [resultEnabled, setResultEnabled] = useState(false)
  const [retryAt, setRetryAt] = useState(0)
  const [message, setMessage] = useState('')
  const supported = standalone && 'standalone' in navigator && navigator.standalone === true
    && window.isSecureContext && 'serviceWorker' in navigator
    && 'PushManager' in window && 'Notification' in window

  useEffect(() => {
    if (!supported) return
    const controller = new AbortController()
    Promise.all([fetchPushConfig(auth, controller.signal), navigator.serviceWorker.ready])
      .then(([config, registration]) => {
        if (!config.publicKey || controller.signal.aborted) return
        const base64 = config.publicKey.replace(/-/g, '+').replace(/_/g, '/')
        const bytes = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))
        setEnabled(config.weeklyEnabled)
        setResultEnabled(config.resultEnabled)
        setSettings({ manager: registration.pushManager,
          key: Uint8Array.from(bytes, value => value.charCodeAt(0)), schedule: config.weeklySchedule })
      }).catch(() => { /* The existing in-app notifications remain available. */ })
    return () => controller.abort()
  }, [auth, supported])

  useEffect(() => {
    if (!retryAt) return
    const timer = window.setTimeout(() => setRetryAt(0), Math.max(0, retryAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [retryAt])

  if (!supported || !settings) return null

  async function changePush(action: 'enable' | 'disable' | 'test', settings: PushSettings) {
    setBusy(true)
    setMessage('')
    try {
      if (action === 'disable') {
        await disableWeeklyPosPush(auth)
        setEnabled(false)
        setMessage('주간 POS 푸시를 껐어요.')
        return
      }
      const subscription = await settings.manager.subscribe({ userVisibleOnly: true, applicationServerKey: settings.key })
      if (action === 'enable') {
        await enableWeeklyPosPush(auth, subscription.toJSON())
        setEnabled(true)
        setMessage('주간 POS 푸시를 켰어요. 앱을 닫아도 받을 수 있어요.')
      } else {
        const { delaySeconds } = await sendPushTest(auth, subscription.toJSON())
        setRetryAt(Date.now() + (delaySeconds + 10) * 1000)
        setMessage(`${delaySeconds}초 뒤에 테스트 알림을 보내요. 홈 화면으로 나가 아이폰을 잠가 보세요.`)
      }
    } catch (error) {
      setMessage(action !== 'disable' && Notification.permission === 'denied'
        ? '아이폰 설정의 알림에서 가게짝꿍 알림을 허용해 주세요.'
        : error instanceof Error && error.name !== 'NotAllowedError' ? error.message : '알림을 허용한 뒤 다시 눌러 주세요.')
    } finally {
      setBusy(false)
    }
  }

  async function changeResultPush(settings: PushSettings) {
    setBusy(true)
    setMessage('')
    try {
      if (resultEnabled) {
        await disableResultPush(auth)
        setResultEnabled(false)
        setMessage('실행 결과 푸시를 껐어요.')
      } else {
        const subscription = await settings.manager.subscribe({ userVisibleOnly: true, applicationServerKey: settings.key })
        await enableResultPush(auth, subscription.toJSON())
        setResultEnabled(true)
        setMessage('실행 결과가 준비되거나 POS 자료가 필요할 때 알려드려요.')
      }
    } catch (error) {
      setMessage(Notification.permission === 'denied'
        ? '아이폰 설정의 알림에서 가게짝꿍 알림을 허용해 주세요.'
        : error instanceof Error && error.name !== 'NotAllowedError' ? error.message : '알림을 허용한 뒤 다시 눌러 주세요.')
    } finally {
      setBusy(false)
    }
  }

  return <div className="workspace-push-controls">
    <p>{settings.schedule} · 주간 POS 푸시</p>
    <div>
      <button type="button" className="text-button" disabled={busy}
        onClick={() => void changePush(enabled ? 'disable' : 'enable', settings)}>
        {enabled ? '주간 POS 알림 끄기' : '주간 POS 알림 켜기'}
      </button>
      <button type="button" className="text-button" disabled={busy}
        onClick={() => void changeResultPush(settings)}>{resultEnabled ? '실행 결과 알림 끄기' : '실행 결과 알림 켜기'}</button>
      <button type="button" className="text-button" disabled={busy || retryAt > Date.now()}
        onClick={() => void changePush('test', settings)}>아이폰 테스트 알림 받기</button>
    </div>
    {message && <p role="status">{message}</p>}
  </div>
}
