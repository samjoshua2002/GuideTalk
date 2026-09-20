import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const HAPTICS_KEY = 'guildtalk_haptics_enabled';
let isHapticsEnabled = true;

// Initialize on module load
(async () => {
  try {
    if (Platform.OS === 'web') {
      const val = globalThis.localStorage?.getItem(HAPTICS_KEY);
      if (val !== null) isHapticsEnabled = val === 'true';
    } else {
      const val = await SecureStore.getItemAsync(HAPTICS_KEY);
      if (val !== null) isHapticsEnabled = val === 'true';
    }
  } catch {
    // Default enabled
  }
})();

export async function setHapticsEnabled(enabled: boolean) {
  isHapticsEnabled = enabled;
  try {
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(HAPTICS_KEY, String(enabled));
    } else {
      await SecureStore.setItemAsync(HAPTICS_KEY, String(enabled));
    }
  } catch {
    // Ignore storage failure
  }
}

export function getHapticsEnabled(): boolean {
  return isHapticsEnabled;
}

export function triggerHaptic(
  type: 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' = 'light'
) {
  if (!isHapticsEnabled || Platform.OS === 'web') return;
  try {
    switch (type) {
      case 'light':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'medium':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'heavy':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case 'selection':
        Haptics.selectionAsync();
        break;
      case 'success':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warning':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
    }
  } catch {
    // Haptics not supported on device
  }
}
