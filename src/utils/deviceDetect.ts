// Device detection utilities

export const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || window.innerWidth < 768;
};

export const isLowEndDevice = (): boolean => {
  if (typeof window === 'undefined') return false;
  const connection = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
  if (connection) {
    if (connection.saveData || connection.effectiveType === '2g' || connection.effectiveType === 'slow-2g') {
      return true;
    }
  }
  return false;
};

export const getOptimalTripsLimit = (defaultLimit: number = 200): number => {
  if (isMobileDevice() || isLowEndDevice()) {
    return Math.min(defaultLimit, 50);
  }
  return defaultLimit;
};
