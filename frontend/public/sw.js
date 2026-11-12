const cacheName = 'shop-buddy-offline-v1'
const offlinePage = '/offline.html'

self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.add(offlinePage)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith('shop-buddy-offline-') && key !== cacheName)
      .map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || request.mode !== 'navigate' || url.origin !== self.location.origin
    || url.pathname === '/api' || url.pathname.startsWith('/api/')) return
  event.respondWith(fetch(request).catch(async () => (await caches.match(offlinePage, { cacheName })) ?? Response.error()))
})

function posNotificationUrl(path) {
  const fallback = new URL('/stores', self.location.origin)
  if (typeof path !== 'string') return fallback
  try {
    const url = new URL(path, self.location.origin)
    return url.origin === fallback.origin && url.pathname === fallback.pathname ? url : fallback
  } catch {
    return fallback
  }
}

self.addEventListener('push', event => {
  let message
  try { message = event.data?.json() } catch { /* Show a notification even without a valid path. */ }
  const weekly = message?.kind === 'weekly-pos'
  event.waitUntil(self.registration.showNotification(weekly ? '가게짝꿍 · 주간 POS' : '가게짝꿍', {
    body: weekly ? '지난주 POS 파일을 올려 주세요. 누르면 POS 등록 화면이 열려요.'
      : '테스트 알림이에요. 눌러서 POS 등록 화면을 열어보세요.',
    icon: '/icons/shop-buddy-192.png',
    data: { url: posNotificationUrl(message?.path).href },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = posNotificationUrl(event.notification.data?.url)
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const current = windows.find(client => new URL(client.url).origin === url.origin)
    if (current) {
      const opened = await current.navigate(url.href).catch(() => null)
      if (opened) return opened.focus()
    }
    return self.clients.openWindow(url.href)
  })())
})
