import { useEffect, useRef } from 'react';
import { Driver } from '../types';
import { saveDriver } from '../supabaseService';

export const useDriverTracking = (
  driverIsLoggedIn: boolean,
  selectedDriverId: string | undefined,
  supabaseConnected: boolean,
  drivers: Driver[],
  lowDataMode: boolean,
  setDrivers: (updater: (prev: Driver[]) => Driver[]) => void,
  lang: 'ar' | 'en',
  triggerToast: (title: string, message: string, type: string) => void
) => {
  const lastNavDriverLatRef = useRef<number | null>(null);
  const lastNavDriverLngRef = useRef<number | null>(null);
  const driversRef = useRef(drivers);
  driversRef.current = drivers;

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
      setDrivers(prev =>
        prev.map(d =>
          d.id === selectedDriverId
            ? { ...d, lat: latitude, lng: longitude }
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

  useEffect(() => {
    if (!driverIsLoggedIn || !selectedDriverId || !supabaseConnected) return;

    const resetDriverToAvailable = async () => {
      let driver = driversRef.current.find(d => d.id === selectedDriverId);

      if (!driver) {
        try {
          const freshDrivers = await import('../supabaseService').then(m => m.fetchDrivers());
          driver = freshDrivers?.find(d => d.id === selectedDriverId);
        } catch (e) {
          console.warn('[DriverReset] Could not fetch driver:', e);
        }
      }

      if (!driver) return;

      if (driver.status === 'BUSY' || !driver.isOnline) {
        const updated = { ...driver, isOnline: true, status: 'AVAILABLE' as const };
        setDrivers(prev => prev.map(d => d.id === selectedDriverId ? updated : d));
        await saveDriver(updated);
        triggerToast(
          lang === 'ar' ? 'تم إعادة تعيين الحالة' : 'Status reset',
          lang === 'ar' ? 'تم إعادة تعيين حالتك إلى متاح' : 'Your status has been reset to available',
          'success'
        );
      }
    };

    resetDriverToAvailable();
  }, [driverIsLoggedIn, selectedDriverId, supabaseConnected, setDrivers, lang, triggerToast]);

  return {
    lastNavDriverLatRef,
    lastNavDriverLngRef,
    currentDriverIsOnline,
  };
};
