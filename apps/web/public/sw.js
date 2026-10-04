self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  // Re-issuing a POST (the admin roster) via respondWith(fetch(event.request))
  // never settles in WebKit: the upload stream stays pending, so /admin/signups
  // sits on "Зареждаме записаните…". The home counts use a bodyless call and
  // still return. Leave non-GET and server functions to the browser.
  if (event.request.method !== 'GET' || url.pathname.startsWith('/_serverFn/')) return
  event.respondWith(fetch(event.request))
})
