import { useEffect, useRef, useCallback } from 'react';
import { subscribeToPush, unsubscribeFromPush, getPushSubscriptionJson, isWebPushSupported, requestNotificationPermission } from '../utils/webPush';
import { savePushSubscription, removePushSubscription, sendWebPushToDriver } from '../supabaseService';

export const useWebPush = (driverId: string | undefined, supabaseConnected: boolean) => {
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const ensureRegistration = useCallback(async () => {
    if (!('serviceWorker' in navigator)) return null;
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      let reg = registrations.find((r) => r.scope === `${window.location.origin}/`) || registrations[0];
      if (!reg) {
        reg = await navigator.serviceWorker.register('/sw.js');
      }
      registrationRef.current = reg;
      return reg;
    } catch (err) {
      console.warn('[useWebPush] service worker registration failed:', err);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!driverId || !isWebPushSupported()) return;
    let cancelled = false;

    const init = async () => {
      try {
        const reg = await ensureRegistration();
        if (cancelled || !reg) return;

        const granted = await requestNotificationPermission();
        if (!granted) return;

        const subscription = await subscribeToPush(reg);
        if (!subscription) return;

        const json = subscription.toJSON();
        if (!supabaseConnected) return;

        await savePushSubscription(driverId, json, navigator.userAgent);
      } catch (err) {
        console.warn('[useWebPush] Initialization failed:', err);
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [driverId, supabaseConnected, ensureRegistration]);

  const sendPushToDriver = useCallback(
    async (driverIdToNotify: string, payload: any) => {
      if (!supabaseConnected) return;
      return sendWebPushToDriver(driverIdToNotify, payload);
    },
    [supabaseConnected]
  );

  return { sendPushToDriver, ensureRegistration };
};
