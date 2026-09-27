import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { Character } from '@/src/types/character';
import { registerCustomCharacter, getRuntimeCustomCharacters } from '@/src/data/characterRegistry';
import { saveCustomCharacter as saveCharacterToServer } from '@/src/lib/chatApi';

const CUSTOM_CHARS_STORAGE_KEY = 'guildtalk_user_custom_characters_list_v1';

type Listener = (characters: Character[]) => void;
const listeners = new Set<Listener>();

function notifyListeners(chars: Character[]) {
  listeners.forEach((listener) => {
    try {
      listener(chars);
    } catch (e) {
      console.warn('Listener error in customCharacters:', e);
    }
  });
}

export function subscribeToCustomCharacters(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Loads all user-created custom characters from persistent storage (SecureStore / localStorage)
 * and registers them in the runtime character registry so they are instantly accessible.
 */
export async function loadSavedUserCharacters(): Promise<Character[]> {
  try {
    let raw: string | null = null;
    if (Platform.OS === 'web') {
      raw = globalThis.localStorage?.getItem(CUSTOM_CHARS_STORAGE_KEY) || null;
    } else {
      raw = await SecureStore.getItemAsync(CUSTOM_CHARS_STORAGE_KEY);
    }

    if (!raw) {
      return getRuntimeCustomCharacters().filter((c) => c.isCustom);
    }

    const parsed: Character[] = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsed.forEach((char) => {
        registerCustomCharacter(char);
      });
      return parsed;
    }
  } catch (err) {
    console.warn('Failed to load saved custom characters from storage:', err);
  }
  return getRuntimeCustomCharacters().filter((c) => c.isCustom);
}

/**
 * Saves a new or updated user-created character:
 * 1. Registers in memory
 * 2. Persists to SecureStore / localStorage
 * 3. Syncs with backend API (MongoDB) if available
 * 4. Notifies all active subscribers (e.g. Home screen)
 */
export async function saveUserCreatedCharacter(
  character: Character,
  token?: string | null
): Promise<Character> {
  const customChar: Character = {
    ...character,
    isCustom: true,
    isOnline: true,
  };

  // 1. In-memory registry
  registerCustomCharacter(customChar);

  // 2. Load existing from storage and prepend
  let existing: Character[] = [];
  try {
    let raw: string | null = null;
    if (Platform.OS === 'web') {
      raw = globalThis.localStorage?.getItem(CUSTOM_CHARS_STORAGE_KEY) || null;
    } else {
      raw = await SecureStore.getItemAsync(CUSTOM_CHARS_STORAGE_KEY);
    }
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) existing = parsed;
    }
  } catch {
    existing = [];
  }

  const filtered = existing.filter((c) => c.id !== customChar.id);
  const updatedList = [customChar, ...filtered];

  // 3. Persist to storage
  try {
    const serialized = JSON.stringify(updatedList);
    if (Platform.OS === 'web') {
      globalThis.localStorage?.setItem(CUSTOM_CHARS_STORAGE_KEY, serialized);
    } else {
      await SecureStore.setItemAsync(CUSTOM_CHARS_STORAGE_KEY, serialized);
    }
  } catch (err) {
    console.warn('Failed to persist custom character locally:', err);
  }

  // 4. Fire-and-forget sync to backend server if reachable
  saveCharacterToServer(customChar, token).catch(() => {
    // Non-blocking: local storage is already safely persisted
  });

  // 5. Notify all listeners
  notifyListeners(updatedList);

  return customChar;
}

export function getUserCreatedCharacters(): Character[] {
  return getRuntimeCustomCharacters().filter((c) => c.isCustom);
}
