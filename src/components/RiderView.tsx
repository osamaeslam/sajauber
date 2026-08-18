import React, { useState, useEffect, lazy, Suspense, Dispatch, SetStateAction } from 'react';
import { Location, Driver, Trip, Rider, Region, Ad } from '../types';
import { MapPin, ArrowRightLeft, Navigation, Phone, Star, DollarSign, Loader2, Sparkles, AlertCircle, Car, HelpCircle, MessageSquare, Search, Check, X, ThumbsUp, ThumbsDown, Share2, ShieldCheck, Clock, RotateCw } from 'lucide-react';
import { calculateHaversineDistance, estimateDrivingDistance, calculateDynamicFare, getVehiclePricing, calculateVehicleFare, calculateFullTripFare } from '../utils/haversine';
import { saveRiderPreferences, validatePromoCode } from '../supabaseService';
import { RiderPreferences } from '../types';
import { AdBanner } from './AdBanner';
import { shareTripForSafety, smartCache } from '../utils/tripShare';

// Lazy-load the heavy map components so the rider page opens instantly on
// weak networks. The map bundle is only fetched when the user taps "Show map".
const CityMap = lazy(() => import('./CityMap').then(m => ({ default: m.CityMap })));
const GoogleMap = lazy(() => import('./GoogleMap').then(m => ({ default: m.GoogleMap })));

interface RiderViewProps {
  rider: Rider;
  stats: any;
  locations: Location[];
  regions: Region[];
  drivers: Driver[];
  activeTrip: Trip | null;
  ads?: Ad[];
  selectedPickup: string;
  selectedDropoff: string;
  selectedPickupRegion: string;
  setSelectedPickupRegion: (regionId: string) => void;
  setSelectedPickup: (id: string) => void;
  setSelectedDropoff: (id: string) => void;
  onRequestRide: (
    requestedVehicleType: 'CAR' | 'MOTORCYCLE' | 'TOKTOK',
    pickupLandmark?: string,
    promoCode?: string,
    promoCodeId?: string,
    promoDiscount?: number,
    isRoundTrip?: boolean,
    waitingMinutes?: number
  ) => void;
  onCancelRide: () => void;
  onTripCompleted: () => void;
  onConfirmArrival?: () => void;
  onUpdateLocations?: Dispatch<SetStateAction<Location[]>>;
  lang: 'ar' | 'en';
  onSendChatMessage: (text: string, sender: 'RIDER' | 'DRIVER') => void;
  onLogout: () => void;
  onCalculateRoute?: (pickup: Location, dropoff: Location) => Promise<{ distance: number; geometry?: [number, number][] } | null>;
  lowDataMode?: boolean;
  onEnableLowData?: () => void;
  onDisableLowData?: () => void;
  noAvailableDrivers?: boolean;
  onOpenGuide?: (tab?: 'rider' | 'driver' | 'about') => void;
}

