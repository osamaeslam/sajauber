  import React, { useState, useEffect, useRef, useCallback } from 'react';
  import ErrorBoundary from './components/ErrorBoundary';
  import NetworkStatusBar from './components/NetworkStatusBar';
  import InitializingOverlay from './components/InitializingOverlay';
  import { useNetworkStatus } from './hooks/useNetworkStatus';
  import { useWebPush } from './hooks/useWebPush';
  import { Location, Driver, Trip, Rider, SystemStats, TripStatus, Region, Ad } from './types';
  import { RiderView } from './components/RiderView';
  import { DriverView } from './components/DriverView';
  import { AdminView } from './components/AdminView';
  import { Smartphone, Globe, RotateCcw, Award, Shield, Car, Check, ChevronDown, MessageSquare, Lock, User, Bell, X } from 'lucide-react';
  import { motion, AnimatePresence } from 'motion/react';
  import { calculateHaversineDistance, estimateDrivingDistance, calculateDynamicFare, getVehiclePricing, calculateVehicleFare, calculateFullTripFare, RouteResult, RouteStep } from './utils/haversine';
  import { getEligibleDrivers, getCoordsFromXY } from './utils/tripDispatchUtils';
  import { 
    checkSupabaseConnection, 
    fetchDrivers, 
    saveDriver, 
    fetchRiders, 
    saveRider, 
    fetchActiveTrip, 
    saveActiveTrip, 
    saveTripToHistory,
    clearTripsHistoryInDB,
    clearAllRidersInDB,
    clearAllDriversInDB,
    fetchStats,
    saveStats,
    fetchLocations,
    saveLocationInDB,
    getDeviceId,
    authenticateAdmin,
    deleteDriverInDB,
    deleteRiderInDB,
    SQL_SCHEMA,
    subscribeToActiveTrips,
    saveSession,
    loadSession,
    clearSession,
    setAppRole,
    markPromoCodeAsUsed,
    fetchRegions,
    fetchAds,
    fetchActiveAdsForPlacement,
    sendNewTripNotification,
    saveRiderPreferences,
    fetchAllActiveTrips,
    uploadDriverImage,
    uploadDriverImageFromBase64,
    mapDriverFromDB,
    mapTripFromDB
  } from './supabaseService';
  import {
    requestNotificationPermission,
    sendNativeNotification,
    playNotificationSound,
    startTitleFlash,
    stopTitleFlash,
    speakText,
    stopLoudRepeatingAlarm,
    triggerVibration,
    notifyDriverWithAudioFirst,
    notifyRideRequest,
    unlockAudioContext,
    isNotificationRateLimited,
  } from './utils/notifications';
  import { getFCMToken, onFCMForegroundMessage } from './firebase';
  import {
    getInitialDataSaverState,
    setDataSaverState,
    getAdaptivePollingInterval,
    getBackgroundPollingInterval,
    getCachedRoute,
    setCachedRoute
  } from './utils/dataSaver';
  import { LegalModal } from './components/LegalModal';
  import { GuideModal } from './components/GuideModal';
  import { hashPassword, verifyPassword, isSecureHash } from './utils/security';
  import { auditLogger } from './utils/auditLog';
  import { riderAuthLimiter, driverAuthLimiter, adminAuthLimiter } from './utils/security';
  import { supabase, isSupabaseConfigured, SUPABASE_URL, SUPABASE_ANON_KEY } from './supabaseClient';

  if (!isSupabaseConfigured) {
    console.info('[Ezz Delivery] Running with offline/local storage engine (Supabase environment variables not configured).');
  }

  // Support secure data storage with password obfuscation / encryption
  const obfuscatePassword = (password: string): string => {
    if (!password) return '';
    try {
      return btoa(unescape(encodeURIComponent(password))).split('').reverse().join('');
    } catch {
      return password;
    }
  };

  const deobfuscatePassword = (obfuscated: string): string => {
    if (!obfuscated) return '';
    try {
      return decodeURIComponent(escape(atob(obfuscated.split('').reverse().join(''))));
    } catch {
      return obfuscated;
    }
  };

  export default function App() {
    const [lang, setLang] = useState<'ar' | 'en'>('ar');
    const [supabaseConnected, setSupabaseConnected] = useState<boolean>(false);
    const [showSqlWizard, setShowSqlWizard] = useState<boolean>(false);
    
    // Custom screen state (Mobile-First Homepage request)
    const [currentScreen, setCurrentScreen] = useState<'HOME' | 'RIDER_AUTH' | 'RIDER_DASHBOARD' | 'DRIVER_AUTH' | 'DRIVER_DASHBOARD' | 'ADMIN'>(() => {
      const stored = localStorage.getItem('ezz_current_screen');
      if (stored === 'RIDER_AUTH' || stored === 'RIDER_DASHBOARD' || stored === 'DRIVER_AUTH' || stored === 'DRIVER_DASHBOARD' || stored === 'ADMIN') {
        return stored as 'RIDER_AUTH' | 'RIDER_DASHBOARD' | 'DRIVER_AUTH' | 'DRIVER_DASHBOARD' | 'ADMIN';
      }
      return 'HOME';
    });
    const [sessionLoaded, setSessionLoaded] = useState(false);
    const [isInitializing, setIsInitializing] = useState(true);
    // Guards the stats auto-save effect: it must NOT run until the initial
    // stats have been loaded from Supabase, otherwise the default values would
    // overwrite the admin's saved prices on every refresh.
    const statsLoadedRef = useRef(false);

    // Shared state is sourced entirely from Supabase (no localStorage)
    const [locations, setLocations] = useState<Location[]>(() => {
      try {
        const stored = localStorage.getItem('ezz_locations_cache');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed as Location[];
        }
      } catch {}
      return [];
    });
    const [drivers, setDrivers] = useState<Driver[]>(() => {
      try {
        const stored = localStorage.getItem('ezz_drivers_cache');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) return parsed as Driver[];
        }
      } catch {}
      return [];
    });
    const [rider, setRider] = useState<Rider & { isLoggedIn: boolean }>(() => {
      try {
        const stored = localStorage.getItem('ezz_rider_session');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.id && parsed.phone) {
            return { ...parsed, isLoggedIn: true };
          }
        }
      } catch {}
      return { id: '', name: '', phone: '', password: '', rating: 5.0, totalTrips: 0, isLoggedIn: false };
    });
    const [activeTrip, setActiveTrip] = useState<Trip | null>(() => {
      try {
        const stored = localStorage.getItem('ezz_active_trip_cache');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed && parsed.id && parsed.status && ['SEARCHING', 'ACCEPTED', 'ARRIVED', 'STARTED'].includes(parsed.status)) {
            // Check that cached trip is fresh (less than 1 hour old)
            const tripAgeMs = parsed.createdAt ? (Date.now() - new Date(parsed.createdAt).getTime()) : 0;
            if (tripAgeMs < 60 * 60 * 1000) {
              return parsed as Trip;
            } else {
              localStorage.removeItem('ezz_active_trip_cache');
            }
          }
        }
      } catch {}
      return null;
    });
    // Live ref to the current trip so background interval callbacks (e.g. the
    // anti-logout check) can inspect it without re-creating the interval.
    const activeTripLocalRef = useRef<Trip | null>(null);
    activeTripLocalRef.current = activeTrip;
    const dismissedTripIdsRef = useRef<Set<string>>(new Set());
    const lastTripCompletedRef = useRef(false);
    const lastTripCancelledRef = useRef(false);
    const cancelInProgressRef = useRef(false);
    const endTripInProgressRef = useRef(false);
    const requestInProgressRef = useRef(false);
    const rejectTripInProgressRef = useRef(false);
    const pendingDriverToggleRef = useRef<string | null>(null);
    const resetDriverStatusOnceRef = useRef<Record<string, boolean>>({});
    const driversRef = useRef<Driver[]>(drivers);
    driversRef.current = drivers;
    const [noAvailableDrivers, setNoAvailableDrivers] = useState(false);
    const [pendingRequestCount, setPendingRequestCount] = useState(0);
    const [ads, setAds] = useState<Ad[]>([]);
    const [liveTrips, setLiveTrips] = useState<Trip[]>([]);
    const [stats, setStats] = useState<SystemStats>({
      commissionRate: 15,
      totalRevenue: 0,
      totalCommission: 0,
      totalCompletedTrips: 0,
      fixedCommission: 10,
      pricePerKm: 8,
      baseFare: 20,
      distanceBuffer: 1.25,
      additionalKm: 0.0,
      supportWhatsApp: '201015555555',
      freeKmThreshold: 2.0,
      distanceMultiplier: 1.27,
      peakHourMultiplier: 1.0,
      nightMultiplier: 1.0,
      peakStartHour: 7,
      peakEndHour: 9,
      nightStartHour: 22,
      nightEndHour: 5,
      carBaseFare: 20,
      carPricePerKm: 8,
      carMinFare: 2,
      carPricePerKm20to50: 8,
      carPricePerKm50plus: 8,
      motorcycleBaseFare: 12,
      motorcyclePricePerKm: 5,
      motorcycleMinFare: 2,
      motorcyclePricePerKm20to50: 5,
      motorcyclePricePerKm50plus: 5,
      toktokBaseFare: 10,
      toktokPricePerKm: 4,
      toktokMinFare: 2,
      toktokPricePerKm20to50: 4,
      toktokPricePerKm50plus: 4,
      tricycleBaseFare: 10,
      tricyclePricePerKm: 4,
      tricycleMinFare: 2,
      tricyclePricePerKm20to50: 4,
      tricyclePricePerKm50plus: 4,
      incomingCommission: 5,
      outgoingCommission: 5,
    });

    // lowDataMode is now sourced from Supabase stats (not localStorage)
    const [lowDataMode, setLowDataMode] = useState<boolean>(true);

    const enableLowData = async () => {
      setLowDataMode(true);
      setDataSaverMode(true);
      setDataSaverState(true);
      if (supabaseConnected) {
        await saveStats({ ...stats, lowDataMode: true });
      }
    };

    const maybeEnableLowData = async () => {
      try {
        if (typeof navigator === 'undefined') return;
        const connection = (navigator as any).connection;
        if (!connection) return;
        const isSlow = connection.saveData || ['slow-2g', '2g', '3g'].includes(connection.effectiveType);
        if (isSlow) {
          await enableLowData();
        }
      } catch {}
    };

    // Handler: Transfer trip to next offered driver when current driver cancels/requests transfer
    const handleTransferTrip = () => {
      const currentTrip = activeTrip;
      if (!currentTrip || (currentTrip.status !== 'SEARCHING' && currentTrip.status !== 'ACCEPTED')) return;
      const currentDriverId = currentTrip.driverId;
      const currentIdx = currentTrip.offeredDriverIds?.indexOf(currentDriverId || '') ?? -1;
      const nextDriverId = (currentTrip.offeredDriverIds && currentIdx !== -1 && currentIdx + 1 < currentTrip.offeredDriverIds.length)
        ? currentTrip.offeredDriverIds[currentIdx + 1]
        : undefined;

      if (nextDriverId) {
        const nextDrv = driversRef.current.find(d => d.id === nextDriverId);
        const updatedTrip = {
          ...currentTrip,
          status: 'SEARCHING' as TripStatus,
          driverId: undefined,
          driverName: undefined,
          currentOfferedDriverId: nextDriverId,
          dispatchTimer: currentTrip.dispatchTimerMax || currentTrip.dispatchTimer || 300,
        };
        setActiveTripWithTracking(updatedTrip);
        setDrivers((prev) => prev.map((d) => (d.id === currentDriverId ? { ...d, status: 'AVAILABLE' } : d)));
        if (supabaseConnected) {
          saveActiveTrip(updatedTrip).then((ok) => console.log('[handleTransferTrip] saved updated trip:', ok));
          if (currentDriverId) {
            const currentDrv = driversRef.current.find(d => d.id === currentDriverId);
            if (currentDrv) {
              saveDriver({ ...currentDrv, status: 'AVAILABLE' }).catch(() => {});
            }
          }
        }
        if (nextDrv) {
          setDrivers((prev) =>
            prev.map((d) =>
              d.id === nextDriverId ? { ...d, status: 'AVAILABLE' } : d
            )
          );
          const rateKey = `transfer_${currentTrip.id}_${nextDriverId}`;
          if (!isNotificationRateLimited(rateKey)) {
            notifyDriverWithAudioFirst({
              title: lang === 'ar' ? 'يوجد رحلة جديدة' : 'New trip available',
              body: `${currentTrip.pickup?.nameAr || currentTrip.pickup?.nameEn || ''} ← ${currentTrip.dropoff?.nameAr || currentTrip.dropoff?.nameEn || ''} | ${currentTrip.fare} EGP`,
              soundType: 'new_trip',
              speechText:
                lang === 'ar'
                  ? `يوجد رحلة جديدة من ${currentTrip.pickup?.nameAr || currentTrip.pickup?.nameEn || ''} إلى ${currentTrip.dropoff?.nameAr || currentTrip.dropoff?.nameEn || ''} بقيمة ${currentTrip.fare} جنيه.`
                  : `New ride available from ${currentTrip.pickup?.nameEn || currentTrip.pickup?.nameAr || ''} to ${currentTrip.dropoff?.nameEn || currentTrip.dropoff?.nameAr || ''} for ${currentTrip.fare} EGP.`,
              lang: lang === 'ar' ? 'ar-EG' : 'en-US',
              tag: `trip-${currentTrip.id}`,
            });
          }
        }
      } else {
        // No next driver -> cancel the trip
        if (currentDriverId) {
          handleCancelRide({ userId: currentDriverId, role: 'driver' });
        } else {
          handleCancelRide();
        }
      }
    };

    const disableLowData = async () => {
      setLowDataMode(false);
      setDataSaverMode(false);
      setDataSaverState(false);
      if (supabaseConnected) {
        await saveStats({ ...stats, lowDataMode: false });
      }
    };

    const [routeCache, setRouteCache] = useState<Record<string, RouteResult>>({});
    const routeCacheRef = useRef(routeCache);
    routeCacheRef.current = routeCache;
    const lastRouteCacheUseRef = useRef<number>(Date.now());

    useEffect(() => {
      const TTL = 30 * 60 * 1000;
      const interval = setInterval(() => {
        const now = Date.now();
        if (now - lastRouteCacheUseRef.current > TTL) {
          setRouteCache({});
        }
      }, 60 * 1000);
      return () => clearInterval(interval);
    }, []);

    const getRealRoute = useCallback(async (pickup: Location, dropoff: Location): Promise<RouteResult | null> => {
      const cacheKey = `${pickup.lat.toFixed(4)}_${pickup.lng.toFixed(4)}_${dropoff.lat.toFixed(4)}_${dropoff.lng.toFixed(4)}`;
      const cached = routeCacheRef.current[cacheKey] || getCachedRoute([pickup.lat, pickup.lng, dropoff.lat, dropoff.lng]);
      if (cached && cached.distance > 0) return cached;

      const coordStr = `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}`;

      // Free routing providers (no API key required).
      // Tried in order until one returns a real road path.
      const providers: Array<{ name: string; build: (coords: string) => { url: string; init?: RequestInit } }> = [
        {
          name: 'OSRM-1',
          build: (coords) => ({ url: `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true` }),
        },
        {
          name: 'OSRM-2',
          build: (coords) => ({ url: `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true` }),
        },
        {
          name: 'OSRM-3',
          build: (coords) => ({ url: `https://valhalla1.openstreetmap.de/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true` }),
        },
      ];

      try {
        for (const provider of providers) {
          try {
            const { url, init } = provider.build(coordStr);
            const res = await fetch(url, init);
            if (!res.ok) {
              console.warn(`[route] ${provider.name} responded ${res.status}`);
              continue;
            }
            const data = await res.json();
            let geometry: [number, number][] | undefined;
            let distance = 0;
            let durationSeconds: number | undefined;
            let steps: RouteStep[] | undefined;

            if (data.features && data.features.length > 0) {
              const f = data.features[0];
              distance = parseFloat((f.properties.summary.distance / 1000).toFixed(2));
              const coords = f.geometry.coordinates as [number, number][];
              geometry = coords.map(([lng, lat]) => [lat, lng] as [number, number]);
              durationSeconds = f.properties.summary.duration ? Math.round(f.properties.summary.duration) : undefined;
              if (f.properties.steps) {
                steps = f.properties.steps.map((step: any) => ({
                  instruction: step.maneuver?.instruction || '',
                  name: step.name || (lang === 'ar' ? 'طريق بدون اسم' : 'Unnamed road'),
                  distance: parseFloat((step.distance / 1000).toFixed(2)),
                  duration: step.duration ? Math.round(step.duration) : 0,
                  maneuver: step.maneuver ? {
                    type: step.maneuver.type || 'continue',
                    modifier: step.maneuver.modifier || undefined,
                  } : undefined,
                }));
              }
            } else if (data.routes && data.routes.length > 0) {
              const route = data.routes[0];
              distance = parseFloat((route.distance / 1000).toFixed(2));
              const coords = route.geometry.coordinates as [number, number][];
              geometry = coords.map(([lng, lat]) => [lat, lng] as [number, number]);
              durationSeconds = route.duration ? Math.round(route.duration) : undefined;
              if (route.legs && route.legs[0]?.steps) {
                steps = route.legs[0].steps.map((step: any) => ({
                  instruction: step.maneuver?.instruction || '',
                  name: step.name || (lang === 'ar' ? 'طريق بدون اسم' : 'Unnamed road'),
                  distance: parseFloat((step.distance / 1000).toFixed(2)),
                  duration: step.duration ? Math.round(step.duration) : 0,
                  maneuver: step.maneuver ? {
                    type: step.maneuver.type || 'continue',
                    modifier: step.maneuver.modifier || undefined,
                  } : undefined,
                }));
              }
            }
            if (distance > 0 && geometry && geometry.length > 1) {
              const result: RouteResult = { distance, geometry, durationSeconds, steps };
              setCachedRoute([pickup.lat, pickup.lng, dropoff.lat, dropoff.lng], result);
              lastRouteCacheUseRef.current = Date.now();
              setRouteCache(prev => {
                const updated = { ...prev, [cacheKey]: result };
                return updated;
              });
              console.log(`[route] ${provider.name} OK: ${distance} km, ${geometry.length} pts, ${steps?.length || 0} steps`);
              return result;
            }
          } catch (err) {
            console.warn(`[route] ${provider.name} error:`, err);
          }
        }
      } catch {
        // ignore
      }
      return null;
    }, [lang]);

    // Navigation route: driver current position -> pickup -> dropoff
    const getNavigationRoute = useCallback(async (
      driverLat: number,
      driverLng: number,
      pickup: Location,
      dropoff: Location
    ): Promise<RouteResult | null> => {
      const cacheKey = `nav_${driverLat.toFixed(4)}_${driverLng.toFixed(4)}_${pickup.lat.toFixed(4)}_${pickup.lng.toFixed(4)}_${dropoff.lat.toFixed(4)}_${dropoff.lng.toFixed(4)}`;
      const cached = routeCacheRef.current[cacheKey] || getCachedRoute([driverLat, driverLng, pickup.lat, pickup.lng, dropoff.lat, dropoff.lng], 'nav_');
      if (cached && cached.distance > 0) return cached;

      const coordStr = `${driverLng},${driverLat};${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}`;

      const providers: Array<{ name: string; build: (coords: string) => { url: string; init?: RequestInit } }> = [
        {
          name: 'OSRM-NAV-1',
          build: (coords) => ({ url: `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true` }),
        },
        {
          name: 'OSRM-NAV-2',
          build: (coords) => ({ url: `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=true` }),
        },
      ];

      try {
        for (const provider of providers) {
          try {
            const { url, init } = provider.build(coordStr);
            const res = await fetch(url, init);
            if (!res.ok) {
              console.warn(`[nav] ${provider.name} responded ${res.status}`);
              continue;
            }
            const data = await res.json();
            let geometry: [number, number][] | undefined;
            let distance = 0;
            let durationSeconds: number | undefined;
            let steps: RouteStep[] = [];

            if (data.routes && data.routes.length > 0) {
              const route = data.routes[0];
              distance = parseFloat((route.distance / 1000).toFixed(2));
              const coords = route.geometry.coordinates as [number, number][];
              geometry = coords.map(([lng, lat]) => [lat, lng] as [number, number]);
              durationSeconds = route.duration ? Math.round(route.duration) : undefined;

              if (route.legs) {
                route.legs.forEach((leg: any) => {
                  if (leg.steps) {
                    leg.steps.forEach((step: any) => {
                      steps.push({
                        instruction: step.maneuver?.instruction || '',
                        name: step.name || (lang === 'ar' ? 'طريق بدون اسم' : 'Unnamed road'),
                        distance: parseFloat((step.distance / 1000).toFixed(2)),
                        duration: step.duration ? Math.round(step.duration) : 0,
                        maneuver: step.maneuver ? {
                          type: step.maneuver.type || 'continue',
                          modifier: step.maneuver.modifier || undefined,
                        } : undefined,
                      });
                    });
                  }
                });
              }
            } else if (data.features && data.features.length > 0) {
              const f = data.features[0];
              distance = parseFloat((f.properties.summary.distance / 1000).toFixed(2));
              const coords = f.geometry.coordinates as [number, number][];
              geometry = coords.map(([lng, lat]) => [lat, lng] as [number, number]);
              durationSeconds = f.properties.summary.duration ? Math.round(f.properties.summary.duration) : undefined;
              if (f.properties.steps) {
                steps = f.properties.steps.map((step: any) => ({
                  instruction: step.maneuver?.instruction || '',
                  name: step.name || (lang === 'ar' ? 'طريق بدون اسم' : 'Unnamed road'),
                  distance: parseFloat((step.distance / 1000).toFixed(2)),
                  duration: step.duration ? Math.round(step.duration) : 0,
                  maneuver: step.maneuver ? {
                    type: step.maneuver.type || 'continue',
                    modifier: step.maneuver.modifier || undefined,
                  } : undefined,
                }));
              }
            }

            if (distance > 0 && geometry && geometry.length > 1) {
              const result: RouteResult = { distance, geometry, durationSeconds, steps };
              lastRouteCacheUseRef.current = Date.now();
              setRouteCache(prev => {
                const updated = { ...prev, [cacheKey]: result };
                return updated;
              });
              setCachedRoute([driverLat, driverLng, pickup.lat, pickup.lng, dropoff.lat, dropoff.lng], result, 'nav_');
              console.log(`[nav] ${provider.name} OK: ${distance} km, ${geometry.length} pts, ${steps.length} steps`);
              return result;
            }
          } catch (err) {
            console.warn(`[nav] ${provider.name} error:`, err);
          }
        }
      } catch {
        // ignore
      }
      return null;
    }, [lang]);

    const [tripDateFrom, setTripDateFrom] = useState<string>('');
    const [tripDateTo, setTripDateTo] = useState<string>('');
    const [tripPage, setTripPage] = useState<number>(0);
    const [tripHasMore, setTripHasMore] = useState<boolean>(true);
    const [isLoadingTrips, setIsLoadingTrips] = useState<boolean>(false);
    const [displayedTrips, setDisplayedTrips] = useState<Trip[]>([]);

    // Selected points in the Booking Form
    const [selectedPickup, setSelectedPickup] = useState<string>('1');
    const [selectedDropoff, setSelectedDropoff] = useState<string>('2');

    // Driver selected inside the Driver role screen (persisted locally so the same
    // captain gets his dashboard back immediately even when offline)
    const [selectedDriverId, setSelectedDriverId] = useState<string>(() => {
      try {
        return localStorage.getItem('ezz_selected_driver_id') || 'drv_1';
      } catch {
        return 'drv_1';
      }
    });

    const networkConnected = useNetworkStatus();
    const lastNavDriverLatRef = useRef<number | null>(null);
    const lastNavDriverLngRef = useRef<number | null>(null);
    const lastLocationSavedAtRef = useRef<Record<string, number>>({});

    useEffect(() => {
      if (!activeTrip || !activeTrip.driverId) return;
      if (activeTrip.driverId !== selectedDriverId) return;

      const drv = drivers.find(d => d.id === selectedDriverId);
      if (!drv?.lat || !drv?.lng) return;

      const prevLat = lastNavDriverLatRef.current;
      const prevLng = lastNavDriverLngRef.current;

      if (prevLat !== null && prevLng !== null) {
        const dLat = Math.abs(drv.lat - prevLat);
        const dLng = Math.abs(drv.lng - prevLng);
        if (dLat > 0.0001 || dLng > 0.0001) {
          lastRouteCacheUseRef.current = Date.now();
          setRouteCache(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(key => {
              if (key.startsWith('nav_')) delete next[key];
            });
            return next;
          });
        }
      }

      lastNavDriverLatRef.current = drv.lat;
      lastNavDriverLngRef.current = drv.lng;
    }, [drivers, selectedDriverId, activeTrip?.driverId, activeTrip?.status]);

    // Terms and conditions accordion state
    const [termsOpen, setTermsOpen] = useState(false);

    // Registered riders list (sourced from Supabase, with a local cache for offline login)
    const [registeredRiders, setRegisteredRiders] = useState<Rider[]>(() => {
      try {
        const stored = localStorage.getItem('ezz_registered_riders_cache');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) return parsed as Rider[];
        }
      } catch {}
      return [];
    });

    // App visitors count (sourced from Supabase stats)
    const [visitorCount, setVisitorCount] = useState<number>(0);

    // Rider auth form state
    const [riderFormMode, setRiderFormMode] = useState<'LOGIN' | 'SIGNUP'>('LOGIN');
    const [riderFormName, setRiderFormName] = useState('');
    const [riderFormPhone, setRiderFormPhone] = useState('');
    const [riderFormPassword, setRiderFormPassword] = useState('');
    const [riderFormAgreed, setRiderFormAgreed] = useState(false);
    const [riderFormError, setRiderFormError] = useState('');
    const [riderLoginPhone, setRiderLoginPhone] = useState('');
    const [riderLoginPassword, setRiderLoginPassword] = useState('');

    // Driver auth form state
    const [drvFormMode, setDrvFormMode] = useState<'LOGIN' | 'SIGNUP'>('LOGIN');
    const [drvFormName, setDrvFormName] = useState('');
    const [drvFormPhone, setDrvFormPhone] = useState('');
    const [drvFormPassword, setDrvFormPassword] = useState('');
    const [drvFormVehicleType, setDrvFormVehicleType] = useState<'CAR' | 'MOTORCYCLE' | 'TOKTOK' | 'TRICYCLE'>('CAR');
    const [drvFormVehicleName, setDrvFormVehicleName] = useState('');
    const [drvFormVehicleBrand, setDrvFormVehicleBrand] = useState('');
    const [drvFormVehicleLicense, setDrvFormVehicleLicense] = useState('');
    const [drvFormNationalId, setDrvFormNationalId] = useState('');
    const [drvFormLicense, setDrvFormLicense] = useState('');
    const [drvFormSecondaryPhone, setDrvFormSecondaryPhone] = useState('');
    const [drvFormAgreed, setDrvFormAgreed] = useState(false);
    const [drvFormError, setDrvFormError] = useState('');
    const [drvLoginPhone, setDrvLoginPhone] = useState('');
    const [drvLoginPassword, setDrvLoginPassword] = useState('');

    // PWA installation helper states
    const [installDismissed, setInstallDismissed] = useState<boolean>(false);
    const [showInstallWizard, setShowInstallWizard] = useState<boolean>(false);

    // Driver actively logged in state (persisted locally)
    const [driverIsLoggedIn, setDriverIsLoggedIn] = useState<boolean>(() => {
      const stored = localStorage.getItem('ezz_driver_logged_in');
      const screen = localStorage.getItem('ezz_current_screen');
      const isDriverScreen = screen === 'DRIVER_AUTH' || screen === 'DRIVER_DASHBOARD';
      return stored === 'true' && isDriverScreen;
    });

    const { sendPushToDriver } = useWebPush(driverIsLoggedIn ? selectedDriverId : undefined, supabaseConnected);

    // Admin login states (persisted locally)
    const [adminIsLoggedIn, setAdminIsLoggedIn] = useState<boolean>(false);
    const [adminPhone, setAdminPhone] = useState<string>('');
    const [adminPassword, setAdminPassword] = useState<string>('');
    const [adminUserId, setAdminUserId] = useState<string>('');
    const [adminLoginError, setAdminLoginError] = useState('');

    useEffect(() => {
      try {
        localStorage.removeItem('ezz_admin_phone');
        localStorage.removeItem('ezz_admin_password');
      } catch {}
    }, []);

    // Prevent duplicate login submissions (button spam / rapid Enter presses)
    const [riderSubmitting, setRiderSubmitting] = useState(false);
    const [driverSubmitting, setDriverSubmitting] = useState(false);
    const [adminSubmitting, setAdminSubmitting] = useState(false);

    // Legal Modal State (Terms & Conditions / Privacy Policy)
    const [showLegalModal, setShowLegalModal] = useState<boolean>(false);
    const [legalModalTab, setLegalModalTab] = useState<'terms' | 'privacy'>('terms');

    const openLegalTerms = () => {
      setLegalModalTab('terms');
      setShowLegalModal(true);
    };

    const openLegalPrivacy = () => {
      setLegalModalTab('privacy');
      setShowLegalModal(true);
    };

    // User & Driver Interactive Guide Modal State
    const [showGuideModal, setShowGuideModal] = useState<boolean>(false);
    const [guideModalTab, setGuideModalTab] = useState<'rider' | 'driver' | 'about'>('rider');

    const openGuideModal = (tab: 'rider' | 'driver' | 'about' = 'rider') => {
      setGuideModalTab(tab);
      setShowGuideModal(true);
    };

    // Data Saver state & Auto-detection for slow networks
    const [dataSaverMode, setDataSaverMode] = useState<boolean>(getInitialDataSaverState);

    const handleToggleDataSaver = () => {
      setDataSaverMode((prev) => {
        const next = !prev;
        setDataSaverState(next);
        triggerToast(
          next ? (lang === 'ar' ? '⚡ تم تفعيل توفير البيانات' : '⚡ Data Saver Enabled') : (lang === 'ar' ? '⚡ تم إيقاف توفير البيانات' : '⚡ Data Saver Disabled'),
          next ? (lang === 'ar' ? 'تم تقليل استخدام الإنترنت للباقة مع الحفاظ على كافة المميزات' : 'Optimized data consumption for mobile network') : (lang === 'ar' ? 'تم العودة للوضع الطبيعي' : 'Returned to standard mode'),
          'success'
        );
        return next;
      });
    };
    const [regions, setRegions] = useState<Region[]>(() => {
      try {
        const stored = localStorage.getItem('ezz_regions_cache');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) return parsed as Region[];
        }
      } catch {}
      return [];
    });
    const [pickupRegionsByRider, setPickupRegionsByRider] = useState<Record<string, string>>({});

    const riderPickupRegion = rider.id ? (pickupRegionsByRider[rider.id] ?? '') : '';

    const setRiderPickupRegion = useCallback((regionId: string) => {
      if (!rider.id) return;
      setPickupRegionsByRider((prev) => ({ ...prev, [rider.id]: regionId }));
      if (supabaseConnected && regionId) {
        saveRiderPreferences(rider.id, {
          ...(rider.preferences || {}),
          lastPickupRegion: regionId,
        }).catch(() => {});
      }
    }, [rider.id, rider.preferences, supabaseConnected]);

    const restoreRiderPickupRegion = useCallback((riderData: Rider) => {
      const saved = riderData.preferences?.lastPickupRegion;
      if (saved) {
        setPickupRegionsByRider((prev) => ({ ...prev, [riderData.id]: saved }));
      }
    }, []);

    // Premium In-App Strong Toast Notifications State
    const [toast, setToast] = useState<{ title: string; message: string; type: 'info' | 'success' | 'warning' | 'new_trip' } | null>(null);
    const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const triggerToast = (title: string, message: string, type: 'info' | 'success' | 'warning' | 'new_trip' = 'info') => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      setToast({ title, message, type });
      toastTimeoutRef.current = setTimeout(() => {
        setToast(null);
      }, 5000);
    };

    // No localStorage persistence: state is sourced entirely from Supabase.

    // Live GPS geolocation watcher for online drivers
    const currentDriverIsOnline = drivers.find(d => d.id === selectedDriverId)?.isOnline ?? false;
    useEffect(() => {
      if (!driverIsLoggedIn || !selectedDriverId) return;

      const currentDriver = drivers.find(d => d.id === selectedDriverId);
      if (!currentDriver || !currentDriver.isOnline) return;

      if (!navigator.geolocation || !window.isSecureContext) {
        console.warn('Geolocation is blocked: requires HTTPS or secure context. Simulated position will be used instead.');
        return;
      }

      const handleSuccess = (position: GeolocationPosition) => {
        const { latitude, longitude } = position.coords;
        const now = new Date().toISOString();
        setDrivers(prev =>
          prev.map(d =>
            d.id === selectedDriverId
              ? { ...d, lat: latitude, lng: longitude, lastSeen: now }
              : d
          )
        );
      };

      const handleError = (error: GeolocationPositionError) => {
        if (error.code === error.PERMISSION_DENIED) {
          console.warn('Geolocation permission denied by user.');
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          console.warn('Geolocation position unavailable.');
        } else if (error.code === error.TIMEOUT) {
          console.warn('Geolocation request timed out.');
        } else {
          console.warn('Geolocation error:', error.message);
        }
      };

      const watcherId = navigator.geolocation.watchPosition(handleSuccess, handleError, {
        enableHighAccuracy: !lowDataMode,
        maximumAge: lowDataMode ? 30000 : 10000,
        timeout: lowDataMode ? 30000 : 15000,
      });

      return () => {
        navigator.geolocation.clearWatch(watcherId);
      };
    }, [driverIsLoggedIn, selectedDriverId, currentDriverIsOnline, lowDataMode]);

    useEffect(() => {
      localStorage.setItem('ezz_driver_logged_in', driverIsLoggedIn ? 'true' : 'false');
    }, [driverIsLoggedIn]);

    // Reset driver to AVAILABLE when driver session is restored or login occurs
    useEffect(() => {
      if (!driverIsLoggedIn || !selectedDriverId || !supabaseConnected) return;
      if (currentScreen !== 'DRIVER_AUTH' && currentScreen !== 'DRIVER_DASHBOARD') return;
      if (resetDriverStatusOnceRef.current[selectedDriverId]) return;

      const resetDriverToAvailable = async () => {
        let driver = drivers.find(d => d.id === selectedDriverId);
        if (!driver) {
          try {
            const freshDrivers = await fetchDrivers();
            driver = freshDrivers?.find(d => d.id === selectedDriverId);
          } catch (e) {
            console.warn('[DriverReset] Could not fetch driver:', e);
          }
        }
        if (!driver) return;

        const shouldReset =
          driver.status === 'BUSY' && !activeTrip ||
          (!driver.isOnline && driver.status !== 'OFFLINE');
        if (!shouldReset) {
          resetDriverStatusOnceRef.current[selectedDriverId] = true;
          return;
        }

        const updated = {
          ...driver,
          isOnline: true,
          status: 'AVAILABLE' as const,
          lastSeen: new Date().toISOString(),
        };
        setDrivers(prev => prev.map(d => d.id === selectedDriverId ? updated : d));
        await saveDriver(updated);
        triggerToast(
          lang === 'ar' ? 'تم إعادة تعيين الحالة' : 'Status reset',
          lang === 'ar' ? 'تم إعادة تعيين حالتك إلى متاح' : 'Your status has been reset to available',
          'success'
        );
        resetDriverStatusOnceRef.current[selectedDriverId] = true;
      };

      resetDriverToAvailable();
    }, [driverIsLoggedIn, selectedDriverId, supabaseConnected, drivers, activeTrip]);

    // Notify Service Worker when driver logs in/out for background polling
    useEffect(() => {
      if (!('serviceWorker' in navigator) || !navigator.serviceWorker?.ready) return;
      if (currentScreen !== 'DRIVER_AUTH' && currentScreen !== 'DRIVER_DASHBOARD') return;

      const notifySW = async () => {
        try {
          const registration = await navigator.serviceWorker.ready;
          if (driverIsLoggedIn && selectedDriverId) {
            registration.active?.postMessage({
              type: 'DRIVER_LOGIN',
              driverId: selectedDriverId,
              supabaseUrl: SUPABASE_URL || '',
              supabaseKey: SUPABASE_ANON_KEY || '',
            });
          } else {
            registration.active?.postMessage({ type: 'DRIVER_LOGOUT' });
          }
        } catch {}
      };

      notifySW();
    }, [driverIsLoggedIn, selectedDriverId, supabaseConnected]);

    // Online/Offline connectivity toast notifications (state tracking is handled by useNetworkStatus hook)
    useEffect(() => {
      const handleOnline = () => {
        triggerToast(
          lang === 'ar' ? '✅ تم استعادة الاتصال' : '✅ Back Online',
          lang === 'ar' ? 'أنت متصل الآن' : 'You are back online',
          'success'
        );
      };

      const handleOffline = () => {
        triggerToast(
          lang === 'ar' ? '📡 أنت غير متصل' : '📡 Offline',
          lang === 'ar' ? 'لا يوجد اتصال بالإنترنت' : 'No internet connection',
          'warning'
        );
      };

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }, [lang]);

    useEffect(() => {
      localStorage.setItem('ezz_current_screen', currentScreen);
    }, [currentScreen]);

    // Local cache of shared reference data so the app remains usable offline
    // and re-opens instantly without waiting for Supabase.
    useEffect(() => {
      try {
        if (drivers.length > 0) localStorage.setItem('ezz_drivers_cache', JSON.stringify(drivers));
      } catch {}
    }, [drivers]);
    useEffect(() => {
      try {
        if (locations.length > 0) localStorage.setItem('ezz_locations_cache', JSON.stringify(locations));
      } catch {}
    }, [locations]);
    useEffect(() => {
      try {
        if (registeredRiders.length > 0) localStorage.setItem('ezz_registered_riders_cache', JSON.stringify(registeredRiders));
      } catch {}
    }, [registeredRiders]);
    useEffect(() => {
      try {
        if (regions.length > 0) localStorage.setItem('ezz_regions_cache', JSON.stringify(regions));
      } catch {}
    }, [regions]);
    useEffect(() => {
      try {
        if (rider.id) {
          const { password, ...safeRider } = rider;
          localStorage.setItem('ezz_rider_session', JSON.stringify(safeRider));
        }
      } catch {}
    }, [rider]);
    useEffect(() => {
      try {
        if (selectedDriverId) localStorage.setItem('ezz_selected_driver_id', selectedDriverId);
      } catch {}
    }, [selectedDriverId]);

    // Persist active trip locally so the driver/rider can resume their ride
    // even if the network drops mid-ride or the app is closed and re-opened.
    useEffect(() => {
      try {
        if (activeTrip && ['SEARCHING', 'ACCEPTED', 'ARRIVED', 'STARTED'].includes(activeTrip.status)) {
          localStorage.setItem('ezz_active_trip_cache', JSON.stringify(activeTrip));
        } else {
          localStorage.removeItem('ezz_active_trip_cache');
        }
      } catch {}
    }, [activeTrip]);

    // Auto-logout when the same account logs in from another device.
    // IMPORTANT: never log the user out during an active trip or while the
    // network is down (loadSession returns null on errors, which would treat a
    // temporary connectivity glitch as "no session" and forcibly log out).
    useEffect(() => {
      if (!supabaseConnected) return;
      if (!rider.isLoggedIn && !driverIsLoggedIn && !adminIsLoggedIn) return;

      const checkSession = async () => {
        if (!networkConnected) return; // offline – keep the session locally
        const localTrip = activeTripLocalRef.current;
        if (localTrip && ['SEARCHING', 'ACCEPTED', 'ARRIVED', 'STARTED'].includes(localTrip.status)) {
          // Trip in progress – never auto-logout mid-ride.
          return;
        }
        try {
          const session = await loadSession();
          if (session) return;

          // loadSession returned null. Distinguish a real "no session" from a
          // transient network/DB error by re-checking connectivity first.
          let isHealthy = false;
          try {
            const { error } = await supabase.from('ezz_stats').select('id').limit(1);
            isHealthy = !error || error.code === 'PGRST116';
          } catch {
            isHealthy = false;
          }
          if (!isHealthy) return; // DB unreachable – keep the session

          if (rider.isLoggedIn) {
            await clearSession('RIDER');
            setRider(prev => ({ ...prev, isLoggedIn: false }));
            setCurrentScreen('HOME');
          } else if (driverIsLoggedIn) {
            await clearSession('DRIVER');
            setDriverIsLoggedIn(false);
            setCurrentScreen('HOME');
          } else if (adminIsLoggedIn) {
            await clearSession('ADMIN');
            setAdminIsLoggedIn(false);
            setCurrentScreen('HOME');
          }
        } catch {
          // Any error during the check → keep the user logged in.
        }
      };

      const id = setInterval(checkSession, 30000);
      return () => clearInterval(id);
    }, [supabaseConnected, rider.isLoggedIn, driverIsLoggedIn, adminIsLoggedIn, networkConnected, activeTrip?.status, activeTrip?.id]);

    // Screen access guard: redirect to HOME if user tries to access a protected screen without login
    useEffect(() => {
      if (!sessionLoaded) return;
      if (currentScreen === 'RIDER_DASHBOARD' && !rider.isLoggedIn) {
        setCurrentScreen('HOME');
      } else if (currentScreen === 'DRIVER_DASHBOARD' && !driverIsLoggedIn) {
        setCurrentScreen('HOME');
      }
    }, [currentScreen, rider.isLoggedIn, driverIsLoggedIn, sessionLoaded]);

    // No localStorage persistence: state is sourced entirely from Supabase.

    // --- ONLINE DIRECT SUPABASE SYNC SYSTEM ---

    // 1. Initial Load from Supabase on mount
    useEffect(() => {
      requestNotificationPermission();
      setIsInitializing(true);

      const initSupabase = async () => {
        try {
          const isConnected = await checkSupabaseConnection();
          if (!isConnected) {
            setSupabaseConnected(false);
            // Offline: restore rider/driver/activeTrip from the local cache
            // so the user stays on their dashboard and can resume any ride.
            try {
              const cachedRider = localStorage.getItem('ezz_rider_session');
              if (cachedRider) {
                const parsedRider = JSON.parse(cachedRider);
                if (parsedRider && parsedRider.id && parsedRider.phone) {
                  setRider({ ...parsedRider, password: '', isLoggedIn: true });
                  restoreRiderPickupRegion(parsedRider);
                }
              }
            } catch {}
            try {
              // Restore drivers list so the selected driver exists offline.
              const cachedDrivers = localStorage.getItem('ezz_drivers_cache');
              if (cachedDrivers) {
                const parsedDrivers = JSON.parse(cachedDrivers);
                if (Array.isArray(parsedDrivers) && parsedDrivers.length > 0) {
                  setDrivers(parsedDrivers);
                }
              }
              // Restore locations/regions so the rider can keep booking offline.
              const cachedLocations = localStorage.getItem('ezz_locations_cache');
              if (cachedLocations) {
                const parsed = JSON.parse(cachedLocations);
                if (Array.isArray(parsed) && parsed.length > 0) setLocations(parsed);
              }
              const cachedRegions = localStorage.getItem('ezz_regions_cache');
              if (cachedRegions) {
                const parsed = JSON.parse(cachedRegions);
                if (Array.isArray(parsed) && parsed.length > 0) setRegions(parsed);
              }
            } catch {}
            try {
              const cachedActive = localStorage.getItem('ezz_active_trip_cache');
              if (cachedActive) {
                const parsedTrip = JSON.parse(cachedActive);
                if (parsedTrip && parsedTrip.id && ['SEARCHING', 'ACCEPTED', 'ARRIVED', 'STARTED'].includes(parsedTrip.status)) {
                  setActiveTripWithTracking(parsedTrip);
                }
              }
            } catch {}
            setSessionLoaded(true);
            setIsInitializing(false);
            return;
          }

          setSupabaseConnected(true);
          console.log('⚡ Connected to Supabase directly!');

          maybeEnableLowData();

          const [
            dbLocations,
            dbDrivers,
            dbRiders,
            dbRegions,
            dbAds,
            session,
            dbStats,
          ] = await Promise.all([
            fetchLocations(),
            fetchDrivers(),
            fetchRiders(),
            fetchRegions(),
            fetchAds(),
            loadSession(),
            fetchStats(),
          ]);

          if (dbLocations && dbLocations.length > 0) {
            setLocations(dbLocations);
          }
          if (dbDrivers && dbDrivers.length > 0) {
            setDrivers(dbDrivers);
          }
          if (dbRiders && dbRiders.length > 0) {
            setRegisteredRiders(dbRiders);
          }
          if (dbRegions) {
            setRegions(dbRegions);
          }
          if (dbAds) {
            setAds(dbAds);
          }

          if (dbStats) {
            const merged = { ...stats, ...dbStats };
            statsLoadedRef.current = true;
            setStats(merged);
            setLowDataMode(!!dbStats.lowDataMode);
            if (JSON.stringify(merged) !== JSON.stringify(dbStats)) {
              await saveStats(merged);
            }
          } else {
            try {
              const { data, error } = await supabase
                .from('ezz_stats')
                .upsert({ id: 'singleton', commission_rate: 15, total_revenue: 0, total_commission: 0, total_completed_trips: 0, fixed_commission: 10, price_per_km: 8, base_fare: 20, distance_buffer: 1.25, created_at: new Date().toISOString() })
                .select('id')
                .single();
              if (error) throw error;
            } catch (err: any) {
              console.warn('Could not create singleton stats row:', err?.message || err);
            }
            statsLoadedRef.current = true;
          }

          if (session) {
            if (session.role === 'RIDER') {
              const r = dbRiders?.find(x => x.id === session.userId);
              if (r) {
                setRider({ ...r, isLoggedIn: true });
                restoreRiderPickupRegion(r);
                if (supabaseConnected) setAppRole('RIDER');
                const riderTrip = await fetchActiveTrip(r.id, 'rider');
                if (riderTrip) {
                  setActiveTripWithTracking(riderTrip);
                } else {
                  setActiveTripWithTracking(null);
                }
              }
            } else if (session.role === 'DRIVER') {
              const d = dbDrivers?.find(x => x.id === session.userId);
              if (d) {
                setSelectedDriverId(d.id);
                setDriverIsLoggedIn(true);
                if (supabaseConnected) setAppRole('DRIVER');
                const driverTrip = await fetchActiveTrip(d.id, 'driver');
                if (driverTrip) {
                  setActiveTripWithTracking(driverTrip);
                } else {
                  setActiveTripWithTracking(null);
                }
              }
            } else if (session.role === 'ADMIN') {
              setAdminIsLoggedIn(true);
              if (supabaseConnected) setAppRole('ADMIN');
            }
          } else {
            setActiveTripWithTracking(null);
          }

          setSessionLoaded(true);
        } catch (err: any) {
          console.warn('[initSupabase] Failed:', err?.message || err);
          setSupabaseConnected(false);
          setSessionLoaded(true);
        } finally {
          setIsInitializing(false);
        }
      };

      initSupabase();
    }, []);

    const TRIP_STATUS_ORDER: Record<string, number> = {
      'IDLE': 0,
      'SEARCHING': 1,
      'ACCEPTED': 2,
      'ARRIVED': 3,
      'STARTED': 4,
      'COMPLETED': 5,
      'CANCELLED': 6,
    };

    const lastLocalStatusChangeRef = useRef<{ status: string; timestamp: number } | null>(null);

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

    const setActiveTripWithTracking = (updater: React.SetStateAction<Trip | null>) => {
      setActiveTrip((prev) => {
        const next = typeof updater === 'function' ? (updater as (prev: Trip | null) => Trip | null)(prev) : updater;
        if (next && next.status !== prev?.status) {
          markLocalStatusChange(next.status);
        }
        return next;
      });
    };

    // 1b. Realtime subscription: deliver new ride requests to the driver's device instantly
    useEffect(() => {
      if (!supabaseConnected) return;
      const userId = driverIsLoggedIn ? selectedDriverId : (rider.id || undefined);
      const userRole = driverIsLoggedIn ? 'driver' : (rider.id ? 'rider' : undefined);
      const sub = subscribeToActiveTrips(
        (trip) => {
          setActiveTripWithTracking((prev) => {
            if (!trip) {
              if (prev && prev.status === 'COMPLETED' && !dismissedTripIdsRef.current.has(prev.id)) {
                return prev;
              }
              return null;
            }

            if (dismissedTripIdsRef.current.has(trip.id)) {
              return null;
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
            const localMsgIds = new Set(localMsgs.map(m => m.id));
            const mergedChatMessages = [...localMsgs];
            for (const m of remoteMsgs) {
              if (!localMsgIds.has(m.id)) {
                mergedChatMessages.push(m);
              }
            }

            const remoteTimer = trip.dispatchTimer;
            const localTimer = prev.dispatchTimer;
            const mergedDispatchTimer = (typeof localTimer === 'number' && typeof remoteTimer === 'number' && localTimer < remoteTimer)
              ? localTimer
              : (remoteTimer ?? localTimer);

            return { ...trip, chatMessages: mergedChatMessages, dispatchTimer: mergedDispatchTimer };
          });
        },
        userId,
        userRole
      );
      return () => sub.unsubscribe();
    }, [supabaseConnected, driverIsLoggedIn, selectedDriverId, rider.id]);

    // Polling disabled — using Realtime only to reduce API usage
    useEffect(() => {
      if (!supabaseConnected) return;

      const channel = supabase
        .channel('drivers_list_channel')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'ezz_drivers',
        }, (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const remoteDriver = mapDriverFromDB(payload.new);
            setDrivers((prev) => {
              const existing = prev.find((d) => d.id === remoteDriver.id);
              if (existing) {
                if (pendingDriverToggleRef.current === remoteDriver.id) {
                  const localPending = prev.find((d) => d.id === remoteDriver.id);
                  if (localPending) return prev.map((d) => d.id === remoteDriver.id ? localPending : d);
                }
                return prev.map((d) => d.id === remoteDriver.id ? { ...d, ...remoteDriver } : d);
              }
              return [...prev, remoteDriver];
            });
          } else if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as any).id;
            if (deletedId) {
              setDrivers((prev) => prev.filter((d) => d.id !== deletedId));
            }
          }
        });

      channel.subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }, [supabaseConnected]);

    // Polling fallback for drivers list — disabled, using Realtime only
    // Realtime subscription on ezz_drivers handles all driver updates instantly
    // Uncomment below only if Realtime is not working reliably
    /*
    useEffect(() => {
      if (!supabaseConnected || !driverIsLoggedIn) return;

      const pollInterval = 300000; // 5 minutes fallback only

      const interval = setInterval(async () => {
        if (!isMountedRef.current) return;
        try {
          const remoteDrivers = await fetchDriversPolling();
          if (isMountedRef.current && remoteDrivers) {
            setDrivers(prev => {
              const remoteMap = new Map(remoteDrivers.map(d => [d.id, d]));
              return prev
                .map(d => {
                  const rd = remoteMap.get(d.id);
                  return rd ? { ...d, ...rd } : null;
                })
                .filter((d): d is Driver => d !== null);
            });
          }
        } catch (err) {
          console.warn('Drivers polling error:', err);
        }
      }, pollInterval);

      return () => clearInterval(interval);
    }, [supabaseConnected, driverIsLoggedIn, setDrivers]);
    */

    // 1e. Polling for live/active trips (admin dashboard) — manual refresh recommended
    useEffect(() => {
      if (!supabaseConnected || !adminIsLoggedIn) return;

      const pollInterval = 300000;

      const interval = setInterval(async () => {
        if (!isMountedRef.current) return;
        try {
          const trips = await fetchAllActiveTrips();
          if (isMountedRef.current) {
            setLiveTrips(trips);
          }
        } catch (err) {
          console.warn('Live trips polling error:', err);
        }
      }, pollInterval);

      return () => clearInterval(interval);
    }, [supabaseConnected, adminIsLoggedIn]);

    // Heartbeat: update driver lastSeen every 10s so stale drivers can be detected quickly
    useEffect(() => {
      if (!supabaseConnected || !driverIsLoggedIn || !selectedDriverId) return;
      if (currentScreen !== 'DRIVER_AUTH' && currentScreen !== 'DRIVER_DASHBOARD') return;

      const updateLastSeen = async () => {
        if (!isMountedRef.current) return;
        const now = new Date().toISOString();
        setDrivers((prev) =>
          prev.map((d) => (d.id === selectedDriverId ? { ...d, lastSeen: now } : d))
        );
        try {
          await supabase
            .from('ezz_drivers')
            .update({ last_seen: now, last_heartbeat: now })
            .eq('id', selectedDriverId);
        } catch (e) {
          // Heartbeat failure is non-critical
        }
      };

    updateLastSeen();
    const interval = setInterval(updateLastSeen, 30000);

      // Mark offline immediately when app/tab is closed
      const markOffline = async () => {
        try {
          await supabase
            .from('ezz_drivers')
            .update({ status: 'OFFLINE', is_online: false })
            .eq('id', selectedDriverId);
        } catch (e) {
          // best-effort
        }
      };

      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', markOffline);
      }

      return () => {
        clearInterval(interval);
        if (typeof window !== 'undefined') {
          window.removeEventListener('beforeunload', markOffline);
        }
      };
    }, [supabaseConnected, driverIsLoggedIn, selectedDriverId]);

    // 2. General-purpose sync (riders + stats) — still paused when tab hidden to save bandwidth
    const pricingSaveGuardUntilRef = useRef<number>(0);

    useEffect(() => {
      if (!supabaseConnected) return;

      let syncInterval = 30000;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const runSync = async () => {
        try {
          const remoteRiders = await fetchRiders();
          if (remoteRiders && remoteRiders.length > 0) {
            setRegisteredRiders(remoteRiders);
          }

          const now = Date.now();
          const shouldSkipPricingSync = now < pricingSaveGuardUntilRef.current;

          if (!shouldSkipPricingSync) {
            const remoteStats = await fetchStats();
            if (remoteStats) {
              setStats((prev) => {
                const next = { ...prev };
                (Object.keys(remoteStats) as (keyof SystemStats)[]).forEach((k) => {
                  if (remoteStats[k] !== undefined) {
                    (next as any)[k] = (remoteStats as any)[k];
                  }
                });
                return next;
              });
            }
          }
        } catch (err) {
          console.warn('Sync loop error:', err);
        }
      };

      const scheduleNext = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(async () => {
          if (document.hidden) {
            scheduleNext();
            return;
          }
          await runSync();
          scheduleNext();
        }, syncInterval);
      };

      scheduleNext();

      const handleVisibilityChange = () => {
        if (document.hidden) {
          if (timeoutId) clearTimeout(timeoutId);
        } else {
          runSync();
          scheduleNext();
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        if (timeoutId) clearTimeout(timeoutId);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }, [supabaseConnected]);


    const lastTripStatusBeforeNullRef = useRef<TripStatus | null>(null);

    // 2.5 Unified Reactive Notification & Strong Alerts Watcher with Deduplication
    const notifiedEventsRef = useRef<Set<string>>(new Set());
    const lastNotifiedTripIdRef = useRef<string | null>(null);
    const lastNotifiedOfferedDriverIdRef = useRef<string | null>(null);

    useEffect(() => {
      if (!activeTrip) {
        const prevStatus = lastTripStatusBeforeNullRef.current;
        if (prevStatus === 'COMPLETED' || prevStatus === 'SEARCHING') {
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
          if (!['COMPLETED', 'SEARCHING'].includes(prevStatus || '')) {
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
              ? 'حمد لله على السلامة، تم إكمال الرحلة بنجاح وشكراً لاختيارك عز.'
              : 'Welcome back, trip completed successfully. Thank you for choosing Ezz.',
            lang === 'ar' ? 'ar-EG' : 'en-US'
          );
          sendNativeNotification(
            '🎉 وصلت بالسلامة!',
            'تم إكمال الرحلة بنجاح. شكراً لك على اختيارك كابتن عز!',
            '✨'
          );
          startTitleFlash('✨ وصلت بالسلامة!');
          setTimeout(stopTitleFlash, 5000);
          triggerToast(
            '🎉 وصلت بالسلامة!',
            'تم إكمال الرحلة بنجاح. شكراً لك على اختيارك كابتن عز!',
            'success'
          );
        } else if (currentStatus === 'CANCELLED') {
          notifiedEventsRef.current.add(statusEventKey);
          lastTripCancelledRef.current = true;
          playNotificationSound('alert');
          speakText(
            lang === 'ar'
              ? 'تم إلغاء الرحلة بسبب عدم قبول أي سائق. يمكنك طلب رحلة جديدة.'
              : 'The ride was cancelled because no driver accepted. You can request a new ride.',
            lang === 'ar' ? 'ar-EG' : 'en-US'
          );
          sendNativeNotification(
            '❌ تم إلغاء الرحلة',
            lang === 'ar'
              ? 'لم يقبل أي سائق الرحلة. يمكنك طلب رحلة جديدة.'
              : 'No driver accepted the ride. You can request a new ride.',
            '❌'
          );
          triggerToast(
            '❌ تم إلغاء الرحلة',
            lang === 'ar'
              ? 'لم يقبل أي سائق الرحلة. يمكنك طلب رحلة جديدة.'
              : 'No driver accepted the ride. You can request a new ride.',
            'warning'
          );
        }
      }

      // Chat Message Notifications — short tone only, no native push, no toast
      if (activeTrip.chatMessages && activeTrip.chatMessages.length > 0) {
        activeTrip.chatMessages.forEach((msg) => {
          const msgEventKey = `${currentTripId}_msg_${msg.id}`;
          if (!notifiedEventsRef.current.has(msgEventKey)) {
            notifiedEventsRef.current.add(msgEventKey);
            playNotificationSound('chat_message');
          }
        });
      }
    }, [activeTrip, driverIsLoggedIn, lang]);

    // 1.5. Loud Alarm Handler Loop for Driver Ride Requests
    useEffect(() => {
      if (!driverIsLoggedIn || !selectedDriverId) {
        stopLoudRepeatingAlarm();
        return;
      }
      const hasTrip = activeTrip && activeTrip.status === 'SEARCHING';
      const isCurrentOffered = activeTrip?.currentOfferedDriverId === selectedDriverId;
      
      if (hasTrip && isCurrentOffered) {
        const rateKey = `ride_request_${activeTrip.id}`;
        if (lastNotifiedTripIdRef.current !== activeTrip.id || lastNotifiedOfferedDriverIdRef.current !== activeTrip.currentOfferedDriverId) {
          lastNotifiedTripIdRef.current = activeTrip.id;
          lastNotifiedOfferedDriverIdRef.current = activeTrip.currentOfferedDriverId || null;
          if (!isNotificationRateLimited(rateKey)) {
            notifyRideRequest(
              lang === 'ar' ? '🚖 طلب مشوار جديد!' : '🚖 New Ride Request!',
              lang === 'ar'
                ? `من ${activeTrip.pickup?.nameAr || activeTrip.pickup?.nameEn || ''} إلى ${activeTrip.dropoff?.nameAr || activeTrip.dropoff?.nameEn || ''} | ${activeTrip.fare} ج.م`
                : `${activeTrip.pickup.nameEn} → ${activeTrip.dropoff.nameEn} | ${activeTrip.fare} EGP`,
              lang === 'ar' ? 'ar-EG' : 'en-US'
            );
          }
          triggerToast(
            lang === 'ar' ? 'يوجد رحلة جديدة' : 'New trip available',
            lang === 'ar'
              ? `العميل ${activeTrip.riderName} يطلب رحلة من ${activeTrip.pickup?.nameAr || activeTrip.pickup?.nameEn || ''} إلى ${activeTrip.dropoff?.nameAr || activeTrip.dropoff?.nameEn || ''}.`
              : `Rider ${activeTrip.riderName} requests a ride from ${activeTrip.pickup?.nameEn || activeTrip.pickup?.nameAr || ''} to ${activeTrip.dropoff?.nameEn || activeTrip.dropoff?.nameAr || ''}.`,
            'new_trip'
          );
        }
      } else {
        lastNotifiedTripIdRef.current = null;
        lastNotifiedOfferedDriverIdRef.current = null;
        stopLoudRepeatingAlarm();
      }

      return () => {
        stopLoudRepeatingAlarm();
      };
    }, [activeTrip?.id, activeTrip?.status, activeTrip?.currentOfferedDriverId, driverIsLoggedIn, selectedDriverId, lang]);

    // Service Worker message listener (registration handled by vite-plugin-pwa)
    useEffect(() => {
      if (!('serviceWorker' in navigator)) return;

      const handler = (event: MessageEvent) => {
        if (event.data && event.data.type === 'ONLINE_CHECK_RESULT') {
          console.log('[SW] Online status from service worker:', event.data.online);
        }
      };

      navigator.serviceWorker.addEventListener('message', handler);
      return () => navigator.serviceWorker.removeEventListener('message', handler);
    }, []);

    // FCM foreground message listener
    useEffect(() => {
      if (!driverIsLoggedIn) return;
      if (currentScreen !== 'DRIVER_AUTH' && currentScreen !== 'DRIVER_DASHBOARD') return;

      const unsubscribe = onFCMForegroundMessage((payload) => {
        console.log('[FCM] Received foreground message:', payload);
        
        // Handle the FCM message
        const data = payload.data || {};
        const title = data.title || 'New Notification';
        const body = data.body || data.message || '';
        const rideId = data.rideId;
        
        // Play notification sound
        if (data.soundType) {
          playNotificationSound(data.soundType as any);
        } else {
          playNotificationSound('new_trip');
        }
        
        // Show toast
        triggerToast(title, body, 'info');
        
        // If it's a new trip notification, update the active trip
        if (rideId && data.status === 'SEARCHING') {
          fetchActiveTrip(selectedDriverId, 'driver').then((trip) => {
            if (trip) {
              setActiveTripWithTracking(trip);
            }
          });
        }
      });

      return () => {
        if (unsubscribe) {
          unsubscribe();
        }
      };
    }, [driverIsLoggedIn, selectedDriverId, lang]);

      // 3. Background notification poller — keeps driver alerts alive even when tab is hidden
    useEffect(() => {
      if (!supabaseConnected || !driverIsLoggedIn) return;
      if (currentScreen !== 'DRIVER_AUTH' && currentScreen !== 'DRIVER_DASHBOARD') return;

      // Auto-request notification permission when driver logs in
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }

      const resetNotified = () => {
        lastNotifiedTripIdRef.current = null;
        lastNotifiedOfferedDriverIdRef.current = null;
      };

      // Reset notification state when app goes to background so we can re-notify when it comes back
      const handleVisibilityChange = () => {
        if (document.hidden) {
          resetNotified();
        } else {
          // App just became visible, immediately check for pending trip
          const remoteActiveTrip = activeTrip;
          if (remoteActiveTrip && remoteActiveTrip.status === 'SEARCHING') {
            const isEligible = remoteActiveTrip.offeredDriverIds?.includes(selectedDriverId);
            const isNewlyOffered = remoteActiveTrip.currentOfferedDriverId === selectedDriverId;
            const needsNotify = lastNotifiedTripIdRef.current !== remoteActiveTrip.id ||
              lastNotifiedOfferedDriverIdRef.current !== remoteActiveTrip.currentOfferedDriverId;
            if (isEligible && needsNotify && isNewlyOffered) {
              lastNotifiedTripIdRef.current = remoteActiveTrip.id;
              lastNotifiedOfferedDriverIdRef.current = remoteActiveTrip.currentOfferedDriverId || null;
            }
          }
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      if (activeTrip && activeTrip.status === 'SEARCHING') {
        lastNotifiedTripIdRef.current = activeTrip.id;
        lastNotifiedOfferedDriverIdRef.current = activeTrip.currentOfferedDriverId || null;
      }

      const pollInterval = getBackgroundPollingInterval(60000, dataSaverMode, !!activeTrip && activeTrip.status === 'SEARCHING');

      const interval = setInterval(async () => {
        if (!isMountedRef.current) return;
        try {
          const remoteActiveTrip = await fetchActiveTrip(selectedDriverId, 'driver');
          if (!remoteActiveTrip) return;

          if (remoteActiveTrip.status !== 'SEARCHING') {
            if (lastNotifiedTripIdRef.current !== null) {
              console.log('[BackgroundPoller] Trip left SEARCHING, clearing notifications');
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
            if (isEligible && needsNotify && isNewlyOffered) {
              lastNotifiedTripIdRef.current = remoteActiveTrip.id;
              lastNotifiedOfferedDriverIdRef.current = remoteActiveTrip.currentOfferedDriverId || null;
              setActiveTripWithTracking(remoteActiveTrip);
            }
          }
        } catch (err) {
          console.warn('Background notification poll error:', err);
        }
      }, pollInterval);

      return () => {
        clearInterval(interval);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        resetNotified();
      };
    }, [supabaseConnected, driverIsLoggedIn, selectedDriverId, lang, dataSaverMode, activeTrip?.id, activeTrip?.status, currentScreen]);

    // 4. Reactive Push Sync to Supabase upon state updates (debounced)
    const driversSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pricingSaveWriteGuardUntilRef = useRef<number>(0);

    const lastSyncedDriversRef = useRef<Record<string, Partial<Driver>>>({});

    const syncDriversToSupabase = async (driverList: Driver[]) => {
      if (!supabaseConnected) return;
      const changedDrivers = driverList.filter((d) => {
        const last = lastSyncedDriversRef.current[d.id];
        if (!last) return true;
        return (
          d.currentX !== last.currentX ||
          d.currentY !== last.currentY ||
          d.isOnline !== last.isOnline ||
          d.status !== last.status ||
          d.totalEarnings !== last.totalEarnings ||
          d.totalCommissionPaid !== last.totalCommissionPaid ||
          d.totalTrips !== last.totalTrips ||
          d.rating !== last.rating ||
          d.approvalStatus !== last.approvalStatus ||
          d.lastSeen !== last.lastSeen ||
          JSON.stringify(d.serviceAreas || []) !== JSON.stringify(last.serviceAreas || [])
        );
      });
      if (changedDrivers.length === 0) return;
      await Promise.allSettled(changedDrivers.map((d) => saveDriver(d)));
      changedDrivers.forEach((d) => {
        lastSyncedDriversRef.current[d.id] = {
          currentX: d.currentX,
          currentY: d.currentY,
          isOnline: d.isOnline,
          status: d.status,
          totalEarnings: d.totalEarnings,
          totalCommissionPaid: d.totalCommissionPaid,
          totalTrips: d.totalTrips,
          rating: d.rating,
          approvalStatus: d.approvalStatus,
          serviceAreas: d.serviceAreas,
          lastSeen: d.lastSeen,
        };
      });
    };

    useEffect(() => {
      if (!supabaseConnected || drivers.length === 0) return;
      if (currentScreen !== 'DRIVER_AUTH' && currentScreen !== 'DRIVER_DASHBOARD') return;
      if (driversSyncTimerRef.current) clearTimeout(driversSyncTimerRef.current);
      driversSyncTimerRef.current = setTimeout(() => {
        syncDriversToSupabase(drivers);
      }, 3000);
      return () => {
        if (driversSyncTimerRef.current) clearTimeout(driversSyncTimerRef.current);
      };
    }, [drivers, supabaseConnected, currentScreen]);

    const lastSavedTripRef = useRef<string | null>(null);
    const lastSavedActiveTripIdRef = useRef<string | null>(null);
    const lastSavedTripSnapshotRef = useRef<string>('');
    const isMountedRef = useRef(true);
    const activePollingLockRef = useRef(false);

    useEffect(() => {
      isMountedRef.current = true;
      return () => { isMountedRef.current = false; };
    }, []);

    useEffect(() => {
      if (!supabaseConnected || !activeTrip) return;
      
      const snapshot = JSON.stringify(activeTrip);
      if (lastSavedTripSnapshotRef.current === snapshot) return;
      lastSavedTripSnapshotRef.current = snapshot;

      const chatMessagesKey = activeTrip.chatMessages?.length
        ? `${activeTrip.chatMessages.length}-${activeTrip.chatMessages[activeTrip.chatMessages.length - 1].id}`
        : '0';

      const currentTripKey = JSON.stringify({
        id: activeTrip.id,
        status: activeTrip.status,
        offeredDriverIds: activeTrip.offeredDriverIds,
        currentOfferedDriverId: activeTrip.currentOfferedDriverId,
        chatMessagesKey,
      });
      
      if (lastSavedTripRef.current === currentTripKey) return;
      
      lastSavedTripRef.current = currentTripKey;
      lastSavedActiveTripIdRef.current = activeTrip.id;
      saveActiveTrip(activeTrip).then((ok) => {
        console.log('[saveActiveTrip useEffect] Saved trip:', activeTrip.id, 'status:', activeTrip.status, 'result:', ok);
      });
    }, [supabaseConnected, activeTrip]);

    // Clear saved trip when activeTrip becomes null (cancelled/completed)
    useEffect(() => {
      if (!supabaseConnected) return;
      if (!activeTrip && lastSavedTripRef.current !== null) {
        const tripIdToClear = lastSavedActiveTripIdRef.current;
        lastSavedTripRef.current = null;
        lastSavedActiveTripIdRef.current = null;
        if (tripIdToClear) {
          saveActiveTrip(null, tripIdToClear).then((ok) => {
            console.log('[saveActiveTrip useEffect] Cleared active trip, result:', ok);
          });
        }
      }
    }, [activeTrip, supabaseConnected]);

    useEffect(() => {
      if (supabaseConnected && registeredRiders.length > 0) {
        registeredRiders.forEach(r => saveRider(r));
      }
    }, [registeredRiders, supabaseConnected]);

    useEffect(() => {
      // Only persist once the initial stats have been loaded from Supabase.
      // This prevents the default values from overwriting saved admin prices
      // during the brief window before fetchStats() completes on load/refresh.
      if (supabaseConnected && stats && statsLoadedRef.current) {
        saveStats(stats);
      }
    }, [stats, supabaseConnected]);

    // GPS Movement Simulation loop (remains active background feature)
    useEffect(() => {
      if (!activeTrip || !activeTrip.driverId) return;

      let targetX = 0;
      let targetY = 0;

      if (activeTrip.status === 'ACCEPTED') {
        targetX = activeTrip.pickup.x || 50;
        targetY = activeTrip.pickup.y || 50;
      } else if (activeTrip.status === 'STARTED') {
        targetX = activeTrip.dropoff.x || 50;
        targetY = activeTrip.dropoff.y || 50;
      } else {
        return;
      }

      let saveCounter = 0;

      const interval = setInterval(() => {
        if (!isMountedRef.current) return;
        setDrivers((prevDrivers) => {
          let reached = false;
          const next = prevDrivers.map((drv) => {
            if (drv.id !== activeTrip.driverId) return drv;

            const dx = targetX - drv.currentX;
            const dy = targetY - drv.currentY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 4) {
              reached = true;
              const coords = getCoordsFromXY(targetX, targetY);
              return {
                ...drv,
                currentX: targetX,
                currentY: targetY,
                lat: coords.lat,
                lng: coords.lng,
              };
            }

            const step = 4;
            const moveX = (dx / dist) * step;
            const moveY = (dy / dist) * step;
            const newX = drv.currentX + moveX;
            const newY = drv.currentY + moveY;
            const coords = getCoordsFromXY(newX, newY);

            return {
              ...drv,
              currentX: newX,
              currentY: newY,
              lat: coords.lat,
              lng: coords.lng,
            };
          });

          if (reached) {
            clearInterval(interval);
          }

          // Save driver location to DB every 25 ticks (~5s) for live tracking
          saveCounter++;
          if (saveCounter % 25 === 0 && supabaseConnected) {
            const updatedDriver = next.find((d) => d.id === activeTrip.driverId);
            if (updatedDriver && updatedDriver.lat && updatedDriver.lng) {
              saveDriver(updatedDriver);
            }
          }

          return next;
        });
      }, 200);

      return () => clearInterval(interval);
    }, [activeTrip?.status, activeTrip?.id, activeTrip?.driverId]);

    // Handler: Request Ride with dynamic commission rate calculation by mileage (distance-based commission request)
    const fetchEligibleDriversForRegion = async (regionId?: string): Promise<Driver[]> => {
      const now = Date.now();
      const staleThreshold = 55000;
      let driverList = drivers;

      if (supabaseConnected) {
        try {
          const freshDrivers = await fetchDrivers();
          if (freshDrivers?.length) driverList = freshDrivers;
        } catch (e) {
          console.warn('Could not fetch fresh drivers for dispatch, falling back to local list:', e);
        }
      }

      const selectedRegion = regionId
        ? regions.find((r) => r.id === regionId)
        : undefined;
      const regionForFilter =
        selectedRegion && selectedRegion.id !== 'all' ? selectedRegion : null;

      return getEligibleDrivers(driverList, now, staleThreshold, regionForFilter);
    };

    const handleRequestRide = async (
      requestedVehicleType: 'CAR' | 'MOTORCYCLE' | 'TOKTOK' | 'TRICYCLE' = 'CAR',
      pickupLandmark?: string,
      promoCode?: string,
      promoCodeId?: string,
      promoDiscount?: number
    ) => {
      if (requestInProgressRef.current) return;
      if (!rider.isLoggedIn) return;
      requestInProgressRef.current = true;
      try {
        if (!selectedPickup || !selectedDropoff) return;
        if (!riderPickupRegion) {
          triggerToast(
            lang === 'ar' ? 'اختر المنطقة أولاً' : 'Select a region first',
            lang === 'ar' ? 'يرجى تحديد منطقة الالتقاء قبل طلب الرحلة.' : 'Please select your pickup region before requesting a ride.',
            'warning'
          );
          return;
        }
        const pLoc = locations.find((l) => l.id === selectedPickup);
        const dLoc = locations.find((l) => l.id === selectedDropoff);
        if (!pLoc || !dLoc) return;
        setNoAvailableDrivers(false);

        // Use ONLY real road distance from cache or ORS/OSRM API
        let distance: number | null = null;
        let etaMinutes: number | undefined;
        let routeGeometry: [number, number][] | undefined;
        const cacheKey = `${pLoc.lat.toFixed(4)}_${pLoc.lng.toFixed(4)}_${dLoc.lat.toFixed(4)}_${dLoc.lng.toFixed(4)}`;
        const cachedRoute = routeCache[cacheKey];
        if (cachedRoute && cachedRoute.distance > 0) {
          distance = Math.max(1, parseFloat(cachedRoute.distance.toFixed(2)));
          etaMinutes = cachedRoute.durationSeconds ? Math.max(1, Math.round(cachedRoute.durationSeconds / 60)) : undefined;
          routeGeometry = cachedRoute.geometry;
        } else {
          try {
            const realRoute = await getRealRoute(pLoc, dLoc);
            if (realRoute && realRoute.distance > 0) {
              distance = Math.max(1, parseFloat(realRoute.distance.toFixed(2)));
              etaMinutes = realRoute.durationSeconds ? Math.max(1, Math.round(realRoute.durationSeconds / 60)) : undefined;
              routeGeometry = realRoute.geometry;
            }
          } catch {
            // ignore
          }
        }

        // Fallback: if real route unavailable, use estimated distance so trip still proceeds
        if (!distance) {
          const directDistance = calculateHaversineDistance(pLoc.lat, pLoc.lng, dLoc.lat, dLoc.lng);
          const fallbackDistance = estimateDrivingDistance(directDistance, stats.distanceBuffer ?? 1.25) + (stats.additionalKm ?? 0.0);
          distance = Math.max(1, parseFloat(fallbackDistance.toFixed(2)));
        }

        let appliedDiscount = 0;
        let appliedPromoCode: string | undefined;
        let appliedPromoDiscount: number | undefined;

        if (promoCode && promoCodeId) {
          appliedDiscount = promoDiscount || 0;
          appliedPromoCode = promoCode;
          appliedPromoDiscount = appliedDiscount;
        } else if (promoCode && stats?.promoCode && promoCode.trim().toUpperCase() === stats.promoCode.trim().toUpperCase()) {
          appliedDiscount = stats.promoValue || 5;
          appliedPromoCode = promoCode;
          appliedPromoDiscount = appliedDiscount;
        }

        const { baseFare, commission, finalFare } = calculateFullTripFare(distance, requestedVehicleType, stats, appliedDiscount);
        const fare = finalFare;

        // Broadcast dispatch to up to 5 available drivers in the region simultaneously.
        // The first driver to accept wins the ride. 5-minute acceptance window.
        const MAX_OFFERED_DRIVERS = 5;
        const DISPATCH_TIMER_SECONDS = 300;

        let currentOfferedDriverId: string | undefined = undefined;
        let offeredDriverIds: string[] = [];

        const eligibleDrivers = await fetchEligibleDriversForRegion(riderPickupRegion);

        // Filter drivers by the pickup region selected by this rider.
        const selectedRegion = regions.find((r) => r.id === riderPickupRegion);

        const dispatchTimer = DISPATCH_TIMER_SECONDS;
        const dispatchTimerMax = DISPATCH_TIMER_SECONDS;

        // Filter eligible drivers by requested vehicle type to avoid dispatching wrong vehicle
        const eligibleDriversByType = eligibleDrivers.filter(
          (d) => String(d.vehicleType).toUpperCase() === requestedVehicleType
        );

        if (eligibleDriversByType.length === 0) {
          setNoAvailableDrivers(true);
          triggerToast(
            lang === 'ar' ? 'لا يوجد سائقين من نوع المركبة المختار' : 'No drivers available for the selected vehicle type',
            lang === 'ar'
              ? 'عذراً، لا يوجد سائقين من هذا النوع في منطقتك حالياً. يرجى اختيار نوع آخر أو المحاولة لاحقاً.'
              : 'Sorry, there are no drivers of the selected vehicle type in your area right now. Please choose another type or try again later.',
            'warning'
          );
          return;
        }

        if (eligibleDriversByType.length > 0) {
          // Sort drivers by precise Haversine distance to pickup location
          const sortedDrivers = eligibleDriversByType
            .map((d) => {
              const dCoords = getCoordsFromXY(d.currentX, d.currentY);
              const dist = calculateHaversineDistance(
                dCoords.lat,
                dCoords.lng,
                pLoc.lat,
                pLoc.lng
              );
              return { driver: d, distance: dist };
            })
            .sort((a, b) => a.distance - b.distance);

          offeredDriverIds = sortedDrivers.slice(0, MAX_OFFERED_DRIVERS).map((item) => item.driver.id);
          currentOfferedDriverId = offeredDriverIds[0];

          const newTrip: Trip = {
            id: `trip_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
            riderId: rider.id,
            riderName: rider.name,
            riderPhone: rider.phone,
            pickup: pLoc,
            dropoff: dLoc,
            pickupLandmark,
            status: 'SEARCHING',
            fare,
            commission,
            distance,
            routeGeometry,
            etaMinutes,
            requestedVehicleType,
            createdAt: new Date().toISOString(),
            chatMessages: [],
            currentOfferedDriverId,
            offeredDriverIds,
            dispatchTimer,
            dispatchTimerMax,
            appliedPromoCode,
            appliedPromoDiscount,
            pickupRegionId: selectedRegion?.id,
            pickupRegionName: selectedRegion?.nameAr,
          };

          setActiveTripWithTracking(newTrip);

          playNotificationSound('new_trip');
          triggerToast(
            lang === 'ar' ? 'تم طلب الرحلة بنجاح' : 'Ride request sent',
            lang === 'ar'
              ? `رحلتك من ${pLoc.nameAr} إلى ${dLoc.nameAr} | ${fare} ج.م`
              : `Ride from ${pLoc.nameEn} to ${dLoc.nameEn} | ${fare} EGP`,
            'new_trip'
          );
          sendNativeNotification(
            '🚖 تم طلب رحلة جديدة',
            lang === 'ar'
              ? `رحلتك من ${pLoc.nameAr} إلى ${dLoc.nameAr} | ${fare} ج.م`
              : `Ride from ${pLoc.nameEn} to ${dLoc.nameEn} | ${fare} EGP`,
            '🚖'
          );

          if (supabaseConnected) {
            saveActiveTrip(newTrip).then((ok) => {
              console.log('[handleRequestRide] saveActiveTrip result:', ok);
              if (ok && promoCodeId) {
                markPromoCodeAsUsed(promoCodeId, newTrip.id).catch(() => {});
              }
              if (ok) {
                fetch('/api/notify-driver', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    tripId: newTrip.id,
                    pickup: pLoc.nameAr || pLoc.nameEn,
                    vehicleType: requestedVehicleType,
                  }),
                }).catch(() => {});
              }
            });

            const waitingAds = await fetchActiveAdsForPlacement('waiting');
            if (waitingAds && waitingAds.length > 0) {
              setAds(waitingAds);
            }
          }
        } else {
          setNoAvailableDrivers(true);
          triggerToast(
            lang === 'ar' ? 'لا يوجد سائقين متاحين' : 'No available drivers',
            lang === 'ar'
              ? 'عذراً، لا يوجد سائقين متاحين في منطقتك حالياً. يرجى المحاولة مرة أخرى لاحقاً.'
              : 'Sorry, there are no available drivers in your area right now. Please try again later.',
            'warning'
          );
          return;
        }
      } finally {
        requestInProgressRef.current = false;
      }
    };

    const saveWithRetry = async (trip: Trip, retries = 2): Promise<boolean> => {
      for (let i = 0; i < retries; i++) {
        const ok = await saveActiveTrip(trip);
        if (ok) return true;
        await new Promise(resolve => setTimeout(resolve, 600));
      }
      return false;
    };

    // Refresh a waiting trip: re-evaluate eligible drivers and re-dispatch
    const refreshWaitingTrip = async (tripOverride?: Trip): Promise<boolean> => {
      const trip = tripOverride ?? activeTrip;
      if (!trip || trip.status !== 'SEARCHING' || !rider.isLoggedIn) return false;

      const pLoc = trip.pickup;
      const dLoc = trip.dropoff;
      const regionId = trip.pickupRegionId ?? riderPickupRegion;
      if (!pLoc || !dLoc || !regionId) return false;

      const eligibleDrivers = await fetchEligibleDriversForRegion(regionId);
      if (eligibleDrivers.length === 0) return false;

      const sortedDrivers = eligibleDrivers
        .map((d) => {
          const dCoords = getCoordsFromXY(d.currentX, d.currentY);
          const dist = calculateHaversineDistance(dCoords.lat, dCoords.lng, pLoc.lat, pLoc.lng);
          return { driver: d, distance: dist };
        })
        .sort((a, b) => a.distance - b.distance);

      const newOfferedIds = sortedDrivers.slice(0, 50).map((item) => item.driver.id);
      const newFirstId = newOfferedIds[0];

      const updatedTrip: Trip = {
        ...trip,
        offeredDriverIds: newOfferedIds,
        currentOfferedDriverId: newFirstId,
        dispatchTimer: trip.dispatchTimerMax || trip.dispatchTimer || 300,
      };

      setActiveTripWithTracking(updatedTrip);
      if (supabaseConnected) {
        await saveWithRetry(updatedTrip);
      }

      return true;
    };

    // Dispatch timer countdown: decrements while trip is SEARCHING (rider only — avoids double countdown with driver app)
    useEffect(() => {
      if (driverIsLoggedIn || !rider.isLoggedIn) return;
      if (!activeTrip || activeTrip.status !== 'SEARCHING') {
        return;
      }

       const interval = setInterval(async () => {
         if (!isMountedRef.current) return;
         setActiveTripWithTracking((prev) => {
           if (!prev || prev.status !== 'SEARCHING') {
             clearInterval(interval);
             return prev;
           }

           const currentTimer = prev.dispatchTimer ?? 300;
           if (currentTimer <= 1) {
             clearInterval(interval);
             const cancelled = { ...prev, status: 'CANCELLED' as TripStatus, completedAt: new Date().toISOString() };
             setTimeout(async () => {
               if (supabaseConnected) {
                 const saved = await saveTripToHistory(cancelled, rider.id, 'rider', getDeviceId());
                 if (!saved) {
                   console.error('[DispatchTimer] Failed to save cancelled trip to history');
                 }
                 saveActiveTrip(null, prev.id).catch(() => {});
               }
             }, 0);
             playNotificationSound('alert');
             speakText(
               lang === 'ar'
                 ? 'انتهت مهلة انتظار الرحلة. يمكنك طلب رحلة جديدة.'
                 : 'The ride waiting time has expired. You can try again.',
               lang === 'ar' ? 'ar-EG' : 'en-US'
             );
             triggerToast(
               lang === 'ar' ? 'انتهت مهلة الانتظار' : 'Waiting time expired',
               lang === 'ar'
                 ? 'لم يقبل أي سائق الرحلة في الوقت المحدد. يمكنك المحاولة مرة أخرى.'
                 : 'No driver accepted the ride in time. You can try again.',
               'warning'
             );
             return null;
           }

           return { ...prev, dispatchTimer: currentTimer - 1 };
         });
       }, 1000);

      return () => clearInterval(interval);
    }, [activeTrip?.id, activeTrip?.status, lang, supabaseConnected, driverIsLoggedIn, rider.isLoggedIn]);

    // Auto-refresh waiting trip every 2 minutes to re-dispatch to new online drivers
    useEffect(() => {
      if (!activeTrip || activeTrip.status !== 'SEARCHING' || !rider.isLoggedIn) return;

      const refreshInterval = setInterval(() => {
        if (!isMountedRef.current) return;
        refreshWaitingTrip().then((ok) => {
          if (ok) {
            console.log('[WaitingTripRefresh] Trip refreshed successfully');
          }
        });
      }, 120000);

      return () => clearInterval(refreshInterval);
    }, [activeTrip?.id, activeTrip?.status, rider.isLoggedIn, supabaseConnected]);

    // Handler: Send Chat Message in Active Trip
    const handleSendChatMessage = (text: string, sender: 'RIDER' | 'DRIVER') => {
      if (!activeTrip) return;

      const newMessage = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        sender,
        text,
        timestamp: new Date().toLocaleTimeString(lang === 'ar' ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' }),
        createdAt: Date.now(),
      };

      setActiveTripWithTracking((prev) => {
        if (!prev) return null;
        const chatMessages = prev.chatMessages ? [...prev.chatMessages, newMessage] : [newMessage];
        const updated = { ...prev, chatMessages };
        if (supabaseConnected) {
          saveWithRetry(updated).catch(() => {});
        }
        return updated;
      });
    };

    // Handler: Cancel Ride
    const handleCancelRide = async (cancelledBy?: { userId: string; role: 'rider' | 'driver' }) => {
      if (!activeTrip || cancelInProgressRef.current) return;

      cancelInProgressRef.current = true;
      dismissedTripIdsRef.current.add(activeTrip.id);
      const { driverId } = activeTrip;
      const cancelledTripId = activeTrip.id;

      const cancelUserId = cancelledBy?.userId || rider.id || '';
      const cancelRole = cancelledBy?.role || 'rider';

      if (driverId) {
        setDrivers((prev) =>
          prev.map((d) => (d.id === driverId ? { ...d, status: 'AVAILABLE' } : d))
        );
        if (supabaseConnected) {
          const currentDrv = drivers.find((d) => d.id === driverId);
          if (currentDrv) {
            saveDriver({ ...currentDrv, status: 'AVAILABLE' }).catch(() => {});
          }
        }
      }

      const cancelledTrip = {
        ...activeTrip,
        status: 'CANCELLED' as TripStatus,
        completedAt: new Date().toISOString(),
      };

      try {
        if (supabaseConnected) {
          const saved = await saveTripToHistory(cancelledTrip, cancelUserId, cancelRole, getDeviceId());
          if (!saved) {
            console.error('[handleCancelRide] Failed to save cancelled trip for', cancelUserId, cancelRole);
          }
          if (cancelRole === 'rider' && driverId) {
            const savedDriver = await saveTripToHistory(cancelledTrip, driverId, 'driver', getDeviceId());
            if (!savedDriver) {
              console.error('[handleCancelRide] Failed to save cancelled trip for driver');
            }
          } else if (cancelRole === 'driver' && activeTrip.riderId) {
            const savedRider = await saveTripToHistory(cancelledTrip, activeTrip.riderId, 'rider', getDeviceId());
            if (!savedRider) {
              console.error('[handleCancelRide] Failed to save cancelled trip for rider');
            }
          }
          await saveActiveTrip(null, cancelledTripId);
          console.log('[handleCancelRide] Cleared active trip from DB');
        }
      } catch (err) {
        console.warn('[handleCancelRide] Error clearing trip:', err);
      } finally {
        cancelInProgressRef.current = false;
      }

      playNotificationSound('alert');
      speakText(
        lang === 'ar'
          ? 'تم إلغاء الرحلة من قبلك. يمكنك طلب رحلة جديدة.'
          : 'You cancelled the ride. You can request a new ride.',
        lang === 'ar' ? 'ar-EG' : 'en-US'
      );
      sendNativeNotification(
        '❌ تم إلغاء الرحلة',
        lang === 'ar'
          ? 'تم إلغاء الرحلة من قبلك. يمكنك طلب رحلة جديدة.'
          : 'You cancelled the ride. You can request a new ride.',
        '❌'
      );
      triggerToast(
        '❌ تم إلغاء الرحلة',
        lang === 'ar'
          ? 'تم إلغاء الرحلة من قبلك. يمكنك طلب رحلة جديدة.'
          : 'You cancelled the ride. You can request a new ride.',
        'warning'
      );

      lastTripCancelledRef.current = true;
      notifiedEventsRef.current.add('cancelled_notified');
      // Mark local status change so polling/realtime won't immediately overwrite
      markLocalStatusChange('CANCELLED');
      setActiveTripWithTracking(null);
      setNoAvailableDrivers(false);
      setPendingRequestCount(0);
    };

    const handleUpdateDriverLocation = (_driverId: string, _lat: number, _lng: number, _x: number, _y: number) => {
      // Location tracking disabled — no-op.
    };

    // Handler: Driver Accepts Trip Manually
    const handleAcceptTrip = async (driverId: string) => {
      if (!activeTrip || activeTrip.status !== 'SEARCHING') return;

      const drv = drivers.find((d) => d.id === driverId);

      if (!drv || !drv.isOnline) {
        triggerToast(
          lang === 'ar' ? 'تنبيه' : 'Notice',
          lang === 'ar' ? 'برجاء تفعيل حالة متصل أولاً للتمكن من قبول الرحلة' : 'Please go online first to accept rides',
          'warning'
        );
        return;
      }

      // Optimistic local update first (marks driver BUSY, sets ACCEPTED)
      setDrivers((prev) =>
        prev.map((d) => (d.id === driverId ? { ...d, status: 'BUSY' } : d))
      );

      const acceptedTrip: Trip = {
        ...activeTrip,
        status: 'ACCEPTED',
        driverId,
        driverName: drv?.name,
      };

      setActiveTripWithTracking(acceptedTrip);

      if (supabaseConnected) {
        if (drv) {
          saveDriver({ ...drv, status: 'BUSY' }).catch(() => {});
        }

        // Atomic update: only transition from SEARCHING to ACCEPTED
        const { data: updated, error: updateError } = await supabase
          .from('ezz_active_trip')
          .update({
            status: 'ACCEPTED',
            driver_id: driverId,
            driver_name: drv?.name || null,
          })
          .eq('id', activeTrip.id)
          .eq('status', 'SEARCHING')
          .select('id, status, driver_id');

        const successfulAccept = Boolean(
          !updateError &&
          updated &&
          updated.length > 0 &&
          updated[0].status === 'ACCEPTED' &&
          updated[0].driver_id === driverId
        );

        if (!successfulAccept) {
          // Check current DB status to verify if another driver accepted or trip cancelled
          const { data: currentTrip } = await supabase
            .from('ezz_active_trip')
            .select('status, driver_id')
            .eq('id', activeTrip.id)
            .maybeSingle();

          if (currentTrip?.status === 'ACCEPTED' && currentTrip?.driver_id === driverId) {
            console.log('[handleAcceptTrip] Confirmed: already accepted by this driver');
          } else {
            console.log('[handleAcceptTrip] Race condition: Another driver took the trip or trip cancelled, rolling back');
            triggerToast(
              lang === 'ar' ? 'عفواً، تم قبول الطلب' : 'Trip already taken',
              lang === 'ar' ? 'قام كابتن آخر بقبول هذا المشوار قبلك أو تم إلغاء الطلب.' : 'Another driver accepted this ride or it was cancelled.',
              'warning'
            );
            setActiveTripWithTracking((prev: Trip | null) => {
              if (!prev || prev.id === activeTrip.id) return null;
              return prev;
            });
            setDrivers((prev) =>
              prev.map((d) => (d.id === driverId ? { ...d, status: 'AVAILABLE' } : d))
            );
            if (drv) {
              saveDriver({ ...drv, status: 'AVAILABLE' }).catch(() => {});
            }
            return;
          }
        }
      }

      try {
        const driverLat = drv?.lat ?? (drv ? getCoordsFromXY(drv.currentX, drv.currentY).lat : undefined);
        const driverLng = drv?.lng ?? (drv ? getCoordsFromXY(drv.currentX, drv.currentY).lng : undefined);

        if (driverLat === undefined || driverLng === undefined) {
          throw new Error('Driver coordinates unavailable');
        }

        const route = await getNavigationRoute(driverLat, driverLng, activeTrip.pickup, activeTrip.dropoff);
        if (!route) {
          throw new Error('No route found');
        }

        const routeUpdated: Trip = {
          ...acceptedTrip,
          routeGeometry: route.geometry,
          etaMinutes: route.durationSeconds ? Math.ceil(route.durationSeconds / 60) : acceptedTrip.etaMinutes,
        };
        setActiveTripWithTracking(routeUpdated);
        if (supabaseConnected) {
          await saveActiveTrip(routeUpdated);
        }
      } catch (err) {
        console.warn('[handleAcceptTrip] route calculation failed, rolling back:', err);
        setActiveTripWithTracking((prev) => {
          if (!prev || prev.status !== 'ACCEPTED') return prev;
          return { ...prev, status: 'SEARCHING' as TripStatus, driverId: undefined, driverName: undefined, routeGeometry: undefined, etaMinutes: undefined };
        });
        setDrivers((prev) =>
          prev.map((d) => (d.id === driverId ? { ...d, status: 'AVAILABLE' } : d))
        );
        if (supabaseConnected) {
          saveActiveTrip({ ...acceptedTrip, status: 'SEARCHING', driverId: undefined, driverName: undefined, routeGeometry: undefined, etaMinutes: undefined }).catch(() => {});
          saveDriver({ ...drv, status: 'AVAILABLE' }).catch(() => {});
        }
        triggerToast(
          lang === 'ar' ? 'تنبيه' : 'Notice',
          lang === 'ar' ? 'لم يتم العثور على مسار. تم إلغاء قبول الرحلة.' : 'No route found. Ride acceptance cancelled.',
          'warning'
        );
        return;
      }

      if (drv) {
        playNotificationSound('trip_accepted');
        speakText(
          lang === 'ar'
            ? `تم قبول الرحلة بنجاح! العميل ${activeTrip.riderName || ''} بانتظارك.`
            : `Ride accepted successfully! Client ${activeTrip.riderName || ''} is waiting for you.`,
          lang === 'ar' ? 'ar-EG' : 'en-US'
        );
        sendNativeNotification(
          lang === 'ar' ? '✅ تم قبول الرحلة!' : '✅ Ride Accepted!',
          lang === 'ar'
            ? `أنت الآن في الطريق إلى العميل من ${activeTrip.pickup?.nameAr || activeTrip.pickup?.nameEn || ''} إلى ${activeTrip.dropoff?.nameAr || activeTrip.dropoff?.nameEn || ''}.`
            : `You are now heading to the client from ${activeTrip.pickup.nameEn} to ${activeTrip.dropoff.nameEn}.`,
          '🚗'
        );
        startTitleFlash(lang === 'ar' ? '🚗 تم قبول الرحلة!' : '🚗 Ride Accepted!');
        setTimeout(stopTitleFlash, 5000);
        triggerVibration([200, 100, 200, 100, 300]);
        triggerToast(
          lang === 'ar' ? '✅ تم قبول الرحلة!' : '✅ Ride Accepted!',
          lang === 'ar'
            ? `أنت الآن في الطريق إلى العميل.`
            : `You are now heading to the client.`,
          'success'
        );
      }
    };

    const handleRejectTrip = async () => {
      if (rejectTripInProgressRef.current) return;
      const currentTrip = activeTrip;
      if (!currentTrip || currentTrip.status !== 'SEARCHING' || !currentTrip.currentOfferedDriverId) return;

      rejectTripInProgressRef.current = true;
      const currentIdx = currentTrip.offeredDriverIds?.indexOf(currentTrip.currentOfferedDriverId) ?? -1;
      const nextDriverId = (currentTrip.offeredDriverIds && currentIdx !== -1 && currentIdx + 1 < currentTrip.offeredDriverIds.length)
        ? currentTrip.offeredDriverIds[currentIdx + 1]
        : undefined;

      try {
        if (nextDriverId) {
          const updatedTrip = { 
            ...currentTrip, 
            currentOfferedDriverId: nextDriverId,
            dispatchTimer: currentTrip.dispatchTimerMax || currentTrip.dispatchTimer || 300,
          };
          setActiveTripWithTracking(updatedTrip);
          if (supabaseConnected) {
            await saveActiveTrip(updatedTrip);
          }
        } else {
          const rejectingDriverId = currentTrip.currentOfferedDriverId;
          setDrivers((prev) =>
            prev.map((d) => (d.id === rejectingDriverId ? { ...d, status: 'AVAILABLE' } : d))
          );
          const withoutRejector = (currentTrip.offeredDriverIds || []).filter((id) => id !== rejectingDriverId);
          const resetTrip: Trip = {
            ...currentTrip,
            status: 'SEARCHING' as TripStatus,
            offeredDriverIds: withoutRejector,
            currentOfferedDriverId: withoutRejector[0],
            dispatchTimer: currentTrip.dispatchTimerMax || currentTrip.dispatchTimer || 300,
          };
          setActiveTripWithTracking(resetTrip);
          if (supabaseConnected) {
            await saveActiveTrip(resetTrip);
            if (rejectingDriverId) {
              const rejectingDrv = driversRef.current.find(d => d.id === rejectingDriverId);
              if (rejectingDrv) {
                await saveDriver({ ...rejectingDrv, status: 'AVAILABLE' }).catch(() => {});
              }
            }
          }
          if (!resetTrip.currentOfferedDriverId) {
            await refreshWaitingTrip(resetTrip);
          }
        }
      } finally {
        rejectTripInProgressRef.current = false;
      }
    };

    const handleArrivedAtPickup = () => {
      if (!activeTrip || activeTrip.status !== 'ACCEPTED') return;
      const updated = { ...activeTrip, status: 'ARRIVED' as TripStatus };
      setActiveTripWithTracking(updated);
      if (supabaseConnected) {
        saveActiveTrip(updated);
      }

      if (driverIsLoggedIn && activeTrip.driverId === selectedDriverId) {
        playNotificationSound('trip_accepted');
        speakText(
          lang === 'ar'
            ? 'وصلت إلى نقطة الركوب. يمكنك الآن بدء الرحلة.'
            : 'You have arrived at the pickup location.',
          lang === 'ar' ? 'ar-EG' : 'en-US'
        );
        sendNativeNotification(
          '📍 وصلت للركوب',
          'أنت الآن في نقطة الركوب.',
          '📍'
        );
        triggerVibration([200, 100, 200, 100, 300]);
        triggerToast(
          '📍 وصلت للركوب',
          'أنت الآن في نقطة الركوب.',
          'info'
        );
      }
    };

    const handleStartTrip = () => {
      if (!activeTrip || activeTrip.status !== 'ARRIVED') return;
      const pickupX = activeTrip.pickup.x ?? 50;
      const pickupY = activeTrip.pickup.y ?? 50;
      setDrivers((ds) =>
        ds.map((d) =>
          d.id === activeTrip.driverId
            ? {
                ...d,
                currentX: pickupX,
                currentY: pickupY,
                lat: (() => {
                  const latBase = 29.6197;
                  const lngBase = 31.2561;
                  return latBase + (pickupY - 50) * 0.0025;
                })(),
                lng: (() => {
                  const latBase = 29.6197;
                  const lngBase = 31.2561;
                  return lngBase + (pickupX - 50) * 0.0025;
                })(),
              }
            : d
        )
      );
      const updated = { ...activeTrip, status: 'STARTED' as TripStatus };
      setActiveTripWithTracking(updated);
      if (supabaseConnected) {
        saveActiveTrip(updated);
      }

      if (driverIsLoggedIn && activeTrip.driverId === selectedDriverId) {
        playNotificationSound('trip_accepted');
        speakText(
          lang === 'ar'
            ? 'بدأت الرحلة الآن، نتمنى لك مشواراً آمناً.'
            : 'The ride has started, wish you a safe trip.',
          lang === 'ar' ? 'ar-EG' : 'en-US'
        );
        triggerVibration([200, 100, 200, 100, 300]);
        triggerToast(
          '🚀 بدأت الرحلة الآن!',
          'نتمنى لك رحلة سعيدة وآمنة.',
          'success'
        );
      }
    };

    const handleRiderConfirmArrival = () => {
      if (!activeTrip || activeTrip.status !== 'ARRIVED') return;
      const updated = { ...activeTrip, status: 'STARTED' as TripStatus };
      setActiveTripWithTracking(updated);
      if (supabaseConnected) {
        saveActiveTrip(updated);
      }

      if (!driverIsLoggedIn) {
        playNotificationSound('trip_accepted');
        speakText(
          lang === 'ar'
            ? 'بدأت الرحلة الآن، نتمنى لك مشواراً آمناً.'
            : 'The ride has started, wish you a safe trip.',
          lang === 'ar' ? 'ar-EG' : 'en-US'
        );
        triggerVibration([200, 100, 200, 100, 300]);
        triggerToast(
          '🚀 بدأت الرحلة الآن!',
          'نتمنى لك رحلة سعيدة وآمنة.',
          'success'
        );
      }
    };

    const handleEndTrip = async () => {
      if (!activeTrip || activeTrip.status !== 'STARTED' || endTripInProgressRef.current) return;

      endTripInProgressRef.current = true;

      const { driverId, fare, commission } = activeTrip;
      const netEarnings = fare - commission;

      try {
        if (driverId) {
          const updatedDrivers = drivers.map((d) => {
            if (d.id !== driverId) return d;
            return {
              ...d,
              status: 'AVAILABLE' as const,
              isOnline: true,
              totalTrips: d.totalTrips + 1,
              totalEarnings: d.totalEarnings + netEarnings,
              totalCommissionPaid: d.totalCommissionPaid + commission,
            };
          });
          const updatedDriver = updatedDrivers.find((d) => d.id === driverId);
          setDrivers(updatedDrivers);

          if (updatedDriver && supabaseConnected) {
            let saved = await saveDriver(updatedDriver);
            if (!saved) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
              saved = await saveDriver(updatedDriver);
            }
            if (!saved) {
              console.error('[handleEndTrip] Failed to save driver stats after retry');
              triggerToast(
                lang === 'ar' ? 'خطأ في حفظ بيانات السائق' : 'Failed to save driver data',
                lang === 'ar' ? 'تم تحديث البيانات محلياً لكن لم يتم حفظها على السيرفر' : 'Data updated locally but not saved to server',
                'warning'
              );
            }
          }
        }

        setStats((s) => ({
          ...s,
          totalRevenue: s.totalRevenue + fare,
          totalCommission: s.totalCommission + commission,
          totalCompletedTrips: s.totalCompletedTrips + 1,
        }));

        const completed: Trip = {
          ...activeTrip,
          status: 'COMPLETED' as TripStatus,
          completedAt: new Date().toISOString(),
        };

        lastRouteCacheUseRef.current = Date.now();
        setRouteCache((cache) => {
          const { pickup, dropoff } = completed;
          const key = `${pickup.lat.toFixed(4)}_${pickup.lng.toFixed(4)}_${dropoff.lat.toFixed(4)}_${dropoff.lng.toFixed(4)}`;
          const next = { ...cache };
          delete next[key];
          return next;
        });

        if (supabaseConnected) {
          await saveActiveTrip(completed);
          const savedDriver = await saveTripToHistory(completed, driverId, 'driver', getDeviceId());
          if (!savedDriver) {
            console.error('[handleEndTrip] Failed to save completed trip for driver');
          }
          if (activeTrip.riderId) {
            const savedRider = await saveTripToHistory(completed, activeTrip.riderId, 'rider', getDeviceId());
            if (!savedRider) {
              console.error('[handleEndTrip] Failed to save completed trip for rider');
            }
          }
        }

        setActiveTripWithTracking(completed);

        if (driverIsLoggedIn && driverId === selectedDriverId) {
          playNotificationSound('trip_completed');
          speakText(
            lang === 'ar'
              ? 'تم إنهاء الرحلة بنجاح. حمد لله على السلامة.'
              : 'Trip completed successfully. Thank you.',
            lang === 'ar' ? 'ar-EG' : 'en-US'
          );
          sendNativeNotification(
            '🎉 تم إنهاء الرحلة',
            'تم إكمال الرحلة بنجاح.',
            '✨'
          );
          triggerVibration([200, 100, 200, 100, 300]);
          triggerToast(
            '🎉 تم إنهاء الرحلة',
            'تم إكمال الرحلة بنجاح.',
            'success'
          );
        }
      } finally {
        endTripInProgressRef.current = false;
      }
    };

  // Handler: Trip completed — skip rating, return driver to home
      const handleTripCompleted = () => {
        if (!activeTrip) return;

        const capturedId = activeTrip.id;
        dismissedTripIdsRef.current.add(capturedId);

        try { localStorage.removeItem('ezz_active_trip_cache'); } catch {}
        setActiveTripWithTracking(null);
        setNoAvailableDrivers(false);

        if (supabaseConnected) {
          saveActiveTrip(null, capturedId).then((ok) => {
            console.log('[handleTripCompleted] Cleared active trip, result:', ok);
          });
        }

        // Ensure user is returned to their role-specific dashboard after trip completion
        if (driverIsLoggedIn) {
          setCurrentScreen('DRIVER_DASHBOARD');
        } else if (rider.isLoggedIn) {
          setCurrentScreen('RIDER_DASHBOARD');
        } else {
          setCurrentScreen('HOME');
        }
      };

    const handleUpdateCommissionRate = (rate: number) => {
      setStats((prev) => ({ ...prev, commissionRate: rate }));
    };

    const handleUpdatePricingStats = (updatedStats: Partial<SystemStats>) => {
      setStats((prev) => ({ ...prev, ...updatedStats }));
    };

    const handleSavePricingStats = async (updatedStats: SystemStats) => {
      console.log('Saving pricing stats:', updatedStats);
      setStats(updatedStats);
      // Prevent the background sync loop from immediately overwriting
      // the freshly-saved pricing values while the server persists them.
      pricingSaveGuardUntilRef.current = Date.now() + 10000; // 10s guard
      if (supabaseConnected) {
        const saved = await saveStats(updatedStats);
        console.log('saveStats result:', saved);
        if (saved) {
          triggerToast(
            lang === 'ar' ? 'تم حفظ الأسعار بنجاح' : 'Pricing saved',
            lang === 'ar' ? 'تم تحديث الأسعار والعمولات بنجاح' : 'Fares and commissions updated successfully',
            'success'
          );
          // Force re-fetch to confirm the save persisted
          const refetched = await fetchStats();
          if (refetched) {
            setStats(refetched);
          }
        } else {
          triggerToast(
            lang === 'ar' ? 'خطأ في الحفظ' : 'Save failed',
            lang === 'ar' ? 'فشل حفظ التغييرات في قاعدة البيانات' : 'Failed to save pricing changes',
            'warning'
          );
        }
      } else {
        triggerToast(
          lang === 'ar' ? 'غير متصل' : 'Offline',
          lang === 'ar' ? 'لم يتم الحفظ - الاتصال مفصول' : 'Not saved - offline mode',
          'warning'
        );
      }
    };

    const handleSettleDriverCommissions = async (driverId: string) => {
      const driver = drivers.find((d) => d.id === driverId);
      console.log('[handleSettleDriverCommissions] driverId:', driverId, 'found:', !!driver, 'supabaseConnected:', supabaseConnected, 'currentCommission:', driver?.totalCommissionPaid);
      if (!driver) return;
      const cleared = { ...driver, totalCommissionPaid: 0 };
      if (supabaseConnected) {
        const saved = await saveDriver(cleared);
        console.log('[handleSettleDriverCommissions] saveDriver result:', saved);
        if (saved) {
          setDrivers((prev) => prev.map((d) => (d.id === driverId ? cleared : d)));
          lastSyncedDriversRef.current[driverId] = {
            currentX: cleared.currentX,
            currentY: cleared.currentY,
            isOnline: cleared.isOnline,
            status: cleared.status,
            totalEarnings: cleared.totalEarnings,
            totalCommissionPaid: 0,
            totalTrips: cleared.totalTrips,
            rating: cleared.rating,
            approvalStatus: cleared.approvalStatus,
            serviceAreas: cleared.serviceAreas,
          };
        }
      } else {
        setDrivers((prev) => prev.map((d) => (d.id === driverId ? cleared : d)));
      }
    };

    // Handler: Update Regions (admin areas management)
    const handleUpdateRegions = (newRegions: Region[]) => {
      setRegions(newRegions);
    };

    // Handler: Update Driver Service Areas
    const handleUpdateServiceAreas = async (driverId: string, areas: string[]) => {
      const driver = drivers.find((d) => d.id === driverId);
      if (!driver) return;
      const hasNoAreas = areas.length === 0;
      const updated = {
        ...driver,
        serviceAreas: areas,
        status: hasNoAreas ? 'UNAVAILABLE' as const : 'AVAILABLE' as const,
        isOnline: !hasNoAreas,
      };
      if (supabaseConnected) {
        const saved = await saveDriver(updated);
        if (saved) {
          setDrivers((prev) => prev.map((d) => (d.id === driverId ? updated : d)));
          lastSyncedDriversRef.current[driverId] = {
            currentX: updated.currentX,
            currentY: updated.currentY,
            isOnline: updated.isOnline,
            status: updated.status,
            totalEarnings: updated.totalEarnings,
            totalCommissionPaid: updated.totalCommissionPaid,
            totalTrips: updated.totalTrips,
            rating: updated.rating,
            approvalStatus: updated.approvalStatus,
            serviceAreas: updated.serviceAreas,
          };
        }
      } else {
        setDrivers((prev) => prev.map((d) => (d.id === driverId ? updated : d)));
      }
    };

    // Account verification workflows called by Administrator
    const handleApproveDriver = async (driverId: string) => {
      const driver = drivers.find(d => d.id === driverId);
      console.log('[handleApproveDriver] driverId:', driverId, 'found:', !!driver, 'supabaseConnected:', supabaseConnected, 'currentApproval:', driver?.approvalStatus);
      if (!driver) return;
      if (!supabaseConnected) {
        setDrivers(prev => prev.map(d => d.id === driverId ? { ...d, approvalStatus: 'APPROVED' } : d));
        triggerToast(lang === 'ar' ? 'غير متصل' : 'Offline', lang === 'ar' ? 'السجل محفوظ محلياً فقط' : 'Saved locally only', 'warning');
        return;
      }
      const updated = { ...driver, approvalStatus: 'APPROVED' as const };
      try {
        const saved = await saveDriver(updated);
        console.log('[handleApproveDriver] saveDriver result:', saved);
        if (saved) {
          setDrivers(prev => prev.map(d => d.id === driverId ? { ...d, approvalStatus: 'APPROVED' } : d));
          lastSyncedDriversRef.current[driverId] = {
            approvalStatus: 'APPROVED',
            currentX: updated.currentX,
            currentY: updated.currentY,
            isOnline: updated.isOnline,
            status: updated.status,
            totalEarnings: updated.totalEarnings,
            totalCommissionPaid: updated.totalCommissionPaid,
            totalTrips: updated.totalTrips,
            rating: updated.rating,
            serviceAreas: updated.serviceAreas,
          };
          triggerToast(lang === 'ar' ? 'تم القبول بنجاح' : 'Approved successfully', lang === 'ar' ? 'تم تفعيل السائق بنجاح' : 'Driver activated successfully', 'success');
        } else {
          triggerToast(lang === 'ar' ? 'خطأ في الحفظ' : 'Save error', lang === 'ar' ? 'فشل حفظ التغيير في قاعدة البيانات' : 'Failed to save changes to database', 'warning');
        }
      } catch (e) {
        console.error('[handleApproveDriver] Error:', e);
        triggerToast(lang === 'ar' ? 'خطأ' : 'Error', lang === 'ar' ? 'حدث خطأ أثناء حفظ الموافقة' : 'Error occurred while saving approval', 'warning');
      }
    };

    const handleRejectDriver = async (driverId: string) => {
      const driver = drivers.find(d => d.id === driverId);
      if (!driver) return;
      if (!supabaseConnected) {
        setDrivers(prev => prev.map(d => d.id === driverId ? { ...d, approvalStatus: 'REJECTED' } : d));
        return;
      }
      try {
        const updated = { ...driver, approvalStatus: 'REJECTED' as const };
        const saved = await saveDriver(updated);
        if (saved) {
          setDrivers(prev => prev.map(d => d.id === driverId ? { ...d, approvalStatus: 'REJECTED' } : d));
          lastSyncedDriversRef.current[driverId] = {
            approvalStatus: 'REJECTED',
            currentX: updated.currentX,
            currentY: updated.currentY,
            isOnline: updated.isOnline,
            status: updated.status,
            totalEarnings: updated.totalEarnings,
            totalCommissionPaid: updated.totalCommissionPaid,
            totalTrips: updated.totalTrips,
            rating: updated.rating,
            serviceAreas: updated.serviceAreas,
          };
        }
      } catch (e) {
        console.error('Error rejecting driver:', e);
      }
    };

    const handleFreezeDriver = async (driverId: string) => {
      const driver = drivers.find(d => d.id === driverId);
      if (!driver) return;
      if (!supabaseConnected) {
        setDrivers(prev => prev.map(d => d.id === driverId ? { ...d, approvalStatus: 'FROZEN', isOnline: false } : d));
        return;
      }
      try {
        const updated = { ...driver, approvalStatus: 'FROZEN' as const, isOnline: false };
        const saved = await saveDriver(updated);
        if (saved) {
          setDrivers(prev => prev.map(d => d.id === driverId ? { ...d, approvalStatus: 'FROZEN', isOnline: false } : d));
          lastSyncedDriversRef.current[driverId] = {
            approvalStatus: 'FROZEN',
            isOnline: false,
            currentX: updated.currentX,
            currentY: updated.currentY,
            status: updated.status,
            totalEarnings: updated.totalEarnings,
            totalCommissionPaid: updated.totalCommissionPaid,
            totalTrips: updated.totalTrips,
            rating: updated.rating,
            serviceAreas: updated.serviceAreas,
          };
        }
      } catch (e) {
        console.error('Error freezing driver:', e);
      }
    };

    const handleUnfreezeDriver = async (driverId: string) => {
      const driver = drivers.find(d => d.id === driverId);
      if (!driver) return;
      if (!supabaseConnected) {
        setDrivers(prev => prev.map(d => d.id === driverId ? { ...d, approvalStatus: 'APPROVED' } : d));
        return;
      }
      try {
        const updated = { ...driver, approvalStatus: 'APPROVED' as const };
        const saved = await saveDriver(updated);
        if (saved) {
          setDrivers(prev => prev.map(d => d.id === driverId ? { ...d, approvalStatus: 'APPROVED' } : d));
          lastSyncedDriversRef.current[driverId] = {
            approvalStatus: 'APPROVED',
            currentX: updated.currentX,
            currentY: updated.currentY,
            isOnline: updated.isOnline,
            status: updated.status,
            totalEarnings: updated.totalEarnings,
            totalCommissionPaid: updated.totalCommissionPaid,
            totalTrips: updated.totalTrips,
            rating: updated.rating,
            serviceAreas: updated.serviceAreas,
          };
        }
      } catch (e) {
        console.error('Error unfreezing driver:', e);
      }
    };

    const handleDeleteDriver = async (driverId: string) => {
      setDrivers(prev => prev.filter(d => d.id !== driverId));
      await deleteDriverInDB(driverId);
    };

    // Rider account management workflows called by Administrator
    const handleFreezeRider = (riderId: string) => {
      setRegisteredRiders(prev => prev.map(r => r.id === riderId ? { ...r, approvalStatus: 'FROZEN' } : r));
      const frozenRider = registeredRiders.find(r => r.id === riderId);
      if (frozenRider) saveRider({ ...frozenRider, approvalStatus: 'FROZEN' });
    };

    const handleUnfreezeRider = (riderId: string) => {
      setRegisteredRiders(prev => prev.map(r => r.id === riderId ? { ...r, approvalStatus: 'APPROVED' } : r));
      const unfrozenRider = registeredRiders.find(r => r.id === riderId);
      if (unfrozenRider) saveRider({ ...unfrozenRider, approvalStatus: 'APPROVED' });
    };

    const handleBlockRider = (riderId: string) => {
      setRegisteredRiders(prev => prev.map(r => r.id === riderId ? { ...r, approvalStatus: 'BLOCKED' } : r));
      const blockedRider = registeredRiders.find(r => r.id === riderId);
      if (blockedRider) saveRider({ ...blockedRider, approvalStatus: 'BLOCKED' });
    };

    const handleUnblockRider = (riderId: string) => {
      setRegisteredRiders(prev => prev.map(r => r.id === riderId ? { ...r, approvalStatus: 'APPROVED' } : r));
      const unblockedRider = registeredRiders.find(r => r.id === riderId);
      if (unblockedRider) saveRider({ ...unblockedRider, approvalStatus: 'APPROVED' });
    };

    const handleDeleteRider = async (riderId: string) => {
      setRegisteredRiders(prev => prev.filter(r => r.id !== riderId));
      await deleteRiderInDB(riderId);
    };

    const handleClearAllFakeData = async () => {
      if (!confirm(lang === 'ar' ? 'تحذير: هذا سيمسح جميع بيانات الركاب والسائقين الوهمية نهائياً من السيرفر والجهاز. هل أنت متأكد؟' : 'WARNING: This will permanently delete ALL fake riders and drivers data from server and device. Are you sure?')) {
        return;
      }
      if (!confirm(lang === 'ar' ? 'تأكيد نهائي: جميع الحسابات الوهمية ستُحذف ولا يمكن استرجاعها!' : 'Final confirmation: ALL fake accounts will be deleted and cannot be recovered!')) {
        return;
      }

      setDrivers([]);
      setRegisteredRiders([]);

      await Promise.allSettled([
        clearAllDriversInDB(),
        clearAllRidersInDB(),
        clearTripsHistoryInDB(adminUserId, getDeviceId())
      ]);

      alert(lang === 'ar' ? 'تم مسح جميع البيانات الوهمية نهائياً' : 'All fake data has been permanently cleared');
    };

    const handleAdminForceCancelTrip = async (tripId: string) => {
      if (!supabaseConnected) {
        triggerToast(
          lang === 'ar' ? 'غير متصل' : 'Offline',
          lang === 'ar' ? 'لا يمكن تنفيذ العملية بدون اتصال' : 'Cannot perform this action while offline',
          'warning'
        );
        return;
      }
      if (!confirm(lang === 'ar' ? 'تأكيد إلغاء الرحلة' : 'Confirm cancel trip')) return;

      let trip = activeTrip?.id === tripId ? activeTrip : null;
      if (!trip) {
        const { data } = await supabase
          .from('ezz_active_trip')
          .select('*')
          .eq('id', tripId)
          .maybeSingle();
        if (data) {
          trip = mapTripFromDB(data);
        }
      }
      if (!trip) {
        triggerToast(
          lang === 'ar' ? 'خطأ' : 'Error',
          lang === 'ar' ? 'الرحلة غير موجودة' : 'Trip not found',
          'warning'
        );
        return;
      }

      const cancelled: Trip = {
        ...trip,
        status: 'CANCELLED' as TripStatus,
        completedAt: new Date().toISOString(),
      };

      if (trip.driverId) {
        setDrivers((prev) =>
          prev.map((d) => (d.id === trip.driverId ? { ...d, status: 'AVAILABLE' } : d))
        );
        const driver = drivers.find((d) => d.id === trip.driverId);
        if (driver) {
          await saveDriver({ ...driver, status: 'AVAILABLE' }).catch(() => {});
        }
      }

      try {
        await saveActiveTrip(cancelled);
        if (trip.riderId) {
          await saveTripToHistory(cancelled, trip.riderId, 'rider', getDeviceId());
        }
        if (trip.driverId) {
          await saveTripToHistory(cancelled, trip.driverId, 'driver', getDeviceId());
        }
        await saveActiveTrip(null, tripId);
      } catch (e) {
        console.warn('[adminForceCancel] DB error:', e);
      }

      if (activeTrip?.id === tripId) {
        setActiveTripWithTracking(null);
        setNoAvailableDrivers(false);
      }

      triggerToast(
        lang === 'ar' ? 'تم إلغاء الرحلة' : 'Trip cancelled',
        lang === 'ar' ? 'تم إلغاء الرحلة بنجاح من لوحة التحكم' : 'Trip has been cancelled from admin panel',
        'success'
      );
    };

    const handleAdminForceEndTrip = async (tripId: string) => {
      if (!supabaseConnected) {
        triggerToast(
          lang === 'ar' ? 'غير متصل' : 'Offline',
          lang === 'ar' ? 'لا يمكن تنفيذ العملية بدون اتصال' : 'Cannot perform this action while offline',
          'warning'
        );
        return;
      }
      if (!confirm(lang === 'ar' ? 'تأكيد إنهاء الرحلة' : 'Confirm end trip')) return;

      let trip = activeTrip?.id === tripId ? activeTrip : null;
      if (!trip) {
        const { data } = await supabase
          .from('ezz_active_trip')
          .select('*')
          .eq('id', tripId)
          .maybeSingle();
        if (data) {
          trip = mapTripFromDB(data);
        }
      }
      if (!trip || trip.status !== 'STARTED') {
        triggerToast(
          lang === 'ar' ? 'خطأ' : 'Error',
          lang === 'ar' ? 'لا يمكن إنهاء هذه الرحلة (ليست في حالة جارية)' : 'Cannot end this trip (not in STARTED status)',
          'warning'
        );
        return;
      }

      const { driverId, fare, commission } = trip;
      const netEarnings = fare - commission;

      if (driverId) {
        const updatedDrivers = drivers.map((d) => {
          if (d.id !== driverId) return d;
          return {
            ...d,
            status: 'OFFLINE' as const,
            isOnline: false,
            totalTrips: d.totalTrips + 1,
            totalEarnings: d.totalEarnings + netEarnings,
            totalCommissionPaid: d.totalCommissionPaid + commission,
          };
        });
        const updatedDriver = updatedDrivers.find((d) => d.id === driverId);
        setDrivers(updatedDrivers);
        if (updatedDriver) {
          await saveDriver(updatedDriver).catch(() => {});
        }
      }

      setStats((s) => ({
        ...s,
        totalRevenue: s.totalRevenue + fare,
        totalCommission: s.totalCommission + commission,
        totalCompletedTrips: s.totalCompletedTrips + 1,
      }));

      const completed: Trip = {
        ...trip,
        status: 'COMPLETED' as TripStatus,
        completedAt: new Date().toISOString(),
      };

      try {
        await saveActiveTrip(completed);
        if (trip.driverId) {
          await saveTripToHistory(completed, trip.driverId, 'driver', getDeviceId());
        }
        if (trip.riderId) {
          await saveTripToHistory(completed, trip.riderId, 'rider', getDeviceId());
        }
        await saveActiveTrip(null, tripId);
      } catch (e) {
        console.warn('[adminForceEnd] DB error:', e);
      }

      if (activeTrip?.id === tripId) {
        setActiveTripWithTracking(completed);
      }

      triggerToast(
        lang === 'ar' ? 'تم إنهاء الرحلة' : 'Trip ended',
        lang === 'ar' ? 'تم إنهاء الرحلة بنجاح من لوحة التحكم' : 'Trip has been ended from admin panel',
        'success'
      );
    };

    // Rider auth submission
    const handleRiderSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (riderSubmitting) return; // block double-submit spam
      setRiderFormError('');
      setRiderSubmitting(true);
      try {

      if (riderFormMode === 'LOGIN') {
        if (!riderLoginPhone.trim() || !riderLoginPassword.trim()) {
          setRiderFormError(lang === 'ar' ? 'يرجى إدخال رقم الهاتف وكلمة المرور' : 'Please enter phone and password');
          return;
        }

        if (!riderAuthLimiter.isAllowed(riderLoginPhone.trim())) {
          const retryAfter = riderAuthLimiter.getRetryAfter(riderLoginPhone.trim());
          setRiderFormError(lang === 'ar'
            ? `تم تجاوز محاولات تسجيل الدخول. يرجى المحاولة بعد ${retryAfter} ثانية`
            : `Too many login attempts. Please try again in ${retryAfter} seconds`);
          auditLogger.log('rider_login', riderLoginPhone.trim(), 'rider', 'Rate limited', false, 'Rate limit exceeded');
          return;
        }

        const verifyPasswordHash = async (storedPassword: string | undefined, inputPassword: string): Promise<boolean> => {
          if (!storedPassword) return false;
          if (storedPassword === inputPassword) return true;
          if (storedPassword === obfuscatePassword(inputPassword)) return true;
          if (deobfuscatePassword(storedPassword) === inputPassword) return true;
          if (isSecureHash(storedPassword)) {
            try {
              return await verifyPassword(inputPassword, storedPassword);
            } catch {
              return false;
            }
          }
          return false;
        };

        if (driverIsLoggedIn || adminIsLoggedIn) {
          setRiderFormError(lang === 'ar' ? 'يوجد حساب سائق/مدير مسجل حالياً. يرجى تسجيل الخروج أولاً.' : 'A driver/admin account is already logged in. Please logout first.');
          auditLogger.log('rider_login', riderLoginPhone.trim(), 'rider', 'Blocked - other role active', false, 'Another role already logged in');
          return;
        }

        const found = registeredRiders.find(
          r => r.phone.trim() === riderLoginPhone.trim()
        );

        if (!found || !(await verifyPasswordHash(found.password, riderLoginPassword.trim()))) {
          setRiderFormError(lang === 'ar' ? 'رقم الهاتف أو كلمة المرور غير صحيحة!' : 'Incorrect phone or password!');
          auditLogger.log('rider_login', riderLoginPhone.trim(), 'rider', 'Login failed - invalid credentials', false);
          return;
        }

        auditLogger.log('rider_login', found.id, 'rider', 'Login successful', true);
        riderAuthLimiter.reset(riderLoginPhone.trim());
        setRider({ ...found, isLoggedIn: true });
        restoreRiderPickupRegion(found);
        if (supabaseConnected) {
          await setAppRole('RIDER');
          await clearSession('RIDER');
          await clearSession('ADMIN');
          await saveSession('RIDER', found.id);
        }
        setCurrentScreen('RIDER_DASHBOARD');
      } else {
        // SIGNUP mode
        if (!riderFormName.trim() || !riderFormPhone.trim() || !riderFormPassword.trim()) {
          setRiderFormError(lang === 'ar' ? 'الرجاء ملء جميع الحقول المطلوبة' : 'Please fill all fields');
          return;
        }
        
        // Validate Name is Dual (الاسم ثنائي)
        const nameParts = riderFormName.trim().split(/\s+/).filter(Boolean);
        if (nameParts.length < 2) {
          setRiderFormError(lang === 'ar' ? 'الرجاء إدخال الاسم ثنائي بالكامل (الاسم الأول واللقب)' : 'Please enter full dual name (First + Last name)');
          return;
        }

        if (riderFormPassword.trim().length < 3) {
          setRiderFormError(lang === 'ar' ? 'كلمة المرور يجب أن تكون 3 أحرف على الأقل' : 'Password must be at least 3 characters');
          return;
        }

        // Check for duplicate phone
        const phoneExists = registeredRiders.some(r => r.phone.trim() === riderFormPhone.trim());
        if (phoneExists) {
          setRiderFormError(lang === 'ar' ? 'رقم الهاتف هذا مسجل بالفعل! جرب تسجيل الدخول' : 'This phone number is already registered! Try logging in');
          return;
        }

        if (!riderFormAgreed) {
          setRiderFormError(lang === 'ar' ? 'يجب الموافقة على سياسات الراكب للاستمرار' : 'Please accept the Rider Policies');
          return;
        }

        const hashedPassword = await hashPassword(riderFormPassword.trim());

        const newRider: Rider = {
          id: `rider_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          name: riderFormName.trim(),
          phone: riderFormPhone.trim(),
          password: hashedPassword,
          rating: 5.0,
          totalTrips: 0
        };

        setRegisteredRiders(prev => [newRider, ...prev]);
        setRider({ ...newRider, isLoggedIn: true });
        setCurrentScreen('RIDER_DASHBOARD');
      }
      } finally {
        setRiderSubmitting(false);
      }
    };

    // Driver onboarding submission
    const handleDriverSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (driverSubmitting) return; // block double-submit spam
      setDrvFormError('');
      setDriverSubmitting(true);
      try {

      if (drvFormMode === 'LOGIN') {
        if (!drvLoginPhone.trim() || !drvLoginPassword.trim()) {
          setDrvFormError(lang === 'ar' ? 'يرجى إدخال رقم الهاتف وكلمة المرور' : 'Please enter phone and password');
          return;
        }

        if (!driverAuthLimiter.isAllowed(drvLoginPhone.trim())) {
          const retryAfter = driverAuthLimiter.getRetryAfter(drvLoginPhone.trim());
          setDrvFormError(lang === 'ar' 
            ? `تم تجاوز محاولات تسجيل الدخول. يرجى المحاولة بعد ${retryAfter} ثانية`
            : `Too many login attempts. Please try again in ${retryAfter} seconds`);
          auditLogger.log('driver_login', drvLoginPhone.trim(), 'driver', 'Rate limited - too many attempts', false, 'Rate limit exceeded');
          return;
        }

        const verifyPasswordHash = async (storedPassword: string | undefined, inputPassword: string): Promise<boolean> => {
          if (!storedPassword) return false;
          if (storedPassword === inputPassword) return true;
          if (storedPassword === obfuscatePassword(inputPassword)) return true;
          if (deobfuscatePassword(storedPassword) === inputPassword) return true;
          if (isSecureHash(storedPassword)) {
            try {
              return await verifyPassword(inputPassword, storedPassword);
            } catch {
              return false;
            }
          }
          return false;
        };

        const found = drivers.find(
          d => d.phone.trim() === drvLoginPhone.trim()
        );

        if (!found) {
          setDrvFormError(lang === 'ar' ? 'رقم الهاتف أو كلمة المرور غير صحيحة!' : 'Incorrect phone or password!');
          auditLogger.log('driver_login', drvLoginPhone.trim(), 'driver', 'Login failed - driver not found', false);
          return;
        }

        const passwordMatches = await verifyPasswordHash(found.password, drvLoginPassword.trim());
        if (!passwordMatches) {
          setDrvFormError(lang === 'ar' ? 'رقم الهاتف أو كلمة المرور غير صحيحة!' : 'Incorrect phone or password!');
          auditLogger.log('driver_login', drvLoginPhone.trim(), 'driver', 'Login failed - wrong password', false);
          return;
        }

        if (rider.isLoggedIn || adminIsLoggedIn) {
          setDrvFormError(lang === 'ar' ? 'يوجد حساب راكب/مدير مسجل حالياً. يرجى تسجيل الخروج أولاً.' : 'A rider/admin account is already logged in. Please logout first.');
          auditLogger.log('driver_login', drvLoginPhone.trim(), 'driver', 'Blocked - other role active', false, 'Another role already logged in');
          return;
        }

        setSelectedDriverId(found.id);
        setDriverIsLoggedIn(true);
        if (supabaseConnected) {
          await clearSession('RIDER');
          await clearSession('ADMIN');
          await saveSession('DRIVER', found.id);
          
          // Auto-set driver as online in Supabase so riders can see them
          const updatedDriver = { ...found, isOnline: true, status: 'AVAILABLE' as const };
          await saveDriver(updatedDriver);
          setDrivers(prev => prev.map(d => d.id === found.id ? updatedDriver : d));
          
          // Register FCM token for push notifications
          try {
            const fcmToken = await getFCMToken();
            if (fcmToken) {
              const driverWithToken = { ...updatedDriver, fcmToken };
              await saveDriver(driverWithToken);
              setDrivers(prev => prev.map(d => d.id === found.id ? driverWithToken : d));
              console.log('[FCM] Token saved for driver:', found.id);
            }
          } catch (err) {
            console.warn('[FCM] Could not register token:', err);
          }
          
          const freshDrivers = await fetchDrivers();
          if (freshDrivers && freshDrivers.length > 0) {
            setDrivers(freshDrivers);
          }
        }
        setCurrentScreen('DRIVER_DASHBOARD');
      } else {
        // SIGNUP mode
        if (!drvFormName.trim() || !drvFormPhone.trim() || !drvFormPassword.trim() || !drvFormVehicleName.trim() || !drvFormNationalId.trim() || !drvFormLicense.trim()) {
          setDrvFormError(lang === 'ar' ? 'الرجاء ملء جميع الحقول الأساسية' : 'Please fill all required fields');
          return;
        }

        // Validate Name is at least Dual (الاسم ثنائي على الأقل)
        const nameParts = drvFormName.trim().split(/\s+/).filter(Boolean);
        if (nameParts.length < 2) {
          setDrvFormError(lang === 'ar' ? 'الرجاء إدخال الاسم ثنائي أو ثلاثي بالكامل' : 'Please enter full name (First + Last name)');
          return;
        }

        if (drvFormPassword.trim().length < 3) {
          setDrvFormError(lang === 'ar' ? 'كلمة المرور يجب أن تكون 3 أحرف على الأقل' : 'Password must be at least 3 characters');
          return;
        }

        if (drvFormNationalId.trim().length < 10) {
          setDrvFormError(lang === 'ar' ? 'رقم البطاقة الشخصية غير صحيح (يجب ألا يقل عن 10 أرقام)' : 'National ID is too short (must be at least 10 digits)');
          return;
        }

        // Check for duplicate phone
        const phoneExists = drivers.some(d => d.phone.trim() === drvFormPhone.trim());
        if (phoneExists) {
          setDrvFormError(lang === 'ar' ? 'رقم الهاتف هذا مسجل بالفعل لكابتن آخر!' : 'This phone number is already registered for another captain');
          return;
        }

        if (!drvFormAgreed) {
          setDrvFormError(lang === 'ar' ? 'يجب الموافقة على شروط الانضمام ونظام العمولات' : 'You must agree to onboarding terms');
          return;
        }

        const newId = `drv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        
        const hashedPassword = await hashPassword(drvFormPassword.trim());

        const newDriver: Driver = {
          id: newId,
          name: drvFormName.trim(),
          phone: drvFormPhone.trim(),
          password: hashedPassword,
          carModel: drvFormVehicleName.trim(),
          carPlate: `ع ز ${Math.round(1000 + Math.random() * 8999)}`,
          vehicleType: drvFormVehicleType,
          vehicleName: drvFormVehicleName.trim(),
          vehicleBrand: drvFormVehicleBrand.trim() || undefined,
          vehicleLicense: drvFormVehicleLicense.trim() || undefined,
          nationalId: drvFormNationalId.trim(),
          driverLicense: drvFormLicense.trim(),
          secondaryPhone: drvFormSecondaryPhone.trim() || undefined,
          personalPhoto: undefined,
          nationalIdImage: undefined,
          driverLicenseImage: undefined,
          vehicleLicenseImage: undefined,
          isOnline: true,
          status: 'AVAILABLE',
          approvalStatus: 'PENDING',
          rating: 5.0,
          totalTrips: 0,
          totalEarnings: 0,
          totalCommissionPaid: 0,
          currentX: 50 + (Math.random() - 0.5) * 30,
          currentY: 50 + (Math.random() - 0.5) * 30,
          agreedToTerms: true,
          serviceAreas: []
        };

        setDrivers(prev => [newDriver, ...prev]);
        if (supabaseConnected) {
          const saved = await saveDriver(newDriver);
          if (!saved) console.warn('Driver signup saved locally but Supabase sync failed');
        }
        setSelectedDriverId(newId);
        setDriverIsLoggedIn(true);
        if (supabaseConnected) {
          await setAppRole('DRIVER');
        }
        setCurrentScreen('DRIVER_DASHBOARD');
      };
      } finally {
        setDriverSubmitting(false);
      }
    };

    const t = {
      ar: {
        title: 'كابتن عز 🚖',
        subtitle: 'تطبيق التوصيل الأوفر لقرى الجيزة وبني سويف',
        mapHeader: 'خارطة التوصيل المباشرة لكابتن عز 🗺️',
        mapDesc: 'تحديث حي وتفاعلي لنقاط الركوب والوجهات ومواقع الكباتن النشطين.',
        langToggle: 'English',
        footer: 'كابتن عز - نظام متكامل يخدم أهالينا بالقرى والمراكز بكفاءة تامة وشفافية كاملة. برمجة: أسامه إسلام بسيوني',
      },
      en: {
        title: 'Captain Ezz 🚖',
        subtitle: 'The Best Taxi App for Giza & Beni Suef Villages',
        mapHeader: 'Captain Ezz Live Vector Map 🗺️',
        mapDesc: 'Real-time interactive rendering of rural stations and active captain fleets.',
        langToggle: 'العربية',
        footer: 'Captain Ezz - Proudly serving rural communities with optimized routes and fair rates. Developed by: Osama Islam Basiony',
      }
    };

    const currentT = t[lang];

    const footerText = lang === 'ar' ? 'برمجة: أسامه إسلام بسيوني' : 'Developed by: Osama Islam Basiony';

    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col font-sans selection:bg-amber-400 selection:text-black">
  <NetworkStatusBar isOnline={networkConnected} isConnected={supabaseConnected} lang={lang} />
        <InitializingOverlay isInitializing={isInitializing} lang={lang} />
        {/* Top Header */}
        <header className="bg-slate-950 border-b border-slate-800 py-3.5 px-4 md:px-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="bg-amber-400 text-slate-950 text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wider">
                CAPTAIN EZZ
              </span>
              <h1 className="text-base font-extrabold text-white tracking-tight">
                {currentT.title}
              </h1>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">{currentT.subtitle}</p>
          </div>

          {/* Global Controls */}
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => openGuideModal('rider')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-black rounded-xl transition-all shadow-sm cursor-pointer pointer-events-auto"
            >
              <span>📖</span>
              <span>{lang === 'ar' ? 'دليل الاستخدام' : 'User Guide'}</span>
            </button>
            <button
              type="button"
              onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition-colors pointer-events-auto"
            >
              <Globe className="w-3.5 h-3.5 text-amber-400" />
              <span>{currentT.langToggle}</span>
            </button>
          </div>
        </header>

        {/* Main Workspace Layout */}
        <main className="flex-1 w-full max-w-7xl mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start overflow-hidden">
          
          {/* Left Side: Center-focused smartphone frame running the mobile first app */}
          <div className="lg:col-span-5 flex flex-col items-center justify-center">
            <div className="w-full max-w-[390px] bg-slate-950 rounded-[50px] p-4 border-[8px] border-slate-800 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9)] aspect-[9/19] flex flex-col relative overflow-hidden">
              
              {/* Phone Speaker Notch */}
              <div className="absolute top-2.5 left-1/2 transform -translate-x-1/2 w-32 h-6 bg-slate-950 rounded-full z-30 flex items-center justify-center gap-1">
                <div className="w-10 h-1 bg-slate-800 rounded-full" />
                <div className="w-2.5 h-2.5 bg-slate-900 rounded-full" />
              </div>

              {/* Virtual Phone Screen Content */}
              <div className="flex-1 bg-white rounded-[36px] overflow-hidden flex flex-col relative z-10 pt-3">
                
                {/* STATUS BAR WITH NAVIGATION TO HOME */}
                <div className="bg-slate-950 text-white px-3 py-1.5 flex items-center justify-between text-[10px] font-bold shadow-xs select-none shrink-0">
                  <div className="flex items-center gap-1">
                    <span>كابتن عز 🚖</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openGuideModal(currentScreen.includes('DRIVER') ? 'driver' : 'rider')}
                      className="bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 px-1.5 py-0.5 rounded text-[8.5px] font-black transition-all flex items-center gap-0.5 cursor-pointer pointer-events-auto shadow-xs"
                      title={lang === 'ar' ? 'دليل الاستخدام' : 'Guide'}
                    >
                      <span>📖</span>
                      <span>{lang === 'ar' ? 'الدليل' : 'Guide'}</span>
                    </button>
                    {currentScreen !== 'HOME' && (
                      <button
                        onClick={() => setCurrentScreen('HOME')}
                        className="bg-amber-400 hover:bg-amber-500 text-slate-950 px-1.5 py-0.5 rounded text-[8.5px] font-black transition-all flex items-center gap-0.5 cursor-pointer pointer-events-auto shadow-xs"
                      >
                        <span>◀</span>
                        <span>{lang === 'ar' ? 'الرئيسية' : 'Home'}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* PWA Install Promo Banner (Ultra Compact) */}
                {!installDismissed && (
                  <div className="bg-slate-900 text-white py-1 px-2.5 border-b border-amber-400/30 flex items-center justify-between gap-1.5 shrink-0 animate-fade-in relative z-20">
                    <div className="flex items-center gap-1.5 text-right min-w-0">
                      <div className="w-6 h-6 rounded-md bg-amber-400 flex items-center justify-center text-xs shadow-xs shrink-0">
                        🚖
                      </div>
                      <div className="min-w-0">
                        <p className="text-[9px] font-black text-amber-400 leading-tight truncate">
                          {lang === 'ar' ? 'تثبيت كابتن عز كأيقونة 📱' : 'Install Captain Ezz 📱'}
                        </p>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setShowInstallWizard(true)}
                        className="px-2 py-0.5 bg-amber-400 hover:bg-amber-500 text-slate-950 font-extrabold text-[8px] rounded-md shadow-2xs pointer-events-auto cursor-pointer flex items-center gap-0.5"
                      >
                        <span>⚡</span>
                        <span>{lang === 'ar' ? 'تثبيت' : 'Install'}</span>
                      </button>
                      <button
                        onClick={() => setInstallDismissed(true)}
                        className="text-slate-400 hover:text-white p-0.5 pointer-events-auto text-[9px] leading-none"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}

                {/* PWA Step-by-Step Installation Wizard Overlay */}
                {showInstallWizard && (
                  <div className="absolute inset-0 bg-slate-950/95 backdrop-blur-xs z-50 p-5 flex flex-col justify-between text-white animate-fade-in">
                    <div className="space-y-4">
                      <div className="flex justify-between items-center pb-2 border-b border-slate-800">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">📱</span>
                          <h3 className="text-xs font-black text-amber-400">
                            {lang === 'ar' ? 'دليل تثبيت كابتن عز' : 'Captain Ezz Installation'}
                          </h3>
                        </div>
                        <button
                          onClick={() => setShowInstallWizard(false)}
                          className="text-slate-400 hover:text-white p-1 pointer-events-auto cursor-pointer font-bold text-xs"
                        >
                          ✕
                        </button>
                      </div>

                      <div className="text-center space-y-1">
                        <div className="w-12 h-12 bg-amber-400 rounded-2xl flex items-center justify-center mx-auto text-3xl shadow-lg border-2 border-white/20 animate-bounce">
                          🚖
                        </div>
                        <h4 className="text-xs font-bold mt-2">
                          {lang === 'ar' ? 'تثبيت التطبيق على الشاشة الرئيسية' : 'Add App to Home Screen'}
                        </h4>
                        <p className="text-[9px] text-slate-400">
                          {lang === 'ar'
                            ? 'استمتع بتجربة تطبيق موبايل حقيقية وسريعة بدون استهلاك لمساحة جهازك.'
                            : 'Enjoy a true native experience with zero device storage overhead.'}
                        </p>
                      </div>

                      {/* Step-by-Step instructions tabs */}
                      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3 space-y-3">
                        <p className="text-[10px] font-bold text-amber-300 border-b border-slate-800 pb-1.5 flex items-center gap-1.5 justify-start">
                          <span>🤖</span>
                          <span>{lang === 'ar' ? 'طريقة التثبيت لأجهزة أندرويد (Chrome):' : 'For Android Devices (Chrome):'}</span>
                        </p>
                        <ol className="text-[9px] text-slate-300 space-y-2 list-decimal list-inside leading-relaxed text-right pr-1">
                          {lang === 'ar' ? (
                            <>
                              <li>اضغط على زر <strong>القائمة (⋮)</strong> في أعلى أو أسفل المتصفح.</li>
                              <li>اختر <strong>«التثبيت»</strong> أو <strong>«الإضافة إلى الشاشة الرئيسية»</strong>.</li>
                              <li>ستظهر أيقونة سيارة التاكسي الجميلة على هاتفك فوراً!</li>
                            </>
                          ) : (
                            <>
                              <li>Tap the <strong>browser menu (⋮)</strong> icon.</li>
                              <li>Select <strong>"Install app"</strong> or <strong>"Add to Home screen"</strong>.</li>
                              <li>The beautiful taxi icon will appear on your device launcher!</li>
                            </>
                          )}
                        </ol>

                        <p className="text-[10px] font-bold text-amber-300 border-b border-slate-800 pt-1 pb-1.5 flex items-center gap-1.5 justify-start">
                          <span>🍎</span>
                          <span>{lang === 'ar' ? 'طريقة التثبيت لأجهزة آيفون (Safari):' : 'For iPhone Devices (Safari):'}</span>
                        </p>
                        <ol className="text-[9px] text-slate-300 space-y-2 list-decimal list-inside leading-relaxed text-right pr-1">
                          {lang === 'ar' ? (
                            <>
                              <li>اضغط على زر <strong>المشاركة (Square with arrow)</strong> في أسفل متصفح سفاري.</li>
                              <li>مرر لأسفل القائمة ثم اختر <strong>«الإضافة للشاشة الرئيسية»</strong>.</li>
                              <li>اضغط على <strong>«إضافة»</strong> في الزاوية العلوية لتثبيت التطبيق.</li>
                            </>
                          ) : (
                            <>
                              <li>Tap the <strong>Share (square with arrow)</strong> icon in Safari.</li>
                              <li>Scroll down and select <strong>"Add to Home Screen"</strong>.</li>
                              <li>Tap <strong>"Add"</strong> in the top-right corner to complete!</li>
                            </>
                          )}
                        </ol>
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        setShowInstallWizard(false);
                        setInstallDismissed(true);
                      }}
                      className="w-full py-2.5 bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-xs rounded-xl shadow-md transition-all cursor-pointer pointer-events-auto"
                    >
                      {lang === 'ar' ? 'فهمت، سأقوم بالتثبيت الآن 👍' : 'Got it, installing now 👍'}
                    </button>
                  </div>
                )}

                {/* RENDER VIEWS BASED ON SELECTED MOBILE SCREEN */}
                <div className="flex-1 overflow-hidden relative">
                  
                  {/* 1. HOMEPAGE VIEW (الصفحة الرئيسية للموبايل) */}
                  {currentScreen === 'HOME' && (
                    <div className="h-full flex flex-col justify-between p-4 bg-slate-50 overflow-y-auto space-y-4">
                      <div className="space-y-4 text-center">
                        <div className="bg-gradient-to-br from-slate-900 to-indigo-950 text-white p-5 rounded-2xl shadow-md relative overflow-hidden">
                          <div className="absolute right-0 bottom-0 text-white/5 font-bold text-5xl">EZZ</div>
                          <h2 className="text-sm font-extrabold text-amber-400">{lang === 'ar' ? 'تطبيق كابتن عز للتوصيل' : 'Captain Ezz Delivery'}</h2>
                          <p className="text-[10px] text-slate-300 mt-1">
                            {lang === 'ar' ? 'التطبيق الأول والأنسب لقرى العياط وبني سويف والمراكز المجاورة' : 'The optimized transport system for rural communities'}
                          </p>
                          <p className="text-[9px] text-slate-400 mt-1">
                            {lang === 'ar' ? 'برمجة: أسامه إسلام بسيوني' : 'Developed by: Osama Islam Basiony'}
                          </p>
                          
                          {/* Interactive counters */}
                          <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-white/10 text-center">
                            <div>
                              <span className="block text-xs font-black text-amber-300">500+</span>
                              <span className="text-[8px] text-slate-300">{lang === 'ar' ? 'محطة ريفية مفعلة' : 'Rural Stations'}</span>
                            </div>
                            <div>
                              <span className="block text-xs font-black text-emerald-400">
                                {drivers.filter(d => d.approvalStatus === 'APPROVED' && d.isOnline).length}
                              </span>
                              <span className="text-[8px] text-slate-300">{lang === 'ar' ? 'كابتن متصل الآن' : 'Active Fleets'}</span>
                            </div>
                          </div>
                        </div>

                        {/* Role selection card list */}
                        <div className="space-y-2.5">
                          <button
                            onClick={() => {
                              if (rider.isLoggedIn) {
                                setCurrentScreen('RIDER_DASHBOARD');
                              } else {
                                setCurrentScreen('RIDER_AUTH');
                              }
                            }}
                            className="w-full p-3.5 bg-white border border-slate-100 hover:border-amber-300 rounded-2xl shadow-xs text-right flex items-center justify-between transition-transform hover:scale-[1.01] pointer-events-auto cursor-pointer"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center text-lg font-bold">🚖</div>
                              <div className="text-left">
                                <h3 className="text-xs font-black text-slate-800">{lang === 'ar' ? 'أنا راكب - احجز رحلة' : 'I am a Rider'}</h3>
                                <p className="text-[9px] text-slate-400">{lang === 'ar' ? 'اطلب سيارة أو موتوسيكل بأسعار مخفضة' : 'Request ride with dynamic pricing'}</p>
                              </div>
                            </div>
                            <span className="text-slate-400">◀</span>
                          </button>

                          <button
                            onClick={() => {
                              if (driverIsLoggedIn) {
                                setCurrentScreen('DRIVER_DASHBOARD');
                              } else {
                                setCurrentScreen('DRIVER_AUTH');
                              }
                            }}
                            className="w-full p-3.5 bg-white border border-slate-100 hover:border-amber-300 rounded-2xl shadow-xs text-right flex items-center justify-between transition-transform hover:scale-[1.01] pointer-events-auto cursor-pointer"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center text-lg font-bold">🏍️</div>
                              <div className="text-left">
                                <h3 className="text-xs font-black text-slate-800">{lang === 'ar' ? 'أنا كابتن - ابدأ العمل وجني الأرباح' : 'I am a Captain (Driver)'}</h3>
                                <p className="text-[9px] text-slate-400">{lang === 'ar' ? 'سجل حسابك وابدأ باستقبال مشاوير القرى' : 'Register details to accept bookings'}</p>
                              </div>
                            </div>
                            <span className="text-slate-400">◀</span>
                          </button>

                          <button
                            onClick={() => setCurrentScreen('ADMIN')}
                            className="w-full p-3 bg-indigo-50 hover:bg-indigo-100 border border-indigo-100 rounded-2xl text-center text-xs font-bold text-indigo-700 transition-colors pointer-events-auto cursor-pointer"
                          >
                            📊 {lang === 'ar' ? 'لوحة تحكم المدير وتفعيل السائقين' : 'Admin & Commissions Panel'}
                          </button>
                        </div>

                        {/* WhatsApp Support Button */}
                        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-3 space-y-2">
                          <div className="flex items-center gap-2 text-emerald-900 font-bold text-[11px] justify-center">
                            <span className="text-emerald-600 text-sm">💬</span>
                            <span>{lang === 'ar' ? 'هل تواجه أي مشكلة؟ دعم كابتن عز' : 'WhatsApp Support'}</span>
                          </div>
                          <a
                            href={`https://wa.me/${(stats?.supportWhatsApp || '201015555555').replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
                              lang === 'ar'
                                ? 'مرحباً إدارة كابتن عز، أود التواصل مع الدعم الفني للاستفسار بخصوص التطبيق.'
                                : 'Hello Ezz Captain support, I would like to query about the app.'
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black rounded-lg text-center shadow-xs transition-transform hover:scale-[1.01] pointer-events-auto"
                          >
                            {lang === 'ar' ? 'تواصل معنا مباشرة عبر واتساب' : 'Chat via WhatsApp'}
                          </a>
                        </div>
                      </div>

                      {/* Legal Terms & Privacy Section */}
                      <div className="bg-white border border-slate-200/80 rounded-2xl p-3 shrink-0 space-y-2 shadow-xs">
                        <div className="flex items-center justify-between text-[11px] font-bold text-slate-800 border-b border-slate-100 pb-2">
                          <span className="flex items-center gap-1">⚖️ {lang === 'ar' ? 'الشروط والسياسات الرسمية' : 'Terms & Privacy'}</span>
                          <span className="text-[9px] text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                            {lang === 'ar' ? 'محدثة لعام 2026' : 'Updated 2026'}
                          </span>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <button
                            type="button"
                            onClick={openLegalTerms}
                            className="py-2 px-2.5 bg-amber-50 hover:bg-amber-100/80 text-amber-900 border border-amber-200/80 rounded-xl text-[10px] font-bold transition-all text-center flex items-center justify-center gap-1 pointer-events-auto cursor-pointer"
                          >
                            <span>⚖️</span>
                            <span>{lang === 'ar' ? 'الشروط والأحكام' : 'Terms & Conditions'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={openLegalPrivacy}
                            className="py-2 px-2.5 bg-emerald-50 hover:bg-emerald-100/80 text-emerald-900 border border-emerald-200/80 rounded-xl text-[10px] font-bold transition-all text-center flex items-center justify-center gap-1 pointer-events-auto cursor-pointer"
                          >
                            <span>🔒</span>
                            <span>{lang === 'ar' ? 'سياسة الخصوصية' : 'Privacy Policy'}</span>
                          </button>
                        </div>

                        <p className="text-[9px] text-slate-500 text-center leading-relaxed">
                          {lang === 'ar' 
                            ? 'استخدام التطبيق يتضمن موافقتك الكاملة على شروط الخدمة وحماية الخصوصية.' 
                            : 'Using the app constitutes acceptance of terms and privacy policy.'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* 2. RIDER LOGIN / SIGNUP SCREEN */}
                  {currentScreen === 'RIDER_AUTH' && (
                    <div className="h-full bg-slate-50 p-5 flex flex-col justify-between overflow-y-auto">
                      <div className="space-y-4">
                        <div className="text-center">
                          <span className="text-3xl">🚖</span>
                          <h3 className="text-sm font-black text-slate-900 mt-2">
                            {lang === 'ar' ? 'بوابة ركاب كابتن عز' : 'Captain Ezz Rider Portal'}
                          </h3>
                          <p className="text-[10px] text-slate-500 mt-1">
                            {lang === 'ar' ? 'سجل حسابك أو سجل دخولك لطلب الرحلات بأوفر سعر' : 'Access cheaper rides across Giza & Beni Suef'}
                          </p>
                        </div>

                        {/* Tab Selector */}
                        <div className="grid grid-cols-2 p-1 bg-slate-200/70 rounded-xl pointer-events-auto">
                          <button
                            type="button"
                            onClick={() => {
                              setRiderFormMode('LOGIN');
                              setRiderFormError('');
                            }}
                            className={`py-2 text-[11px] font-black rounded-lg transition-all ${riderFormMode === 'LOGIN' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                          >
                            {lang === 'ar' ? 'تسجيل دخول' : 'Login'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setRiderFormMode('SIGNUP');
                              setRiderFormError('');
                            }}
                            className={`py-2 text-[11px] font-black rounded-lg transition-all ${riderFormMode === 'SIGNUP' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                          >
                            {lang === 'ar' ? 'إنشاء حساب جديد' : 'Sign Up'}
                          </button>
                        </div>

                        <form onSubmit={handleRiderSubmit} className="space-y-3">
                          {riderFormError && (
                            <div className="p-2 bg-rose-50 text-rose-800 border border-rose-100 text-[10px] rounded-lg leading-relaxed">
                              ⚠️ {riderFormError}
                            </div>
                          )}

                          {riderFormMode === 'LOGIN' ? (
                            <>
                              {/* Login Fields */}
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-600 block text-right">{lang === 'ar' ? 'رقم الهاتف' : 'Phone Number'}</label>
                                <div className="relative">
                                  <span className="absolute right-3 top-2.5 text-slate-400 text-xs">📞</span>
                                  <input
                                    type="tel"
                                    placeholder={lang === 'ar' ? 'مثال: 01512345678' : 'e.g. 015...'}
                                    value={riderLoginPhone}
                                    onChange={(e) => setRiderLoginPhone(e.target.value)}
                                    className="w-full py-2 pl-3 pr-8 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                  />
                                </div>
                              </div>

                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-600 block text-right">{lang === 'ar' ? 'كلمة المرور' : 'Password'}</label>
                                <div className="relative">
                                  <span className="absolute right-3 top-2.5 text-slate-400 text-xs">🔒</span>
                                  <input
                                    type="password"
                                    placeholder="•••"
                                    value={riderLoginPassword}
                                    onChange={(e) => setRiderLoginPassword(e.target.value)}
                                    className="w-full py-2 pl-3 pr-8 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                  />
                                </div>
                              </div>


                            </>
                          ) : (
                            <>
                              {/* Signup Fields */}
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-600 block text-right">
                                  {lang === 'ar' ? 'الاسم ثنائي (الاسم الأول واللقب)' : 'Full Dual Name'}
                                </label>
                                <div className="relative">
                                  <span className="absolute right-3 top-2.5 text-slate-400 text-xs">👤</span>
                                  <input
                                    type="text"
                                    placeholder={lang === 'ar' ? 'مثال: أحمد عز الدين' : 'e.g. John Doe'}
                                    value={riderFormName}
                                    onChange={(e) => setRiderFormName(e.target.value)}
                                    className="w-full py-2 pl-3 pr-8 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                  />
                                </div>
                              </div>

                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-600 block text-right">{lang === 'ar' ? 'رقم الهاتف المحمول' : 'Mobile Number'}</label>
                                <div className="relative">
                                  <span className="absolute right-3 top-2.5 text-slate-400 text-xs">📞</span>
                                  <input
                                    type="tel"
                                    placeholder={lang === 'ar' ? 'مثال: 01011112222' : 'e.g. 010...'}
                                    value={riderFormPhone}
                                    onChange={(e) => setRiderFormPhone(e.target.value)}
                                    className="w-full py-2 pl-3 pr-8 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                  />
                                </div>
                              </div>

                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-600 block text-right">{lang === 'ar' ? 'كلمة المرور' : 'Password'}</label>
                                <div className="relative">
                                  <span className="absolute right-3 top-2.5 text-slate-400 text-xs">🔒</span>
                                  <input
                                    type="password"
                                    placeholder={lang === 'ar' ? 'اختر كلمة مرور آمنة' : 'Choose password'}
                                    value={riderFormPassword}
                                    onChange={(e) => setRiderFormPassword(e.target.value)}
                                    className="w-full py-2 pl-3 pr-8 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                  />
                                </div>
                              </div>

                              {/* Rider Terms of service explicitly requested */}
                              <div className="p-2.5 bg-slate-100 rounded-xl border border-slate-200 text-[8.5px] text-slate-600 space-y-1.5 leading-relaxed font-medium">
                                <div className="flex items-center justify-between font-extrabold text-slate-800 text-[9px]">
                                  <span>⚖️ شروط وسياسات الراكب:</span>
                                  <div className="flex gap-2">
                                    <button
                                      type="button"
                                      onClick={openLegalTerms}
                                      className="text-amber-700 underline hover:text-amber-900 pointer-events-auto cursor-pointer"
                                    >
                                      الشروط والأحكام
                                    </button>
                                    <button
                                      type="button"
                                      onClick={openLegalPrivacy}
                                      className="text-emerald-700 underline hover:text-emerald-900 pointer-events-auto cursor-pointer"
                                    >
                                      سياسة الخصوصية
                                    </button>
                                  </div>
                                </div>
                                <p>
                                  يلتزم الراكب بإدخال بيانات الرحلة بشكل صحيح، واحترام السائق وعدم الإساءة إليه، وسداد قيمة الرحلة كما هي موضحة داخل التطبيق، والمحافظة على سلامة المركبة.
                                </p>
                                <div className="flex items-start gap-2 pt-1">
                                  <input
                                    type="checkbox"
                                    id="riderAgreed"
                                    checked={riderFormAgreed}
                                    onChange={(e) => setRiderFormAgreed(e.target.checked)}
                                    className="mt-0.5 accent-amber-500 pointer-events-auto cursor-pointer"
                                  />
                                  <label htmlFor="riderAgreed" className="text-[8.5px] text-slate-700 font-extrabold cursor-pointer select-none">
                                    لقد قرأ سياسات الراكب بالكامل وأتعهد بالالتزام بها
                                  </label>
                                </div>
                              </div>
                            </>
                          )}

                          <button
                            type="submit"
                            disabled={riderSubmitting}
                            className="w-full py-3 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed text-amber-400 font-extrabold text-xs rounded-xl shadow-md transition-transform active:scale-95 mt-4 pointer-events-auto cursor-pointer"
                          >
                            {riderSubmitting
                              ? (lang === 'ar' ? '⏳ جاري التحقق...' : '⏳ Checking...')
                              : (riderFormMode === 'LOGIN'
                              ? (lang === 'ar' ? 'تسجيل الدخول ومتابعة الرحلات' : 'Log In & Continue')
                              : (lang === 'ar' ? 'إنشاء الحساب والبدء بالطلب' : 'Sign Up & Start Requesting'))}
                          </button>
                        </form>
                      </div>

                      <button
                        onClick={() => setCurrentScreen('HOME')}
                        className="text-[10px] text-slate-500 hover:text-slate-800 underline text-center pointer-events-auto"
                      >
                        {lang === 'ar' ? '← العودة للرئيسية' : '← Back to Home'}
                      </button>
                    </div>
                  )}

                  {/* 3. RIDER VIEW (DASHBOARD) */}
                  {currentScreen === 'RIDER_DASHBOARD' && (
                    <ErrorBoundary>
                        <RiderView
                        rider={rider}
                        stats={stats}
                        locations={locations}
                        regions={regions}
                        drivers={drivers}
                        activeTrip={activeTrip}
                        ads={ads}
                        selectedPickup={selectedPickup}
                        selectedDropoff={selectedDropoff}
                        selectedPickupRegion={riderPickupRegion}
                        setSelectedPickupRegion={setRiderPickupRegion}
                        setSelectedPickup={setSelectedPickup}
                        setSelectedDropoff={setSelectedDropoff}
  onRequestRide={handleRequestRide}
                            onCancelRide={handleCancelRide}
                            onTripCompleted={handleTripCompleted}
                          onConfirmArrival={handleRiderConfirmArrival}
                          onUpdateLocations={setLocations}
                        lang={lang}
                        onSendChatMessage={handleSendChatMessage}
                          onCalculateRoute={getRealRoute}
                        lowDataMode={lowDataMode}
                        onEnableLowData={enableLowData}
                        onDisableLowData={disableLowData}
                        noAvailableDrivers={noAvailableDrivers}
                        onOpenGuide={openGuideModal}
                            onLogout={() => {
                              setRider(prev => ({ ...prev, isLoggedIn: false }));
                              setActiveTripWithTracking(null);
                              setSelectedPickup('1');
                              setSelectedDropoff('2');
                              clearSession('RIDER');
                              setCurrentScreen('HOME');
                            }}
                        />
                    </ErrorBoundary>
                    )}

                  {/* 4. DRIVER ONBOARDING / VERIFICATION FORM */}
                  {currentScreen === 'DRIVER_AUTH' && (
                    <div className="h-full bg-slate-50 p-5 flex flex-col justify-between overflow-y-auto">
                      <div className="space-y-4">
                        <div className="text-center">
                          <span className="text-3xl">🏍️</span>
                          <h3 className="text-sm font-black text-slate-900 mt-2">
                            {lang === 'ar' ? 'بوابة كباتن تطبيق عز' : 'Captain Ezz Driver Gate'}
                          </h3>
                          <p className="text-[10px] text-slate-500 mt-1">
                            {lang === 'ar' ? 'سجل حسابك ككابتن أو ادخل لمباشرة رحلاتك النشطة ومتابعة عمولاتك' : 'Join our high income fleet or manage your captain profile'}
                          </p>
                        </div>

                        {/* Tab Selector */}
                        <div className="grid grid-cols-2 p-1 bg-slate-200/70 rounded-xl pointer-events-auto">
                          <button
                            type="button"
                            onClick={() => {
                              setDrvFormMode('LOGIN');
                              setDrvFormError('');
                            }}
                            className={`py-2 text-[11px] font-black rounded-lg transition-all ${drvFormMode === 'LOGIN' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                          >
                            {lang === 'ar' ? 'تسجيل دخول كابتن' : 'Captain Login'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDrvFormMode('SIGNUP');
                              setDrvFormError('');
                            }}
                            className={`py-2 text-[11px] font-black rounded-lg transition-all ${drvFormMode === 'SIGNUP' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
                          >
                            {lang === 'ar' ? 'طلب انضمام جديد' : 'New Registration'}
                          </button>
                        </div>

                        <form onSubmit={handleDriverSubmit} className="space-y-3">
                          {drvFormError && (
                            <div className="p-2 bg-rose-50 text-rose-800 border border-rose-100 text-[10px] rounded-lg leading-relaxed">
                              ⚠️ {drvFormError}
                            </div>
                          )}

                          {drvFormMode === 'LOGIN' ? (
                            <>
                              {/* Driver Login */}
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-600 block">{lang === 'ar' ? 'رقم الهاتف' : 'Phone Number'}</label>
                                <div className="relative">
                                  <span className="absolute right-3 top-2.5 text-slate-400 text-xs">📞</span>
                                  <input
                                    type="tel"
                                    placeholder={lang === 'ar' ? 'مثال: 01012345678' : 'e.g. 010...'}
                                    value={drvLoginPhone}
                                    onChange={(e) => setDrvLoginPhone(e.target.value)}
                                    className="w-full py-2 pl-3 pr-8 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                  />
                                </div>
                              </div>

                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-600 block">{lang === 'ar' ? 'كلمة المرور' : 'Password'}</label>
                                <div className="relative">
                                  <span className="absolute right-3 top-2.5 text-slate-400 text-xs">🔒</span>
                                  <input
                                    type="password"
                                    placeholder="•••"
                                    value={drvLoginPassword}
                                    onChange={(e) => setDrvLoginPassword(e.target.value)}
                                    className="w-full py-2 pl-3 pr-8 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                  />
                                </div>
                              </div>


                            </>
                          ) : (
                            <>
                              {/* Driver Signup */}
                              <div className="space-y-2 text-right" dir="rtl">
                                {/* Name Input */}
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-slate-600 block text-right">
                                    الاسم ثلاثي بالكامل <span className="text-rose-500">*</span>
                                  </label>
                                  <div className="relative">
                                    <span className="absolute right-3 top-2 text-slate-400 text-xs">👤</span>
                                    <input
                                      type="text"
                                      placeholder="مثال: محمد أحمد عز"
                                      value={drvFormName}
                                      onChange={(e) => setDrvFormName(e.target.value)}
                                      className="w-full py-1.5 pl-3 pr-8 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  {/* Phone */}
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-600 block text-right">رقم الموبايل</label>
                                    <input
                                      type="tel"
                                      placeholder="010..."
                                      value={drvFormPhone}
                                      onChange={(e) => setDrvFormPhone(e.target.value)}
                                      className="w-full p-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                    />
                                  </div>

                                  {/* Secondary Phone */}
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-600 block text-right">رقم موبايل آخر <span className="text-slate-400">(اختياري)</span></label>
                                    <input
                                      type="tel"
                                      placeholder="012..."
                                      value={drvFormSecondaryPhone}
                                      onChange={(e) => setDrvFormSecondaryPhone(e.target.value)}
                                      className="w-full p-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                    />
                                  </div>

                                  {/* Password */}
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-600 block text-right">كلمة المرور</label>
                                    <input
                                      type="password"
                                      placeholder="•••"
                                      value={drvFormPassword}
                                      onChange={(e) => setDrvFormPassword(e.target.value)}
                                      className="w-full p-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                    />
                                  </div>

                                  {/* Vehicle Type */}
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-600 block text-right">نوع المركبة</label>
                                    <select
                                      value={drvFormVehicleType}
                                      onChange={(e) => setDrvFormVehicleType(e.target.value as any)}
                                      className="w-full p-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                    >
                                      <option value="CAR">🚖 سيارة</option>
                                      <option value="TOKTOK">🛺 توكتوك</option>
                                      <option value="MOTORCYCLE">🏍️ موتوسيكل</option>
                                      <option value="TRICYCLE">🚲 تروسيكل</option>
                                    </select>
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  {/* Vehicle Name/Brand */}
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-600 block text-right">ماركة واسم المركبة</label>
                                    <input
                                      type="text"
                                      placeholder="مثال: توكتوك بجاج أو فيرنا زرقاء"
                                      value={drvFormVehicleName}
                                      onChange={(e) => setDrvFormVehicleName(e.target.value)}
                                      className="w-full p-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                    />
                                  </div>

                                  {/* Vehicle License */}
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-600 block text-right">رقم رخصة المركبة</label>
                                    <input
                                      type="text"
                                      placeholder="أرقام وحروف"
                                      value={drvFormVehicleLicense}
                                      onChange={(e) => setDrvFormVehicleLicense(e.target.value)}
                                      className="w-full p-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                    />
                                  </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2">
                                  {/* National ID */}
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-600 block text-right">رقم البطاقة الشخصية</label>
                                    <input
                                      type="text"
                                      maxLength={14}
                                      placeholder="مثال: 29812231234567"
                                      value={drvFormNationalId}
                                      onChange={(e) => setDrvFormNationalId(e.target.value)}
                                      className="w-full p-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                    />
                                  </div>

                                  {/* Driver License */}
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-600 block text-right">رقم رخصة القيادة</label>
                                    <input
                                      type="text"
                                      placeholder="أرقام وحروف"
                                      value={drvFormLicense}
                                      onChange={(e) => setDrvFormLicense(e.target.value)}
                                      className="w-full p-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:border-amber-400 pointer-events-auto"
                                    />
                                  </div>
                                </div>

                                {/* Driver Terms Box */}
                                <div className="p-2.5 bg-slate-100 rounded-xl border border-slate-200 text-[8px] text-slate-600 space-y-1.5 leading-relaxed font-medium">
                                  <div className="flex items-center justify-between font-extrabold text-slate-800 text-[9px]">
                                    <span>⚖️ الشروط والأحكام الخاصة بالكباتن:</span>
                                    <div className="flex gap-2">
                                      <button
                                        type="button"
                                        onClick={openLegalTerms}
                                        className="text-amber-700 underline hover:text-amber-900 pointer-events-auto cursor-pointer"
                                      >
                                        الشروط والأحكام
                                      </button>
                                      <button
                                        type="button"
                                        onClick={openLegalPrivacy}
                                        className="text-emerald-700 underline hover:text-emerald-900 pointer-events-auto cursor-pointer"
                                      >
                                        سياسة الخصوصية
                                      </button>
                                    </div>
                                  </div>
                                  <p className="text-slate-500 text-justify">
                                    أوافق على أن هذه البيانات سرية ولا يجوز التعامل مع العملاء بطريقة غير شرعية، وعدم خيانة الأمانة، وعدم مضايقة العملاء بأي شكل، وممنوع منعاً باتاً التجاوز الجنسي أو اللفظي، وفي حالة طلب بيانات الساق تكون فقط من خلال الجهات الحكومية والجهات الرسمية المختصة. كما أوافق على الالتزام بدفع العمولات المستمرة أولاً بأول بهدف تطوير التطبيق ومواصلة جذب العملاء. وفي حالة مخالفة أي بند سيتم إيقاف الحساب نهائياً.
                                  </p>
                                  <div className="flex items-start gap-2 pt-1">
                                    <input
                                      type="checkbox"
                                      id="drvAgreed"
                                      checked={drvFormAgreed}
                                      onChange={(e) => setDrvFormAgreed(e.target.checked)}
                                      className="mt-0.5 accent-emerald-600 pointer-events-auto"
                                    />
                                    <label htmlFor="drvAgreed" className="text-[8px] text-emerald-950 font-extrabold cursor-pointer select-none">
                                      أوافق على جميع الشروط وأتعهد بالالتزام التام بالأمانة والمهنية
                                    </label>
                                  </div>
                                </div>

                                {/* WhatsApp Contact for Documents */}
                                <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl text-[9px] text-right space-y-1">
                                  <p className="font-black text-emerald-800">
                                    📱 بعد إرسال الطلب، تواصل معنا على واتساب لإرسال المستندات:
                                  </p>
                                  <p className="text-emerald-700">
                                    📸 المستندات المطلوبة:<br/>
                                    1. صورة بطاقة الرقم القومي<br/>
                                    2. صورة رخصة القيادة<br/>
                                    3. صورة رخصة المركبة<br/>
                                    4. صورة شخصية (أفاتار)
                                  </p>
                                  <a
                                    href={`https://wa.me/201015555555?text=${encodeURIComponent(
                                      lang === 'ar'
                                        ? `مرحباً، لقد قمت بتسجيل طلب انضمام جديد:\nالاسم: ${drvFormName}\nرقم الموبايل: ${drvFormPhone}\nنوع المركبة: ${drvFormVehicleType}\nأريد إرسال المستندات المطلوبة`
                                        : `Hello, I have submitted a new driver application:\nName: ${drvFormName}\nPhone: ${drvFormPhone}\nVehicle: ${drvFormVehicleType}\nI want to submit the required documents`
                                    )}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] px-3 py-1.5 rounded-lg transition-colors cursor-pointer pointer-events-auto mt-1"
                                  >
                                    💬 {lang === 'ar' ? 'تواصل واتساب لإرسال المستندات' : 'WhatsApp to send documents'}
                                  </a>
                                </div>
                              </div>
                            </>
                          )}

                          <button
                            type="submit"
                            disabled={driverSubmitting}
                            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-xs rounded-xl shadow-md transition-transform active:scale-95 mt-2 pointer-events-auto cursor-pointer"
                          >
                            {driverSubmitting
                              ? (lang === 'ar' ? '⏳ جاري التحقق...' : '⏳ Checking...')
                              : (drvFormMode === 'LOGIN'
                              ? (lang === 'ar' ? 'تسجيل دخول وتصفح طلبات الركوب' : 'Captain Login')
                              : (lang === 'ar' ? 'إرسال طلب الانضمام للقرية' : 'Submit Application'))}
                          </button>
                        </form>
                      </div>

                      <button
                        onClick={() => setCurrentScreen('HOME')}
                        className="text-[10px] text-slate-500 hover:text-slate-800 underline text-center pointer-events-auto mt-2"
                      >
                        {lang === 'ar' ? '← العودة للرئيسية' : '← Back to Home'}
                      </button>
                    </div>
                  )}

                  {/* 5. DRIVER VIEW */}
                  {currentScreen === 'DRIVER_DASHBOARD' && (
                      <ErrorBoundary>
                          <DriverView
                        drivers={drivers}
                        selectedDriverId={selectedDriverId}
                        setSelectedDriverId={setSelectedDriverId}
                        activeTrip={activeTrip}
                        locations={locations}
                        regions={regions}
                        commissionRate={stats.commissionRate}
                        onUpdateDriverLocation={handleUpdateDriverLocation}
                        onUpdateServiceAreas={handleUpdateServiceAreas}
                        onAcceptTrip={handleAcceptTrip}
                      onRejectTrip={handleRejectTrip}
                      onArrivedAtPickup={handleArrivedAtPickup}
                      onStartTrip={handleStartTrip}
                      onEndTrip={handleEndTrip}
  onTripCompleted={handleTripCompleted}
                      lang={lang}
                      onSendChatMessage={handleSendChatMessage}
                      stats={stats}
                      lowDataMode={lowDataMode}
                      onEnableLowData={enableLowData}
                      onDisableLowData={disableLowData}
                      driverLat={drivers.find(d => d.id === selectedDriverId)?.lat}
                        driverLng={drivers.find(d => d.id === selectedDriverId)?.lng}
                        onOpenGuide={openGuideModal}
                          onLogout={() => {
                              // Auto-set driver offline in Supabase and clear any active trip
                              if (supabaseConnected && selectedDriverId) {
                                saveDriver({ ...drivers.find(d => d.id === selectedDriverId), isOnline: false, status: 'AVAILABLE' } as Driver);
                                setDrivers(prev => prev.map(d => d.id === selectedDriverId ? { ...d, isOnline: false } : d));
                              }
                              if (activeTrip) {
                                dismissedTripIdsRef.current.add(activeTrip.id);
                                lastTripStatusBeforeNullRef.current = null;
                                if (supabaseConnected) {
                                  saveActiveTrip(null, activeTrip.id);
                                }
                                setActiveTripWithTracking(null);
                                setNoAvailableDrivers(false);
                              }
                              setDriverIsLoggedIn(false);
                              clearSession('DRIVER');
                              setCurrentScreen('HOME');
                            }}
                      />
                    </ErrorBoundary>
                    )}

                  {/* 6. ADMIN PANEL VIEW */}
                  {currentScreen === 'ADMIN' && (
                    !adminIsLoggedIn ? (
                      <div className="h-full bg-slate-900 p-5 flex flex-col justify-between overflow-y-auto text-slate-100">
                        <div className="space-y-6 my-auto">
                          <div className="text-center space-y-2">
                            <div className="w-16 h-16 bg-amber-400 text-slate-950 rounded-full flex items-center justify-center mx-auto text-3xl font-extrabold shadow-lg animate-pulse">
                              🔑
                            </div>
                            <h3 className="text-sm font-black text-amber-400 mt-2">
                              {lang === 'ar' ? 'بوابة المدير السرية - كابتن عز' : 'Captain Ezz Secret Admin Portal'}
                            </h3>
                            <p className="text-[10px] text-slate-400 leading-relaxed max-w-[250px] mx-auto">
                              {lang === 'ar' ? 'هذه المنطقة محمية ومخصصة لإدارة العمليات فقط' : 'Protected area for application moderators only'}
                            </p>
                          </div>

                            <form
                                onSubmit={async (e) => {
                                  e.preventDefault();
                                  if (adminSubmitting) return; // block double-submit spam
                                  setAdminLoginError('');
                                  setAdminSubmitting(true);
                                  try {
                                    if (!adminPhone.trim() || !adminPassword.trim()) {
                                      setAdminLoginError(lang === 'ar' ? 'يرجى إدخال رقم الهاتف وكلمة المرور' : 'Please enter phone and password');
                                      return;
                                    }
                                    if (!adminAuthLimiter.isAllowed(adminPhone.trim())) {
                                      const retryAfter = adminAuthLimiter.getRetryAfter(adminPhone.trim());
                                      setAdminLoginError(lang === 'ar'
                                        ? `تم تجاوز محاولات تسجيل الدخول. يرجى المحاولة بعد ${retryAfter} ثانية`
                                        : `Too many login attempts. Please try again in ${retryAfter} seconds`);
                                      auditLogger.log('admin_login', adminPhone.trim(), 'admin', 'Rate limited', false, 'Rate limit exceeded');
                                      return;
                                    }
                                    if (rider.isLoggedIn || driverIsLoggedIn) {
                                      setAdminLoginError(lang === 'ar' ? 'يوجد حساب راكب/سائق مسجل حالياً. يرجى تسجيل الخروج أولاً.' : 'A rider/driver account is already logged in. Please logout first.');
                                      return;
                                    }
                                    const admin = await authenticateAdmin(adminPhone.trim(), adminPassword.trim());
                                    if (admin) {
                                      setAdminIsLoggedIn(true);
                                      setAdminUserId(admin.id);
                                      if (supabaseConnected) {
                                        await setAppRole('ADMIN');
                                      }
                                      if (supabaseConnected) {
                                        await clearSession('RIDER');
                                        await clearSession('DRIVER');
                                        await saveSession('ADMIN', admin.id);
                                      }
                                      auditLogger.log('admin_login', admin.id, 'admin', 'Login successful', true);
                                      adminAuthLimiter.reset(adminPhone.trim());
                                    } else {
                                      auditLogger.log('admin_login', adminPhone.trim(), 'admin', 'Login failed - invalid credentials', false, 'Wrong phone or password');
                                      setAdminLoginError(lang === 'ar' ? 'رقم الهاتف أو كلمة المرور غير صحيحة!' : 'Incorrect credentials!');
                                    }
                                  } finally {
                                    setAdminSubmitting(false);
                                  }
                                }}
                            className="space-y-4 max-w-xs mx-auto"
                          >
                            {adminLoginError && (
                              <div className="p-2.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] rounded-lg text-center font-bold">
                                ⚠️ {adminLoginError}
                              </div>
                            )}

                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-400 block text-right">{lang === 'ar' ? 'رقم موبايل المدير' : 'Admin Phone'}</label>
                              <input
                                type="tel"
                                placeholder="011********"
                                value={adminPhone}
                                onChange={(e) => setAdminPhone(e.target.value)}
                                className="w-full py-2 px-3 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 pointer-events-auto"
                              />
                            </div>

                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-slate-400 block text-right">{lang === 'ar' ? 'كلمة المرور السرية' : 'Secret Password'}</label>
                              <input
                                type="password"
                                placeholder="••••••••"
                                value={adminPassword}
                                onChange={(e) => setAdminPassword(e.target.value)}
                                className="w-full py-2 px-3 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 pointer-events-auto"
                              />
                            </div>

                            <button
                              type="submit"
                              disabled={adminSubmitting}
                              className="w-full py-2.5 bg-amber-400 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-black text-xs rounded-xl shadow-lg transition-transform active:scale-95 pointer-events-auto cursor-pointer"
                            >
                              {adminSubmitting
                                ? (lang === 'ar' ? '⏳ جاري التحقق...' : '⏳ Checking...')
                                : `🔐 ${lang === 'ar' ? 'تسجيل الدخول الآمن' : 'Secure Authorization'}`}
                            </button>
                          </form>
                        </div>

                        <button
                          onClick={() => setCurrentScreen('HOME')}
                          className="text-[10px] text-slate-400 hover:text-slate-100 underline text-center pointer-events-auto mt-4"
                        >
                          {lang === 'ar' ? '← العودة للرئيسية' : '← Back to Home'}
                        </button>
                      </div>
                    ) : (
                      <ErrorBoundary>
                          <AdminView
                          stats={stats}
                          drivers={drivers}
                          locations={locations}
                          regions={regions}
                          riders={registeredRiders}
                          visitorCount={visitorCount}
                          liveTrips={liveTrips}
                          totalUsers={drivers.length + registeredRiders.length}
                          adminUserId={adminUserId}
                          onUpdateCommissionRate={handleUpdateCommissionRate}
                          onUpdatePricingStats={handleUpdatePricingStats}
                          onSavePricingStats={handleSavePricingStats}
                          onSettleDriverCommissions={handleSettleDriverCommissions}
                          onUpdateLocations={setLocations}
                          onUpdateRegions={setRegions}
                          onApproveDriver={handleApproveDriver}
                        onRejectDriver={handleRejectDriver}
                        onFreezeDriver={handleFreezeDriver}
                        onUnfreezeDriver={handleUnfreezeDriver}
                        onDeleteDriver={handleDeleteDriver}
                        onFreezeRider={handleFreezeRider}
                        onUnfreezeRider={handleUnfreezeRider}
                        onBlockRider={handleBlockRider}
                        onUnblockRider={handleUnblockRider}
                          onDeleteRider={handleDeleteRider}
                           onClearAllFakeData={handleClearAllFakeData}
                           onAdminForceCancelTrip={handleAdminForceCancelTrip}
                           onAdminForceEndTrip={handleAdminForceEndTrip}
                           lang={lang}
                            onLogout={() => {
                              setAdminIsLoggedIn(false);
                              setAdminUserId('');
                              if (supabaseConnected) {
                                clearSession('ADMIN');
                                setAppRole('ANON');
                              }
                              setCurrentScreen('HOME');
                            }}
                          onTriggerToast={triggerToast}
                        />
                          </ErrorBoundary>
                    )
                  )}

                </div>
              </div>

              {/* Simulated Phone Home Indicator Bar */}
              <div className="w-28 h-1 bg-slate-800 rounded-full mx-auto mt-2 shrink-0 z-20" />
            </div>
          </div>

          {/* Right Side: Interactive City Vector Map & Optimized Guide Card */}
          <div className="lg:col-span-7 space-y-6">
          </div>
        </main>

        {/* Footer */}
        <footer className="bg-slate-950 border-t border-slate-800 py-3.5 px-4 text-center text-[10px] text-slate-500 shrink-0 space-y-2">
          <div className="flex items-center justify-center gap-4 text-xs font-bold text-slate-300">
            <button
              type="button"
              onClick={() => openGuideModal('rider')}
              className="hover:text-amber-400 underline underline-offset-4 transition-colors cursor-pointer text-amber-400 font-extrabold"
            >
              📖 {lang === 'ar' ? 'دليل الاستخدام والتعليمات' : 'User & Driver Guide'}
            </button>
            <span className="text-slate-600">•</span>
            <button
              type="button"
              onClick={openLegalTerms}
              className="hover:text-amber-400 underline underline-offset-4 transition-colors cursor-pointer"
            >
              ⚖️ {lang === 'ar' ? 'الشروط والأحكام' : 'Terms & Conditions'}
            </button>
            <span className="text-slate-600">•</span>
            <button
              type="button"
              onClick={openLegalPrivacy}
              className="hover:text-amber-400 underline underline-offset-4 transition-colors cursor-pointer"
            >
              🔒 {lang === 'ar' ? 'سياسة الخصوصية' : 'Privacy Policy'}
            </button>
          </div>
          <div>
            {currentT.footer}
          </div>
        </footer>

        {/* Interactive User & Driver Guide Modal */}
        <GuideModal
          isOpen={showGuideModal}
          onClose={() => setShowGuideModal(false)}
          defaultTab={guideModalTab}
          lang={lang}
        />

        {/* Global Terms & Conditions & Privacy Policy Modal */}
        <LegalModal
          isOpen={showLegalModal}
          onClose={() => setShowLegalModal(false)}
          defaultTab={legalModalTab}
          lang={lang}
        />

        {/* Supabase SQL Setup Wizard Dialog */}
        {showSqlWizard && (
          <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in pointer-events-auto">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto space-y-4 shadow-2xl text-right" dir="rtl">
              <div className="flex justify-between items-center border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">⚡</span>
                  <h3 className="text-sm font-black text-amber-400">تفعيل الربط السحابي بـ Supabase</h3>
                </div>
                <button 
                  onClick={() => setShowSqlWizard(false)}
                  className="text-slate-400 hover:text-white font-bold p-1 pointer-events-auto cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                لقد قمنا ببرمجة وربط الكود بقاعدة بيانات <strong>Supabase</strong> مباشرة! لتشغيل الربط بنجاح وبدء تخزين المشاوير والكباتن والركاب سحابياً، يرجى اتباع الخطوات البسيطة التالية:
              </p>

              <div className="space-y-2 text-xs text-slate-400">
                <div className="flex gap-2 items-start">
                  <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center font-bold text-amber-400 text-[10px] shrink-0">١</span>
                  <p>افتح لوحة تحكم <strong>Supabase</strong> الخاصة بمشروعك.</p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center font-bold text-amber-400 text-[10px] shrink-0">٢</span>
                  <p>اذهب إلى قسم <strong>SQL Editor</strong> من القائمة الجانبية ثم اضغط <strong>New Query</strong>.</p>
                </div>
                <div className="flex gap-2 items-start">
                  <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center font-bold text-amber-400 text-[10px] shrink-0">٣</span>
                  <p>انسخ الكود البرمجي أدناه بالكامل والصقه في المحرر ثم اضغط <strong>Run</strong>.</p>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between items-center text-[10px] text-slate-400 mb-1">
                  <span>SQL Schema Code:</span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(SQL_SCHEMA);
                      alert('📋 تم نسخ كود الـ SQL بنجاح!');
                    }}
                    className="px-2.5 py-1 bg-amber-400 hover:bg-amber-500 text-slate-950 font-bold rounded-lg cursor-pointer pointer-events-auto shadow-xs text-[10px]"
                  >
                    نسخ الكود الكلي
                  </button>
                </div>
                <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl text-[9px] font-mono text-emerald-400 max-h-48 overflow-y-auto text-left whitespace-pre">
                  {SQL_SCHEMA}
                </pre>
              </div>

              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-[10px] text-emerald-300 leading-relaxed text-center font-semibold">
                ✨ بمجرد إنشاء الجداول في مشروعك، سيتحول شريط الاتصال في أعلى واجهة الهاتف إلى اللون الأخضر (أونلاين 🟢) وتعمل المزامنة الفورية!
              </div>

              <button
                onClick={() => setShowSqlWizard(false)}
                className="w-full py-2.5 bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-xs rounded-xl shadow-md transition-all cursor-pointer pointer-events-auto"
              >
                مفهوم، العودة للتطبيق 👍
              </button>
            </div>
          </div>
        )}

        {/* Premium In-App Strong Floating Toast Banner */}
        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{ opacity: 0, y: -80, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -50, scale: 0.9 }}
              transition={{ type: 'spring', damping: 25, stiffness: 350 }}
              className="fixed top-6 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-sm pointer-events-auto"
              dir="rtl"
            >
              <div className={`rounded-2xl shadow-2xl border p-4 flex gap-3 overflow-hidden relative ${
                toast.type === 'success' 
                  ? 'bg-slate-900/95 text-emerald-400 border-emerald-500/30 backdrop-blur-md' 
                  : toast.type === 'warning'
                  ? 'bg-slate-900/95 text-rose-400 border-rose-500/30 backdrop-blur-md'
                  : toast.type === 'new_trip'
                  ? 'bg-amber-400 text-slate-950 border-amber-500 shadow-amber-400/20'
                  : 'bg-slate-900/95 text-amber-400 border-slate-800 backdrop-blur-md'
              }`}>
                <div className="text-xl shrink-0">
                  {toast.type === 'success' ? '✅' : toast.type === 'warning' ? '❌' : toast.type === 'new_trip' ? '🚖' : '🔔'}
                </div>
                <div className="flex-1 text-right min-w-0">
                  <h4 className={`text-xs font-black tracking-tight ${toast.type === 'new_trip' ? 'text-slate-950' : 'text-white'}`}>
                    {toast.title}
                  </h4>
                  <p className={`text-[10px] mt-1 leading-normal ${toast.type === 'new_trip' ? 'text-slate-900 font-extrabold' : 'text-slate-300 font-medium'}`}>
                    {toast.message}
                  </p>
                </div>
                <button
                  onClick={() => setToast(null)}
                  className={`p-1 rounded-full hover:bg-white/10 transition-colors shrink-0 pointer-events-auto cursor-pointer ${
                    toast.type === 'new_trip' ? 'text-slate-950 hover:bg-slate-950/10' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>

                {/* Draining Timer Bar */}
                <motion.div 
                  initial={{ width: '100%' }}
                  animate={{ width: '0%' }}
                  transition={{ duration: 5, ease: 'linear' }}
                  className={`absolute bottom-0 right-0 h-1 ${
                    toast.type === 'new_trip' ? 'bg-slate-950' : 'bg-amber-400'
                  }`}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }
