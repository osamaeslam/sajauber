import { NotificationSettings as NotificationSettingsType } from '../utils/notificationSettings';

let currentNotificationSettings: NotificationSettingsType = {
  enabled: true,
  sound: true,
  vibration: true,
  speech: true,
  volume: 0.8,
};

const shouldNotify = (): boolean => {
  return currentNotificationSettings.enabled;
};

const shouldPlaySound = (): boolean => {
  return currentNotificationSettings.enabled && currentNotificationSettings.sound;
};

const shouldVibrate = (): boolean => {
  return currentNotificationSettings.enabled && currentNotificationSettings.vibration;
};

const shouldSpeak = (): boolean => {
  return currentNotificationSettings.enabled && currentNotificationSettings.speech;
};

const getVolume = (): number => {
  return currentNotificationSettings.volume;
};

/**
 * Ezz Notification & Audio Alert System
 * Optimized for Drivers & Background Execution:
 * - Prioritizes Audio & Speech Synthesis FIRST, then displays native/SW background notifications.
 * - Keeps Web Audio API primed across tab focus / background transitions.
 * - Handles ServiceWorker background push and client postMessage notifications.
 */

// --- Notification Permission & Service Worker Helpers ---

export const requestNotificationPermission = async (): Promise<boolean> => {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }
  return false;
};

/**
 * Send a native browser or ServiceWorker notification.
 * Uses ServiceWorker registration if available for better background persistence.
 */
export const sendNativeNotification = (title: string, body: string, icon = '🚖', tag?: string, silent = false) => {
  if (!shouldNotify()) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }

  if (tag && isDuplicateNotification(tag)) return;
  const iconDataUrl = `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>${icon}</text></svg>`;
  const isChat = tag?.includes('chat') || tag?.includes('message');
  const isRating = tag?.includes('rating');
  const options: any = {
    body,
    icon: iconDataUrl,
    badge: iconDataUrl,
    tag: tag || title,
    renotify: false,
    requireInteraction: isChat ? false : true,
    silent: isChat,
    sound: isChat ? undefined : 'default',
    vibrate: isChat ? [] : (isRating ? [80, 40, 80] : [300, 100, 300, 100, 400]),
    data: { dateOfArrival: Date.now(), url: '/' },
  };

  if (isChat) {
    try {
      new Notification(title, options);
    } catch { /* noop */ }
    return;
  }

  // Try via active ServiceWorker postMessage or showNotification
  if ('serviceWorker' in navigator) {
    if (navigator.serviceWorker.controller) {
      try {
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_BACKGROUND_NOTIFICATION',
          title,
          body,
          icon: iconDataUrl,
          tag: tag || title,
          vibrate: [300, 100, 300, 100, 400],
        });
        return;
      } catch (e) {
        console.warn('SW postMessage failed, falling back to registration:', e);
      }
    }

    navigator.serviceWorker.ready
      .then((reg) => {
        reg.showNotification(title, options).catch(() => {
          fallbackNativeNotification(title, options);
        });
      })
      .catch(() => {
        fallbackNativeNotification(title, options);
      });
  } else {
    fallbackNativeNotification(title, options);
  }
};

const fallbackNativeNotification = (title: string, options: NotificationOptions) => {
  try {
    new Notification(title, options);
  } catch (e) {
    console.warn('Fallback native notification failed:', e);
  }
};

// --- Browser Title Flashing Helper ---
let flashInterval: ReturnType<typeof setInterval> | null = null;
const originalTitle = typeof document !== 'undefined' ? document.title : 'Ezz Ride';

export const startTitleFlash = (message: string) => {
  if (typeof document === 'undefined') return;
  if (flashInterval) clearInterval(flashInterval);
  let isMsg = false;
  flashInterval = setInterval(() => {
    document.title = isMsg ? message : originalTitle;
    isMsg = !isMsg;
  }, 1000);
};

export const stopTitleFlash = () => {
  if (typeof document === 'undefined') return;
  if (flashInterval) {
    clearInterval(flashInterval);
    flashInterval = null;
  }
  document.title = originalTitle;
};

// --- Mobile Vibration Helper ---
export const triggerVibration = (pattern: number | number[] = [300, 100, 300, 100, 400]) => {
  if (!shouldVibrate()) return;
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      console.warn('Vibration API not supported or blocked:', e);
    }
  }
};

