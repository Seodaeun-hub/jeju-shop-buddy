import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { fetchExecutionReminders, fetchPromotionImpact, listStores } from '../api/shop'
import { describeMissingPos, loadPromotionArchive, posLibraryPath, promotionArchiveUpdated, reconcilePromotionArchive, resultsDataChanged, seoulDate, showWorkspaceNotifications } from '../data/promotionArchive'
import { addDays } from '../data/shop'

type Notification = { id: string; category: string; title: string; message: string; to: string }

async function loadNotifications(auth: string, signal: AbortSignal) {
  const [stores, plans] = await Promise.all([listStores(auth, signal), fetchExecutionReminders(auth, signal)])
  const today = seoulDate()
  const weekday = new Date(today).getUTCDay()
  const week = addDays(today, -((weekday + 6) % 7))
  const weekly: Notification[] = stores.map(store => ({
    id: `weekly:${store.id}:${week}`, category: '주간 POS', title: store.name,
    message: '지난주 POS를 보관해 두면 종료된 행사 결과를 자동으로 확인할 수 있어요.',
    to: posLibraryPath(store.id, { date: addDays(week, -1), upload: {} }),
  }))
  const notices: Notification[] = []
  const archives = new Map<string, Awaited<ReturnType<typeof loadPromotionArchive>>>()
  let incomplete = false
  for (const plan of plans) {
    signal.throwIfAborted()
    if (!plan.promotion && plan.hasSalesResult) continue
    const query = new URLSearchParams({ id: plan.planId, analysisId: plan.analysisId })
    const resultTo = '/results?' + query
    const title = `${plan.storeName} · ${plan.title || '실행 계획'}`
    const due = addDays(plan.endDate, 1)
    notices.push({ id: `due:${plan.planId}:${due}`, category: '결과 확인일', title,
      message: `${due}부터 실행 결과를 확인할 수 있어요.`, to: resultTo })
    if (!plan.promotion) continue
    try {
      let impact = await fetchPromotionImpact(auth, plan.planId, signal)
      if (!impact.publication) {
        notices.push({ id: `publication:${plan.planId}`, category: '게시 기록 필요', title,
          message: '홍보 게시일을 기록하면 POS 비교 기간을 확인할 수 있어요.', to: '/execution?' + query })
        continue
      }
      if (impact.afterReady && (!impact.beforeTotals || !impact.afterTotals)) {
        let archive = archives.get(plan.storeId)
        if (!archive) {
          archive = await loadPromotionArchive(auth, plan.storeId, signal)
          archives.set(plan.storeId, archive)
        }
        const reconciliation = await reconcilePromotionArchive(auth, plan.planId, impact, archive, signal)
        impact = reconciliation.impact
        if (reconciliation.saved) window.dispatchEvent(new CustomEvent(promotionArchiveUpdated, { detail: plan.planId }))
        const missing = describeMissingPos(reconciliation.missing)
        if (missing) notices.push({
          id: `missing:${plan.planId}:${impact.productName}:${missing}`, category: 'POS 자료 필요', title,
          message: `${missing} 상품 주문 POS를 올려 주세요.`,
          to: posLibraryPath(plan.storeId, { date: reconciliation.missing[0].end, kind: 'PRODUCT',
            upload: { missingStart: reconciliation.missing[0].start, planId: plan.planId, analysisId: plan.analysisId } }),
        })
      }
      if (impact.beforeTotals && impact.afterTotals) notices.push({
        id: `ready:${plan.planId}:${impact.productName}:${impact.before?.start}:${impact.after?.start}`,
        category: '결과 준비 완료', title, message: '행사 전후 판매량과 실판매금액을 확인해 보세요.', to: resultTo,
      })
    } catch {
      signal.throwIfAborted()
      incomplete = true
    }
  }
  return { items: [...notices, ...weekly], incomplete }
}

function readSeen(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function WorkspaceNotifications({ auth, email }: { auth: string; email: string }) {
  const key = `shop-buddy:seen-notifications:${email}`
  const [seen, setSeen] = useState(() => readSeen(key))
  const [items, setItems] = useState<Notification[]>()
  const [error, setError] = useState(false)
  const [revision, setRevision] = useState(0)
  const panel = useRef<HTMLDetailsElement>(null)
  const trigger = useRef<HTMLElement>(null)

  useEffect(() => {
    const controller = new AbortController()
    loadNotifications(auth, controller.signal).then(result => {
      if (controller.signal.aborted) return
      setItems(result.items)
      setError(result.incomplete)
    }).catch(() => {
      if (!controller.signal.aborted) setError(true)
    })
    return () => controller.abort()
  }, [auth, revision])

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, 120_000)
    window.addEventListener('focus', refresh)
    window.addEventListener(resultsDataChanged, refresh)
    const showNotifications = () => {
      if (panel.current) panel.current.open = true
      trigger.current?.focus()
    }
    window.addEventListener(showWorkspaceNotifications, showNotifications)
    const outside = (event: PointerEvent) => {
      if (panel.current?.open && event.target instanceof Node && !panel.current.contains(event.target)) {
        panel.current.open = false
      }
    }
    document.addEventListener('pointerdown', outside)
    return () => {
      window.clearInterval(poll)
      window.removeEventListener('focus', refresh)
      window.removeEventListener(resultsDataChanged, refresh)
      window.removeEventListener(showWorkspaceNotifications, showNotifications)
      document.removeEventListener('pointerdown', outside)
    }
  }, [])

  function markRead(ids: string[]) {
    const next = [...new Set([...seen, ...ids])].slice(-500)
    setSeen(next)
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* Reading still works for this visit. */ }
  }

  const unread = items?.filter(item => !seen.includes(item.id)).length ?? 0
  const close = () => {
    if (panel.current) panel.current.open = false
  }

  return <details className="workspace-notifications" ref={panel} onKeyDown={event => {
    if (event.key === 'Escape') { close(); trigger.current?.focus() }
  }}>
    <summary ref={trigger} aria-label={unread ? `알림, 읽지 않은 알림 ${unread}개` : '알림'}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </svg>
      {unread > 0 && <span className="workspace-notification-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
    </summary>
    <section className="workspace-notification-panel" aria-label="가게짝꿍 알림">
      <div className="workspace-notification-heading">
        <h2>알림</h2>
        {items && unread > 0 && <button type="button" className="text-button" onClick={() => markRead(items.map(item => item.id))}>모두 읽기</button>}
      </div>
      {!items && !error && <p role="status">알림을 확인하고 있어요.</p>}
      {error && <p>일부 알림을 불러오지 못했어요. <button type="button" className="text-button"
        onClick={() => setRevision(value => value + 1)}>다시 불러오기</button></p>}
      {items?.length === 0 && !error && <p>새로 확인할 알림이 없어요.</p>}
      {items && items.length > 0 && <ul>{items.map(item => <li key={item.id}>
        <Link to={item.to} data-unread={!seen.includes(item.id)} onClick={() => { markRead([item.id]); close() }}>
          <span>{item.category}</span><strong>{item.title}</strong><span>{item.message}</span>
        </Link>
      </li>)}</ul>}
    </section>
  </details>
}
