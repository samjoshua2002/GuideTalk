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

function getFavCharsMetaKey(userId?: string | null): string {
  const cleanId = (userId || '').trim() || 'guest';
  return `guildtalk_favorites_meta_${cleanId}`;
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

export async function toggleFavorite(
  charId: string,
  userId?: string | null,
  characterObj?: any | null
): Promise<boolean> {
  if (!charId) return false;
  const key = getFavKey(userId);
  const metaKey = getFavCharsMetaKey(userId);
  try {
    const list = await getFavoriteIds(userId);
    const isFav = list.includes(charId);
    const updated = isFav ? list.filter((id) => id !== charId) : [...list, charId];

    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(key, JSON.stringify(updated));
    } else {
      await SecureStore.setItemAsync(key, JSON.stringify(updated));
    }

    // Cache character object metadata so it can always be retrieved across tabs
    try {
      let metaMap: Record<string, any> = {};
      if (Platform.OS === 'web') {
        const rawMeta = globalThis.localStorage?.getItem(metaKey);
        if (rawMeta) metaMap = JSON.parse(rawMeta);
      } else {
        const rawMeta = await SecureStore.getItemAsync(metaKey);
        if (rawMeta) metaMap = JSON.parse(rawMeta);
      }

      if (!isFav && characterObj) {
        metaMap[charId] = characterObj;
      } else if (isFav) {
        delete metaMap[charId];
      }

      if (Platform.OS === 'web') {
        globalThis.localStorage?.setItem(metaKey, JSON.stringify(metaMap));
      } else {
        await SecureStore.setItemAsync(metaKey, JSON.stringify(metaMap));
      }
    } catch {}

    notifyListeners((userId || '').trim() || 'guest');
    return !isFav;
  } catch {
    return false;
  }
}

/**
 * Single source of truth to resolve all favorite characters across Home (Starred Guild)
 * and the Favorites tab. Guarantees 100% synchronization.
 */
export async function loadAllFavoriteCharacters(
  userId?: string | null,
  extraCharacters: any[] = []
): Promise<any[]> {
  try {
    const favIds = await getFavoriteIds(userId);
    if (!Array.isArray(favIds) || favIds.length === 0) {
      return [];
    }

    // 1. Load cached character metadata
    const metaKey = getFavCharsMetaKey(userId);
    let cachedMeta: Record<string, any> = {};
    try {
      if (Platform.OS === 'web') {
        const raw = globalThis.localStorage?.getItem(metaKey);
        if (raw) cachedMeta = JSON.parse(raw);
      } else {
        const raw = await SecureStore.getItemAsync(metaKey);
        if (raw) cachedMeta = JSON.parse(raw);
      }
    } catch {}

    // 2. Gather built-in characters, presets, rivals and custom runtime characters
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getAllBuiltinCharacters, getCharacter, getRuntimeCustomCharacters } = require('@/src/data/characters');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getAllPresets } = require('@/src/data/rivals');

    const builtins = getAllBuiltinCharacters() || [];
    const presets = getAllPresets() || [];
    const runtimeCustom = getRuntimeCustomCharacters() || [];

    const charMap = new Map<string, any>();
    // Add extra first
    if (Array.isArray(extraCharacters)) {
      extraCharacters.forEach((c) => { if (c && c.id) charMap.set(c.id, c); });
    }
    // Add presets
    presets.forEach((c: any) => { if (c && c.id) charMap.set(c.id, c); });
    // Add builtins
    builtins.forEach((c: any) => { if (c && c.id) charMap.set(c.id, c); });
    // Add runtime custom
    runtimeCustom.forEach((c: any) => { if (c && c.id) charMap.set(c.id, c); });
    // Add cached metadata
    Object.values(cachedMeta).forEach((c: any) => { if (c && c.id) charMap.set(c.id, c); });

    const resolved: any[] = [];
    const seen = new Set<string>();

    for (const id of favIds) {
      if (seen.has(id)) continue;
      const found = charMap.get(id) || getCharacter(id);
      if (found) {
        seen.add(id);
        resolved.push(found);
      }
    }

    return resolved;
  } catch (err) {
    console.warn('Failed to load all favorite characters:', err);
    return [];
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
