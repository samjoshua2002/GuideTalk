import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Image, ImageProps } from 'expo-image';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { fetchDynamicCharacterImage } from './chatApi';
import { Character } from '../types/character';

const CACHE_STORAGE_KEY = 'guildtalk_dynamic_character_images_v1';

// In-memory cache of resolved real character images: key -> URL
const memoryImageCache = new Map<string, string>();
// Candidates pool for instant "Change Look" cycling: key -> URL[]
const candidatesCache = new Map<string, string[]>();
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
      for (const [k, v] of memoryImageCache.entries()) {
        listeners.forEach((fn) => fn(k, v));
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

async function directClientWikipediaCandidates(name: string, series?: string): Promise<string[]> {
  const cleanName = (name || '').trim();
  if (!cleanName) return [];
  const queries = [cleanName, series ? `${cleanName} ${series}` : null].filter(Boolean) as string[];
  const candidates: string[] = [];

  for (const q of queries) {
    try {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=4&format=json&origin=*`;
      const res = await fetch(searchUrl, {
        headers: { 'User-Agent': 'GuildTalkApp/1.0.3 (contact@guildtalk.app)' },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const items = data?.query?.search || [];
      for (const item of items) {
        const title = item.title;
        if (!title) continue;
        const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
        const sumRes = await fetch(sumUrl, {
          headers: { 'User-Agent': 'GuildTalkApp/1.0.3 (contact@guildtalk.app)' },
          signal: AbortSignal.timeout(3500),
        });
        if (!sumRes.ok) continue;
        const sumData = await sumRes.json();
        const img = sumData?.originalimage?.source || sumData?.thumbnail?.source;
        if (
          img &&
          typeof img === 'string' &&
          img.startsWith('http') &&
          !img.includes('.svg') &&
          !img.includes('coat_of_arms') &&
          !img.includes('flag') &&
          !img.includes('document') &&
          !img.includes('manuscript') &&
          !img.includes('paper')
        ) {
          candidates.push(img);
        }
      }
      if (candidates.length > 0) break;
    } catch {}
  }
  return candidates;
}

async function directClientWikipediaPortrait(name: string, series?: string): Promise<string | null> {
  const list = await directClientWikipediaCandidates(name, series);
  return list.length > 0 ? list[0] : null;
}

/**
 * Fetch a real character image dynamically from the backend web search.
 * Deduplicates concurrent requests and notifies subscribers.
 */
export async function resolveCharacterImage(
  char?: Partial<Character> | { name: string; series?: string; avatarUrl?: string } | null,
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
      const result = await fetchDynamicCharacterImage(char.name!, char.series, force);
      let fetchedUrl = result.imageUrl;
      // Store candidates for instant cycling
      if (result.candidates && result.candidates.length > 0) {
        candidatesCache.set(key, result.candidates);
      }
      if (!fetchedUrl) {
        // Direct Wikipedia portrait fallback if server is waking up or offline
        const wikiCandidates = await directClientWikipediaCandidates(char.name!, char.series);
        if (wikiCandidates.length > 0) {
          fetchedUrl = wikiCandidates[0];
          const existingPool = candidatesCache.get(key) || [];
          candidatesCache.set(key, Array.from(new Set([...existingPool, ...wikiCandidates])));
        }
      }
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

    // If character already has an avatar that isn't a dummy sample, preserve it
    if (char.avatarUrl && !char.avatarUrl.includes('unsplash.com') && !char.avatarUrl.includes('dicebear.com')) {
      memoryImageCache.set(key, char.avatarUrl);
      listeners.forEach((fn) => fn(key, char.avatarUrl!));
      return char.avatarUrl;
    }

    return null;
  })();

  pendingFetches.set(key, fetchPromise);
  return fetchPromise;
}

/**
 * Instantly cycle to the next candidate image.
 * Guarantees a brand new image on the VERY FIRST TAP by fetching fresh candidates
 * eagerly if the local candidate pool has fewer than 2 items.
 */
export async function cycleCharacterImage(
  char?: Partial<Character> | { name: string; series?: string; avatarUrl?: string } | null
): Promise<string | null> {
  if (!char || !char.name) return null;
  const key = getCacheKey(char.name, char.series);
  let pool = candidatesCache.get(key) || [];
  const currentUrl = memoryImageCache.get(key) || char.avatarUrl || '';

  // If pool has fewer than 2 candidates, eagerly fetch candidates immediately
  if (pool.length < 2) {
    try {
      const [serverRes, wikiCandidates] = await Promise.allSettled([
        fetchDynamicCharacterImage(char.name, char.series, true),
        directClientWikipediaCandidates(char.name, char.series),
      ]);

      const gathered = new Set<string>();
      if (serverRes.status === 'fulfilled' && serverRes.value?.candidates) {
        serverRes.value.candidates.forEach((u) => gathered.add(u));
      }
      if (wikiCandidates.status === 'fulfilled' && wikiCandidates.value) {
        wikiCandidates.value.forEach((u) => gathered.add(u));
      }
      if (gathered.size > 0) {
        pool = Array.from(gathered);
        candidatesCache.set(key, pool);
      }
    } catch {}
  }

  // Filter out stock photos or blank URLs
  const cleanPool = pool.filter(
    (u) => u && typeof u === 'string' && !u.includes('unsplash.com') && !u.includes('dicebear.com') && !u.includes('.svg')
  );
  const activePool = cleanPool.length > 0 ? cleanPool : pool;

  // Pick a candidate that is guaranteed different from currentUrl
  const filtered = activePool.filter((u) => u !== currentUrl && u !== char.avatarUrl);
  const pick =
    filtered.length > 0
      ? filtered[Math.floor(Math.random() * filtered.length)]
      : activePool.length > 0
      ? activePool[Math.floor(Math.random() * activePool.length)]
      : null;

  if (pick && pick !== currentUrl) {
    memoryImageCache.set(key, pick);
    persistCache().catch(() => {});
    listeners.forEach((fn) => fn(key, pick));
    return pick;
  }

  // If still no pool, run a forced resolution and pick
  const freshUrl = await resolveCharacterImage(char, true);
  if (freshUrl && !freshUrl.includes('unsplash.com')) {
    memoryImageCache.set(key, freshUrl);
    persistCache().catch(() => {});
    listeners.forEach((fn) => fn(key, freshUrl));
    return freshUrl;
  }

  return pick || freshUrl;
}

/**
 * Returns available character look candidates for previewing and selecting inside chat.
 */
export async function getCharacterCandidateLooks(
  char?: Partial<Character> | { name: string; series?: string; avatarUrl?: string } | null
): Promise<string[]> {
  if (!char || !char.name) return [];
  const key = getCacheKey(char.name, char.series);
  let pool = candidatesCache.get(key) || [];

  if (pool.length < 2) {
    try {
      const [serverRes, wikiCandidates] = await Promise.allSettled([
        fetchDynamicCharacterImage(char.name, char.series, true),
        directClientWikipediaCandidates(char.name, char.series),
      ]);
      const gathered = new Set<string>();
      if (char.avatarUrl && !char.avatarUrl.includes('unsplash.com')) gathered.add(char.avatarUrl);
      if (serverRes.status === 'fulfilled' && serverRes.value?.candidates) {
        serverRes.value.candidates.forEach((u) => gathered.add(u));
      }
      if (wikiCandidates.status === 'fulfilled' && wikiCandidates.value) {
        wikiCandidates.value.forEach((u) => gathered.add(u));
      }
      if (gathered.size > 0) {
        pool = Array.from(gathered);
        candidatesCache.set(key, pool);
      }
    } catch {}
  }

  const cleanPool = pool.filter(
    (u) => u && typeof u === 'string' && !u.includes('unsplash.com') && !u.includes('dicebear.com') && !u.includes('.svg')
  );
  if (cleanPool.length > 0) return cleanPool.slice(0, 8);
  if (char.avatarUrl && !char.avatarUrl.includes('unsplash.com')) return [char.avatarUrl];
  return pool.slice(0, 8);
}

/**
 * Manually select a specific look from available candidate looks.
 */
export function selectCharacterLook(
  char: Partial<Character> | { name: string; series?: string },
  chosenUrl: string
): void {
  if (!char || !char.name || !chosenUrl) return;
  const key = getCacheKey(char.name, char.series);
  memoryImageCache.set(key, chosenUrl);
  persistCache().catch(() => {});
  listeners.forEach((fn) => fn(key, chosenUrl));
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
