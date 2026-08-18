import React, { useState, useEffect } from 'react';
import { Driver, Trip, SystemStats, Location, Rider, PromoCode, Region, RegionPricing, Ad } from '../types';
import { DollarSign, ShieldAlert, Award, TrendingUp, Settings, Percent, CheckCircle, Star, Users, MapPin, Database, Sparkles, Search, AlertCircle, HelpCircle, Globe, Loader2, Calendar, Clock, BarChart2, Car, Map, Trash2, Plus, Megaphone, Phone, Eye, EyeOff } from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, AreaChart, Area, PieChart, Pie, Cell } from 'recharts';
import { fetchTripsHistoryFilteredPaginated, fetchTripsHistoryCount, fetchAllTrips, generatePromoCode, fetchPromoCodes, deletePromoCode, fetchRegions, saveRegion, deleteRegionInDB, fetchAds, saveAd, deleteAd, loadSession, getDeviceId } from '../supabaseService';
import { PRIVACY_POLICY, TERMS_OF_SERVICE, DATA_RETENTION_POLICY } from '../utils/legal';
import { exportBackup, importBackup } from '../utils/backup';
import { AVAILABLE_CITIES } from '../constants';

interface AdminViewProps {
  stats: SystemStats;
  drivers: Driver[];
  locations: Location[];
  regions: Region[];
  riders: Rider[];
  visitorCount: number;
  liveTrips: Trip[];
  totalUsers: number;
  adminUserId?: string;
  onUpdateCommissionRate: (rate: number) => void;
  onUpdatePricingStats: (updated: Partial<SystemStats>) => void;
  onSavePricingStats: (stats: SystemStats) => void;
  onSettleDriverCommissions: (driverId: string) => Promise<void>;
  onUpdateLocations: (newLocs: Location[]) => void;
  onUpdateRegions: (newRegions: Region[]) => void;
  onApproveDriver: (driverId: string) => void;
  onRejectDriver: (driverId: string) => void;
  onFreezeDriver: (driverId: string) => void;
  onUnfreezeDriver: (driverId: string) => void;
  onDeleteDriver: (driverId: string) => void;
  onUpdateDriverServiceAreas?: (driverId: string, cities: string[]) => void;
  onFreezeRider: (riderId: string) => void;
  onUnfreezeRider: (riderId: string) => void;
  onBlockRider: (riderId: string) => void;
  onUnblockRider: (riderId: string) => void;
  onDeleteRider: (riderId: string) => void;
  onClearAllFakeData: () => void;
  onAdminForceCancelTrip?: (tripId: string) => void;
  onAdminForceEndTrip?: (tripId: string) => void;
  lang: 'ar' | 'en';
  onLogout: () => void;
  onTriggerToast?: (title: string, message: string, type?: 'info' | 'success' | 'warning' | 'new_trip') => void;
}
export const AdminView: React.FC<AdminViewProps> = ({
  stats,
  drivers,
  locations,
  regions,
  riders,
  visitorCount,
  liveTrips,
  totalUsers,
  onUpdateCommissionRate,
  onUpdatePricingStats,
  onSavePricingStats,
  onSettleDriverCommissions,
  onUpdateLocations,
  onUpdateRegions,
  onApproveDriver,
  onRejectDriver,
  onFreezeDriver,
  onUnfreezeDriver,
  onDeleteDriver,
  onUpdateDriverServiceAreas,
  onFreezeRider,
  onUnfreezeRider,
  onBlockRider,
  onUnblockRider,
  onDeleteRider,
  onClearAllFakeData,
  onAdminForceCancelTrip,
  onAdminForceEndTrip,
  adminUserId: propAdminUserId,
  lang,
  onLogout,
  onTriggerToast,
}) => {
  const triggerToast = (title: string, message: string, type: 'info' | 'success' | 'warning' | 'new_trip' = 'info') => {
    if (onTriggerToast) {
      onTriggerToast(title, message, type);
    }
  };

  const getLocationName = (location: Location, language: 'ar' | 'en') => {
    const ar = location?.nameAr || '';
    const en = location?.nameEn || '';
    if (language === 'ar') return ar || en || 'موقع غير معروف';
    return en || ar || 'Unknown location';
  };

  const [activeTab, setActiveTab] = useState<'overview' | 'drivers' | 'riders' | 'history' | 'analytics' | 'legal' | 'regions' | 'ads'>('overview');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [adminUserId, setAdminUserId] = useState<string>(propAdminUserId || '');

  useEffect(() => {
    if (propAdminUserId) {
      setAdminUserId(propAdminUserId);
      return;
    }
    loadSession().then(session => {
      if (session?.role === 'ADMIN' && session.userId) {
        setAdminUserId(session.userId);
      }
    });
  }, [propAdminUserId]);

  const [pricingForm, setPricingForm] = useState({
    distanceBuffer: stats.distanceBuffer ?? 1.25,
    additionalKm: stats.additionalKm ?? 0.0,
    supportWhatsApp: stats.supportWhatsApp || '201015555555',
    carBaseFare: stats.carBaseFare ?? 20,
    carMinFare: stats.carMinFare ?? 2,
    carPricePerKm0to20: stats.carPricePerKm ?? 8,
    carPricePerKm20to50: stats.carPricePerKm20to50 ?? 8,
    carPricePerKm50plus: stats.carPricePerKm50plus ?? 8,
    motorcycleBaseFare: stats.motorcycleBaseFare ?? 12,
    motorcycleMinFare: stats.motorcycleMinFare ?? 2,
    motorcyclePricePerKm0to20: stats.motorcyclePricePerKm ?? 5,
    motorcyclePricePerKm20to50: stats.motorcyclePricePerKm20to50 ?? 5,
    motorcyclePricePerKm50plus: stats.motorcyclePricePerKm50plus ?? 5,
    toktokBaseFare: stats.toktokBaseFare ?? 10,
    toktokMinFare: stats.toktokMinFare ?? 2,
    toktokPricePerKm0to20: stats.toktokPricePerKm ?? 4,
    toktokPricePerKm20to50: stats.toktokPricePerKm20to50 ?? 4,
    toktokPricePerKm50plus: stats.toktokPricePerKm50plus ?? 4,
    tricycleBaseFare: stats.tricycleBaseFare ?? 10,
    tricycleMinFare: stats.tricycleMinFare ?? 2,
    tricyclePricePerKm0to20: stats.tricyclePricePerKm ?? 4,
    tricyclePricePerKm20to50: stats.tricyclePricePerKm20to50 ?? 4,
    tricyclePricePerKm50plus: stats.tricyclePricePerKm50plus ?? 4,
    commissionMode: stats.commissionMode || 'fixed',
    incomingCommission: stats.incomingCommission ?? 5,
    outgoingCommission: stats.outgoingCommission ?? 5,
    incomingCommissionPercent: stats.incomingCommissionPercent ?? 10,
    outgoingCommissionPercent: stats.outgoingCommissionPercent ?? 10,
    mapProvider: stats.mapProvider || 'leaflet',
    googleMapsApiKey: stats.googleMapsApiKey || '',
  });

  // Scope for pricing settings: 'global' or a specific region ID
  const [selectedPricingScope, setSelectedPricingScope] = useState<'global' | string>('global');
  const [regionCustomPricingEnabled, setRegionCustomPricingEnabled] = useState<boolean>(false);

  // Track whether the user has edited the form. While editing, the form is the
  // single source of truth and we must NOT overwrite it with `stats` (which can
  // change from the 30s sync loop or the post-save re-fetch and would revert the
  // user's edits back to stale/default values). We only re-sync from `stats` when
  // the form is clean — e.g. right after a successful save confirms server values.
  const [pricingDirty, setPricingDirty] = useState(false);

  useEffect(() => {
    if (pricingDirty) return; // don't clobber the user's in-progress edits

    if (selectedPricingScope === 'global') {
      setRegionCustomPricingEnabled(false);
      setPricingForm({
        distanceBuffer: stats.distanceBuffer ?? 1.25,
        additionalKm: stats.additionalKm ?? 0.0,
        supportWhatsApp: stats.supportWhatsApp || '201015555555',
        carBaseFare: stats.carBaseFare ?? 20,
        carMinFare: stats.carMinFare ?? 2,
        carPricePerKm0to20: stats.carPricePerKm ?? 8,
        carPricePerKm20to50: stats.carPricePerKm20to50 ?? 8,
        carPricePerKm50plus: stats.carPricePerKm50plus ?? 8,
        motorcycleBaseFare: stats.motorcycleBaseFare ?? 12,
        motorcycleMinFare: stats.motorcycleMinFare ?? 2,
        motorcyclePricePerKm0to20: stats.motorcyclePricePerKm ?? 5,
        motorcyclePricePerKm20to50: stats.motorcyclePricePerKm20to50 ?? 5,
        motorcyclePricePerKm50plus: stats.motorcyclePricePerKm50plus ?? 5,
        toktokBaseFare: stats.toktokBaseFare ?? 10,
        toktokMinFare: stats.toktokMinFare ?? 2,
        toktokPricePerKm0to20: stats.toktokPricePerKm ?? 4,
        toktokPricePerKm20to50: stats.toktokPricePerKm20to50 ?? 4,
        toktokPricePerKm50plus: stats.toktokPricePerKm50plus ?? 4,
        tricycleBaseFare: stats.tricycleBaseFare ?? 10,
        tricycleMinFare: stats.tricycleMinFare ?? 2,
        tricyclePricePerKm0to20: stats.tricyclePricePerKm ?? 4,
        tricyclePricePerKm20to50: stats.tricyclePricePerKm20to50 ?? 4,
        tricyclePricePerKm50plus: stats.tricyclePricePerKm50plus ?? 4,
        commissionMode: stats.commissionMode || 'fixed',
        incomingCommission: stats.incomingCommission ?? 5,
        outgoingCommission: stats.outgoingCommission ?? 5,
        incomingCommissionPercent: stats.incomingCommissionPercent ?? 10,
        outgoingCommissionPercent: stats.outgoingCommissionPercent ?? 10,
        mapProvider: stats.mapProvider || 'leaflet',
        googleMapsApiKey: stats.googleMapsApiKey || '',
      });
    } else {
      const targetRegion = regions.find((r) => r.id === selectedPricingScope);
      const customP = targetRegion?.pricing;
      const isCustom = !!customP?.customPricingEnabled;
      setRegionCustomPricingEnabled(isCustom);

      setPricingForm({
        distanceBuffer: customP?.distanceBuffer ?? stats.distanceBuffer ?? 1.25,
        additionalKm: customP?.additionalKm ?? stats.additionalKm ?? 0.0,
        supportWhatsApp: stats.supportWhatsApp || '201015555555',
        carBaseFare: customP?.carBaseFare ?? stats.carBaseFare ?? 20,
        carMinFare: customP?.carMinFare ?? stats.carMinFare ?? 2,
        carPricePerKm0to20: customP?.carPricePerKm0to20 ?? stats.carPricePerKm ?? 8,
        carPricePerKm20to50: customP?.carPricePerKm20to50 ?? stats.carPricePerKm20to50 ?? 8,
        carPricePerKm50plus: customP?.carPricePerKm50plus ?? stats.carPricePerKm50plus ?? 8,
        motorcycleBaseFare: customP?.motorcycleBaseFare ?? stats.motorcycleBaseFare ?? 12,
        motorcycleMinFare: customP?.motorcycleMinFare ?? stats.motorcycleMinFare ?? 2,
        motorcyclePricePerKm0to20: customP?.motorcyclePricePerKm0to20 ?? stats.motorcyclePricePerKm ?? 5,
        motorcyclePricePerKm20to50: customP?.motorcyclePricePerKm20to50 ?? stats.motorcyclePricePerKm20to50 ?? 5,
        motorcyclePricePerKm50plus: customP?.motorcyclePricePerKm50plus ?? stats.motorcyclePricePerKm50plus ?? 5,
        toktokBaseFare: customP?.toktokBaseFare ?? stats.toktokBaseFare ?? 10,
        toktokMinFare: customP?.toktokMinFare ?? stats.toktokMinFare ?? 2,
        toktokPricePerKm0to20: customP?.toktokPricePerKm0to20 ?? stats.toktokPricePerKm ?? 4,
        toktokPricePerKm20to50: customP?.toktokPricePerKm20to50 ?? stats.toktokPricePerKm20to50 ?? 4,
        toktokPricePerKm50plus: customP?.toktokPricePerKm50plus ?? stats.toktokPricePerKm50plus ?? 4,
        tricycleBaseFare: customP?.tricycleBaseFare ?? stats.tricycleBaseFare ?? 10,
        tricycleMinFare: customP?.tricycleMinFare ?? stats.tricycleMinFare ?? 2,
        tricyclePricePerKm0to20: customP?.tricyclePricePerKm0to20 ?? stats.tricyclePricePerKm ?? 4,
        tricyclePricePerKm20to50: customP?.tricyclePricePerKm20to50 ?? stats.tricyclePricePerKm20to50 ?? 4,
        tricyclePricePerKm50plus: customP?.tricyclePricePerKm50plus ?? stats.tricyclePricePerKm50plus ?? 4,
        commissionMode: customP?.commissionMode ?? stats.commissionMode ?? 'fixed',
        incomingCommission: customP?.incomingCommission ?? stats.incomingCommission ?? 5,
        outgoingCommission: customP?.outgoingCommission ?? stats.outgoingCommission ?? 5,
        incomingCommissionPercent: customP?.incomingCommissionPercent ?? stats.incomingCommissionPercent ?? 10,
        outgoingCommissionPercent: customP?.outgoingCommissionPercent ?? stats.outgoingCommissionPercent ?? 10,
        mapProvider: stats.mapProvider || 'leaflet',
        googleMapsApiKey: stats.googleMapsApiKey || '',
      });
    }
  }, [stats, regions, selectedPricingScope, pricingDirty]);

  const handleSavePricing = async () => {
    if (selectedPricingScope === 'global') {
      onSavePricingStats({
        ...stats,
        distanceBuffer: pricingForm.distanceBuffer,
        additionalKm: pricingForm.additionalKm,
        supportWhatsApp: pricingForm.supportWhatsApp,
        carBaseFare: pricingForm.carBaseFare,
        carMinFare: pricingForm.carMinFare,
        carPricePerKm: pricingForm.carPricePerKm0to20,
        carPricePerKm20to50: pricingForm.carPricePerKm20to50,
        carPricePerKm50plus: pricingForm.carPricePerKm50plus,
        motorcycleBaseFare: pricingForm.motorcycleBaseFare,
        motorcycleMinFare: pricingForm.motorcycleMinFare,
        motorcyclePricePerKm: pricingForm.motorcyclePricePerKm0to20,
        motorcyclePricePerKm20to50: pricingForm.motorcyclePricePerKm20to50,
        motorcyclePricePerKm50plus: pricingForm.motorcyclePricePerKm50plus,
        toktokBaseFare: pricingForm.toktokBaseFare,
        toktokMinFare: pricingForm.toktokMinFare,
        toktokPricePerKm: pricingForm.toktokPricePerKm0to20,
        toktokPricePerKm20to50: pricingForm.toktokPricePerKm20to50,
        toktokPricePerKm50plus: pricingForm.toktokPricePerKm50plus,
        tricycleBaseFare: pricingForm.tricycleBaseFare,
        tricycleMinFare: pricingForm.tricycleMinFare,
        tricyclePricePerKm: pricingForm.tricyclePricePerKm0to20,
        tricyclePricePerKm20to50: pricingForm.tricyclePricePerKm20to50,
        tricyclePricePerKm50plus: pricingForm.tricyclePricePerKm50plus,
        commissionMode: pricingForm.commissionMode,
        incomingCommission: pricingForm.incomingCommission,
        outgoingCommission: pricingForm.outgoingCommission,
        incomingCommissionPercent: pricingForm.incomingCommissionPercent,
        outgoingCommissionPercent: pricingForm.outgoingCommissionPercent,
        mapProvider: pricingForm.mapProvider,
        googleMapsApiKey: pricingForm.googleMapsApiKey,
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setPricingDirty(false);
      triggerToast(
        lang === 'ar' ? 'تم الحفظ' : 'Saved',
        lang === 'ar' ? 'تم حفظ إعدادات التسعيرة العامة بنجاح' : 'Global pricing settings saved successfully',
        'success'
      );
    } else {
      const targetRegion = regions.find((r) => r.id === selectedPricingScope);
      if (!targetRegion) return;

      const updatedPricing: RegionPricing = {
        customPricingEnabled: regionCustomPricingEnabled,
        distanceBuffer: pricingForm.distanceBuffer,
        additionalKm: pricingForm.additionalKm,
        carBaseFare: pricingForm.carBaseFare,
        carMinFare: pricingForm.carMinFare,
        carPricePerKm0to20: pricingForm.carPricePerKm0to20,
        carPricePerKm20to50: pricingForm.carPricePerKm20to50,
        carPricePerKm50plus: pricingForm.carPricePerKm50plus,
        motorcycleBaseFare: pricingForm.motorcycleBaseFare,
        motorcycleMinFare: pricingForm.motorcycleMinFare,
        motorcyclePricePerKm0to20: pricingForm.motorcyclePricePerKm0to20,
        motorcyclePricePerKm20to50: pricingForm.motorcyclePricePerKm20to50,
        motorcyclePricePerKm50plus: pricingForm.motorcyclePricePerKm50plus,
        toktokBaseFare: pricingForm.toktokBaseFare,
        toktokMinFare: pricingForm.toktokMinFare,
        toktokPricePerKm0to20: pricingForm.toktokPricePerKm0to20,
        toktokPricePerKm20to50: pricingForm.toktokPricePerKm20to50,
        toktokPricePerKm50plus: pricingForm.toktokPricePerKm50plus,
        tricycleBaseFare: pricingForm.tricycleBaseFare,
        tricycleMinFare: pricingForm.tricycleMinFare,
        tricyclePricePerKm0to20: pricingForm.tricyclePricePerKm0to20,
        tricyclePricePerKm20to50: pricingForm.tricyclePricePerKm20to50,
        tricyclePricePerKm50plus: pricingForm.tricyclePricePerKm50plus,
        commissionMode: pricingForm.commissionMode,
        incomingCommission: pricingForm.incomingCommission,
        outgoingCommission: pricingForm.outgoingCommission,
        incomingCommissionPercent: pricingForm.incomingCommissionPercent,
        outgoingCommissionPercent: pricingForm.outgoingCommissionPercent,
      };

      const updatedRegion: Region = {
        ...targetRegion,
        pricing: updatedPricing,
      };

      const updatedList = regions.map((r) => (r.id === targetRegion.id ? updatedRegion : r));
      onUpdateRegions(updatedList);
      const savedToDb = await saveRegion(updatedRegion);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      setPricingDirty(false);
      if (savedToDb) {
        triggerToast(
          lang === 'ar' ? 'تم الحفظ في السحابة ☁️' : 'Saved to Cloud',
          lang === 'ar'
            ? `تم حفظ تسعيرة وعمولة منطقة "${targetRegion.nameAr}" في قاعدة بيانات Supabase بنجاح`
            : `Pricing and commission for region "${targetRegion.nameAr}" saved to Supabase cloud successfully`,
          'success'
        );
      } else {
        triggerToast(
          lang === 'ar' ? 'تم الحفظ محلياً 💾' : 'Saved Locally',
          lang === 'ar'
            ? `تم حفظ تسعيرة منطقة "${targetRegion.nameAr}" على جهازك. لحفظها سحابياً في Supabase، يرجى تشغيل كود إنشاء جدول ezz_regions من الـ SQL Editor`
            : `Pricing saved locally. To save in Supabase, ensure ezz_regions table exists in Supabase.`,
          'warning'
        );
      }
    }
  };

  const handleCopyGlobalToRegion = () => {
    setPricingForm({
      distanceBuffer: stats.distanceBuffer ?? 1.25,
      additionalKm: stats.additionalKm ?? 0.0,
      supportWhatsApp: stats.supportWhatsApp || '201015555555',
      carBaseFare: stats.carBaseFare ?? 20,
      carMinFare: stats.carMinFare ?? 2,
      carPricePerKm0to20: stats.carPricePerKm ?? 8,
      carPricePerKm20to50: stats.carPricePerKm20to50 ?? 8,
      carPricePerKm50plus: stats.carPricePerKm50plus ?? 8,
      motorcycleBaseFare: stats.motorcycleBaseFare ?? 12,
      motorcycleMinFare: stats.motorcycleMinFare ?? 2,
      motorcyclePricePerKm0to20: stats.motorcyclePricePerKm ?? 5,
      motorcyclePricePerKm20to50: stats.motorcyclePricePerKm20to50 ?? 5,
      motorcyclePricePerKm50plus: stats.motorcyclePricePerKm50plus ?? 5,
      toktokBaseFare: stats.toktokBaseFare ?? 10,
      toktokMinFare: stats.toktokMinFare ?? 2,
      toktokPricePerKm0to20: stats.toktokPricePerKm ?? 4,
      toktokPricePerKm20to50: stats.toktokPricePerKm20to50 ?? 4,
      toktokPricePerKm50plus: stats.toktokPricePerKm50plus ?? 4,
      tricycleBaseFare: stats.tricycleBaseFare ?? 10,
      tricycleMinFare: stats.tricycleMinFare ?? 2,
      tricyclePricePerKm0to20: stats.tricyclePricePerKm ?? 4,
      tricyclePricePerKm20to50: stats.tricyclePricePerKm20to50 ?? 4,
      tricyclePricePerKm50plus: stats.tricyclePricePerKm50plus ?? 4,
      commissionMode: stats.commissionMode || 'fixed',
      incomingCommission: stats.incomingCommission ?? 5,
      outgoingCommission: stats.outgoingCommission ?? 5,
      incomingCommissionPercent: stats.incomingCommissionPercent ?? 10,
      outgoingCommissionPercent: stats.outgoingCommissionPercent ?? 10,
      mapProvider: stats.mapProvider || 'leaflet',
      googleMapsApiKey: stats.googleMapsApiKey || '',
    });
    setRegionCustomPricingEnabled(true);
    setPricingDirty(true);
    triggerToast(
      lang === 'ar' ? 'تم النسخ' : 'Copied',
      lang === 'ar' ? 'تم نسخ قيم التسعيرة العامة إلى هذه المنطقة' : 'Copied global pricing values to this region',
      'info'
    );
  };

  const handleResetRegionPricingToDefault = async () => {
    const targetRegion = regions.find((r) => r.id === selectedPricingScope);
    if (!targetRegion) return;
    setRegionCustomPricingEnabled(false);
    const updatedRegion: Region = {
      ...targetRegion,
      pricing: {
        ...(targetRegion.pricing || {}),
        customPricingEnabled: false,
      },
    };
    const updatedList = regions.map((r) => (r.id === targetRegion.id ? updatedRegion : r));
    onUpdateRegions(updatedList);
    await saveRegion(updatedRegion);
    setPricingDirty(false);
    triggerToast(
      lang === 'ar' ? 'تمت الاستعادة' : 'Reset',
      lang === 'ar'
        ? `تم إعادة ضبط منطقة "${targetRegion.nameAr}" لاستخدام التسعيرة العامة الافتراضية`
        : `Region "${targetRegion.nameAr}" reverted to default pricing`,
      'info'
    );
  };

  const updatePricingField = (field: string, value: number | string) => {
    setPricingForm(prev => ({ ...prev, [field]: value }));
    setPricingDirty(true);
  };

  const handleGeneratePromoCode = async () => {
    const code = await generatePromoCode(promoDiscount, selectedRiderForPromo || undefined, undefined, promoUsageLimit === '' ? null : Number(promoUsageLimit));
    if (code) {
      setPromoCodes(prev => [code, ...prev]);
      setPromoUsageLimit('');
      triggerToast(lang === 'ar' ? 'تم توليد الكود الترويجي بنجاح' : 'Promo code generated successfully', 'success');
    } else {
      triggerToast(lang === 'ar' ? 'فشل توليد الكود' : 'Failed to generate promo code', 'error');
    }
  };

  const handleDeletePromoCode = async (promoCodeId: string) => {
    const success = await deletePromoCode(promoCodeId);
    if (success) {
      setPromoCodes(prev => prev.filter(c => c.id !== promoCodeId));
      triggerToast(lang === 'ar' ? 'تم حذف الكود الترويجي' : 'Promo code deleted', 'success');
    } else {
      triggerToast(lang === 'ar' ? 'فشل حذف الكود' : 'Failed to delete promo code', 'error');
    }
  };

  const loadPromoCodes = async () => {
    const codes = await fetchPromoCodes();
    setPromoCodes(codes);
  };

  useEffect(() => {
    loadPromoCodes();
  }, []);

  const [tripDateFrom, setTripDateFrom] = useState('');
  const [tripDateTo, setTripDateTo] = useState('');
  const [adminTripsPage, setAdminTripsPage] = useState(0);
  const [adminTripsHasMore, setAdminTripsHasMore] = useState(false);
  const [isLoadingTrips, setIsLoadingTrips] = useState(false);
  const [adminTrips, setAdminTrips] = useState<Trip[]>([]);
  const [allTrips, setAllTrips] = useState<Trip[]>([]);
  const [isLoadingAllTrips, setIsLoadingAllTrips] = useState(false);

  // Financial and operational aggregations calculated from real allTrips + driver ledgers + system stats
  const completedTripsList = allTrips.filter(t => t.status === 'COMPLETED');
  const completedCount = completedTripsList.length;
  const cancelledCount = allTrips.filter(t => t.status === 'CANCELLED').length;
  const totalRides = allTrips.length || drivers.reduce((acc, d) => acc + (Number(d.totalTrips) || 0), 0) || stats.totalCompletedTrips || 0;
  const successRate = totalRides > 0 ? Math.round((completedCount / totalRides) * 100) : (totalRides > 0 ? 100 : 0);
  const cancelRate = totalRides > 0 ? Math.round((cancelledCount / totalRides) * 100) : 0;

  // Real-time aggregations from trips with fallbacks to drivers totals and stats
  const tripsTotalRevenue = completedTripsList.reduce((acc, t) => acc + (Number(t.fare) || 0), 0);
  const tripsTotalCommission = completedTripsList.reduce((acc, t) => acc + (Number(t.commission) || 0), 0);
  const driversTotalCommission = drivers.reduce((acc, d) => acc + (Number(d.totalCommissionPaid) || 0), 0);
  const driversTotalEarnings = drivers.reduce((acc, d) => acc + (Number(d.totalEarnings) || 0), 0);

  const displayTotalRevenue = tripsTotalRevenue > 0
    ? Math.round(tripsTotalRevenue)
    : (stats.totalRevenue && stats.totalRevenue > 0)
    ? Math.round(stats.totalRevenue)
    : Math.round(driversTotalEarnings + driversTotalCommission);

  const displayTotalCommission = tripsTotalCommission > 0
    ? Math.round(tripsTotalCommission)
    : (stats.totalCommission && stats.totalCommission > 0)
    ? Math.round(stats.totalCommission)
    : Math.round(driversTotalCommission);

  const displayDriverEarnings = Math.max(0, displayTotalRevenue - displayTotalCommission);

  const onlineDrivers = drivers.filter(d => d.isOnline).length;
  const approvedDrivers = drivers.filter(d => d.approvalStatus === 'APPROVED').length;
  const offlineDrivers = drivers.filter(d => !d.isOnline).length;
  const availableDrivers = drivers.filter(d => d.approvalStatus === 'APPROVED' && d.isOnline && d.status === 'AVAILABLE').length;
  const registeredRidersCount = riders.length;
  const [driverSearchQuery, setDriverSearchQuery] = useState('');
  const [driverStatusFilter, setDriverStatusFilter] = useState<'all' | 'ACTIVE' | 'FROZEN' | 'REJECTED'>('all');
  const [driverPeriodFilter, setDriverPeriodFilter] = useState<'all' | 'week' | 'month' | '30days'>('all');
  const [riderSearchQuery, setRiderSearchQuery] = useState('');
  const [riderStatusFilter, setRiderStatusFilter] = useState<'all' | 'ACTIVE' | 'FROZEN' | 'BLOCKED' | 'REJECTED'>('all');
  const [riderPeriodFilter, setRiderPeriodFilter] = useState<'all' | 'week' | 'month' | '30days'>('all');
  const [selectedRiderForDetails, setSelectedRiderForDetails] = useState<Rider | null>(null);
  const [promoDiscount, setPromoDiscount] = useState(5);
  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [selectedRiderForPromo, setSelectedRiderForPromo] = useState('');
  const [promoUsageLimit, setPromoUsageLimit] = useState<number | ''>('');
  const [tripHistorySearchQuery, setTripHistorySearchQuery] = useState('');
  const [tripHistoryStatusFilter, setTripHistoryStatusFilter] = useState<'all' | 'COMPLETED' | 'CANCELLED' | 'ACTIVE'>('all');
  const [expandedTripId, setExpandedTripId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCountryFilter, setSelectedCountryFilter] = useState<'all' | 'مصر' | 'المملكة العربية السعودية'>('all');
  const [selectedPreviewPhoto, setSelectedPreviewPhoto] = useState<{ src: string; title: string } | null>(null);

  // Regions management state
  const [newRegionNameAr, setNewRegionNameAr] = useState('');
  const [newRegionNameEn, setNewRegionNameEn] = useState('');
  const [newRegionCountry, setNewRegionCountry] = useState('مصر');
  const [regionNameError, setRegionNameError] = useState('');

  // Ads management state
  const [ads, setAds] = useState<Ad[]>([]);
  const [adFilterQuery, setAdFilterQuery] = useState('');
  const [adFilterStatus, setAdFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [adFilterPlacement, setAdFilterPlacement] = useState<'all' | 'home' | 'waiting'>('all');
  const [adSortBy, setAdSortBy] = useState<'newest' | 'views' | 'interactions' | 'revenue'>('newest');
  const [selectedAdId, setSelectedAdId] = useState<string | 'all'>('all');
  const [adImageError, setAdImageError] = useState<Record<string, boolean>>({});
  const [adForm, setAdForm] = useState({
    storeName: '',
    offerText: '',
    imageUrl: '',
    phoneNumber: '',
    whatsapp: '',
    placement: 'all' as Ad['placement'],
    priority: 1,
    isActive: true,
    startDate: '',
    endDate: '',
    adFee: 0,
    dailyImpressionLimit: 0,
    regionId: '',
  });
  const [editingAdId, setEditingAdId] = useState<string | null>(null);
  const [adError, setAdError] = useState('');

  const handleAdImageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 400;
        const scaleSize = MAX_WIDTH / img.width;
        if (scaleSize < 1) {
          canvas.width = MAX_WIDTH;
          canvas.height = img.height * scaleSize;
        } else {
          canvas.width = img.width;
          canvas.height = img.height;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.65);
          setAdForm((prev) => ({ ...prev, imageUrl: compressedDataUrl }));
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    if (activeTab !== 'ads') return;
    fetchAds().then(setAds);
  }, [activeTab]);

  // Date formatting helper for completed trips
  const formatTripDate = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      if (lang === 'ar') {
        return d.toLocaleDateString('ar-EG', {
          weekday: 'long',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
      } else {
        return d.toLocaleDateString('en-US', {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
      }
    } catch (e) {
      return dateStr;
    }
  };

  // 1. Data Processor: Most Active Drivers
  const getActiveDriversData = () => {
    const statsObj: { [key: string]: { name: string; rides: number; revenue: number; commission: number } } = {};
    
    // Seed with driver profile records
    drivers.forEach(d => {
      statsObj[d.id] = {
        name: d.name,
        rides: Number(d.totalTrips) || 0,
        revenue: Number(d.totalEarnings) || 0,
        commission: Number(d.totalCommissionPaid) || 0,
      };
      statsObj[d.name] = statsObj[d.id];
    });

    const completedTrips = allTrips.filter(t => t.status === 'COMPLETED');
    if (completedTrips.length > 0) {
      // Overwrite/enrich with real trip details if trips exist
      const tripCountsById: { [key: string]: { rides: number; revenue: number; commission: number } } = {};
      const tripCountsByName: { [key: string]: { rides: number; revenue: number; commission: number } } = {};

      completedTrips.forEach(t => {
        const fare = Number(t.fare) || 0;
        const comm = Number(t.commission) || 0;
        const net = fare - comm;

        if (t.driverId) {
          if (!tripCountsById[t.driverId]) tripCountsById[t.driverId] = { rides: 0, revenue: 0, commission: 0 };
          tripCountsById[t.driverId].rides += 1;
          tripCountsById[t.driverId].revenue += net;
          tripCountsById[t.driverId].commission += comm;
        }

        const name = t.driverName || (lang === 'ar' ? 'كابتن مجهول' : 'Unknown Captain');
        if (!tripCountsByName[name]) tripCountsByName[name] = { rides: 0, revenue: 0, commission: 0 };
        tripCountsByName[name].rides += 1;
        tripCountsByName[name].revenue += net;
        tripCountsByName[name].commission += comm;
      });

      drivers.forEach(d => {
        const byId = tripCountsById[d.id];
        const byName = tripCountsByName[d.name];
        if (byId || byName) {
          const res = byId || byName;
          statsObj[d.id] = { name: d.name, rides: res.rides, revenue: res.revenue, commission: res.commission };
        }
      });
    }

    // De-duplicate by driver name / ID
    const uniqueDriversMap: { [key: string]: { name: string; rides: number; revenue: number; commission: number } } = {};
    drivers.forEach(d => {
      uniqueDriversMap[d.name] = statsObj[d.id] || statsObj[d.name] || {
        name: d.name,
        rides: Number(d.totalTrips) || 0,
        revenue: Number(d.totalEarnings) || 0,
        commission: Number(d.totalCommissionPaid) || 0,
      };
    });

    return Object.values(uniqueDriversMap).map(drv => ({
      name: drv.name,
      [lang === 'ar' ? 'الرحلات' : 'Rides']: drv.rides,
      [lang === 'ar' ? 'الأرباح' : 'Earnings']: Math.round(drv.revenue),
      [lang === 'ar' ? 'العمولات' : 'Commissions']: Math.round(drv.commission)
    })).sort((a, b) => {
      const valB = (b[lang === 'ar' ? 'الرحلات' : 'Rides'] as number) || 0;
      const valA = (a[lang === 'ar' ? 'الرحلات' : 'Rides'] as number) || 0;
      return valB - valA;
    });
  };

  // 2. Data Processor: Busiest Days
  const getBusiestDaysData = () => {
    const daysAr = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const daysEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekDays = lang === 'ar' ? daysAr : daysEn;

    const dayCounts: { [key: string]: number } = {};
    weekDays.forEach(day => {
      dayCounts[day] = 0;
    });

    allTrips.filter(t => t.status === 'COMPLETED').forEach(t => {
      const dateStr = t.completedAt || t.createdAt;
      if (!dateStr) return;
      const date = new Date(dateStr);
      const dayName = weekDays[date.getDay()];
      if (dayCounts[dayName] !== undefined) {
        dayCounts[dayName] += 1;
      }
    });

    const ordered = lang === 'ar'
      ? [weekDays[6], weekDays[0], weekDays[1], weekDays[2], weekDays[3], weekDays[4], weekDays[5]]
      : [weekDays[0], weekDays[1], weekDays[2], weekDays[3], weekDays[4], weekDays[5], weekDays[6]];

    return ordered.map(name => ({
      name,
      [lang === 'ar' ? 'عدد الرحلات' : 'Rides']: dayCounts[name] || 0
    }));
  };

  // 3. Data Processor: Trip Status Breakdown
  const getTripStatusData = () => {
    const statusCounts: { [key: string]: number } = {
      COMPLETED: 0,
      CANCELLED: 0,
      SEARCHING: 0,
      ACCEPTED: 0,
      ARRIVED: 0,
      STARTED: 0,
    };

    allTrips.forEach(t => {
      if (statusCounts[t.status] !== undefined) {
        statusCounts[t.status] += 1;
      }
    });

    const statusLabels: { [key: string]: string } = {
      COMPLETED: lang === 'ar' ? 'مكتملة' : 'Completed',
      CANCELLED: lang === 'ar' ? 'ملغية' : 'Cancelled',
      SEARCHING: lang === 'ar' ? 'بحث' : 'Searching',
      ACCEPTED: lang === 'ar' ? 'مقبولة' : 'Accepted',
      ARRIVED: lang === 'ar' ? 'وصل' : 'Arrived',
      STARTED: lang === 'ar' ? 'جارية' : 'Started',
    };

    const statusColors: { [key: string]: string } = {
      COMPLETED: '#10b981',
      CANCELLED: '#ef4444',
      SEARCHING: '#f59e0b',
      ACCEPTED: '#3b82f6',
      ARRIVED: '#8b5cf6',
      STARTED: '#06b6d4',
    };

    return Object.entries(statusCounts)
      .filter(([_, count]) => count > 0)
      .map(([status, count]) => ({
        name: statusLabels[status] || status,
        value: count,
        fill: statusColors[status] || '#64748b',
      }));
  };

  // 4. Data Processor: Driver Performance Metrics
  const getDriverPerformanceData = () => {
    return getActiveDriversData()
      .map(d => ({
        name: d.name,
        [lang === 'ar' ? 'رحلات' : 'Rides']: d[lang === 'ar' ? 'الرحلات' : 'Rides'] || 0,
        [lang === 'ar' ? 'أرباح' : 'Earnings']: d[lang === 'ar' ? 'الأرباح' : 'Earnings'] || 0,
        [lang === 'ar' ? 'عمولة' : 'Commission']: d[lang === 'ar' ? 'العمولات' : 'Commissions'] || 0,
      }))
      .sort((a, b) => (b[lang === 'ar' ? 'رحلات' : 'Rides'] as number) - (a[lang === 'ar' ? 'رحلات' : 'Rides'] as number))
      .slice(0, 10);
  };

  const getFilteredTripsForPeriod = (period: 'all' | 'week' | 'month' | '30days') => {
    if (period === 'all') return allTrips;
    const now = new Date();
    const from = new Date();
    if (period === 'week') {
      from.setDate(now.getDate() - 7);
    } else if (period === 'month') {
      from.setMonth(now.getMonth() - 1);
    } else if (period === '30days') {
      from.setDate(now.getDate() - 30);
    }
    return allTrips.filter(t => {
      const dateStr = t.completedAt || t.createdAt;
      if (!dateStr) return false;
      const tripDate = new Date(dateStr);
      return tripDate >= from && tripDate <= now;
    });
  };

  const getDriverStatsForPeriod = (period: 'all' | 'week' | 'month' | '30days') => {
    const trips = getFilteredTripsForPeriod(period);
    const statsObj: { [key: string]: { trips: number; earnings: number; commission: number } } = {};
    
    // Seed with existing drivers to guarantee lookup keys for both driver.id and driver.name
    drivers.forEach(d => {
      if (period === 'all') {
        const dTrips = Number(d.totalTrips) || 0;
        const dEarn = Number(d.totalEarnings) || 0;
        const dComm = Number(d.totalCommissionPaid) || 0;
        statsObj[d.id] = { trips: dTrips, earnings: dEarn, commission: dComm };
        statsObj[d.name] = { trips: dTrips, earnings: dEarn, commission: dComm };
      } else {
        statsObj[d.id] = { trips: 0, earnings: 0, commission: 0 };
        statsObj[d.name] = { trips: 0, earnings: 0, commission: 0 };
      }
    });

    // If trips are present, calculate precise aggregates from the trip records
    if (trips.length > 0) {
      const tripStatsById: { [key: string]: { trips: number; earnings: number; commission: number } } = {};
      const tripStatsByName: { [key: string]: { trips: number; earnings: number; commission: number } } = {};

      trips.forEach(t => {
        const fare = Number(t.fare) || 0;
        const comm = Number(t.commission) || 0;
        const driverNet = fare - comm;

        if (t.driverId) {
          if (!tripStatsById[t.driverId]) tripStatsById[t.driverId] = { trips: 0, earnings: 0, commission: 0 };
          tripStatsById[t.driverId].trips += 1;
          tripStatsById[t.driverId].earnings += driverNet;
          tripStatsById[t.driverId].commission += comm;
        }

        const name = t.driverName || (lang === 'ar' ? 'كابتن مجهول' : 'Unknown');
        if (!tripStatsByName[name]) tripStatsByName[name] = { trips: 0, earnings: 0, commission: 0 };
        tripStatsByName[name].trips += 1;
        tripStatsByName[name].earnings += driverNet;
        tripStatsByName[name].commission += comm;
      });

      // Merge trip calculations into lookup maps
      drivers.forEach(d => {
        const byId = tripStatsById[d.id];
        const byName = tripStatsByName[d.name];
        const merged = byId || byName || (period === 'all' ? {
          trips: Number(d.totalTrips) || 0,
          earnings: Number(d.totalEarnings) || 0,
          commission: Number(d.totalCommissionPaid) || 0,
        } : { trips: 0, earnings: 0, commission: 0 });

        statsObj[d.id] = merged;
        statsObj[d.name] = merged;
      });

      // Also copy all byName stats for loose lookups
      Object.keys(tripStatsByName).forEach(name => {
        if (!statsObj[name]) {
          statsObj[name] = tripStatsByName[name];
        }
      });
    }

    return statsObj;
  };

  const getRiderStatsForPeriod = (period: 'all' | 'week' | 'month' | '30days') => {
    const trips = getFilteredTripsForPeriod(period);
    const statsObj: { [key: string]: { trips: number; spent: number } } = {};
    
    // Seed with existing riders
    riders.forEach(r => {
      if (period === 'all' && (r.totalTrips || 0) > 0) {
        statsObj[r.id] = { trips: Number(r.totalTrips) || 0, spent: 0 };
        statsObj[r.name] = { trips: Number(r.totalTrips) || 0, spent: 0 };
      } else {
        statsObj[r.id] = { trips: 0, spent: 0 };
        statsObj[r.name] = { trips: 0, spent: 0 };
      }
    });

    trips.forEach(t => {
      const fare = Number(t.fare) || 0;
      if (t.riderId) {
        if (!statsObj[t.riderId]) statsObj[t.riderId] = { trips: 0, spent: 0 };
        statsObj[t.riderId].trips += 1;
        statsObj[t.riderId].spent += fare;
      }
      const name = t.riderName || (lang === 'ar' ? 'راكب مجهول' : 'Unknown');
      if (!statsObj[name]) statsObj[name] = { trips: 0, spent: 0 };
      statsObj[name].trips += 1;
      statsObj[name].spent += fare;
    });

    // Link by ID and name for riders
    riders.forEach(r => {
      const byId = statsObj[r.id];
      const byName = statsObj[r.name];
      const best = (byId && byId.trips > 0) ? byId : (byName || byId || { trips: 0, spent: 0 });
      statsObj[r.id] = best;
      statsObj[r.name] = best;
    });

    return statsObj;
  };

  const loadAdminTrips = async (reset = false) => {
    if (!adminUserId) return;
    const page = reset ? 0 : adminTripsPage;
    setIsLoadingTrips(true);
    try {
      const result = await fetchTripsHistoryFilteredPaginated({
        userId: adminUserId || undefined,
        role: 'admin',
        deviceId: getDeviceId(),
        dateFrom: tripDateFrom || undefined,
        dateTo: tripDateTo || undefined,
        statusFilter: tripHistoryStatusFilter,
        searchQuery: tripHistorySearchQuery,
        page,
        limit: 20,
      });
      if (reset) {
        setAdminTrips(result.trips);
        setAdminTripsPage(1);
      } else {
        setAdminTrips((prev) => [...prev, ...result.trips]);
        setAdminTripsPage((prev) => prev + 1);
      }
      setAdminTripsHasMore(result.hasMore);
    } catch (err) {
      console.warn('[AdminView] Failed to load trips:', err);
      triggerToast(
        lang === 'ar' ? 'خطأ' : 'Error',
        lang === 'ar' ? 'فشل تحميل سجل الرحلات. تحقق من اتصالك.' : 'Failed to load trip history. Check your connection.',
        'warning'
      );
    } finally {
      setIsLoadingTrips(false);
    }
  };

  useEffect(() => {
    loadAdminTrips(true);
  }, [tripDateFrom, tripDateTo, tripHistoryStatusFilter, tripHistorySearchQuery, adminUserId]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingAllTrips(true);
    fetchAllTrips(1000, adminUserId || undefined, getDeviceId()).then((trips) => {
      if (!cancelled) {
        setAllTrips(trips);
        setIsLoadingAllTrips(false);
      }
    }).catch(() => {
      if (!cancelled) setIsLoadingAllTrips(false);
    });
    return () => { cancelled = true; };
  }, [adminUserId]);

  // OpenStreetMap Nominatim Live Search State
  const [osmQuery, setOsmQuery] = useState('');
  const [osmResults, setOsmResults] = useState<any[]>([]);
  const [osmLoading, setOsmLoading] = useState(false);
  const [osmError, setOsmError] = useState('');
  const lastOsmSearchRef = React.useRef<{ query: string; time: number } | null>(null);
  const OSM_SEARCH_COOLDOWN = 3000;
  const osmSearchCacheRef = React.useRef<Record<string, any[]>>({});

  const handleSearchOSM = async () => {
    if (!osmQuery.trim()) return;
    const normalized = osmQuery.trim().toLowerCase();
    const cached = osmSearchCacheRef.current[normalized];
    if (cached) {
      setOsmResults(cached);
      return;
    }
    const now = Date.now();
    if (
      lastOsmSearchRef.current &&
      lastOsmSearchRef.current.query === normalized &&
      now - lastOsmSearchRef.current.time < OSM_SEARCH_COOLDOWN
    ) {
      return;
    }
    lastOsmSearchRef.current = { query: normalized, time: now };
    setOsmLoading(true);
    setOsmError('');
    setOsmResults([]);
    try {
      // Free Nominatim OpenStreetMap API call with a fallback check
      const res = await fetch(`/api/search?q=${encodeURIComponent(osmQuery)}`, {
        headers: {
          'Accept': 'application/json',
        }
      });
      if (!res.ok) throw new Error('OSM server error');
      const data = await res.json();
      
      if (data && data.length > 0) {
        const results = data.map((item: any, idx: number) => ({
          display_name: item.display_name,
          lat: parseFloat(item.lat),
          lon: parseFloat(item.lon),
          city: item.address?.city || item.address?.town || item.address?.village || item.address?.county || (lang === 'ar' ? 'قرية' : 'Village')
        }));
        osmSearchCacheRef.current[normalized] = results;
        setOsmResults(results);
      } else {
        generateOsmOfflineBackup();
      }
    } catch (e) {
      generateOsmOfflineBackup();
    } finally {
      setOsmLoading(false);
    }
  };

  const generateOsmOfflineBackup = () => {
    const query = osmQuery.trim();
    const mockOSMPoints = [
      { display_name: `${query} - الشارع الرئيسي، مصر`, lat: 29.6124 + (Math.random() - 0.5) * 0.05, lon: 31.2215 + (Math.random() - 0.5) * 0.05, city: 'الجيزة' },
      { display_name: `${query} - بجوار المسجد الكبير، مصر`, lat: 29.6205 + (Math.random() - 0.5) * 0.05, lon: 31.2541 + (Math.random() - 0.5) * 0.05, city: 'الجيزة' },
      { display_name: `${query} - موقف ميكروباصات القرية، مصر`, lat: 29.0664 + (Math.random() - 0.5) * 0.05, lon: 31.0782 + (Math.random() - 0.5) * 0.05, city: 'بني سويف' },
      { display_name: `${query} - الوحدة الصحية والجمعية، مصر`, lat: 29.5630 + (Math.random() - 0.5) * 0.05, lon: 31.2384 + (Math.random() - 0.5) * 0.05, city: 'الجيزة' },
    ];
    setOsmResults(mockOSMPoints);
  };

  const handleAddOsmResult = (item: any) => {
    const newLoc: Location = {
      id: `osm_${Date.now()}_${Math.round(Math.random() * 1000)}`,
      nameAr: item.display_name.split(',')[0].trim(),
      nameEn: item.display_name.split(',')[0].trim(),
      lat: item.lat,
      lng: item.lon,
      city: item.city || (lang === 'ar' ? 'منطقة مخصصة' : 'Custom Zone'),
      country: 'مصر',
      x: Math.round(20 + Math.random() * 50),
      y: Math.round(25 + Math.random() * 50),
    };
    onUpdateLocations([newLoc, ...locations]);
    setOsmResults(prev => prev.filter(r => r.display_name !== item.display_name));
  };

  // Filtered locations display (limit to 10 for render performance, with a counter)
  const filteredLocs = locations.filter((loc) => {
    const matchesSearch =
      loc.nameAr.toLowerCase().includes(searchQuery.toLowerCase()) ||
      loc.nameEn.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (loc.city && loc.city.toLowerCase().includes(searchQuery.toLowerCase()));
    
    if (selectedCountryFilter === 'all') return matchesSearch;
    return matchesSearch && loc.country === selectedCountryFilter;
  });

  const handleClearAllLocations = () => {
    if (confirm(lang === 'ar' ? 'هل أنت متأكد من مسح جميع النقاط الحالية؟' : 'Are you sure you want to clear all locations?')) {
      onUpdateLocations([]);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 text-slate-900 select-none">
      {/* Title block */}
      <div className="bg-slate-900 text-white p-4 rounded-t-2xl flex items-center justify-between shrink-0">
        <div>
          <h2 className="text-xs font-black text-amber-400 tracking-wider uppercase">
            {lang === 'ar' ? 'لوحة تحكم كابتن عز' : 'Ezz Admin Dashboard'}
          </h2>
          <p className="text-[10px] text-slate-300">
            {lang === 'ar' ? 'إدارة السائقين وتدفقات العمولات والأسعار والتحليلات' : 'Driver commissions, pricing parameters and database analytics'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onLogout}
            className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-extrabold rounded-lg pointer-events-auto transition-colors cursor-pointer"
          >
            {lang === 'ar' ? 'خروج 🚪' : 'Logout 🚪'}
          </button>
        </div>
      </div>

      {/* Modern Tabs Navigation Bar */}
      <div className="bg-white border-b border-slate-200 shrink-0 flex items-center overflow-x-auto scrollbar-none pointer-events-auto relative z-10 shadow-xs">
        {[
          { id: 'overview', labelAr: 'إعدادات الأسعار والعمولات', labelEn: 'Pricing & Commissions', icon: Settings },
          { id: 'regions', labelAr: 'إدارة المناطق', labelEn: 'Regions Management', icon: Map },
          { id: 'ads', labelAr: 'إعلانات المحلات', labelEn: 'Store Ads', icon: Megaphone },
          { id: 'drivers', labelAr: 'إدارة السائقين', labelEn: 'Captains Ledger', icon: Users },
          { id: 'riders', labelAr: 'إدارة الركاب والحسابات', labelEn: 'Riders & Accounts', icon: Users },
          { id: 'history', labelAr: 'سجل الرحلات الكاملة', labelEn: 'Full Trip History', icon: Clock },
          { id: 'analytics', labelAr: 'التحليلات والرسوم البيانية', labelEn: 'Analytics Insights', icon: BarChart2 },
          { id: 'legal', labelAr: 'الامتثال والخصوصية', labelEn: 'Privacy & Compliance', icon: ShieldAlert },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 border-b-2 text-[10.5px] font-black whitespace-nowrap transition-all cursor-pointer pointer-events-auto ${
                isActive
                  ? 'border-indigo-600 text-indigo-600 bg-indigo-50/20'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-600 animate-pulse' : 'text-slate-400'}`} />
              <span>{lang === 'ar' ? tab.labelAr : tab.labelEn}</span>
            </button>
          );
        })}
      </div>

      {/* Scrollable Tab-specific Contents Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        
        {/* TAB 1: REGIONS MANAGEMENT */}
        {activeTab === 'regions' && (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-1.5">
                  <Map className="w-4 h-4 text-indigo-600" />
                  <div>
                    <h3 className="text-xs font-black text-slate-800">
                      {lang === 'ar' ? 'إدارة المناطق الجغرافية' : 'Regions Management'}
                    </h3>
                    <p className="text-[9px] text-slate-400">
                      {lang === 'ar' ? 'أضف المناطق التي يختار منها الراكب نقطة الانطلاق والسائق مناطق التغطية' : 'Add regions for rider pickup selection and driver coverage areas'}
                    </p>
                  </div>
                </div>
                <span className="bg-indigo-100 text-indigo-700 text-[9px] font-black px-2 py-0.5 rounded-lg">
                  {regions.length} {lang === 'ar' ? 'منطقة' : 'regions'}
                </span>
              </div>

              {/* Add new region form */}
              <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 space-y-2">
                <p className="text-[10px] font-bold text-slate-700">
                  {lang === 'ar' ? '➕ إضافة منطقة جديدة' : '➕ Add New Region'}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 block mb-0.5">
                      {lang === 'ar' ? 'الاسم بالعربية' : 'Name (Arabic)'}
                    </label>
                    <input
                      type="text"
                      value={newRegionNameAr}
                      onChange={(e) => { setNewRegionNameAr(e.target.value); setRegionNameError(''); }}
                      placeholder={lang === 'ar' ? 'مثال: العياط' : 'e.g. El-Ayyat'}
                      className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[11px] font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 block mb-0.5">
                      {lang === 'ar' ? 'الاسم بالإنجليزية' : 'Name (English)'}
                    </label>
                    <input
                      type="text"
                      value={newRegionNameEn}
                      onChange={(e) => setNewRegionNameEn(e.target.value)}
                      placeholder={lang === 'ar' ? 'El-Ayyat' : 'El-Ayyat'}
                      className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[11px] font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-bold text-slate-500 block mb-0.5">
                      {lang === 'ar' ? 'الدولة' : 'Country'}
                    </label>
                    <div className="w-full bg-slate-100 border border-slate-200 rounded-lg p-1.5 text-[11px] font-semibold text-slate-600 flex items-center gap-1">
                      🇪🇬 {lang === 'ar' ? 'مصر' : 'Egypt'}
                    </div>
                  </div>
                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => {
                        if (!newRegionNameAr.trim() || !newRegionNameEn.trim()) {
                          setRegionNameError(lang === 'ar' ? 'يرجى كتابة اسم المنطقة بالعربية والإنجليزية' : 'Please enter region name in both languages');
                          return;
                        }
                        const regionNameForToast = newRegionNameAr.trim();
                        const newRegion: Region = {
                          id: `region_${Date.now()}`,
                          nameAr: newRegionNameAr.trim(),
                          nameEn: newRegionNameEn.trim(),
                          country: newRegionCountry,
                          lat: 29.6197,
                          lng: 31.2561,
                          createdAt: new Date().toISOString(),
                        };
                        const updated = [...regions, newRegion];
                        onUpdateRegions(updated);
                        saveRegion(newRegion);
                        setNewRegionNameAr('');
                        setNewRegionNameEn('');
                        setRegionNameError('');
                        triggerToast(
                          lang === 'ar' ? 'تمت الإضافة' : 'Added',
                          lang === 'ar' ? `تمت إضافة منطقة "${regionNameForToast}" بنجاح` : `Region "${regionNameForToast}" added successfully`,
                          'success'
                        );
                      }}
                      className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[10px] rounded-lg transition-colors cursor-pointer pointer-events-auto flex items-center justify-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      {lang === 'ar' ? 'إضافة' : 'Add Region'}
                    </button>
                  </div>
                </div>
                {regionNameError && (
                  <p className="text-[9px] text-rose-600 font-bold">{regionNameError}</p>
                )}
              </div>

              {/* Regions list */}

              {regions.length === 0 ? (
                <div className="text-center py-6 text-slate-400">
                  <Map className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-[10px] font-bold">
                    {lang === 'ar' ? 'لا توجد مناطق بعد. أضف المنطقة الأولى أعلاه.' : 'No regions yet. Add the first one above.'}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {regions.map((region) => (
                    <div key={region.id} className="bg-white border border-slate-100 rounded-xl p-3 flex items-center justify-between hover:border-indigo-200 transition-colors">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-black text-slate-800">{region.nameAr}</p>
                          <span className="text-[9px] text-slate-400 font-bold">({region.nameEn})</span>
                          {region.pricing?.customPricingEnabled ? (
                            <span className="text-[8px] bg-emerald-100 text-emerald-800 font-black px-1.5 py-0.5 rounded-full flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                              {lang === 'ar' ? 'تسعيرة مخصصة' : 'Custom Pricing'}
                            </span>
                          ) : (
                            <span className="text-[8px] bg-slate-100 text-slate-600 font-bold px-1.5 py-0.5 rounded-full">
                              {lang === 'ar' ? 'تسعيرة عامة' : 'Global Pricing'}
                            </span>
                          )}
                        </div>
                        {region.pricing?.customPricingEnabled && (
                          <div className="flex flex-wrap items-center gap-2 text-[8px] text-slate-500 font-bold">
                            <span>🚗 فتح العداد: {region.pricing.carBaseFare ?? 20} ج.م</span>
                            <span>•</span>
                            <span>الكيلو: {region.pricing.carPricePerKm0to20 ?? 8} ج.م</span>
                            <span>•</span>
                            <span>
                              العمولة: {region.pricing.commissionMode === 'percent'
                                ? `${region.pricing.incomingCommissionPercent ?? 10}%`
                                : `${region.pricing.incomingCommission ?? 5} ج.م`}
                            </span>
                          </div>
                        )}
                        <span className="inline-block text-[8px] bg-slate-100 text-slate-600 font-bold px-1.5 py-0.5 rounded-full">
                          {region.country}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPricingScope(region.id);
                            setActiveTab('overview');
                            triggerToast(
                              lang === 'ar' ? 'تسعيرة المنطقة' : 'Region Pricing',
                              lang === 'ar' ? `فتح تسعيرة منطقة "${region.nameAr}"` : `Opened pricing for "${region.nameAr}"`,
                              'info'
                            );
                          }}
                          className="px-2 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-colors cursor-pointer flex items-center gap-1 text-[9px] font-black"
                          title={lang === 'ar' ? 'ضبط وتعديل تسعيرة هذه المنطقة' : 'Configure region pricing'}
                        >
                          <Settings className="w-3.5 h-3.5" />
                          <span>{lang === 'ar' ? 'التسعيرة' : 'Pricing'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm(lang === 'ar' ? `حذف منطقة "${region.nameAr}"؟` : `Delete region "${region.nameAr}"?`)) {
                              const updated = regions.filter((r) => r.id !== region.id);
                              onUpdateRegions(updated);
                              deleteRegionInDB(region.id);
                              if (selectedPricingScope === region.id) {
                                setSelectedPricingScope('global');
                              }
                              triggerToast(
                                lang === 'ar' ? 'تم الحذف' : 'Deleted',
                                lang === 'ar' ? `تم حذف منطقة "${region.nameAr}"` : `Region "${region.nameAr}" deleted`,
                                'info'
                              );
                            }
                          }}
                          className="p-1.5 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-lg transition-colors cursor-pointer pointer-events-auto"
                          title={lang === 'ar' ? 'حذف' : 'Delete'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 1: OVERVIEW & LOCATIONS */}
        {activeTab === 'overview' && (
          <div className="space-y-4 animate-fade-in">
            {/* Live Stats Card */}
            <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-4 rounded-2xl shadow-md border border-slate-500/20 relative overflow-hidden">
              <div className="absolute right-0 bottom-0 translate-x-4 translate-y-4 opacity-10">
                <Globe className="w-36 h-36" />
              </div>
              <div className="flex justify-between items-start relative z-10">
                <div>
                  <span className="px-2 py-0.5 text-[8px] font-extrabold bg-emerald-500/30 text-emerald-200 rounded-full border border-emerald-500/30">
                    {lang === 'ar' ? '📡 مباشر الآن' : '📡 Live Now'}
                  </span>
                  <p className="text-[10px] text-slate-300 font-bold mt-1.5">
                    {lang === 'ar' ? 'رحلات نشطة وحالة السائقين' : 'Active trips & driver status'}
                  </p>
                  <div className="mt-2 flex gap-3">
                    <div>
                      <p className="text-[8px] text-slate-400">{lang === 'ar' ? 'الرحلات اللايف' : 'Live Trips'}</p>
                      <p className="text-sm font-black text-white">{liveTrips.length}</p>
                    </div>
                    <div>
                      <p className="text-[8px] text-slate-400">{lang === 'ar' ? 'سائقين أونلاين' : 'Online Drivers'}</p>
                      <p className="text-sm font-black text-emerald-300">{drivers.filter(d => d.isOnline).length}</p>
                    </div>
                    <div>
                      <p className="text-[8px] text-slate-400">{lang === 'ar' ? 'إجمالي المستخدمين' : 'Total Users'}</p>
                      <p className="text-sm font-black text-amber-300">{totalUsers}</p>
                    </div>
                  </div>
                </div>
                <div className="p-2.5 bg-white/10 rounded-xl">
                  <BarChart2 className="w-5 h-5 text-emerald-400" />
                </div>
              </div>
            </div>

            {/* REGION PRICING SCOPE SELECTOR */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xl">📍</span>
                  <div>
                    <h3 className="text-xs font-black text-slate-800">
                      {lang === 'ar' ? 'نطاق التسعيرة (عامة أو حسب المنطقة)' : 'Pricing Scope (Global or Per-Region)'}
                    </h3>
                    <p className="text-[9px] text-slate-400">
                      {lang === 'ar'
                        ? 'اختر المنطقة لتخصيص تسعيرتها المستقلة أو اختر التسعيرة العامة الافتراضية'
                        : 'Select a region to customize its pricing or edit global defaults'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('regions')}
                  className="text-[9px] font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  {lang === 'ar' ? 'إدارة / إضافة مناطق' : 'Manage Regions'}
                </button>
              </div>

              {/* Scope Selector Badges */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPricingScope('global');
                    setPricingDirty(false);
                  }}
                  className={`px-3 py-2 rounded-xl text-[10px] font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                    selectedPricingScope === 'global'
                      ? 'bg-slate-900 text-white shadow-sm ring-2 ring-indigo-500/30'
                      : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>{lang === 'ar' ? '🌐 التسعيرة العامة الافتراضية' : '🌐 Global Default Pricing'}</span>
                </button>

                {regions.map((reg) => {
                  const isSelected = selectedPricingScope === reg.id;
                  const hasCustom = !!reg.pricing?.customPricingEnabled;
                  return (
                    <button
                      key={reg.id}
                      type="button"
                      onClick={() => {
                        setSelectedPricingScope(reg.id);
                        setPricingDirty(false);
                      }}
                      className={`px-3 py-2 rounded-xl text-[10px] font-black transition-all cursor-pointer flex items-center gap-1.5 ${
                        isSelected
                          ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-500/30'
                          : hasCustom
                          ? 'bg-emerald-50 border border-emerald-300 text-emerald-800 hover:bg-emerald-100'
                          : 'bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <MapPin className="w-3.5 h-3.5" />
                      <span>{reg.nameAr}</span>
                      {hasCustom ? (
                        <span
                          className={`text-[8px] px-1.5 py-0.2 rounded-full font-bold ${
                            isSelected ? 'bg-emerald-300 text-slate-950' : 'bg-emerald-200 text-emerald-900'
                          }`}
                        >
                          {lang === 'ar' ? 'مخصصة' : 'Custom'}
                        </span>
                      ) : (
                        <span className="text-[8px] opacity-60">({lang === 'ar' ? 'افتراضية' : 'Default'})</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Active Scope Banner */}
              {selectedPricingScope !== 'global' && (
                <div
                  className={`p-3 rounded-xl border transition-all ${
                    regionCustomPricingEnabled
                      ? 'bg-emerald-50/90 border-emerald-200 text-emerald-900'
                      : 'bg-amber-50/90 border-amber-200 text-amber-900'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base">{regionCustomPricingEnabled ? '✨' : '⚠️'}</span>
                        <p className="text-[11px] font-black">
                          {lang === 'ar'
                            ? `تسعيرة منطقة: ${regions.find((r) => r.id === selectedPricingScope)?.nameAr || ''}`
                            : `Region Pricing: ${regions.find((r) => r.id === selectedPricingScope)?.nameEn || ''}`}
                        </p>
                      </div>
                      <p className="text-[9px] opacity-80 leading-relaxed">
                        {regionCustomPricingEnabled
                          ? lang === 'ar'
                            ? 'التسعيرة المخصصة مفعلة حالياً لهذه المنطقة وتلغي التسعيرة العامة عند انطلاق أي رحلة منها.'
                            : 'Custom pricing is active for this region and overrides global pricing for rides starting here.'
                          : lang === 'ar'
                          ? 'هذه المنطقة تستخدم حالياً التسعيرة العامة لجميع المناطق. يمكنك تفعيل تسعيرة مستقلة بالزر المقابل.'
                          : 'This region currently uses the global default pricing. You can enable custom pricing using the button.'}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {!regionCustomPricingEnabled ? (
                        <button
                          type="button"
                          onClick={() => {
                            setRegionCustomPricingEnabled(true);
                            setPricingDirty(true);
                          }}
                          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[9px] font-black transition-all shadow-sm cursor-pointer"
                        >
                          {lang === 'ar' ? '⚡ تفعيل تسعيرة مخصصة' : '⚡ Enable Custom Pricing'}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={handleCopyGlobalToRegion}
                            className="px-2.5 py-1.5 bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100 rounded-lg text-[9px] font-bold transition-all cursor-pointer"
                            title={lang === 'ar' ? 'نسخ أرقام التسعيرة العامة' : 'Copy global defaults'}
                          >
                            {lang === 'ar' ? '📋 نسخ العامة' : 'Copy Global'}
                          </button>
                          <button
                            type="button"
                            onClick={handleResetRegionPricingToDefault}
                            className="px-2.5 py-1.5 bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 rounded-lg text-[9px] font-bold transition-all cursor-pointer"
                            title={lang === 'ar' ? 'إلغاء التخصيص والعودة للافتراضي' : 'Revert to default'}
                          >
                            {lang === 'ar' ? '🔄 إلغاء التخصيص' : 'Revert'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* General Settings Card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-1.5">
                  <Settings className="w-4 h-4 text-indigo-600" />
                  <div>
                    <h3 className="text-xs font-black text-slate-800">
                      {selectedPricingScope === 'global'
                        ? lang === 'ar'
                          ? 'إعدادات عامة (التسعيرة العامة)'
                          : 'General Settings (Global Pricing)'
                        : lang === 'ar'
                        ? `إعدادات مسافة منطقة (${regions.find((r) => r.id === selectedPricingScope)?.nameAr || ''})`
                        : `Distance Settings for (${regions.find((r) => r.id === selectedPricingScope)?.nameEn || ''})`}
                    </h3>
                    <p className="text-[9px] text-slate-400">
                      {lang === 'ar' ? 'معامل المسافة ورقم الدعم' : 'Distance multiplier and support contact'}
                    </p>
                  </div>
                </div>
                <span className="bg-amber-100 text-amber-800 font-extrabold px-2 py-0.5 rounded-lg text-[9px] flex items-center gap-1">
                  🔒 {lang === 'ar' ? 'للإدارة فقط' : 'Admin Only'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Distance Buffer */}
                <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 space-y-2">
                  <label className="text-[10px] font-bold text-slate-700">
                    {lang === 'ar' ? 'معامل المسافة (نسبة الزيادة):' : 'Distance Buffer (Multiplier):'}
                  </label>
                  <input
                    type="number"
                    step="0.05"
                    value={pricingForm.distanceBuffer}
                    onChange={(e) => updatePricingField('distanceBuffer', Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-center font-bold text-slate-800"
                  />
                  <p className="text-[8px] text-slate-400">
                    {lang === 'ar' ? 'مثل 1.25 تعني زيادة 25% على المسافة لحساب الطريق الحقيقي' : 'e.g. 1.25 = 25% extra for real road distance'}
                  </p>
                </div>

                {/* Additional Km (fixed addition to distance for pricing) */}
                <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 space-y-2">
                  <label className="text-[10px] font-bold text-slate-700">
                    {lang === 'ar' ? 'إضافة كيلومترات إضافية للمسافة' : 'Additional KM (fixed addition to distance)'}
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={pricingForm.additionalKm}
                    onChange={(e) => updatePricingField('additionalKm', Number(e.target.value))}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-center font-bold text-slate-800"
                  />
                  <p className="text-[8px] text-slate-400">
                    {lang === 'ar' ? 'مثل 1 تعني إضافة 1 كم إضافي على المسافة النهائية' : 'e.g. 1 = adds 1 km to final distance for pricing'}
                  </p>
                </div>

                {/* Support WhatsApp */}
                <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 space-y-2">
                  <label className="text-[10px] font-bold text-slate-700">
                    {lang === 'ar' ? 'رقم واتساب الدعم الفني:' : 'Support WhatsApp Number:'}
                  </label>
                  <input
                    type="text"
                    value={pricingForm.supportWhatsApp}
                    onChange={(e) => updatePricingField('supportWhatsApp', e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="e.g., 201015555555"
                    className="w-full bg-white border border-slate-200 rounded-lg py-1.5 px-3 text-xs font-semibold text-slate-800 focus:outline-none focus:border-emerald-500 pointer-events-auto text-left"
                  />
                  <p className="text-[8px] text-slate-400">
                    {lang === 'ar' ? 'اكتب الرقم مع رمز الدولة بدون علامة +' : 'Enter phone with country code, without +'}
                  </p>
                </div>

                {/* Map Provider Settings */}
                <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 space-y-2">
                  <label className="text-[10px] font-bold text-slate-700">
                    {lang === 'ar' ? 'نوع الخريطة:' : 'Map Provider:'}
                  </label>
                  <select
                    value={pricingForm.mapProvider}
                    onChange={(e) => updatePricingField('mapProvider', e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs font-bold text-slate-800"
                  >
                    <option value="leaflet">{lang === 'ar' ? '🗺️ Leaflet (مجاني)' : '🗺️ Leaflet (Free)'}</option>
                    <option value="google">{lang === 'ar' ? '🌍 Google Maps (احترافي)' : '🌍 Google Maps (Professional)'}</option>
                  </select>
                  {pricingForm.mapProvider === 'google' && (
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-600">
                        {lang === 'ar' ? 'مفتاح Google Maps API:' : 'Google Maps API Key:'}
                      </label>
                      <input
                        type="text"
                        value={pricingForm.googleMapsApiKey}
                        onChange={(e) => updatePricingField('googleMapsApiKey', e.target.value)}
                        placeholder={lang === 'ar' ? 'ضع مفتاح Google Maps هنا' : 'Paste your Google Maps API key here'}
                        className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] font-mono text-slate-800"
                      />
                      <p className="text-[8px] text-slate-400">
                        {lang === 'ar' ? 'يتطلب تفعيل: Maps JavaScript API + Places API' : 'Requires: Maps JavaScript API + Places API'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Vehicle Type Pricing Cards */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-1.5">
                  <Car className="w-4 h-4 text-indigo-600" />
                  <div>
                    <h3 className="text-xs font-black text-slate-800">
                      {lang === 'ar' ? 'أسعار كل نوع مركبة' : 'Vehicle Type Pricing'}
                    </h3>
                    <p className="text-[9px] text-slate-400">
                      {lang === 'ar' ? 'حدد سعر فتح العداد والحد الأدنى للكيلو وأسعار الكيلو المتدرجة' : 'Set base fare, min km, and tiered km prices per vehicle'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {/* Car Pricing */}
                <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🚖</span>
                    <h4 className="text-[11px] font-black text-slate-800">
                      {lang === 'ar' ? 'سيارة' : 'Car'}
                    </h4>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[9px] font-bold text-slate-600 block mb-1">
                        {lang === 'ar' ? 'سعر فتح العداد (ج.م)' : 'Base Fare (EGP)'}
                      </label>
                      <input type="number" value={pricingForm.carBaseFare} onChange={(e) => updatePricingField('carBaseFare', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-center font-bold" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-600 block mb-1">
                        {lang === 'ar' ? 'الحد الأدنى للكيلو (كم)' : 'Min Fare (km)'}
                      </label>
                      <input type="number" step="0.5" value={pricingForm.carMinFare} onChange={(e) => updatePricingField('carMinFare', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-center font-bold" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-600 block mb-1">
                        {lang === 'ar' ? 'سعر الكيلو (0-20)' : 'Price per km (0-20)'}
                      </label>
                      <input type="number" value={pricingForm.carPricePerKm0to20} onChange={(e) => updatePricingField('carPricePerKm0to20', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-center font-bold" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-600 block mb-1">
                        {lang === 'ar' ? 'سعر الكيلو (20-50)' : 'Price per km (20-50)'}
                      </label>
                      <input type="number" value={pricingForm.carPricePerKm20to50} onChange={(e) => updatePricingField('carPricePerKm20to50', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-center font-bold" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-600 block mb-1">
                        {lang === 'ar' ? 'سعر الكيلو (50+)' : 'Price per km (50+)'}
                      </label>
                      <input type="number" value={pricingForm.carPricePerKm50plus} onChange={(e) => updatePricingField('carPricePerKm50plus', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-center font-bold" />
                    </div>
                  </div>
                </div>

                {/* Motorcycle Pricing */}
                <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🏍️</span>
                    <h4 className="text-[11px] font-black text-slate-800">
                      {lang === 'ar' ? 'موتوسيكل' : 'Motorcycle'}
                    </h4>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[9px] font-bold text-slate-600 block mb-1">
                        {lang === 'ar' ? 'سعر فتح العداد (ج.م)' : 'Base Fare (EGP)'}
                      </label>
                      <input type="number" value={pricingForm.motorcycleBaseFare} onChange={(e) => updatePricingField('motorcycleBaseFare', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-center font-bold" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-600 block mb-1">
                        {lang === 'ar' ? 'الحد الأدنى للكيلو (كم)' : 'Min Fare (km)'}
                      </label>
                      <input type="number" step="0.5" value={pricingForm.motorcycleMinFare} onChange={(e) => updatePricingField('motorcycleMinFare', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-center font-bold" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-600 block mb-1">
                        {lang === 'ar' ? 'سعر الكيلو (0-20)' : 'Price per km (0-20)'}
                      </label>
                      <input type="number" value={pricingForm.motorcyclePricePerKm0to20} onChange={(e) => updatePricingField('motorcyclePricePerKm0to20', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-center font-bold" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-600 block mb-1">
                        {lang === 'ar' ? 'سعر الكيلو (20-50)' : 'Price per km (20-50)'}
                      </label>
                      <input type="number" value={pricingForm.motorcyclePricePerKm20to50} onChange={(e) => updatePricingField('motorcyclePricePerKm20to50', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-center font-bold" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-600 block mb-1">
                        {lang === 'ar' ? 'سعر الكيلو (50+)' : 'Price per km (50+)'}
                      </label>
                      <input type="number" value={pricingForm.motorcyclePricePerKm50plus} onChange={(e) => updatePricingField('motorcyclePricePerKm50plus', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-center font-bold" />
                    </div>
                  </div>
                </div>

                {/* TukTuk Pricing */}
                <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">🛺</span>
                    <h4 className="text-[11px] font-black text-slate-800">
                      {lang === 'ar' ? 'توكتوك' : 'TukTuk'}
                    </h4>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="text-[9px] font-bold text-slate-600 block mb-1">
                        {lang === 'ar' ? 'سعر فتح العداد (ج.م)' : 'Base Fare (EGP)'}
                      </label>
                      <input type="number" value={pricingForm.toktokBaseFare} onChange={(e) => updatePricingField('toktokBaseFare', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-center font-bold" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-600 block mb-1">
                        {lang === 'ar' ? 'الحد الأدنى للكيلو (كم)' : 'Min Fare (km)'}
                      </label>
                      <input type="number" step="0.5" value={pricingForm.toktokMinFare} onChange={(e) => updatePricingField('toktokMinFare', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-center font-bold" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-600 block mb-1">
                        {lang === 'ar' ? 'سعر الكيلو (0-20)' : 'Price per km (0-20)'}
                      </label>
                      <input type="number" value={pricingForm.toktokPricePerKm0to20} onChange={(e) => updatePricingField('toktokPricePerKm0to20', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-center font-bold" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-600 block mb-1">
                        {lang === 'ar' ? 'سعر الكيلو (20-50)' : 'Price per km (20-50)'}
                      </label>
                      <input type="number" value={pricingForm.toktokPricePerKm20to50} onChange={(e) => updatePricingField('toktokPricePerKm20to50', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-center font-bold" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-600 block mb-1">
                        {lang === 'ar' ? 'سعر الكيلو (50+)' : 'Price per km (50+)'}
                      </label>
                      <input type="number" value={pricingForm.toktokPricePerKm50plus} onChange={(e) => updatePricingField('toktokPricePerKm50plus', Number(e.target.value))} className="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[10px] text-center font-bold" />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Commission Settings Card */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-1.5">
                  <Percent className="w-4 h-4 text-indigo-600" />
                  <div>
                    <h3 className="text-xs font-black text-slate-800">
                      {lang === 'ar' ? 'إعدادات العمولة' : 'Commission Settings'}
                    </h3>
                    <p className="text-[9px] text-slate-400">
                      {lang === 'ar' ? 'حدد نوع العمولة والقيمة للرحلات الداخلية والخارجية' : 'Choose commission type and value for incoming/outgoing trips'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-[10px] font-bold text-slate-700 block mb-1.5">
                    {lang === 'ar' ? 'نوع العمولة:' : 'Commission Mode:'}
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => updatePricingField('commissionMode', 'fixed')}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all cursor-pointer ${
                        pricingForm.commissionMode === 'fixed'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white border border-slate-200 text-slate-600'
                      }`}
                    >
                      {lang === 'ar' ? 'مبلغ ثابت (ج.م)' : 'Fixed Amount (EGP)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => updatePricingField('commissionMode', 'percent')}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all cursor-pointer ${
                        pricingForm.commissionMode === 'percent'
                          ? 'bg-indigo-600 text-white'
                          : 'bg-white border border-slate-200 text-slate-600'
                      }`}
                    >
                      {lang === 'ar' ? 'نسبة مئوية (%)' : 'Percentage (%)'}
                    </button>
                  </div>
                </div>

                {pricingForm.commissionMode === 'fixed' ? (
                  <>
                    <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 space-y-2">
                      <label className="text-[10px] font-bold text-slate-700">
                        {lang === 'ar' ? 'عمولة الرحلات الداخلية (ج.م):' : 'Incoming Commission (EGP):'}
                      </label>
                      <input
                        type="number"
                        value={pricingForm.incomingCommission}
                        onChange={(e) => updatePricingField('incomingCommission', Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-center font-bold text-slate-800"
                      />
                      <p className="text-[8px] text-slate-400">
                        {lang === 'ar' ? 'مبلغ ثابت يضاف لسعر الرحلة للعميل' : 'Fixed amount added to client fare'}
                      </p>
                    </div>
                    <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 space-y-2">
                      <label className="text-[10px] font-bold text-slate-700">
                        {lang === 'ar' ? 'عمولة الرحلات الخارجية (ج.م):' : 'Outgoing Commission (EGP):'}
                      </label>
                      <input
                        type="number"
                        value={pricingForm.outgoingCommission}
                        onChange={(e) => updatePricingField('outgoingCommission', Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-center font-bold text-slate-800"
                      />
                      <p className="text-[8px] text-slate-400">
                        {lang === 'ar' ? 'مبلغ ثابت يضاف لسعر الرحلة للعميل' : 'Fixed amount added to client fare'}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 space-y-2">
                      <label className="text-[10px] font-bold text-slate-700">
                        {lang === 'ar' ? 'عمولة الرحلات الداخلية (%):' : 'Incoming Commission (%):'}
                      </label>
                      <input
                        type="number"
                        value={pricingForm.incomingCommissionPercent}
                        onChange={(e) => updatePricingField('incomingCommissionPercent', Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-center font-bold text-slate-800"
                      />
                      <p className="text-[8px] text-slate-400">
                        {lang === 'ar' ? 'نسبة مئوية من قيمة الرحلة للعميل' : 'Percentage of client fare'}
                      </p>
                    </div>
                    <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-3 space-y-2">
                      <label className="text-[10px] font-bold text-slate-700">
                        {lang === 'ar' ? 'عمولة الرحلات الخارجية (%):' : 'Outgoing Commission (%):'}
                      </label>
                      <input
                        type="number"
                        value={pricingForm.outgoingCommissionPercent}
                        onChange={(e) => updatePricingField('outgoingCommissionPercent', Number(e.target.value))}
                        className="w-full bg-white border border-slate-200 rounded-lg p-2 text-xs text-center font-bold text-slate-800"
                      />
                      <p className="text-[8px] text-slate-400">
                        {lang === 'ar' ? 'نسبة مئوية من قيمة الرحلة للعميل' : 'Percentage of client fare'}
                      </p>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Save Button */}
            <div className="pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={handleSavePricing}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black rounded-xl transition-all cursor-pointer pointer-events-auto flex items-center justify-center gap-2 shadow-sm active:scale-[0.99]"
              >
                {saveSuccess ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    {lang === 'ar' ? 'تم الحفظ بنجاح' : 'Saved Successfully'}
                  </>
                ) : (
                  <>
                    <Settings className="w-4 h-4" />
                    {selectedPricingScope === 'global'
                      ? lang === 'ar'
                        ? '💾 حفظ التسعيرة العامة الافتراضية'
                        : '💾 Save Global Default Pricing'
                      : lang === 'ar'
                      ? `💾 حفظ تسعيرة منطقة (${regions.find((r) => r.id === selectedPricingScope)?.nameAr || ''})`
                      : `💾 Save Pricing for (${regions.find((r) => r.id === selectedPricingScope)?.nameEn || ''})`}
                  </>
                )}
              </button>
            </div>

            {/* Promo Codes Section */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎁</span>
            <h3 className="text-xs font-black text-slate-800">
              {lang === 'ar' ? 'الكواد الترويجية' : 'Promo Codes'}
            </h3>
          </div>
          
          <div className="flex gap-2">
            <input
              type="number"
              value={promoDiscount}
              onChange={(e) => setPromoDiscount(Number(e.target.value))}
              placeholder={lang === 'ar' ? 'قيمة الخصم (ج.م)' : 'Discount amount (EGP)'}
              className="flex-1 px-2 py-1.5 text-[10px] border border-slate-200 rounded-lg text-center font-bold"
            />
            <input
              type="number"
              min="1"
              value={promoUsageLimit}
              onChange={(e) => setPromoUsageLimit(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder={lang === 'ar' ? 'عدد الاستخدامات (اتركه فارغ لغير محدود)' : 'Usage limit (empty = unlimited)'}
              className="w-[130px] px-2 py-1.5 text-[10px] border border-slate-200 rounded-lg text-center font-bold"
            />
            <select
              value={selectedRiderForPromo}
              onChange={(e) => setSelectedRiderForPromo(e.target.value)}
              className="px-2 py-1.5 text-[10px] border border-slate-200 rounded-lg"
            >
              <option value="">{lang === 'ar' ? 'لجميع الركاب' : 'All riders'}</option>
              {riders.map(r => (
                <option key={r.id} value={r.id}>{r.name} ({r.phone})</option>
              ))}
            </select>
            <button
              onClick={handleGeneratePromoCode}
              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold rounded-lg transition-all cursor-pointer"
            >
              {lang === 'ar' ? 'توليد كود' : 'Generate'}
            </button>
          </div>

          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {promoCodes.length === 0 ? (
              <p className="text-[10px] text-slate-400 text-center py-2">
                {lang === 'ar' ? 'لا توجد أكواد ترويجية بعد' : 'No promo codes yet'}
              </p>
            ) : (
              promoCodes.map(code => (
                <div key={code.id} className="flex justify-between items-center text-[10px] p-2 bg-slate-50 rounded-lg">
                  <div>
                    <p className="font-bold text-slate-800">{code.code}</p>
                    <p className="text-[9px] text-slate-500">
                      {code.discountAmount} {lang === 'ar' ? 'ج.م خصم' : 'EGP discount'}
                    </p>
                    {code.riderId && (
                      <p className="text-[8px] text-blue-600">
                        {lang === 'ar' ? 'لراكب محدد' : 'Rider-specific'}
                      </p>
                    )}
                    {code.usageLimit !== undefined && code.usageLimit !== null && (
                      <p className="text-[8px] text-amber-600">
                        {lang === 'ar' ? `استخدامات: ${code.usageCount || 0}/${code.usageLimit}` : `Uses: ${code.usageCount || 0}/${code.usageLimit}`}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold ${
                      code.used ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {code.used ? (lang === 'ar' ? 'مستخدم' : 'Used') : (lang === 'ar' ? 'متاح' : 'Available')}
                    </span>
                    <button
                      onClick={() => handleDeletePromoCode(code.id)}
                      className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded transition-all cursor-pointer"
                      title={lang === 'ar' ? 'حذف الكود' : 'Delete code'}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
          </div>
        )}

        {/* TAB 2: CAPTAIN & LEDGER MANAGEMENT */}
        {activeTab === 'drivers' && (
          <div className="space-y-4 animate-fade-in">
            {/* Verification & Ledger Accounts */}
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-xs font-bold text-slate-800">
                    {lang === 'ar' ? 'إدارة حسابات الكباتن والطلبات' : 'Captain Accounts & Verification'}
                  </h3>
                </div>
                <span className="bg-slate-100 text-slate-700 text-[9px] font-black px-2 py-0.5 rounded-full">
                  {drivers.length} {lang === 'ar' ? 'سائق مسجل' : 'Registered'}
                </span>
              </div>

              <div className="space-y-4">
                {/* Pending Verification */}
                {drivers.filter(d => d.approvalStatus === 'PENDING').length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-[11px] font-bold text-amber-600 flex items-center gap-1">
                      <span>⏳</span>
                      <span>{lang === 'ar' ? 'طلبات انضمام جديدة بانتظار المراجعة' : 'New Driver Registrations (Pending)'}</span>
                    </h4>
                    <div className="space-y-2">
                      {drivers.filter(d => d.approvalStatus === 'PENDING').map(drv => (
                        <div key={drv.id} className="border-2 border-amber-100 bg-amber-50/20 p-3 rounded-xl space-y-2.5">
                          <div className="flex justify-between items-start">
                            <div>
                              <h5 className="text-xs font-bold text-slate-800">{drv.name}</h5>
                              <p className="text-[10px] text-slate-500 font-bold mt-0.5">📞 {drv.phone}</p>
                            </div>
                            <span className="text-[8px] bg-amber-100 text-amber-800 font-extrabold px-1.5 py-0.5 rounded animate-pulse">
                              {lang === 'ar' ? 'انتظار الموافقة' : 'Pending Verification'}
                            </span>
                          </div>

                          {/* Submitted Documents */}
                          <div className="bg-white border border-amber-100/50 p-2.5 rounded-lg space-y-2.5 text-[9px] text-slate-600">
                            <div className="grid grid-cols-2 gap-1.5 text-[9px]">
                              <p>🏎️ <strong>{lang === 'ar' ? 'المركبة:' : 'Vehicle:'}</strong> {
                                drv.vehicleType === 'CAR'
                                  ? (lang === 'ar' ? 'سيارة 🚖' : 'Car 🚖')
                                  : drv.vehicleType === 'MOTORCYCLE'
                                  ? (lang === 'ar' ? 'موتوسيكل 🏍️' : 'Motorcycle 🏍️')
                                  : drv.vehicleType === 'TOKTOK'
                                  ? (lang === 'ar' ? 'توكتوك 🛺' : 'TukTuk 🛺')
                                  : (lang === 'ar' ? 'تروسيكل 🚲' : 'Tricycle 🚲')
                              } - {drv.vehicleName}</p>
                              <p>💳 <strong>{lang === 'ar' ? 'الرقم القومي:' : 'National ID:'}</strong> {drv.nationalId}</p>
                              <p>📄 <strong>{lang === 'ar' ? 'رقم الرخصة:' : 'License No:'}</strong> {drv.driverLicense}</p>
                              <p>✓ <strong>{lang === 'ar' ? 'موافق على الشروط:' : 'Terms agreed:'}</strong> {drv.agreedToTerms ? <span className="text-emerald-600 font-bold">✓ نعم</span> : <span className="text-rose-500 font-bold">✕ لا</span>}</p>
                            </div>

                            {/* Driver Details */}
                            <div className="border-t border-slate-100 pt-2 space-y-1.5 text-[10px]">
                              <span className="text-[8px] font-black text-slate-500 block">{lang === 'ar' ? 'بيانات السائق:' : 'Driver Details:'}</span>
                              <div className="grid grid-cols-2 gap-1 text-[9px] text-slate-600">
                                <p>📞 {drv.phone} {drv.secondaryPhone && <span className="text-slate-400">({drv.secondaryPhone})</span>}</p>
                                <p>🪪 {drv.nationalId}</p>
                                <p>📄 {drv.driverLicense}</p>
                                <p>🚗 {drv.vehicleType === 'CAR' ? (lang === 'ar' ? 'سيارة' : 'Car') : drv.vehicleType === 'MOTORCYCLE' ? (lang === 'ar' ? 'موتوسيكل' : 'Motorcycle') : drv.vehicleType === 'TOKTOK' ? (lang === 'ar' ? 'توكتوك' : 'TukTuk') : (lang === 'ar' ? 'تروسيكل' : 'Tricycle')}</p>
                                <p>🏎️ {drv.vehicleName} {drv.vehicleBrand && <span className="text-slate-400">({drv.vehicleBrand})</span>}</p>
                                <p>🔢 {drv.vehicleLicense || '-'}</p>
                              </div>
                              {(!drv.personalPhoto && !drv.nationalIdImage && !drv.driverLicenseImage && !drv.vehicleLicenseImage) && (
                                <p className="text-[8px] text-amber-600 font-bold mt-1">
                                  {lang === 'ar' ? '⚠️ لم يتم إرسال المستندات بعد - يرجى التواصل مع السائق لاستلامها' : '⚠️ Documents not submitted yet - please contact driver to receive them'}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Admin Decision Actions */}
                          <div className="grid grid-cols-3 gap-1.5 text-[10px]">
                            <button
                              type="button"
                              onClick={() => onApproveDriver(drv.id)}
                              className="py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition-colors cursor-pointer pointer-events-auto"
                            >
                              {lang === 'ar' ? 'قبول وتفعيل' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              onClick={() => onRejectDriver(drv.id)}
                              className="py-1 bg-rose-100 hover:bg-rose-200 text-rose-700 font-bold rounded-lg transition-colors cursor-pointer pointer-events-auto"
                            >
                              {lang === 'ar' ? 'رفض الطلب' : 'Reject'}
                            </button>
                            <a
                              href={`https://wa.me/${drv.phone.replace(/[^0-9]/g, '') || '201015555555'}?text=${encodeURIComponent(
                                lang === 'ar'
                                  ? `مرحباً كابتن ${drv.name}، معك إدارة تطبيق كابتن عز. لقد تلقينا طلب انضمامك.\n\nنحتاج منك إرسال المستندات التالية:\n1. صورة بطاقة الرقم القومي\n2. صورة رخصة القيادة\n3. صورة رخصة المركبة\n4. صورة شخصية\n\nبمجرد استلام المستندات سيتم مراجعة طلبك والرد عليك.`
                                  : `Hello Captain ${drv.name}, this is Ezz Admin. We received your driver application.\n\nPlease send the following documents:\n1. National ID card photo\n2. Driving license photo\n3. Vehicle license photo\n4. Personal photo\n\nWe will review and reply once received.`
                              )}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-lg transition-colors text-center cursor-pointer pointer-events-auto flex items-center justify-center gap-1"
                            >
                              <span>💬 {lang === 'ar' ? 'واتساب للمستندات' : 'WhatsApp Docs'}</span>
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* All Active / Suspended Accounts */}
                <div className="space-y-2">
                  <h4 className="text-[11px] font-bold text-slate-500">
                    {lang === 'ar' ? 'قائمة الكباتن المسجلين والذمم المالية' : 'All Driver Accounts & Ledgers'}
                  </h4>

                  {/* Search and Filters for Drivers Ledger */}
                  <div className="space-y-2 bg-slate-50 border border-slate-100 rounded-xl p-3 pointer-events-auto">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 transform -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder={lang === 'ar' ? 'بحث باسم الكابتن، الهاتف، أو رقم اللوحة...' : 'Search by name, phone, plate...'}
                        value={driverSearchQuery}
                        onChange={(e) => setDriverSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                      />
                    </div>
                    
                    <div className="flex flex-wrap gap-1">
                      <button
                        onClick={() => setDriverStatusFilter('all')}
                        className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold transition-all cursor-pointer ${
                          driverStatusFilter === 'all'
                            ? 'bg-slate-900 text-white'
                            : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {lang === 'ar' ? 'الكل' : 'All'}
                      </button>
                      <button
                        onClick={() => setDriverStatusFilter('ACTIVE')}
                        className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold transition-all cursor-pointer ${
                          driverStatusFilter === 'ACTIVE'
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {lang === 'ar' ? 'نشط ومفعل' : 'Active'}
                      </button>
                      <button
                        onClick={() => setDriverStatusFilter('FROZEN')}
                        className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold transition-all cursor-pointer ${
                          driverStatusFilter === 'FROZEN'
                            ? 'bg-rose-600 text-white'
                            : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        {lang === 'ar' ? 'موقوف / مجمد' : 'Frozen'}
                      </button>
                       <button
                         onClick={() => setDriverStatusFilter('REJECTED')}
                         className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold transition-all cursor-pointer ${
                           driverStatusFilter === 'REJECTED'
                             ? 'bg-slate-500 text-white'
                             : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                         }`}
                       >
                         {lang === 'ar' ? 'مرفوض' : 'Rejected'}
                       </button>
                     </div>

                     <div className="flex flex-wrap gap-1">
                       <span className="text-[8px] font-bold text-slate-500 self-center mr-1">
                         {lang === 'ar' ? 'الفترة:' : 'Period:'}
                       </span>
                       {[
                         { id: 'all', labelAr: 'الكل', labelEn: 'All' },
                         { id: 'week', labelAr: 'أسبوع', labelEn: 'Week' },
                         { id: 'month', labelAr: 'شهر', labelEn: 'Month' },
                         { id: '30days', labelAr: '30 يوم', labelEn: '30 Days' },
                       ].map((periodItem) => (
                         <button
                           key={periodItem.id}
                           onClick={() => setDriverPeriodFilter(periodItem.id as any)}
                           className={`px-2 py-0.5 rounded-full text-[8px] font-bold transition-all cursor-pointer ${
                             driverPeriodFilter === periodItem.id
                               ? 'bg-indigo-600 text-white'
                               : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                           }`}
                         >
                           {lang === 'ar' ? periodItem.labelAr : periodItem.labelEn}
                         </button>
                       ))}
                     </div>
                   </div>

                  <div className="space-y-2">
                    {drivers
                      .filter(d => d.approvalStatus !== 'PENDING')
                      .filter((d) => {
                        if (driverStatusFilter === 'ACTIVE') return d.approvalStatus === 'APPROVED';
                        if (driverStatusFilter === 'FROZEN') return d.approvalStatus === 'FROZEN';
                        if (driverStatusFilter === 'REJECTED') return d.approvalStatus === 'REJECTED';
                        return true;
                      })
                      .filter((d) => {
                        const q = driverSearchQuery.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          d.name.toLowerCase().includes(q) ||
                          d.phone.includes(q) ||
                          (d.carPlate && d.carPlate.toLowerCase().includes(q)) ||
                          (d.vehicleName && d.vehicleName.toLowerCase().includes(q))
                        );
                      })
                       .map((drv) => {
                         const isFrozen = drv.approvalStatus === 'FROZEN';
                         const isRejected = drv.approvalStatus === 'REJECTED';
                         const driverStatsMap = getDriverStatsForPeriod(driverPeriodFilter);
                         const driverPeriodStats = driverStatsMap[drv.id] || driverStatsMap[drv.name] || { trips: 0, earnings: 0, commission: 0 };

                         return (
                         <div key={drv.id} className={`border border-slate-100 p-3 rounded-xl space-y-2.5 ${isFrozen ? 'bg-red-50/20 border-red-100' : isRejected ? 'bg-slate-50 border-slate-200' : 'bg-white'}`}>
                           <div className="flex items-start justify-between">
                             <div>
                               <h5 className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                                 <span>{drv.name}</span>
                                 <span className={`w-2 h-2 rounded-full inline-block ${drv.isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                               </h5>
                               <p className="text-[9px] text-slate-400 mt-0.5">
                                 {drv.vehicleType === 'CAR'
                                   ? (lang === 'ar' ? '🚖 سيارة' : '🚖 Car')
                                   : drv.vehicleType === 'MOTORCYCLE'
                                   ? (lang === 'ar' ? '🏍️ موتوسيكل' : '🏍️ Motorcycle')
                                   : drv.vehicleType === 'TOKTOK'
                                   ? (lang === 'ar' ? '🛺 توكتوك' : '🛺 TukTuk')
                                   : (lang === 'ar' ? '🚲 تروسيكل' : '🚲 Tricycle')
                                 } | {drv.vehicleName} | {drv.carPlate}
                               </p>
                             </div>
                             <div className="flex flex-col items-end gap-1">
                               <div className="flex items-center gap-0.5 text-amber-500 text-[10px] font-bold">
                                 <Star className="w-3 h-3 fill-amber-500 text-amber-500" />
                                 <span>{drv.rating}</span>
                               </div>
                               {isFrozen ? (
                                 <span className="text-[8px] bg-red-100 text-red-800 font-extrabold px-1.5 py-0.5 rounded">
                                   {lang === 'ar' ? 'موقوف/مجمد' : 'Suspended'}
                                 </span>
                               ) : isRejected ? (
                                 <span className="text-[8px] bg-slate-200 text-slate-600 font-extrabold px-1.5 py-0.5 rounded">
                                   {lang === 'ar' ? 'مرفوض' : 'Rejected'}
                                 </span>
                               ) : (
                                 <span className="text-[8px] bg-emerald-100 text-emerald-800 font-extrabold px-1.5 py-0.5 rounded">
                                   {lang === 'ar' ? 'نشط ومفعل' : 'Active'}
                                 </span>
                               )}
                             </div>
                           </div>

                           {/* Ledger stats */}
                           <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2 rounded-lg text-center text-[10px]">
                             <div>
                               <p className="text-[8px] text-slate-400">{lang === 'ar' ? 'الرحلات' : 'Rides'}</p>
                               <p className="font-bold text-slate-700 mt-0.5">{driverPeriodStats.trips}</p>
                             </div>
                             <div>
                               <p className="text-[8px] text-slate-400">{lang === 'ar' ? 'أرباح السائق' : 'Driver Net'}</p>
                               <p className="font-bold text-slate-700 mt-0.5">{Math.round(driverPeriodStats.earnings)} ج.م</p>
                             </div>
                             <div>
                               <p className="text-[8px] text-rose-500">{lang === 'ar' ? 'عمولة التطبيق' : 'Due Ezz'}</p>
                               <p className="font-bold text-rose-600 mt-0.5">{Math.round(driverPeriodStats.commission)} ج.م</p>
                             </div>
                           </div>

                          {/* Service Areas Assignment */}
                          {onUpdateDriverServiceAreas && regions.length > 0 && (
                            <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 space-y-1.5">
                              <p className="text-[9px] font-bold text-slate-600 flex items-center gap-1">
                                <MapPin className="w-3 h-3 text-indigo-500" />
                                {lang === 'ar' ? 'مناطق التغطية المخصصة' : 'Assigned Coverage Areas'}
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {regions.map((region) => {
                                  const isSelected = drv.serviceAreas?.some(sa => sa === region.nameAr || sa === region.nameEn);
                                  return (
                                    <button
                                      key={region.id}
                                      type="button"
                                      onClick={() => {
                                        if (!onUpdateDriverServiceAreas) return;
                                        let newAreas: string[];
                                        if (isSelected) {
                                          newAreas = (drv.serviceAreas || []).filter(sa => sa !== region.nameAr && sa !== region.nameEn);
                                        } else {
                                          newAreas = [...(drv.serviceAreas || []), region.nameAr];
                                        }
                                        onUpdateDriverServiceAreas(drv.id, newAreas);
                                      }}
                                      className={`px-2 py-0.5 rounded-md text-[9px] font-bold transition-all cursor-pointer pointer-events-auto border ${
                                        isSelected
                                          ? 'bg-indigo-600 border-indigo-700 text-white'
                                          : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300'
                                      }`}
                                    >
                                      {isSelected && <CheckCircle className="w-2.5 h-2.5 inline-block mr-0.5" />}
                                      {region.nameAr}
                                    </button>
                                  );
                                })}
                              </div>
                              {(!drv.serviceAreas || drv.serviceAreas.length === 0) && (
                                <p className="text-[8px] text-amber-600 font-bold">
                                  {lang === 'ar' ? 'لم تُحدد مناطق لهذا السائق بعد' : 'No areas assigned yet'}
                                </p>
                              )}
                            </div>
                          )}

                           {/* Actions row */}
                           <div className="grid grid-cols-2 gap-1.5 text-[9px] font-bold">
                             {drv.totalCommissionPaid > 0 ? (
                               <button
                                 type="button"
                                 onClick={() => onSettleDriverCommissions(drv.id)}
                                 className="py-1 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-colors cursor-pointer pointer-events-auto text-center"
                               >
                                 {lang === 'ar'
                                   ? `تحصيل ${drv.totalCommissionPaid} ج.م وتصفية`
                                   : `Collect ${drv.totalCommissionPaid} EGP`}
                               </button>
                             ) : (
                               <div className="py-1 bg-emerald-50 text-emerald-700 rounded-lg text-center font-bold">
                                 {lang === 'ar' ? '✓ الحساب مصفى' : '✓ Settled'}
                               </div>
                             )}

                            <a
                              href={`https://wa.me/${drv.phone.replace(/[^0-9]/g, '') || '201015555555'}?text=${encodeURIComponent(
                                lang === 'ar'
                                  ? `مرحباً كابتن ${drv.name}، نرجو تسوية عمولة الرحلات المتأخرة المستحقة لتطبيق كابتن عز بقيمة (${drv.totalCommissionPaid} ج.م).`
                                  : `Hello Captain ${drv.name}, please settle your outstanding commissions of ${drv.totalCommissionPaid} EGP.`
                              )}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors text-center cursor-pointer pointer-events-auto flex items-center justify-center gap-1"
                            >
                              💬 {lang === 'ar' ? 'تواصل واتساب' : 'WhatsApp'}
                            </a>

                            {isFrozen ? (
                              <button
                                type="button"
                                onClick={() => onUnfreezeDriver(drv.id)}
                                className="py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors cursor-pointer pointer-events-auto col-span-1"
                              >
                                {lang === 'ar' ? 'إلغاء التجميد' : 'Unfreeze Account'}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onFreezeDriver(drv.id)}
                                className="py-1 bg-rose-500 hover:bg-rose-600 text-white rounded-lg transition-colors cursor-pointer pointer-events-auto col-span-1"
                                title="Freeze Captain"
                              >
                                {lang === 'ar' ? 'تجميد/وقف الحساب' : 'Suspend Captain'}
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(lang === 'ar' ? `هل أنت متأكد من حذف الكابتن ${drv.name} نهائياً؟` : `Delete Captain ${drv.name} permanently?`)) {
                                  onDeleteDriver(drv.id);
                                }
                              }}
                              className="py-1 bg-slate-100 hover:bg-rose-100 hover:text-rose-700 text-slate-500 rounded-lg transition-colors cursor-pointer pointer-events-auto"
                            >
                              {lang === 'ar' ? 'حذف نهائي' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: RIDER & ACCOUNT MANAGEMENT */}
        {activeTab === 'riders' && (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-xs space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-indigo-600" />
                  <h3 className="text-xs font-bold text-slate-800">
                    {lang === 'ar' ? 'إدارة حسابات الركاب والرصيد والرحلات' : 'Rider Accounts, Balance & Trips'}
                  </h3>
                </div>
                <span className="bg-slate-100 text-slate-700 text-[9px] font-black px-2 py-0.5 rounded-full">
                  {riders.length} {lang === 'ar' ? 'راكب مسجل' : 'Registered Riders'}
                </span>
              </div>

              <div className="space-y-2 bg-slate-50 border border-slate-100 rounded-xl p-3 pointer-events-auto">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 transform -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder={lang === 'ar' ? 'بحث باسم الراكب أو الهاتف...' : 'Search by rider name or phone...'}
                    value={riderSearchQuery}
                    onChange={(e) => setRiderSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="flex flex-wrap gap-1">
                  <button
                    onClick={() => setRiderStatusFilter('all')}
                    className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold transition-all cursor-pointer ${
                      riderStatusFilter === 'all'
                        ? 'bg-slate-900 text-white'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {lang === 'ar' ? 'الكل' : 'All'}
                  </button>
                  <button
                    onClick={() => setRiderStatusFilter('ACTIVE')}
                    className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold transition-all cursor-pointer ${
                      riderStatusFilter === 'ACTIVE'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {lang === 'ar' ? 'نشط' : 'Active'}
                  </button>
                  <button
                    onClick={() => setRiderStatusFilter('FROZEN')}
                    className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold transition-all cursor-pointer ${
                      riderStatusFilter === 'FROZEN'
                        ? 'bg-amber-500 text-white'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {lang === 'ar' ? 'مؤقت' : 'Frozen'}
                  </button>
                  <button
                    onClick={() => setRiderStatusFilter('BLOCKED')}
                    className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold transition-all cursor-pointer ${
                      riderStatusFilter === 'BLOCKED'
                        ? 'bg-rose-600 text-white'
                        : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {lang === 'ar' ? 'محظور' : 'Blocked'}
                  </button>
                     <button
                       onClick={() => setRiderStatusFilter('REJECTED')}
                       className={`px-2.5 py-0.5 rounded-full text-[9px] font-bold transition-all cursor-pointer ${
                         riderStatusFilter === 'REJECTED'
                           ? 'bg-slate-500 text-white'
                           : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                       }`}
                     >
                       {lang === 'ar' ? 'مرفوض' : 'Rejected'}
                     </button>
                   </div>

                   <div className="flex flex-wrap gap-1">
                     <span className="text-[8px] font-bold text-slate-500 self-center mr-1">
                       {lang === 'ar' ? 'الفترة:' : 'Period:'}
                     </span>
                     {[
                       { id: 'all', labelAr: 'الكل', labelEn: 'All' },
                       { id: 'week', labelAr: 'أسبوع', labelEn: 'Week' },
                       { id: 'month', labelAr: 'شهر', labelEn: 'Month' },
                       { id: '30days', labelAr: '30 يوم', labelEn: '30 Days' },
                     ].map((periodItem) => (
                       <button
                         key={periodItem.id}
                         onClick={() => setRiderPeriodFilter(periodItem.id as any)}
                         className={`px-2 py-0.5 rounded-full text-[8px] font-bold transition-all cursor-pointer ${
                           riderPeriodFilter === periodItem.id
                             ? 'bg-indigo-600 text-white'
                             : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                         }`}
                       >
                         {lang === 'ar' ? periodItem.labelAr : periodItem.labelEn}
                       </button>
                     ))}
                   </div>
                 </div>

              <div className="space-y-2">
                {riders
                  .filter((r) => {
                    if (riderStatusFilter === 'ACTIVE') return (r.approvalStatus || 'APPROVED') === 'APPROVED';
                    if (riderStatusFilter === 'FROZEN') return r.approvalStatus === 'FROZEN';
                    if (riderStatusFilter === 'BLOCKED') return r.approvalStatus === 'BLOCKED';
                    if (riderStatusFilter === 'REJECTED') return r.approvalStatus === 'REJECTED';
                    return true;
                  })
                  .filter((r) => {
                    const q = riderSearchQuery.trim().toLowerCase();
                    if (!q) return true;
                    return (
                      r.name.toLowerCase().includes(q) ||
                      r.phone.includes(q)
                    );
                  })
                   .map((rider) => {
                     const isFrozen = rider.approvalStatus === 'FROZEN';
                     const isBlocked = rider.approvalStatus === 'BLOCKED';
                     const isRejected = rider.approvalStatus === 'REJECTED';
                     const riderStatsMap = getRiderStatsForPeriod(riderPeriodFilter);
                     const riderPeriodStats = riderStatsMap[rider.id] || riderStatsMap[rider.name] || { trips: 0, spent: 0 };

                     return (
                       <div
                         key={rider.id}
                         className={`border border-slate-100 p-3 rounded-xl space-y-2.5 ${
                           isFrozen
                             ? 'bg-amber-50/30 border-amber-100'
                             : isBlocked
                             ? 'bg-rose-50/30 border-rose-100'
                             : isRejected
                             ? 'bg-slate-50 border-slate-200'
                             : 'bg-white'
                         }`}
                       >
                         <div className="flex items-start justify-between">
                           <div>
                             <h5 className="text-xs font-black text-slate-800">{rider.name}</h5>
                             <p className="text-[9px] text-slate-400 mt-0.5">📞 {rider.phone}</p>
                           </div>
                           <div className="flex flex-col items-end gap-1">
                             {isFrozen ? (
                               <span className="text-[8px] bg-amber-100 text-amber-800 font-extrabold px-1.5 py-0.5 rounded">
                                 {lang === 'ar' ? 'موقوف مؤقتاً' : 'Frozen'}
                               </span>
                             ) : isBlocked ? (
                               <span className="text-[8px] bg-rose-100 text-rose-800 font-extrabold px-1.5 py-0.5 rounded">
                                 {lang === 'ar' ? 'محظور' : 'Blocked'}
                               </span>
                             ) : isRejected ? (
                               <span className="text-[8px] bg-slate-200 text-slate-600 font-extrabold px-1.5 py-0.5 rounded">
                                 {lang === 'ar' ? 'مرفوض' : 'Rejected'}
                               </span>
                             ) : (
                               <span className="text-[8px] bg-emerald-100 text-emerald-800 font-extrabold px-1.5 py-0.5 rounded">
                                 {lang === 'ar' ? 'نشط' : 'Active'}
                               </span>
                             )}
                           </div>
                         </div>

                         <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2 rounded-lg text-center text-[10px]">
                           <div>
                             <p className="text-[8px] text-slate-400">{lang === 'ar' ? 'الرحلات' : 'Trips'}</p>
                             <p className="font-bold text-slate-700 mt-0.5">{riderPeriodStats.trips}</p>
                           </div>
                           <div>
                             <p className="text-[8px] text-slate-400">{lang === 'ar' ? 'التقييم' : 'Rating'}</p>
                             <p className="font-bold text-slate-700 mt-0.5">{rider.rating?.toFixed(1) ?? '5.0'}</p>
                           </div>
                           <div>
                             <p className="text-[8px] text-slate-400">{lang === 'ar' ? 'إجمالي الإنفاق' : 'Spent'}</p>
                             <p className="font-bold text-slate-700 mt-0.5">{Math.round(riderPeriodStats.spent)} ج.م</p>
                           </div>
                         </div>

                        <div className="grid grid-cols-1 gap-1.5 text-[9px] font-bold">
                          <a
                            href={`https://wa.me/${rider.phone.replace(/[^0-9]/g, '') || '201015555555'}?text=${encodeURIComponent(
                              lang === 'ar'
                                ? `مرحباً ${rider.name}، كيف يمكننا مساعدتك؟`
                                : `Hello ${rider.name}, how can we help you?`
                            )}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors text-center cursor-pointer pointer-events-auto flex items-center justify-center gap-1"
                          >
                            💬 {lang === 'ar' ? 'واتساب' : 'WhatsApp'}
                          </a>

                          {isFrozen ? (
                            <button
                              type="button"
                              onClick={() => onUnfreezeRider(rider.id)}
                              className="py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors cursor-pointer pointer-events-auto col-span-1"
                            >
                              {lang === 'ar' ? 'إلغاء التوقف المؤقت' : 'Unfreeze'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onFreezeRider(rider.id)}
                              className="py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors cursor-pointer pointer-events-auto col-span-1"
                              title="Freeze Rider"
                            >
                              {lang === 'ar' ? 'توقف مؤقت' : 'Freeze'}
                            </button>
                          )}

                          {isBlocked ? (
                            <button
                              type="button"
                              onClick={() => onUnblockRider(rider.id)}
                              className="py-1 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors cursor-pointer pointer-events-auto col-span-1"
                            >
                              {lang === 'ar' ? 'إلغاء الحظر' : 'Unblock'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (confirm(lang === 'ar' ? `هل تريد حظر الراكب ${rider.name}؟` : `Block rider ${rider.name}?`)) {
                                  onBlockRider(rider.id);
                                }
                              }}
                              className="py-1 bg-rose-500 hover:bg-rose-600 text-white rounded-lg transition-colors cursor-pointer pointer-events-auto col-span-1"
                              title="Block Rider"
                            >
                              {lang === 'ar' ? 'حظر' : 'Block'}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              if (confirm(lang === 'ar' ? `حذف الراكب ${rider.name} نهائياً؟` : `Delete rider ${rider.name} permanently?`)) {
                                onDeleteRider(rider.id);
                              }
                            }}
                            className="py-1 bg-slate-100 hover:bg-rose-100 hover:text-rose-700 text-slate-500 rounded-lg transition-colors cursor-pointer pointer-events-auto col-span-1"
                          >
                            {lang === 'ar' ? '🗑️ حذف' : '🗑️ Delete'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: FULL DETAILED TRIP HISTORY (Sijill Al-Rihlaat Al-Kamila) */}
        {activeTab === 'history' && (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-xs space-y-4">
               <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-xs font-black text-slate-800 flex items-center gap-1">
                    <Clock className="w-4 h-4 text-indigo-600" />
                   <span>{lang === 'ar' ? 'سجل الرحلات التفصيلي الكامل' : 'Full Trip History Ledger'}</span>
                   </h3>
                   <p className="text-[9px] text-slate-400 mt-0.5">
                     {lang === 'ar'
                       ? `${isLoadingTrips ? 'جاري التحميل...' : `تم العثور على ${adminTrips.length} رحلة`}`
                       : `${isLoadingTrips ? 'Loading...' : `Showing ${adminTrips.length} trips`}`}
                   </p>
                 </div>
               </div>

              {/* Filtering & Searching Controls */}
              <div className="flex flex-col gap-2">
                <div className="relative pointer-events-auto flex items-center border border-slate-200 rounded-xl px-3 py-2 bg-slate-50">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3" />
                  <input
                    type="text"
                    value={tripHistorySearchQuery}
                    onChange={(e) => setTripHistorySearchQuery(e.target.value)}
                    placeholder={lang === 'ar' ? 'ابحث باسم السائق، الراكب، أو مكان التوصيل...' : 'Search by captain, rider, or location...'}
                    className="w-full pl-6 bg-transparent text-[10px] text-slate-800 focus:outline-none placeholder-slate-400"
                  />
                  {tripHistorySearchQuery && (
                    <button
                      onClick={() => setTripHistorySearchQuery('')}
                      className="text-[9px] text-slate-400 hover:text-slate-600 font-bold ml-1"
                    >
                      ✕
                    </button>
                  )}
                 </div>

                 <div className="flex gap-2">
                   <input
                     type="date"
                     value={tripDateFrom}
                     onChange={(e) => setTripDateFrom(e.target.value)}
                     className="flex-1 text-[9px] bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none focus:border-indigo-500 pointer-events-auto"
                   />
                   <span className="text-[9px] text-slate-400 self-center">{lang === 'ar' ? 'إلى' : 'to'}</span>
                   <input
                     type="date"
                     value={tripDateTo}
                     onChange={(e) => setTripDateTo(e.target.value)}
                     className="flex-1 text-[9px] bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700 focus:outline-none focus:border-indigo-500 pointer-events-auto"
                   />
                 </div>

                 <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none pointer-events-auto">
                  {[
                    { id: 'all', labelAr: 'الكل', labelEn: 'All Trips' },
                    { id: 'COMPLETED', labelAr: 'الرحلات الناجحة ✓', labelEn: 'Completed' },
                    { id: 'ACTIVE', labelAr: 'النشطة حالياً ⚡', labelEn: 'Active Now' },
                    { id: 'CANCELLED', labelAr: 'الملغية ✕', labelEn: 'Cancelled' },
                  ].map((filterItem) => (
                    <button
                      key={filterItem.id}
                      onClick={() => setTripHistoryStatusFilter(filterItem.id as any)}
                      className={`px-3 py-1 text-[9px] font-black rounded-lg transition-colors cursor-pointer pointer-events-auto whitespace-nowrap ${
                        tripHistoryStatusFilter === filterItem.id
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {lang === 'ar' ? filterItem.labelAr : filterItem.labelEn}
                    </button>
                  ))}
                </div>
              </div>

              {/* Table of Detailed Trips */}
              <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-xs">
                {adminTrips.length === 0 ? (
                  <div className="text-center py-12 bg-slate-50 rounded-2xl space-y-2">
                    <span className="text-2xl block">🚖</span>
                    <p className="text-[10px] text-slate-400">
                      {lang === 'ar' ? 'لا توجد رحلات مطابقة لبحثك في السجل.' : 'No matching trips found.'}
                    </p>
                  </div>
                ) : (
                  <div className="min-w-[650px] overflow-hidden">
                    <table className="w-full text-[10px] text-slate-600 border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-extrabold uppercase text-right">
                          <th className="py-2.5 px-3">{lang === 'ar' ? 'التاريخ والوقت' : 'Date & Time'}</th>
                          <th className="py-2.5 px-3">{lang === 'ar' ? 'الكابتن (السائق)' : 'Captain (Driver)'}</th>
                          <th className="py-2.5 px-3">{lang === 'ar' ? 'العميل (الراكب)' : 'Rider'}</th>
                          <th className="py-2.5 px-3">{lang === 'ar' ? 'القيمة الإجمالية' : 'Total Fare'}</th>
                          <th className="py-2.5 px-3">{lang === 'ar' ? 'العمولة' : 'Commission'}</th>
                          <th className="py-2.5 px-3">{lang === 'ar' ? 'حالة الرحلة' : 'Status'}</th>
                          <th className="py-2.5 px-3 text-center">{lang === 'ar' ? 'التحكم' : 'Action'}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                         {adminTrips.map((trip) => {
                          const isCompleted = trip.status === 'COMPLETED';
                          const isCancelled = trip.status === 'CANCELLED';
                          const isExpanded = expandedTripId === trip.id;

                          return (
                            <React.Fragment key={trip.id}>
                              {/* Primary Row */}
                              <tr 
                                onClick={() => setExpandedTripId(isExpanded ? null : trip.id)}
                                className={`hover:bg-slate-50/80 transition-colors cursor-pointer text-right ${isExpanded ? 'bg-indigo-50/20' : ''}`}
                              >
                                <td className="py-3 px-3 font-semibold text-slate-700">
                                  <div className="flex items-center gap-1.5 justify-start">
                                    <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                    <span>{formatTripDate(trip.completedAt || trip.createdAt)}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-3 font-bold text-slate-800">
                                  {trip.driverName || (lang === 'ar' ? 'غير معين 🚫' : 'Unassigned')}
                                </td>
                                <td className="py-3 px-3 font-bold text-slate-800">
                                  <div>
                                    <p>{trip.riderName}</p>
                                    <p className="text-[8px] text-slate-400 font-normal font-mono">{trip.riderPhone}</p>
                                  </div>
                                </td>
                                <td className="py-3 px-3 font-black text-indigo-600">
                                  {trip.fare} {lang === 'ar' ? 'ج.م' : 'EGP'}
                                </td>
                                <td className="py-3 px-3 font-bold text-rose-600">
                                  {trip.commission} {lang === 'ar' ? 'ج.م' : 'EGP'}
                                </td>
                                <td className="py-3 px-3">
                                  <span
                                    className={`px-2 py-0.5 rounded-full font-black text-[8px] inline-block ${
                                      isCompleted
                                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                                        : isCancelled
                                        ? 'bg-rose-50 text-rose-700 border border-rose-100'
                                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                                    }`}
                                  >
                                    {trip.status === 'COMPLETED' && (lang === 'ar' ? 'مكتملة ✓' : 'Completed')}
                                    {trip.status === 'CANCELLED' && (lang === 'ar' ? 'ملغية ✕' : 'Cancelled')}
                                    {trip.status === 'SEARCHING' && (lang === 'ar' ? 'بحث عن كابتن ⏳' : 'Searching')}
                                    {trip.status === 'ACCEPTED' && (lang === 'ar' ? 'تم القبول 🏎️' : 'Accepted')}
                                    {trip.status === 'ARRIVED' && (lang === 'ar' ? 'السائق وصل 📍' : 'Arrived')}
                                    {trip.status === 'STARTED' && (lang === 'ar' ? 'في الطريق 🛣️' : 'In Transit')}
                                  </span>
                                </td>
                                <td className="py-3 px-3 text-center">
                                  <button
                                    type="button"
                                    className="px-2.5 py-1 text-[9px] font-black rounded-lg bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-600 transition-colors cursor-pointer"
                                  >
                                    {isExpanded ? (lang === 'ar' ? 'إخفاء 🔼' : 'Hide 🔼') : (lang === 'ar' ? 'تفاصيل 🔽' : 'Details 🔽')}
                                  </button>
                                </td>
                              </tr>

                              {/* Expanded Row */}
                              {isExpanded && (
                                <tr className="bg-slate-50/40">
                                  <td colSpan={7} className="p-4 border-t border-slate-100">
                                    <div className="bg-white border border-slate-150 rounded-2xl p-4 shadow-xs space-y-3.5 max-w-2xl mx-auto text-right">
                                      <div className="flex justify-between items-center text-[9.5px] border-b border-slate-100 pb-2">
                                        <span className="text-slate-400 font-mono">
                                          Trip GUID: <span className="font-bold text-slate-700">{trip.id}</span>
                                        </span>
                                        {trip.requestedVehicleType && (
                                          <span className="font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                                            {lang === 'ar' ? 'نوع المركبة: ' : 'Vehicle: '}
                                            {trip.requestedVehicleType}
                                          </span>
                                        )}
                                      </div>

                                      {/* Route info */}
                                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[10.5px]">
                                        <div className="space-y-1.5 text-right">
                                          <p className="font-bold text-slate-400 text-[8.5px] uppercase">{lang === 'ar' ? '📍 نقطة الركوب' : '📍 Pickup'}</p>
                                           <p className="font-black text-slate-800">{getLocationName(trip.pickup, lang)}</p>
                                           <p className="text-[8px] text-slate-400 font-mono">
                                             {trip.pickup?.lat != null && trip.pickup?.lng != null
                                               ? `Lat: ${trip.pickup.lat.toFixed(5)}, Lng: ${trip.pickup.lng.toFixed(5)}`
                                               : lang === 'ar' ? 'غير متوفر' : 'N/A'}
                                           </p>
                                        </div>
                                        <div className="space-y-1.5 text-right">
                                          <p className="font-bold text-slate-400 text-[8.5px] uppercase">{lang === 'ar' ? '🏁 وجهة الوصول' : '🏁 Dropoff'}</p>
                                           <p className="font-black text-slate-800">{getLocationName(trip.dropoff, lang)}</p>
                                           <p className="text-[8px] text-slate-400 font-mono">
                                             {trip.dropoff?.lat != null && trip.dropoff?.lng != null
                                               ? `Lat: ${trip.dropoff.lat.toFixed(5)}, Lng: ${trip.dropoff.lng.toFixed(5)}`
                                               : lang === 'ar' ? 'غير متوفر' : 'N/A'}
                                           </p>
                                        </div>
                                      </div>

                                      {/* Distance and Details */}
                                      <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-xl text-center border border-slate-100">
                                        <div>
                                          <span className="text-slate-400 text-[8.5px] block">{lang === 'ar' ? 'المسافة الإجمالية' : 'Total Distance'}</span>
                                          <span className="font-black text-slate-800">{trip.distance.toFixed(2)} {lang === 'ar' ? 'كم' : 'km'}</span>
                                        </div>
                                        <div>
                                          <span className="text-slate-400 text-[8.5px] block">{lang === 'ar' ? 'أجرة الرحلة كاملة' : 'Total Fare'}</span>
                                          <span className="font-black text-indigo-600">{trip.fare} {lang === 'ar' ? 'ج.م' : 'EGP'}</span>
                                        </div>
                                        <div>
                                          <span className="text-slate-400 text-[8.5px] block">{lang === 'ar' ? 'نصيب المنصة (العمولة)' : 'Platform Commission'}</span>
                                          <span className="font-black text-rose-600">{trip.commission} {lang === 'ar' ? 'ج.م' : 'EGP'}</span>
                                        </div>
                                      </div>

                                      {/* Ratings details */}
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-right">
                                        {/* Rider Rating to Driver */}
                                        <div className="bg-slate-50/60 p-3 rounded-xl space-y-1.5">
                                          <p className="text-[8px] text-slate-400 uppercase font-black">{lang === 'ar' ? '⭐ تقييم الراكب للكابتن' : '⭐ Rider Rating to Driver'}</p>
                                          {trip.riderRatingToDriver !== undefined ? (
                                            <div className="space-y-1">
                                              <div className="flex items-center gap-1 justify-start">
                                                <div className="flex text-amber-400">
                                                  {Array.from({ length: 5 }).map((_, i) => (
                                                    <Star
                                                      key={i}
                                                      className={`w-3.5 h-3.5 ${i < (trip.riderRatingToDriver || 5) ? 'fill-amber-400 text-amber-400' : 'text-slate-200'}`}
                                                    />
                                                  ))}
                                                </div>
                                                <span className="text-[9px] text-slate-600 font-extrabold">({trip.riderRatingToDriver})</span>
                                              </div>
                                              {trip.riderFeedbackTags && trip.riderFeedbackTags.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                  {trip.riderFeedbackTags.map((t, idx) => (
                                                    <span key={idx} className="text-[7.5px] bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded-md font-semibold border border-amber-100/40">{t}</span>
                                                  ))}
                                                </div>
                                              )}
                                              {trip.riderFeedbackComment && (
                                                <p className="text-[9px] text-slate-600 bg-white border border-slate-100/80 p-2 rounded-lg italic mt-1 leading-normal">
                                                  "{trip.riderFeedbackComment}"
                                                </p>
                                              )}
                                            </div>
                                          ) : (
                                            <p className="text-[9px] text-slate-400 italic">{lang === 'ar' ? 'لم يتم التقييم بعد' : 'No rating submitted yet'}</p>
                                          )}
                                        </div>

                                        {/* Driver Rating to Rider */}
                                        <div className="bg-slate-50/60 p-3 rounded-xl space-y-1.5">
                                          <p className="text-[8px] text-slate-400 uppercase font-black">{lang === 'ar' ? '⭐ تقييم الكابتن للعميل' : '⭐ Driver Rating to Rider'}</p>
                                          {trip.driverRatingToRider !== undefined ? (
                                            <div className="space-y-1">
                                              <div className="flex items-center gap-1 justify-start">
                                                <div className="flex text-indigo-500">
                                                  {Array.from({ length: 5 }).map((_, i) => (
                                                    <Star
                                                      key={i}
                                                      className={`w-3.5 h-3.5 ${i < (trip.driverRatingToRider || 5) ? 'fill-indigo-500 text-indigo-500' : 'text-slate-200'}`}
                                                    />
                                                  ))}
                                                </div>
                                                <span className="text-[9px] text-slate-600 font-extrabold">({trip.driverRatingToRider})</span>
                                              </div>
                                              {trip.driverFeedbackTags && trip.driverFeedbackTags.length > 0 && (
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                  {trip.driverFeedbackTags.map((t, idx) => (
                                                    <span key={idx} className="text-[7.5px] bg-indigo-50 text-indigo-800 px-1.5 py-0.5 rounded-md font-semibold border border-indigo-100/40">{t}</span>
                                                  ))}
                                                </div>
                                              )}
                                              {trip.driverFeedbackComment && (
                                                <p className="text-[9px] text-slate-600 bg-white border border-slate-100/80 p-2 rounded-lg italic mt-1 leading-normal">
                                                  "{trip.driverFeedbackComment}"
                                                </p>
                                              )}
                                            </div>
                                          ) : (
                                            <p className="text-[9px] text-slate-400 italic">{lang === 'ar' ? 'لم يتم التقييم بعد' : 'No rating submitted yet'}</p>
                                          )}
                                         </div>
                                       </div>

                                       {(trip.status === 'SEARCHING' || trip.status === 'ACCEPTED' || trip.status === 'ARRIVED' || trip.status === 'STARTED') && (
                                         <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100">
                                           {trip.status !== 'STARTED' && onAdminForceCancelTrip && (
                                             <button
                                               type="button"
                                               onClick={(e) => {
                                                 e.stopPropagation();
                                                 onAdminForceCancelTrip(trip.id);
                                               }}
                                               className="px-3 py-1.5 text-[9px] font-black rounded-lg bg-rose-50 text-rose-700 border border-rose-100 hover:bg-rose-100 transition-colors cursor-pointer pointer-events-auto"
                                             >
                                               {lang === 'ar' ? 'إلغاء الرحلة' : 'Cancel Trip'}
                                             </button>
                                           )}
                                           {trip.status === 'STARTED' && onAdminForceEndTrip && (
                                             <button
                                               type="button"
                                               onClick={(e) => {
                                                 e.stopPropagation();
                                                 onAdminForceEndTrip(trip.id);
                                               }}
                                               className="px-3 py-1.5 text-[9px] font-black rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 hover:bg-emerald-100 transition-colors cursor-pointer pointer-events-auto"
                                             >
                                               {lang === 'ar' ? 'إنهاء الرحلة' : 'End Trip'}
                                             </button>
                                           )}
                                         </div>
                                       )}
                                     </div>
                                   </td>
                                 </tr>
                               )}
                             </React.Fragment>
                           );
                         })}
                       </tbody>
                     </table>
                   </div>
                 )}
               </div>

              {/* Load More */}
              {adminTripsHasMore && (
                <div className="text-center pt-3">
                  <button
                    type="button"
                    onClick={() => loadAdminTrips(false)}
                    disabled={isLoadingTrips}
                    className="px-6 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-xl transition-colors cursor-pointer pointer-events-auto disabled:opacity-50"
                  >
                    {isLoadingTrips ? (lang === 'ar' ? 'جاري التحميل...' : 'Loading...') : (lang === 'ar' ? 'عرض المزيد من الرحلات' : 'Load More Trips')}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: ADVANCED RECHARTS ANALYTICS & INSIGHTS (Charts Page) */}
        {activeTab === 'analytics' && (
          <div className="space-y-4 animate-fade-in text-right">
            {/* Real Stats Dashboard Bento Grid */}
            <div className="grid grid-cols-2 gap-3">
              
              {/* Card 1: App Commissions & Gross Revenue (Col-span-2) */}
              <div className="col-span-2 bg-gradient-to-br from-indigo-900 via-indigo-850 to-slate-900 text-white p-4 rounded-2xl shadow-md border border-indigo-500/20 relative overflow-hidden">
                <div className="absolute right-0 bottom-0 translate-x-4 translate-y-4 opacity-10">
                  <BarChart2 className="w-36 h-36" />
                </div>
                <div className="flex justify-between items-start">
                  <div>
                    <span className="px-2 py-0.5 text-[8px] font-extrabold bg-indigo-500/30 text-indigo-200 rounded-full border border-indigo-500/30">
                      {lang === 'ar' ? 'الملخص المالي العام' : 'Financial Summary'}
                    </span>
                    <p className="text-[10px] text-slate-300 font-bold mt-1.5">
                      {lang === 'ar' ? 'أرباح عمولات التطبيق المستحقة' : 'Total App Commissions'}
                    </p>
                    <p className="text-2xl font-black mt-1 text-amber-300">
                      {displayTotalCommission} {lang === 'ar' ? 'ج.م' : 'EGP'}
                    </p>
                  </div>
                  <div className="p-2.5 bg-white/10 rounded-xl">
                    <DollarSign className="w-5 h-5 text-amber-400" />
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-white/10 flex justify-between items-center text-[9px] text-slate-300">
                  <div>
                    <span>{lang === 'ar' ? 'إجمالي قيمة المبيعات (الرحلات):' : 'Total Gross Revenue:'} </span>
                    <span className="font-extrabold text-white">{displayTotalRevenue} {lang === 'ar' ? 'ج.م' : 'EGP'}</span>
                  </div>
                  <div className="flex items-center gap-0.5 text-emerald-400 font-bold">
                    <TrendingUp className="w-3 h-3" />
                    <span>+{stats.commissionRate}% {lang === 'ar' ? 'عمولة' : 'Commission'}</span>
                  </div>
                </div>
              </div>

              {/* Card 2: Visitors Counter (عدد الزوار) */}
              <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs relative overflow-hidden flex flex-col justify-between">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
                    {lang === 'ar' ? 'عدد الزوار والزيارات' : 'Total App Visitors'}
                  </span>
                  <div className="p-1.5 bg-sky-50 text-sky-600 rounded-lg">
                    <Globe className="w-4 h-4 animate-spin-slow" />
                  </div>
                </div>
                <div className="mt-3 text-right">
                  <p className="text-lg font-black text-slate-800">{visitorCount.toLocaleString()}</p>
                  <p className="text-[8px] text-emerald-600 font-bold mt-0.5">
                    {lang === 'ar' ? '● متصل ومحدث حياً' : '● Live session tracker'}
                  </p>
                </div>
              </div>

              {/* Card 3: Real Riders / Users (المستخدمون الحقيقيون) */}
              <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs relative overflow-hidden flex flex-col justify-between">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
                    {lang === 'ar' ? 'مستخدمين حقيقيين (الركاب)' : 'Verified Real Riders'}
                  </span>
                  <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                    <Users className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 text-right">
                  <p className="text-lg font-black text-slate-800">{riders.length}</p>
                  <p className="text-[8px] text-slate-400 font-bold mt-0.5">
                    {lang === 'ar' ? 'حسابات ركاب مسجلة ونشطة' : 'Registered active accounts'}
                  </p>
                </div>
              </div>

              {/* Card 4: Completed Trips (الطلبات الناجحة) */}
              <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs relative overflow-hidden flex flex-col justify-between">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
                    {lang === 'ar' ? 'طلبات ناجحة (تمت)' : 'Completed Trips'}
                  </span>
                  <div className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg">
                    <CheckCircle className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 text-right">
                  <p className="text-lg font-black text-slate-800">{completedCount}</p>
                  <span className="inline-block text-[7.5px] font-extrabold bg-emerald-50 text-emerald-700 px-1.5 py-0.5 rounded-full border border-emerald-100 mt-1">
                    {successRate}% {lang === 'ar' ? 'معدل النجاح' : 'Success rate'}
                  </span>
                </div>
              </div>

              {/* Card 5: Canceled Trips (الطلبات الملغاة) */}
              <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs relative overflow-hidden flex flex-col justify-between">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
                    {lang === 'ar' ? 'طلبات ملغاة' : 'Canceled Trips'}
                  </span>
                  <div className="p-1.5 bg-rose-50 text-rose-600 rounded-lg">
                    <ShieldAlert className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 text-right">
                  <p className="text-lg font-black text-slate-800">{cancelledCount}</p>
                  <span className="inline-block text-[7.5px] font-extrabold bg-rose-50 text-rose-700 px-1.5 py-0.5 rounded-full border border-rose-100 mt-1">
                    {cancelRate}% {lang === 'ar' ? 'معدل الإلغاء' : 'Cancellation rate'}
                  </span>
                </div>
              </div>

              {/* Card 5.5: Driver live status (السائقين المتاحين + غير المتصلين) */}
              <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs relative overflow-hidden flex flex-col justify-between">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
                    {lang === 'ar' ? 'حالة الكباتن المباشرة' : 'Live Driver Status'}
                  </span>
                  <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
                    <Car className="w-4 h-4" />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-right">
                  <div>
                    <p className="text-lg font-black text-emerald-700">{availableDrivers}</p>
                    <p className="text-[7.5px] text-slate-400 font-bold">
                      {lang === 'ar' ? 'سائق متاح الآن' : 'Available now'}
                    </p>
                  </div>
                  <div>
                    <p className="text-lg font-black text-slate-500">{offlineDrivers}</p>
                    <p className="text-[7.5px] text-slate-400 font-bold">
                      {lang === 'ar' ? 'سائق غير متصل' : 'Offline drivers'}
                    </p>
                  </div>
                </div>
              </div>

              {/* Card 6: Drivers / Captains overview (الكباتن المسجلين) - Col span 2 */}
              <div className="col-span-2 bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
                <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-1.5">
                    <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg shrink-0">
                      <Award className="w-4 h-4" />
                    </div>
                    <div className="text-right">
                      <h4 className="text-[10px] font-black text-slate-800">
                        {lang === 'ar' ? 'السائقين والكباتن المسجلين' : 'Captains & Drivers Directory'}
                      </h4>
                      <p className="text-[7.5px] text-slate-400">
                        {lang === 'ar' ? 'إجمالي السائقين الذين أتموا الفحص أو بانتظار الموافقة' : 'All onboarded and pending taxi captains'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-lg font-black text-slate-800">{drivers.length}</span>
                    <span className="text-[9px] text-slate-400 font-bold block leading-none">
                      {lang === 'ar' ? 'سائق مسجل' : 'Captains'}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-3 text-[9px] text-center">
                  <div className="bg-emerald-50/40 p-1.5 rounded-xl border border-emerald-100/30">
                    <p className="font-extrabold text-emerald-800">{onlineDrivers}</p>
                    <p className="text-[7.5px] text-emerald-600 mt-0.5">{lang === 'ar' ? 'نشطين (أونلاين)' : 'Active (Online)'}</p>
                  </div>
                  <div className="bg-indigo-50/40 p-1.5 rounded-xl border border-indigo-100/30">
                    <p className="font-extrabold text-indigo-800">{approvedDrivers}</p>
                    <p className="text-[7.5px] text-indigo-600 mt-0.5">{lang === 'ar' ? 'مقبولين ومعتمدين' : 'Approved'}</p>
                  </div>
                  <div className="bg-amber-50/40 p-1.5 rounded-xl border border-amber-100/30">
                    <p className="font-extrabold text-amber-800">{drivers.filter(d => d.approvalStatus === 'PENDING').length}</p>
                    <p className="text-[7.5px] text-amber-600 mt-0.5">{lang === 'ar' ? 'بانتظار الموافقة' : 'Pending Verification'}</p>
                  </div>
                 </div>
               </div>
             </div>

            {/* Card 7: Profit & Loss / Financial Health */}
            <div className="col-span-2 bg-gradient-to-br from-emerald-900 via-emerald-800 to-slate-900 text-white p-4 rounded-2xl shadow-md border border-emerald-500/20 relative overflow-hidden">
              <div className="absolute left-0 top-0 -translate-x-4 -translate-y-4 opacity-10">
                <TrendingUp className="w-32 h-32" />
              </div>
              <div className="flex justify-between items-start relative z-10">
                <div>
                  <span className="px-2 py-0.5 text-[8px] font-extrabold bg-emerald-500/30 text-emerald-200 rounded-full border border-emerald-500/30">
                    {lang === 'ar' ? 'سجل الأرباح والخسائر' : 'Profit & Loss Archive'}
                  </span>
                  <p className="text-[10px] text-slate-300 font-bold mt-1.5">
                    {lang === 'ar' ? 'صافي أرباح المنصة وأرباح السائقين' : 'Platform net earnings & driver payouts'}
                  </p>
                  <div className="mt-2 flex gap-3">
                    <div>
                      <p className="text-[8px] text-slate-400">{lang === 'ar' ? 'إجمالي الدخل' : 'Gross Revenue'}</p>
                      <p className="text-sm font-black text-white">{displayTotalRevenue} {lang === 'ar' ? 'ج.م' : 'EGP'}</p>
                    </div>
                    <div>
                      <p className="text-[8px] text-slate-400">{lang === 'ar' ? 'عمولة المنصة' : 'Platform Commission'}</p>
                      <p className="text-sm font-black text-amber-300">{displayTotalCommission} {lang === 'ar' ? 'ج.م' : 'EGP'}</p>
                    </div>
                    <div>
                      <p className="text-[8px] text-slate-400">{lang === 'ar' ? 'أرباح السائقين' : 'Driver Earnings'}</p>
                      <p className="text-sm font-black text-emerald-300">{displayDriverEarnings} {lang === 'ar' ? 'ج.م' : 'EGP'}</p>
                    </div>
                  </div>
                </div>
                <div className="p-2.5 bg-white/10 rounded-xl">
                  <DollarSign className="w-5 h-5 text-emerald-400" />
                </div>
              </div>
            </div>

            {/* Card 8: Trip Status Analysis */}
            <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
                  {lang === 'ar' ? 'تحليل حالات الرحلات' : 'Trip Status Breakdown'}
                </span>
                <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                  <BarChart2 className="w-4 h-4" />
                </div>
              </div>
              <div className="h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={getTripStatusData()}
                      cx="50%"
                      cy="50%"
                      innerRadius={30}
                      outerRadius={55}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {getTripStatusData().map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} stroke="none" />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '10px' }}
                      formatter={(value: any, name: any) => [`${value} ${lang === 'ar' ? 'رحلة' : 'trips'}`, name]}
                    />
                    <Legend
                      iconType="circle"
                      wrapperStyle={{ fontSize: '9px', fontFamily: 'sans-serif' }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Card 9: Driver Performance Metrics */}
            <div className="bg-white border border-slate-200 p-3.5 rounded-2xl shadow-xs">
              <div className="flex justify-between items-center mb-2">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider">
                  {lang === 'ar' ? 'أداء السائقين' : 'Driver Performance'}
                </span>
                <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg">
                  <Award className="w-4 h-4" />
                </div>
              </div>
              <div className="h-40 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={getDriverPerformanceData()} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" stroke="#64748b" tickLine={false} tick={{ fontSize: 9 }} />
                    <YAxis stroke="#64748b" tickLine={false} tick={{ fontSize: 9 }} />
                    <Tooltip
                      contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff', fontSize: '10px' }}
                    />
                    <Bar dataKey={lang === 'ar' ? 'أرباح' : 'Earnings'} fill="#10b981" radius={[4, 4, 0, 0]} barSize={16} />
                    <Bar dataKey={lang === 'ar' ? 'عمولة' : 'Commission'} fill="#ef4444" radius={[4, 4, 0, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Rechart 1: Most Active Drivers */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
              <div>
                <h4 className="text-xs font-black text-slate-800 flex items-center gap-1">
                  <Award className="w-4 h-4 text-amber-500 animate-bounce" />
                  <span>{lang === 'ar' ? 'السائقين الأكثر نشاطاً (حسب الرحلات)' : 'Most Active Drivers (by Rides)'}</span>
                </h4>
                <p className="text-[9px] text-slate-400 mt-0.5">
                  {lang === 'ar'
                    ? 'يعرض إجمالي عدد الرحلات المكتملة المحتسبة لكل كابتن مسجل.'
                    : 'Displays total successful rides completed per registered captain.'}
                </p>
              </div>

              {/* Recharts BarChart container */}
              <div className="h-44 w-full text-[9px] font-bold pointer-events-auto">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={getActiveDriversData()}
                    margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" stroke="#64748b" tickLine={false} />
                    <YAxis stroke="#64748b" tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff' }}
                    />
                    <Bar
                      dataKey={lang === 'ar' ? 'الرحلات' : 'Rides'}
                      fill="#4f46e5"
                      radius={[6, 6, 0, 0]}
                      barSize={24}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Rechart 2: Busiest Days */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
              <div>
                <h4 className="text-xs font-black text-slate-800 flex items-center gap-1">
                  <Calendar className="w-4 h-4 text-indigo-600" />
                  <span>{lang === 'ar' ? 'الأيام الأكثر ازدحاماً بالرحلات' : 'Busiest Days of the Week'}</span>
                </h4>
                <p className="text-[9px] text-slate-400 mt-0.5">
                  {lang === 'ar'
                    ? 'يساعد في تتبع نشاط وحجم الطلب اليومي لتوزيع الكباتن.'
                    : 'Helps track trip demand fluctuations across different days of the week.'}
                </p>
              </div>

              {/* Recharts AreaChart container */}
              <div className="h-44 w-full text-[9px] font-bold pointer-events-auto">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={getBusiestDaysData()}
                    margin={{ top: 10, right: 10, left: -25, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="colorRides" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.4}/>
                        <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="name" stroke="#64748b" tickLine={false} />
                    <YAxis stroke="#64748b" tickLine={false} />
                    <Tooltip
                      contentStyle={{ background: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff' }}
                    />
                    <Area
                      type="monotone"
                      dataKey={lang === 'ar' ? 'عدد الرحلات' : 'Rides'}
                      stroke="#0ea5e9"
                      strokeWidth={2.5}
                      fillOpacity={1}
                      fill="url(#colorRides)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Smart Business Insights card */}
            <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-1 text-indigo-900 font-bold text-xs">
                <Sparkles className="w-4 h-4 text-indigo-600" />
                <h5>{lang === 'ar' ? 'رؤى إدارية مدعومة بالبيانات وتحليل حقيقي' : 'Real Data-Driven Insights'}</h5>
              </div>
              <ul className="text-[9.5px] text-indigo-800 space-y-1.5 list-disc list-inside text-right pr-1">
                {lang === 'ar' ? (
                  <>
                    <li>الكباتن المسجلين في النظام: <strong>{drivers.length} سائق</strong>، منهم <strong>{onlineDrivers} متاحون حياً الآن</strong> لتلبية طلبات الزوار المباشرة.</li>
                    <li>بلغت نسبة الطلبات الناجحة المكتملة <strong>{successRate}%</strong> من إجمالي <strong>{totalRides} طلب حقيقي</strong> مسجل في سجلات قاعدة البيانات.</li>
                    <li>إجمالي أرباح العمولات المستحصلة للمنصة بلغت <strong>{displayTotalCommission} ج.م</strong> من إجمالي مبيعات بلغت <strong>{displayTotalRevenue} ج.م</strong>.</li>
                    <li>معدل إلغاء الرحلات من المستخدمين يقف عند <strong>{cancelRate}%</strong> وهو يقع ضمن الحدود الطبيعية والممتازة لنوع الخدمة.</li>
                  </>
                ) : (
                  <>
                    <li>Active directory contains <strong>{drivers.length} drivers</strong>, with <strong>{onlineDrivers} captains currently live</strong> to satisfy users.</li>
                    <li>The system records a trip success rate of <strong>{successRate}%</strong> out of <strong>{totalRides} total verified requests</strong>.</li>
                    <li>Platform net earnings reached <strong>{displayTotalCommission} EGP</strong> from gross trip sales of <strong>{displayTotalRevenue} EGP</strong>.</li>
                    <li>User cancellation rate stands stably at <strong>{cancelRate}%</strong>, which is extremely healthy for on-demand services.</li>
                  </>
                )}
              </ul>
            </div>
          </div>
        )}

        {/* TAB: STORE ADS MANAGEMENT */}
        {activeTab === 'ads' && (() => {
          const selectedAdObj = ads.find((a) => a.id === selectedAdId);
          const displayedAds = ads.filter((ad) => {
            if (selectedAdId !== 'all' && ad.id !== selectedAdId) return false;
            if (adFilterQuery.trim()) {
              const q = adFilterQuery.toLowerCase().trim();
              const matchName = ad.storeName.toLowerCase().includes(q);
              const matchOffer = ad.offerText.toLowerCase().includes(q);
              const matchPhone = ad.phoneNumber.includes(q);
              if (!matchName && !matchOffer && !matchPhone) return false;
            }
            if (adFilterStatus === 'active' && !ad.isActive) return false;
            if (adFilterStatus === 'inactive' && ad.isActive) return false;
            if (adFilterPlacement !== 'all' && ad.placement !== 'all' && ad.placement !== adFilterPlacement) return false;
            return true;
          }).sort((a, b) => {
            if (adSortBy === 'views') return (b.impressions || 0) - (a.impressions || 0);
            if (adSortBy === 'interactions') return ((b.clicks || 0) + (b.whatsappClicks || 0)) - ((a.clicks || 0) + (a.whatsappClicks || 0));
            if (adSortBy === 'revenue') return (b.adFee || 0) - (a.adFee || 0);
            return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
          });

          return (
            <div className="space-y-4">
              {/* Total Ad Revenue & Comprehensive Analytics Header Card */}
              <div className="bg-gradient-to-r from-teal-900 via-emerald-900 to-slate-900 text-white rounded-2xl p-4 shadow-md space-y-3">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-black text-emerald-400">
                      <Megaphone className="w-4 h-4" />
                      <span>{lang === 'ar' ? 'إحصائيات إعلانات المحلات التجارية' : 'Store Ads Analytics'}</span>
                    </div>
                    <p className="text-[10px] text-slate-300">
                      {lang === 'ar'
                        ? 'متابعة شاملة للرسوم المحصلة وعدد المشاهدات والاتصالات ونقرات الواتساب لكل إعلان'
                        : 'Comprehensive tracking of revenues, impressions, calls, and WhatsApp clicks per ad'}
                    </p>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-300 bg-white/10 border border-white/10 px-2.5 py-1 rounded-full">
                    {ads.filter(a => a.isActive).length} {lang === 'ar' ? 'إعلان نشط' : 'active ads'}
                  </span>
                </div>

                {/* Grid of 4 Key Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                  <div className="bg-white/10 backdrop-blur-md p-2.5 rounded-xl border border-white/10 text-right">
                    <p className="text-[9px] text-emerald-300 font-bold">{lang === 'ar' ? '💰 إجمالي الأرباح:' : '💰 Total Revenue:'}</p>
                    <p className="text-base font-black text-white mt-0.5">
                      {ads.reduce((acc, a) => acc + (a.adFee || 0), 0).toLocaleString()} <span className="text-[10px] font-normal">{lang === 'ar' ? 'ج.م' : 'EGP'}</span>
                    </p>
                  </div>

                  <div className="bg-white/10 backdrop-blur-md p-2.5 rounded-xl border border-white/10 text-right">
                    <p className="text-[9px] text-blue-300 font-bold">{lang === 'ar' ? '👁️ إجمالي المشاهدات:' : '👁️ Total Views:'}</p>
                    <p className="text-base font-black text-white mt-0.5">
                      {ads.reduce((acc, a) => acc + (a.impressions || 0), 0).toLocaleString()} <span className="text-[10px] font-normal">{lang === 'ar' ? 'مرة' : 'times'}</span>
                    </p>
                  </div>

                  <div className="bg-white/10 backdrop-blur-md p-2.5 rounded-xl border border-white/10 text-right">
                    <p className="text-[9px] text-teal-300 font-bold">{lang === 'ar' ? '📞 الاتصالات الهاتفية:' : '📞 Phone Calls:'}</p>
                    <p className="text-base font-black text-white mt-0.5">
                      {ads.reduce((acc, a) => acc + (a.clicks || 0), 0).toLocaleString()} <span className="text-[10px] font-normal">{lang === 'ar' ? 'اتصال' : 'calls'}</span>
                    </p>
                  </div>

                  <div className="bg-white/10 backdrop-blur-md p-2.5 rounded-xl border border-white/10 text-right">
                    <p className="text-[9px] text-emerald-300 font-bold">{lang === 'ar' ? '💬 نقرات الواتساب:' : '💬 WhatsApp Clicks:'}</p>
                    <p className="text-base font-black text-white mt-0.5">
                      {ads.reduce((acc, a) => acc + (a.whatsappClicks || 0), 0).toLocaleString()} <span className="text-[10px] font-normal">{lang === 'ar' ? 'نقرة' : 'clicks'}</span>
                    </p>
                  </div>
                </div>
              </div>

              {/* SEARCH & FILTER BAR */}
              <div className="bg-white border border-slate-200 rounded-2xl p-3 shadow-xs space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-800 flex items-center gap-1">
                    🔍 {lang === 'ar' ? 'تصفية وإحصائيات حسب الإعلان:' : 'Filter & Analytics by Ad:'}
                  </span>
                  {(selectedAdId !== 'all' || adFilterQuery || adFilterStatus !== 'all' || adFilterPlacement !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedAdId('all');
                        setAdFilterQuery('');
                        setAdFilterStatus('all');
                        setAdFilterPlacement('all');
                        setAdSortBy('newest');
                      }}
                      className="text-[9px] font-bold text-rose-600 hover:text-rose-700 bg-rose-50 px-2 py-0.5 rounded-md cursor-pointer"
                    >
                      🔄 {lang === 'ar' ? 'إعادة ضبط الفلاتر' : 'Reset Filters'}
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                  {/* Select Specific Ad */}
                  <div className="space-y-0.5">
                    <label className="text-[8px] font-bold text-slate-500">{lang === 'ar' ? 'اختر الإعلان للتفاصيل:' : 'Select Ad:'}</label>
                    <select
                      value={selectedAdId}
                      onChange={(e) => setSelectedAdId(e.target.value)}
                      className="w-full text-[10px] bg-teal-50/60 border border-teal-200 text-teal-900 font-bold rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-teal-500"
                    >
                      <option value="all">{lang === 'ar' ? '📊 كل الإعلانات (عرض شامل)' : '📊 All Ads'}</option>
                      {ads.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.storeName} ({a.adFee || 0} ج.م - {a.impressions || 0} ظهور)
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Search Query */}
                  <div className="space-y-0.5">
                    <label className="text-[8px] font-bold text-slate-500">{lang === 'ar' ? 'بحث بالاسم / الهاتف:' : 'Search:'}</label>
                    <input
                      type="text"
                      placeholder={lang === 'ar' ? 'اسم المحل أو العرض...' : 'Store or offer...'}
                      value={adFilterQuery}
                      onChange={(e) => setAdFilterQuery(e.target.value)}
                      className="w-full text-[10px] bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  {/* Filter by Status */}
                  <div className="space-y-0.5">
                    <label className="text-[8px] font-bold text-slate-500">{lang === 'ar' ? 'الحالة:' : 'Status:'}</label>
                    <select
                      value={adFilterStatus}
                      onChange={(e) => setAdFilterStatus(e.target.value as any)}
                      className="w-full text-[10px] bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-teal-500"
                    >
                      <option value="all">{lang === 'ar' ? 'الكل (مفعل وغير مفعل)' : 'All Statuses'}</option>
                      <option value="active">{lang === 'ar' ? 'المفعلة فقط' : 'Active Only'}</option>
                      <option value="inactive">{lang === 'ar' ? 'المتوقفة فقط' : 'Inactive Only'}</option>
                    </select>
                  </div>

                  {/* Sort By */}
                  <div className="space-y-0.5">
                    <label className="text-[8px] font-bold text-slate-500">{lang === 'ar' ? 'ترتيب حسب:' : 'Sort By:'}</label>
                    <select
                      value={adSortBy}
                      onChange={(e) => setAdSortBy(e.target.value as any)}
                      className="w-full text-[10px] bg-slate-50 border border-slate-200 text-slate-700 rounded-xl px-2.5 py-1.5 focus:outline-none focus:border-teal-500"
                    >
                      <option value="newest">{lang === 'ar' ? 'الأحدث أولاً' : 'Newest'}</option>
                      <option value="views">{lang === 'ar' ? 'الأعلى مشاهدة 👁️' : 'Highest Views'}</option>
                      <option value="interactions">{lang === 'ar' ? 'الأعلى تفاعلاً 📞💬' : 'Highest Interactions'}</option>
                      <option value="revenue">{lang === 'ar' ? 'الأعلى إيراداً 💰' : 'Highest Revenue'}</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* SINGLE AD DETAILED ANALYTICS CARD (If specific ad selected) */}
              {selectedAdObj && (() => {
                const totalInteractions = (selectedAdObj.clicks || 0) + (selectedAdObj.whatsappClicks || 0);
                const impressions = selectedAdObj.impressions || 0;
                const ctr = impressions > 0 ? ((totalInteractions / impressions) * 100).toFixed(1) : '0.0';

                return (
                  <div className="bg-gradient-to-br from-slate-900 via-teal-950 to-slate-900 border-2 border-teal-500/30 text-white rounded-2xl p-4 shadow-xl space-y-3 animate-in fade-in duration-300">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2">
                      <div className="flex items-center gap-3">
                        {adImageError[selectedAdObj.id] ? (
                          <div className="w-12 h-12 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white font-black text-lg">
                            {selectedAdObj.storeName.charAt(0)}
                          </div>
                        ) : (
                          <img src={selectedAdObj.imageUrl} alt={selectedAdObj.storeName} className="w-12 h-12 rounded-xl object-cover border border-white/20 bg-white/10" onError={() => setAdImageError(prev => ({ ...prev, [selectedAdObj.id]: true }))} />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-black text-white">{selectedAdObj.storeName}</h3>
                            <span className={`text-[8px] font-bold px-2 py-0.5 rounded-full ${selectedAdObj.isActive ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' : 'bg-slate-700 text-slate-400'}`}>
                              {selectedAdObj.isActive ? (lang === 'ar' ? 'مفعّل' : 'Active') : (lang === 'ar' ? 'متوقف' : 'Off')}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-300 mt-0.5">{selectedAdObj.offerText}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedAdId('all')}
                        className="text-[9px] font-bold text-teal-300 hover:text-white bg-white/10 px-2.5 py-1 rounded-lg border border-white/10 cursor-pointer"
                      >
                        ✖ {lang === 'ar' ? 'إغلاق التقرير' : 'Close Report'}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                      <div className="bg-white/10 backdrop-blur-md p-2.5 rounded-xl border border-white/10 text-right">
                        <p className="text-[8px] text-emerald-300 font-bold">{lang === 'ar' ? '💰 رسوم الإعلان:' : 'Ad Fee:'}</p>
                        <p className="text-sm font-black text-white mt-0.5">{selectedAdObj.adFee || 0} ج.م</p>
                      </div>

                      <div className="bg-white/10 backdrop-blur-md p-2.5 rounded-xl border border-white/10 text-right">
                        <p className="text-[8px] text-blue-300 font-bold">{lang === 'ar' ? '👁️ المشاهدات (الظهور):' : 'Impressions:'}</p>
                        <p className="text-sm font-black text-white mt-0.5">{impressions.toLocaleString()}</p>
                      </div>

                      <div className="bg-white/10 backdrop-blur-md p-2.5 rounded-xl border border-white/10 text-right">
                        <p className="text-[8px] text-teal-300 font-bold">{lang === 'ar' ? '📞 اتصالات الهاتف:' : 'Calls:'}</p>
                        <p className="text-sm font-black text-white mt-0.5">{selectedAdObj.clicks || 0}</p>
                      </div>

                      <div className="bg-white/10 backdrop-blur-md p-2.5 rounded-xl border border-white/10 text-right">
                        <p className="text-[8px] text-emerald-300 font-bold">{lang === 'ar' ? '💬 نقرات الواتساب:' : 'WhatsApp:'}</p>
                        <p className="text-sm font-black text-white mt-0.5">{selectedAdObj.whatsappClicks || 0}</p>
                      </div>

                      <div className="bg-white/10 backdrop-blur-md p-2.5 rounded-xl border border-white/10 text-right">
                        <p className="text-[8px] text-amber-300 font-bold">{lang === 'ar' ? '⚡ إجمالي التفاعل:' : 'Total Contact:'}</p>
                        <p className="text-sm font-black text-white mt-0.5">{totalInteractions}</p>
                      </div>

                      <div className="bg-white/10 backdrop-blur-md p-2.5 rounded-xl border border-white/10 text-right">
                        <p className="text-[8px] text-purple-300 font-bold">{lang === 'ar' ? '🎯 نسبة التحويل (CTR):' : 'CTR Rate:'}</p>
                        <p className="text-sm font-black text-purple-200 mt-0.5">{ctr}%</p>
                      </div>
                    </div>

                    {/* Progress conversion bar */}
                    <div className="space-y-1 pt-1">
                      <div className="flex items-center justify-between text-[9px] text-slate-300 font-bold">
                        <span>{lang === 'ar' ? 'شريط تحويل المشاهدات إلى تفاعلات اتصالات:' : 'Views to Contact Conversion Rate:'}</span>
                        <span className="text-teal-300 font-black">{ctr}% ({totalInteractions} / {impressions})</span>
                      </div>
                      <div className="w-full bg-white/10 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-teal-400 to-emerald-400 h-full transition-all duration-500 rounded-full"
                          style={{ width: `${Math.min(100, Math.max(2, Number(ctr)))}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
                    <Megaphone className="w-4 h-4 text-teal-600" />
                    <span>{lang === 'ar' ? 'إضافة / تعديل إعلان محل محلي' : 'Add / Edit Store Banner'}</span>
                  </div>
                  <span className="text-[10px] font-bold text-teal-600 bg-teal-50 border border-teal-100 px-2 py-0.5 rounded-full">
                    {ads.length} {lang === 'ar' ? 'إعلان' : 'ads'}
                  </span>
                </div>

                {adError && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-600 text-[10px] rounded-xl p-2.5">{adError}</div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2 space-y-1">
                    <label className="text-[9px] font-bold text-slate-600">{lang === 'ar' ? 'اسم المحل / الخدمة *' : 'Store Name *'}</label>
                    <input
                      type="text"
                      placeholder={lang === 'ar' ? 'مثال: مطعم كابتن عز للوجبات' : 'e.g. Ezz Fast Food'}
                      value={adForm.storeName}
                      onChange={(e) => setAdForm({ ...adForm, storeName: e.target.value })}
                      className="w-full text-[10px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  <div className="col-span-2 space-y-1">
                    <label className="text-[9px] font-bold text-slate-600">{lang === 'ar' ? 'نص العرض والتفاصيل *' : 'Offer Details *'}</label>
                    <input
                      type="text"
                      placeholder={lang === 'ar' ? 'مثال: خصم 20% على جميع الوجبات وعروض التوصيل' : 'e.g. 20% off all meals'}
                      value={adForm.offerText}
                      onChange={(e) => setAdForm({ ...adForm, offerText: e.target.value })}
                      className="w-full text-[10px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  {/* Image URL & Local Upload with compression */}
                  <div className="col-span-2 space-y-1 bg-slate-50 border border-slate-200/80 p-2.5 rounded-xl">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[9px] font-bold text-slate-700">{lang === 'ar' ? 'صورة الإعلان (رابط أو رفع ملف مضغوط) *' : 'Ad Image (URL or compressed upload) *'}</label>
                      <span className="text-[8px] text-teal-600 font-bold bg-teal-50 px-1.5 py-0.5 rounded">
                        {lang === 'ar' ? '⚡ ضغط تلقائي موفر للداتا' : '⚡ Auto Compressed'}
                      </span>
                    </div>
                    <div className="flex gap-2 items-center">
                      <input
                        type="text"
                        placeholder={lang === 'ar' ? 'رابط الصورة https://...' : 'Image URL https://...'}
                        value={adForm.imageUrl}
                        onChange={(e) => setAdForm({ ...adForm, imageUrl: e.target.value })}
                        className="flex-1 text-[10px] bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:border-teal-500"
                      />
                      <label className="shrink-0 bg-teal-600 hover:bg-teal-700 text-white text-[9px] font-bold px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors shadow-xs">
                        📁 {lang === 'ar' ? 'رفع صورة' : 'Upload'}
                        <input type="file" accept="image/*" onChange={handleAdImageFileUpload} className="hidden" />
                      </label>
                    </div>
                    {adForm.imageUrl && (
                      <div className="flex items-center gap-2 mt-2 pt-1 border-t border-slate-200">
                        {adImageError['form_preview'] ? (
                          <div className="w-10 h-10 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-400 font-black text-xs">
                            !
                          </div>
                        ) : (
                          <img src={adForm.imageUrl} alt="preview" className="w-10 h-10 object-cover rounded-lg bg-white border border-slate-200" onError={() => setAdImageError(prev => ({ ...prev, form_preview: true }))} />
                        )}
                        <span className="text-[8px] text-slate-500">{lang === 'ar' ? 'معاينة الصورة المضغوطة' : 'Compressed image preview'}</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-600">{lang === 'ar' ? 'رقم الهاتف للاتصال *' : 'Phone Number *'}</label>
                    <input
                      type="tel"
                      placeholder="01015555555"
                      value={adForm.phoneNumber}
                      onChange={(e) => setAdForm({ ...adForm, phoneNumber: e.target.value })}
                      className="w-full text-[10px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-600">{lang === 'ar' ? 'رقم الواتساب (اختياري)' : 'WhatsApp (optional)'}</label>
                    <input
                      type="tel"
                      placeholder="201015555555"
                      value={adForm.whatsapp}
                      onChange={(e) => setAdForm({ ...adForm, whatsapp: e.target.value })}
                      className="w-full text-[10px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-700">{lang === 'ar' ? 'رسوم الإعلان (جنيه) *' : 'Ad Fee (EGP) *'}</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="500"
                      value={adForm.adFee || ''}
                      onChange={(e) => setAdForm({ ...adForm, adFee: Number(e.target.value) || 0 })}
                      className="w-full text-[10px] bg-emerald-50/50 border border-emerald-200 rounded-lg px-3 py-2 text-emerald-900 font-bold focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-600">{lang === 'ar' ? 'مكان الظهور' : 'Placement'}</label>
                    <select
                      value={adForm.placement}
                      onChange={(e) => setAdForm({ ...adForm, placement: e.target.value as Ad['placement'] })}
                      className="w-full text-[10px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:border-teal-500"
                    >
                      <option value="all">{lang === 'ar' ? 'كل الصفحات' : 'All placements'}</option>
                      <option value="home">{lang === 'ar' ? 'الصفحة الرئيسية' : 'Home screen'}</option>
                      <option value="waiting">{lang === 'ar' ? 'صفحة انتظار السائق' : 'Waiting screen'}</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-600">{lang === 'ar' ? 'المنطقة المستهدفة (اختياري)' : 'Target Region (optional)'}</label>
                    <select
                      value={adForm.regionId}
                      onChange={(e) => setAdForm({ ...adForm, regionId: e.target.value })}
                      className="w-full text-[10px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:border-teal-500"
                    >
                      <option value="">{lang === 'ar' ? 'كل المناطق' : 'All regions'}</option>
                      {regions.map(r => (
                        <option key={r.id} value={r.id}>{lang === 'ar' ? r.nameAr : r.nameEn}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-600">{lang === 'ar' ? 'أولوية الظهور (1 - 5)' : 'Priority (1 - 5)'}</label>
                    <select
                      value={adForm.priority}
                      onChange={(e) => setAdForm({ ...adForm, priority: Number(e.target.value) || 1 })}
                      className="w-full text-[10px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:border-teal-500"
                    >
                      <option value={1}>{lang === 'ar' ? '1 - أولوية عادية' : '1 - Standard'}</option>
                      <option value={2}>{lang === 'ar' ? '2 - أولوية متوسطة' : '2 - Medium'}</option>
                      <option value={3}>{lang === 'ar' ? '3 - أولوية مرتفعة' : '3 - High'}</option>
                      <option value={5}>{lang === 'ar' ? '5 - أولوية قصوى (الأكثر ظهوراً)' : '5 - Maximum Priority'}</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-600">{lang === 'ar' ? 'تاريخ بداية الإعلان' : 'Start Date'}</label>
                    <input
                      type="date"
                      value={adForm.startDate}
                      onChange={(e) => setAdForm({ ...adForm, startDate: e.target.value })}
                      className="w-full text-[10px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-600">{lang === 'ar' ? 'تاريخ نهاية الإعلان' : 'End Date'}</label>
                    <input
                      type="date"
                      value={adForm.endDate}
                      onChange={(e) => setAdForm({ ...adForm, endDate: e.target.value })}
                      className="w-full text-[10px] bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 focus:outline-none focus:border-teal-500"
                    />
                  </div>

                  <label className="col-span-2 flex items-center gap-2 text-[10px] text-slate-600 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={adForm.isActive}
                      onChange={(e) => setAdForm({ ...adForm, isActive: e.target.checked })}
                      className="w-4 h-4 accent-teal-600 cursor-pointer"
                    />
                    <span className="font-bold">{lang === 'ar' ? 'الإعلان مفعّل ومتاح للظهور للعملاء' : 'Ad is active and visible to riders'}</span>
                  </label>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={async () => {
                       if (!adForm.storeName.trim() || !adForm.offerText.trim() || !adForm.phoneNumber.trim()) {
                         setAdError(lang === 'ar' ? 'يرجى ملء جميع الحقول المطلوبة (اسم المحل، نص العرض، رقم الهاتف)' : 'Please fill all required fields');
                         return;
                       }
                      setAdError('');
                       const saved = await saveAd({
                         id: editingAdId || undefined,
                         storeName: adForm.storeName.trim(),
                         offerText: adForm.offerText.trim(),
                         imageUrl: adForm.imageUrl.trim(),
                         phoneNumber: adForm.phoneNumber.trim(),
                         whatsapp: adForm.whatsapp.trim() || undefined,
                         placement: adForm.placement,
                         priority: adForm.priority,
                         isActive: adForm.isActive,
                         startDate: adForm.startDate || undefined,
                         endDate: adForm.endDate || undefined,
                         adFee: adForm.adFee || 0,
                         dailyImpressionLimit: adForm.dailyImpressionLimit || 0,
                         regionId: adForm.regionId || undefined,
                       });
                       if (saved) {
                          setAdForm({
                            storeName: '',
                            offerText: '',
                            imageUrl: '',
                            phoneNumber: '',
                            whatsapp: '',
                            placement: 'all',
                            priority: 1,
                            isActive: true,
                            startDate: '',
                            endDate: '',
                            adFee: 0,
                            dailyImpressionLimit: 0,
                            regionId: '',
                          });
                        setEditingAdId(null);
                        setAds(await fetchAds());
                      } else {
                        setAdError(lang === 'ar' ? 'فشل حفظ الإعلان' : 'Failed to save ad');
                      }
                    }}
                    className="flex-1 py-2.5 bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-700 hover:to-emerald-700 text-white font-bold text-xs rounded-xl transition-all cursor-pointer shadow-sm"
                  >
                    {editingAdId ? (lang === 'ar' ? 'حفظ التعديلات' : 'Save changes') : (lang === 'ar' ? 'إضافة الإعلان وحساب أرباحه' : 'Add Ad & Register Revenue')}
                  </button>
                  {editingAdId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAdId(null);
                         setAdForm({
                           storeName: '',
                           offerText: '',
                           imageUrl: '',
                           phoneNumber: '',
                           whatsapp: '',
                           placement: 'all',
                           priority: 1,
                           isActive: true,
                           startDate: '',
                           endDate: '',
                           adFee: 0,
                           dailyImpressionLimit: 0,
                           regionId: '',
                         });
                        setAdError('');
                      }}
                      className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold text-xs rounded-xl transition-all cursor-pointer"
                    >
                      {lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                  )}
                </div>
              </div>

              {/* LIST OF FILTERED ADS */}
              {displayedAds.length === 0 ? (
                <div className="text-center p-8 bg-white border border-slate-200 rounded-2xl shadow-sm">
                  <Megaphone className="w-10 h-10 text-slate-300 mx-auto" />
                  <p className="text-xs font-bold text-slate-500 mt-2">
                    {lang === 'ar' ? 'لا توجد إعلانات مطابقة للفلتر المحدد' : 'No ads matching selected filters'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">
                    {lang === 'ar' ? 'جرّب تغيير معايير البحث أو إضافة إعلان جديد' : 'Try changing search criteria or add a new ad'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {displayedAds.map((ad) => {
                    const isSelected = selectedAdId === ad.id;

                    return (
                      <div
                        key={ad.id}
                        className={`bg-white border rounded-2xl p-3 shadow-sm transition-all ${
                          isSelected ? 'border-2 border-teal-500 ring-2 ring-teal-100' : 'border-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          {adImageError[ad.id] ? (
                            <div className="w-14 h-14 rounded-xl bg-slate-100 border border-slate-100 shrink-0 flex items-center justify-center text-slate-400 font-black text-lg">
                              {ad.storeName.charAt(0)}
                            </div>
                          ) : (
                            <img src={ad.imageUrl} alt={ad.storeName} className="w-14 h-14 rounded-xl object-cover bg-slate-100 shrink-0 border border-slate-100 shadow-2xs" onError={() => setAdImageError(prev => ({ ...prev, [ad.id]: true }))} />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 justify-end">
                              <h4 className="text-xs font-black text-slate-900 truncate">{ad.storeName}</h4>
                              <span className={`text-[7px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${ad.isActive ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-100 text-slate-400'}`}>
                                {ad.isActive ? (lang === 'ar' ? 'مفعّل' : 'Active') : (lang === 'ar' ? 'متوقف' : 'Off')}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-500 truncate text-right mt-0.5">{ad.offerText}</p>
                            <div className="flex items-center gap-2 justify-end mt-1.5 text-[8px] text-slate-500 flex-wrap">
                              {ad.adFee ? (
                                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded font-black">
                                  💰 {ad.adFee} {lang === 'ar' ? 'ج.م رسوم' : 'EGP Fee'}
                                </span>
                              ) : null}
                              <span className="bg-slate-100 px-1.5 py-0.5 rounded font-bold text-slate-600">
                                {ad.placement === 'all' ? (lang === 'ar' ? 'كل الأماكن' : 'All') : ad.placement === 'home' ? (lang === 'ar' ? 'الرئيسية' : 'Home') : (lang === 'ar' ? 'الانتظار' : 'Wait')}
                              </span>
                              {ad.regionId ? (
                                (() => {
                                  const matchedRegion = regions.find(r => r.id === ad.regionId);
                                  return (
                                    <span className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded font-bold">
                                      📍 {matchedRegion ? (lang === 'ar' ? matchedRegion.nameAr : matchedRegion.nameEn) : ad.regionId}
                                    </span>
                                  );
                                })()
                              ) : (
                                <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-bold">
                                  🌍 {lang === 'ar' ? 'كل المناطق' : 'Global'}
                                </span>
                              )}
                              <span className="bg-blue-50 text-blue-700 border border-blue-100 px-1.5 py-0.5 rounded font-bold flex items-center gap-0.5" title="عدد مرات الظهور للعملاء">
                                👁️ {ad.impressions || 0} {lang === 'ar' ? 'ظهور' : 'views'}
                              </span>
                              <span className="bg-teal-50 text-teal-700 border border-teal-100 px-1.5 py-0.5 rounded font-bold flex items-center gap-0.5" title="عدد الاتصالات الهاتفية">
                                📞 {ad.clicks || 0} {lang === 'ar' ? 'اتصال' : 'calls'}
                              </span>
                              <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.5 rounded font-bold flex items-center gap-0.5" title="عدد نقرات الواتساب">
                                💬 {ad.whatsappClicks || 0} {lang === 'ar' ? 'واتساب' : 'WhatsApp'}
                              </span>
                              <span>{lang === 'ar' ? `أولوية: ${ad.priority}` : `P: ${ad.priority}`}</span>
                              {ad.startDate || ad.endDate ? (
                                <span className="text-slate-400 font-medium">
                                  📅 {ad.startDate || '...'} ⬅ {ad.endDate || '...'}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => setSelectedAdId(isSelected ? 'all' : ad.id)}
                              className={`text-[9px] font-bold px-2.5 py-1.5 rounded-lg transition-all cursor-pointer ${
                                isSelected ? 'bg-teal-600 text-white' : 'bg-teal-50 hover:bg-teal-100 text-teal-700 border border-teal-200'
                              }`}
                            >
                              📊 {lang === 'ar' ? 'التقرير' : 'Report'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingAdId(ad.id);
                                setAdForm({
                                  storeName: ad.storeName,
                                  offerText: ad.offerText,
                                  imageUrl: ad.imageUrl,
                                  phoneNumber: ad.phoneNumber,
                                  whatsapp: ad.whatsapp || '',
                                  placement: ad.placement,
                                  priority: ad.priority,
                                  isActive: ad.isActive,
                                  startDate: ad.startDate || '',
                                  endDate: ad.endDate || '',
                                  adFee: ad.adFee || 0,
                                  dailyImpressionLimit: ad.dailyImpressionLimit || 0,
                                  regionId: ad.regionId || '',
                                });
                                setAdError('');
                              }}
                              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[9px] font-bold rounded-lg transition-all cursor-pointer"
                            >
                              ✏️ {lang === 'ar' ? 'تعديل' : 'Edit'}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!confirm(lang === 'ar' ? 'حذف هذا الإعلان؟' : 'Delete this ad?')) return;
                                if (await deleteAd(ad.id)) {
                                  if (selectedAdId === ad.id) setSelectedAdId('all');
                                  setAds(await fetchAds());
                                }
                              }}
                              className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-600 text-[9px] font-bold rounded-lg transition-all cursor-pointer"
                            >
                              🗑️ {lang === 'ar' ? 'حذف' : 'Delete'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {activeTab === 'legal' && (
          <div className="space-y-4 animate-fade-in text-right">
            {/* Privacy Policy */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
              <h3 className="text-xs font-black text-slate-800 flex items-center gap-1">
                <ShieldAlert className="w-4 h-4 text-indigo-600" />
                <span>{lang === 'ar' ? 'سياسة الخصوصية' : 'Privacy Policy'}</span>
              </h3>
              <div className="space-y-2 text-[10px] text-slate-600 leading-relaxed">
                {PRIVACY_POLICY[lang].sections.map((section, idx) => (
                  <div key={idx} className="border-b border-slate-100 pb-2 last:border-0">
                    <h4 className="font-bold text-slate-800 text-[10px]">{section.heading}</h4>
                    <p className="mt-1">{section.content}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Terms of Service */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
              <h3 className="text-xs font-black text-slate-800 flex items-center gap-1">
                <ShieldAlert className="w-4 h-4 text-rose-600" />
                <span>{lang === 'ar' ? 'شروط الاستخدام' : 'Terms of Service'}</span>
              </h3>
              <div className="space-y-2 text-[10px] text-slate-600 leading-relaxed">
                {TERMS_OF_SERVICE[lang].sections.map((section, idx) => (
                  <div key={idx} className="border-b border-slate-100 pb-2 last:border-0">
                    <h4 className="font-bold text-slate-800 text-[10px]">{section.heading}</h4>
                    <p className="mt-1">{section.content}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Data Retention Policy */}
            <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
              <h3 className="text-xs font-black text-slate-800 flex items-center gap-1">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                <span>{lang === 'ar' ? 'سياسة الاحتفاظ بالبيانات والنسخ الاحتياطي' : 'Data Retention & Backup Policy'}</span>
              </h3>
              <div className="space-y-2 text-[10px] text-slate-600 leading-relaxed">
                {DATA_RETENTION_POLICY[lang].sections.map((section, idx) => (
                  <div key={idx} className="border-b border-slate-100 pb-2 last:border-0">
                    <h4 className="font-bold text-slate-800 text-[10px]">{section.heading}</h4>
                    <p className="mt-1">{section.content}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Last Updated */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
              <p className="text-[9px] text-slate-500">
                {lang === 'ar' ? 'آخر تحديث: ' : 'Last updated: '}
                <span className="font-bold text-slate-700">
                  {new Date(PRIVACY_POLICY[lang].lastUpdated).toLocaleDateString(lang === 'ar' ? 'ar-EG' : 'en-US')}
                </span>
              </p>
            </div>
          </div>
         )}
        </div>
      </div>
    );
  };
