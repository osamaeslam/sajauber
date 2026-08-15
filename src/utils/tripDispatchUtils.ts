import { Region } from '../types';

export const getEligibleDrivers = (
  drivers: any[],
  now: number,
  staleThreshold = 120000,
  selectedRegion?: Region | null
) => {
  return drivers.filter(d => {
    if (d.approvalStatus !== 'APPROVED' || !d.isOnline || d.status === 'BUSY' || d.status === 'UNAVAILABLE') return false;
    if (d.lastSeen) {
      const lastSeenMs = new Date(d.lastSeen).getTime();
      if (now - lastSeenMs > staleThreshold) return false;
    }
    if (selectedRegion && selectedRegion.id) {
      const driverAreas = d.serviceAreas || [];
      if (driverAreas.length === 0) return true;
      const regionNameLower = String(selectedRegion.nameAr || selectedRegion.nameEn || '').toLowerCase();
      const regionIdLower = String(selectedRegion.id).toLowerCase();
      const hasMatch = driverAreas.some((area: string) => {
        const areaLower = String(area || '').toLowerCase();
        return (
          areaLower.includes(regionNameLower) ||
          areaLower.includes(regionIdLower) ||
          areaLower === 'all regions' ||
          areaLower === 'جميع المناطق'
        );
      });
      if (!hasMatch) return false;
    }
    return true;
  });
};

export const filterDriversByRegion = (drivers: any[], region: Region | null) => {
  if (!region || !region.id || !Array.isArray(drivers) || drivers.length === 0) return Array.isArray(drivers) ? drivers : [];
  return drivers.filter(d => {
    const driverAreas = d.serviceAreas || [];
    if (driverAreas.length === 0) return true;
    const regionNameLower = String(region.nameAr || region.nameEn || '').toLowerCase();
    const regionIdLower = String(region.id).toLowerCase();
    return driverAreas.some((area: string) => {
      const areaLower = String(area || '').toLowerCase();
      return (
        areaLower.includes(regionNameLower) ||
        areaLower.includes(regionIdLower) ||
        areaLower === 'all regions' ||
        areaLower === 'جميع المناطق'
      );
    });
  });
};

export const mergeChatMessages = (localMessages: any[], remoteMessages: any[]) => {
  const normalizedLocalMessages = Array.isArray(localMessages)
    ? localMessages.filter((m: any) => m && typeof m.id === 'string')
    : [];
  const normalizedRemoteMessages = Array.isArray(remoteMessages)
    ? remoteMessages.filter((m: any) => m && typeof m.id === 'string')
    : [];
  const localMsgIds = new Set(normalizedLocalMessages.map((m) => m.id));
  const merged = [...normalizedLocalMessages];
  for (const m of normalizedRemoteMessages) {
    if (!localMsgIds.has(m.id)) {
      merged.push(m);
    }
  }
  return merged.sort((a, b) => {
    const ta = a && (a.timestamp || a.createdAt) ? new Date(a.timestamp || a.createdAt).getTime() : 0;
    const tb = b && (b.timestamp || b.createdAt) ? new Date(b.timestamp || b.createdAt).getTime() : 0;
    return ta - tb;
  });
};

export const getCoordsFromXY = (x: number, y: number) => {
  const latBase = 29.6197;
  const lngBase = 31.2561;
  const lat = latBase + (y - 50) * 0.0025;
  const lng = lngBase + (x - 50) * 0.0025;
  return { lat, lng };
};
