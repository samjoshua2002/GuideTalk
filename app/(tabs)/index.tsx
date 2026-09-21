import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  Dimensions,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Platform,
  Animated,
  RefreshControl,
  Easing,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as SecureStore from 'expo-secure-store';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/src/context/ThemeContext';
import { useAuth } from '@/src/context/AuthContext';
import { getAllBuiltinCharacters, registerCustomCharacter } from '@/src/data/characters';
import { getAllPresets, CATEGORY_PRESETS, UniverseCategory, RivalRelation, getRivalsForWorkspace } from '@/src/data/rivals';
import { Character } from '@/src/types/character';
import { fetchCharacters, listConversations, ConversationSummary, fetchRecommendations, fetchDynamicRivals } from '@/src/lib/chatApi';
import { LiquidGlassView } from '@/src/components/LiquidGlassView';
import { GlowButton } from '@/src/components/GlowButton';
import { AuthModal } from '@/src/components/AuthModal';
import { NotificationsModal } from '@/src/components/NotificationsModal';
import { OnboardingStoryboard } from '@/src/components/OnboardingStoryboard';
import { triggerHaptic } from '@/src/lib/haptics';
import {
  getInAppNotifications,
  scheduleHourlyCompanionReminder,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  InAppNotification,
} from '@/src/lib/notificationService';
import { getHiddenRecentIds, subscribeToFavorites, getFavoriteIds } from '@/src/lib/favorites';
import { getInteractedCharacterIds } from '@/src/lib/activityTracker';
import { DynamicCharacterImage } from '@/src/lib/dynamicImageService';
import {
  getDailySeed,
  formatTodayProphecyDate,
  resolveProphecyForCharacter,
  fetchDynamicServerProphecy,
} from '@/src/lib/prophecyService';


const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_CARD_WIDTH = Math.min(SCREEN_WIDTH - 40, 360);
const AnimatedFlatList = Animated.createAnimatedComponent(FlatList) as any;

// Fixed card dimensions for getItemLayout — eliminates measurement overhead
const EXPLORE_CARD_WIDTH = (SCREEN_WIDTH - 28 - 10) / 2; // 2 columns, 14px side padding, 10px gap
const EXPLORE_CARD_HEIGHT = 285; // image 200 + content 85
const PANORAMIC_CARD_WIDTH = SCREEN_WIDTH * 0.78;
const PANORAMIC_CARD_HEIGHT = 160;
const WORKSPACE_CARD_WIDTH = 184; // 170 + 14 gap
const SPOTLIGHT_ITEM_WIDTH = SCREEN_WIDTH - 28;

interface CategoryItem {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const categories: CategoryItem[] = [
  { id: 'all', label: 'All', icon: 'grid-outline' },
  { id: 'for-you', label: 'Curated For You', icon: 'sparkles-outline' },
  { id: 'cinema', label: 'Cinema', icon: 'videocam-outline' },
  { id: 'anime', label: 'Anime', icon: 'film-outline' },
  { id: 'gaming', label: 'Gaming', icon: 'game-controller-outline' },
  { id: 'custom', label: 'Custom', icon: 'person-add-outline' },
];

// ─── Skeleton Pulse Component (Butter-Smooth 60FPS) ───────────────────────
function SkeletonPulse({ style }: { style?: any }) {
  const anim = useRef(new Animated.Value(0.25)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 0.7,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0.25,
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);

  return (
    <Animated.View
      style={[
        { backgroundColor: 'rgba(150,150,150,0.18)', borderRadius: 14, opacity: anim },
        style,
      ]}
    />
  );
}

// ─── Compact & Catchy 2-Word Rival Badge Formatter ─────────────────────────
function formatRivalBadge(relTitle: string = ''): string {
  if (!relTitle) return 'RIVAL CLASH';
  const clean = relTitle
    .replace(/^(House of the Hearth|The|An|A)\s+/i, '')
    .replace(/\bvs\b/i, '')
    .trim();
  const words = clean
    .split(/[\s&/·:—–-]+/)
    .filter((w) => w.length > 0 && !['and', 'of', 'the', 'in', 'at', 'to', 'for', 'a', 'an'].includes(w.toLowerCase()));
  if (words.length === 0) return 'RIVAL CLASH';
  if (words.length <= 2) return words.join(' ').toUpperCase();
  const strongWord = words.find((w) =>
    /duel|clash|war|nemesis|reckon|rival|ambush|fatal|apex|curse|hunt|blood|trial|fate|pact/i.test(w)
  );
  if (strongWord) {
    const otherWord = words.find((w) => w.toLowerCase() !== strongWord.toLowerCase() && w.length > 2) || words[0];
    return `${otherWord} ${strongWord}`.toUpperCase();
  }
  return words.slice(0, 2).join(' ').toUpperCase();
}

// ─── Universal High-Definition Dynamic Fallback Image Resolver ─────────────
// Robust, unblocked Unsplash CDN links that render reliably on iOS & Android
const FALLBACK_ANIME_COLLECTION = [
  'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=900&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=900&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1563089145-599997674d42?w=900&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=900&auto=format&fit=crop&q=85',
];

const FALLBACK_GAMING_COLLECTION = [
  'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=900&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=900&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=900&auto=format&fit=crop&q=85',
];

const FALLBACK_CINEMA_COLLECTION = [
  'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=900&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=900&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1604200213928-ba3cf4fc8436?w=900&auto=format&fit=crop&q=85',
];

function getDynamicFallbackImage(character?: Character | null): string {
  if (!character) return FALLBACK_ANIME_COLLECTION[0];
  const charName = (character.name || '').toLowerCase();
  const series = (character.series || '').toLowerCase();
  const hash = Math.abs(
    (character.id || character.name || 'char')
      .split('')
      .reduce((acc, c) => acc + c.charCodeAt(0), 0)
  );

  if (
    series.includes('genshin') ||
    charName.includes('arlecchino') ||
    charName.includes('furina') ||
    charName.includes('raiden') ||
    charName.includes('clorinde') ||
    charName.includes('traveler') ||
    charName.includes('hu tao')
  ) {
    return 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=900&auto=format&fit=crop&q=85';
  }
  if (
    series.includes('chainsaw') ||
    charName.includes('denji') ||
    charName.includes('makima') ||
    charName.includes('power')
  ) {
    return 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=900&auto=format&fit=crop&q=85';
  }
  if (
    series.includes('jujutsu') ||
    charName.includes('gojo') ||
    charName.includes('sukuna') ||
    charName.includes('toji')
  ) {
    return 'https://images.unsplash.com/photo-1563089145-599997674d42?w=900&auto=format&fit=crop&q=85';
  }
  if (
    series.includes('gta') ||
    charName.includes('michael') ||
    charName.includes('franklin') ||
    charName.includes('trevor') ||
    charName.includes('silco')
  ) {
    return 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=900&auto=format&fit=crop&q=85';
  }
  if (
    series.includes('spider') ||
    charName.includes('parker') ||
    charName.includes('spiderman') ||
    charName.includes('batman') ||
    series.includes('marvel') ||
    series.includes('dc')
  ) {
    return 'https://images.unsplash.com/photo-1604200213928-ba3cf4fc8436?w=900&auto=format&fit=crop&q=85';
  }
  if (character.category === 'anime') {
    return FALLBACK_ANIME_COLLECTION[hash % FALLBACK_ANIME_COLLECTION.length];
  }
  if (character.category === 'gaming') {
    return FALLBACK_GAMING_COLLECTION[hash % FALLBACK_GAMING_COLLECTION.length];
  }
  if (character.category === 'cinema') {
    return FALLBACK_CINEMA_COLLECTION[hash % FALLBACK_CINEMA_COLLECTION.length];
  }
  return FALLBACK_ANIME_COLLECTION[hash % FALLBACK_ANIME_COLLECTION.length];
}

export default function DiscoverScreen() {
  const router = useRouter();
  const { theme, isDark, toggleTheme } = useTheme();
  const { user, token, isLoading: isAuthLoading, hasCompletedOnboarding } = useAuth();

  const [activeCategoryId, setActiveCategoryId] = useState('all');
  const [rivalShuffleSeed, setRivalShuffleSeed] = useState(0);
  const [prophecyOffset, setProphecyOffset] = useState(0);
  const [customProphecyQuote, setCustomProphecyQuote] = useState<{ quote: string; category: string; tag?: string } | null>(null);
  const [isProphecyRefreshing, setIsProphecyRefreshing] = useState(false);
  const dailySeed = useMemo(() => getDailySeed(), []);
  const todayDateLabel = useMemo(() => formatTodayProphecyDate(), []);
  const [characterList, setCharacterList] = useState<Character[]>(getAllBuiltinCharacters);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [isLoadingData, setIsLoadingData] = useState(false);
  // Real behavioural data for personalised spotlight
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<string[]>([]);
  const [recentSearchIds, setRecentSearchIds] = useState<string[]>([]);
  // AI-powered fresh recommendations fetched from web & model
  const [recommendedCharacters, setRecommendedCharacters] = useState<Character[]>([]);
  const [isRecommendationsLoading, setIsRecommendationsLoading] = useState(false);
  const [rawRecentSearchQueries, setRawRecentSearchQueries] = useState<string[]>([]);
  const [dynamicRivals, setDynamicRivals] = useState<RivalRelation[]>([]);
  const [isFetchingRivals, setIsFetchingRivals] = useState(false);

  // ----------------------------------------------------------------------
  // YOUR ACTIVITY: PAST CARDS TALKED WITH & FAVORITES
  // ----------------------------------------------------------------------
  const DEVICE_STORAGE_KEY = 'guildtalk_device_id';
  const [activityList, setActivityList] = useState<
    Array<{ character: Character; lastMessage?: string; updatedAt: string }>
  >([]);
  const [favoriteCharacters, setFavoriteCharacters] = useState<Character[]>([]);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [notificationsList, setNotificationsList] = useState<InAppNotification[]>([]);

  const loadFavorites = useCallback(async () => {
    try {
      const ids = await getFavoriteIds(user?.id);
      if (Array.isArray(ids) && ids.length > 0) {
        const presets = getAllPresets();
        const allChars = [...getAllBuiltinCharacters(), ...presets];
        const favMap = new Map<string, Character>();
        allChars.forEach((c) => favMap.set(c.id, c));
        const favs = ids.map((id) => favMap.get(id)).filter(Boolean) as Character[];
        setFavoriteCharacters(favs);
      } else {
        setFavoriteCharacters([]);
      }
    } catch {
      setFavoriteCharacters([]);
    }
  }, [user?.id]);

  useEffect(() => {
    let activeChars: Character[] = favoriteCharacters;
    if (activeChars.length === 0 && activityList.length > 0) {
      activeChars = activityList.map((a) => a.character);
    }
    if (activeChars.length === 0) {
      activeChars = getAllBuiltinCharacters().slice(0, 3);
    }
    const currentName = user?.name || user?.username || 'there';
    getInAppNotifications(activeChars, currentName).then((notifs) => {
      setNotificationsList(notifs);
      scheduleHourlyCompanionReminder(activeChars, currentName);
    });
  }, [favoriteCharacters, activityList, user]);

  const loadActivity = async () => {
    try {
      let deviceId = 'guest';
      if (Platform.OS === 'web') {
        deviceId = globalThis.localStorage?.getItem(DEVICE_STORAGE_KEY) || 'web-guest';
      } else {
        deviceId = (await SecureStore.getItemAsync(DEVICE_STORAGE_KEY)) || 'device-guest';
      }
      const activeUserId = user?.id || deviceId;
      const [convs, hiddenIds] = await Promise.all([
        listConversations(activeUserId, token),
        getHiddenRecentIds(user?.id),
      ]);
      if (Array.isArray(convs) && convs.length > 0) {
        const presets = getAllPresets();
        const map = new Map<string, ConversationSummary>();
        for (const c of convs) {
          if (!c.characterId || hiddenIds.includes(c.characterId)) continue;
          if (!map.has(c.characterId)) {
            map.set(c.characterId, c);
          } else {
            const prev = map.get(c.characterId)!;
            if (new Date(c.updatedAt).getTime() > new Date(prev.updatedAt).getTime()) {
              map.set(c.characterId, c);
            }
          }
        }
        const sorted = Array.from(map.values()).sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        );
        const mapped = sorted
          .map((item) => {
            const char =
              characterList.find((c) => c.id === item.characterId) ||
              presets.find((c) => c.id === item.characterId) ||
              ({
                id: item.characterId,
                name: item.characterName,
                avatarUrl:
                  item.characterAvatar ||
                  `https://api.dicebear.com/9.x/adventurer/png?seed=${encodeURIComponent(item.characterName)}&backgroundColor=000000`,
                coverUrl:
                  item.characterAvatar ||
                  `https://api.dicebear.com/9.x/adventurer/png?seed=${encodeURIComponent(item.characterName)}&backgroundColor=000000`,
                role: 'Companion',
                series: 'Universe',
                category: 'cinema',
                personality: ['Engaging'],
                roleplayRules: '',
                greeting: 'Hello again!',
                accent: '#0A84FF',
                isOnline: true,
              } as Character);
            return {
              character: char,
              lastMessage: item.preview,
              updatedAt: item.updatedAt,
            };
          })
          .filter(Boolean);
        setActivityList(mapped);
      } else {
        setActivityList([]);
      }
    } catch {
      // Ignore
    }
  };

