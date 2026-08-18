import { Trip, Driver, Location } from '../types';

/**
 * Generates an encrypted/clean shareable text message with all trip & security details
 * and uses Web Share API or WhatsApp to allow families to track rides safely.
 */
export async function shareTripForSafety(params: {
  trip?: Trip | null;
  riderName: string;
  riderPhone: string;
  driver?: Driver | null;
  pickupLoc?: Location | null;
  dropoffLoc?: Location | null;
  distance?: number;
  fare?: number;
  isRoundTrip?: boolean;
  waitingMinutes?: number;
  lang?: 'ar' | 'en';
}): Promise<{ success: boolean; method: 'native' | 'whatsapp' | 'clipboard' }> {
  const {
    trip,
    riderName,
    riderPhone,
    driver,
    pickupLoc,
    dropoffLoc,
    distance,
    fare,
    isRoundTrip,
    waitingMinutes,
    lang = 'ar',
  } = params;

  const pName = trip?.pickup?.nameAr || trip?.pickup?.nameEn || pickupLoc?.nameAr || pickupLoc?.nameEn || 'نقطة الركوب';
  const dName = trip?.dropoff?.nameAr || trip?.dropoff?.nameEn || dropoffLoc?.nameAr || dropoffLoc?.nameEn || 'نقطة الوصول';
  const drvName = trip?.driverName || driver?.name || (lang === 'ar' ? 'جاري التعيين' : 'Assigning');
  const drvPhone = driver?.phone || '';
  const carPlate = driver?.carPlate || '';
  const carModel = driver?.vehicleName || driver?.carModel || '';
  const vehicleType = trip?.requestedVehicleType || driver?.vehicleType || 'CAR';
  const vehicleEmoji = vehicleType === 'MOTORCYCLE' ? '🏍️' : vehicleType === 'TOKTOK' ? '🛺' : '🚖';
  const totalDistance = trip?.distance || distance || 0;
  const totalFare = trip?.fare || fare || 0;
  const roundTripInfo = isRoundTrip || trip?.isRoundTrip
    ? (waitingMinutes || trip?.waitingMinutes ? ` (ذهاب وعودة 🔄 + انتظار ${waitingMinutes || trip?.waitingMinutes} دقيقة)` : ' (ذهاب وعودة 🔄)')
    : '';

  const textAr = 
`🛡️ *تفاصيل رحلتي للأمان - كابتن عز*
----------------------------------
👤 *الراكب:* ${riderName} (${riderPhone})
${vehicleEmoji} *المركبة:* ${carModel} (${carPlate || 'بدون لوحة'})
👨‍✈️ *الكابتن:* ${drvName} ${drvPhone ? `(${drvPhone})` : ''}
📍 *نقطة الركوب:* ${pName}
🏁 *وجهة الوصول:* ${dName}${roundTripInfo}
📏 *المسافة:* ${totalDistance} كم | 💰 *التكلفة:* ${totalFare} ج.م
⏰ *وقت الإرسال:* ${new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
----------------------------------
✅ الرحلة مسجلة بأمان عبر منصة كابتن عز الذكية.`;

  const textEn = 
`🛡️ *My Ride Safety Details - Ezz Captain*
----------------------------------
👤 *Rider:* ${riderName} (${riderPhone})
${vehicleEmoji} *Vehicle:* ${carModel} (${carPlate || 'N/A'})
👨‍✈️ *Captain:* ${drvName} ${drvPhone ? `(${drvPhone})` : ''}
📍 *Pickup:* ${pName}
🏁 *Destination:* ${dName}${roundTripInfo}
📏 *Distance:* ${totalDistance} km | 💰 *Fare:* ${totalFare} EGP
⏰ *Time:* ${new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
----------------------------------
✅ Tracked securely with Ezz Delivery Smart Network.`;

  const shareText = lang === 'ar' ? textAr : textEn;
  const shareTitle = lang === 'ar' ? '🛡️ مشاركة تفاصيل الرحلة للأمان' : '🛡️ Share Ride for Safety';

  // 1. Try Native Web Share API (Works natively on Android/iOS mobile browsers)
  if (typeof navigator !== 'undefined' && navigator.share) {
    try {
      await navigator.share({
        title: shareTitle,
        text: shareText,
      });
      return { success: true, method: 'native' };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        return { success: false, method: 'native' };
      }
      // If native share fails or was blocked in iframe, fallback to WhatsApp
    }
  }

  // 2. Fallback to WhatsApp URL
  try {
    const encoded = encodeURIComponent(shareText);
    const waUrl = `https://api.whatsapp.com/send?text=${encoded}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');
    return { success: true, method: 'whatsapp' };
  } catch {
    // 3. Fallback to clipboard
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareText);
      return { success: true, method: 'clipboard' };
    }
  }

  return { success: false, method: 'clipboard' };
}

/**
 * Ultra-fast local in-memory & localStorage Smart Cache
 * Eliminates duplicate calculations and reduces database hits to ZERO.
 */
class SmartLocalCache {
  private memory = new Map<string, { data: any; expiry: number }>();
  private readonly PREFIX = 'ezz_smart_cache_';

  get<T>(key: string): T | null {
    // 1. In-memory check
    const inMem = this.memory.get(key);
    if (inMem) {
      if (inMem.expiry > Date.now()) {
        return inMem.data as T;
      }
      this.memory.delete(key);
    }

    // 2. LocalStorage check
    try {
      const item = localStorage.getItem(this.PREFIX + key);
      if (item) {
        const parsed = JSON.parse(item);
        if (parsed.expiry > Date.now()) {
          this.memory.set(key, parsed);
          return parsed.data as T;
        }
        localStorage.removeItem(this.PREFIX + key);
      }
    } catch {}

    return null;
  }

  set(key: string, data: any, ttlSeconds: number = 86400): void {
    const expiry = Date.now() + ttlSeconds * 1000;
    const entry = { data, expiry };
    this.memory.set(key, entry);
    try {
      localStorage.setItem(this.PREFIX + key, JSON.stringify(entry));
    } catch {}
  }

  clear(): void {
    this.memory.clear();
    try {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith(this.PREFIX)) {
          localStorage.removeItem(k);
        }
      });
    } catch {}
  }
}

export const smartCache = new SmartLocalCache();
