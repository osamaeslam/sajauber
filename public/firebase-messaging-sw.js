importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
});

const messaging = firebase.messaging();

messaging.setBackgroundMessageHandler((payload) => {
  console.log('[FCM SW] Background message:', payload);
  try {
    const title = payload.notification?.title || 'Ezz Ride';
    const options = {
      body: payload.notification?.body || '',
      icon: payload.notification?.icon || '/ezz_taxi_icon.jpg',
      badge: '/ezz_taxi_icon.jpg',
      data: payload.data || {},
      requireInteraction: true,
      silent: false,
      vibrate: [300, 100, 300, 100, 400],
    };
    self.registration.showNotification(title, options);
  } catch (e) {
    console.warn('[FCM SW] Background notification failed:', e);
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
