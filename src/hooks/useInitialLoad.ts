import { useEffect } from 'react';
import {
  checkSupabaseConnection,
  fetchLocations,
  fetchDrivers,
  fetchRiders,
  fetchRegions,
  fetchAds,
  fetchActiveTrip,
  fetchTripsHistory,
  fetchStats,
  saveStats,
  loadSession,
  getDeviceId,
  ensureRegionPricing,
  validateRegionPricing,
  saveRegion,
} from '../supabaseService';
import { requestNotificationPermission } from '../utils/notifications';
import { supabase } from '../supabaseClient';

export const useInitialLoad = ({
  setIsInitializing,
  setSupabaseConnected,
  setLocations,
  setDrivers,
  setRegisteredRiders,
  setRegions,
  setAds,
  setActiveTripWithTracking,
  setTripsHistory,
  setStats,
  setLowDataMode,
  setSessionLoaded,
  setRider,
  setSelectedDriverId,
  setDriverIsLoggedIn,
  setAdminIsLoggedIn,
  setAdminUserId,
  setCurrentScreen,
  rider,
  driverIsLoggedIn,
  selectedDriverId,
  supabaseConnected,
  statsLoadedRef,
}: {
  setIsInitializing: (v: boolean) => void;
  setSupabaseConnected: (v: boolean) => void;
  setLocations: (v: any[]) => void;
  setDrivers: (v: any[]) => void;
  setRegisteredRiders: (v: any[]) => void;
  setRegions: (v: any[]) => void;
  setAds: (v: any[]) => void;
  setActiveTripWithTracking: (updater: any) => void;
  setTripsHistory: (v: any[]) => void;
  setStats: (v: any) => void;
  setLowDataMode: (v: boolean) => void;
  setSessionLoaded: (v: boolean) => void;
  setRider: (v: any) => void;
  setSelectedDriverId: (v: string) => void;
  setDriverIsLoggedIn: (v: boolean) => void;
  setAdminIsLoggedIn: (v: boolean) => void;
  setAdminUserId?: (v: string) => void;
  setCurrentScreen: (screen: any) => void;
  rider: any;
  driverIsLoggedIn: boolean;
  selectedDriverId: string;
  supabaseConnected: boolean;
  statsLoadedRef: React.MutableRefObject<boolean>;
}) => {
  useEffect(() => {
    requestNotificationPermission();
    setIsInitializing(true);

    const initSupabase = async () => {
      try {
        const isConnected = await checkSupabaseConnection();
        if (isConnected) {
          setSupabaseConnected(true);

          const dbLocations = await fetchLocations();
          if (dbLocations && dbLocations.length > 0) {
            setLocations(dbLocations);
          }

          const dbDrivers = await fetchDrivers();
          if (dbDrivers && dbDrivers.length > 0) {
            setDrivers(dbDrivers);
          }

          const dbRiders = await fetchRiders();
          if (dbRiders && dbRiders.length > 0) {
            setRegisteredRiders(dbRiders);
          }

          const dbRegions = await fetchRegions();
          let dbStats: any = null;
          if (dbRegions) {
            dbStats = await fetchStats();
            const statsSource = dbStats || (() => {
              try {
                const raw = localStorage.getItem('ezz_system_stats');
                return raw ? JSON.parse(raw) : null;
              } catch {
                return null;
              }
            })();
            const normalized = dbRegions.map((region) => ensureRegionPricing(region, statsSource));
            setRegions(normalized);
            for (const region of normalized) {
              if (!validateRegionPricing(region.pricing)) {
                console.warn('[useInitialLoad] Region missing pricing, saving normalized defaults:', region.id);
                await saveRegion(region);
              }
            }
          }

          const dbAds = await fetchAds();
          if (dbAds) {
            setAds(dbAds);
          }

          const session = await loadSession();
          if (session) {
            if (session.role !== 'ADMIN') {
              const userRole = session.role.toLowerCase() as 'rider' | 'driver';
              const dbHistory = await fetchTripsHistory({ userId: session.userId, role: userRole, deviceId: getDeviceId() });
              if (dbHistory && dbHistory.length > 0) {
                setTripsHistory(dbHistory);
              }
            }
          }

          if (!dbStats) {
            dbStats = await fetchStats();
          }
          if (dbStats) {
            statsLoadedRef.current = true;
            setStats(dbStats);
            setLowDataMode(!!dbStats.lowDataMode);
          } else {
            try {
              const { error } = await supabase
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
              const r = dbRiders?.find((x: any) => x.id === session.userId);
              if (r) {
                setRider({ ...r, isLoggedIn: true });
                const riderTrip = await fetchActiveTrip(r.id, 'rider');
                if (riderTrip) {
                  setActiveTripWithTracking(riderTrip);
                } else {
                  setActiveTripWithTracking(null);
                }
              }
            } else if (session.role === 'DRIVER') {
              const d = dbDrivers?.find((x: any) => x.id === session.userId);
              if (d) {
                setSelectedDriverId(d.id);
                setDriverIsLoggedIn(true);
                const driverTrip = await fetchActiveTrip(d.id, 'driver');
                if (driverTrip) {
                  setActiveTripWithTracking(driverTrip);
                } else {
                  setActiveTripWithTracking(null);
                }
              }
            } else if (session.role === 'ADMIN') {
              setAdminIsLoggedIn(true);
              if (setAdminUserId) setAdminUserId(session.userId || 'admin');
            }
          } else {
            setActiveTripWithTracking(null);
          }
          setSessionLoaded(true);
        } else {
          setSupabaseConnected(false);
          console.warn('⚠️ Supabase tables not created yet or credentials offline. Using secure LocalStorage engine.');
        }
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
};
