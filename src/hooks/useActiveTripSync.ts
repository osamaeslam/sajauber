import { useEffect, useRef } from 'react';
import { Trip } from '../types';
import {
  subscribeToActiveTrips,
  fetchActiveTrip,
} from '../supabaseService';
import { getAdaptivePollingInterval } from '../utils/dataSaver';
import { mergeChatMessages } from '../utils/tripDispatchUtils';

export const useActiveTripSync = ({
  supabaseConnected,
  driverIsLoggedIn,
  selectedDriverId,
  riderId,
  dataSaverMode,
  activeTrip,
  setActiveTripWithTracking,
  dismissedTripIdsRef,
  lastTripCompletedRef,
  lastTripCancelledRef,
  lastLocalStatusChangeRef,
  isMountedRef,
}: {
  supabaseConnected: boolean;
  driverIsLoggedIn: boolean;
  selectedDriverId: string | undefined;
  riderId: string | undefined;
  dataSaverMode: boolean;
  activeTrip: Trip | null;
  setActiveTripWithTracking: (updater: any) => void;
  dismissedTripIdsRef: React.MutableRefObject<Set<string>>;
  lastTripCompletedRef: React.MutableRefObject<boolean>;
  lastTripCancelledRef: React.MutableRefObject<boolean>;
  lastLocalStatusChangeRef: React.MutableRefObject<{ status: string; timestamp: number } | null>;
  isMountedRef: React.MutableRefObject<boolean>;
}) => {
  const TRIP_STATUS_ORDER: Record<string, number> = {
    'IDLE': 0,
    'SEARCHING': 1,
    'ACCEPTED': 2,
    'ARRIVED': 3,
    'STARTED': 4,
    'COMPLETED': 5,
    'CANCELLED': 6,
  };

  const markLocalStatusChange = (status: string) => {
    lastLocalStatusChangeRef.current = { status, timestamp: Date.now() };
  };

  const shouldSkipPollingUpdate = (remoteStatus: string): boolean => {
    const last = lastLocalStatusChangeRef.current;
    if (!last) return false;
    const secondsSinceChange = (Date.now() - last.timestamp) / 1000;
    if (secondsSinceChange > 3) {
      lastLocalStatusChangeRef.current = null;
      return false;
    }
    const remoteOrder = TRIP_STATUS_ORDER[remoteStatus] ?? 0;
    const localOrder = TRIP_STATUS_ORDER[last.status] ?? 0;
    return remoteOrder <= localOrder;
  };

  // Realtime subscription
  useEffect(() => {
    if (!supabaseConnected) return;
    const userId = driverIsLoggedIn ? selectedDriverId : (riderId || undefined);
    const userRole = driverIsLoggedIn ? 'driver' : (riderId ? 'rider' : undefined);
    if (!userId || !userRole) return;

    const sub = subscribeToActiveTrips(
      (trip) => {
        setActiveTripWithTracking((prev: Trip | null) => {
          if (!trip) {
            if (prev && prev.status === 'COMPLETED' && !dismissedTripIdsRef.current.has(prev.id)) {
              return prev;
            }
            return null;
          }
          if (dismissedTripIdsRef.current.has(trip.id)) {
            return null;
          }

          // Strict identity check: trip must belong to this user
          if (userRole === 'rider' && trip.riderId !== userId) {
            return prev;
          }
          if (userRole === 'driver') {
            const isAssigned = trip.driverId === userId;
            const isCurrentOffered = trip.currentOfferedDriverId === userId;
            const isOffered = !!(trip.offeredDriverIds && trip.offeredDriverIds.includes(userId));
            if (!isAssigned && !isCurrentOffered && !isOffered) {
              return prev;
            }
          }

          if (!prev) return trip;
          if (prev.status === 'COMPLETED' && !dismissedTripIdsRef.current.has(prev.id)) {
            return prev;
          }
          if (prev.id !== trip.id) return trip;

          if (prev.status === 'COMPLETED' || trip.status === 'COMPLETED') {
            return {
              ...prev,
              ...trip,
              riderRatingToDriver: trip.riderRatingToDriver ?? prev.riderRatingToDriver,
              riderFeedbackTags: trip.riderFeedbackTags?.length ? trip.riderFeedbackTags : prev.riderFeedbackTags,
              riderFeedbackComment: trip.riderFeedbackComment || prev.riderFeedbackComment,
              driverRatingToRider: trip.driverRatingToRider ?? prev.driverRatingToRider,
              driverFeedbackTags: trip.driverFeedbackTags?.length ? trip.driverFeedbackTags : prev.driverFeedbackTags,
              driverFeedbackComment: trip.driverFeedbackComment || prev.driverFeedbackComment,
            };
          }

          if (prev.status !== trip.status) {
            const prevOrder = TRIP_STATUS_ORDER[prev.status] ?? 0;
            const tripOrder = TRIP_STATUS_ORDER[trip.status] ?? 0;
            if (tripOrder <= prevOrder) return prev;
          }

          const remoteMsgs = trip.chatMessages || [];
          const localMsgs = prev.chatMessages || [];
          const mergedChatMessages = mergeChatMessages(localMsgs, remoteMsgs);

          return { ...trip, chatMessages: mergedChatMessages };
        });
      },
      userId,
      userRole
    );
    return () => sub.unsubscribe();
  }, [supabaseConnected, driverIsLoggedIn, selectedDriverId, riderId]);

  // Dedicated polling for active trip
  useEffect(() => {
    if (!supabaseConnected) return;
    const userId = driverIsLoggedIn ? selectedDriverId : (riderId || undefined);
    const userRole = driverIsLoggedIn ? 'driver' : (riderId ? 'rider' : undefined);
    if (!userId || !userRole) return;

    const pollInterval = dataSaverMode ? 180000 : 120000;

    const interval = setInterval(async () => {
      if (!isMountedRef.current) return;
      try {
        const remoteActiveTrip = await fetchActiveTrip(userId, userRole);
        if (!isMountedRef.current) return;
        if (!remoteActiveTrip) {
          setActiveTripWithTracking((prev: Trip | null) => {
            if (prev && prev.status === 'COMPLETED' && !dismissedTripIdsRef.current.has(prev.id)) {
              if (!prev.driverRatingToRider) {
                return prev;
              }
              return null;
            }
            // If active trip is gone from DB and wasn't already completed/cancelled,
            // clear it locally so drivers don't keep seeing stale requests.
            return null;
          });
          return;
        }

        if (dismissedTripIdsRef.current.has(remoteActiveTrip.id)) {
          setActiveTripWithTracking((prev: Trip | null) => {
            if (prev && prev.id === remoteActiveTrip.id) return null;
            return prev;
          });
          return;
        }

        if (remoteActiveTrip.status === 'CANCELLED') {
          setActiveTripWithTracking((prev: Trip | null) => {
            if (prev && prev.id === remoteActiveTrip.id) return null;
            return prev;
          });
          return;
        }

        setActiveTripWithTracking((prev: Trip | null) => {
          if (!prev) {
            if (remoteActiveTrip.status === 'COMPLETED' && dismissedTripIdsRef.current.has(remoteActiveTrip.id)) {
              return null;
            }
            markLocalStatusChange(remoteActiveTrip.status);
            return remoteActiveTrip;
          }
          if (prev.status === 'COMPLETED' && !dismissedTripIdsRef.current.has(prev.id)) {
            return prev;
          }
          if (prev.id !== remoteActiveTrip.id) return remoteActiveTrip;

          if (prev.status === 'COMPLETED' || remoteActiveTrip.status === 'COMPLETED') {
            return {
              ...prev,
              ...remoteActiveTrip,
              riderRatingToDriver: remoteActiveTrip.riderRatingToDriver ?? prev.riderRatingToDriver,
              riderFeedbackTags: remoteActiveTrip.riderFeedbackTags?.length ? remoteActiveTrip.riderFeedbackTags : prev.riderFeedbackTags,
              riderFeedbackComment: remoteActiveTrip.riderFeedbackComment || prev.riderFeedbackComment,
              driverRatingToRider: remoteActiveTrip.driverRatingToRider ?? prev.driverRatingToRider,
              driverFeedbackTags: remoteActiveTrip.driverFeedbackTags?.length ? remoteActiveTrip.driverFeedbackTags : prev.driverFeedbackTags,
              driverFeedbackComment: remoteActiveTrip.driverFeedbackComment || prev.driverFeedbackComment,
            };
          }

          if (prev.status !== remoteActiveTrip.status) {
            if (shouldSkipPollingUpdate(remoteActiveTrip.status)) {
              return prev;
            }
            const prevOrder = TRIP_STATUS_ORDER[prev.status] ?? 0;
            const remoteOrder = TRIP_STATUS_ORDER[remoteActiveTrip.status] ?? 0;
            if (remoteOrder < prevOrder) return prev;
            markLocalStatusChange(remoteActiveTrip.status);
          } else {
            const remoteMsgs = remoteActiveTrip.chatMessages || [];
            const localMsgs = prev.chatMessages || [];
            const localMsgIds = new Set(localMsgs.map(m => m.id));
            const hasNewMessages = remoteMsgs.some((m: any) => !localMsgIds.has(m.id));
            const remoteTimer = remoteActiveTrip.dispatchTimer;
            const localTimer = prev.dispatchTimer;
            const timerChanged = typeof remoteTimer === 'number' && typeof localTimer === 'number' && remoteTimer !== localTimer;
            if (!hasNewMessages && !timerChanged) {
              return prev;
            }
          }

          const remoteMsgs = remoteActiveTrip.chatMessages || [];
          const localMsgs = prev.chatMessages || [];
          const mergedChatMessages = mergeChatMessages(localMsgs, remoteMsgs);
          const remoteTimer = remoteActiveTrip.dispatchTimer;
          const localTimer = prev.dispatchTimer;
          const mergedDispatchTimer = (typeof localTimer === 'number' && typeof remoteTimer === 'number' && localTimer < remoteTimer)
            ? localTimer
            : (remoteTimer ?? localTimer);

          markLocalStatusChange(remoteActiveTrip.status);
          return { ...remoteActiveTrip, chatMessages: mergedChatMessages, dispatchTimer: mergedDispatchTimer };
        });
      } catch (err) {
        console.warn('Active trip polling error:', err);
      }
    }, pollInterval);

    return () => clearInterval(interval);
  }, [supabaseConnected, dataSaverMode, !!activeTrip, driverIsLoggedIn, selectedDriverId, riderId]);

  return {
    TRIP_STATUS_ORDER,
    markLocalStatusChange,
    shouldSkipPollingUpdate,
    setActiveTripWithTracking,
  };
};
