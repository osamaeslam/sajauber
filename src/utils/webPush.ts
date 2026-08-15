const VAPID_PUBLIC_KEY = import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY;

if (!VAPID_PUBLIC_KEY) {
  console.warn('Missing VITE_WEB_PUSH_VAPID_PUBLIC_KEY environment variable. Push notifications will not work.');
}

export const isWebPushSupported = (): boolean => {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
};

export const getVapidPublicKey = (): string => VAPID_PUBLIC_KEY;

export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!isWebPushSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  return false;
};

export const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = typeof window !== 'undefined' ? window.atob(base64) : Buffer.from(base64, 'base64').toString('binary');
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
};

export const subscribeToPush = async (registration: ServiceWorkerRegistration): Promise<PushSubscription | null> => {
  if (!registration.pushManager || !VAPID_PUBLIC_KEY) return null;
  const permission = await requestNotificationPermission();
  if (!permission) return null;

  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  try {
    const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    return await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  } catch (err) {
    console.warn('[webPush] Push subscription failed:', err);
    return null;
  }
};

export const unsubscribeFromPush = async (registration: ServiceWorkerRegistration): Promise<boolean> => {
  const existing = await registration.pushManager.getSubscription();
  if (!existing) return false;
  const success = await existing.unsubscribe();
  return success;
};

export const getPushSubscriptionJson = async (registration: ServiceWorkerRegistration): Promise<any | null> => {
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return null;
  return subscription.toJSON();
};
