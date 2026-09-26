import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Platform,
  Keyboard,
  Animated,
  Easing,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { BlurView } from 'expo-blur';
import { useTheme } from '@/src/context/ThemeContext';
import { useAuth } from '@/src/context/AuthContext';
import { LiquidGlassView } from '@/src/components/LiquidGlassView';
import {
  searchMultiCharacters,
  saveCustomCharacter,
  listConversations,
  CharacterCandidate,
} from '@/src/lib/chatApi';
import { getAllBuiltinCharacters, registerCustomCharacter } from '@/src/data/characters';
import { DynamicCharacterImage } from '@/src/lib/dynamicImageService';
import { Character } from '@/src/types/character';

const getRecentQueriesKey = (userId?: string | null) =>
  `charai_recent_searches_${(userId || '').trim() || 'guest'}`;
const getRecentCharsKey = (userId?: string | null) =>
  `charai_recent_viewed_characters_${(userId || '').trim() || 'guest'}`;
const DEVICE_STORAGE_KEY = 'charai_device_id';
const MAX_RECENT_QUERIES = 12;
const MAX_RECENT_CHARS = 10;

interface RecentCharacterItem {
  id: string;
  name: string;
  series?: string;
  role: string;
  avatarUrl: string;
}

export interface LiveInstantResult {
  id: string;
  name: string;
  series?: string;
  role: string;
  avatarUrl?: string;
  description?: string;
  isBuiltin?: boolean;
  builtinChar?: Character;
}

async function fetchLiveWikipediaEntities(q: string, signal?: AbortSignal): Promise<LiveInstantResult[]> {
  const cleanQ = q.trim();
  if (cleanQ.length < 2) return [];

  try {
    const url = `https://en.wikipedia.org/w/api.php?action=query&generator=prefixsearch&gpssearch=${encodeURIComponent(
      cleanQ
    )}&gpslimit=8&prop=pageimages|description|extracts&piprop=thumbnail&pithumbsize=360&pilim=8&exintro=1&explaintext=1&exchars=140&format=json&origin=*`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'GuildTalkApp/1.0.3 (contact@guildtalk.app)' },
      signal: signal || AbortSignal.timeout(3500),
    });

    if (!res.ok) return [];
    const data = await res.json();
    const pagesObj = data?.query?.pages;
    if (!pagesObj) return [];

    const pages: any[] = Object.values(pagesObj);
    pages.sort((a, b) => (a.index || 99) - (b.index || 99));

    const results: LiveInstantResult[] = [];
    for (const page of pages) {
      const title: string = page.title || '';
      const desc: string = page.description || page.extract || '';
      const lowerTitle = title.toLowerCase();
      const lowerDesc = desc.toLowerCase();

      // Filter out non-character / non-person Wikipedia articles
      if (
        lowerTitle.includes('(disambiguation)') ||
        lowerTitle.startsWith('list of') ||
        lowerTitle.includes('filmography') ||
        lowerTitle.includes('discography') ||
        lowerTitle.includes('soundtrack') ||
        lowerTitle.includes('season ') ||
        lowerTitle.includes('awards and') ||
        lowerTitle.includes('episode ') ||
        lowerTitle.includes('video game') ||
        lowerDesc.includes('wikimedia') ||
        lowerDesc.includes('disambiguation')
      ) {
        continue;
      }

      const match = title.match(/^(.*?)\s*\((.*?)\)$/);
      const cleanName = match ? match[1].trim() : title;
      const series = match ? match[2].trim() : desc ? desc.split('·')[0].trim() : 'Famous Universe';

      results.push({
        id: `wiki-${page.pageid || cleanName.toLowerCase().replace(/\s+/g, '-')}`,
        name: cleanName,
        series: series.charAt(0).toUpperCase() + series.slice(1),
        role: desc ? desc.slice(0, 80) : 'Iconic Character',
        avatarUrl: page.thumbnail?.source || '',
        description: page.extract || desc || `Iconic figure ${cleanName}.`,
      });

      if (results.length >= 6) break;
    }

    return results;
  } catch {
    return [];
  }
}

