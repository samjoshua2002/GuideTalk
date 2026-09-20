import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Image, ImageProps } from 'expo-image';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { fetchDynamicCharacterImage } from './chatApi';
import { Character } from '../types/character';

const CACHE_STORAGE_KEY = 'guildtalk_dynamic_character_images_v1';

// In-memory cache of resolved real character images: key -> URL
const memoryImageCache = new Map<string, string>();
// Pending fetch promises to deduplicate simultaneous requests
const pendingFetches = new Map<string, Promise<string | null>>();
// Listeners subscribed to image resolution updates
type CacheListener = (key: string, url: string) => void;
const listeners = new Set<CacheListener>();

// Hydrate from SecureStore on app launch
(async () => {
  try {
    const raw = await SecureStore.getItemAsync(CACHE_STORAGE_KEY);
    if (raw) {
      const parsed: Record<string, string> = JSON.parse(raw);
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v === 'string') memoryImageCache.set(k, v);
      }
    }
  } catch {}
})();

function getCacheKey(name: string, series?: string): string {
  return `${(name || '').trim().toLowerCase()}:::${(series || '').trim().toLowerCase()}`;
}

async function persistCache() {
  try {
    const obj: Record<string, string> = {};
    for (const [k, v] of memoryImageCache.entries()) {
      obj[k] = v;
    }
    await SecureStore.setItemAsync(CACHE_STORAGE_KEY, JSON.stringify(obj));
  } catch {}
}

/**
 * Fetch a real character image dynamically from the backend web search.
 * Deduplicates concurrent requests and notifies subscribers.
 */
export async function resolveCharacterImage(
  char?: Partial<Character> | { name: string; series?: string } | null,
  force: boolean = false
): Promise<string | null> {
  if (!char || !char.name) return null;
  const key = getCacheKey(char.name, char.series);

  if (!force && memoryImageCache.has(key)) {
    return memoryImageCache.get(key)!;
  }

  if (pendingFetches.has(key)) {
    return pendingFetches.get(key)!;
  }

  const fetchPromise = (async () => {
    try {
      const fetchedUrl = await fetchDynamicCharacterImage(char.name!, char.series, force);
      if (fetchedUrl) {
        memoryImageCache.set(key, fetchedUrl);
        persistCache().catch(() => {});
        listeners.forEach((fn) => fn(key, fetchedUrl));
        return fetchedUrl;
      }
    } catch (err) {
      console.warn(`Dynamic image resolution failed for "${char.name}":`, err);
    } finally {
      pendingFetches.delete(key);
    }
    // High-resolution stylized anime avatar guarantee so cards never remain broken
    const fallback = `https://api.dicebear.com/9.x/adventurer/png?seed=${encodeURIComponent(char.name || 'Hero')}&backgroundColor=1e293b`;
    memoryImageCache.set(key, fallback);
    listeners.forEach((fn) => fn(key, fallback));
    return fallback;
  })();

  pendingFetches.set(key, fetchPromise);
  return fetchPromise;
}

/**
 * Hook to get a real dynamic character image with automatic fallback fetching.
 */
export function useDynamicCharacterImage(
  character?: Partial<Character> | { name: string; series?: string; avatarUrl?: string; coverUrl?: string } | null,
  options?: { preferCover?: boolean }
) {
  const name = character?.name || '';
  const series = character?.series || '';
  const key = getCacheKey(name, series);

  const initialUrl =
    (options?.preferCover ? character?.coverUrl || character?.avatarUrl : character?.avatarUrl || character?.coverUrl) ||
    memoryImageCache.get(key) ||
    '';

  const [currentUri, setCurrentUri] = useState<string>(initialUrl);
  const [isResolving, setIsResolving] = useState(false);
  const isMounted = useRef(true);

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Sync when character or cache updates
  useEffect(() => {
    const cached = memoryImageCache.get(key);
    if (cached && cached !== currentUri) {
      setCurrentUri(cached);
    } else if (!currentUri && (character?.coverUrl || character?.avatarUrl)) {
      setCurrentUri(options?.preferCover ? character.coverUrl || character.avatarUrl! : character.avatarUrl || character.coverUrl!);
    }
  }, [key, character, options?.preferCover]);

  // Subscribe to global image resolution broadcasts
  useEffect(() => {
    const onUpdate: CacheListener = (updatedKey, newUrl) => {
      if (updatedKey === key && isMounted.current) {
        setCurrentUri(newUrl);
        setIsResolving(false);
      }
    };
    listeners.add(onUpdate);
    return () => {
      listeners.delete(onUpdate);
    };
  }, [key]);

  // If initially missing any URL, proactively resolve
  useEffect(() => {
    if (name && !currentUri) {
      setIsResolving(true);
      resolveCharacterImage(character, false).then((res) => {
        if (isMounted.current) {
          if (res) setCurrentUri(res);
          setIsResolving(false);
        }
      });
    }
  }, [name, currentUri]);

  // Triggered when an <Image> fails to load (e.g. 404 / hotlink blocked)
  const onImageError = useCallback(() => {
    if (!name) return;
    setIsResolving(true);
    resolveCharacterImage(character, true).then((freshUrl) => {
      if (isMounted.current) {
        if (freshUrl) setCurrentUri(freshUrl);
        setIsResolving(false);
      }
    });
  }, [character, name]);

  return {
    imageUri: currentUri,
    isResolving,
    onImageError,
  };
}

/**
 * Drop-in <DynamicCharacterImage /> component that replaces broken/missing images
 * dynamically from the web instead of showing dummy placeholders.
 */
interface DynamicCharacterImageProps extends Omit<ImageProps, 'source'> {
  character?: Partial<Character> | { name?: string; series?: string; avatarUrl?: string; coverUrl?: string } | null;
  characterName?: string;
  seriesName?: string;
  sourceUri?: string;
  preferCover?: boolean;
  defaultUri?: string;
}

export function DynamicCharacterImage({
  character,
  characterName,
  seriesName,
  sourceUri,
  preferCover,
  defaultUri,
  style,
  onError,
  ...rest
}: DynamicCharacterImageProps) {
  const resolvedChar =
    character ||
    (characterName
      ? {
          name: characterName,
          series: seriesName,
          avatarUrl: sourceUri,
          coverUrl: preferCover ? sourceUri : undefined,
        }
      : null);

  const { imageUri, onImageError } = useDynamicCharacterImage(resolvedChar, { preferCover });
  const finalUri = imageUri || sourceUri || defaultUri || '';

  const handleError = useCallback(
    (e: any) => {
      onImageError();
      if (onError) onError(e);
    },
    [onImageError, onError]
  );

  return (
    <Image
      source={{ uri: finalUri }}
      style={style}
      onError={handleError}
      {...rest}
    />
  );
}
