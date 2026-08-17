// Must live at the site root — this is a Firebase Cloud Messaging
// requirement, not a project convention. Config values can't reach a
// service worker via process.env (there's no bundler step for files under
// public/), so useFCM.ts passes them as URL query params when it registers
// this worker, and they're read from `self.location.search` here.
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

const params = new URLSearchParams(self.location.search)
firebase.initializeApp({
  apiKey: params.get('apiKey'),
  authDomain: params.get('authDomain'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
})

const messaging = firebase.messaging()

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title ?? 'SentinelX'
  self.registration.showNotification(title, {
    body: payload.notification?.body,
    icon: '/logo-icon.png',
    data: payload.data,
  })
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil(clients.openWindow(url))
})