// Quiet vibration mode for chat messages
export const triggerQuietVibration = (pattern: number | number[] = [30, 20, 30]) => {
  if (!shouldVibrate()) return;
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(pattern);
    } catch (e) {
      console.warn('Vibration API not supported or blocked:', e);
    }
  }
};

// --- Web Audio API Synthesizers (Audio Context & Priming) ---

let audioCtx: AudioContext | null = null;
let audioUnlocked = false;

export const getAudioContext = (): AudioContext => {
  if (!audioCtx) {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtx = new AudioCtxClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
};

let audioElement: HTMLAudioElement | null = null;

const getAudioElement = (): HTMLAudioElement => {
  if (!audioElement) {
    audioElement = new Audio();
    audioElement.preload = 'auto';
  }
  return audioElement;
};

const generateToneBlobUrl = (
  frequency: number,
  duration: number,
  volume: number = 0.5,
  sampleRate: number = 44100
): string => {
  const numSamples = Math.floor(sampleRate * duration);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  const fadeSamples = Math.min(Math.floor(sampleRate * 0.01), 100);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = Math.sin(2 * Math.PI * frequency * t) * volume;
    if (i < fadeSamples) sample *= i / fadeSamples;
    if (i > numSamples - fadeSamples) sample *= (numSamples - i) / fadeSamples;
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, s * 0x7fff, true);
  }
  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
};

const generateRingtoneBlobUrl = (): string => {
  const sampleRate = 44100;
  const tone1Freq = 880;
  const tone2Freq = 1100;
  const toneDuration = 0.18;
  const gapDuration = 0.07;
  const totalDuration = toneDuration * 2 + gapDuration;
  const numSamples = Math.floor(sampleRate * totalDuration);
  const fadeSamples = Math.floor(sampleRate * 0.008);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numSamples * 2, true);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;
    const vol = 0.5;
    if (t < toneDuration) {
      sample = Math.sin(2 * Math.PI * tone1Freq * t) * vol;
      if (i < fadeSamples) sample *= i / fadeSamples;
      if (i > numSamples - toneDuration * sampleRate - fadeSamples) sample *= (numSamples - i) / fadeSamples;
    } else if (t < toneDuration + gapDuration) {
      sample = 0;
    } else if (t < totalDuration) {
      const t2 = t - toneDuration - gapDuration;
      sample = Math.sin(2 * Math.PI * tone2Freq * t2) * vol;
      if (i > numSamples - fadeSamples) sample *= (numSamples - i) / fadeSamples;
    }
    const s = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, s * 0x7fff, true);
  }
  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
};

const playAudioFallback = (type: 'new_trip' | 'trip_accepted' | 'chat_message' | 'trip_completed' | 'rating' | 'alert'): boolean => {
  try {
    const el = getAudioElement();
    let url: string;
    switch (type) {
      case 'new_trip':
      case 'alert':
        url = generateRingtoneBlobUrl();
        break;
      case 'trip_accepted':
        url = generateToneBlobUrl(783.99, 0.5, 0.4 * getVolume());
        break;
      case 'trip_completed':
        url = generateToneBlobUrl(1046.50, 0.6, 0.35 * getVolume());
        break;
      case 'chat_message':
        url = generateToneBlobUrl(1200, 0.15, 0.15 * getVolume());
        break;
      case 'rating':
        url = generateToneBlobUrl(880, 0.4, 0.4 * getVolume());
        break;
      default:
        url = generateRingtoneBlobUrl();
    }
    el.src = url;
    el.volume = getVolume();
    const playPromise = el.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn('[Audio Fallback] Play prevented:', err.message);
      });
    }
    setTimeout(() => {
      try { URL.revokeObjectURL(url); } catch {}
    }, 2000);
    return true;
  } catch (err) {
    console.warn('[Audio Fallback] Failed:', err);
    return false;
  }
};

/**
 * Prime and unlock AudioContext on user interaction so background alerts play without browser blockage
 */
