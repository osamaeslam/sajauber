import { useState, useEffect } from 'react';

export const useNetworkStatus = () => {
  const [networkConnected, setNetworkConnected] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setNetworkConnected(true);
    const handleOffline = () => setNetworkConnected(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return networkConnected;
};
