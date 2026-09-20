import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const getKey = (userId?: string | null) =>
  `guildtalk_interacted_chars_${(userId || '').trim() || 'guest'}`;

export async function trackCharacterInteraction(charId: string, userId?: string | null) {
  if (!charId) return;
  const storageKey = getKey(userId);
  try {
    let list: string[] = [];
    if (Platform.OS === 'web') {
      const raw = globalThis.localStorage?.getItem(storageKey);
      if (raw) list = JSON.parse(raw);
    } else {
      const raw = await SecureStore.getItemAsync(storageKey);
      if (raw) list = JSON.parse(raw);
    }
    const updated = [charId, ...list.filter((id) => id !== charId)].slice(0, 30);
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(storageKey, JSON.stringify(updated));
    } else {
      await SecureStore.setItemAsync(storageKey, JSON.stringify(updated));
    }
  } catch {
    // Ignore storage issues
  }
}

export async function getInteractedCharacterIds(userId?: string | null): Promise<string[]> {
  const storageKey = getKey(userId);
  try {
    if (Platform.OS === 'web') {
      const raw = globalThis.localStorage?.getItem(storageKey);
      return raw ? JSON.parse(raw) : [];
    }
    const raw = await SecureStore.getItemAsync(storageKey);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