export const unlockAudioContext = () => {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    if (!audioUnlocked) {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
      audioUnlocked = true;
      console.log('[Ezz Audio] Web Audio Context successfully unlocked');
    }
    // Prime HTML Audio element so blob-URL fallback works after user gesture
    const el = getAudioElement();
    if (el.paused) {
      const silentUrl = generateToneBlobUrl(440, 0.01, 0.001);
      el.volume = 0.001;
      el.src = silentUrl;
      el.play()
        .then(() => {
          el.volume = getVolume();
          setTimeout(() => {
            try { URL.revokeObjectURL(silentUrl); } catch {}
          }, 500);
        })
        .catch(() => {});
    }
  } catch (e) {
    console.warn('[Ezz Audio] Could not unlock Web Audio Context:', e);
  }
};

// Auto-attach unlock listeners on first user gesture
if (typeof window !== 'undefined') {
  const userGestureEvents = ['click', 'touchstart', 'pointerdown', 'keydown'];
  const handleGesture = () => {
    unlockAudioContext();
    userGestureEvents.forEach((evt) => window.removeEventListener(evt, handleGesture));
  };
  userGestureEvents.forEach((evt) => window.addEventListener(evt, handleGesture, { passive: true }));

  // Re-resume on visibility change if driver returns or tab wakes up
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  });
}

/**
 * Play synthesized high-attention sounds using Web Audio API
 */
export const playNotificationSound = (type: 'new_trip' | 'trip_accepted' | 'chat_message' | 'trip_completed' | 'rating' | 'alert') => {
  if (!shouldPlaySound()) return;
  unlockAudioContext();

  const ctx = getAudioContext();
  const useFallbackOnly = ctx.state === 'suspended' || !audioUnlocked;
  const isCritical = type === 'new_trip' || type === 'alert';

  if (useFallbackOnly) {
    playAudioFallback(type);
    return;
  }

  try {
    const now = ctx.currentTime;

    if (type === 'new_trip') {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(587.33, now);
      osc1.frequency.setValueAtTime(659.25, now + 0.15);
      osc1.frequency.setValueAtTime(587.33, now + 0.3);
      osc1.frequency.setValueAtTime(659.25, now + 0.45);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(293.66, now);
      osc2.frequency.setValueAtTime(329.63, now + 0.15);

      gainNode.gain.setValueAtTime(0.45 * getVolume(), now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 1.4);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.4);
      osc2.stop(now + 1.4);
      osc1.onended = () => { osc1.disconnect(); };
      osc2.onended = () => { osc2.disconnect(); gainNode.disconnect(); };

    } else if (type === 'trip_accepted') {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.12);
      osc.frequency.setValueAtTime(783.99, now + 0.24);
      osc.frequency.setValueAtTime(1046.50, now + 0.36);

      gainNode.gain.setValueAtTime(0.25 * getVolume(), now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.65);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.75);
      osc.onended = () => { osc.disconnect(); gainNode.disconnect(); };

    } else if (type === 'chat_message') {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1200, now + 0.08);

      gainNode.gain.setValueAtTime(0.03 * getVolume(), now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.3);
      osc.onended = () => { osc.disconnect(); gainNode.disconnect(); };

    } else if (type === 'trip_completed') {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(523.25, now);
      osc1.frequency.setValueAtTime(659.25, now + 0.2);
      osc1.frequency.setValueAtTime(1046.50, now + 0.4);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(261.63, now);
      osc2.frequency.setValueAtTime(392.00, now + 0.3);

      gainNode.gain.setValueAtTime(0.28 * getVolume(), now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 1.2);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 1.2);
      osc2.stop(now + 1.2);
      osc1.onended = () => { osc1.disconnect(); };
      osc2.onended = () => { osc2.disconnect(); gainNode.disconnect(); };

    } else if (type === 'rating') {
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now);

      gainNode.gain.setValueAtTime(0.28 * getVolume(), now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.6);

      osc.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.65);
      osc.onended = () => { osc.disconnect(); gainNode.disconnect(); };
    } else if (type === 'alert') {
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(440, now);
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(445, now);

      gainNode.gain.setValueAtTime(0.18 * getVolume(), now);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5);

      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.5);
      osc2.stop(now + 0.5);
      osc1.onended = () => { osc1.disconnect(); };
      osc2.onended = () => { osc2.disconnect(); gainNode.disconnect(); };
    }
  } catch (err) {
    console.warn('Web Audio Playback issue:', err);
    playAudioFallback(type);
    return;
  }

  // Belt-and-suspenders: HTML Audio fallback for high-attention alerts
  if (isCritical) {
    playAudioFallback(type);
  }
};