async function fetchLiveAniListEntities(q: string, signal?: AbortSignal): Promise<LiveInstantResult[]> {
  const cleanQ = q.trim();
  if (cleanQ.length < 2) return [];

  const query = `
    query ($search: String) {
      Page(page: 1, perPage: 4) {
        characters(search: $search) {
          id
          name {
            full
            native
          }
          image {
            large
            medium
          }
          description
          media(sort: POPULARITY_DESC, perPage: 1) {
            nodes {
              title {
                english
                romaji
              }
            }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables: { search: cleanQ } }),
      signal: signal || AbortSignal.timeout(3500),
    });

    if (!res.ok) return [];
    const data = await res.json();
    const chars = data?.data?.Page?.characters || [];

    return chars.map((c: any) => {
      const mediaTitle = c.media?.nodes?.[0]?.title?.english || c.media?.nodes?.[0]?.title?.romaji || 'Anime';
      const cleanDesc = (c.description || '')
        .replace(/~!.+?!~/g, '')
        .replace(/<[^>]*>/g, '')
        .trim();

      return {
        id: `anilist-${c.id}`,
        name: c.name?.full || cleanQ,
        series: mediaTitle,
        role: `Anime Character · ${mediaTitle}`,
        avatarUrl: c.image?.large || c.image?.medium || '',
        description: cleanDesc.slice(0, 160) || `Anime hero ${c.name?.full || cleanQ}.`,
      };
    });
  } catch {
    return [];
  }
}

const TRENDING = [
  { query: 'Gojo Satoru', icon: '⚡' },
  { query: 'Batman', icon: '🦇' },
  { query: 'Walter White', icon: '⚗️' },
  { query: 'Naruto', icon: '🍥' },
  { query: 'Sherlock Holmes', icon: '🔍' },
  { query: 'Tony Stark', icon: '🤖' },
  { query: 'Levi Ackerman', icon: '⚔️' },
  { query: 'Furina', icon: '🎭' },
  { query: 'John Wick', icon: '🔫' },
  { query: 'Makima', icon: '🐕' },
  { query: 'Leo Das', icon: '🐆' },
  { query: 'Light Yagami', icon: '📓' },
];

const UNIVERSE_CATEGORIES = [
  { id: 'all', label: 'All Universes', icon: 'planet-outline' },
  { id: 'anime', label: 'Anime & Manga', icon: 'flash-outline' },
  { id: 'cinema', label: 'Cinema & Film', icon: 'videocam-outline' },
  { id: 'gaming', label: 'Gaming & RPG', icon: 'game-controller-outline' },
  { id: 'comics', label: 'Comics & Marvel', icon: 'shield-outline' },
];

function useRecentSearches(userId?: string | null) {
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const storageKey = getRecentQueriesKey(userId);

  const loadRecentQueries = useCallback(async () => {
    try {
      let raw: string | null = null;
      if (Platform.OS === 'web') {
        raw = globalThis.localStorage?.getItem(storageKey);
      } else {
        raw = await SecureStore.getItemAsync(storageKey);
      }
      if (raw) setRecentQueries(JSON.parse(raw));
      else setRecentQueries([]);
    } catch {
      setRecentQueries([]);
    }
  }, [storageKey]);

  useEffect(() => {
    loadRecentQueries();
  }, [loadRecentQueries]);

  const addRecentQuery = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setRecentQueries((prev) => {
      const updated = [
        trimmed,
        ...prev.filter((r) => r.toLowerCase() !== trimmed.toLowerCase()),
      ].slice(0, MAX_RECENT_QUERIES);
      const serialized = JSON.stringify(updated);
      if (Platform.OS === 'web') {
        globalThis.localStorage?.setItem(storageKey, serialized);
      } else {
        SecureStore.setItemAsync(storageKey, serialized).catch(() => {});
      }
      return updated;
    });
  }, [storageKey]);

  const clearRecentQueries = useCallback(async () => {
    setRecentQueries([]);
    if (Platform.OS === 'web') {
      globalThis.localStorage?.removeItem(storageKey);
    } else {
      SecureStore.deleteItemAsync(storageKey).catch(() => {});
    }
  }, [storageKey]);

  const removeRecentQuery = useCallback(async (query: string) => {
    setRecentQueries((prev) => {
      const updated = prev.filter((r) => r !== query);
      const serialized = JSON.stringify(updated);
      if (Platform.OS === 'web') {
        globalThis.localStorage?.setItem(storageKey, serialized);
      } else {
        SecureStore.setItemAsync(storageKey, serialized).catch(() => {});
      }
      return updated;
    });
  }, [storageKey]);

  return { recentQueries, addRecentQuery, clearRecentQueries, removeRecentQuery };
}

function useRecentCharacters(user: any, token: string | null) {
  const [recentChars, setRecentChars] = useState<RecentCharacterItem[]>([]);
  const storageKey = getRecentCharsKey(user?.id);

  const loadRecentChars = useCallback(async () => {
    try {
      let stored: RecentCharacterItem[] = [];
      let raw: string | null = null;
      if (Platform.OS === 'web') {
        raw = globalThis.localStorage?.getItem(storageKey);
      } else {
        raw = await SecureStore.getItemAsync(storageKey);
      }
      if (raw) stored = JSON.parse(raw);

      // Also merge with recent conversations from server/backend if any
      let deviceId = 'guest';
      if (Platform.OS === 'web') {
        deviceId = globalThis.localStorage?.getItem(DEVICE_STORAGE_KEY) || 'web-guest';
      } else {
        deviceId = (await SecureStore.getItemAsync(DEVICE_STORAGE_KEY)) || 'device-guest';
      }
      const activeUserId = user?.id || deviceId;
      const convs = await listConversations(activeUserId, token);
      const allBuiltin = getAllBuiltinCharacters();

      const map = new Map<string, RecentCharacterItem>();
      // Put explicitly stored ones first
      stored.forEach((c) => map.set(c.id, c));

      // Put server convs
      if (Array.isArray(convs) && convs.length > 0) {
        for (const cv of convs) {
          if (!cv.characterId) continue;
          if (!map.has(cv.characterId)) {
            const found = allBuiltin.find((b) => b.id === cv.characterId);
            map.set(cv.characterId, {
              id: cv.characterId,
              name: found?.name || cv.characterName,
              series: found?.series || 'Companion',
              role: found?.role || 'Character',
              avatarUrl:
                found?.avatarUrl ||
                cv.characterAvatar ||
                'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=500&auto=format&fit=crop&q=80',
            });
          }
        }
      }

      setRecentChars(Array.from(map.values()).slice(0, MAX_RECENT_CHARS));
    } catch {
      // Fallback
    }
  }, [user?.id, token, storageKey]);

  useEffect(() => {
    loadRecentChars();
  }, [loadRecentChars]);

  const addRecentChar = useCallback(async (char: RecentCharacterItem) => {
    setRecentChars((prev) => {
      const updated = [char, ...prev.filter((c) => c.id !== char.id)].slice(0, MAX_RECENT_CHARS);
      const serialized = JSON.stringify(updated);
      if (Platform.OS === 'web') {
        globalThis.localStorage?.setItem(storageKey, serialized);
      } else {
        SecureStore.setItemAsync(storageKey, serialized).catch(() => {});
      }
      return updated;
    });
  }, [storageKey]);

  const clearRecentChars = useCallback(async () => {
    setRecentChars([]);
    if (Platform.OS === 'web') {
      globalThis.localStorage?.removeItem(storageKey);
    } else {
      SecureStore.deleteItemAsync(storageKey).catch(() => {});
    }
  }, [storageKey]);

  const removeRecentChar = useCallback(async (id: string) => {
    setRecentChars((prev) => {
      const updated = prev.filter((c) => c.id !== id);
      const serialized = JSON.stringify(updated);
      if (Platform.OS === 'web') {
        globalThis.localStorage?.setItem(storageKey, serialized);
      } else {
        SecureStore.setItemAsync(storageKey, serialized).catch(() => {});
      }
      return updated;
    });
  }, [storageKey]);

  return { recentChars, addRecentChar, clearRecentChars, removeRecentChar };
}

export default function SearchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { theme, isDark } = useTheme();
  const { user, token } = useAuth();
  const { recentQueries, addRecentQuery, clearRecentQueries, removeRecentQuery } = useRecentSearches(user?.id);
  const { recentChars, addRecentChar, clearRecentChars, removeRecentChar } = useRecentCharacters(user, token);

  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isSearching, setIsSearching] = useState(false);
  const [results, setResults] = useState<CharacterCandidate[]>([]);
  const [liveResults, setLiveResults] = useState<LiveInstantResult[]>([]);
  const [isLiveLoading, setIsLiveLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const shimmerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (isSearching) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerAnim, {
            toValue: 1,
            duration: 850,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(shimmerAnim, {
            toValue: 0,
            duration: 850,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      shimmerAnim.stopAnimation();
      shimmerAnim.setValue(0);
    }
  }, [isSearching]);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 180);
    return () => clearTimeout(t);
  }, []);

  // Instant suggestions while typing (local, trending, and Wikipedia live autocomplete)
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      const qLower = q.toLowerCase();
      const list = new Set<string>();

      // Local builtin characters
      getAllBuiltinCharacters().forEach((c) => {
        if (c.name.toLowerCase().includes(qLower)) list.add(c.name);
      });

      // Trending queries
      TRENDING.forEach((t) => {
        if (t.query.toLowerCase().includes(qLower)) list.add(t.query);
      });

      // Live Wikipedia suggestions
      try {
        const url = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(q)}&limit=6&namespace=0&format=json&origin=*`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'GuildTalkApp/1.0.3 (contact@guildtalk.app)' },
          signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
          const data = await res.json();
          const titles: string[] = data?.[1] || [];
          titles.forEach((t) => {
            if (t && !t.includes(':') && !t.includes('List of') && !t.includes('Disambiguation')) {
              list.add(t);
            }
          });
        }
      } catch {}

      setSuggestions(Array.from(list).slice(0, 8));
    }, 180);

    return () => clearTimeout(timer);
  }, [query]);

  // Instant live search while typing (0ms local characters + 160ms Wikipedia & Knowledge Graph entities)
  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setLiveResults([]);
      setIsLiveLoading(false);
      return;
    }

    // 1. FAST LOCAL MATCHES (0ms instant)
    const qLower = q.toLowerCase();
    const allChars = getAllBuiltinCharacters();
    const localMatches: LiveInstantResult[] = allChars
      .filter((c) => {
        const matchesQuery =
          c.name.toLowerCase().includes(qLower) ||
          (c.series && c.series.toLowerCase().includes(qLower)) ||
          c.role.toLowerCase().includes(qLower);

        if (!matchesQuery) return false;
        if (selectedCategory === 'all') return true;
        if (selectedCategory === 'anime') {
          return (
            c.category === 'anime' ||
            c.series?.toLowerCase().includes('jujutsu') ||
            c.series?.toLowerCase().includes('chainsaw') ||
            c.series?.toLowerCase().includes('titan') ||
            ['gojo', 'sukuna', 'makima', 'levi'].includes(c.id)
          );
        }
        if (selectedCategory === 'cinema') {
          return (
            c.category === 'cinema' ||
            ['leo-das', 'master-jd', 'vikram-commander', 'rolex', 'baasha', 'dilli', 'bhavani', 'tony-stark', 'batman', 'john-wick', 'walter-white', 'joker'].includes(c.id)
          );
        }
        if (selectedCategory === 'gaming') {
          return (
            c.category === 'gaming' ||
            c.series?.toLowerCase().includes('genshin') ||
            ['furina', 'hu-tao', 'raiden'].includes(c.id)
          );
        }
        if (selectedCategory === 'comics') {
          return ['batman', 'joker', 'tony-stark'].includes(c.id);
        }
        return true;
      })
      .slice(0, 8)
      .map((c) => ({
        id: c.id,
        name: c.name,
        series: c.series,
        role: c.role,
        avatarUrl: c.avatarUrl,
        description: c.description,
        isBuiltin: true,
        builtinChar: c,
      }));

    setLiveResults(localMatches);

    // 2. LIVE WIKIPEDIA & ANILIST REAL-TIME MATCHES (160ms debounced)
    const abortController = new AbortController();
    setIsLiveLoading(true);

    const timer = setTimeout(async () => {
      try {
        const isAnime = selectedCategory === 'anime';
        const [wikiRes, aniRes] = await Promise.allSettled([
          fetchLiveWikipediaEntities(q, abortController.signal),
          fetchLiveAniListEntities(q, abortController.signal),
        ]);

        const wikiEntities = wikiRes.status === 'fulfilled' ? wikiRes.value : [];
        const aniEntities = aniRes.status === 'fulfilled' ? aniRes.value : [];

        setLiveResults((prev) => {
          const map = new Map<string, LiveInstantResult>();
          // Put local matches first
          prev.forEach((item) => map.set(item.name.toLowerCase(), item));

          // If in anime tab or anime query, prioritize AniList studio art
          if (isAnime) {
            aniEntities.forEach((entity) => {
              if (!map.has(entity.name.toLowerCase())) {
                map.set(entity.name.toLowerCase(), entity);
              }
            });
            wikiEntities.forEach((entity) => {
              if (!map.has(entity.name.toLowerCase())) {
                map.set(entity.name.toLowerCase(), entity);
              }
            });
          } else {
            wikiEntities.forEach((entity) => {
              if (!map.has(entity.name.toLowerCase())) {
                map.set(entity.name.toLowerCase(), entity);
              }
            });
            aniEntities.forEach((entity) => {
              if (!map.has(entity.name.toLowerCase())) {
                map.set(entity.name.toLowerCase(), entity);
              }
            });
          }
          return Array.from(map.values()).slice(0, 10);
        });
      } catch {
        // ignore
      } finally {
        setIsLiveLoading(false);
      }
    }, 160);

    return () => {
      clearTimeout(timer);
      abortController.abort();
    };
  }, [query, selectedCategory]);

  const openCharacter = (char: { id: string; name: string; series?: string; role: string; avatarUrl: string }) => {
    addRecentChar({
      id: char.id,
      name: char.name,
      series: char.series,
      role: char.role,
      avatarUrl: char.avatarUrl,
    });
    router.back();
    setTimeout(() => router.push(`/chat/${char.id}`), 50);
  };

  const performSearch = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed || isSearching) return;
      Keyboard.dismiss();
      setError(null);
      setSearched(true);
      setIsSearching(true);
      setResults([]);
      addRecentQuery(trimmed);

      const allChars = getAllBuiltinCharacters();
      const cleanLower = trimmed.toLowerCase();

      // Gather matching local builtin characters
      const localMatches = allChars.filter((c) => {
        const n = c.name.toLowerCase();
        const s = (c.series || '').toLowerCase();
        return n.includes(cleanLower) || cleanLower.includes(n) || s.includes(cleanLower);
      });

      const mergedMap = new Map<string, CharacterCandidate>();

      // Seed with local character candidates
      localMatches.forEach((c) => {
        mergedMap.set(c.name.toLowerCase(), {
          name: c.name,
          series: c.series || 'Famous Universe',
          role: c.role,
          description: c.description,
          shortDescription: c.shortDescription || c.description.slice(0, 100),
          greeting: c.greeting,
          avatarUrl: c.avatarUrl,
          coverUrl: c.coverUrl,
          personality: c.personality,
        });
      });

      try {
        const candidates = await searchMultiCharacters(trimmed, undefined, token);
        if (candidates && candidates.length > 0) {
          candidates.forEach((cand) => {
            mergedMap.set(cand.name.toLowerCase(), cand);
          });
        }
      } catch (err) {
        console.warn('Multi search error:', err);
      }

      const finalCandidates = Array.from(mergedMap.values());
      if (finalCandidates.length > 0) {
        setResults(finalCandidates);
      } else {
        setResults([
          {
            name: trimmed,
            series: 'Custom Origin',
            role: 'Iconic Hero',
            shortDescription: `Custom character persona for ${trimmed}`,
            description: `A legendary figure known as ${trimmed}. Ready to converse with wit, charisma, and lore.`,
            personality: ['Charismatic', 'Sharp', 'Authentic'],
            greeting: `Hello! I am ${trimmed}. What shall we talk about today?`,
            avatarUrl: '',
            coverUrl: '',
          },
        ]);
      }
      setIsSearching(false);
    },
    [isSearching, token, addRecentQuery]
  );

  const selectCandidate = (cand: CharacterCandidate) => {
    // If it is an existing registered character, open directly
    const allChars = getAllBuiltinCharacters();
    const existing = allChars.find((c) => c.name.toLowerCase() === cand.name.toLowerCase());
    if (existing) {
      if (cand.avatarUrl && cand.avatarUrl !== existing.avatarUrl) {
        existing.avatarUrl = cand.avatarUrl;
        existing.coverUrl = cand.coverUrl || cand.avatarUrl;
      }
      openCharacter(existing);
      return;
    }

    const charId = `custom-${Date.now()}`;
    const newChar: Character = {
      id: charId,
      name: cand.name,
      series: cand.series,
      role: cand.role,
      shortDescription: cand.shortDescription || cand.description?.slice(0, 100) || '',
      description: cand.description || '',
      category: 'custom',
      personality: cand.personality || ['Witty', 'Intelligent'],
      roleplayRules: 'Respond in full character with authentic voice, charisma and lore.',
      greeting: cand.greeting || 'Greetings.',
      avatarUrl: cand.avatarUrl,
      coverUrl: cand.coverUrl,
      accent: '#FFFFFF',
      isOnline: true,
      starters: ['Tell me about your world.', 'What is your greatest secret?'],
      isCustom: true,
    };
    registerCustomCharacter(newChar);
    addRecentChar({
      id: charId,
      name: cand.name,
      series: cand.series,
      role: cand.role,
      avatarUrl: cand.avatarUrl,
    });
    router.back();
    setTimeout(() => router.push(`/chat/${charId}`), 50);
    saveCustomCharacter(newChar, token).catch(() => {});
  };

  const handleSelectLiveResult = (item: LiveInstantResult) => {
    if (item.builtinChar) {
      openCharacter(item.builtinChar);
      return;
    }

    const allChars = getAllBuiltinCharacters();
    const existing = allChars.find((c) => c.name.toLowerCase() === item.name.toLowerCase());
    if (existing) {
      openCharacter(existing);
      return;
    }

    selectCandidate({
      name: item.name,
      series: item.series || 'Famous Universe',
      role: item.role || 'Iconic Figure',
      shortDescription: item.description?.slice(0, 100) || item.role,
      description: item.description || `Iconic character ${item.name}. Ready to talk with authentic voice and lore.`,
      personality: ['Charismatic', 'Sharp', 'Authentic'],
      greeting: `Hello! I am ${item.name}. What shall we talk about today?`,
      avatarUrl: item.avatarUrl || '',
      coverUrl: item.avatarUrl || '',
    });
  };

  const shimmerOpacity = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.8],
  });

  const showIdle = !searched && query.trim().length === 0;
  const showTyping = query.trim().length > 0 && !searched;

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      {Platform.OS !== 'web' && (
        <BlurView
          intensity={isDark ? 65 : 40}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      )}

      {/* Header with Search Bar and Cancel */}
      <SafeAreaView edges={['top']} style={{ backgroundColor: 'transparent' }}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <LiquidGlassView style={styles.inputWrap} borderRadius={22} intensity={35} elevated>
            <Ionicons name="search" size={19} color={isSearching ? theme.text : theme.secondary} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={(t) => {
                setQuery(t);
                setSearched(false);
                setResults([]);
              }}
              placeholder="Search any character (Gojo, Batman, Leo…)"
              placeholderTextColor={theme.muted}
              style={[styles.input, { color: theme.text }]}
              onSubmitEditing={() => performSearch(query)}
              returnKeyType="search"
              autoCapitalize="words"
              autoCorrect={false}
            />
            {isSearching ? (
              <ActivityIndicator size="small" color={theme.text} style={{ marginRight: 4 }} />
            ) : query.length > 0 ? (
              <Pressable
                onPress={() => {
                  setQuery('');
                  setSearched(false);
                  setResults([]);
                  setLiveResults([]);
                  inputRef.current?.focus();
                }}
                hitSlop={10}
              >
                <Ionicons name="close-circle" size={20} color={theme.muted} />
              </Pressable>
            ) : null}
          </LiquidGlassView>

          <Pressable
            onPress={() => router.back()}
            style={[styles.cancelBtn, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}
            hitSlop={6}
          >
            <Text style={[styles.cancelText, { color: theme.text }]}>Cancel</Text>
          </Pressable>
        </View>

        {/* Categories Bar */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoryBar}
        >
          {UNIVERSE_CATEGORIES.map((cat) => {
            const isSelected = selectedCategory === cat.id;
            return (
              <Pressable
                key={cat.id}
                onPress={() => setSelectedCategory(cat.id)}
                style={[
                  styles.categoryChip,
                  {
                    backgroundColor: isSelected ? theme.text : theme.surfaceSolid,
                    borderColor: isSelected ? theme.text : theme.border,
                  },
                ]}
              >
                <Ionicons
                  name={cat.icon as any}
                  size={12}
                  color={isSelected ? theme.background : theme.secondary}
                  style={{ marginRight: 5 }}
                />
                <Text
                  style={[
                    styles.categoryChipText,
                    { color: isSelected ? theme.background : theme.secondary },
                  ]}
                >
                  {cat.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </SafeAreaView>

      <ScrollView
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 40 }]}
      >
        {/* ============================================================ */}
        {/* 0. LIVE SUGGESTIONS WHILE TYPING                             */}
        {/* ============================================================ */}
        {showTyping && suggestions.length > 0 && (
          <View style={styles.suggestionsContainer}>
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionLabel, { color: theme.secondary }]}>SUGGESTIONS</Text>
              <Text style={[styles.resultCount, { color: theme.muted }]}>tap to search</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.suggestionsScroll}
            >
              {suggestions.map((sug, idx) => (
                <Pressable
                  key={`sug-${idx}`}
                  onPress={() => {
                    setQuery(sug);
                    performSearch(sug);
                  }}
                  style={({ pressed }) => [
                    styles.suggestionChip,
                    {
                      backgroundColor: theme.surfaceSolid,
                      borderColor: theme.border,
                      opacity: pressed ? 0.72 : 1,
                    },
                  ]}
                >
                  <Ionicons name="search" size={13} color={theme.secondary} style={{ marginRight: 6 }} />
                  <Text style={[styles.suggestionChipText, { color: theme.text }]}>{sug}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* ============================================================ */}
        {/* 1. TYPING STATE: LIVE INSTANT MATCHES (GOOGLE OMNIBOX STYLE) */}
        {/* ============================================================ */}
        {showTyping && liveResults.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionLabel, { color: theme.secondary }]}>INSTANT MATCHES</Text>
              <Text style={[styles.resultCount, { color: theme.muted }]}>
                {isLiveLoading ? 'Searching live…' : `${liveResults.length} found`}
              </Text>
            </View>

            {liveResults.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => handleSelectLiveResult(item)}
                style={({ pressed }) => [styles.rowItem, pressed && { opacity: 0.72 }]}
              >
                <LiquidGlassView style={styles.rowGlass} borderRadius={18} intensity={25}>
                  {item.builtinChar ? (
                    <DynamicCharacterImage
                      character={item.builtinChar}
                      style={styles.rowAvatar}
                      contentFit="cover"
                      contentPosition="top"
                    />
                  ) : item.avatarUrl ? (
                    <Image
                      source={{ uri: item.avatarUrl }}
                      style={styles.rowAvatar}
                      contentFit="cover"
                      contentPosition="top"
                      transition={200}
                    />
                  ) : (
                    <View
                      style={[
                        styles.rowAvatar,
                        {
                          backgroundColor: theme.surfaceSolid,
                          alignItems: 'center',
                          justifyContent: 'center',
                        },
                      ]}
                    >
                      <Ionicons name="person" size={20} color={theme.secondary} />
                    </View>
                  )}
                  <View style={styles.rowInfo}>
                    <Text style={[styles.rowName, { color: theme.text }]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={[styles.rowSub, { color: theme.secondary }]} numberOfLines={1}>
                      {item.series ? `${item.series} · ${item.role}` : item.role}
                    </Text>
                  </View>
                  <View style={[styles.rowPill, { backgroundColor: theme.text }]}>
                    <Ionicons name="chatbubble" size={11} color={theme.background} />
                    <Text style={[styles.rowPillText, { color: theme.background }]}>Chat</Text>
                  </View>
                </LiquidGlassView>
              </Pressable>
            ))}

            <Pressable
              onPress={() => performSearch(query)}
              style={({ pressed }) => [
                styles.aiSearchRow,
                { borderColor: theme.border, opacity: pressed ? 0.75 : 1 },
              ]}
            >
              <View
                style={[
                  styles.aiSearchIcon,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' },
                ]}
              >
                <Ionicons name="sparkles" size={17} color={theme.text} />
              </View>
              <View style={styles.rowInfo}>
                <Text style={[styles.rowName, { color: theme.text }]}>
                  Explore all universe lore & versions for "{query}"
                </Text>
                <Text style={[styles.rowSub, { color: theme.secondary }]}>
                  Generate 6-8 alternate adaptations, eras & comic versions
                </Text>
              </View>
              <Ionicons name="arrow-forward-circle" size={24} color={theme.secondary} />
            </Pressable>
          </View>
        )}

        {/* Typing state: No match yet -> Big prominent AI action card */}
        {showTyping && liveResults.length === 0 && (
          <Pressable
            onPress={() => performSearch(query)}
            style={({ pressed }) => [styles.bigSearchBtn, { opacity: pressed ? 0.85 : 1 }]}
          >
            <LiquidGlassView style={styles.bigSearchInner} borderRadius={22} intensity={35} elevated>
              <View style={[styles.bigSearchIconWrap, { backgroundColor: theme.text }]}>
                {isLiveLoading ? (
                  <ActivityIndicator size="small" color={theme.background} />
                ) : (
                  <Ionicons name="sparkles" size={22} color={theme.background} />
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.bigSearchTitle, { color: theme.text }]}>
                  {isLiveLoading ? `Finding "${query}"…` : `Find "${query}" with AI`}
                </Text>
                <Text style={[styles.bigSearchSub, { color: theme.secondary }]}>
                  Instantly craft persona, avatar & authentic voice
                </Text>
              </View>
              <Ionicons name="arrow-forward-circle" size={26} color={theme.text} />
            </LiquidGlassView>
          </Pressable>
        )}

        {/* ============================================================ */}
        {/* 2. LOADING SKELETON                                         */}
        {/* ============================================================ */}
        {isSearching && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.secondary }]}>SEARCHING AI UNIVERSE…</Text>
            {[0, 1, 2, 3].map((i) => (
              <Animated.View
                key={i}
                style={[
                  styles.skeletonRow,
                  {
                    opacity: shimmerOpacity,
                    backgroundColor: theme.surfaceSolid,
                    borderColor: theme.border,
                    borderWidth: StyleSheet.hairlineWidth,
                    borderRadius: 18,
                    marginBottom: 10,
                  },
                ]}
              >
                <View style={[styles.skeletonAvatar, { backgroundColor: theme.border }]} />
                <View style={{ flex: 1, gap: 8 }}>
                  <View style={[styles.skeletonLine, { width: '65%', backgroundColor: theme.border }]} />
                  <View style={[styles.skeletonLine, { width: '40%', backgroundColor: theme.border }]} />
                </View>
              </Animated.View>
            ))}
          </View>
        )}

        {/* ============================================================ */}
        {/* 3. AI RESULTS                                               */}
        {/* ============================================================ */}
        {searched && !isSearching && results.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Text style={[styles.sectionLabel, { color: theme.secondary }]}>
                RESULTS FOR "{query.toUpperCase()}"
              </Text>
              <Text style={[styles.resultCount, { color: theme.muted }]}>
                {results.length} discovered
              </Text>
            </View>

            {results.map((cand, i) => (
              <Pressable
                key={i}
                onPress={() => selectCandidate(cand)}
                style={({ pressed }) => [styles.resultCard, pressed && { opacity: 0.8 }]}
              >
                <LiquidGlassView style={styles.resultGlass} borderRadius={20} intensity={30} elevated>
                  <DynamicCharacterImage
                    character={cand}
                    style={styles.resultAvatar}
                    contentFit="cover"
                    contentPosition="top"
                  />
                  <View style={styles.resultBody}>
                    <View style={styles.resultNameRow}>
                      <Text style={[styles.resultName, { color: theme.text }]} numberOfLines={1}>
                        {cand.name}
                      </Text>
                      {i === 0 && (
                        <View
                          style={[
                            styles.bestMatchBadge,
                            {
                              backgroundColor: isDark
                                ? 'rgba(255,214,0,0.18)'
                                : 'rgba(255,180,0,0.14)',
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.bestMatchText,
                              { color: isDark ? '#FFD700' : '#B8860B' },
                            ]}
                          >
                            Best Match
                          </Text>
                        </View>
                      )}
                    </View>
                    <Text
                      style={[styles.resultSeries, { color: theme.secondary }]}
                      numberOfLines={1}
                    >
                      {cand.series || 'Custom Universe'} · {cand.role}
                    </Text>
                    <Text
                      style={[styles.resultDesc, { color: theme.muted }]}
                      numberOfLines={2}
                    >
                      {cand.shortDescription || cand.description}
                    </Text>
                  </View>

                  <View style={[styles.chatBtn, { backgroundColor: theme.text }]}>
                    <Ionicons name="chatbubble" size={13} color={theme.background} />
                    <Text style={[styles.chatBtnText, { color: theme.background }]}>Chat</Text>
                  </View>
                </LiquidGlassView>
              </Pressable>
            ))}
          </View>
        )}

        {/* Empty state */}
        {searched && !isSearching && results.length === 0 && !error && (
          <View style={styles.emptyState}>
            <Text style={{ fontSize: 44, marginBottom: 8 }}>🔍</Text>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>No characters found</Text>
            <Text style={[styles.emptySub, { color: theme.secondary }]}>
              Try checking your spelling or search with a broader title
            </Text>
          </View>
        )}

        {/* Error message */}
        {error && (
          <View
            style={[
              styles.errorBanner,
              { backgroundColor: 'rgba(255,59,48,0.1)', borderColor: 'rgba(255,59,48,0.3)' },
            ]}
          >
            <Ionicons name="alert-circle" size={18} color="#FF3B30" />
            <Text style={[styles.errorText, { color: '#FF3B30' }]}>{error}</Text>
          </View>
        )}

        {/* ============================================================ */}
        {/* 4. IDLE STATE: RECENT EVERYTHING & TRENDING                  */}
        {/* ============================================================ */}
        {showIdle && (
          <>
            {/* Recent Characters / Companions Carousel */}
            {recentChars.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionRow}>
                  <Text style={[styles.sectionLabel, { color: theme.secondary }]}>
                    RECENT COMPANIONS
                  </Text>
                  <Pressable onPress={clearRecentChars} hitSlop={8}>
                    <Text style={[styles.clearText, { color: theme.muted }]}>Clear</Text>
                  </Pressable>
                </View>

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.recentCharsRow}
                >
                  {recentChars.map((item) => (
                    <Pressable
                      key={item.id}
                      onPress={() => openCharacter(item)}
                      style={({ pressed }) => [
                        styles.recentCharItem,
                        pressed && { opacity: 0.78 },
                      ]}
                    >
                      <LiquidGlassView
                        style={styles.recentCharGlass}
                        borderRadius={20}
                        intensity={28}
                        elevated
                      >
                        <View style={styles.recentCharAvatarWrap}>
                          <DynamicCharacterImage
                            character={item}
                            style={styles.recentCharAvatar}
                            contentFit="cover"
                            contentPosition="top"
                          />
                          <View style={styles.onlineDot} />
                          <Pressable
                            onPress={() => removeRecentChar(item.id)}
                            hitSlop={8}
                            style={styles.charCloseBtn}
                          >
                            <Ionicons name="close" size={11} color="#FFF" />
                          </Pressable>
                        </View>
                        <Text
                          style={[styles.recentCharName, { color: theme.text }]}
                          numberOfLines={1}
                        >
                          {item.name}
                        </Text>
                        <Text
                          style={[styles.recentCharSeries, { color: theme.secondary }]}
                          numberOfLines={1}
                        >
                          {item.series || item.role}
                        </Text>
                      </LiquidGlassView>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Recent Searches List */}
            {recentQueries.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionRow}>
                  <Text style={[styles.sectionLabel, { color: theme.secondary }]}>
                    RECENT SEARCHES
                  </Text>
                  <Pressable onPress={clearRecentQueries} hitSlop={8}>
                    <Text style={[styles.clearText, { color: theme.muted }]}>Clear all</Text>
                  </Pressable>
                </View>

                {recentQueries.map((r) => (
                  <Pressable
                    key={r}
                    onPress={() => {
                      setQuery(r);
                      performSearch(r);
                    }}
                    style={({ pressed }) => [
                      styles.recentRow,
                      { borderBottomColor: theme.border, opacity: pressed ? 0.65 : 1 },
                    ]}
                  >
                    <View
                      style={[
                        styles.recentIconWrap,
                        { backgroundColor: theme.surfaceSecondary },
                      ]}
                    >
                      <Ionicons name="time-outline" size={15} color={theme.secondary} />
                    </View>
                    <Text style={[styles.recentText, { color: theme.text }]} numberOfLines={1}>
                      {r}
                    </Text>
                    <Pressable
                      onPress={() => removeRecentQuery(r)}
                      hitSlop={12}
                      style={{ padding: 6 }}
                    >
                      <Ionicons name="close" size={15} color={theme.muted} />
                    </Pressable>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Trending Queries */}
            <View style={styles.section}>
              <Text style={[styles.sectionLabel, { color: theme.secondary }]}>
                TRENDING CHARACTERS
              </Text>
              <View style={styles.trendingGrid}>
                {TRENDING.map((t) => (
                  <Pressable
                    key={t.query}
                    onPress={() => {
                      setQuery(t.query);
                      performSearch(t.query);
                    }}
                    style={({ pressed }) => [
                      styles.trendingChip,
                      {
                        backgroundColor: theme.surfaceSolid,
                        borderColor: theme.border,
                        opacity: pressed ? 0.72 : 1,
                      },
                    ]}
                  >
                    <Text style={styles.trendingEmoji}>{t.icon}</Text>
                    <Text style={[styles.trendingLabel, { color: theme.text }]}>{t.query}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Info Discovery Card */}
            <View
              style={[
                styles.aiHintCard,
                { backgroundColor: theme.surfaceSolid, borderColor: theme.border },
              ]}
            >
              <View
                style={[
                  styles.aiHintIcon,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' },
                ]}
              >
                <Ionicons name="sparkles" size={20} color={theme.text} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.aiHintTitle, { color: theme.text }]}>
                  Unlimited Universes
                </Text>
                <Text style={[styles.aiHintSub, { color: theme.secondary }]}>
                  Search any fictional or historical hero, villain, or companion — AI generates their
                  persona, voice and lore on the fly.
                </Text>
              </View>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    paddingTop: 6,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
    minHeight: 48,
  },
  input: { flex: 1, fontSize: 15, fontWeight: '500', letterSpacing: -0.3, padding: 0 },
  cancelBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1 },
  cancelText: { fontSize: 14, fontWeight: '600', letterSpacing: -0.2 },
  categoryBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },
  categoryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  categoryChipText: { fontSize: 12, fontWeight: '600' },
  scroll: { paddingHorizontal: 16, paddingTop: 14 },
  section: { marginBottom: 26 },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 10 },
  clearText: { fontSize: 12, fontWeight: '600', marginBottom: 10 },
  resultCount: { fontSize: 11, fontWeight: '600', marginBottom: 10 },
  recentCharsRow: { gap: 12, paddingVertical: 4 },
  recentCharItem: { width: 96 },
  recentCharGlass: {
    alignItems: 'center',
    padding: 10,
    borderRadius: 20,
  },
  recentCharAvatarWrap: { position: 'relative', marginBottom: 8 },
  recentCharAvatar: { width: 56, height: 56, borderRadius: 28 },
  onlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: '#30D158',
    borderWidth: 2,
    borderColor: '#000',
  },
  charCloseBtn: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentCharName: { fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 2 },
  recentCharSeries: { fontSize: 11, fontWeight: '500', textAlign: 'center' },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  recentIconWrap: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentText: { flex: 1, fontSize: 15, fontWeight: '500', letterSpacing: -0.2 },
  trendingGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  trendingChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
  },
  trendingEmoji: { fontSize: 14 },
  trendingLabel: { fontSize: 13, fontWeight: '600', letterSpacing: -0.2, includeFontPadding: false },
  aiHintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 4,
    marginBottom: 20,
  },
  aiHintIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  aiHintTitle: { fontSize: 14, fontWeight: '700', letterSpacing: -0.2, marginBottom: 2 },
  aiHintSub: { fontSize: 12, lineHeight: 17, letterSpacing: -0.1 },
  rowItem: { marginBottom: 8 },
  rowGlass: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12 },
  rowAvatar: { width: 48, height: 48, borderRadius: 14 },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '700', letterSpacing: -0.3, marginBottom: 2 },
  rowSub: { fontSize: 12, fontWeight: '500' },
  rowPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
  },
  rowPillText: { fontSize: 11, fontWeight: '700', includeFontPadding: false },
  aiSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    marginTop: 6,
  },
  aiSearchIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  bigSearchBtn: { marginBottom: 24 },
  bigSearchInner: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  bigSearchIconWrap: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bigSearchTitle: { fontSize: 15, fontWeight: '700', letterSpacing: -0.3, marginBottom: 2 },
  bigSearchSub: { fontSize: 12, letterSpacing: -0.1 },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  skeletonAvatar: { width: 46, height: 46, borderRadius: 14 },
  skeletonLine: { height: 10, borderRadius: 6 },
  resultCard: { marginBottom: 10 },
  resultGlass: { flexDirection: 'row', alignItems: 'flex-start', padding: 14, gap: 14 },
  resultAvatar: { width: 62, height: 80, borderRadius: 14 },
  resultBody: { flex: 1 },
  resultNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' },
  resultName: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  bestMatchBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  bestMatchText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, includeFontPadding: false },
  resultSeries: { fontSize: 12, fontWeight: '500', marginBottom: 5 },
  resultDesc: { fontSize: 12, lineHeight: 17, letterSpacing: -0.1 },
  chatBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 14,
    alignSelf: 'flex-end',
    marginTop: 6,
  },
  chatBtnText: { fontSize: 12, fontWeight: '700', includeFontPadding: false },
  emptyState: { alignItems: 'center', paddingVertical: 48, gap: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  emptySub: { fontSize: 13, textAlign: 'center' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  errorText: { flex: 1, fontSize: 13, fontWeight: '600' },
  suggestionsContainer: {
    marginBottom: 16,
  },
  suggestionsScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  suggestionChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
