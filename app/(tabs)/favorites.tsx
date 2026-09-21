import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  Platform,
  StatusBar as RNStatusBar,
  TextInput,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/src/context/ThemeContext';
import { useAuth } from '@/src/context/AuthContext';
import { LiquidGlassView } from '@/src/components/LiquidGlassView';
import { getCharacter, getAllBuiltinCharacters } from '@/src/data/characters';
import { Character } from '@/src/types/character';
import { triggerHaptic } from '@/src/lib/haptics';
import { getFavoriteIds, toggleFavorite, subscribeToFavorites } from '@/src/lib/favorites';
import { DynamicCharacterImage } from '@/src/lib/dynamicImageService';
import { fetchCharacters } from '@/src/lib/chatApi';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const COLUMN_WIDTH = (SCREEN_WIDTH - 44) / 2;

export default function FavoritesScreen() {
  const router = useRouter();
  const { theme, isDark, toggleTheme } = useTheme();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const topInset = Platform.OS === 'android'
    ? Math.max(RNStatusBar.currentHeight || 0, insets.top)
    : insets.top;

  const [favoriteCharacters, setFavoriteCharacters] = useState<Character[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const loadFavorites = useCallback(async () => {
    try {
      const favIds = await getFavoriteIds(user?.id);
      if (favIds.length === 0) {
        setFavoriteCharacters([]);
        setIsLoading(false);
        return;
      }

      // 1. Gather all local known characters
      const allBuiltin = getAllBuiltinCharacters();
      const charMap = new Map<string, Character>();
      allBuiltin.forEach((c) => charMap.set(c.id, c));

      // 2. Fetch remote custom characters if any might be custom
      try {
        const remote = await fetchCharacters();
        if (Array.isArray(remote)) {
          remote.forEach((c) => charMap.set(c.id, c));
        }
      } catch {
        // Offline fallback uses all builtins
      }

      const resolved: Character[] = [];
      favIds.forEach((id) => {
        const found = charMap.get(id) || getCharacter(id);
        if (found) {
          resolved.push(found);
        }
      });

      setFavoriteCharacters(resolved);
    } catch (err) {
      console.log('Failed to load favorites:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadFavorites();
    const unsub = subscribeToFavorites(() => {
      loadFavorites();
    });
    return unsub;
  }, [loadFavorites]);

  useFocusEffect(
    useCallback(() => {
      loadFavorites();
    }, [loadFavorites])
  );

  const handleRemoveFavorite = async (charId: string) => {
    triggerHaptic('warning');
    await toggleFavorite(charId, user?.id);
    setFavoriteCharacters((prev) => prev.filter((c) => c.id !== charId));
  };

  const filteredFavorites = useMemo(() => {
    if (!searchQuery.trim()) return favoriteCharacters;
    const q = searchQuery.toLowerCase().trim();
    return favoriteCharacters.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.series && c.series.toLowerCase().includes(q)) ||
        (c.role && c.role.toLowerCase().includes(q))
    );
  }, [favoriteCharacters, searchQuery]);

  const renderItem = useCallback(
    ({ item }: { item: Character }) => {
      const heroAccent = item.accent || '#0A84FF';
      return (
        <View style={styles.cardCell}>
          <LiquidGlassView
            style={[
              styles.characterCard,
              {
                borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.08)',
              },
            ]}
            borderRadius={22}
            intensity={35}
            elevated
          >
            <Pressable
              onPress={() => {
                triggerHaptic('light');
                router.push(`/chat/${item.id}`);
              }}
              style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1, flex: 1 }]}
            >
              {/* Cover/Avatar Image */}
              <View style={styles.cardImageWrapper}>
                <DynamicCharacterImage
                  character={item}
                  preferCover
                  style={styles.cardImage}
                  contentFit="cover"
                  contentPosition="top"
                />
                <LinearGradient
                  colors={['transparent', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.92)']}
                  style={StyleSheet.absoluteFill}
                />

                {/* Remove from favorites heart button */}
                <Pressable
                  hitSlop={10}
                  onPress={(e) => {
                    e.stopPropagation();
                    handleRemoveFavorite(item.id);
                  }}
                  style={styles.heartBadge}
                >
                  <Ionicons name="heart" size={17} color="#FF3B30" />
                </Pressable>

                {/* Series / Role Tag */}
                <View style={[styles.accentTag, { backgroundColor: heroAccent + 'DD' }]}>
                  <Text style={styles.accentTagText} numberOfLines={1}>
                    {item.series ? item.series.split(' ')[0] : 'ALLY'}
                  </Text>
                </View>
              </View>

              {/* Card Meta Content */}
              <View style={styles.cardBody}>
                <Text style={[styles.cardName, { color: theme.text }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={[styles.cardRole, { color: theme.secondary }]} numberOfLines={1}>
                  {item.role || item.series || 'AI Companion'}
                </Text>

                {/* Chat Action Button */}
                <View style={styles.chatActionBtn}>
                  <Ionicons name="chatbubble-ellipses" size={14} color={theme.background} style={{ marginRight: 5 }} />
                  <Text style={[styles.chatActionText, { color: theme.background }]}>Chat</Text>
                </View>
              </View>
            </Pressable>
          </LiquidGlassView>
        </View>
      );
    },
    [theme, isDark, router]
  );

  return (
    <View style={[styles.container, { backgroundColor: theme.background, paddingTop: topInset }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: isDark ? 'rgba(255,255,255,0.7)' : theme.secondary }]}>
            SAVED COMPANIONS
          </Text>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: theme.text }]}>Favorites</Text>
            <View style={[styles.countPill, { backgroundColor: theme.surfaceSecondary }]}>
              <Ionicons name="heart" size={12} color="#FF3B30" style={{ marginRight: 4 }} />
              <Text style={[styles.countText, { color: theme.text }]}>{favoriteCharacters.length}</Text>
            </View>
          </View>
        </View>

        <Pressable
          onPress={toggleTheme}
          accessibilityLabel="Toggle theme"
          style={[styles.iconButton, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}
        >
          <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={19} color={theme.text} />
        </Pressable>
      </View>

      {/* Search Filter when user has favorites */}
      {favoriteCharacters.length > 2 && (
        <View style={styles.searchWrap}>
          <LiquidGlassView style={styles.searchBar} borderRadius={20} intensity={25}>
            <Ionicons name="search" size={16} color={theme.secondary} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search your favorites…"
              placeholderTextColor={theme.muted}
              style={[styles.searchInput, { color: theme.text }]}
              clearButtonMode="while-editing"
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={theme.muted} />
              </Pressable>
            )}
          </LiquidGlassView>
        </View>
      )}

      {/* Main Content */}
      {filteredFavorites.length > 0 ? (
        <FlatList
          data={filteredFavorites}
          keyExtractor={(item) => `fav-${item.id}`}
          renderItem={renderItem}
          numColumns={2}
          contentContainerStyle={[styles.gridContainer, { paddingBottom: 110 }]}
          showsVerticalScrollIndicator={false}
        />
      ) : (
        /* Empty State */
        <View style={styles.emptyWrap}>
          <LiquidGlassView style={styles.emptyCard} borderRadius={26} intensity={35} elevated>
            <View style={styles.emptyIconCircle}>
              <Ionicons name="heart-outline" size={38} color="#FF3B30" />
            </View>
            <Text style={[styles.emptyTitle, { color: theme.text }]}>
              {searchQuery ? 'No Matching Favorites' : 'No Favorite Characters Yet'}
            </Text>
            <Text style={[styles.emptySub, { color: theme.secondary }]}>
              {searchQuery
                ? `No liked characters match "${searchQuery}".`
                : 'Tap the heart icon on any character in Discover or Chat to save your favorites right here.'}
            </Text>

            {!searchQuery && (
              <Pressable
                onPress={() => {
                  triggerHaptic('medium');
                  router.push('/(tabs)');
                }}
                style={({ pressed }) => [
                  styles.exploreBtn,
                  { backgroundColor: theme.text, opacity: pressed ? 0.88 : 1 },
                ]}
              >
                <Ionicons name="compass" size={17} color={theme.background} style={{ marginRight: 6 }} />
                <Text style={[styles.exploreBtnText, { color: theme.background }]}>Explore Companions</Text>
              </Pressable>
            )}
          </LiquidGlassView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 14,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
  },
  countText: {
    fontSize: 12,
    fontWeight: '800',
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  searchWrap: {
    paddingHorizontal: 18,
    marginBottom: 12,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 42,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  gridContainer: {
    paddingHorizontal: 14,
    paddingTop: 4,
  },
  cardCell: {
    width: COLUMN_WIDTH,
    marginHorizontal: 4,
    marginBottom: 16,
  },
  characterCard: {
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 4,
  },
  cardImageWrapper: {
    height: 175,
    position: 'relative',
    overflow: 'hidden',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: '#000',
  },
  cardImage: {
    width: '100%',
    height: '100%',
  },
  heartBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  accentTag: {
    position: 'absolute',
    bottom: 10,
    left: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  accentTagText: {
    color: '#fff',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  cardBody: {
    padding: 12,
  },
  cardName: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  cardRole: {
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 10,
  },
  chatActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    paddingVertical: 7,
    borderRadius: 12,
  },
  chatActionText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingBottom: 90,
  },
  emptyCard: {
    padding: 28,
    alignItems: 'center',
    width: '100%',
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255, 59, 48, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  emptySub: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 22,
  },
  exploreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 18,
  },
  exploreBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});
