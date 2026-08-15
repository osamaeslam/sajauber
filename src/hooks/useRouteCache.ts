import { useState, useEffect, useCallback, useRef } from 'react';
import { Location } from '../types';
import { RouteResult, RouteStep } from '../utils/haversine';
import { getCachedRoute, setCachedRoute } from '../utils/dataSaver';

const STALE_THRESHOLD_MS = 60000;

export const useRouteCache = (lang: 'ar' | 'en') => {
  const [routeCache, setRouteCacheInternal] = useState<Record<string, RouteResult>>({});
  const lastRouteCacheUseRef = useRef<number>(Date.now());

  useEffect(() => {
    const TTL = 30 * 60 * 1000;
    const interval = setInterval(() => {
      const now = Date.now();
      if (now - lastRouteCacheUseRef.current > TTL) {
        setRouteCacheInternal({});
      }
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const parseRouteResponse = (data: any): { distance: number; geometry: [number, number][]; durationSeconds?: number; steps?: RouteStep[] } | null => {
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
      const simplified = simplifyGeometry(geometry);
      return { distance, geometry: simplified, durationSeconds, steps };
    }
    return null;
  };

  const simplifyGeometry = (points: [number, number][], maxPoints: number = 10): [number, number][] => {
    if (points.length <= maxPoints) return points;
    const sampled: [number, number][] = [];
    const step = (points.length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i++) {
      const idx = Math.min(Math.round(i * step), points.length - 1);
      sampled.push(points[idx]);
    }
    return sampled;
  };

  const getRealRoute = useCallback(async (pickup: Location, dropoff: Location): Promise<RouteResult | null> => {
    const cacheKey = `${pickup.lat.toFixed(4)}_${pickup.lng.toFixed(4)}_${dropoff.lat.toFixed(4)}_${dropoff.lng.toFixed(4)}`;
    const cached = routeCache[cacheKey] || getCachedRoute([pickup.lat, pickup.lng, dropoff.lat, dropoff.lng]);
    if (cached && cached.distance > 0) return cached;

    const coordStr = `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}`;

    const providers: Array<{ name: string; build: (coords: string) => { url: string; init?: RequestInit } }> = [
      {
        name: 'OSRM-1',
        build: (coords) => ({ url: `https://router.project-osrm.org/route/v1/driving/${coords}?overview=simplified&geometries=geojson&steps=true` }),
      },
      {
        name: 'OSRM-2',
        build: (coords) => ({ url: `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=simplified&geometries=geojson&steps=true` }),
      },
      {
        name: 'OSRM-3',
        build: (coords) => ({ url: `https://valhalla1.openstreetmap.de/route/v1/driving/${coords}?overview=simplified&geometries=geojson&steps=true` }),
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
          const parsed = parseRouteResponse(data);
          if (parsed) {
            const result: RouteResult = parsed;
            setCachedRoute([pickup.lat, pickup.lng, dropoff.lat, dropoff.lng], result);
            lastRouteCacheUseRef.current = Date.now();
            setRouteCacheInternal(prev => ({ ...prev, [cacheKey]: result }));
            console.log(`[route] ${provider.name} OK: ${result.distance} km, ${result.geometry?.length ?? 0} pts, ${result.steps?.length || 0} steps`);
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
  }, [routeCache, lang]);

  const getNavigationRoute = useCallback(async (
    driverLat: number,
    driverLng: number,
    pickup: Location,
    dropoff: Location
  ): Promise<RouteResult | null> => {
    const cacheKey = `nav_${driverLat.toFixed(4)}_${driverLng.toFixed(4)}_${pickup.lat.toFixed(4)}_${pickup.lng.toFixed(4)}_${dropoff.lat.toFixed(4)}_${dropoff.lng.toFixed(4)}`;
    const cached = routeCache[cacheKey] || getCachedRoute([driverLat, driverLng, pickup.lat, pickup.lng]);
    if (cached && cached.distance > 0) return cached;

    const coordStr = `${driverLng},${driverLat};${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}`;

    const providers: Array<{ name: string; build: (coords: string) => { url: string; init?: RequestInit } }> = [
      {
        name: 'OSRM-NAV-1',
        build: (coords) => ({ url: `https://router.project-osrm.org/route/v1/driving/${coords}?overview=simplified&geometries=geojson&steps=true` }),
      },
      {
        name: 'OSRM-NAV-2',
        build: (coords) => ({ url: `https://routing.openstreetmap.de/routed-car/route/v1/driving/${coords}?overview=simplified&geometries=geojson&steps=true` }),
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
          const parsed = parseRouteResponse(data);
          if (parsed) {
            const result: RouteResult = parsed;
            lastRouteCacheUseRef.current = Date.now();
            setRouteCacheInternal(prev => ({ ...prev, [cacheKey]: result }));
            console.log(`[nav] ${provider.name} OK: ${result.distance} km, ${result.geometry?.length ?? 0} pts, ${result.steps?.length || 0} steps`);
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
  }, [routeCache, lang]);

  const getCoordsFromXY = useCallback((x: number, y: number) => {
    const latBase = 29.6197;
    const lngBase = 31.2561;
    const lat = latBase + (y - 50) * 0.0025;
    const lng = lngBase + (x - 50) * 0.0025;
    return { lat, lng };
  }, []);

  return {
    routeCache,
    setRouteCache: setRouteCacheInternal,
    getRealRoute,
    getNavigationRoute,
    getCoordsFromXY,
  };
};