  // Load custom characters from MongoDB
  const loadCharacters = async () => {
    try {
      const custom = await fetchCharacters(user?.id, token);
      if (Array.isArray(custom) && custom.length > 0) {
        const map = new Map<string, Character>();
        getAllBuiltinCharacters().forEach((c) => map.set(c.id, c));
        custom.forEach((c) => {
          map.set(c.id, c);
          registerCustomCharacter(c);
        });
        setCharacterList(Array.from(map.values()));
      }
    } catch {
      // Keep defaults
    }
  };

  // Load behavioural signals: interacted chars + recently viewed from search screen
  const loadBehaviouralData = async () => {
    try {
      const cleanUserId = (user?.id || '').trim() || 'guest';
      const recentCharsKey = `charai_recent_viewed_characters_${cleanUserId}`;
      const recentQueriesKey = `charai_recent_searches_${cleanUserId}`;

      let recentCharsRaw: string | null = null;
      let recentQueriesRaw: string | null = null;
      if (Platform.OS === 'web') {
        recentCharsRaw = globalThis.localStorage?.getItem(recentCharsKey) || null;
        recentQueriesRaw = globalThis.localStorage?.getItem(recentQueriesKey) || null;
      } else {
        recentCharsRaw = await SecureStore.getItemAsync(recentCharsKey);
        recentQueriesRaw = await SecureStore.getItemAsync(recentQueriesKey);
      }

      if (recentCharsRaw) {
        // stored as array of {id, name, ...} objects
        const parsed = JSON.parse(recentCharsRaw);
        const ids = Array.isArray(parsed)
          ? parsed.map((item: any) => (typeof item === 'string' ? item : item.id)).filter(Boolean)
          : [];
        setRecentlyViewedIds(ids.slice(0, 15));
      } else {
        setRecentlyViewedIds([]);
      }

      if (recentQueriesRaw) {
        // Queries are strings like 'Gojo', 'Batman', 'Arlecchino from Genshin'
        const queries: string[] = JSON.parse(recentQueriesRaw);
        setRawRecentSearchQueries(queries);
        const allChars = [...getAllBuiltinCharacters(), ...getAllPresets()];
        const matchedIds = queries
          .map((q) => {
            const lower = q.toLowerCase();
            return allChars.find(
              (c) =>
                c.name.toLowerCase().includes(lower) ||
                lower.includes(c.name.toLowerCase()) ||
                c.id.toLowerCase().includes(lower)
            )?.id;
          })
          .filter((id): id is string => !!id);
        setRecentSearchIds(matchedIds.slice(0, 10));
      } else {
        setRecentSearchIds([]);
        setRawRecentSearchQueries([]);
      }
    } catch {
      // ignore
    }
  };

  // ----------------------------------------------------------------------
  // AI RECOMMENDATIONS ENGINE: FETCH FRESH CHARACTERS FROM WEB & AI (CACHED)
  // ----------------------------------------------------------------------
  const RECS_CACHE_KEY = (uid?: string | null) =>
    `guildtalk_recs_cache_${(uid || '').trim() || 'guest'}`;

