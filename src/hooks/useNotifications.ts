import { useEffect, useRef } from 'react';
import { Trip } from '../types';
import {
  subscribeToActiveTrips,
  fetchActiveTrip,
  saveActiveTrip,
  saveTripToHistory,
} from '../supabaseService';
import {
  playNotificationSound,
  speakText,
  sendNativeNotification,
  startTitleFlash,
  stopTitleFlash,
  triggerVibration,
  notifyRideRequest,
  stopLoudRepeatingAlarm,
  isNotificationRateLimited,
} from '../utils/notifications';

export const useNotifications = (
  activeTrip: Trip | null,
  driverIsLoggedIn: boolean,
  selectedDriverId: string | undefined,
  supabaseConnected: boolean,
  dataSaverMode: boolean,
  lang: 'ar' | 'en',
  setActiveTripWithTracking: (updater: any) => void,
  triggerToast: (title: string, message: string, type: string) => void
) => {
  const notifiedEventsRef = useRef<Set<string>>(new Set());
  const lastNotifiedTripIdRef = useRef<string | null>(null);
  const lastNotifiedOfferedDriverIdRef = useRef<string | null>(null);
  const lastTripCompletedRef = useRef(false);
  const lastTripCancelledRef = useRef(false);
  const lastTripStatusBeforeNullRef = useRef<string | null>(null);
  const alarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopAlarm = () => {
    if (alarmTimerRef.current) {
      clearTimeout(alarmTimerRef.current);
      alarmTimerRef.current = null;
    }
    stopLoudRepeatingAlarm();
  };

  useEffect(() => {
    if (!activeTrip) {
      const prevStatus = lastTripStatusBeforeNullRef.current;
      if (prevStatus === 'COMPLETED' || prevStatus === 'SEARCHING') {
        notifiedEventsRef.current.add('cancelled_notified');
        lastTripStatusBeforeNullRef.current = null;
        return;
      }
      if (prevStatus === 'ACCEPTED' || prevStatus === 'ARRIVED' || prevStatus === 'STARTED') {
        notifiedEventsRef.current.add('cancelled_notified');
        lastTripStatusBeforeNullRef.current = null;
        return;
      }
      if (notifiedEventsRef.current.has('had_trip') && !notifiedEventsRef.current.has('cancelled_notified')) {
        notifiedEventsRef.current.add('cancelled_notified');
        if (lastTripCompletedRef.current) {
          lastTripCompletedRef.current = false;
          return;
        }
        if (lastTripCancelledRef.current) {
          lastTripCancelledRef.current = false;
          return;
        }
        if (!['COMPLETED', 'SEARCHING', 'ACCEPTED', 'ARRIVED', 'STARTED'].includes(prevStatus || '')) {
          playNotificationSound('alert');
          sendNativeNotification('⚠️ تم إلغاء الرحلة', 'تم إلغاء المشوار الحالي من قبل الطرف الآخر.', '❌');
          triggerToast('⚠️ تم إلغاء الرحلة', 'تم إلغاء المشوار الحالي من قبل الطرف الآخر.', 'warning');
        }
      }
      return;
    }

    lastTripStatusBeforeNullRef.current = activeTrip.status;
    notifiedEventsRef.current.add('had_trip');
    notifiedEventsRef.current.delete('cancelled_notified');

    const currentTripId = activeTrip.id;
    const currentStatus = activeTrip.status;
    const isDriverActor = driverIsLoggedIn && activeTrip.driverId === selectedDriverId;

    const statusEventKey = `${currentTripId}_status_${currentStatus}`;

    if (!notifiedEventsRef.current.has(statusEventKey)) {
      if (currentStatus === 'SEARCHING' && driverIsLoggedIn) {
        notifiedEventsRef.current.add(statusEventKey);
        lastTripCompletedRef.current = false;
        lastTripCancelledRef.current = false;
        triggerToast(
          lang === 'ar' ? 'يوجد رحلة جديدة' : 'New trip available',
          lang === 'ar'
            ? `العميل ${activeTrip.riderName} يطلب رحلة من ${activeTrip.pickup?.nameAr || activeTrip.pickup?.nameEn || ''} إلى ${activeTrip.dropoff?.nameAr || activeTrip.dropoff?.nameEn || ''}.`
            : `Rider ${activeTrip.riderName} requests a ride from ${activeTrip.pickup?.nameEn || activeTrip.pickup?.nameAr || ''} to ${activeTrip.dropoff?.nameEn || activeTrip.dropoff?.nameAr || ''}.`,
          'new_trip'
        );
      } else if (currentStatus === 'ACCEPTED' && !isDriverActor) {
        notifiedEventsRef.current.add(statusEventKey);
        playNotificationSound('trip_accepted');
        speakText(
          lang === 'ar'
            ? `تم قبول رحلتك، الكابتن ${activeTrip.driverName || 'عز الدين'} في الطريق إليك الآن.`
            : `Your ride has been accepted. Captain ${activeTrip.driverName || 'Ezz'} is on the way.`,
          lang === 'ar' ? 'ar-EG' : 'en-US'
        );
        sendNativeNotification(
          '🚗 تم قبول رحلتك!',
          `الكابتن ${activeTrip.driverName || 'عز الدين'} في الطريق إليك الآن.`,
          '✅'
        );
        startTitleFlash('🚗 الكابتن قادم!');
        setTimeout(stopTitleFlash, 5000);
        triggerVibration([200, 100, 200, 100, 300]);
        triggerToast(
          '🚗 تم قبول رحلتك!',
          `الكابتن ${activeTrip.driverName || 'عز الدين'} في الطريق إليك الآن.`,
          'success'
        );
      } else if (currentStatus === 'ARRIVED' && !isDriverActor) {
        notifiedEventsRef.current.add(statusEventKey);
        playNotificationSound('trip_accepted');
        triggerVibration([200, 100, 200, 100, 300]);
        speakText(
          lang === 'ar'
            ? 'وصل الكابتن إلى موقعك وهو في انتظارك الآن.'
            : 'The captain has arrived at your location.',
          lang === 'ar' ? 'ar-EG' : 'en-US'
        );
        sendNativeNotification(
          '📍 الكابتن وصل!',
          'الكابتن متواجد في نقطة الركوب الآن بانتظارك.',
          '⭐'
        );
        startTitleFlash('📍 الكابتن وصل!');
        setTimeout(stopTitleFlash, 5000);
        triggerToast(
          '📍 الكابتن وصل!',
          'الكابتن متواجد في نقطة الركوب الآن بانتظارك.',
          'info'
        );
      } else if (currentStatus === 'STARTED' && !isDriverActor) {
        notifiedEventsRef.current.add(statusEventKey);
        playNotificationSound('trip_accepted');
        speakText(
          lang === 'ar'
            ? 'بدأت الرحلة الآن، نتمنى لك مشواراً آمناً.'
            : 'The ride has started, wish you a safe trip.',
          lang === 'ar' ? 'ar-EG' : 'en-US'
        );
        triggerToast(
          '🚀 بدأت الرحلة الآن!',
          'نتمنى لك رحلة سعيدة وآمنة مع كابتن عز.',
          'success'
        );
      } else if (currentStatus === 'COMPLETED' && !isDriverActor) {
        notifiedEventsRef.current.add(statusEventKey);
        lastTripCompletedRef.current = true;
        playNotificationSound('trip_completed');
        speakText(
          lang === 'ar'
            ? 'حمد لله على السلامة، تم اكتمال الرحلة بنجاح وشكراً لاختيارك كابتن عز.'
            : 'Welcome back, trip completed successfully. Thank you for choosing Captain Ezz.',
          lang === 'ar' ? 'ar-EG' : 'en-US'
        );
        sendNativeNotification(
          '🎉 تم اكتمال الرحلة بنجاح!',
          'حمد لله على السلامة، تم اكتمال الرحلة بنجاح. شكراً لك على اختيارك كابتن عز!',
          '✨'
        );
        startTitleFlash('✨ تم اكتمال الرحلة!');
        setTimeout(stopTitleFlash, 5000);
        triggerToast(
          '🎉 تم اكتمال الرحلة بنجاح!',
          'حمد لله على السلامة، تم اكتمال الرحلة بنجاح. شكراً لثقتك بكابتن عز!',
          'success'
        );
      } else if (currentStatus === 'CANCELLED') {
        notifiedEventsRef.current.add(statusEventKey);
        lastTripCancelledRef.current = true;
        playNotificationSound('alert');
        speakText(
          lang === 'ar'
            ? 'تم إلغاء الرحلة.'
            : 'The ride has been cancelled.',
          lang === 'ar' ? 'ar-EG' : 'en-US'
        );
        triggerToast(
          '❌ تم إلغاء الرحلة',
          'تم إلغاء المشوار الحالي.',
          'warning'
        );
      }
    }
  }, [activeTrip, driverIsLoggedIn, selectedDriverId, lang]);

  // Chat message notification
  useEffect(() => {
    if (!activeTrip || !activeTrip.chatMessages || activeTrip.chatMessages.length === 0) return;
    const lastMsg = activeTrip.chatMessages[activeTrip.chatMessages.length - 1];
    if (!lastMsg || typeof lastMsg.id !== 'string' || !lastMsg.text) return;
    if (lastMsg.sender !== (driverIsLoggedIn ? 'RIDER' : 'DRIVER')) {
      const rateKey = `chat_${activeTrip.id}_${lastMsg.id}`;
      if (!isNotificationRateLimited(rateKey)) {
        playNotificationSound('chat_message');
        sendNativeNotification('💬 رسالة جديدة', lastMsg.text, '💬');
      }
    }
  }, [activeTrip?.chatMessages, driverIsLoggedIn]);

  // Loud alarm for new ride request (driver side)
  useEffect(() => {
    if (!driverIsLoggedIn || !activeTrip || activeTrip.status !== 'SEARCHING') {
      stopAlarm();
      return;
    }
    const tripKey = `alarm_${activeTrip.id}`;
    if (!notifiedEventsRef.current.has(tripKey)) {
      notifiedEventsRef.current.add(tripKey);
      const pickupName = activeTrip.pickup?.nameAr || activeTrip.pickup?.nameEn || (typeof activeTrip.pickup === 'string' ? activeTrip.pickup : (lang === 'ar' ? 'الموقع الحالي' : 'Current Location'));
      const dropoffName = activeTrip.dropoff?.nameAr || activeTrip.dropoff?.nameEn || (typeof activeTrip.dropoff === 'string' ? activeTrip.dropoff : (lang === 'ar' ? 'الوجهة' : 'Destination'));

      notifyRideRequest(
        lang === 'ar' ? '🚖 طلب مشوار جديد!' : '🚖 New Ride Request!',
        lang === 'ar'
          ? `من ${pickupName} إلى ${dropoffName} | ${activeTrip.fare} ج.م`
          : `${pickupName} → ${dropoffName} | ${activeTrip.fare} EGP`,
        lang === 'ar' ? 'ar-EG' : 'en-US'
      );
    }
    return stopAlarm;
  }, [driverIsLoggedIn, activeTrip, lang]);

  // Background notification poller (visibility-aware)
  useEffect(() => {
    if (!driverIsLoggedIn || !selectedDriverId || !supabaseConnected) return;

    const pollInterval = dataSaverMode ? 300000 : 60000;
    const interval = setInterval(async () => {
      if (document.hidden) return;
      try {
        const remoteActiveTrip = await fetchActiveTrip(selectedDriverId, 'driver');
        if (!remoteActiveTrip) return;

        if (remoteActiveTrip.status !== 'SEARCHING') {
          if (lastNotifiedTripIdRef.current !== null) {
            lastNotifiedTripIdRef.current = null;
            lastNotifiedOfferedDriverIdRef.current = null;
          }
          return;
        }

        if (remoteActiveTrip.status === 'SEARCHING') {
          const isEligible = remoteActiveTrip.offeredDriverIds?.includes(selectedDriverId);
          const isNewlyOffered = remoteActiveTrip.currentOfferedDriverId === selectedDriverId;
          const needsNotify = lastNotifiedTripIdRef.current !== remoteActiveTrip.id ||
            lastNotifiedOfferedDriverIdRef.current !== remoteActiveTrip.currentOfferedDriverId;

          if (isEligible && needsNotify) {
            lastNotifiedTripIdRef.current = remoteActiveTrip.id;
            lastNotifiedOfferedDriverIdRef.current = remoteActiveTrip.currentOfferedDriverId || null;
            triggerToast(
              lang === 'ar' ? 'يوجد رحلة جديدة' : 'New trip available',
              lang === 'ar'
                ? `العميل ${remoteActiveTrip.riderName} يطلب رحلة من ${remoteActiveTrip.pickup.nameAr}.`
                : `Rider ${remoteActiveTrip.riderName} requests a ride from ${remoteActiveTrip.pickup.nameEn}.`,
              'new_trip'
            );
          }
        }
      } catch {
        // ignore
      }
    }, pollInterval);

    return () => clearInterval(interval);
  }, [driverIsLoggedIn, selectedDriverId, supabaseConnected, dataSaverMode, lang]);

  return {
    notifiedEventsRef,
    lastNotifiedTripIdRef,
    lastNotifiedOfferedDriverIdRef,
    lastTripCompletedRef,
    lastTripCancelledRef,
    lastTripStatusBeforeNullRef,
  };
};
