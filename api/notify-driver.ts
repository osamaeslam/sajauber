import type { VercelRequest, VercelResponse } from '@vercel/node';

const webpush = require('web-push');

const VAPID_PUBLIC_KEY = process.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;

if (!webpush.setVapidDetails) {
  console.warn('[notify-driver] web-push is not available in this environment');
}

async function getAvailableDrivers(supabase: any): Promise<any[]> {
  const { data, error } = await supabase
    .from('ezz_drivers')
    .select('id,name,web_push_subscription')
    .eq('is_online', true)
    .eq('status', 'AVAILABLE')
    .eq('approval_status', 'APPROVED');

  if (error) {
    console.error('[notify-driver] Error fetching drivers:', error);
    return [];
  }

  return (data || []).filter((d: any) => d.web_push_subscription && d.web_push_subscription.endpoint);
}

async function sendPushNotification(
  subscription: any,
  payload: any
): Promise<boolean> {
  try {
    webpush.setVapidDetails(
      'mailto:support@captain-ezz.com',
      VAPID_PUBLIC_KEY,
      VAPID_PRIVATE_KEY
    );

    await webpush.sendNotification(subscription, JSON.stringify(payload));
    return true;
  } catch (err: any) {
    console.warn('[notify-driver] Push failed:', err.message);
    return false;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
      return res.status(500).json({ error: 'VAPID keys not configured' });
    }

    const { tripId, pickup, vehicleType } = req.body || {};

    if (!tripId) {
      return res.status(400).json({ error: 'tripId is required' });
    }

    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return res.status(500).json({ error: 'Supabase credentials not configured' });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Verify trip exists and is still searching
    const { data: trip, error: tripError } = await supabase
      .from('ezz_active_trip')
      .select('id,status,pickup,dropoff,rider_name,requested_vehicle_type,fare')
      .eq('id', tripId)
      .maybeSingle();

    if (tripError || !trip || trip.status !== 'SEARCHING') {
      return res.status(200).json({
        success: true,
        message: 'Trip not found or no longer searching',
        notificationsSent: 0,
      });
    }

    const drivers = await getAvailableDrivers(supabase);

    if (drivers.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No available drivers',
        notificationsSent: 0,
      });
    }

    const pickupName = (trip.pickup && (trip.pickup.nameAr || trip.pickup.nameEn)) || pickup || 'موقع غير معروف';
    const dropoffName = (trip.dropoff && (trip.dropoff.nameAr || trip.dropoff.nameEn)) || 'وجهة غير معروفة';

    let notificationsSent = 0;

    for (const driver of drivers) {
      const subscription = driver.web_push_subscription;
      if (!subscription || !subscription.endpoint) continue;

      const payload = {
        title: '🚖 رحلة جديدة متاحة!',
        body: `رحلة من ${pickupName} إلى ${dropoffName} - ${trip.rider_name || 'راكب'}`,
        data: {
          type: 'NEW_TRIP',
          tripId: trip.id,
          pickup: trip.pickup,
          dropoff: trip.dropoff,
          riderName: trip.rider_name,
          fare: trip.fare,
          requestedVehicleType: trip.requested_vehicle_type || vehicleType,
        },
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [200, 100, 200, 100, 200],
        tag: `trip-${trip.id}`,
        renotify: true,
        requireInteraction: true,
      };

      const sent = await sendPushNotification(subscription, payload);
      if (sent) {
        notificationsSent++;
      }
    }

    return res.status(200).json({
      success: true,
      tripsFound: 1,
      driversNotified: drivers.length,
      notificationsSent,
    });
  } catch (err: any) {
    console.error('[notify-driver] Error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
