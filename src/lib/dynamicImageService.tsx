import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Image, ImageProps } from 'expo-image';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
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

export function getCacheKey(name: string, _series?: string): string {
  return (name || '').trim().toLowerCase();
}

export function getResolvedCharacterImage(name: string): string | null {
  return memoryImageCache.get(getCacheKey(name)) || null;
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
  const nameTokens = cleanName.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  const candidates: string[] = [];

  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
      cleanName
    )}&srlimit=5&format=json&origin=*`;
    const res = await fetch(searchUrl, {
      headers: { 'User-Agent': 'GuildTalkApp/1.0.4 (contact@guildtalk.app)' },
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = await res.json();
      const items = data?.query?.search || [];

      // Find direct matches where title includes core tokens of character's name
      let primaryTitle: string | null = null;
      for (const item of items) {
        const title = item.title || '';
        const titleLower = title.toLowerCase();
        const isMatch =
          nameTokens.some((tok) => titleLower.includes(tok)) || cleanName.toLowerCase().includes(titleLower);
        if (isMatch) {
          if (!primaryTitle) primaryTitle = title;
          try {
            const sumUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
            const sumRes = await fetch(sumUrl, {
              headers: { 'User-Agent': 'GuildTalkApp/1.0.4 (contact@guildtalk.app)' },
              signal: AbortSignal.timeout(3000),
            });
            if (sumRes.ok) {
              const sumData = await sumRes.json();
              const img = sumData?.originalimage?.source || sumData?.thumbnail?.source;
              if (
                img &&
                typeof img === 'string' &&
                !img.includes('.svg') &&
                !img.includes('flag') &&
                !img.includes('icon') &&
                !img.includes('logo') &&
                !img.includes('coat_of_arms') &&
                !img.includes('document') &&
                !img.includes('manuscript')
              ) {
                if (!candidates.includes(img)) candidates.push(img);
              }
            }
          } catch {}
        }
      }

      // If we found a primary matching article, fetch in-page image files from that article
      if (primaryTitle && candidates.length < 5) {
        try {
          const filesUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
            primaryTitle
          )}&prop=images&imlimit=15&format=json&origin=*`;
          const filesRes = await fetch(filesUrl, {
            headers: { 'User-Agent': 'GuildTalkApp/1.0.4 (contact@guildtalk.app)' },
            signal: AbortSignal.timeout(3500),
          });
          if (filesRes.ok) {
            const filesData = await filesRes.json();
            const pages = Object.values(filesData?.query?.pages || {}) as any[];
            const imagesList = pages[0]?.images || [];
            const fileTitles = imagesList
              .map((im: any) => im.title)
              .filter(
                (t: string) =>
                  t &&
                  !t.endsWith('.svg') &&
                  !t.includes('Flag') &&
                  !t.includes('Icon') &&
                  !t.includes('Portal') &&
                  !t.includes('Commons') &&
                  !t.includes('Logo')
              )
              .slice(0, 4);

            for (const fTitle of fileTitles) {
              try {
                const infoUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(
                  fTitle
                )}&prop=imageinfo&iiprop=url&iiurlwidth=600&format=json&origin=*`;
                const infoRes = await fetch(infoUrl, {
                  headers: { 'User-Agent': 'GuildTalkApp/1.0.4 (contact@guildtalk.app)' },
                  signal: AbortSignal.timeout(3000),
                });
                if (infoRes.ok) {
                  const infoData = await infoRes.json();
                  const ipages = Object.values(infoData?.query?.pages || {}) as any[];
                  const url = ipages[0]?.imageinfo?.[0]?.thumburl || ipages[0]?.imageinfo?.[0]?.url;
                  if (url && typeof url === 'string' && url.startsWith('http') && !candidates.includes(url)) {
                    candidates.push(url);
                  }
                }
              } catch {}
            }
          }
        } catch {}
      }
    }
  } catch {}

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
    (u) =>
      u &&
      typeof u === 'string' &&
      !u.includes('unsplash.com') &&
      !u.includes('dicebear.com') &&
      !u.includes('.svg') &&
      !u.includes('placeholder')
  );

  // If we only have 1 verified look or none, don't jump to dummy images!
  if (cleanPool.length <= 1) {
    const existing =
      cleanPool[0] ||
      (currentUrl && !currentUrl.includes('dicebear') && !currentUrl.includes('unsplash') ? currentUrl : null);
    if (existing) {
      memoryImageCache.set(key, existing);
      return existing;
    }
  }

  // Pick a candidate that is guaranteed different from currentUrl
  const filtered = cleanPool.filter((u) => u !== currentUrl && u !== char.avatarUrl);
  const pick =
    filtered.length > 0
      ? filtered[Math.floor(Math.random() * filtered.length)]
      : cleanPool.length > 0
      ? cleanPool[Math.floor(Math.random() * cleanPool.length)]
      : null;

  if (pick && pick !== currentUrl) {
    memoryImageCache.set(key, pick);
    persistCache().catch(() => {});
    listeners.forEach((fn) => fn(key, pick));
    return pick;
  }

  // If still no pool, run a forced resolution and pick
  const freshUrl = await resolveCharacterImage(char, true);
  if (freshUrl && !freshUrl.includes('unsplash.com') && !freshUrl.includes('dicebear.com')) {
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
      if (
        char.avatarUrl &&
        !char.avatarUrl.includes('unsplash.com') &&
        !char.avatarUrl.includes('dicebear.com')
      ) {
        gathered.add(char.avatarUrl);
      }
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

  // Filter out any dummy, unsplash, or dicebear images
  const cleanPool = pool.filter(
    (u) =>
      u &&
      typeof u === 'string' &&
      !u.includes('unsplash.com') &&
      !u.includes('dicebear.com') &&
      !u.includes('.svg') &&
      !u.includes('placeholder')
  );

  if (cleanPool.length > 0) return cleanPool.slice(0, 8);
  if (
    char.avatarUrl &&
    !char.avatarUrl.includes('unsplash.com') &&
    !char.avatarUrl.includes('dicebear.com')
  ) {
    return [char.avatarUrl];
  }
  return [];
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
 * Adds a custom uploaded look to character's candidate pool and sets it as the active look.
 */
export function addCustomLookToCharacter(
  char: Partial<Character> | { name: string; series?: string },
  customUrl: string
): void {
  if (!char || !char.name || !customUrl) return;
  const key = getCacheKey(char.name, char.series);
  const existing = candidatesCache.get(key) || [];
  if (!existing.includes(customUrl)) {
    candidatesCache.set(key, [customUrl, ...existing]);
  }
  selectCharacterLook(char, customUrl);
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

  const isDummy = (url?: string) =>
    !url ||
    typeof url !== 'string' ||
    url.includes('dicebear.com') ||
    url.includes('unsplash.com') ||
    url.includes('placeholder');

  const rawUrl = options?.preferCover
    ? character?.coverUrl || character?.avatarUrl
    : character?.avatarUrl || character?.coverUrl;

  const cachedUrl = memoryImageCache.get(key);
  const initialUrl = (!isDummy(cachedUrl) ? cachedUrl : '') || (!isDummy(rawUrl) ? rawUrl : '') || '';

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
    if (cached && !isDummy(cached) && cached !== currentUri) {
      setCurrentUri(cached);
    } else if (isDummy(currentUri) && !isDummy(rawUrl)) {
      setCurrentUri(rawUrl!);
    }
  }, [key, currentUri, rawUrl]);

  // Subscribe to global image resolution broadcasts
  useEffect(() => {
    const onUpdate: CacheListener = (updatedKey, newUrl) => {
      if (updatedKey === key && isMounted.current && !isDummy(newUrl)) {
        setCurrentUri(newUrl);
        setIsResolving(false);
      }
    };
    listeners.add(onUpdate);
    return () => {
      listeners.delete(onUpdate);
    };
  }, [key]);

  // If initially missing any valid URL, proactively resolve
  useEffect(() => {
    if (name && (isDummy(currentUri) || !currentUri)) {
      setIsResolving(true);
      resolveCharacterImage(character, false).then((res) => {
        if (isMounted.current) {
          if (res && !isDummy(res)) setCurrentUri(res);
          setIsResolving(false);
        }
      });
    }
  }, [name, currentUri, character]);

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
  const [loadFailed, setLoadFailed] = useState(false);

  const handleError = useCallback(
    (e: any) => {
      setLoadFailed(true);
      onImageError();
      if (onError) onError(e);
    },
    [onImageError, onError]
  );

  useEffect(() => {
    setLoadFailed(false);
  }, [finalUri]);

  if (!finalUri || loadFailed) {
    const rawName = resolvedChar?.name || characterName || 'Character';
    const initials =
      rawName
        .trim()
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase() || 'GT';

    return (
      <View style={[style, { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }]}>
        <LinearGradient
          colors={['#8B5CF6', '#EC4899', '#3B82F6']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Text style={{ color: '#FFFFFF', fontSize: 24, fontWeight: '900', letterSpacing: 0.5 }}>
          {initials}
        </Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri: finalUri }}
      style={style}
      onError={handleError}
      {...rest}
    />
  );
}
