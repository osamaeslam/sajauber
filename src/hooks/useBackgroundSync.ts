import { useEffect, useRef } from 'react';
import { Driver, Rider, SystemStats, Location, Trip } from '../types';
import {
  fetchDrivers,
  fetchDriversBasic,
  fetchDriversPolling,
  saveDriver,
  fetchRiders,
  saveRider,
  fetchStats,
  saveStats,
  saveLocationInDB,
  saveActiveTrip,
  saveTripToHistory,
} from '../supabaseService';

const STALE_THRESHOLD_MS = 120000;

export const useBackgroundSync = (
  supabaseConnected: boolean,
  drivers: Driver[],
  registeredRiders: Rider[],
  stats: SystemStats,
  locations: Location[],
  activeTrip: Trip | null,
  dataSaverMode: boolean,
  setDrivers: (updater: (prev: Driver[]) => Driver[]) => void,
  setRegisteredRiders: (updater: (prev: Rider[]) => Rider[]) => void,
  setStats: (updater: (prev: SystemStats) => SystemStats) => void,
  setLocations: (updater: (prev: Location[]) => Location[]) => void,
  statsLoadedRef: React.MutableRefObject<boolean>,
  isMountedRef: React.MutableRefObject<boolean>,
  driverIsLoggedIn: boolean = false
) => {
  const driversSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pricingSaveGuardUntilRef = useRef<number>(0);
  const lastSyncedDriversRef = useRef<Record<string, Partial<Driver>>>({});
  const lastSavedTripRef = useRef<string | null>(null);
  const lastSavedActiveTripIdRef = useRef<string | null>(null);
  const lastSavedTripSnapshotRef = useRef<string>('');
  const activePollingLockRef = useRef(false);

  // Drivers list polling (fallback only — Realtime is the primary source)
  useEffect(() => {
    if (!supabaseConnected || !driverIsLoggedIn) return;

    const pollInterval = 300000; // 5 minutes fallback

    const interval = setInterval(async () => {
      if (!isMountedRef.current) return;
      try {
        const remoteDrivers = await fetchDriversPolling();
        if (!isMountedRef.current) return;
        if (remoteDrivers && remoteDrivers.length > 0) {
          const now = Date.now();
          const staleThreshold = STALE_THRESHOLD_MS;
          setDrivers(localDrivers => {
            return remoteDrivers.map((rd) => {
              const ld = localDrivers.find((l) => l.id === rd.id);
              if (ld) {
                const isStale = rd.lastSeen ? (now - new Date(rd.lastSeen).getTime() > staleThreshold) : false;
                return {
                  ...rd,
                  personalPhoto: ld.personalPhoto || rd.personalPhoto,
                  nationalIdImage: ld.nationalIdImage || rd.nationalIdImage,
                  driverLicenseImage: ld.driverLicenseImage || ld.driverLicenseImage,
                  vehicleLicenseImage: ld.vehicleLicenseImage || rd.vehicleLicenseImage,
                  isOnline: isStale ? false : rd.isOnline,
                  status: isStale ? 'OFFLINE' : (rd.isOnline ? rd.status : 'OFFLINE'),
                };
              }
              return rd;
            });
          });
        }
      } catch (err) {
        console.warn('Drivers polling error:', err);
      }
    }, pollInterval);

    return () => clearInterval(interval);
  }, [supabaseConnected, driverIsLoggedIn, setDrivers]);

  // General-purpose sync (riders + stats - lightweight read only)
  useEffect(() => {
    if (!supabaseConnected) return;

    let syncInterval = 300000; // 5 minutes
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const scheduleSync = async () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (!isMountedRef.current) return;
      try {
        const remoteRiders = await fetchRiders();
        if (remoteRiders && remoteRiders.length > 0 && isMountedRef.current) {
          setRegisteredRiders(() => remoteRiders);
        }
        const remoteStats = await fetchStats();
        if (remoteStats && statsLoadedRef.current && isMountedRef.current) {
          setStats(() => remoteStats);
        }
      } catch {
        // ignore
      }
      if (isMountedRef.current) {
        timeoutId = setTimeout(scheduleSync, syncInterval);
      }
    };

    scheduleSync();

    const handleVisibilityChange = () => {
      if (!document.hidden && supabaseConnected && isMountedRef.current) {
        scheduleSync();
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      window.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [supabaseConnected, statsLoadedRef, setRegisteredRiders, setStats]);

  // Debounced push-sync of driver updates back to Supabase
  useEffect(() => {
    if (!supabaseConnected || !driverIsLoggedIn || drivers.length === 0) return;

    if (driversSyncTimerRef.current) {
      clearTimeout(driversSyncTimerRef.current);
    }

    driversSyncTimerRef.current = setTimeout(async () => {
      if (!isMountedRef.current || Date.now() < pricingSaveGuardUntilRef.current) return;
      try {
        const driversToSync = drivers.filter(d => {
          const last = lastSyncedDriversRef.current[d.id];
          if (!last) return false; // Don't auto-push all drivers unless modified
          return (
            d.isOnline !== last.isOnline ||
            d.status !== last.status ||
            d.currentX !== last.currentX ||
            d.currentY !== last.currentY
          );
        });

        for (const driver of driversToSync) {
          if (!isMountedRef.current) break;
          await saveDriver(driver);
          lastSyncedDriversRef.current[driver.id] = { ...driver };
        }
      } catch {
        // ignore
      }
    }, 4000);

    return () => {
      if (driversSyncTimerRef.current) {
        clearTimeout(driversSyncTimerRef.current);
      }
    };
  }, [drivers, supabaseConnected, driverIsLoggedIn]);

  // Active trip auto-save on change (debounced — saves at most once every 8s)
  useEffect(() => {
    if (!supabaseConnected || !activeTrip) return;

    const currentTripKey = JSON.stringify({
      id: activeTrip.id,
      status: activeTrip.status,
      driverId: activeTrip.driverId,
      riderId: activeTrip.riderId,
      fare: activeTrip.fare,
      commission: activeTrip.commission,
      distance: activeTrip.distance,
    });

    if (lastSavedTripRef.current === currentTripKey) return;

    lastSavedTripRef.current = currentTripKey;
    lastSavedActiveTripIdRef.current = activeTrip.id;

    const timeoutId = setTimeout(() => {
      if (!isMountedRef.current) return;
      saveActiveTrip(activeTrip).then((ok) => {
        console.log('[saveActiveTrip useEffect] Saved trip:', activeTrip.id, 'status:', activeTrip.status, 'result:', ok);
      });
    }, 8000);

    return () => clearTimeout(timeoutId);
  }, [supabaseConnected, activeTrip?.id, activeTrip?.status, activeTrip?.driverId, activeTrip?.riderId, activeTrip?.fare, activeTrip?.commission, activeTrip?.distance]);

  // Clear saved trip when activeTrip becomes null
  useEffect(() => {
    if (!supabaseConnected) return;
    if (!activeTrip && lastSavedTripRef.current !== null) {
      const tripIdToClear = lastSavedActiveTripIdRef.current;
      lastSavedTripRef.current = null;
      lastSavedActiveTripIdRef.current = null;
      if (tripIdToClear && isMountedRef.current) {
        saveActiveTrip(null, tripIdToClear).then((ok) => {
          console.log('[saveActiveTrip useEffect] Cleared active trip, result:', ok);
        });
      }
    }
  }, [activeTrip, supabaseConnected]);

  return {
    pricingSaveGuardUntilRef,
    lastSyncedDriversRef,
    lastSavedTripRef,
    lastSavedTripSnapshotRef,
    activePollingLockRef,
  };
};

