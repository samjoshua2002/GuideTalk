import React, { useState, useEffect } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/context/ThemeContext';
import { useAuth } from '@/src/context/AuthContext';
import { getCharacter } from '@/src/data/characters';
import { Character } from '@/src/types/character';
import { fetchCharacters, fetchCharacterById } from '@/src/lib/chatApi';
import { LiquidGlassView } from '@/src/components/LiquidGlassView';
import { GlowButton } from '@/src/components/GlowButton';
import { triggerHaptic } from '@/src/lib/haptics';
import { isFavorite, toggleFavorite, subscribeToFavorites } from '@/src/lib/favorites';
import { DynamicCharacterImage } from '@/src/lib/dynamicImageService';

export default function CharacterDetailsScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { theme, isDark } = useTheme();
  const { user, token } = useAuth();

  const [character, setCharacter] = useState<Character | null>(null);
  const [loading, setLoading] = useState(true);
  const [isFav, setIsFav] = useState(false);

  useEffect(() => {
    if (!character?.id) return;
    const uid = user?.id;
    isFavorite(character.id, uid).then(setIsFav);
    const unsub = subscribeToFavorites(() => {
      isFavorite(character.id, uid).then(setIsFav);
    });
    return unsub;
  }, [character?.id, user?.id]);

  const handleToggleFavorite = async () => {
    if (!character) return;
    triggerHaptic('medium');
    const newState = await toggleFavorite(character.id, user?.id);
    setIsFav(newState);
  };

  useEffect(() => {
    async function load() {
      const local = getCharacter(id || '');
      if (local) {
        setCharacter(local);
        setLoading(false);
        return;
      }
      try {
        const direct = await fetchCharacterById(id || '', token);
        if (direct) {
          setCharacter(direct);
          setLoading(false);
          return;
        }
        const custom = await fetchCharacters(user?.id, token);
        const match = custom.find((c: any) => c.id === id || c.mongoId === id || c._id === id);
        if (match) setCharacter(match);
      } catch {
        // Not found
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id, user, token]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.text} />
      </SafeAreaView>
    );
  }

  if (!character) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.background }]}>
        <Text style={[styles.title, { color: theme.text }]}>Character not found</Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 12 }}>
          <Text style={{ color: theme.secondary }}>Go back</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {/* Navigation Bar */}
        <View style={styles.topBar}>
          <Pressable
            hitSlop={8}
            onPress={() => {
              triggerHaptic('light');
              router.back();
            }}
            style={[styles.navBtn, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}
          >
            <Ionicons name="arrow-back" size={20} color={theme.text} />
          </Pressable>
          <View style={[styles.seriesPill, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
            <Text style={[styles.seriesText, { color: theme.text }]}>
              {character.series || 'Guild Universe'}
            </Text>
          </View>
          <Pressable
            hitSlop={8}
            onPress={handleToggleFavorite}
            accessibilityLabel={isFav ? 'Remove from favorites' : 'Add to favorites'}
            style={[
              styles.navBtn,
              { backgroundColor: theme.surfaceSolid, borderColor: theme.border },
              isFav && { backgroundColor: 'rgba(255, 59, 48, 0.15)', borderColor: 'rgba(255, 59, 48, 0.3)' },
            ]}
          >
            <Ionicons
              name={isFav ? 'heart' : 'heart-outline'}
              size={20}
              color={isFav ? '#FF3B30' : theme.text}
            />
          </Pressable>
        </View>

        {/* Hero Artwork Card */}
        <LiquidGlassView style={styles.heroCard} borderRadius={24} intensity={40} elevated>
          <DynamicCharacterImage
            character={character}
            preferCover
            style={styles.heroImage}
            contentFit="cover"
            contentPosition="top"
            transition={200}
          />
          <View
            style={[
              styles.heroOverlay,
              { backgroundColor: isDark ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.75)' },
            ]}
          >
            <View style={styles.headingRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.name, { color: theme.text }]}>{character.name}</Text>
                <Text style={[styles.role, { color: theme.secondary }]}>{character.role}</Text>
              </View>
              <View style={styles.statusPill}>
                <View style={[styles.onlineDot, { backgroundColor: character.isOnline ? '#34C759' : theme.muted }]} />
                <Text style={[styles.statusText, { color: theme.text }]}>
                  {character.isOnline ? 'Online' : 'Resting'}
                </Text>
              </View>
            </View>
          </View>
        </LiquidGlassView>

        {/* Description / Lore */}
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Backstory & Lore</Text>
        <LiquidGlassView style={styles.card} borderRadius={18} intensity={25}>
          <Text style={[styles.description, { color: theme.secondary }]}>{character.description}</Text>
        </LiquidGlassView>

        {/* Personality & Quirks */}
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Personality & Speech Quirks</Text>
        <View style={styles.tagsContainer}>
          {character.personality.map((trait) => (
            <View
              key={trait}
              style={[
                styles.tag,
                { backgroundColor: theme.surfaceSolid, borderColor: theme.border },
              ]}
            >
              <Text style={[styles.tagText, { color: theme.text }]}>{trait}</Text>
            </View>
          ))}
        </View>

        {/* Roleplay Starters */}
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Conversation Starters</Text>
        {character.starters.map((starter) => (
          <Pressable
            key={starter}
            style={({ pressed }) => [styles.starterPressable, pressed && { opacity: 0.8 }]}
            onPress={() => {
              triggerHaptic('light');
              router.push({
                pathname: `/chat/${character.id}`,
                params: { prompt: starter },
              });
            }}
          >
            <LiquidGlassView style={styles.starterCard} borderRadius={16} intensity={25}>
              <Text style={[styles.starterText, { color: theme.text }]}>"{starter}"</Text>
              <Ionicons name="arrow-forward" size={16} color={theme.secondary} />
            </LiquidGlassView>
          </Pressable>
        ))}

        {/* Bottom CTA */}
        <View style={styles.ctaContainer}>
          <GlowButton
            label={`Start Chatting with ${character.name.split(' ')[0]}`}
            onPress={() => {
              triggerHaptic('medium');
              router.push(`/chat/${character.id}`);
            }}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    padding: 20,
    paddingBottom: 60,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  navBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  seriesPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  seriesText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  heroCard: {
    position: 'relative',
    height: 340,
    overflow: 'hidden',
    marginBottom: 24,
  },
  heroImage: {
    width: '100%',
    height: '100%',
    position: 'absolute',
  },
  heroOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 20,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  name: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  role: {
    fontSize: 13,
    fontWeight: '500',
    marginTop: 3,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'android' ? 5 : 4,
    borderRadius: 12,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    includeFontPadding: false,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 20,
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  card: {
    padding: 16,
  },
  description: {
    fontSize: 14,
    lineHeight: 22,
  },
  tagsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'android' ? 7 : 6,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: {
    fontSize: 12,
    fontWeight: '600',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  starterPressable: {
    marginBottom: 10,
  },
  starterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    gap: 12,
  },
  starterText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
    lineHeight: 18,
  },
  ctaContainer: {
    marginTop: 24,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
});