/**
 * Text-to-Speech synthesis helper
 */
export const speakText = (text: string, lang = 'ar-EG') => {
  if (!shouldSpeak()) return;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel(); // Cancel active speech
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis failed:', e);
    }
  }
};

/**
 * Priority Alert Driver Helper:
 * Ensures strict execution order:
 * 1. Audio Sound Playback
 * 2. Speech Synthesis / Voice Announcement
 * 3. Mobile Device Vibration
 * 4. Background Native / Service Worker Notification
 */
export const notifyDriverWithAudioFirst = async ({
  title,
  body,
  soundType = 'new_trip',
  speechText,
  lang = 'ar-EG',
  tag,
}: {
  title: string;
  body: string;
  soundType?: 'new_trip' | 'trip_accepted' | 'chat_message' | 'trip_completed' | 'rating' | 'alert';
  speechText?: string;
  lang?: string;
  tag?: string;
}) => {
  // --- PRIORITY 1: AUDIO & VOICE & VIBRATION FIRST ---
  try {
    if (soundType !== 'chat_message') {
      playNotificationSound(soundType);
      triggerVibration([300, 100, 300, 100, 400]);
    }
    if (speechText && !speechText.includes('Thank you for your trust')) {
      speakText(speechText, lang);
    }
    if (soundType !== 'chat_message') {
      startTitleFlash(`🚨 ${title}`);
    }
  } catch (e) {
    console.warn('Audio priority step failed:', e);
  }

  // --- PRIORITY 2: NATIVE / SERVICE WORKER NOTIFICATION SECOND ---
  try {
    sendNativeNotification(title, body, '🚖', tag);
  } catch (e) {
    console.warn('Native notification step failed:', e);
  }
};

const RATE_LIMIT_MS = 30000;
let lastNotificationTimes = new Map<string, number>();
let alarmInterval: ReturnType<typeof setInterval> | null = null;

export const isNotificationRateLimited = (key: string): boolean => {
  const now = Date.now();
  const lastTime = lastNotificationTimes.get(key);
  if (lastTime && now - lastTime < RATE_LIMIT_MS) {
    return true;
  }
  lastNotificationTimes.set(key, now);
  return false;
};

const recentNotifications = new Map<string, number>();
const NOTIFICATION_COOLDOWN_MS = 25000;

const isDuplicateNotification = (tag: string): boolean => {
  const now = Date.now();
  const lastTime = recentNotifications.get(tag);
  if (lastTime && now - lastTime < NOTIFICATION_COOLDOWN_MS) {
    return true;
  }
  recentNotifications.set(tag, now);
  return false;
};

// --- Screen WakeLock Helper (Keeps screen awake for drivers) ---
let wakeLockSentinel: any = null;

export const requestScreenWakeLock = async (): Promise<boolean> => {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
    return false;
  }
  try {
    if (!wakeLockSentinel || wakeLockSentinel.released) {
      wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
      console.log('[WakeLock] Screen WakeLock acquired successfully');
      wakeLockSentinel.addEventListener('release', () => {
        console.log('[WakeLock] Screen WakeLock was released');
        wakeLockSentinel = null;
      });
      return true;
    }
    return true;
  } catch (err: any) {
    console.warn('[WakeLock] Could not acquire Screen WakeLock:', err?.message || err);
    return false;
  }
};

export const releaseScreenWakeLock = async () => {
  try {
    if (wakeLockSentinel && !wakeLockSentinel.released) {
      await wakeLockSentinel.release();
      wakeLockSentinel = null;
      console.log('[WakeLock] Screen WakeLock manually released');
    }
  } catch (err) {
    console.warn('[WakeLock] Release error:', err);
  }
};

// Re-acquire WakeLock on visibility change if app returns to foreground
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible' && activeRingtoneTimer) {
      await requestScreenWakeLock();
    }
  });
}

/**
 * Continuous high-attention phone-call style repeating ringtone for Driver ride requests.
 * Loops uninterrupted until explicitly stopped by accept, decline, or timeout.
 */
