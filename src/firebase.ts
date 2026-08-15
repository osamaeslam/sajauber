const FIREBASE_DISABLED = true;

export const getMessagingInstance = () => {
  console.warn('[Firebase] Messaging instance requested but disabled');
  return null;
};

export const getFCMServiceWorkerRegistration = async () => {
  console.warn('[Firebase] Service worker registration skipped');
  return null;
};

export const getFCMToken = async () => {
  console.warn('[Firebase] Token request skipped');
  return null;
};

export const onFCMForegroundMessage = (callback: (payload: any) => void) => {
  console.warn('[Firebase] Foreground message listener skipped');
  return () => {};
};