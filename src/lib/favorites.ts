import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

type Listener = (userId?: string) => void;
const listeners = new Set<Listener>();

function notifyListeners(userId?: string) {
  listeners.forEach((listener) => {
    try {
      listener(userId);
    } catch {}
  });
}

export function subscribeToFavorites(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getFavKey(userId?: string | null): string {
  const cleanId = (userId || '').trim() || 'guest';
  return `guildtalk_favorites_${cleanId}`;
}

function getHiddenKey(userId?: string | null): string {
  const cleanId = (userId || '').trim() || 'guest';
  return `guildtalk_hidden_${cleanId}`;
}

// ----------------------------------------------------------------------
// FAVORITES STORAGE (USER-ISOLATED)
// ----------------------------------------------------------------------

export async function getFavoriteIds(userId?: string | null): Promise<string[]> {
  const key = getFavKey(userId);
  try {
    if (Platform.OS === 'web') {
      const raw = globalThis.localStorage?.getItem(key);
      return raw ? JSON.parse(raw) : [];
    }
    const raw = await SecureStore.getItemAsync(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function isFavorite(charId: string, userId?: string | null): Promise<boolean> {
  if (!charId) return false;
  const list = await getFavoriteIds(userId);
  return list.includes(charId);
}

export async function toggleFavorite(charId: string, userId?: string | null): Promise<boolean> {
  if (!charId) return false;
  const key = getFavKey(userId);
  try {
    const list = await getFavoriteIds(userId);
    const isFav = list.includes(charId);
    const updated = isFav ? list.filter((id) => id !== charId) : [...list, charId];

    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(key, JSON.stringify(updated));
    } else {
      await SecureStore.setItemAsync(key, JSON.stringify(updated));
    }
    notifyListeners((userId || '').trim() || 'guest');
    return !isFav;
  } catch {
    return false;
  }
}

// ----------------------------------------------------------------------
// HIDDEN / EXCLUDED FROM RECENT CHATS (USER-ISOLATED)
// ----------------------------------------------------------------------

export async function getHiddenRecentIds(userId?: string | null): Promise<string[]> {
  const key = getHiddenKey(userId);
  try {
    if (Platform.OS === 'web') {
      const raw = globalThis.localStorage?.getItem(key);
      return raw ? JSON.parse(raw) : [];
    }
    const raw = await SecureStore.getItemAsync(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function isCharHiddenFromRecent(charId: string, userId?: string | null): Promise<boolean> {
  if (!charId) return false;
  const list = await getHiddenRecentIds(userId);
  return list.includes(charId);
}

export async function toggleHideFromRecent(charId: string, userId?: string | null): Promise<boolean> {
  if (!charId) return false;
  const key = getHiddenKey(userId);
  try {
    const list = await getHiddenRecentIds(userId);
    const isHidden = list.includes(charId);
    const updated = isHidden ? list.filter((id) => id !== charId) : [...list, charId];

    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(key, JSON.stringify(updated));
    } else {
      await SecureStore.setItemAsync(key, JSON.stringify(updated));
    }
    notifyListeners((userId || '').trim() || 'guest');
    return !isHidden;
  } catch {
    return false;
  }
}