let activeRingtoneTimer: ReturnType<typeof setInterval> | null = null;
let activeVoiceRepeatTimer: ReturnType<typeof setInterval> | null = null;

export const playContinuousRingtone = (options?: {
  title?: string;
  body?: string;
  speechText?: string;
  lang?: string;
}) => {
  // Stop any previous active alarm first
  stopContinuousRingtone();

  unlockAudioContext();
  requestScreenWakeLock();

  const isAr = (options?.lang || 'ar-EG').startsWith('ar');
  const title = options?.title || (isAr ? '🚖 طلب مشوار جديد!' : '🚖 New Ride Request!');
  const voiceText = options?.speechText || (isAr ? 'يوجد طلب مشوار جديد، يرجى الاستجابة' : 'New ride request available, please respond');

  // 1. Initial voice alert & title flash
  speakText(voiceText, options?.lang || (isAr ? 'ar-EG' : 'en-US'));
  startTitleFlash(`🚨 ${title}`);

  // 2. Native push / background notification
  if (options?.body) {
    sendNativeNotification(title, options.body, '🚖', 'ride-request-' + Date.now());
  }

  // 3. Audio Chime Function (Simulates loud realistic phone ring chime)
  const playDualToneRing = () => {
    try {
      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;
      const vol = 0.65 * getVolume();

      // Tone Pair 1 (High bell)
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(783.99, now); // G5
      osc1.frequency.setValueAtTime(880.00, now + 0.15); // A5
      gain1.gain.setValueAtTime(vol, now);
      gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.5);

      // Tone Pair 2 (Harmonic ringing chord)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(1046.50, now + 0.2); // C6
      osc2.frequency.setValueAtTime(1318.51, now + 0.35); // E6
      gain2.gain.setValueAtTime(vol, now + 0.2);
      gain2.gain.exponentialRampToValueAtTime(0.01, now + 0.7);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.2);
      osc2.stop(now + 0.75);

      // Mobile Vibration pulse on each ring
      triggerVibration([400, 150, 400, 150, 500]);
    } catch (e) {
      console.warn('[playContinuousRingtone] Audio error:', e);
      playAudioFallback('new_trip');
    }
  };

  // Play immediately
  playDualToneRing();

  // Loop every 1.5 seconds continuously until stopped
  activeRingtoneTimer = setInterval(() => {
    playDualToneRing();
  }, 1500);

  // Periodic voice reminder every 9 seconds
  activeVoiceRepeatTimer = setInterval(() => {
    speakText(voiceText, options?.lang || (isAr ? 'ar-EG' : 'en-US'));
  }, 9000);
};

export const stopContinuousRingtone = () => {
  if (activeRingtoneTimer) {
    clearInterval(activeRingtoneTimer);
    activeRingtoneTimer = null;
  }
  if (activeVoiceRepeatTimer) {
    clearInterval(activeVoiceRepeatTimer);
    activeVoiceRepeatTimer = null;
  }
  if (alarmInterval) {
    clearInterval(alarmInterval);
    alarmInterval = null;
  }
  stopTitleFlash();
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}
  }
};

// Aliases for compatibility
export const play10SecondRingtone = (options?: any) => {
  playContinuousRingtone(options);
};

export const stop10SecondRingtone = stopContinuousRingtone;
export const stopLoudRepeatingAlarm = stopContinuousRingtone;

export const notifyRideRequest = (title: string, body: string, lang = 'ar-EG') => {
  playContinuousRingtone({
    title,
    body,
    lang,
    speechText: lang.startsWith('ar') ? 'يوجد طلب مشوار جديد، يرجى الاستجابة' : 'New ride request available, please respond',
  });
};

export const startLoudRepeatingAlarm = (
  messageEn: string,
  soundType: 'new_trip' | 'alert' | 'trip_accepted' | 'rating' = 'new_trip',
  arabicMessage?: string
) => {
  const voiceMsg = arabicMessage || messageEn;
  const displayTitle = arabicMessage ? '🚖 طلب مشوار جديد!' : '🚖 New Ride Request!';
  notifyRideRequest(displayTitle, voiceMsg, arabicMessage ? 'ar-EG' : 'en-US');
};