  const loadCachedRecommendations = async () => {
    try {
      const cacheKey = RECS_CACHE_KEY(user?.id);
      let raw: string | null = null;
      if (Platform.OS === 'web') {
        raw = globalThis.localStorage?.getItem(cacheKey) || null;
      } else {
        raw = await SecureStore.getItemAsync(cacheKey);
      }
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setRecommendedCharacters(parsed);
          setCharacterList((prev) => {
            const map = new Map<string, Character>();
            prev.forEach((c) => map.set(c.id, c));
            parsed.forEach((c) => {
              map.set(c.id, c);
              registerCustomCharacter(c);
            });
            return Array.from(map.values());
          });
        }
      }
    } catch {
      // Ignore cache read failures
    }
  };

  const loadRecommendations = async (force: boolean = false) => {
    try {
      setIsRecommendationsLoading(true);
      const cleanUserId = (user?.id || '').trim() || 'guest';
      const recentQueriesKey = `charai_recent_searches_${cleanUserId}`;

      let recentQueriesRaw: string | null = null;
      if (Platform.OS === 'web') {
        recentQueriesRaw = globalThis.localStorage?.getItem(recentQueriesKey) || null;
      } else {
        recentQueriesRaw = await SecureStore.getItemAsync(recentQueriesKey);
      }
      const queries: string[] = recentQueriesRaw ? JSON.parse(recentQueriesRaw) : [];
      const talkedNames = (activityList || []).map((a) => a?.character?.name).filter(Boolean) as string[];
      const wsIds = Array.isArray(user?.workspaceCharacterIds) ? user.workspaceCharacterIds : [];
      const wsNames = wsIds.map((id) => {
        const found = characterList.find((c) => c.id === id);
        return found?.name || id;
      });

      const recs = await fetchRecommendations({
        recentSearches: queries.slice(0, 5),
        talkedCharacterNames: talkedNames.slice(0, 5),
        workspaceNames: wsNames.slice(0, 5),
        language: user?.language,
        forceRefresh: force,
        token,
      });

      if (Array.isArray(recs) && recs.length > 0) {
        setRecommendedCharacters(recs);
        setCharacterList((prev) => {
          const map = new Map<string, Character>();
          prev.forEach((c) => map.set(c.id, c));
          recs.forEach((c) => {
            map.set(c.id, c);
            registerCustomCharacter(c);
          });
          return Array.from(map.values());
        });

        // Persist to cache so next launch loads immediately with zero wait
        try {
          const cacheKey = RECS_CACHE_KEY(user?.id);
          const serialized = JSON.stringify(recs);
          if (Platform.OS === 'web') {
            globalThis.localStorage?.setItem(cacheKey, serialized);
          } else {
            await SecureStore.setItemAsync(cacheKey, serialized);
          }
        } catch {
          // Ignore cache write issues
        }
      }
    } catch (err) {
      console.warn('Failed to load recommendations:', err);
    } finally {
      setIsRecommendationsLoading(false);
    }
  };

  useEffect(() => {
    const init = async () => {
      // Fast path: load cached recommendations and local data under 80ms
      await Promise.allSettled([
        loadCachedRecommendations(),
        loadCharacters(),
        loadActivity(),
        loadBehaviouralData(),
        loadFavorites(),
      ]);

      // Fresh AI recommendations load asynchronously in background
      loadRecommendations();
    };
    init();
  }, [user?.id, token]);

  useEffect(() => {
    const unsub = subscribeToFavorites(() => {
      loadActivity();
      loadFavorites();
    });
    return unsub;
  }, [loadFavorites]);

  useFocusEffect(
    useCallback(() => {
      loadActivity();
      loadBehaviouralData();
      loadFavorites();
    }, [loadFavorites])
  );

  const openCharacter = (id: string) => {
    triggerHaptic('light');
    router.push(`/character/${id}`);
  };


  // User's Workspace picks (from onboarding or profile)
  const workspaceIds = useMemo((): string[] => {
    if (user?.workspaceCharacterIds && user.workspaceCharacterIds.length > 0) {
      // Ensure it is always a real Array (storage can return plain objects on web)
      return Array.isArray(user.workspaceCharacterIds)
        ? (user.workspaceCharacterIds as string[])
        : (Array.from(user.workspaceCharacterIds as any) as string[]);
    }
    if (user?.language && CATEGORY_PRESETS[user.language]) {
      return CATEGORY_PRESETS[user.language].defaultPicks;
    }
    return ['john-wick', 'walter-white', 'batman'];
  }, [user?.workspaceCharacterIds, user?.language]);

  const workspaceCharacters = useMemo(() => {
    const presets = getAllPresets();
    const allChars = [...characterList, ...presets.filter((p) => !characterList.some((c) => c.id === p.id))];
    const map = new Map<string, Character>();

    // 1. Dynamic user interests: characters the user recently searched, viewed or interacted with (e.g. Arlecchino!)
    (recentlyViewedIds || []).forEach((id) => {
      const char = allChars.find((c) => c.id === id || c.name.toLowerCase() === id.toLowerCase());
      if (char) map.set(char.id, char);
    });

    (activityList || []).forEach((act) => {
      const charId = act?.character?.id;
      if (charId) {
        const char = allChars.find((c) => c.id === charId) || act.character;
        if (char && !map.has(char.id)) map.set(char.id, char as Character);
      }
    });

    // 2. Explicit user favorites
    (favoriteCharacters || []).forEach((fav) => {
      if (fav && !map.has(fav.id)) map.set(fav.id, fav);
    });

    // 3. User's onboarding workspace picks
    workspaceIds.forEach((id) => {
      const char = allChars.find((c) => c.id === id);
      if (char && !map.has(char.id)) map.set(char.id, char);
    });

    // 4. Default fallback if empty
    if (map.size === 0) {
      presets.slice(0, 3).forEach((c) => map.set(c.id, c));
    }

    return Array.from(map.values());
  }, [workspaceIds, characterList, recentlyViewedIds, activityList, favoriteCharacters]);

  // Determine user's preferred category (e.g. Hollywood, Marvel, Anime, Gaming, Bollywood)
  const userCategory = useMemo<UniverseCategory>(() => {
    if (user?.language && CATEGORY_PRESETS[user.language]) {
      return CATEGORY_PRESETS[user.language];
    }
    for (const cat of Object.values(CATEGORY_PRESETS)) {
      if (workspaceIds.some((id) => cat.characters.some((c) => c.id === id))) {
        return cat;
      }
    }
    return CATEGORY_PRESETS.hollywood;
  }, [user?.language, workspaceIds]);

  // ═══════════════════════════════════════════════════════
  // PERSONALISED SPOTLIGHT — Fresh AI Recommendations:
  //   1. AI Recommendations from Web & Azure OpenAI (Tailored to user taste)
  //   2. New Custom/Community Characters (Excluding already talked)
  //   3. Category presets for user's universe
  //   4. Global presets fallback
  // ═══════════════════════════════════════════════════════
  const spotlightCharacters = useMemo(() => {
    const presets = getAllPresets();
    const allChars = [...characterList, ...presets.filter((p) => !characterList.some((c) => c.id === p.id))];
    const findChar = (id: string) => allChars.find((c) => c.id === id);

    const seen = new Set<string>();
    const ordered: Character[] = [];

    const push = (c: Character | undefined) => {
      if (!c || !c.id || seen.has(c.id)) return;
      seen.add(c.id);
      ordered.push(c);
    };

    // 1. AI Recommendations from Web / Azure OpenAI (Highest priority!)
    if (Array.isArray(recommendedCharacters) && recommendedCharacters.length > 0) {
      recommendedCharacters.forEach((c) => push(c));
    }

    // 2. Dynamic Rivals fetched from Internet / Azure OpenAI
    if (Array.isArray(dynamicRivals) && dynamicRivals.length > 0) {
      dynamicRivals.forEach((r) => push(r.rivalCharacter));
    }

    // 3. Custom characters created/saved in DB (excluding characters user already chatted with)
    const talkedIds = new Set((activityList || []).map((a) => a?.character?.id));
    characterList
      .filter((c) => c.isCustom && !talkedIds.has(c.id))
      .forEach((c) => push(c));

    // 4. Fill from user's preferred category (exclude talked)
    const catCharIds: string[] = Array.isArray(userCategory.characters)
      ? userCategory.characters.map((c) => c.id).filter((id) => !talkedIds.has(id))
      : [];
    catCharIds.forEach((id) => push(findChar(id)));

    // 5. Generic presets as final fallback
    presets.forEach((p) => push(p));

    let result = ordered.slice(0, 12);

    // Shuffle using refreshSeed for pull-to-refresh variety
    if (refreshSeed > 0 && result.length > 1) {
      const shuffled = [...result];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = (refreshSeed * 1103515245 + i * 12345) % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      result = shuffled;
    }

    return result;
  }, [recommendedCharacters, dynamicRivals, characterList, activityList, userCategory, refreshSeed]);

  // Fix: reset hero index to 0 when spotlight list changes (after refresh)
  useEffect(() => {
    if (refreshSeed > 0) {
      setActiveHeroIndex(0);
    }
  }, [refreshSeed]);

  // Dynamic Image Fallback Registry
  const [failedImageUrls, setFailedImageUrls] = useState<Record<string, string>>({});

  const handleImageError = useCallback((char?: Character | null) => {
    if (!char || !char.id) return;
    setFailedImageUrls((prev) => {
      if (prev[char.id]) return prev;
      return { ...prev, [char.id]: getDynamicFallbackImage(char) };
    });
  }, []);

  const getDisplayImage = useCallback((char?: Character | null): string => {
    if (!char) return FALLBACK_ANIME_COLLECTION[0];
    if (failedImageUrls[char.id]) return failedImageUrls[char.id];
    return char.coverUrl || char.avatarUrl || getDynamicFallbackImage(char);
  }, [failedImageUrls]);

  const [activeHeroIndex, setActiveHeroIndex] = useState(0);
  const [displayedHeroIndex, setDisplayedHeroIndex] = useState(0);
  const heroFadeAnim = useRef(new Animated.Value(1)).current;
  const isUserInteractingRef = useRef(false);
  const spotlightListRef = useRef<any>(null);
  // SPOTLIGHT_CARD_WIDTH === SPOTLIGHT_ITEM_WIDTH (module-level constant) — use that instead to avoid recreating on every render

  // Keep a stable ref for spotlight length so renderSpotlightItem doesn't need the array in deps
  const spotlightLengthRef = useRef(spotlightCharacters.length);
  useEffect(() => { spotlightLengthRef.current = spotlightCharacters.length; }, [spotlightCharacters.length]);

  // Continuous Native Scroll Velocity Value for Fluid "Smug Blur Smoke" Transition
  const scrollX = useRef(new Animated.Value(0)).current;

  const scrollToHero = (index: number) => {
    if (index >= 0 && index < spotlightCharacters.length) {
      triggerHaptic('selection');
      spotlightListRef.current?.scrollToOffset({
        offset: index * SPOTLIGHT_ITEM_WIDTH,
        animated: true,
      });
      setActiveHeroIndex(index);
      setDisplayedHeroIndex(index);
    }
  };

  const getHeroBadge = (hero: Character): string => {
    if (hero.isCustom) return 'CUSTOM';
    if (hero.category === 'anime') return 'TOP ANIME';
    if (hero.category === 'gaming') return 'GAMING';
    if (hero.category === 'cinema') return 'FEATURED';
    if (hero.series) {
      const words = hero.series.trim().split(/\s+/);
      return words.slice(0, 2).join(' ').toUpperCase();
    }
    return 'TOP PICK';
  };

  // Auto-slide every 30 seconds
  useEffect(() => {
    if (spotlightCharacters.length <= 1) return;
    const interval = setInterval(() => {
      if (isUserInteractingRef.current) return;
      setActiveHeroIndex((prevIndex) => {
        const next = (prevIndex + 1) % spotlightLengthRef.current;
        spotlightListRef.current?.scrollToOffset({
          offset: next * SPOTLIGHT_ITEM_WIDTH,
          animated: true,
        });
        setDisplayedHeroIndex(next);
        return next;
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [spotlightCharacters.length]);

  const currentHero = spotlightCharacters[displayedHeroIndex] || spotlightCharacters[0];
  const currentHeroAccent = currentHero?.accent || '#0A84FF';

  // ═══════════════════════════════════════════════════════
  // DYNAMIC AI & INTERNET RIVALS (Tailored to user's latest interest / search)
  // ═══════════════════════════════════════════════════════
  const workspaceIdsKey = useMemo(() => {
    return workspaceCharacters.map((c) => c.id).sort().join(',');
  }, [workspaceCharacters]);

  const searchQueriesKey = useMemo(() => {
    return (rawRecentSearchQueries || []).slice(0, 5).join(',');
  }, [rawRecentSearchQueries]);

  const isFetchingRivalsRef = useRef(false);

  useEffect(() => {
    let isMounted = true;
    const fetchRivals = async () => {
      if (workspaceCharacters.length === 0 && rawRecentSearchQueries.length === 0) return;
      if (isFetchingRivalsRef.current) return;
      isFetchingRivalsRef.current = true;
      setIsFetchingRivals(true);

      try {
        const targets = workspaceCharacters.slice(0, 4).map((c) => ({
          id: c.id,
          name: c.name,
          series: c.series,
        }));
        const results = await fetchDynamicRivals({
          characters: targets,
          recentSearches: rawRecentSearchQueries,
          token,
        });
        if (isMounted && Array.isArray(results) && results.length > 0) {
          setDynamicRivals(results);
          results.forEach((r: any) => {
            if (r?.rivalCharacter?.id) {
              registerCustomCharacter(r.rivalCharacter);
              setCharacterList((prev) => {
                if (prev.some((c) => c.id === r.rivalCharacter.id)) return prev;
                return [...prev, r.rivalCharacter];
              });
            }
          });
        }
      } catch (err) {
        console.log('Dynamic rivals unavailable, using local lore:', (err as any)?.message || err);
      } finally {
        isFetchingRivalsRef.current = false;
        if (isMounted) setIsFetchingRivals(false);
      }
    };

    fetchRivals();
    return () => {
      isMounted = false;
    };
  }, [workspaceIdsKey, searchQueriesKey, token]);

  // Dynamic Rival Encounters with rich curated fallback
  const rivalRelations: RivalRelation[] = useMemo(() => {
    const combined: RivalRelation[] = [];
    const seenRivalIds = new Set<string>();

    (dynamicRivals || []).forEach((rel) => {
      if (rel?.rivalCharacter?.id && !seenRivalIds.has(rel.rivalCharacter.id)) {
        seenRivalIds.add(rel.rivalCharacter.id);
        combined.push(rel);
      }
    });

    const activeList: RivalRelation[] = combined.length > 0 ? combined : getRivalsForWorkspace(workspaceIds);
    if (activeList.length === 0) return [];
    if (rivalShuffleSeed === 0) return activeList;
    const offset = rivalShuffleSeed % activeList.length;
    return [...activeList.slice(offset), ...activeList.slice(0, offset)];
  }, [dynamicRivals, rivalShuffleSeed, workspaceIds]);

  const handleRerollRivals = async () => {
    triggerHaptic('medium');
    setRivalShuffleSeed((prev) => prev + 1);
    setIsFetchingRivals(true);
    try {
      const targets = workspaceCharacters.slice(0, 4).map((c) => ({
        id: c.id,
        name: c.name,
        series: c.series,
      }));
      const fresh = await fetchDynamicRivals({
        characters: targets,
        recentSearches: rawRecentSearchQueries,
        forceRefresh: true,
        token,
      });
      if (Array.isArray(fresh) && fresh.length > 0) {
        setDynamicRivals(fresh);
        fresh.forEach((r: any) => {
          if (r?.rivalCharacter?.id) {
            setCharacterList((prev) => {
              if (prev.some((c) => c.id === r.rivalCharacter.id)) return prev;
              return [...prev, r.rivalCharacter];
            });
          }
        });
      }
    } catch (err) {
      console.warn('Failed to re-roll dynamic rivals:', err);
    } finally {
      setIsFetchingRivals(false);
    }
  };

  // Daily Companion Prophecy thought — dynamically rotates daily & cycles through oracle wisdom
  const currentProphecy = useMemo(() => {
    if (!characterList || characterList.length === 0) return null;
    const char = characterList[(dailySeed + prophecyOffset) % characterList.length];
    if (!char) return null;
    const resolved = resolveProphecyForCharacter(char, dailySeed, prophecyOffset);
    return {
      character: char,
      quote: customProphecyQuote?.quote || resolved.quote,
      category: customProphecyQuote?.category || resolved.category,
      tag: customProphecyQuote?.tag || resolved.tag,
    };
  }, [characterList, dailySeed, prophecyOffset, customProphecyQuote]);

  // Attempt to enrich prophecy with Azure OpenAI when available
  useEffect(() => {
    const char = currentProphecy?.character;
    if (!char) return;
    let isCancelled = false;
    fetchDynamicServerProphecy(char.id, char.name).then((serverProphecy) => {
      if (!isCancelled && serverProphecy) {
        setCustomProphecyQuote(serverProphecy);
      }
    });
    return () => {
      isCancelled = true;
    };
  }, [currentProphecy?.character?.id]);

  const handleNextProphecy = () => {
    triggerHaptic('light');
    setCustomProphecyQuote(null);
    setProphecyOffset((prev) => prev + 1);
  };

  const handleRandomRoll = () => {
    triggerHaptic('success');
    if (characterList.length === 0) return;
    const randomIndex = Math.floor(Math.random() * characterList.length);
    const chosen = characterList[randomIndex];
    router.push(`/chat/${chosen.id}`);
  };



  // "You May Also Like" picks: Powered primarily by Azure OpenAI & Web AI Recommendations
  // with fallback to category affinity, strictly excluding chatted/workspace companions
  const youMayAlsoLikePicks = useMemo(() => {
    const safeWorkspaceIds: string[] = Array.isArray(workspaceIds) ? workspaceIds : [];
    const rivalIds = new Set((rivalRelations || []).map((r) => r?.rivalCharacter?.id).filter(Boolean));
    const wsIds = new Set(safeWorkspaceIds);
    const activityIds = new Set(
      (Array.isArray(activityList) ? activityList : [])
        .map((a) => a?.character?.id)
        .filter(Boolean) as string[]
    );
    const excluded = new Set([...Array.from(wsIds), ...Array.from(rivalIds), ...Array.from(activityIds)]);

    // 1. AI-generated suggestions with rich personalized reasons (highest priority)
    const aiRecs = (recommendedCharacters || []).filter((c) => !excluded.has(c.id));
    const aiRecIds = new Set(aiRecs.map((c) => c.id));

    // 2. Universe category matches
    const sameCat = characterList.filter(
      (c) =>
        !excluded.has(c.id) &&
        !aiRecIds.has(c.id) &&
        (c.category === userCategory.id ||
          userCategory.characters.some((uc) => uc.id === c.id) ||
          (userCategory.id === 'hollywood' && c.category === 'cinema') ||
          (userCategory.id === 'marvel' && (c.series?.includes('Marvel') || c.series?.includes('DC'))))
    );

    const otherCat = characterList.filter(
      (c) => !excluded.has(c.id) && !aiRecIds.has(c.id) && !sameCat.some((sc) => sc.id === c.id)
    );

    return [...aiRecs, ...sameCat, ...otherCat];
  }, [characterList, workspaceIds, rivalRelations, activityList, userCategory, recommendedCharacters]);

  // Filter characters by category & active vibe (Explore Hall)
  const filteredCharacters = useMemo(() => {
    let list = characterList;

    // Prioritize fresh AI recommended suggestions in Explore Hall
    if (recommendedCharacters && recommendedCharacters.length > 0) {
      const recIds = new Set(recommendedCharacters.map((r) => r.id));
      list = [
        ...recommendedCharacters,
        ...characterList.filter((c) => !recIds.has(c.id)),
      ];
    }

    list = list.filter((c) => {
      if (activeCategoryId === 'all') return true;
      if (activeCategoryId === 'for-you') {
        return (
          (youMayAlsoLikePicks || []).some((p) => p.id === c.id) ||
          c.isRecommended ||
          (recommendedCharacters || []).some((r) => r.id === c.id)
        );
      }
      if (activeCategoryId === 'custom') return c.isCustom;
      if (activeCategoryId === 'cinema') {
        return (
          c.category === 'cinema' ||
          ['leo-das', 'master-jd', 'vikram-commander', 'rolex', 'baasha', 'dilli', 'bhavani', 'tony-stark', 'batman', 'john-wick', 'walter-white', 'joker'].includes(c.id)
        );
      }
      if (activeCategoryId === 'anime') {
        return (
          c.category === 'anime' ||
          c.series?.toLowerCase().includes('jujutsu') ||
          c.series?.toLowerCase().includes('chainsaw') ||
          c.series?.toLowerCase().includes('titan') ||
          ['gojo', 'sukuna', 'makima', 'levi'].includes(c.id)
        );
      }
      if (activeCategoryId === 'gaming') {
        return (
          c.category === 'gaming' ||
          c.series?.toLowerCase().includes('genshin') ||
          ['furina', 'hu-tao', 'raiden'].includes(c.id)
        );
      }
      return true;
    });

    return list;
  }, [characterList, activeCategoryId, youMayAlsoLikePicks, recommendedCharacters]);

  // Pull-to-refresh: instant local reload + live fetch of new rivals and AI suggestions
  const handleRefresh = useCallback(async () => {
    triggerHaptic('light');
    setIsRefreshing(true);
    setIsFetchingRivals(true);
    setRefreshSeed((prev) => prev + 1);
    setRivalShuffleSeed((prev) => prev + 1);

    const targets = workspaceCharacters.slice(0, 4).map((c) => ({
      id: c.id,
      name: c.name,
      series: c.series,
    }));

    await Promise.allSettled([
      loadCharacters(),
      loadActivity(),
      loadBehaviouralData(),
      loadFavorites(),
      loadRecommendations(true),
      fetchDynamicRivals({
        characters: targets,
        recentSearches: rawRecentSearchQueries,
        forceRefresh: true,
        token,
      }).then((fresh) => {
        if (Array.isArray(fresh) && fresh.length > 0) {
          setDynamicRivals(fresh);
          fresh.forEach((r: any) => {
            if (r?.rivalCharacter?.id) {
              registerCustomCharacter(r.rivalCharacter);
              setCharacterList((prev) => {
                if (prev.some((c) => c.id === r.rivalCharacter.id)) return prev;
                return [...prev, r.rivalCharacter];
              });
            }
          });
        }
      }),
    ]);
    setIsFetchingRivals(false);
    setIsRefreshing(false);
    triggerHaptic('success');
  }, [loadFavorites, workspaceCharacters, rawRecentSearchQueries, token]);

  // ─── Memoised renderItem callbacks — stable references so FlatList never re-renders unnecessarily ────

  const renderSpotlightItem = useCallback(({ item, index }: { item: Character; index: number }) => {
    const heroAccent = item.accent || '#0A84FF';
    return (
      <View style={styles.netflixSpotlightCell}>
        <View
          style={[
            styles.netflixPortraitShadowWrapper,
            isDark ? styles.netflixShadowDark : styles.netflixShadowLight,
          ]}
        >
          <View style={styles.netflixPortraitInner}>
            <Pressable
              onPress={() => router.push(`/chat/${item.id}`)}
              style={({ pressed }) => [{ opacity: pressed ? 0.94 : 1 }]}
            >
              <DynamicCharacterImage
                character={item}
                preferCover
                style={styles.netflixPortraitImage}
                contentFit="cover"
                contentPosition="top"
                transition={200}
              />
              <LinearGradient
                colors={['transparent', 'transparent', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.92)']}
                style={styles.netflixPortraitGradient}
                start={{ x: 0.5, y: 0 }}
                end={{ x: 0.5, y: 1 }}
              />
              <View style={[styles.netflixPortraitBadge, { backgroundColor: heroAccent + 'EE' }]}>
                <Ionicons name="sparkles" size={10} color="#fff" style={{ marginRight: 4 }} />
                <Text style={styles.netflixPortraitBadgeText}>{getHeroBadge(item)}</Text>
              </View>
              <View style={styles.netflixRankBadgePortrait}>
                <Ionicons name="trophy" size={10} color="#FFD700" style={{ marginRight: 3 }} />
                <Text style={styles.netflixRankText}>
                  #{index + 1} of {spotlightLengthRef.current}
                </Text>
              </View>
              <View style={styles.netflixPortraitOverlay}>
                <Text style={styles.netflixPortraitName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.netflixPortraitRole} numberOfLines={1}>{item.role}</Text>
                <Text style={styles.netflixPortraitDesc} numberOfLines={2}>
                  {item.shortDescription || item.greeting || 'Engage in an authentic storyline with full emotional depth.'}
                </Text>
                <View style={styles.netflixActionRow}>
                  <Pressable
                    onPress={() => router.push(`/chat/${item.id}`)}
                    style={({ pressed }) => [styles.netflixChatBtn, { backgroundColor: '#FFFFFF', opacity: pressed ? 0.88 : 1 }]}
                  >
                    <Ionicons name="chatbubble-ellipses" size={15} color="#000" style={{ marginRight: 6 }} />
                    <Text style={[styles.netflixChatBtnText, { color: '#000' }]}>Chat with {item.name.split(' ')[0]}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => openCharacter(item.id)}
                    style={({ pressed }) => [styles.netflixInfoBtn, { opacity: pressed ? 0.8 : 1 }]}
                  >
                    <Ionicons name="information-circle-outline" size={17} color="#fff" style={{ marginRight: 4 }} />
                    <Text style={[styles.netflixInfoBtnText, { color: '#fff' }]}>Lore</Text>
                  </Pressable>
                </View>
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }, [router, openCharacter, theme, isDark]);

  const renderPanoramicItem = useCallback(({ item, index }: { item: Character; index: number }) => {
    const matchPercent = Math.max(88, 99 - index * 2);
    return (
      <Pressable
        onPress={() => openCharacter(item.id)}
        style={({ pressed }) => [styles.panoramicCardPressable, pressed && { opacity: 0.9 }]}
      >
        <LiquidGlassView style={styles.panoramicCard} borderRadius={22} intensity={35} elevated>
          <View style={styles.panoramicImageWrap}>
            <DynamicCharacterImage
              character={item}
              preferCover
              style={styles.panoramicImage}
              contentFit="cover"
              contentPosition="top"
              transition={200}
            />
            <View style={[styles.panoramicMatchBadge, { backgroundColor: item.accent ? item.accent + 'E6' : '#0A84FFE6' }]}>
              <Text style={styles.panoramicMatchText} numberOfLines={1}>
                {item.recommendationReason || `${matchPercent}% Match`}
              </Text>
            </View>
          </View>
          <View style={styles.panoramicContent}>
            <View style={styles.panoramicHeaderRow}>
              <Text style={[styles.panoramicSeries, { color: theme.secondary }]} numberOfLines={1}>
                {item.series || 'Guild Universe'}
              </Text>
              <View style={[styles.panoramicOnlineDot, { backgroundColor: item.isOnline ? '#34C759' : theme.muted }]} />
            </View>
            <Text style={[styles.panoramicName, { color: theme.text }]} numberOfLines={1}>{item.name}</Text>
            <Text style={[styles.panoramicRole, { color: theme.secondary }]} numberOfLines={1}>{item.role}</Text>
            <View style={[styles.panoramicQuoteBubble, { backgroundColor: theme.surfaceSecondary }]}>
              <Text style={[styles.panoramicQuoteText, { color: theme.text }]} numberOfLines={2}>
                "{item.greeting || item.shortDescription}"
              </Text>
            </View>
            <View style={styles.panoramicFooterRow}>
              <View style={styles.panoramicTagsRow}>
                {(item.personality || []).slice(0, 2).map((t) => (
                  <View key={t} style={[styles.panoramicTagPill, { borderColor: theme.border }]}>
                    <Text style={[styles.panoramicTagText, { color: theme.muted }]} numberOfLines={1}>{t}</Text>
                  </View>
                ))}
              </View>
              <View style={[styles.panoramicChatBtn, { backgroundColor: theme.text }]}>
                <Ionicons name="chatbubble-ellipses" size={12} color={theme.background} />
              </View>
            </View>
          </View>
        </LiquidGlassView>
      </Pressable>
    );
  }, [openCharacter, theme]);

  const renderExploreItem = useCallback(({ item: char }: { item: Character }) => {
    const accent = char.accent || '#0A84FF';
    return (
      <Pressable
        style={({ pressed }) => [styles.exploreCardWrap, pressed && { opacity: 0.9, transform: [{ scale: 0.98 }] }]}
        onPress={() => {
          triggerHaptic('light');
          router.push(`/chat/${char.id}`);
        }}
      >
        <LiquidGlassView style={styles.exploreCard} borderRadius={20} intensity={30} elevated>
          <View style={styles.exploreCardImageWrap}>
            <DynamicCharacterImage
              character={char}
              preferCover
              style={styles.exploreCardImage}
              contentFit="cover"
              contentPosition="top"
              transition={200}
            />
            <LinearGradient
              colors={['rgba(0,0,0,0.4)', 'transparent', 'rgba(0,0,0,0.88)']}
              style={StyleSheet.absoluteFill}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
            />
            <View style={[styles.exploreUniverseBadge, { backgroundColor: accent + 'EE' }]}>
              <Text style={styles.exploreUniverseBadgeText} numberOfLines={1}>
                {(char.series || char.category || 'LEGEND').toUpperCase()}
              </Text>
            </View>
            <View style={styles.exploreOnlineDot} />
          </View>
          <View style={styles.exploreCardContent}>
            <Text style={[styles.exploreCardName, { color: theme.text }]} numberOfLines={1}>{char.name}</Text>
            <Text style={[styles.exploreCardRole, { color: theme.secondary }]} numberOfLines={1}>{char.role}</Text>
            <Text style={[styles.exploreCardSnippet, { color: theme.muted }]} numberOfLines={2}>
              "{char.greeting || char.shortDescription || 'An authentic saga awaits.'}"
            </Text>
            <View style={[styles.exploreConnectPill, { backgroundColor: theme.surfaceSecondary }]}>
              <Ionicons name="chatbubble" size={11} color={theme.text} style={{ marginRight: 4 }} />
              <Text style={[styles.exploreConnectText, { color: theme.text }]}>Connect</Text>
              <Ionicons name="chevron-forward" size={12} color={theme.muted} style={{ marginLeft: 'auto' }} />
            </View>
          </View>
        </LiquidGlassView>
      </Pressable>
    );
  }, [router, theme]);

  // Only show skeleton on initial mount when no characters exist yet — never wipe out content during pull-to-refresh
  const showSkeleton = isLoadingData && characterList.length === 0;

  return (

    <View style={[styles.screen, { backgroundColor: theme.background }]}>
      {/* Dynamic Netflix-Style Glossy Blurred Backdrop - hidden during skeleton so clean background color shows */}
      {/* Dynamic Netflix-Style Smokey Blurred Backdrop with native gesture velocity */}
      {!showSkeleton && spotlightCharacters.length > 0 && (
        <View pointerEvents="none" style={styles.netflixBackdropWrap}>
          {/* Continuous Velocity-Driven Smokey Image Layers */}
          {spotlightCharacters.map((hero, i) => {
            const inputRange = [
              (i - 1) * SPOTLIGHT_ITEM_WIDTH,
              i * SPOTLIGHT_ITEM_WIDTH,
              (i + 1) * SPOTLIGHT_ITEM_WIDTH,
            ];

            const opacity = scrollX.interpolate({
              inputRange,
              outputRange: [0, 1, 0],
              extrapolate: 'clamp',
            });

            // Smooth smoke billow drift matching swipe velocity
            const translateX = scrollX.interpolate({
              inputRange,
              outputRange: [-45, 0, 45],
              extrapolate: 'clamp',
            });

            // Billowy expanding smoke puff
            const scale = scrollX.interpolate({
              inputRange,
              outputRange: [1.2, 1.0, 1.2],
              extrapolate: 'clamp',
            });

            const rotate = scrollX.interpolate({
              inputRange,
              outputRange: ['-2deg', '0deg', '2deg'],
              extrapolate: 'clamp',
            });

            return (
              <Animated.View
                key={`smoke-backdrop-${hero.id}-${i}`}
                style={[
                  StyleSheet.absoluteFill,
                  {
                    opacity,
                    transform: [{ translateX }, { scale }, { rotate }],
                  },
                ]}
              >
                <DynamicCharacterImage
                  character={hero}
                  preferCover
                  style={[
                    styles.netflixBackdropImg,
                    Platform.OS === 'android' && { opacity: 0.35 },
                  ]}
                  blurRadius={Platform.OS === 'android' ? 36 : 0}
                  contentFit="cover"
                  contentPosition="top"
                />
                {/* Individual continuous colored smoke mist for this character */}
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    {
                      backgroundColor: hero.accent || '#0A84FF',
                      opacity: isDark ? 0.45 : 0.35,
                    },
                  ]}
                />
                {/* Radiant atmospheric ambient glow — vibrant in both dark and light modes */}
                <LinearGradient
                  colors={[
                    hero.accent
                      ? `${hero.accent}${isDark ? 'AA' : '88'}`
                      : isDark
                      ? 'rgba(10, 132, 255, 0.65)'
                      : 'rgba(10, 132, 255, 0.45)',
                    hero.accent
                      ? `${hero.accent}${isDark ? '44' : '30'}`
                      : isDark
                      ? 'rgba(10, 132, 255, 0.28)'
                      : 'rgba(10, 132, 255, 0.18)',
                    'transparent',
                  ]}
                  style={StyleSheet.absoluteFill}
                  start={{ x: 0.5, y: 0 }}
                  end={{ x: 0.5, y: 0.85 }}
                />
              </Animated.View>
            );
          })}

          {/* Ambient single blur layer (intense frosted glass creates fluid smokey diffusion) */}
          <BlurView
            intensity={Platform.OS === 'android' ? 50 : 95}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
          {/* Luminous smooth tint overlay — high brightness and vibrant color bloom in both themes */}
          <View
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: isDark
                  ? Platform.OS === 'android'
                    ? 'rgba(10, 8, 20, 0.42)'
                    : 'rgba(0, 0, 0, 0.36)'
                  : Platform.OS === 'android'
                    ? 'rgba(255, 255, 255, 0.48)'
                    : 'rgba(255, 255, 255, 0.50)',
              },
            ]}
          />
          {/* Bottom gradient blending into page */}
          <LinearGradient
            colors={[
              'transparent',
              isDark
                ? (Platform.OS === 'android' ? 'rgba(10, 8, 20, 0.35)' : 'rgba(0,0,0,0.30)')
                : 'rgba(255,255,255,0.35)',
              isDark
                ? (Platform.OS === 'android' ? 'rgba(10, 8, 20, 0.85)' : 'rgba(0,0,0,0.85)')
                : 'rgba(255,255,255,0.88)',
              theme.background,
            ]}
            style={[
              styles.netflixBottomGradient,
              { height: 360 },
            ]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
          />
        </View>
      )}

      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={theme.text}
              colors={[theme.text]}
              progressBackgroundColor={theme.surfaceSolid}
            />
          }
        >
          {/* Clean iOS Minimalist Floating Header */}
          <View style={styles.header}>
            <View>
              <Text style={[styles.eyebrow, { color: isDark ? 'rgba(255,255,255,0.7)' : theme.secondary }]}>
                AI COMPANIONS
              </Text>
              <Text style={[styles.title, { color: theme.text }]}>Discover</Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                onPress={toggleTheme}
                accessibilityLabel="Toggle theme"
                style={[styles.iconButton, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}
              >
                <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={19} color={theme.text} />
              </Pressable>
              <Pressable
                onPress={() => {
                  triggerHaptic();
                  setShowNotificationsModal(true);
                }}
                accessibilityLabel="Notifications"
                style={[
                  styles.iconButton,
                  { backgroundColor: theme.surfaceSolid, borderColor: theme.border, position: 'relative' },
                ]}
              >
                <Ionicons name="notifications-outline" size={19} color={theme.text} />
                {notificationsList.some((n) => n.unread) && (
                  <View style={styles.notifBadgeDot} />
                )}
              </Pressable>
            </View>
          </View>

          {/* Search Bar — taps into full-screen search */}
          <Pressable onPress={() => router.push('/search')} style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}>
            <LiquidGlassView style={styles.searchBar} borderRadius={24} intensity={35} elevated>
              <Ionicons name="search" size={18} color={theme.secondary} />
              <Text style={[styles.searchInput, { color: theme.muted }]}>
                Search any character (Gojo, Batman, Leo…)
              </Text>
              <View style={[styles.searchButton, { backgroundColor: theme.text }]}>
                <Ionicons name="sparkles" size={13} color={theme.background} />
                <Text style={[styles.searchButtonText, { color: theme.background }]}>Find</Text>
              </View>
            </LiquidGlassView>
          </Pressable>

          {/* ============================================================ */}
          {/* TOP CHARACTERS: NETFLIX DYNAMIC SPOTLIGHT (or skeleton)     */}
          {/* ============================================================ */}
          {showSkeleton ? (
            /* ── Skeleton for spotlight ── */
            <View style={[styles.netflixHeroSection, { marginBottom: 24 }]}>
              {/* Portrait skeleton */}
              <SkeletonPulse style={{ width: '100%', height: 420, borderRadius: 24, marginBottom: 18 }} />
              {/* Label skeletons */}
              <SkeletonPulse style={{ width: 120, height: 12, borderRadius: 6, marginBottom: 10 }} />
              <SkeletonPulse style={{ width: '80%', height: 18, borderRadius: 8, marginBottom: 8 }} />
            </View>
          ) : spotlightCharacters.length > 0 ? (
            <View style={styles.netflixHeroSection}>
              <AnimatedFlatList
                ref={spotlightListRef}
                data={spotlightCharacters}
                horizontal
                pagingEnabled
                snapToInterval={SPOTLIGHT_ITEM_WIDTH}
                snapToAlignment="center"
                decelerationRate="fast"
                disableIntervalMomentum={Platform.OS === 'ios'}
                showsHorizontalScrollIndicator={false}
                nestedScrollEnabled
                style={{ overflow: 'visible' }}
                contentContainerStyle={{ paddingVertical: 4 }}
                keyExtractor={(item: Character) => `spotlight-hero-${item.id}`}
                onScrollBeginDrag={() => {
                  isUserInteractingRef.current = true;
                }}
                onScrollEndDrag={(e: any) => {
                  const offsetX = e.nativeEvent.contentOffset.x;
                  const idx = Math.round(offsetX / SPOTLIGHT_ITEM_WIDTH);
                  if (idx >= 0 && idx < spotlightCharacters.length && idx !== displayedHeroIndex) {
                    triggerHaptic('light');
                    setActiveHeroIndex(idx);
                    setDisplayedHeroIndex(idx);
                  }
                  setTimeout(() => {
                    isUserInteractingRef.current = false;
                  }, 15000);
                }}
                onMomentumScrollEnd={(e: any) => {
                  const offsetX = e.nativeEvent.contentOffset.x;
                  const idx = Math.round(offsetX / SPOTLIGHT_ITEM_WIDTH);
                  if (idx >= 0 && idx < spotlightCharacters.length && idx !== displayedHeroIndex) {
                    triggerHaptic('light');
                    setActiveHeroIndex(idx);
                    setDisplayedHeroIndex(idx);
                  }
                }}
                onScroll={Animated.event(
                  [{ nativeEvent: { contentOffset: { x: scrollX } } }],
                  { useNativeDriver: true }
                )}
                scrollEventThrottle={16}
                renderItem={renderSpotlightItem}
                getItemLayout={(_: any, index: number) => ({
                  length: SPOTLIGHT_ITEM_WIDTH,
                  offset: SPOTLIGHT_ITEM_WIDTH * index,
                  index,
                })}
                initialNumToRender={2}
                maxToRenderPerBatch={2}
                windowSize={3}
              />

              {/* Dot indicators directly below spotlight */}
              <View style={styles.netflixDotsRow}>
                {spotlightCharacters.slice(0, 10).map((_, idx) => (
                  <Pressable
                    key={idx}
                    onPress={() => {
                      isUserInteractingRef.current = true;
                      scrollToHero(idx);
                      setTimeout(() => {
                        isUserInteractingRef.current = false;
                      }, 30000);
                    }}
                    hitSlop={6}
                  >
                    <View
                      style={[
                        styles.netflixDot,
                        idx === displayedHeroIndex && styles.netflixDotActive,
                      ]}
                    />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {/* ============================================================ */}
          {/* FAVORITE COMPANIONS: STARRED GUILD (USER-ISOLATED)          */}
          {/* ============================================================ */}
          {favoriteCharacters.length > 0 && (
            <View style={styles.favoritesSection}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={[styles.sectionEyebrow, { color: '#FF3B30' }]}>YOUR FAVORITES</Text>
                  <Text style={[styles.sectionTitle, { color: theme.text }]}>Starred Guild</Text>
                </View>
                <View
                  style={[
                    styles.workspaceCountBadge,
                    {
                      backgroundColor: 'rgba(255, 59, 48, 0.12)',
                      borderColor: 'rgba(255, 59, 48, 0.3)',
                      borderWidth: 1,
                    },
                  ]}
                >
                  <Ionicons name="heart" size={12} color="#FF3B30" style={{ marginRight: 4 }} />
                  <Text style={[styles.workspaceCountText, { color: '#FF3B30', fontWeight: '800' }]}>
                    {favoriteCharacters.length} Starred
                  </Text>
                </View>
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.workspaceList}>
                {favoriteCharacters.map((char) => (
                  <Pressable
                    key={`fav-${char.id}`}
                    onPress={() => openCharacter(char.id)}
                    style={({ pressed }) => [styles.workspaceCardPressable, pressed && { opacity: 0.88 }]}
                  >
                    <LiquidGlassView style={styles.workspaceCard} borderRadius={22} intensity={32} elevated>
                      <View style={styles.workspaceImageWrap}>
                        <DynamicCharacterImage
                          character={char}
                          preferCover
                          style={styles.workspaceImage}
                          contentFit="cover"
                          contentPosition="top"
                          transition={200}
                        />
                        <View style={styles.workspaceBadgeRow}>
                          <View style={[styles.seriesBadgeMini, { backgroundColor: 'rgba(0,0,0,0.65)' }]}>
                            <Text style={styles.seriesBadgeMiniText} numberOfLines={1}>
                              {char.series || 'Favorite'}
                            </Text>
                          </View>
                          <View style={styles.favoriteHeartBadge}>
                            <Ionicons name="heart" size={13} color="#FF3B30" />
                          </View>
                        </View>
                      </View>

                      <View style={styles.workspaceCardContent}>
                        <Text style={[styles.workspaceCharName, { color: theme.text }]} numberOfLines={1}>
                          {char.name}
                        </Text>
                        <Text style={[styles.workspaceCharRole, { color: theme.secondary }]} numberOfLines={1}>
                          {char.role}
                        </Text>

                        <Pressable
                          onPress={() => router.push(`/chat/${char.id}`)}
                          style={[styles.workspaceActionBtn, { backgroundColor: '#FF3B30' }]}
                        >
                          <Ionicons name="chatbubble" size={11} color="#FFFFFF" style={{ marginRight: 4 }} />
                          <Text style={[styles.workspaceActionText, { color: '#FFFFFF' }]}>Chat</Text>
                        </Pressable>
                      </View>
                    </LiquidGlassView>
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}

        {/* ============================================================ */}
        {/* 1. MY GUILD WORKSPACE: USER'S ONBOARDING PICKS               */}
        {/* ============================================================ */}
        <View style={styles.workspaceSection}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionEyebrow, { color: theme.secondary }]}>PERSONAL WORKSPACE</Text>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>My Companions</Text>
              </View>
              <View style={[styles.workspaceCountBadge, { backgroundColor: theme.surfaceSecondary }]}>
                <Ionicons name="cube-outline" size={12} color={theme.text} style={{ marginRight: 4 }} />
                <Text style={[styles.workspaceCountText, { color: theme.text }]}>
                  {workspaceCharacters.length} Active
                </Text>
              </View>
            </View>

            {showSkeleton ? (
              <View style={{ flexDirection: 'row', gap: 14, paddingVertical: 4 }}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={{ width: 170 }}>
                    <SkeletonPulse style={{ width: 170, height: 190, borderRadius: 16, marginBottom: 8 }} />
                    <SkeletonPulse style={{ width: 100, height: 12, borderRadius: 6, marginBottom: 6 }} />
                    <SkeletonPulse style={{ width: 70, height: 10, borderRadius: 5 }} />
                  </View>
                ))}
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.workspaceList}>
                {workspaceCharacters.map((char) => (
                  <Pressable
                    key={char.id}
                    onPress={() => openCharacter(char.id)}
                    style={({ pressed }) => [styles.workspaceCardPressable, pressed && { opacity: 0.88 }]}
                  >
                    <LiquidGlassView style={styles.workspaceCard} borderRadius={22} intensity={32} elevated>
                      <View style={styles.workspaceImageWrap}>
                        <DynamicCharacterImage
                          character={char}
                          preferCover
                          style={styles.workspaceImage}
                          contentFit="cover"
                          contentPosition="top"
                          transition={200}
                        />
                        <View style={styles.workspaceBadgeRow}>
                          <View style={[styles.seriesBadgeMini, { backgroundColor: 'rgba(0,0,0,0.65)' }]}>
                            <Text style={styles.seriesBadgeMiniText} numberOfLines={1}>
                              {char.series || 'Cinema'}
                            </Text>
                          </View>
                          <View style={styles.activeDot} />
                        </View>
                      </View>

                      <View style={styles.workspaceCardContent}>
                        <Text style={[styles.workspaceCharName, { color: theme.text }]} numberOfLines={1}>
                          {char.name}
                        </Text>
                        <Text style={[styles.workspaceCharRole, { color: theme.secondary }]} numberOfLines={1}>
                          {char.role}
                        </Text>

                        <Pressable
                          onPress={() => router.push(`/chat/${char.id}`)}
                          style={[styles.workspaceActionBtn, { backgroundColor: theme.text }]}
                        >
                          <Ionicons name="chatbubble" size={11} color={theme.background} style={{ marginRight: 4 }} />
                          <Text style={[styles.workspaceActionText, { color: theme.background }]}>Chat</Text>
                        </Pressable>
                      </View>
                    </LiquidGlassView>
                  </Pressable>
                ))}
              </ScrollView>
            )}
          </View>

        {/* ============================================================ */}
        {/* 2. YOUR ACTIVITY: PAST CARDS I TALKED WITH                   */}
        {/* ============================================================ */}
        <View style={styles.activitySection}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionEyebrow, { color: theme.secondary }]}>RECENT INTERACTION</Text>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Your Activity</Text>
              </View>
              {(activityList?.length ?? 0) > 0 && (
                <View style={[styles.activityCountBadge, { backgroundColor: theme.surfaceSecondary }]}>
                  <Ionicons name="time-outline" size={12} color={theme.text} style={{ marginRight: 4 }} />
                  <Text style={[styles.activityCountText, { color: theme.text }]}>
                    {activityList.length} Talked
                  </Text>
                </View>
              )}
            </View>

            {showSkeleton ? (
              <View style={{ flexDirection: 'row', gap: 14, paddingVertical: 4 }}>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={{ width: 200 }}>
                    <SkeletonPulse style={{ width: 200, height: 180, borderRadius: 16, marginBottom: 8 }} />
                    <SkeletonPulse style={{ width: 120, height: 12, borderRadius: 6, marginBottom: 6 }} />
                    <SkeletonPulse style={{ width: 80, height: 10, borderRadius: 5, marginBottom: 10 }} />
                    <SkeletonPulse style={{ width: '100%', height: 32, borderRadius: 12 }} />
                  </View>
                ))}
              </View>
            ) : (activityList?.length ?? 0) > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.activityList}>
                {(activityList || []).map((act) => {
                  const char = act?.character;
                  if (!char) return null;
                  return (
                    <Pressable
                      key={`activity-${char.id}`}
                      onPress={() => router.push(`/chat/${char.id}`)}
                      style={({ pressed }) => [styles.activityCardPressable, pressed && { opacity: 0.88 }]}
                    >
                      <LiquidGlassView style={styles.activityCard} borderRadius={22} intensity={32} elevated>
                        <View style={styles.activityImageWrap}>
                          <DynamicCharacterImage
                            character={char}
                            preferCover
                            style={styles.activityImage}
                            contentFit="cover"
                            contentPosition="top"
                            transition={200}
                          />
                          <View style={styles.activityBadgeRow}>
                            <View style={[styles.activityRecentBadge, { backgroundColor: 'rgba(0,0,0,0.65)' }]}>
                              <Ionicons name="chatbubbles" size={10} color="#30D158" style={{ marginRight: 3 }} />
                              <Text style={styles.activityRecentBadgeText}>Talked</Text>
                            </View>
                          </View>
                        </View>

                        <View style={styles.activityCardContent}>
                          <Text style={[styles.activityCharName, { color: theme.text }]} numberOfLines={1}>
                            {char.name}
                          </Text>
                          <Text style={[styles.activityCharRole, { color: theme.secondary }]} numberOfLines={1}>
                            {char.role}
                          </Text>
                          {act.lastMessage ? (
                            <Text style={[styles.activityLastMsg, { color: theme.muted }]} numberOfLines={2}>
                              "{act.lastMessage}"
                            </Text>
                          ) : (
                            <Text style={[styles.activityLastMsg, { color: theme.muted }]} numberOfLines={1}>
                              Active storyline
                            </Text>
                          )}

                          <Pressable
                            onPress={() => router.push(`/chat/${char.id}`)}
                            style={[styles.activityActionBtn, { backgroundColor: theme.text }]}
                          >
                            <Ionicons name="chatbubble-ellipses" size={12} color={theme.background} style={{ marginRight: 5 }} />
                            <Text style={[styles.activityActionText, { color: theme.background }]}>Resume Chat</Text>
                          </Pressable>
                        </View>
                      </LiquidGlassView>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <LiquidGlassView style={styles.emptyActivityBox} borderRadius={20} intensity={25}>
                <Ionicons name="chatbubble-ellipses-outline" size={24} color={theme.secondary} style={{ marginBottom: 6 }} />
                <Text style={[styles.emptyActivityTitle, { color: theme.text }]}>No Conversations Yet</Text>
                <Text style={[styles.emptyActivitySubtitle, { color: theme.secondary }]}>
                  Start chatting with your companions above. Your ongoing interactions and history will appear here.
                </Text>
              </LiquidGlassView>
            )}
          </View>

        {/* ============================================================ */}
        {/* 3. RIVAL ENCOUNTERS & SUGGESTIONS                            */}
        {/* ============================================================ */}
        {/* ============================================================ */}
        {/* 3. RIVAL ENCOUNTERS (HIGH-VOLTAGE VS CLASH DESIGN)           */}
        {/* ============================================================ */}
        {(rivalRelations.length > 0 || isFetchingRivals) && (
          <View style={styles.rivalsSection}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionEyebrow, { color: '#FF3B30' }]}>RIVAL ENCOUNTERS</Text>
                <Text style={[styles.sectionTitle, { color: theme.text }]}>Nemesis & Counterparts</Text>
              </View>
              <Pressable
                onPress={handleRerollRivals}
                disabled={isFetchingRivals}
                style={[
                  styles.rivalShuffleBtn,
                  { backgroundColor: 'rgba(255, 59, 48, 0.12)', borderColor: 'rgba(255, 59, 48, 0.3)' },
                ]}
                hitSlop={8}
              >
                <Ionicons name="shuffle" size={13} color="#FF3B30" style={{ marginRight: 4 }} />
                <Text style={styles.rivalShuffleBtnText}>
                  {isFetchingRivals ? 'Fetching...' : 'Re-roll Clashes'}
                </Text>
              </Pressable>
            </View>

            {isFetchingRivals && rivalRelations.length === 0 ? (
              <View style={{ flexDirection: 'row', gap: 14, paddingHorizontal: 20, paddingVertical: 8 }}>
                {[0, 1].map((i) => (
                  <View key={i} style={{ width: 280, height: 260, borderRadius: 24, overflow: 'hidden' }}>
                    <SkeletonPulse style={{ width: 280, height: 260, borderRadius: 24 }} />
                  </View>
                ))}
              </View>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rivalsList}>
              {rivalRelations.map((rel) => {
                const rival = rel.rivalCharacter;
                return (
                  <Pressable
                    key={rival.id}
                    onPress={() => router.push(`/chat/${rival.id}`)}
                    style={({ pressed }) => [styles.rivalCardPressable, pressed && { opacity: 0.88 }]}
                  >
                    <LiquidGlassView style={styles.rivalCard} borderRadius={24} intensity={40} elevated>
                      <View style={styles.rivalImageWrap}>
                        <DynamicCharacterImage
                          character={rival}
                          preferCover
                          style={styles.rivalImage}
                          contentFit="cover"
                          contentPosition="top"
                          transition={200}
                        />
                        <LinearGradient
                          colors={['rgba(255, 59, 48, 0.25)', 'transparent', 'rgba(0,0,0,0.85)']}
                          style={StyleSheet.absoluteFill}
                        />
                        {/* VS Clash Badge */}
                        <View style={styles.rivalVsBadge}>
                          <Text style={styles.rivalVsBadgeText}>VS</Text>
                        </View>
                        <View style={styles.rivalRelationBadge}>
                          <Ionicons name="flame" size={10} color="#fff" style={{ marginRight: 3 }} />
                          <Text style={styles.rivalRelationBadgeText} numberOfLines={1}>
                            {formatRivalBadge(rel.relationship)}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.rivalCardContent}>
                        <Text style={[styles.rivalCharName, { color: theme.text }]} numberOfLines={1}>
                          {rival.name}
                        </Text>
                        <Text style={[styles.rivalCharSeries, { color: theme.secondary }]} numberOfLines={1}>
                          {rival.series} · {rival.role}
                        </Text>
                        <Text style={[styles.rivalLoreText, { color: theme.muted }]} numberOfLines={2}>
                          {rel.rivalLore}
                        </Text>

                        <Pressable
                          onPress={() => {
                            triggerHaptic('heavy');
                            router.push(`/chat/${rival.id}`);
                          }}
                          style={styles.rivalConfrontBtn}
                        >
                          <Ionicons name="skull-outline" size={13} color="#fff" style={{ marginRight: 5 }} />
                          <Text style={styles.rivalConfrontBtnText}>Confront & Clash</Text>
                        </Pressable>
                      </View>
                    </LiquidGlassView>
                  </Pressable>
                );
              })}
            </ScrollView>
            )}
          </View>
        )}

        {/* ============================================================ */}
        {/* INTERACTIVE: SURPRISE COMPANION ROLL BANNER                 */}
        {/* ============================================================ */}
        <View style={styles.surpriseRollWrapper}>
          <Pressable
            onPress={handleRandomRoll}
            style={({ pressed }) => [styles.surpriseRollBtn, pressed && { opacity: 0.9 }]}
          >
            <LinearGradient
              colors={['#FF375F', '#AF52DE', '#5856D6']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.surpriseRollGradient}
            >
              <Ionicons name="dice" size={24} color="#FFFFFF" style={{ marginRight: 12 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.surpriseRollTitle}>Surprise Companion Roll</Text>
                <Text style={styles.surpriseRollSubtitle}>Can’t decide? Tap to instantly match with a random legend</Text>
              </View>
              <Ionicons name="arrow-forward-circle" size={24} color="#FFFFFF" />
            </LinearGradient>
          </Pressable>
        </View>

        {/* ============================================================ */}
        {/* INTERACTIVE: GUIDE PROPHECY OF THE DAY                       */}
        {/* ============================================================ */}
        {currentProphecy && (
          <View style={styles.prophecyWrapper}>
            <LiquidGlassView style={styles.prophecyCard} borderRadius={20} intensity={25} elevated>
              <View style={styles.prophecyHeader}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                  <Ionicons name="sparkles" size={14} color="#FF9F0A" />
                  <Text style={[styles.prophecyLabel, { color: '#FF9F0A' }]}>GUIDE PROPHECY OF THE DAY</Text>
                  <View style={styles.prophecyDateBadge}>
                    <Text style={styles.prophecyDateText}>{todayDateLabel}</Text>
                  </View>
                </View>
                <Pressable onPress={handleNextProphecy} hitSlop={8} style={styles.prophecyNextBtn}>
                  <Ionicons name="refresh" size={13} color={theme.secondary} />
                  <Text style={[styles.prophecyNextText, { color: theme.secondary }]}>Next</Text>
                </Pressable>
              </View>
              <Pressable
                onPress={() => router.push(`/chat/${currentProphecy.character.id}`)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 }}
              >
                <Image
                  source={{ uri: currentProphecy.character.avatarUrl }}
                  style={styles.prophecyAvatar}
                  contentFit="cover"
                  contentPosition="top"
                />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 2 }}>
                    <Text style={[styles.prophecyCharName, { color: theme.text }]}>
                      {currentProphecy.character.name}
                    </Text>
                    {currentProphecy.category && (
                      <View style={styles.prophecyTagPill}>
                        <Text style={styles.prophecyTagText}>
                          {currentProphecy.category}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.prophecyQuote, { color: theme.secondary }]} numberOfLines={3}>
                    "{currentProphecy.quote}"
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={theme.secondary} />
              </Pressable>
            </LiquidGlassView>
          </View>
        )}

        {/* ============================================================ */}
        {/* 4. EXPLORE HALL (UNIFIED WITH CURATED RECOMMENDATIONS)       */}
        {/* ============================================================ */}
        <View style={styles.sectionHeader}>
          <View>
            <Text style={[styles.sectionEyebrow, { color: '#0A84FF' }]}>DISCOVERY & UNIVERSE ROSTER</Text>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>Explore Hall</Text>
          </View>
          <Text style={[styles.sectionCount, { color: theme.secondary }]}>
            {filteredCharacters.length} companions
          </Text>
        </View>

        {/* Category Pills */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.categoriesRow}
        >
          {categories.map((cat) => {
            const isSelected = activeCategoryId === cat.id;
            return (
              <Pressable
                key={cat.id}
                onPress={() => {
                  triggerHaptic('selection');
                  setActiveCategoryId(cat.id);
                }}
                style={[
                  styles.categoryPill,
                  {
                    backgroundColor: isSelected ? theme.text : theme.cardGlass,
                    borderColor: isSelected ? theme.text : theme.border,
                  },
                ]}
              >
                <Ionicons
                  name={cat.icon}
                  size={14}
                  color={isSelected ? theme.background : theme.secondary}
                  style={{ marginRight: 6 }}
                />
                <Text
                  style={[
                    styles.categoryPillText,
                    { color: isSelected ? theme.background : theme.secondary },
                  ]}
                >
                  {cat.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Panoramic Curated Cards (Unified inside Explore Hall) */}
        {(activeCategoryId === 'all' || activeCategoryId === 'for-you') && youMayAlsoLikePicks.length > 0 && (
          <View style={{ marginBottom: 14 }}>
            <View style={[styles.sectionHeader, { marginTop: 4, marginBottom: 8 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="sparkles" size={13} color="#0A84FF" />
                <Text style={{ fontSize: 13, fontWeight: '800', color: theme.text }}>
                  Curated For You · AI Suggestions
                </Text>
              </View>
              <Text style={{ fontSize: 11, color: theme.muted, fontWeight: '600' }}>
                AI Tailored
              </Text>
            </View>

            <FlatList
              data={youMayAlsoLikePicks}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyExtractor={(item) => `panoramic-like-${item.id}`}
              renderItem={renderPanoramicItem}
              contentContainerStyle={styles.panoramicList}
              getItemLayout={(_: any, index: number) => ({
                length: PANORAMIC_CARD_WIDTH + 14,
                offset: (PANORAMIC_CARD_WIDTH + 14) * index,
                index,
              })}
              initialNumToRender={3}
              maxToRenderPerBatch={4}
              windowSize={5}
            />
          </View>
        )}

        {/* Explore Hall: Unique 2-Column Holographic Glass Grid */}
        <View style={{ marginTop: 8, marginBottom: 20 }}>
          <View style={[styles.sectionHeader, { marginBottom: 12 }]}>
            <Text style={{ fontSize: 13, fontWeight: '800', color: theme.text, letterSpacing: -0.2 }}>
              Explore Roster
            </Text>
            <Text style={{ fontSize: 11, color: theme.muted, fontWeight: '600' }}>
              {filteredCharacters.length} companions
            </Text>
          </View>

          {showSkeleton ? (
            <View style={styles.exploreGrid}>
              {[0, 1, 2, 3].map((i) => (
                <View key={i} style={styles.exploreCardWrap}>
                  <SkeletonPulse style={{ width: '100%', height: 245, borderRadius: 20 }} />
                </View>
              ))}
            </View>
          ) : (
            <FlatList
              data={filteredCharacters}
              numColumns={2}
              keyExtractor={(item) => `explore-grid-${item.id}`}
              renderItem={renderExploreItem}
              scrollEnabled={false}
              columnWrapperStyle={styles.exploreGrid}
              getItemLayout={(_: any, index: number) => ({
                length: EXPLORE_CARD_HEIGHT + 12,
                offset: (EXPLORE_CARD_HEIGHT + 12) * Math.floor(index / 2),
                index,
              })}
              initialNumToRender={6}
              maxToRenderPerBatch={6}
              windowSize={5}
              removeClippedSubviews
            />
          )}
        </View>

        {/* Roleplay Scenarios */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: theme.text }]}>Featured Scenarios</Text>
        </View>

        <Pressable
          onPress={() =>
            router.push({
              pathname: '/chat/leo-das',
              params: { prompt: 'You walk into Cafe Leo in Himachal. Parthiban looks up from the espresso counter.' },
            })
          }
          style={({ pressed }) => [styles.scenarioPressable, pressed && { opacity: 0.85 }]}
        >
          <LiquidGlassView style={styles.scenarioCard} borderRadius={20} intensity={25}>
            <View style={[styles.scenarioIcon, { backgroundColor: theme.surfaceSecondary }]}>
              <Ionicons name="cafe-outline" size={22} color={theme.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.scenarioTitle, { color: theme.text }]}>Cafe Leo in the Snow</Text>
              <Text style={[styles.scenarioDesc, { color: theme.secondary }]}>
                Order coffee and test whether the peaceful baker Parthiban reveals Leo Das.
              </Text>
            </View>
            <View style={[styles.scenarioActionPill, { backgroundColor: theme.text }]}>
              <Ionicons name="chatbubble" size={12} color={theme.background} style={{ marginRight: 4 }} />
              <Text style={[styles.scenarioActionText, { color: theme.background }]}>Chat</Text>
            </View>
          </LiquidGlassView>
        </Pressable>

        <Pressable
          onPress={() =>
            router.push({
              pathname: '/chat/furina',
              params: { prompt: 'High tea in Fontaine with delicate pastries and grand courtroom drama.' },
            })
          }
          style={({ pressed }) => [styles.scenarioPressable, pressed && { opacity: 0.85 }]}
        >
          <LiquidGlassView style={styles.scenarioCard} borderRadius={20} intensity={25}>
            <View style={[styles.scenarioIcon, { backgroundColor: theme.surfaceSecondary }]}>
              <Ionicons name="wine-outline" size={22} color={theme.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.scenarioTitle, { color: theme.text }]}>High Tea with Furina</Text>
              <Text style={[styles.scenarioDesc, { color: theme.secondary }]}>
                Taste delicate pastries while Furina delivers grand, sarcastic courtroom drama.
              </Text>
            </View>
            <View style={[styles.scenarioActionPill, { backgroundColor: theme.text }]}>
              <Ionicons name="chatbubble" size={12} color={theme.background} style={{ marginRight: 4 }} />
              <Text style={[styles.scenarioActionText, { color: theme.background }]}>Chat</Text>
            </View>
          </LiquidGlassView>
        </Pressable>
      </ScrollView>

      {/* Full-Page Storyboard Onboarding (First time only) */}
      <OnboardingStoryboard
        visible={!isAuthLoading && !hasCompletedOnboarding && !user}
        onComplete={() => loadCharacters()}
        onOpenSignIn={() => setShowAuthModal(true)}
      />

      <AuthModal visible={showAuthModal} onClose={() => setShowAuthModal(false)} />

      <NotificationsModal
        visible={showNotificationsModal}
        onClose={() => setShowNotificationsModal(false)}
        notifications={notificationsList}
        onMarkAllRead={async () => {
          await markAllNotificationsAsRead(notificationsList.map((n) => n.id));
          setNotificationsList((prev) => prev.map((n) => ({ ...n, unread: false })));
        }}
        onSelectNotification={async (notif) => {
          await markNotificationAsRead(notif.id);
          setNotificationsList((prev) =>
            prev.map((n) => (n.id === notif.id ? { ...n, unread: false } : n))
          );
        }}
      />
    </SafeAreaView>
  </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    padding: 14,
    paddingBottom: 95,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    marginTop: 2,
    letterSpacing: -0.4,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 10,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  notifBadgeDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 48,
    gap: 10,
    marginBottom: 20,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
  },
  searchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 4,
  },
  searchButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },

  // Workspace Section Styles
  workspaceSection: {
    marginBottom: 22,
  },
  sectionEyebrow: {
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  workspaceCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
  },
  workspaceCountText: {
    fontSize: 11,
    fontWeight: '700',
  },
  workspaceList: {
    gap: 14,
    paddingVertical: 4,
  },
  workspaceCardPressable: {
    width: 170,
  },
  workspaceCard: {
    padding: 8,
    overflow: 'hidden',
  },
  workspaceImageWrap: {
    width: '100%',
    height: 190,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  workspaceImage: {
    width: '100%',
    height: '100%',
  },
  workspaceBadgeRow: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  seriesBadgeMini: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  seriesBadgeMiniText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
  },
  activeDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#34C759',
  },
  workspaceCardContent: {
    paddingTop: 8,
    paddingHorizontal: 2,
  },
  workspaceCharName: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  workspaceCharRole: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  workspaceActionBtn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 12,
  },
  workspaceActionText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Activity Section Styles
  activitySection: {
    marginBottom: 22,
  },
  activityCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
  },
  activityCountText: {
    fontSize: 11,
    fontWeight: '700',
  },
  activityList: {
    gap: 14,
    paddingVertical: 4,
  },
  activityCardPressable: {
    width: 200,
  },
  activityCard: {
    padding: 8,
    overflow: 'hidden',
  },
  activityImageWrap: {
    width: '100%',
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  activityImage: {
    width: '100%',
    height: '100%',
  },
  activityBadgeRow: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  activityRecentBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  activityRecentBadgeText: {
    color: '#fff',
    fontSize: 9.5,
    fontWeight: '700',
  },
  activityCardContent: {
    paddingTop: 8,
    paddingHorizontal: 2,
  },
  activityCharName: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  activityCharRole: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  activityLastMsg: {
    fontSize: 11.5,
    lineHeight: 15,
    marginTop: 4,
  },
  activityActionBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: 12,
  },
  activityActionText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  emptyActivityBox: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  emptyActivityTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  emptyActivitySubtitle: {
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    maxWidth: 280,
  },

  // Rivals Section Styles
  rivalsSection: {
    marginBottom: 22,
  },
  rivalAlertBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 59, 48, 0.3)',
  },
  rivalAlertBadgeText: {
    color: '#FF3B30',
    fontSize: 11,
    fontWeight: '700',
  },
  rivalsList: {
    gap: 14,
    paddingVertical: 4,
  },
  rivalCardPressable: {
    width: 220,
  },
  rivalCard: {
    padding: 10,
    overflow: 'hidden',
  },
  rivalImageWrap: {
    width: '100%',
    height: 220,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  rivalImage: {
    width: '100%',
    height: '100%',
  },
  rivalRelationBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    maxWidth: '75%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 59, 48, 0.94)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45,
    shadowRadius: 5,
    elevation: 4,
  },
  rivalRelationBadgeText: {
    color: '#fff',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  rivalCardContent: {
    paddingTop: 10,
    paddingHorizontal: 2,
  },
  rivalCharName: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  rivalCharSeries: {
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 2,
  },
  rivalLoreText: {
    fontSize: 11,
    lineHeight: 15,
    marginTop: 4,
  },
  rivalConfrontBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FF3B30',
    paddingVertical: 7,
    borderRadius: 12,
  },
  rivalConfrontBtnText: {
    color: '#fff',
    fontSize: 11.5,
    fontWeight: '700',
  },
  rivalShuffleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  rivalShuffleBtnText: {
    color: '#FF3B30',
    fontSize: 11.5,
    fontWeight: '700',
  },
  rivalVsBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#FF3B30',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF3B30',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.6,
    shadowRadius: 4,
    elevation: 3,
  },
  rivalVsBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
  },

  // Surprise Companion Roll
  surpriseRollWrapper: {
    marginBottom: 24,
    borderRadius: 20,
    overflow: 'hidden',
  },
  surpriseRollBtn: {
    borderRadius: 20,
    overflow: 'hidden',
  },
  surpriseRollGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 20,
  },
  surpriseRollTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  surpriseRollSubtitle: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 11.5,
    fontWeight: '500',
    marginTop: 1,
  },

  // Panoramic Capsule Cards ("You May Also Like")
  capsuleCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
  },
  capsuleCountBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  panoramicList: {
    gap: 14,
    paddingVertical: 4,
  },
  panoramicCardPressable: {
    width: 320,
  },
  panoramicCard: {
    flexDirection: 'row',
    padding: 10,
    overflow: 'hidden',
  },
  panoramicImageWrap: {
    width: 96,
    height: 128,
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  panoramicImage: {
    width: '100%',
    height: '100%',
  },
  panoramicMatchBadge: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
    paddingVertical: 2,
    borderRadius: 6,
    alignItems: 'center',
  },
  panoramicMatchText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
  },
  panoramicContent: {
    flex: 1,
    paddingLeft: 12,
    justifyContent: 'space-between',
  },
  panoramicHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  panoramicSeries: {
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.2,
    flex: 1,
    textTransform: 'uppercase',
  },
  panoramicOnlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  panoramicName: {
    fontSize: 15,
    fontWeight: '800',
    marginTop: 1,
  },
  panoramicRole: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  panoramicQuoteBubble: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    marginTop: 5,
  },
  panoramicQuoteText: {
    fontSize: 10.5,
    fontStyle: 'italic',
    lineHeight: 14,
  },
  panoramicFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  panoramicTagsRow: {
    flexDirection: 'row',
    gap: 4,
    flex: 1,
  },
  panoramicTagPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  panoramicTagText: {
    fontSize: 9.5,
    fontWeight: '600',
  },
  panoramicChatBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },

  // Guild Prophecy
  prophecyWrapper: {
    marginBottom: 22,
  },
  prophecyCard: {
    padding: 14,
  },
  prophecyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  prophecyLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  prophecyDateBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1.5,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 159, 10, 0.14)',
  },
  prophecyDateText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#FF9F0A',
    letterSpacing: 0.2,
  },
  prophecyTagPill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 5,
    backgroundColor: 'rgba(255, 159, 10, 0.12)',
  },
  prophecyTagText: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#FF9F0A',
    letterSpacing: 0.3,
  },
  prophecyNextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  prophecyNextText: {
    fontSize: 11,
    fontWeight: '600',
  },
  prophecyAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  prophecyCharName: {
    fontSize: 13.5,
    fontWeight: '800',
  },
  prophecyQuote: {
    fontSize: 12,
    fontStyle: 'italic',
    lineHeight: 16,
    marginTop: 2,
  },

  // Dynamic Vibe Filters
  vibeFiltersRow: {
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 16,
  },
  vibePill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  vibePillText: {
    fontSize: 12,
  },

  // Netflix Dynamic Backdrop Styles
  netflixBackdropWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 500,
    overflow: 'hidden',
  },
  netflixBackdropImg: {
    width: '100%',
    height: '100%',
  },
  netflixAccentGlow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  netflixBottomGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 340,
  },

  // Netflix Portrait Card
  netflixSpotlightCell: {
    width: SPOTLIGHT_ITEM_WIDTH,
    paddingVertical: 10,
    paddingHorizontal: 2,
  },
  netflixPortraitShadowWrapper: {
    borderRadius: 24,
    marginBottom: 8,
  },
  netflixShadowDark: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.65,
    shadowRadius: 24,
    elevation: 12,
  },
  netflixShadowLight: {
    // Rich, luminous floating drop shadow in light theme
    shadowColor: '#120D26',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 20,
    elevation: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 0, 0, 0.08)',
  },
  netflixPortraitInner: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  netflixPortraitContainer: {
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  netflixPortraitImage: {
    width: '100%',
    height: 420,
  },
  netflixPortraitGradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 260,
  },
  netflixPortraitBadge: {
    position: 'absolute',
    top: 14,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  netflixPortraitBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    includeFontPadding: false,
  },
  netflixDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 10,
  },
  netflixDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  netflixDotActive: {
    width: 20,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FFFFFF',
  },
  favoritesSection: {
    marginBottom: 24,
  },
  favoriteHeartBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  netflixRankBadgePortrait: {
    position: 'absolute',
    top: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
  },
  netflixPortraitOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 18,
    paddingBottom: 20,
  },
  netflixPortraitName: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -0.8,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
    marginBottom: 4,
  },
  netflixPortraitRole: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginBottom: 6,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  netflixPortraitDesc: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12.5,
    lineHeight: 18,
    marginBottom: 16,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },

  // Netflix Hero Spotlight Styles
  netflixHeroSection: {
    marginBottom: 24,
    paddingTop: 4,
  },
  netflixRankText: {
    color: '#FFD700',
    fontSize: 10.5,
    fontWeight: '800',
  },
  netflixActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  netflixChatBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  netflixChatBtnText: {
    fontSize: 13.5,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  netflixInfoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.5)',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  netflixInfoBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  netflixThumbHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  autoSlideBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  autoSlideBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  netflixThumbRow: {
    gap: 12,
    paddingVertical: 4,
  },
  netflixThumbCard: {
    width: 126,
    height: 172,
    borderRadius: 18,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  netflixThumbCardActive: {
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.6,
    shadowRadius: 10,
    elevation: 7,
  },
  netflixThumbImg: {
    width: '100%',
    height: '100%',
  },
  netflixThumbContent: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
  },
  netflixThumbName: {
    color: '#FFFFFF',
    fontSize: 12.5,
    fontWeight: '800',
    letterSpacing: -0.2,
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowRadius: 4,
  },
  netflixThumbSeries: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
  netflixActiveIndicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 3.5,
  },
  curatedSection: {
    marginBottom: 22,
  },

  // Featured Styles
  featuredPressable: {
    marginBottom: 24,
  },
  featuredCard: {
    overflow: 'hidden',
  },
  featuredCoverWrapper: {
    width: '100%',
    height: 290,
    position: 'relative',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  featuredCoverImage: {
    width: '100%',
    height: '100%',
  },
  featuredTag: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  featuredTagText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  featuredBody: {
    padding: 16,
  },
  featuredName: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  featuredRole: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  featuredDesc: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },

  // Section Headers & Common
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  sectionCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  categoriesRow: {
    gap: 8,
    paddingBottom: 16,
  },
  categoryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
  },
  categoryPillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  characterList: {
    paddingBottom: 24,
  },
  scenarioPressable: {
    marginBottom: 10,
  },
  scenarioCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 14,
  },
  scenarioIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scenarioTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  scenarioDesc: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  scenarioActionPill: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scenarioActionText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Unique Explore Hall 2-Column Holographic Grid
  exploreGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  exploreCardWrap: {
    width: (SCREEN_WIDTH - 38) / 2,
    marginBottom: 8,
  },
  exploreCard: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  exploreCardImageWrap: {
    width: '100%',
    height: 190,
    position: 'relative',
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  exploreCardImage: {
    width: '100%',
    height: '100%',
  },
  exploreUniverseBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 8,
    maxWidth: '75%',
  },
  exploreUniverseBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  exploreOnlineDot: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#34C759',
    shadowColor: '#34C759',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
    elevation: 2,
  },
  exploreCardContent: {
    padding: 12,
    paddingTop: 10,
  },
  exploreCardName: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 2,
  },
  exploreCardRole: {
    fontSize: 11.5,
    fontWeight: '600',
    marginBottom: 6,
  },
  exploreCardSnippet: {
    fontSize: 11,
    lineHeight: 15,
    fontStyle: 'italic',
    marginBottom: 10,
  },
  exploreConnectPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  exploreConnectText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
});