export const RiderView: React.FC<RiderViewProps> = ({
  rider,
  stats,
  locations,
  regions,
  drivers,
  activeTrip,
  ads,
  selectedPickup,
  selectedDropoff,
  selectedPickupRegion,
  setSelectedPickupRegion,
  setSelectedPickup,
  setSelectedDropoff,
  onRequestRide,
  onCancelRide,
  onTripCompleted,
  onConfirmArrival,
  onUpdateLocations,
  lang,
  onSendChatMessage,
  onLogout,
  onCalculateRoute,
  lowDataMode = false,
  onEnableLowData,
  onDisableLowData,
  noAvailableDrivers = false,
  onOpenGuide,
}) => {
  const [requestedVehicleType, setRequestedVehicleType] = useState<'CAR' | 'MOTORCYCLE' | 'TOKTOK'>('CAR');
  const [isRoundTrip, setIsRoundTrip] = useState<boolean>(false);
  const [waitingMinutes, setWaitingMinutes] = useState<number>(0);
  const [shareToast, setShareToast] = useState<string | null>(null);
  
  const [showMathExplanation, setShowMathExplanation] = useState(false);
  const [chatText, setChatText] = useState('');

  const getRegionFilteredAds = (): Ad[] => {
    if (!ads || ads.length === 0) return [];
    if (!selectedPickupRegion) return ads;
    return ads.filter(ad => !ad.regionId || ad.regionId === selectedPickupRegion);
  };
   
  // Promo code states
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discount: number; promoCodeId?: string } | null>(null);
  const [promoError, setPromoError] = useState('');
  
  // Landmark Details State
  const [pickupLandmark, setPickupLandmark] = useState('');

  // Real Road Distance (from OpenRouteService cache)
  const [realDistance, setRealDistance] = useState<number | null>(null);
  const [routeGeometry, setRouteGeometry] = useState<[number, number][] | null>(null);
  const [isCalculatingRoute, setIsCalculatingRoute] = useState(false);
  const lastCalculatedRouteRef = React.useRef<string | null>(null);

  const getCachedRouteDistance = (pickupId: string, dropoffId: string): number | null => {
    // Route cache is maintained in-memory at the App level (no local storage).
    return null;
  };

  const persistPreferences = (next: Partial<RiderPreferences>) => {
    if (!rider.id) return;
    const current: RiderPreferences = rider.preferences || {};
    const merged: RiderPreferences = { ...current, ...next };
    saveRiderPreferences(rider.id, merged);
  };

  // Starred / Favorite Locations State (sourced from Supabase rider preferences)
  const [favorites, setFavorites] = useState<{ id: string; name: string; lat: number; lng: number; type: 'pickup' | 'dropoff' }[]>(() => {
    return rider.preferences?.favorites || [];
  });

  const [homeLocation, setHomeLocation] = useState<{ id: string; name: string; lat: number; lng: number } | null>(() => {
    return rider.preferences?.homeLocation || null;
  });

  const [workLocation, setWorkLocation] = useState<{ id: string; name: string; lat: number; lng: number } | null>(() => {
    return rider.preferences?.workLocation || null;
  });

  const [recentDestinations, setRecentDestinations] = useState<{ id: string; name: string; lat: number; lng: number }[]>(() => {
    return rider.preferences?.recentDestinations || [];
  });

  const [showHomeModal, setShowHomeModal] = useState(false);
  const [showWorkModal, setShowWorkModal] = useState(false);
  const [homeInput, setHomeInput] = useState('');
  const [workInput, setWorkInput] = useState('');

  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmStep, setConfirmStep] = useState<'VEHICLE' | 'PRICE' | 'SENDING'>('VEHICLE');
  const [confirmVehicleType, setConfirmVehicleType] = useState<'CAR' | 'MOTORCYCLE' | 'TOKTOK'>('CAR');
  const [confirmPickupLandmark, setConfirmPickupLandmark] = useState('');

  const [showFavModal, setShowFavModal] = useState<'pickup' | 'dropoff' | null>(null);
  const [favNameInput, setFavNameInput] = useState('');

  // Free-text place search (OSM) so the rider can type a place name to set pickup/dropoff
  const [placeSearchText, setPlaceSearchText] = useState('');
  const [placeSearchTarget, setPlaceSearchTarget] = useState<'pickup' | 'dropoff'>('pickup');
  const [placeSearchResults, setPlaceSearchResults] = useState<{ display_name: string; lat: number; lng: number; city: string }[]>([]);
  const [placeSearchLoading, setPlaceSearchLoading] = useState(false);
  const [geoError, setGeoError] = useState('');
  const [showMap, setShowMap] = useState(() => {
    const hasActiveTrip = !!activeTrip && !!activeTrip.status && activeTrip.status !== 'COMPLETED' && activeTrip.status !== 'CANCELLED';
    return hasActiveTrip;
  });

  useEffect(() => {
    if (!activeTrip) {
      setShowMap(false);
    }
  }, [activeTrip]);

  const placeSearchCacheRef = React.useRef<Record<string, { display_name: string; lat: number; lng: number; city: string }[]>>({});
  const placeSearchLastRef = React.useRef<{ q: string; t: number } | null>(null);
  const placeSearchDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Build a clear, driver-friendly place name from Nominatim address data.
  // Prefers the closest recognizable landmark (village / hamlet / neighbourhood /
  // road) plus the administrative area (e.g. العياط، مزغونة، دهشور، متانية) so the
  // driver understands exactly where the rider is.
  const buildPlaceName = (data: any): { name: string; city: string } => {
    const address = data?.address || {};
    const parts = (data?.display_name || '').split(',').map((s: string) => s.trim()).filter(Boolean);
    const road = address.road || address.pedestrian || address.footway || address.highway || address.street || address.lane || address.way || '';
    const houseNumber = address.house_number || '';
    const building = address.building || '';
    const neighbourhood =
      address.neighbourhood || address.suburb || address.hamlet || address.village || address.quarter || '';
    const town = address.town || address.city || address.county || address.municipality || '';
    const state = address.state || address.governorate || '';
    const amenity = address.amenity || '';
    const shop = address.shop || '';
    const tourism = address.tourism || '';
    const railway = address.railway || '';
    const busStop = address.bus_stop || '';
    const placeOfWorship = address.place_of_worship || '';
    const healthcare = address.healthcare || '';

    // Prefer a named POI / landmark when available (top-level name from Nominatim)
    const poiName = data?.name || '';

    // Closest recognizable point first: POI name > specific landmark > street > area
    let name = (lang === 'ar' ? 'موقعي الحالي' : 'My Location');
    if (poiName) {
      name = poiName;
    } else if (amenity) {
      name = amenity;
    } else if (shop) {
      name = shop;
    } else if (placeOfWorship) {
      name = placeOfWorship;
    } else if (healthcare) {
      name = healthcare;
    } else if (railway) {
      name = railway;
    } else if (busStop) {
      name = busStop;
    } else if (building) {
      name = building;
    } else if (road && houseNumber) {
      name = `${houseNumber} ${road}`;
    } else if (road) {
      name = road;
    } else if (neighbourhood) {
      name = neighbourhood;
    } else if (town) {
      name = town;
    } else if (parts.length > 0) {
      name = /^[0-9]+$/.test(parts[0]) ? parts.slice(0, 2).join('، ') : parts[0];
    }

    // Append the administrative area so the driver knows the broader location.
    const area = town || neighbourhood || (parts.length > 1 ? parts[1] : '');
    const fullName = area && area !== name ? `${name}، ${area}` : name;
    const city = town || neighbourhood || state || (lang === 'ar' ? 'منطقتي' : 'My Area');
    return { name: fullName, city };
  };

  const handleUseCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGeoError(lang === 'ar' ? 'المتصفح لا يدعم تحديد الموقع' : 'Geolocation not supported');
      return;
    }
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords;
        let name = (lang === 'ar' ? 'موقعي الحالي' : 'My Location');
        let city = (lang === 'ar' ? 'منطقتي' : 'My Area');
        try {
          // Use our own serverless proxy to avoid browser CORS blocking.
          const res = await fetch(`/api/reverse?lat=${latitude}&lon=${longitude}`, {
            headers: { 'Accept': 'application/json' },
          });
          if (res.ok) {
            const data = await res.json();
            const built = buildPlaceName(data);
            name = built.name;
            city = built.city;
          } else if (res.status === 429) {
            setGeoError(lang === 'ar' ? 'تم تجاوز الحد المسموح من البحث. يرجى المحاولة لاحقاً.' : 'Too many location requests. Please try again later.');
            return;
          }
        } catch {
          // Continue with fallback name even if reverse geocoding fails
        }
        const newLoc: Location = {
          id: `geo_${Date.now()}`,
          nameAr: name,
          nameEn: name,
          lat: latitude,
          lng: longitude,
          city,
          country: 'مصر',
        };
        if (onUpdateLocations) {
          onUpdateLocations([newLoc, ...locations]);
        }
        setSelectedPickup(newLoc.id);
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setGeoError(lang === 'ar' ? 'رفضت صلاحية الموقع. يرجى تفعيلها من إعدادات المتصفح.' : 'Location permission denied. Please enable it in browser settings.');
        } else if (err.code === err.TIMEOUT) {
          setGeoError(lang === 'ar' ? 'انتهى وقت تحديد الموقع. يرجى المحاولة مرة أخرى.' : 'Location request timed out. Please try again.');
        } else {
          setGeoError(lang === 'ar' ? 'خطأ في تحديد الموقع. يرجى المحاولة مرة أخرى.' : 'Location error. Please try again.');
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  };

  const handlePlaceSearch = async (text: string) => {
    const q = text.trim();
    if (!q) {
      setPlaceSearchResults([]);
      return;
    }
    const normalized = q.toLowerCase();
    const cached = placeSearchCacheRef.current[normalized];
    if (cached) {
      setPlaceSearchResults(cached);
      return;
    }
    const now = Date.now();
    if (placeSearchLastRef.current && placeSearchLastRef.current.q === normalized && now - placeSearchLastRef.current.t < 3000) {
      return;
    }
    placeSearchLastRef.current = { q: normalized, t: now };
    setPlaceSearchLoading(true);
    try {
      // Use our own serverless proxy to avoid browser CORS blocking.
      const res = await fetch(`/api/search?q=${encodeURIComponent(q + ', مصر')}`, {
        headers: { 'Accept': 'application/json' },
      });
      if (!res.ok) throw new Error('search failed');
      const data = await res.json();
      const results = (data || []).map((item: any) => {
        const built = buildPlaceName(item);
        return {
          display_name: item.display_name,
          lat: parseFloat(item.lat),
          lng: parseFloat(item.lon),
          city: built.city,
        };
      });
      placeSearchCacheRef.current[normalized] = results;
      setPlaceSearchResults(results);
    } catch {
      setPlaceSearchResults([]);
    } finally {
      setPlaceSearchLoading(false);
    }
  };

  const applyPlaceResult = (item: { display_name: string; lat: number; lng: number; city: string }) => {
    const parts = item.display_name.split(',').map((s: string) => s.trim()).filter(Boolean);
    const address = (item as any).address || {};
    const road = address.road || address.pedestrian || address.footway || address.highway || address.street || address.lane || address.way || '';
    const houseNumber = address.house_number || '';
    const building = address.building || '';
    const neighbourhood = address.neighbourhood || address.suburb || address.village || address.city || '';
    const amenity = address.amenity || '';
    const shop = address.shop || '';
    const tourism = address.tourism || '';
    const railway = address.railway || '';
    const busStop = address.bus_stop || '';
    const placeOfWorship = address.place_of_worship || '';
    const healthcare = address.healthcare || '';

    const poiName = (item as any).name || '';

    let name = '';
    if (poiName) {
      name = poiName;
    } else if (amenity) {
      name = amenity;
    } else if (shop) {
      name = shop;
    } else if (placeOfWorship) {
      name = placeOfWorship;
    } else if (healthcare) {
      name = healthcare;
    } else if (railway) {
      name = railway;
    } else if (busStop) {
      name = busStop;
    } else if (building) {
      name = building;
    } else if (road && houseNumber) {
      name = `${houseNumber} ${road}`;
    } else if (road) {
      name = road;
    } else if (neighbourhood) {
      name = neighbourhood;
    } else if (parts.length > 0 && /^[0-9]+$/.test(parts[0])) {
      name = parts.slice(0, 2).join('،');
    } else if (parts.length > 0) {
      name = parts[0];
    }

    const newLoc: Location = {
      id: `search_${Date.now()}_${Math.round(Math.random() * 1000)}`,
      nameAr: name || (lang === 'ar' ? 'مكان مخصص' : 'Custom place'),
      nameEn: name || (lang === 'ar' ? 'مكان مخصص' : 'Custom place'),
      lat: item.lat,
      lng: item.lng,
      city: item.city,
      country: 'مصر',
    };
    onUpdateLocations?.([newLoc, ...locations]);
    if (placeSearchTarget === 'pickup') {
      setSelectedPickup(newLoc.id);
    } else {
      setSelectedDropoff(newLoc.id);
    }
    setPlaceSearchResults([]);
    setPlaceSearchText('');
    // Reset target to pickup so the next search doesn't accidentally
    // fall into the wrong field (dropoff).
    setPlaceSearchTarget('pickup');
  };

  const pickupLoc = locations.find((l) => l.id === selectedPickup);
  const dropoffLoc = locations.find((l) => l.id === selectedDropoff);

  const activeTripChatMessages = activeTrip && Array.isArray(activeTrip.chatMessages)
    ? activeTrip.chatMessages.filter((msg) => msg && typeof msg.id === 'string')
    : [];

  // Prefetch real road distance and route when both pickup and dropoff are selected
  useEffect(() => {
    if (!pickupLoc || !dropoffLoc || !onCalculateRoute) {
      setRouteGeometry(null);
      return;
    }
    // Always compute real road path (lowDataMode no longer blocks routing, only GPS accuracy)
    const routeKey = `${pickupLoc.id}_${dropoffLoc.id}`;
    if (lastCalculatedRouteRef.current === routeKey) return;
    lastCalculatedRouteRef.current = routeKey;

    const cachedDist = getCachedRouteDistance(pickupLoc.id, dropoffLoc.id);
    if (cachedDist) {
      console.log('[route] cache hit for', routeKey, cachedDist);
      setRealDistance(cachedDist);
      return;
    }

    console.log('[route] requesting real route for', routeKey);
    setIsCalculatingRoute(true);
    onCalculateRoute(pickupLoc, dropoffLoc).then(result => {
      if (result) {
        console.log('[route] got result distance=', result.distance, 'pts=', result.geometry?.length);
        setRealDistance(result.distance);
        if (result.geometry && result.geometry.length > 1) {
          setRouteGeometry(result.geometry);
        }
      } else {
        console.warn('[route] no result returned (all providers failed)');
      }
      setIsCalculatingRoute(false);
    });
  }, [pickupLoc?.id, dropoffLoc?.id, onCalculateRoute, lowDataMode]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (placeSearchDebounceRef.current) {
        clearTimeout(placeSearchDebounceRef.current);
      }
    };
  }, []);

  // When the rider has selected a pickup region, resolve region settings
  const selectedRegion = regions.find(r => r.id === selectedPickupRegion);
  const selectedRegionName = selectedRegion?.nameAr || selectedRegion?.nameEn || '';

  // Calculate estimated distance and fare using standard / regional model
  let directDistance = 0;
  let distance = 0;
  let estimatedFare = 0;
  let originalFare = 0;
  let commissionRate = 10;

  const distanceBuffer = (selectedRegion?.pricing?.customPricingEnabled && selectedRegion.pricing.distanceBuffer !== undefined && selectedRegion.pricing.distanceBuffer > 0)
    ? selectedRegion.pricing.distanceBuffer
    : ((stats?.distanceBuffer !== undefined && stats.distanceBuffer > 0) ? stats.distanceBuffer : 1.25);

  const additionalKm = (selectedRegion?.pricing?.customPricingEnabled && selectedRegion.pricing.additionalKm !== undefined)
    ? selectedRegion.pricing.additionalKm
    : (stats?.additionalKm !== undefined ? stats.additionalKm : 0.0);

  const incomingCommission = (selectedRegion?.pricing?.customPricingEnabled && selectedRegion.pricing.incomingCommission !== undefined)
    ? selectedRegion.pricing.incomingCommission
    : (stats?.incomingCommission ?? 5);

  const discountAmount = appliedPromo?.discount ?? 0;

  const computeTripFare = (
    dist: number,
    vehicleType: string,
    discount: number = 0,
    isRound: boolean = isRoundTrip,
    waitMin: number = waitingMinutes
  ) => {
    return calculateFullTripFare(dist, vehicleType, stats, discount, selectedRegion?.pricing, isRound, waitMin).finalFare;
  };

  const calculateFareForLocation = (dropoff: { lat: number; lng: number }): number => {
    if (!pickupLoc) return 0;
    const direct = calculateHaversineDistance(pickupLoc.lat, pickupLoc.lng, dropoff.lat, dropoff.lng);
    const dist = estimateDrivingDistance(direct, distanceBuffer) + additionalKm;
    const finalDist = parseFloat(Math.max(1, dist).toFixed(2));
    return computeTripFare(finalDist, 'CAR', 0, false, 0);
  };

  let oneWayDistance = 0;
  let totalTraveledDistance = 0;
  let waitingFee = 0;

  if (pickupLoc && dropoffLoc) {
    if (realDistance) {
      distance = realDistance;
    } else {
      directDistance = calculateHaversineDistance(pickupLoc.lat, pickupLoc.lng, dropoffLoc.lat, dropoffLoc.lng);
      distance = estimateDrivingDistance(directDistance, distanceBuffer) + additionalKm;
      distance = parseFloat(distance.toFixed(2));
      if (distance < 1) distance = 1;
    }
    oneWayDistance = distance;
    totalTraveledDistance = isRoundTrip ? parseFloat((distance * 2).toFixed(2)) : distance;

    const fareCalc = calculateFullTripFare(
      distance,
      requestedVehicleType,
      stats,
      discountAmount,
      selectedRegion?.pricing,
      isRoundTrip,
      waitingMinutes
    );
    originalFare = calculateFullTripFare(
      distance,
      requestedVehicleType,
      stats,
      0,
      selectedRegion?.pricing,
      isRoundTrip,
      waitingMinutes
    ).finalFare;
    estimatedFare = fareCalc.finalFare;
    waitingFee = fareCalc.waitingFee;
    commissionRate = incomingCommission;
  }

  const handleShareSafety = async (targetTrip?: Trip | null) => {
    const res = await shareTripForSafety({
      trip: targetTrip || activeTrip,
      riderName: rider.name,
      riderPhone: rider.phone,
      driver: targetTrip?.driverId ? drivers.find(d => d.id === targetTrip.driverId) : (activeTrip?.driverId ? drivers.find(d => d.id === activeTrip.driverId) : null),
      pickupLoc,
      dropoffLoc,
      distance: totalTraveledDistance || distance,
      fare: estimatedFare,
      isRoundTrip,
      waitingMinutes,
      lang,
    });
    if (res.success) {
      if (res.method === 'clipboard') {
        setShareToast(lang === 'ar' ? '✅ تم نسخ تفاصيل الرحلة للحافظة بنجاح! يمكنك لصقها في واتساب.' : '✅ Trip details copied to clipboard!');
      } else {
        setShareToast(lang === 'ar' ? '🛡️ تم فتح مشاركة تفاصيل الأمان بنجاح' : '🛡️ Safety share opened successfully');
      }
      setTimeout(() => setShareToast(null), 4000);
    }
  };

  const onlineDrivers = drivers.filter((d) => {
    if (!d.isOnline || d.approvalStatus !== 'APPROVED') return false;
    if (selectedRegionName && (d.serviceAreas || []).length > 0) {
      const regionNameLower = String(selectedRegionName || '').toLowerCase();
      const regionIdLower = String(selectedRegion?.id || '').toLowerCase();
      return (d.serviceAreas || []).some((sa) => {
        const areaLower = String(sa || '').toLowerCase();
        return (
          areaLower.includes(regionNameLower) ||
          areaLower.includes(regionIdLower) ||
          areaLower === 'all regions' ||
          areaLower === 'جميع المناطق'
        );
      });
    }
    return true;
  });
  const availableDrivers = onlineDrivers.filter((d) => d.status === 'AVAILABLE' && String(d.vehicleType).toUpperCase() === requestedVehicleType);

  // Auto-switch to CAR if distance exceeds 50km
  useEffect(() => {
    if (distance > 50 && (requestedVehicleType === 'MOTORCYCLE' || requestedVehicleType === 'TOKTOK')) {
      setRequestedVehicleType('CAR');
    }
    if (distance > 50 && (confirmVehicleType === 'MOTORCYCLE' || confirmVehicleType === 'TOKTOK')) {
      setConfirmVehicleType('CAR');
    }
  }, [distance, requestedVehicleType, confirmVehicleType]);

  const swapLocations = () => {
    const temp = selectedPickup;
    setSelectedPickup(selectedDropoff);
    setSelectedDropoff(temp);
  };

  // 2. Favorite Locations Helpers
  const handleSaveFavorite = (type: 'pickup' | 'dropoff') => {
    const activeLoc = type === 'pickup' ? pickupLoc : dropoffLoc;
    if (!activeLoc) return;
    if (!favNameInput.trim()) {
      alert(lang === 'ar' ? 'يرجى كتابة اسم للمكان المميز' : 'Please type a label for this place');
      return;
    }

    const newFav = {
      id: `fav_${Date.now()}`,
      name: favNameInput.trim(),
      lat: activeLoc.lat,
      lng: activeLoc.lng,
      type,
    };

    const updated = [newFav, ...favorites];
    setFavorites(updated);
    persistPreferences({ favorites: updated });
    setFavNameInput('');
    setShowFavModal(null);
  };

  const handleDeleteFavorite = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = favorites.filter(f => f.id !== id);
    setFavorites(updated);
    persistPreferences({ favorites: updated });
  };

  const handleSelectFavorite = (fav: typeof favorites[0]) => {
    // Check if location already exists in local DB list, or add it as a new location
    const matched = locations.find(l => Math.abs(l.lat - fav.lat) < 0.0001 && Math.abs(l.lng - fav.lng) < 0.0001);
    let targetId = '';
    
    if (matched) {
      targetId = matched.id;
    } else {
      const newLoc: Location = {
        id: `fav_loc_${Date.now()}`,
        nameAr: fav.name,
        nameEn: fav.name,
        lat: fav.lat,
        lng: fav.lng,
        city: lang === 'ar' ? 'العياط' : 'El-Ayyat',
        country: 'مصر',
      };
      if (onUpdateLocations) {
        onUpdateLocations([newLoc, ...locations]);
      }
      targetId = newLoc.id;
    }

    if (fav.type === 'pickup') {
      setSelectedPickup(targetId);
    } else {
      setSelectedDropoff(targetId);
    }
  };

  const handleSetHome = () => {
    if (!pickupLoc) return;
      const home = {
        id: pickupLoc.id,
        name: lang === 'ar' ? (pickupLoc.nameAr || pickupLoc.nameEn || '') : (pickupLoc.nameEn || pickupLoc.nameAr || ''),
        lat: pickupLoc.lat,
        lng: pickupLoc.lng,
      };
      setHomeLocation(home);
      persistPreferences({ homeLocation: home });
      setShowHomeModal(false);
    };

    const handleSetWork = () => {
      if (!pickupLoc) return;
      const work = {
        id: pickupLoc.id,
        name: lang === 'ar' ? (pickupLoc.nameAr || pickupLoc.nameEn || '') : (pickupLoc.nameEn || pickupLoc.nameAr || ''),
        lat: pickupLoc.lat,
        lng: pickupLoc.lng,
      };
    setShowWorkModal(false);
  };

   return (
    <div className="flex flex-col h-full bg-white text-slate-900 select-none relative">
      {/* Toast Banner for Safety Share & Notifications */}
      {shareToast && (
        <div className="absolute top-2 left-3 right-3 z-50 bg-slate-900 text-white px-3.5 py-2.5 rounded-xl shadow-lg border border-slate-700 flex items-center justify-between text-xs font-bold animate-bounce text-right">
          <span>{shareToast}</span>
          <button
            type="button"
            onClick={() => setShareToast(null)}
            className="text-slate-400 hover:text-white p-1"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Wallet Display */}
      <div className="bg-slate-50 border-b border-slate-100 p-3.5 flex items-center justify-between rounded-t-2xl">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
            {rider.name[0]}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h4 className="text-xs font-semibold text-slate-800">{rider.name}</h4>
              <span className="bg-blue-50 text-blue-700 border border-blue-200/70 text-[9px] px-1.5 py-0.2 rounded-full font-bold">
                {lang === 'ar' ? `${rider.totalTrips || 0} رحلة مكتملة` : `${rider.totalTrips || 0} completed`}
              </span>
            </div>
            <p className="text-[10px] text-slate-400">{rider.phone}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => {
              if (lowDataMode) {
                onDisableLowData?.();
              } else {
                onEnableLowData?.();
              }
            }}
            className={`p-1 px-2 rounded-lg text-[8px] font-bold transition-all cursor-pointer pointer-events-auto flex items-center gap-1 ${
              lowDataMode
                ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                : 'bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200'
            }`}
            title={lang === 'ar' ? (lowDataMode ? 'الوضع الاقتصادي مفعل' : 'تفعيل الوضع الاقتصادي') : (lowDataMode ? 'Low Data Mode Active' : 'Enable Low Data Mode')}
          >
            <span>📡</span>
            <span>{lang === 'ar' ? (lowDataMode ? 'توفير مفعّل' : 'توفير') : (lowDataMode ? 'Low Data' : 'Save')}</span>
          </button>
          {onOpenGuide && (
            <button
              type="button"
              onClick={() => onOpenGuide('rider')}
              className="p-1 px-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200/80 rounded-lg text-[8px] font-extrabold transition-all cursor-pointer pointer-events-auto flex items-center gap-1 shadow-xs"
              title={lang === 'ar' ? 'دليل الاستخدام' : 'User Guide'}
            >
              <span>📖</span>
              <span>{lang === 'ar' ? 'دليل' : 'Guide'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onLogout}
            className="p-1 px-2 bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 rounded-lg text-[8px] font-bold transition-all cursor-pointer pointer-events-auto flex items-center gap-1"
            title={lang === 'ar' ? 'تسجيل الخروج' : 'Logout'}
          >
            <span>🚪</span>
            <span>{lang === 'ar' ? 'خروج' : 'Logout'}</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">

            {/* Home Location Modal */}
            {showHomeModal && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[9999]">
                <div className="bg-white rounded-2xl w-full max-w-sm p-5 text-right space-y-3 shadow-xl">
                  <h3 className="text-xs font-black text-slate-800">
                    🏠 {lang === 'ar' ? 'تحديد مكان المنزل' : 'Set Home Location'}
                  </h3>
                  <p className="text-[10px] text-slate-500">
                    {lang === 'ar'
                      ? 'اختر مكان المنزل من القائمة أو احفظ الموقع الحالي'
                      : 'Choose home from the list or save current location'}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (pickupLoc) {
                          const home = { id: pickupLoc.id, name: lang === 'ar' ? pickupLoc.nameAr : pickupLoc.nameEn, lat: pickupLoc.lat, lng: pickupLoc.lng };
                          setHomeLocation(home);
                          persistPreferences({ homeLocation: home });
                          setShowHomeModal(false);
                        }
                      }}
                      className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] rounded-lg cursor-pointer pointer-events-auto"
                    >
                      {lang === 'ar' ? 'حفظ الموقع الحالي كمنزل' : 'Save current as Home'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowHomeModal(false)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[11px] rounded-lg cursor-pointer pointer-events-auto"
                    >
                      {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Work Location Modal */}
            {showWorkModal && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[9999]">
                <div className="bg-white rounded-2xl w-full max-w-sm p-5 text-right space-y-3 shadow-xl">
                  <h3 className="text-xs font-black text-slate-800">
                    💼 {lang === 'ar' ? 'تحديد مكان العمل' : 'Set Work Location'}
                  </h3>
                  <p className="text-[10px] text-slate-500">
                    {lang === 'ar'
                      ? 'اختر مكان العمل من القائمة أو احفظ الموقع الحالي'
                      : 'Choose work from the list or save current location'}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (pickupLoc) {
                          const work = { id: pickupLoc.id, name: lang === 'ar' ? pickupLoc.nameAr : pickupLoc.nameEn, lat: pickupLoc.lat, lng: pickupLoc.lng };
                          setWorkLocation(work);
                          persistPreferences({ workLocation: work });
                          setShowWorkModal(false);
                        }
                      }}
                      className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[11px] rounded-lg cursor-pointer pointer-events-auto"
                    >
                      {lang === 'ar' ? 'حفظ الموقع الحالي كعمل' : 'Save current as Work'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowWorkModal(false)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[11px] rounded-lg cursor-pointer pointer-events-auto"
                    >
                      {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                </div>
              </div>
            )}

        {/* State 2: Active Trip In-Progress / Accepted (NOT cancelled) */}
        {activeTrip && activeTrip.riderId === rider.id && activeTrip.status !== 'COMPLETED' && activeTrip.status !== 'CANCELLED' && (
          <div className="bg-slate-50 border border-slate-100 rounded-2xl p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="px-2.5 py-1 bg-blue-100 text-blue-700 text-[10px] font-bold rounded-full">
                  {activeTrip.status === 'SEARCHING' && (lang === 'ar' ? 'جاري البحث عن سائق...' : 'Searching for driver...')}
                  {activeTrip.status === 'ACCEPTED' && (lang === 'ar' ? 'السائق في الطريق' : 'Driver on the way')}
                  {activeTrip.status === 'ARRIVED' && (lang === 'ar' ? 'السائق وصل!' : 'Driver arrived!')}
                  {activeTrip.status === 'STARTED' && (lang === 'ar' ? 'في الرحلة حالياً' : 'Trip in progress')}
                </span>
                {activeTrip.isRoundTrip && (
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-black rounded-full flex items-center gap-1">
                    <RotateCw className="w-2.5 h-2.5 text-amber-700" />
                    <span>{lang === 'ar' ? `ذهاب وعودة (${activeTrip.waitingMinutes || 0} دقيقة انتظار)` : `Round-Trip (${activeTrip.waitingMinutes || 0}m wait)`}</span>
                  </span>
                )}
              </div>
              <span className="text-xs font-bold text-slate-800">
                {activeTrip.fare} {lang === 'ar' ? 'ج.م' : 'EGP'}
              </span>
            </div>
            {activeTrip.status === 'SEARCHING' && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[10px] text-slate-500 font-medium">
                    {lang === 'ar' ? `ينتهي البحث خلال: ${Math.max(0, (activeTrip.dispatchTimer ?? 600))} ثانية` : `Search expires in: ${Math.max(0, (activeTrip.dispatchTimer ?? 600))}s`}
                  </div>
                  <button
                    type="button"
                    onClick={onCancelRide}
                    className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold rounded-lg transition-all cursor-pointer pointer-events-auto"
                  >
                    {lang === 'ar' ? 'إلغاء الطلب' : 'Cancel Request'}
                  </button>
                </div>
                <div className="pt-1">
                  <AdBanner ads={getRegionFilteredAds()} variant="waiting" lang={lang} lowDataMode={lowDataMode} />
                </div>
              </>
            )}
            {activeTrip.appliedPromoCode && activeTrip.appliedPromoDiscount ? (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px]">
                <span className="font-bold text-amber-900">
                  🎁 {lang === 'ar' ? 'كود خصم مطبق:' : 'Promo code applied:'} {activeTrip.appliedPromoCode}
                </span>
                <span className="text-rose-600 font-bold mr-2">
                  -{activeTrip.appliedPromoDiscount} {lang === 'ar' ? 'ج.م' : 'EGP'}
                </span>
              </div>
            ) : null}

            {/* Simulated Live status text & Dynamic Live ETA Badge */}
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                {activeTrip.status === 'SEARCHING' ? (
                  <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                ) : (
                  <div className="w-2.5 h-2.5 bg-blue-600 rounded-full animate-ping" />
                )}
                <p className="text-xs text-slate-600">
                  {activeTrip.status === 'SEARCHING' && (lang === 'ar' 
                    ? `جاري البحث عن سائق متاح (${drivers.filter(d => d.isOnline && d.approvalStatus === 'APPROVED' && d.status === 'AVAILABLE').length} سائق متاح).`
                    : `Searching for an available driver (${drivers.filter(d => d.isOnline && d.approvalStatus === 'APPROVED' && d.status === 'AVAILABLE').length} available).`)}
                  {activeTrip.status === 'ACCEPTED' && (lang === 'ar' ? `قبل ${activeTrip.driverName} رحلتك وهو يتجه الآن إليك.` : `${activeTrip.driverName} accepted your ride and is heading to your pickup location.`)}
                  {activeTrip.status === 'ARRIVED' && (lang === 'ar' ? 'السيارة تنتظرك بالخارج. تفضل بالركوب لتفعيل الرحلة.' : 'The driver has arrived at your location. Please board to start the trip.')}
                  {activeTrip.status === 'STARTED' && (lang === 'ar' ? `متجهون إلى ${lang === 'ar' ? activeTrip.dropoff?.nameAr || activeTrip.dropoff?.nameEn || '' : activeTrip.dropoff?.nameEn || activeTrip.dropoff?.nameAr || ''}. رحلة سعيدة!` : `Heading to ${activeTrip.dropoff?.nameEn || activeTrip.dropoff?.nameAr || ''}. Wish you a safe ride!`)}
                </p>
                
                {/* Ready/Decline buttons for ARRIVED status */}
                {activeTrip.status === 'ARRIVED' && (
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={onCancelRide}
                      className="flex-1 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-bold rounded-lg transition-all cursor-pointer"
                    >
                      {lang === 'ar' ? '❌ لست جاهزاً، إلغاء الطلب' : '❌ Not ready, cancel'}
                    </button>
                    <button
                      type="button"
                      onClick={onConfirmArrival}
                      className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black rounded-lg shadow-sm transition-all cursor-pointer"
                    >
                      {lang === 'ar' ? '✅ أنا جاهز، موافق!' : '✅ I\'m ready, continue!'}
                    </button>
                  </div>
                )}
              </div>

              {/* Dynamic live ETA calculated based on driver's physical coordinates on the grid */}
              {(() => {
                const matchedDriver = activeTrip ? drivers.find(d => d.id === activeTrip.driverId) : null;
                if (!matchedDriver || activeTrip.status === 'SEARCHING') return null;

                let etaMinutes = activeTrip.etaMinutes || 0;
                let badgeColor = 'bg-blue-50 text-blue-700 border-blue-100';
                let etaLabel = '';

                if (activeTrip.status === 'ACCEPTED') {
                  if (!etaMinutes && matchedDriver.lat && matchedDriver.lng && activeTrip.pickup.lat && activeTrip.pickup.lng) {
                    const realDist = calculateHaversineDistance(matchedDriver.lat, matchedDriver.lng, activeTrip.pickup.lat, activeTrip.pickup.lng);
                    etaMinutes = Math.max(1, Math.round(realDist * 2));
                  } else if (!etaMinutes) {
                    const dx = matchedDriver.currentX - (activeTrip.pickup.x || 50);
                    const dy = matchedDriver.currentY - (activeTrip.pickup.y || 50);
                    const gridDist = Math.sqrt(dx * dx + dy * dy);
                    etaMinutes = Math.max(1, Math.ceil(gridDist / 3.5));
                  }
                  etaLabel = lang === 'ar' ? `⏰ الوقت المتوقع لوصول الكابتن: ${etaMinutes} دقيقة` : `⏰ Captain ETA: ${etaMinutes} mins`;
                  badgeColor = 'bg-amber-50 text-amber-800 border-amber-200';
                } else if (activeTrip.status === 'ARRIVED') {
                  etaLabel = lang === 'ar' ? '🎉 الكابتن ينتظرك عند نقطة الركوب الآن!' : '🎉 Captain is waiting at pickup!';
                  badgeColor = 'bg-emerald-50 text-emerald-800 border-emerald-200';
                } else if (activeTrip.status === 'STARTED') {
                  if (!etaMinutes && matchedDriver.lat && matchedDriver.lng && activeTrip.dropoff.lat && activeTrip.dropoff.lng) {
                    const realDist = calculateHaversineDistance(matchedDriver.lat, matchedDriver.lng, activeTrip.dropoff.lat, activeTrip.dropoff.lng);
                    etaMinutes = Math.max(1, Math.round(realDist * 2));
                  } else if (!etaMinutes) {
                    const dx2 = matchedDriver.currentX - (activeTrip.dropoff.x || 50);
                    const dy2 = matchedDriver.currentY - (activeTrip.dropoff.y || 50);
                    const gridDist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
                    etaMinutes = Math.max(1, Math.ceil(gridDist2 / 3.5));
                  }
                  etaLabel = lang === 'ar' ? `📍 وقت الوصول التقريبي للوجهة: ${etaMinutes} دقيقة` : `📍 Destination ETA: ${etaMinutes} mins`;
                  badgeColor = 'bg-indigo-50 text-indigo-800 border-indigo-200';
                }

                return (
                  <div className={`p-2 rounded-xl border text-[11px] font-bold text-center ${badgeColor} animate-fade-in`}>
                    {etaLabel}
                  </div>
                );
              })()}
            </div>

            {/* Route Details */}
            <div className="border-t border-b border-slate-200/60 py-3 space-y-2">
              <div className="flex gap-2">
                <MapPin className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] text-slate-400">{lang === 'ar' ? 'من (نقطة الركوب)' : 'From (Pickup)'}</p>
                  <p className="text-xs font-medium text-slate-800">
                    {lang === 'ar' ? activeTrip.pickup?.nameAr || activeTrip.pickup?.nameEn || '' : activeTrip.pickup?.nameEn || activeTrip.pickup?.nameAr || ''}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Navigation className="w-4 h-4 text-rose-500 shrink-0 mt-0.5 rotate-45" />
                <div>
                  <p className="text-[10px] text-slate-400">{lang === 'ar' ? 'إلى (نقطة الوصول)' : 'To (Dropoff)'}</p>
                  <p className="text-xs font-medium text-slate-800">
                    {lang === 'ar' ? activeTrip.dropoff?.nameAr || activeTrip.dropoff?.nameEn || '' : activeTrip.dropoff?.nameEn || activeTrip.dropoff?.nameAr || ''}
                  </p>
                </div>
              </div>
            </div>

            {/* Driver Details if Assigned */}
            {activeTrip.driverId && (
              <div className="bg-white border border-slate-100 p-3 rounded-xl flex items-center gap-3">
                <div className="w-12 h-12 rounded-full overflow-hidden bg-slate-100 shrink-0 flex items-center justify-center text-2xl">
                  {(() => {
                    const drv = drivers.find(d => d.id === activeTrip.driverId);
                    if (drv?.vehicleType === 'CAR') return '🚖';
                    if (drv?.vehicleType === 'MOTORCYCLE') return '🏍️';
                    if (drv?.vehicleType === 'TOKTOK') return '🛺';
                    if (drv?.vehicleType === 'TRICYCLE') return '🚲';
                    return '🚗';
                  })()}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-xs font-bold text-slate-800 truncate">{activeTrip.driverName}</h4>
                  <p className="text-[9px] text-slate-500 flex flex-wrap items-center gap-1.5 mt-0.5">
                    <span className="bg-amber-100 text-amber-800 text-[8px] font-extrabold px-1.5 py-0.5 rounded">
                      {(() => {
                        const driverType = drivers.find((d) => d.id === activeTrip.driverId)?.vehicleType;
                        if (driverType === 'CAR') return lang === 'ar' ? 'سيارة 🚖' : 'Car 🚖';
                        if (driverType === 'MOTORCYCLE') return lang === 'ar' ? 'موتوسيكل 🏍️' : 'Motorcycle 🏍️';
                        if (driverType === 'TOKTOK') return lang === 'ar' ? 'توكتوك 🛺' : 'TukTuk 🛺';
                        return lang === 'ar' ? 'تروسيكل 🚲' : 'Tricycle 🚲';
                      })()}
                    </span>
                    <span className="font-bold text-slate-700">
                      {drivers.find((d) => d.id === activeTrip.driverId)?.vehicleName}
                    </span>
                    <span>|</span>
                    <span className="font-mono text-[9px] font-bold bg-slate-100 px-1 py-0.2 rounded text-slate-700">
                      {drivers.find((d) => d.id === activeTrip.driverId)?.carPlate}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleShareSafety(activeTrip)}
                    title={lang === 'ar' ? 'مشاركة تفاصيل الرحلة للأمان مع الأهل' : 'Share trip for safety'}
                    className="inline-flex items-center gap-1 text-[10px] text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-full font-bold transition-colors pointer-events-auto shadow-xs cursor-pointer"
                  >
                    <Share2 className="w-2.5 h-2.5 text-emerald-600" />
                    <span>{lang === 'ar' ? 'مشاركة للأمان' : 'Share'}</span>
                  </button>
                  <a
                    href={`tel:${drivers.find((d) => d.id === activeTrip.driverId)?.phone}`}
                    className="inline-flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-full hover:bg-blue-100 font-bold transition-colors pointer-events-auto shadow-xs"
                  >
                    <Phone className="w-2.5 h-2.5" />
                    <span>{lang === 'ar' ? 'اتصال' : 'Call'}</span>
                  </a>
                </div>
              </div>
            )}

            {/* Chat with Captain Section */}
            {activeTrip && activeTrip.status !== 'SEARCHING' && (
              <div className="bg-white border border-slate-150 p-3 rounded-2xl space-y-2">
                <div className="flex items-center gap-1.5 text-slate-700 font-bold text-xs pb-1 border-b border-slate-100">
                  <MessageSquare className="w-3.5 h-3.5 text-blue-600 animate-pulse" />
                  <span>{lang === 'ar' ? 'شات للتواصل الفوري داخل التطبيق' : 'In-App Direct Chat'}</span>
                </div>

                <div className="bg-slate-50 rounded-xl p-2 max-h-[120px] overflow-y-auto space-y-1.5 border border-slate-100 flex flex-col pointer-events-auto">
                  {activeTripChatMessages.length > 0 ? (
                    [...activeTripChatMessages]
                      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
                      .map((msg) => (
                      <div
                        key={msg.id}
                        className={`max-w-[85%] rounded-xl px-2.5 py-1 text-[10px] leading-snug shadow-xs ${
                          msg.sender === 'RIDER'
                            ? 'bg-blue-600 text-white rounded-tr-none self-end text-right'
                            : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none self-start text-left'
                        }`}
                      >
                        <p className="font-semibold break-words">{msg.text}</p>
                        <span className="text-[7.5px] opacity-80 block mt-0.5 text-right">{msg.timestamp}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-3 text-slate-400 text-[9px]">
                      💬 {lang === 'ar' ? 'مرحبًا! راسل الكابتن للتنسيق وتأكيد نقطة اللقاء.' : 'Hi! Send a message to coordinate pickup.'}
                    </div>
                  )}
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!chatText.trim()) return;
                    onSendChatMessage(chatText.trim(), 'RIDER');
                    setChatText('');
                  }}
                  className="flex gap-1 pt-1 pointer-events-auto"
                >
                  <input
                    type="text"
                    value={chatText}
                    onChange={(e) => setChatText(e.target.value)}
                    placeholder={lang === 'ar' ? 'اكتب رسالة للكابتن...' : 'Ask captain something...'}
                    className="flex-1 px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-[10.5px] font-medium text-slate-800 focus:outline-none focus:border-blue-500"
                  />
                  <button
                    type="submit"
                    className="px-3 bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-[10.5px] rounded-lg transition-colors cursor-pointer"
                  >
                    {lang === 'ar' ? 'إرسال' : 'Send'}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {/* State 2a: CANCELLED Trip - Show dismiss button */}
        {activeTrip && activeTrip.status === 'CANCELLED' && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 space-y-3 text-center">
            <div className="w-10 h-10 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto text-lg font-black">
              ❌
            </div>
            <h4 className="text-xs font-black text-rose-800">
              {lang === 'ar' ? 'تم إلغاء الرحلة' : 'Trip Cancelled'}
            </h4>
            <p className="text-[10px] text-rose-600 leading-relaxed">
              {lang === 'ar'
                ? 'لم يتمكن أي سائق من قبول طلبك في الوقت المحدد. يمكنك المحاولة مرة أخرى.'
                : 'No driver could accept your request in time. Please try again.'}
            </p>
            <div className="bg-white rounded-xl p-3 space-y-1.5 text-right border border-rose-100">
              <div className="flex gap-2 text-[10px]">
                <MapPin className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span className="font-medium text-slate-700">{lang === 'ar' ? (activeTrip.pickup?.nameAr || activeTrip.pickup?.nameEn || '') : (activeTrip.pickup?.nameEn || activeTrip.pickup?.nameAr || '')}</span>
              </div>
              <div className="flex gap-2 text-[10px]">
                <Navigation className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5 rotate-45" />
                <span className="font-medium text-slate-700">{lang === 'ar' ? (activeTrip.dropoff?.nameAr || activeTrip.dropoff?.nameEn || '') : (activeTrip.dropoff?.nameEn || activeTrip.dropoff?.nameAr || '')}</span>
              </div>
              <div className="flex justify-between text-[10px] border-t border-rose-100 pt-1.5 mt-1">
                <span className="font-black text-slate-500">{lang === 'ar' ? 'التكلفة:' : 'Fare:'}</span>
                <span className="font-black text-rose-600">{activeTrip.fare} {lang === 'ar' ? 'ج.م' : 'EGP'}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onCancelRide}
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-xl shadow-md transition-all cursor-pointer pointer-events-auto"
            >
              {lang === 'ar' ? '✅ العودة للصفحة الرئيسية وطلب رحلة جديدة' : '✅ Return to booking & request new ride'}
            </button>
          </div>
        )}

         {/* State 2b: Completed Trip — Return Home */}
         {activeTrip && activeTrip.riderId === rider.id && activeTrip.status === 'COMPLETED' && (
           <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3 text-center">
             <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-lg font-black">
               🎉
             </div>
             <h4 className="text-xs font-black text-emerald-900">
               {lang === 'ar' ? 'تم اكتمال الرحلة بنجاح! 🎉' : 'Trip Completed Successfully! 🎉'}
             </h4>
             <p className="text-[10px] text-emerald-700">
               {lang === 'ar'
                 ? `شكراً لاستخدامك كابتن عز. المبلغ المستحق: ${activeTrip.fare} ج.م`
                 : `Thank you for using Captain Ezz. Amount due: ${activeTrip.fare} EGP`}
             </p>
             {onTripCompleted && (
               <button
                 type="button"
                 onClick={onTripCompleted}
                 className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md transition-all cursor-pointer pointer-events-auto"
               >
                 {lang === 'ar' ? '🏠 العودة للصفحة الرئيسية' : '🏠 Return to Home'}
               </button>
             )}
           </div>
         )}

        {/* State 3: Booking Form (No active trip) */}
        {(!activeTrip || activeTrip.riderId !== rider.id) && (
          <div className="space-y-4">
            {/* Store Banner Advertisement */}
            <AdBanner ads={getRegionFilteredAds()} variant="home" lang={lang} lowDataMode={lowDataMode} />

            {noAvailableDrivers && (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-3 space-y-2 text-center animate-fade-in">
                <div className="w-10 h-10 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto text-lg font-black">
                  😔
                </div>
                <p className="text-xs font-bold text-rose-800">
                  {lang === 'ar' ? 'لا يوجد سائقين متاحين حالياً' : 'No available drivers right now'}
                </p>
                <p className="text-[10px] text-rose-600 leading-relaxed">
                  {lang === 'ar'
                    ? 'عذراً، لا يوجد سائقين متاحين في منطقتك. يرجى المحاولة مرة أخرى لاحقاً.'
                    : 'Sorry, there are no available drivers in your area. Please try again later.'}
                </p>
              </div>
            )}
            {/* Title / Greeting */}
            <div>
              <h2 className="text-base font-bold text-slate-900">
                {lang === 'ar' ? 'أين تريد الذهاب اليوم؟' : 'Where to today?'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {lang === 'ar'
                  ? 'اختر نقطة الركوب والوصول للتحرك فورا مع الكابتن.'
                  : 'Choose pickup and dropoff to ride instantly with your captain.'}
              </p>
            </div>

            {/* Pickup Region Selection (Mandatory — Prominent standalone card) */}
            {!activeTrip && (
              <div className="bg-gradient-to-l from-indigo-50 to-white border-2 border-indigo-200 rounded-2xl p-3.5 space-y-2.5 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <label className="text-[11px] font-black text-slate-700 block">
                      {lang === 'ar' ? 'اختر منطقة الركوب' : 'Select Pickup Region'}
                    </label>
                    <p className="text-[9px] text-slate-400 leading-tight mt-0.5">
                      {lang === 'ar' ? 'حدد المنطقة لإيجاد أقرب الكباتن المتاحين لك' : 'Choose your area to find nearest available captains'}
                    </p>
                  </div>
                  {!selectedPickupRegion && (
                    <span className="text-[8px] font-black text-rose-600 bg-rose-50 px-2 py-1 rounded-full animate-pulse shrink-0 border border-rose-200">
                      {lang === 'ar' ? 'مطلوب' : 'Required'}
                    </span>
                  )}
                </div>
                <select
                  value={selectedPickupRegion}
                  onChange={(e) => setSelectedPickupRegion(e.target.value)}
                  className={`w-full bg-white border-2 rounded-xl py-2.5 px-3 text-[12px] font-bold focus:outline-none cursor-pointer transition-all ${
                    selectedPickupRegion
                      ? 'border-indigo-300 text-slate-800'
                      : 'border-rose-200 text-slate-400'
                  }`}
                >
                  <option value="">{lang === 'ar' ? '— اختر المنطقة —' : '— Select region —'}</option>
                  {Array.isArray(regions)
                    ? regions
                        .filter((region) => region && region.id)
                        .map((region) => (
                          <option key={region.id} value={region.id}>
                            {region.nameAr || region.nameEn || (lang === 'ar' ? 'منطقة' : 'Region')} ({region.nameEn || region.nameAr || (lang === 'ar' ? 'منطقة' : 'Region')})
                          </option>
                        ))
                    : null}
                </select>
                {selectedRegion && (
                  <div className="flex items-center gap-1.5 text-[9px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1.5 rounded-lg w-fit border border-emerald-100">
                    <Check className="w-3 h-3" />
                    <span>
                      {lang === 'ar'
                        ? `تم اختيار: ${selectedRegion.nameAr || selectedRegion.nameEn || ''}`
                        : `Selected: ${selectedRegion.nameEn || selectedRegion.nameAr || ''}`}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Free-text place search: type a place name to set pickup or dropoff */}
            <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-slate-700 font-bold text-[11px] justify-end">
                <Search className="w-3.5 h-3.5 text-blue-600" />
                <span>{lang === 'ar' ? 'ابحث عن مكان بالاسم (الالتقاء أو الوصول)' : 'Search a place by name (pickup or dropoff)'}</span>
              </div>
              <div className="flex gap-1.5">
                <div className="flex bg-slate-100 rounded-xl p-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPlaceSearchTarget('pickup')}
                    className={`px-2 py-1 rounded-lg text-[9px] font-black transition-all ${placeSearchTarget === 'pickup' ? 'bg-emerald-600 text-white' : 'text-slate-500'}`}
                  >
                    {lang === 'ar' ? '📍 التقاء' : '📍 Pickup'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlaceSearchTarget('dropoff')}
                    className={`px-2 py-1 rounded-lg text-[9px] font-black transition-all ${placeSearchTarget === 'dropoff' ? 'bg-rose-600 text-white' : 'text-slate-500'}`}
                  >
                    {lang === 'ar' ? '🏁 وصول' : '🏁 Drop'}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleUseCurrentLocation}
                  className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-xl text-[9px] font-black transition-all cursor-pointer pointer-events-auto flex items-center gap-1 shrink-0"
                  title={lang === 'ar' ? 'استخدم موقعي الحالي كنقطة التقاء' : 'Use my current location'}
                >
                  <span>📍</span>
                  <span>{lang === 'ar' ? 'موقعي' : 'My Loc'}</span>
                </button>

                <div className="relative flex-1">
                  <input
                    type="text"
                    value={placeSearchText}
                    onChange={(e) => {
                      const value = e.target.value;
                      setPlaceSearchText(value);
                      
                      // Debounce search: clear previous timer and set new one
                      if (placeSearchDebounceRef.current) {
                        clearTimeout(placeSearchDebounceRef.current);
                      }
                      
                      if (!value.trim()) {
                        setPlaceSearchResults([]);
                        placeSearchDebounceRef.current = null;
                        return;
                      }
                      
                      setPlaceSearchLoading(true);
                      placeSearchDebounceRef.current = setTimeout(async () => {
                        try {
                          const res = await fetch(`/api/search?q=${encodeURIComponent(value + ', مصر')}`, {
                            headers: { 'Accept': 'application/json' },
                          });
                          if (!res.ok) throw new Error('search failed');
                          const data = await res.json();
                          const results = (data || []).map((item: any) => {
                            const built = buildPlaceName(item);
                            return {
                              display_name: item.display_name,
                              lat: parseFloat(item.lat),
                              lng: parseFloat(item.lon),
                              city: built.city,
                            };
                          });
                          placeSearchCacheRef.current[value.toLowerCase()] = results;
                          setPlaceSearchResults(results);
                        } catch {
                          setPlaceSearchResults([]);
                        } finally {
                          setPlaceSearchLoading(false);
                        }
                      }, 300); // 300ms debounce
                    }}
                    placeholder={lang === 'ar' ? 'اكتب اسم المكان أو العنوان...' : 'Type a place or address...'}
                    className="w-full bg-white border border-slate-200 rounded-xl py-2 px-3 text-[11px] font-medium text-slate-800 focus:outline-none focus:border-blue-500 pointer-events-auto"
                  />
                  {placeSearchLoading && (
                    <Loader2 className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 animate-spin" />
                  )}
                </div>
              </div>
              {placeSearchResults.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-xl max-h-[180px] overflow-y-auto divide-y divide-slate-100">
                  {placeSearchResults.map((item, idx) => (
                    <button
                      key={`place-${idx}`}
                      type="button"
                      onClick={() => applyPlaceResult(item)}
                      className="w-full text-right px-3 py-2 text-[10px] text-slate-700 hover:bg-blue-50 flex flex-col gap-0.5 pointer-events-auto cursor-pointer"
                    >
                      <span className="font-semibold text-slate-900 truncate">{item.display_name.split(',')[0]}</span>
                      <span className="text-[8px] text-slate-400 truncate">{item.display_name}</span>
                    </button>
                  ))}
                </div>
              )}
              {geoError && (
                <p className="text-[9px] font-bold text-rose-600 text-right">{geoError}</p>
              )}
            </div>

            {/* Map for Pickup/Dropoff Selection — lazy loaded on demand */}
            {!showMap ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowMap(true)}
                  className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-black rounded-2xl shadow-md transition-all flex items-center justify-center gap-2"
                >
                  <MapPin className="w-4 h-4" />
                  {lang === 'ar' ? 'عرض الخريطة لاختيار نقطة الالتقاء / الوصول' : 'Show map to pick pickup / destination'}
                </button>
              </div>
            ) : (
              <Suspense
                fallback={
                  <div className="w-full h-64 flex items-center justify-center bg-slate-100 rounded-2xl">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                  </div>
                }
              >
                 {stats?.mapProvider === 'google' && stats?.googleMapsApiKey ? (
                  <GoogleMap
                    locations={locations}
                    activeTrip={activeTrip}
                    selectedPickup={selectedPickup}
                    selectedDropoff={selectedDropoff}
                    lang={lang}
                    onUpdateLocations={onUpdateLocations}
                    onSelectPickup={setSelectedPickup}
                    onSelectDropoff={setSelectedDropoff}
                    routeGeometry={activeTrip?.routeGeometry || routeGeometry || undefined}
                    apiKey={stats.googleMapsApiKey}
                    distanceKm={distance}
                    isRealRoute={!!realDistance}
                  />
                ) : (
                  <CityMap
                    locations={locations}
                    activeTrip={activeTrip}
                    selectedPickup={selectedPickup}
                    selectedDropoff={selectedDropoff}
                    lang={lang}
                    onUpdateLocations={onUpdateLocations}
                    onSelectPickup={setSelectedPickup}
                    onSelectDropoff={setSelectedDropoff}
                    routeGeometry={activeTrip?.routeGeometry || routeGeometry || undefined}
                    distanceKm={distance}
                    isRealRoute={!!realDistance}
                    readOnly={!!activeTrip}
                    currentDriverPosition={activeTrip?.driverId ? (() => {
                      const drv = drivers.find(d => d.id === activeTrip.driverId);
                      return drv?.lat && drv?.lng ? { lat: drv.lat, lng: drv.lng } : null;
                    })() : null}
                    dataSaverMode={lowDataMode}
                    onToggleDataSaver={lowDataMode ? onDisableLowData : onEnableLowData}
                  />
                )}
              </Suspense>
            )}

            {/* Starred / Favorite Locations Section */}
            {favorites.length > 0 && (
              <div className="bg-amber-50/60 border border-amber-100 rounded-2xl p-3 space-y-2 text-right">
                <p className="text-[10px] font-extrabold text-amber-800 flex items-center gap-1 justify-end">
                  <span>⭐ أماكني المميزة والمفضلة المحفوظة</span>
                </p>
                <div className="flex flex-wrap gap-1.5 justify-end">
                  {favorites.map((fav) => (
                    <button
                      key={fav.id}
                      type="button"
                      onClick={() => handleSelectFavorite(fav)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[10px] bg-white text-slate-700 hover:bg-amber-100 border border-slate-200/60 hover:border-amber-200 rounded-full transition-all cursor-pointer pointer-events-auto"
                      title={lang === 'ar' ? `انقر لتعيين كـ ${fav.type === 'pickup' ? 'ركوب' : 'وصول'}` : `Set as ${fav.type}`}
                    >
                      <span>{fav.type === 'pickup' ? '📍' : '🏁'}</span>
                      <span className="font-bold">{fav.name}</span>
                      <span
                        onClick={(e) => handleDeleteFavorite(fav.id, e)}
                        className="text-red-500 hover:text-red-700 font-extrabold ml-1 cursor-pointer text-xs"
                        title={lang === 'ar' ? 'حذف' : 'Delete'}
                      >
                        ×
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Booking Fields — Pickup & Dropoff with connected route line */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-1 relative z-30 shadow-sm">
              {/* Pickup */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">
                    {lang === 'ar' ? 'نقطة الركوب' : 'Pickup Location'}
                  </label>
                  <div className={`bg-slate-50 border rounded-xl px-3 py-2.5 text-xs font-medium min-h-[42px] flex items-center transition-colors ${
                    pickupLoc ? 'border-emerald-200 text-slate-800' : 'border-slate-200 text-slate-400'
                  }`}>
                    <span className="truncate">{pickupLoc ? (lang === 'ar' ? pickupLoc.nameAr || pickupLoc.nameEn || '' : pickupLoc.nameEn || pickupLoc.nameAr || '') : (lang === 'ar' ? 'اضغط على الخريطة لتحديد نقطة الركوب' : 'Tap on map to set pickup')}</span>
                  </div>
                </div>
              </div>

              {/* Connected dashed route line + centered swap button */}
              <div className="flex items-center gap-3 py-0.5">
                <div className="w-10 flex justify-center shrink-0">
                  <div className="w-0.5 h-6 border-l-2 border-dashed border-slate-300" />
                </div>
                <div className="flex-1 flex justify-center">
                  <button
                    type="button"
                    onClick={swapLocations}
                    className="p-2 bg-white border border-slate-200 hover:border-slate-400 rounded-full text-slate-400 hover:text-slate-700 hover:scale-110 active:scale-95 transition-all cursor-pointer pointer-events-auto shadow-sm"
                    title={lang === 'ar' ? 'تبديل الركوب والوصول' : 'Swap pickup and dropoff'}
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5 rotate-90" />
                  </button>
                </div>
                <div className="w-10 shrink-0" />
              </div>

              {/* Dropoff */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 border border-rose-100 text-rose-600 flex items-center justify-center shrink-0">
                  <Navigation className="w-5 h-5 rotate-45" />
                </div>
                <div className="flex-1 min-w-0">
                  <label className="text-[10px] font-bold text-slate-400 block mb-1">
                    {lang === 'ar' ? 'وجهة الوصول' : 'Dropoff Location'}
                  </label>
                  <div className={`bg-slate-50 border rounded-xl px-3 py-2.5 text-xs font-medium min-h-[42px] flex items-center transition-colors ${
                    dropoffLoc ? 'border-rose-200 text-slate-800' : 'border-slate-200 text-slate-400'
                  }`}>
                    <span className="truncate">{dropoffLoc ? (lang === 'ar' ? dropoffLoc.nameAr || dropoffLoc.nameEn || '' : dropoffLoc.nameEn || dropoffLoc.nameAr || '') : (lang === 'ar' ? 'اضغط على الخريطة لتحديد وجهة الوصول' : 'Tap on map to set dropoff')}</span>
                  </div>
                </div>
              </div>

              {/* Pickup Landmark / Specific Details input */}
              {pickupLoc && (
                <div className="mt-2.5 bg-emerald-50/40 border border-emerald-100/50 rounded-xl p-2.5 text-right">
                  <label className="text-[9px] font-extrabold text-emerald-700 block mb-1.5">
                    {lang === 'ar' ? '📍 علامة مميزة تساعد الكابتن في إيجادك' : '📍 Landmark to help your captain find you'}
                  </label>
                  <input
                    type="text"
                    value={pickupLandmark}
                    onChange={(e) => setPickupLandmark(e.target.value)}
                    placeholder={lang === 'ar' ? 'مثال: أمام قهوة البورصة / بجوار صيدلية علي' : 'e.g., in front of Al-Borsa cafe...'}
                    className="w-full bg-white border border-emerald-200 rounded-lg py-1.5 px-2.5 text-[10px] font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-200 pointer-events-auto"
                  />
                </div>
              )}
            </div>

            {/* Vehicle Type Picker Grid */}
            {pickupLoc && dropoffLoc && (
              <div className="space-y-1.5" dir="rtl">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-extrabold text-slate-500 block text-right">
                    {lang === 'ar' ? 'اختر نوع المركبة المطلوبة:' : 'Select Vehicle Type:'}
                  </label>
                  {distance > 50 && (
                    <span className="text-[8.5px] font-black text-amber-700 bg-amber-100 px-2 py-0.5 rounded-md">
                      {lang === 'ar' ? '⚠️ المسافة > 50 كم: سيارات فقط' : '⚠️ Distance > 50km: Cars only'}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'CAR', icon: '🚖', labelAr: 'سيارة', labelEn: 'Car', baseMod: 1.0, kmMod: 1.0, maxKm: null },
                    { id: 'TOKTOK', icon: '🛺', labelAr: 'توكتوك', labelEn: 'TukTuk', baseMod: 0.5, kmMod: 0.6, maxKm: 50 },
                    { id: 'MOTORCYCLE', icon: '🏍️', labelAr: 'موتوسيكل', labelEn: 'Motorcycle', baseMod: 0.6, kmMod: 0.5, maxKm: 50 },
                  ].map((v) => {
                    const isRestricted = v.maxKm !== null && distance > v.maxKm;
                    const vFare = computeTripFare(distance, v.id, discountAmount);
                    const isSelected = requestedVehicleType === v.id;
                    const countAvailable = onlineDrivers.filter((d) => d.status === 'AVAILABLE' && String(d.vehicleType).toUpperCase() === v.id).length;

                    return (
                      <button
                        key={v.id}
                        type="button"
                        disabled={isRestricted}
                        onClick={() => {
                          if (isRestricted) {
                            alert(lang === 'ar'
                              ? `عفواً، لا يمكن طلب ${v.labelAr} للمسافات التي تتجاوز ${v.maxKm} كم لأنها مسافة سفر شاقة. يرجى اختيار سيارة لراحتك وسلامتك.`
                              : `Sorry, ${v.labelEn} is only available for trips up to ${v.maxKm} km. Please select a Car for long trips.`);
                            return;
                          }
                          setRequestedVehicleType(v.id as any);
                        }}
                        className={`p-2 rounded-xl border flex flex-col items-center justify-between text-center transition-all pointer-events-auto ${
                          isRestricted
                            ? 'bg-slate-100/80 border-slate-200 text-slate-400 opacity-60 cursor-not-allowed'
                            : isSelected
                            ? 'bg-slate-900 border-slate-950 text-white shadow-md scale-[1.03] cursor-pointer'
                            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer'
                        }`}
                      >
                        <span className="text-xl">{v.icon}</span>
                        <span className="text-[9px] font-black mt-1">{lang === 'ar' ? v.labelAr : v.labelEn}</span>
                        {isRestricted ? (
                          <span className="text-[7.5px] font-black text-rose-600 bg-rose-50 px-1 py-0.2 rounded mt-0.5">
                            {lang === 'ar' ? 'أقصى حد 50 كم' : 'Max 50km'}
                          </span>
                        ) : (
                          <span className={`text-[9px] font-black mt-0.5 ${isSelected ? 'text-amber-300' : 'text-blue-600'}`}>
                            {vFare} ج.م
                          </span>
                        )}
                        <span className={`text-[7.5px] mt-0.5 px-1.5 py-0.2 rounded-full font-extrabold ${
                          isRestricted
                            ? 'bg-slate-200 text-slate-500'
                            : countAvailable > 0
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-slate-100 text-slate-400'
                        }`}>
                          {isRestricted ? (lang === 'ar' ? 'مسافة سفر' : 'Long distance') : countAvailable > 0 ? `${countAvailable} متاح` : 'مغلق'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Estimation and Driver State Indicator */}
            {pickupLoc && dropoffLoc ? (
              <div className="bg-amber-400/10 border-2 border-amber-400 rounded-2xl p-4 space-y-3.5 shadow-md animate-fade-in text-right">
                
                {/* 🔄 Round Trip & Waiting Option */}
                <div className="bg-white/80 border border-amber-300 rounded-xl p-3 space-y-2.5 shadow-xs">
                  <div className="flex items-center justify-between">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isRoundTrip}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setIsRoundTrip(checked);
                          if (!checked) setWaitingMinutes(0);
                        }}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                    </label>
                    <div className="flex items-center gap-1.5">
                      <RotateCw className={`w-4 h-4 ${isRoundTrip ? 'text-amber-600 animate-spin-slow' : 'text-slate-400'}`} />
                      <span className="text-xs font-black text-slate-800">
                        {lang === 'ar' ? 'مشوار ذهاب وعودة مع الكابتن' : 'Round-Trip Ride'}
                      </span>
                    </div>
                  </div>

                  {isRoundTrip && (
                    <div className="pt-2 border-t border-amber-200/60 space-y-2 animate-fade-in">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="font-extrabold text-amber-900 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-amber-600" />
                          {lang === 'ar' ? 'اختر مدة انتظار الكابتن هناك:' : 'Captain Waiting Duration:'}
                        </span>
                        <span className="font-black text-slate-700 bg-amber-100/80 px-2 py-0.5 rounded-md">
                          {waitingMinutes === 0
                            ? (lang === 'ar' ? 'بدون انتظار (عودة مباشرة)' : 'No wait (immediate return)')
                            : (lang === 'ar' ? `${waitingMinutes} دقيقة انتظار` : `${waitingMinutes} mins wait`)}
                        </span>
                      </div>

                      {/* Waiting Duration Chips */}
                      <div className="grid grid-cols-4 gap-1.5">
                        {[
                          { min: 0, labelAr: 'بدون', labelEn: '0m' },
                          { min: 15, labelAr: '15 د', labelEn: '15m' },
                          { min: 30, labelAr: '30 د', labelEn: '30m' },
                          { min: 45, labelAr: '45 د', labelEn: '45m' },
                          { min: 60, labelAr: 'ساعة', labelEn: '1h' },
                          { min: 90, labelAr: 'ساعة ونصف', labelEn: '1.5h' },
                          { min: 120, labelAr: 'ساعتين', labelEn: '2h' },
                        ].map((chip) => (
                          <button
                            key={chip.min}
                            type="button"
                            onClick={() => setWaitingMinutes(chip.min)}
                            className={`py-1.5 px-1 rounded-lg text-[9.5px] font-black transition-all cursor-pointer ${
                              waitingMinutes === chip.min
                                ? 'bg-amber-500 text-white shadow-xs scale-[1.02]'
                                : 'bg-slate-50 text-slate-700 hover:bg-amber-50 border border-slate-200'
                            }`}
                          >
                            {lang === 'ar' ? chip.labelAr : chip.labelEn}
                          </button>
                        ))}
                      </div>

                      {waitingFee > 0 && (
                        <p className="text-[9px] font-bold text-amber-800 bg-amber-50 p-1.5 rounded-md text-right">
                          ⏱️ {lang === 'ar' ? `تشمل التسعيرة ${waitingFee} ج.م رسوم انتظار مدة (${waitingMinutes} دقيقة).` : `Includes ${waitingFee} EGP waiting fee (${waitingMinutes}m).`}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex justify-between items-center">
                  <div className="text-left">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      {isRoundTrip ? (lang === 'ar' ? 'المسافة (ذهاب وعودة)' : 'Distance (Round-Trip)') : (lang === 'ar' ? 'المسافة الإجمالية' : 'Total Distance')}
                    </span>
                    <span className="text-sm font-black text-slate-800">
                      {totalTraveledDistance || distance} {lang === 'ar' ? 'كم' : 'km'}
                      {isRoundTrip && (
                        <span className="text-[9px] text-slate-400 block font-medium">
                          ({oneWayDistance} {lang === 'ar' ? 'كم للاتجاه' : 'km each way'})
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      {lang === 'ar' ? 'تكلفة الرحلة النهائية 💰' : 'Final Trip Fare 💰'}
                    </span>
                    <span className="text-2xl font-black text-amber-500 block leading-tight">
                      {appliedPromo && originalFare > estimatedFare ? (
                        <>
                          <span className="text-xs line-through text-slate-400 mr-1">{originalFare}</span>
                          <span>{estimatedFare}</span>
                        </>
                      ) : (
                        estimatedFare
                      )} {lang === 'ar' ? 'ج.م' : 'EGP'}
                    </span>
                  </div>
                </div>

                {isCalculatingRoute && (
                  <div className="text-[10px] text-blue-600 font-bold animate-pulse flex items-center gap-1 justify-end">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>{lang === 'ar' ? 'جاري حساب الطريق الحقيقي...' : 'Calculating real route...'}</span>
                  </div>
                )}

                {/* Promo Code Input */}
                <div className="bg-white/60 border border-slate-200/50 rounded-xl p-2.5 space-y-2 text-right">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-black text-slate-700">
                      {lang === 'ar' ? '🏷️ كود الخصم (بروموكود)' : '🏷️ Promo Code'}
                    </span>
                    {appliedPromo && (
                      <span className="text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-md">
                        {lang === 'ar' ? `تم تطبيق خصم بقيمة ${appliedPromo.discount} ج.م` : `Applied ${appliedPromo.discount} EGP`}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={promoInput}
                      onChange={(e) => {
                        setPromoInput(e.target.value);
                        setPromoError('');
                      }}
                      placeholder={lang === 'ar' ? 'أدخل كود الخصم' : 'Enter promo code'}
                      className="flex-1 px-2.5 py-1 text-[11px] font-bold border border-slate-200 rounded-lg text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:border-slate-400 text-right"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        if (!promoInput.trim()) return;
                        setPromoError('');
                        const validated = await validatePromoCode(promoInput.trim(), rider.id);
                        if (validated) {
                          setAppliedPromo({ code: validated.code, discount: validated.discountAmount, promoCodeId: validated.id });
                        } else {
                          setPromoError(lang === 'ar' ? 'كود الخصم غير صحيح أو مستخدم بالفعل!' : 'Invalid or already used promo code!');
                          setAppliedPromo(null);
                        }
                      }}
                      className="px-3 py-1 bg-slate-900 hover:bg-black text-white text-[10px] font-bold rounded-lg transition-all cursor-pointer pointer-events-auto"
                    >
                      {lang === 'ar' ? 'تطبيق' : 'Apply'}
                    </button>
                  </div>
                  {promoError && (
                    <p className="text-[9px] font-bold text-rose-500 text-right">{promoError}</p>
                  )}
                </div>

                {/* Safety Trip Share Trigger Button */}
                <div className="bg-emerald-50/60 border border-emerald-200/80 rounded-xl p-2.5 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => handleShareSafety(null)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[10px] font-black shadow-xs transition-transform active:scale-95 cursor-pointer pointer-events-auto"
                  >
                    <Share2 className="w-3 h-3" />
                    <span>{lang === 'ar' ? 'مشاركة تفاصيل الرحلة للأمان مع الأهل' : 'Share Trip with Family'}</span>
                  </button>
                  <div className="flex items-center gap-1 text-emerald-800 text-[10px] font-extrabold">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>{lang === 'ar' ? 'أمان العائلات' : 'Safety First'}</span>
                  </div>
                </div>

                <div className="bg-white/60 border border-amber-200/50 rounded-xl p-2.5 text-[10px] font-medium text-slate-600 leading-normal">
                  📌 {lang === 'ar' ? `من: ${pickupLoc?.nameAr || pickupLoc?.nameEn || ''}` : `From: ${pickupLoc?.nameEn || pickupLoc?.nameAr || ''}`}<br/>
                  🏁 {lang === 'ar' ? `إلى: ${dropoffLoc?.nameAr || dropoffLoc?.nameEn || ''}` : `To: ${dropoffLoc?.nameEn || dropoffLoc?.nameAr || ''}`}
                  {isRoundTrip && (
                    <span className="text-amber-800 font-bold block mt-1">
                      🔄 {lang === 'ar' ? `مشوار ذهاب وعودة (مع ${waitingMinutes} دقيقة انتظار)` : `Round-Trip ride (with ${waitingMinutes}m wait)`}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4 text-center space-y-1.5 animate-fade-in">
                <p className="text-xs font-black text-blue-900">
                  {lang === 'ar' ? '⚠️ لم يتم تحديد السعر بعد' : '⚠️ Price not calculated yet'}
                </p>
                <p className="text-[10.5px] text-blue-700 leading-relaxed font-bold">
                  {lang === 'ar' 
                    ? 'يرجى كتابة واختيار مكان الركوب ومكان الوصول من الاقتراحات ليظهر لك السعر بدقة فائقة 🚕.'
                    : 'Please search and select both pickup and destination from the dropdown list to see the exact trip fare 🚕.'}
                </p>
              </div>
            )}

            {/* System Status Indicators */}
            <div className="flex items-center justify-between px-1 text-[10px] text-slate-400">
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${onlineDrivers.length > 0 ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                <span>
                  {onlineDrivers.length} {lang === 'ar' ? 'كباتن متصلين' : 'Drivers online'}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${availableDrivers.length > 0 ? 'bg-blue-500' : 'bg-slate-300'}`} />
                <span>
                  {availableDrivers.length} {lang === 'ar' ? 'متاح للطلب' : 'Available now'}
                </span>
              </div>
            </div>

            {/* Available drivers count */}
            {pickupLoc && dropoffLoc && (() => {
              const availableCount = onlineDrivers.filter(d => d.status === 'AVAILABLE').length;
              return (
                <div className={`p-2.5 rounded-xl border text-[10px] font-medium text-right ${availableCount > 0 ? 'bg-blue-50 border-blue-100' : 'bg-amber-50 border-amber-200'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-bold text-slate-500 block">
                        {lang === 'ar' ? 'السائقين المتاحين لاستلام الطلب:' : 'Available drivers to accept your request:'}
                      </span>
                      <span className="text-[10px] font-black text-slate-800">{availableCount} {lang === 'ar' ? 'سائق' : 'drivers'}</span>
                    </div>
                    <div className="text-left">
                      <span className={`text-[10px] font-black ${availableCount > 0 ? 'text-blue-600' : 'text-amber-600'}`}>
                        {availableCount > 0 
                          ? (lang === 'ar' ? '🟢 متاحون' : '🟢 Available')
                          : (lang === 'ar' ? '🔴 غير متاحين' : '🔴 Unavailable')}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Request Button */}
            <button
              type="button"
              disabled={!selectedPickup || !selectedDropoff || !selectedPickupRegion || availableDrivers.length === 0}
                onClick={() => {
                  onRequestRide(requestedVehicleType, pickupLandmark, appliedPromo?.code, appliedPromo?.promoCodeId, appliedPromo?.discount, isRoundTrip, waitingMinutes);
                  setPickupLandmark('');
                }}
              className="w-full py-3 bg-slate-900 hover:bg-black disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-xs rounded-xl shadow-md disabled:shadow-none hover:scale-[1.01] transition-all cursor-pointer"
            >
              {availableDrivers.length === 0
                ? lang === 'ar'
                  ? 'تعذر العثور على سائق في الوقت الحالي'
                  : 'No drivers available in your area right now'
                : lang === 'ar'
                ? (isRoundTrip ? 'اطلب رحلة ذهاب وعودة الآن 🔄' : 'اطلب كابتن عز الآن 🚖')
                : (isRoundTrip ? 'Request Round-Trip Ride 🔄' : 'Request Ezz Captain Now 🚖')}
            </button>

            {/* Two-Step Confirmation Modal */}
            {showConfirmModal && pickupLoc && dropoffLoc && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[9999]">
                <div className="bg-white rounded-2xl w-full max-w-sm p-5 text-right space-y-4 shadow-xl">
                  {confirmStep === 'VEHICLE' && (
                    <>
                      <h3 className="text-xs font-black text-slate-800">
                        {lang === 'ar' ? 'اختر نوع المركبة' : 'Select Vehicle Type'}
                      </h3>
                      <p className="text-[10px] text-slate-500">
                        {lang === 'ar' ? 'اختر نوع المركبة المناسبة لرحلتك' : 'Choose the vehicle type for your trip'}
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        {[
                          { id: 'CAR', icon: '🚖', labelAr: 'سيارة', labelEn: 'Car', maxKm: null },
                          { id: 'TOKTOK', icon: '🛺', labelAr: 'توكتوك', labelEn: 'TukTuk', maxKm: 50 },
                          { id: 'MOTORCYCLE', icon: '🏍️', labelAr: 'موتوسيكل', labelEn: 'Motorcycle', maxKm: 50 },
                        ].map((v) => {
                          const isRestricted = v.maxKm !== null && distance > v.maxKm;
                          const vFare = computeTripFare(distance, v.id, discountAmount, isRoundTrip, waitingMinutes);
                          const isSelected = confirmVehicleType === v.id;
                          return (
                            <button
                              key={v.id}
                              type="button"
                              disabled={isRestricted}
                              onClick={() => {
                                if (isRestricted) return;
                                setConfirmVehicleType(v.id as any);
                              }}
                              className={`p-2.5 rounded-xl border flex flex-col items-center justify-between text-center transition-all ${
                                isRestricted
                                  ? 'bg-slate-100 border-slate-200 text-slate-400 opacity-60 cursor-not-allowed'
                                  : isSelected
                                  ? 'bg-slate-900 border-slate-950 text-white shadow-md scale-[1.03] cursor-pointer'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer'
                              }`}
                            >
                              <span className="text-xl">{v.icon}</span>
                              <span className="text-[10px] font-black mt-1">{lang === 'ar' ? v.labelAr : v.labelEn}</span>
                              {isRestricted ? (
                                <span className="text-[7.5px] font-bold text-rose-500 mt-0.5">
                                  {lang === 'ar' ? 'أقصى حد 50 كم' : 'Max 50km'}
                                </span>
                              ) : (
                                <span className={`text-[10px] font-black mt-0.5 ${isSelected ? 'text-amber-300' : 'text-blue-600'}`}>
                                  {vFare} {lang === 'ar' ? 'ج.م' : 'EGP'}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setShowConfirmModal(false)}
                          className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[11px] rounded-lg cursor-pointer"
                        >
                          {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmStep('PRICE')}
                          className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] rounded-lg cursor-pointer"
                        >
                          {lang === 'ar' ? 'التالي' : 'Next'}
                        </button>
                      </div>
                    </>
                  )}

                  {confirmStep === 'PRICE' && (
                    <>
                      <h3 className="text-xs font-black text-slate-800">
                        {lang === 'ar' ? 'تأكيد الطلب' : 'Confirm Your Ride'}
                      </h3>
                      <div className="bg-slate-50 rounded-xl p-3 space-y-2 text-right">
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-slate-500">
                            {lang === 'ar' ? 'من:' : 'From:'}
                          </span>
                          <span className="text-[10px] font-bold text-slate-800">{lang === 'ar' ? (pickupLoc?.nameAr || pickupLoc?.nameEn || '') : (pickupLoc?.nameEn || pickupLoc?.nameAr || '')}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-slate-500">
                            {lang === 'ar' ? 'إلى:' : 'To:'}
                          </span>
                          <span className="text-[10px] font-bold text-slate-800">{lang === 'ar' ? (dropoffLoc?.nameAr || dropoffLoc?.nameEn || '') : (dropoffLoc?.nameEn || dropoffLoc?.nameAr || '')}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-slate-500">
                            {lang === 'ar' ? 'المسافة:' : 'Distance:'}
                          </span>
                          <span className="text-[10px] font-bold text-slate-800">
                            {totalTraveledDistance || distance} {lang === 'ar' ? 'كم' : 'km'}
                            {isRoundTrip && ` (${lang === 'ar' ? 'ذهاب وعودة' : 'Round-trip'})`}
                          </span>
                        </div>
                        {isRoundTrip && (
                          <div className="flex justify-between items-center text-amber-800 font-bold">
                            <span className="text-[10px]">
                              {lang === 'ar' ? 'وقت الانتظار:' : 'Waiting Time:'}
                            </span>
                            <span className="text-[10px]">
                              {waitingMinutes} {lang === 'ar' ? 'دقيقة' : 'mins'}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold text-slate-500">
                            {lang === 'ar' ? 'المركبة:' : 'Vehicle:'}
                          </span>
                          <span className="text-[10px] font-bold text-slate-800">
                            {confirmVehicleType === 'CAR' && (lang === 'ar' ? '🚖 سيارة' : '🚖 Car')}
                            {confirmVehicleType === 'MOTORCYCLE' && (lang === 'ar' ? '🏍️ موتوسيكل' : '🏍️ Motorcycle')}
                            {confirmVehicleType === 'TOKTOK' && (lang === 'ar' ? '🛺 توكتوك' : '🛺 TukTuk')}
                          </span>
                        </div>
                        <div className="border-t border-slate-200 pt-2 flex justify-between items-center">
                          <span className="text-xs font-black text-slate-900">
                            {lang === 'ar' ? 'الإجمالي:' : 'Total:'}
                          </span>
                          <span className="text-lg font-black text-amber-500">
                            {estimatedFare} {lang === 'ar' ? 'ج.م' : 'EGP'}
                          </span>
                        </div>
                      </div>
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-2.5 text-[10px] font-medium text-slate-600 leading-normal">
                        ⚠️ {lang === 'ar' 
                          ? `سيتم إرسال الطلب لجميع السائقين المتاحين (${drivers.filter(d => d.isOnline && d.approvalStatus === 'APPROVED' && d.status === 'AVAILABLE').length} سائق). أول من يرد يأخذ الرحلة.`
                          : `Request will be sent to all available drivers (${drivers.filter(d => d.isOnline && d.approvalStatus === 'APPROVED' && d.status === 'AVAILABLE').length}). First to accept gets the ride.`}
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmStep('VEHICLE')}
                          className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[11px] rounded-lg cursor-pointer"
                        >
                          {lang === 'ar' ? 'رجوع' : 'Back'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmStep('SENDING');
                            onRequestRide(confirmVehicleType, confirmPickupLandmark || undefined, appliedPromo?.code, appliedPromo?.promoCodeId, appliedPromo?.discount, isRoundTrip, waitingMinutes);
                            setPickupLandmark('');
                            setShowConfirmModal(false);
                          }}
                          className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] rounded-lg cursor-pointer"
                        >
                          {lang === 'ar' ? 'تأكيد وإرسال' : 'Confirm & Send'}
                        </button>
                      </div>
                    </>
                  )}

                  {confirmStep === 'SENDING' && (
                    <div className="text-center space-y-3 py-4">
                      <Loader2 className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
                      <p className="text-xs font-black text-slate-800">
                        {lang === 'ar' ? 'جاري إرسال الطلب...' : 'Sending your request...'}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {lang === 'ar' ? 'جاري إرسال الطلب لجميع السائقين المتاحين...' : 'Sending your request to all available drivers...'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Trip Completed — Return Home */}
             {activeTrip && activeTrip.status === 'COMPLETED' && activeTrip.driverId && (
               <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 space-y-3 mt-3 text-center">
                 <div className="w-10 h-10 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto text-lg font-black">
                   🎉
                 </div>
                 <h4 className="text-xs font-black text-emerald-900">
                   {lang === 'ar' ? 'تم اكتمال الرحلة بنجاح! 🎉' : 'Trip Completed Successfully! 🎉'}
                 </h4>
                 <p className="text-[10px] text-emerald-700">
                   {lang === 'ar'
                     ? `شكراً لاستخدامك كابتن عز. المبلغ المستحق: ${activeTrip.fare} ج.م`
                     : `Thank you for using Captain Ezz. Amount due: ${activeTrip.fare} EGP`}
                 </p>
                 {onTripCompleted && (
                   <button
                     type="button"
                     onClick={onTripCompleted}
                     className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs rounded-xl shadow-md transition-all cursor-pointer pointer-events-auto"
                   >
                     {lang === 'ar' ? '🏠 العودة للصفحة الرئيسية' : '🏠 Return to Home'}
                   </button>
                 )}
               </div>
             )}

            {/* Favorite Modal Popup */}
            {showFavModal && (
              <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 z-[9999]">
                <div className="bg-white rounded-2xl w-full max-w-sm p-5 text-right space-y-3 shadow-xl">
                  <h3 className="text-xs font-black text-slate-800">
                    ⭐ {lang === 'ar' ? 'حفظ المكان كـ مكان مميز' : 'Save Place as Favorite'}
                  </h3>
                  <p className="text-[10px] text-slate-500">
                    {lang === 'ar'
                      ? 'اكتب اسماً مخصصاً لهذا المكان ليسهل عليك اختياره لاحقاً (مثال: منزلي، العمل، الجامعة)'
                      : 'Add a custom name for this place (e.g., Home, Work)'}
                  </p>
                  <input
                    type="text"
                    value={favNameInput}
                    onChange={(e) => setFavNameInput(e.target.value)}
                    placeholder={lang === 'ar' ? 'منزلي، العمل، بيت جدتي...' : 'My Home, Work...'}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl py-2 px-3 text-xs font-semibold text-slate-800 focus:outline-none focus:border-indigo-500 pointer-events-auto"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleSaveFavorite(showFavModal)}
                      className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] rounded-lg cursor-pointer pointer-events-auto"
                    >
                      {lang === 'ar' ? 'حفظ الآن' : 'Save Now'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowFavModal(null)}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-[11px] rounded-lg cursor-pointer pointer-events-auto"
                    >
                      {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
