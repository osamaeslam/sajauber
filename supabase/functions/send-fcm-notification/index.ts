import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 405,
    });
  }

  try {
    const { tripId, origin, destination, fare, distance } = await req.json();

    if (!tripId) {
      return new Response(JSON.stringify({ error: 'tripId is required' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !supabaseAnonKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase environment variables' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      });
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { data: trip, error: tripError } = await supabase
      .from('ezz_active_trip')
      .select('*')
      .eq('id', tripId)
      .single();

    if (tripError || !trip) {
      return new Response(JSON.stringify({ error: 'Trip not found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 404,
      });
    }

    if (trip.status !== 'PENDING') {
      return new Response(JSON.stringify({ error: 'Trip is not in PENDING state' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const { data: drivers, error: driversError } = await supabase
      .from('ezz_drivers')
      .select('id, full_name, phone, lat, lng, approval_status, active_trip_id')
      .eq('approval_status', 'APPROVED')
      .is('active_trip_id', null)
      .not('lat', 'is', null)
      .not('lng', 'is', null)
      .limit(5);

    if (driversError || !drivers || drivers.length === 0) {
      await supabase
        .from('ezz_active_trip')
        .update({ status: 'NO_DRIVERS' })
        .eq('id', tripId);

      return new Response(JSON.stringify({ error: 'No available drivers found', sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const { data: sessions, error: sessionsError } = await supabase
      .from('ezz_sessions')
      .select('user_id, fcm_token')
      .in('user_id', drivers.map(d => d.id))
      .not('fcm_token', 'is', null);

    if (sessionsError || !sessions || sessions.length === 0) {
      return new Response(JSON.stringify({ error: 'No driver FCM tokens found', sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const driverTokens = sessions
      .filter(s => s.fcm_token && s.fcm_token.trim() !== '')
      .map(s => s.fcm_token);

    if (driverTokens.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid FCM tokens available', sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    const fcmResults = [];
    for (const token of driverTokens) {
      try {
        const message = {
          notification: {
            title: '🚖 New Ride Request',
            body: `From: ${origin || 'Unknown'} → To: ${destination || 'Unknown'}\nFare: ${fare || 'N/A'} EGP`,
          },
          data: {
            tripId: tripId,
            origin: origin || '',
            destination: destination || '',
            fare: String(fare || '0'),
            distance: String(distance || '0'),
            clickAction: 'FLUTTER_NOTIFICATION_CLICK',
          },
          token: token,
        };

        const response = await fetch(
          'https://fcm.googleapis.com/v1/projects/' + Deno.env.get('FCM_PROJECT_ID') + '/messages:send',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json; charset=UTF-8',
              'Authorization': 'Bearer ' + (await getAccessToken()),
            },
            body: JSON.stringify(message),
          }
        );

        const result = await response.json();
        fcmResults.push({ token: token.substring(0, 15) + '...', success: response.ok, result });
      } catch (err) {
        console.error('Error sending FCM:', err);
        fcmResults.push({ token: token.substring(0, 15) + '...', success: false, error: err.message });
      }
    }

    const successCount = fcmResults.filter(r => r.success).length;

    return new Response(JSON.stringify({ sent: successCount, results: fcmResults }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('Edge Function error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

async function getAccessToken(): Promise<string> {
  const SERVICE_ACCOUNT_EMAIL = Deno.env.get('FCM_SERVICE_ACCOUNT_EMAIL');
  const SERVICE_ACCOUNT_PRIVATE_KEY = Deno.env.get('FCM_SERVICE_ACCOUNT_PRIVATE_KEY');

  if (!SERVICE_ACCOUNT_EMAIL || !SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error('Firebase service account not configured in Supabase secrets');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: SERVICE_ACCOUNT_EMAIL,
    sub: SERVICE_ACCOUNT_EMAIL,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  };

  const base64UrlEncode = (data: Uint8Array): string => {
    return btoa(String.fromCharCode(...data))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  };

  const encoder = new TextEncoder();
  const headerBytes = encoder.encode(JSON.stringify(header));
  const payloadBytes = encoder.encode(JSON.stringify(payload));

  const signatureInput = `${base64UrlEncode(headerBytes)}.${base64UrlEncode(payloadBytes)}`;

  const privateKeyPem = SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, '\n');
  const privateKeyBytes = encoder.encode(privateKeyPem);

  let cryptoSubtle: SubtleCrypto;
  if (typeof globalThis.crypto?.subtle === 'undefined') {
    const subtle = await import('https://deno.land/std@0.168.0/crypto/subtle.ts');
    cryptoSubtle = subtle.subtle;
  } else {
    cryptoSubtle = globalThis.crypto.subtle;
  }

  const signature = await cryptoSubtle.sign(
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256',
    },
    await cryptoSubtle.importKey(
      'pkcs8',
      privateKeyBytes,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    ),
    encoder.encode(signatureInput)
  );

  const signatureBytes = new Uint8Array(signature);
  const signedJwt = `${signatureInput}.${base64UrlEncode(signatureBytes)}`;

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${signedJwt}`,
  });

  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error('Failed to get access token: ' + JSON.stringify(tokenData));
  }

  return tokenData.access_token;
}
