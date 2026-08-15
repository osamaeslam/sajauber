export type NotificationSettings = {
  enabled: boolean;
  sound: boolean;
  vibration: boolean;
  speech: boolean;
  volume: number;
};

export const STORAGE_KEY = 'ezz_notification_settings';

export const getDefaultSettings = (): NotificationSettings => ({
  enabled: true,
  sound: true,
  vibration: true,
  speech: true,
  volume: 0.8,
});

export const loadNotificationSettings = (): NotificationSettings => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...getDefaultSettings(), ...parsed };
    }
  } catch {
    // ignore
  }
  return getDefaultSettings();
};

export const saveNotificationSettings = (settings: NotificationSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
};
