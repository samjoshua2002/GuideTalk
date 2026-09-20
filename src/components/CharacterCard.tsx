import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Character } from '@/src/types/character';
import { useTheme } from '@/src/context/ThemeContext';
import { triggerHaptic } from '@/src/lib/haptics';
import { LiquidGlassView } from './LiquidGlassView';
import { DynamicCharacterImage } from '@/src/lib/dynamicImageService';

interface CharacterCardProps {
  character: Character;
  onPress: () => void;
  compact?: boolean;
}

function CharacterCardComponent({ character, onPress, compact = false }: CharacterCardProps) {
  const { theme, isDark } = useTheme();

  const handlePress = () => {
    triggerHaptic('light');
    onPress();
  };

  if (compact) {
    return (
      <Pressable onPress={handlePress} style={({ pressed }) => [styles.compactPressable, pressed && styles.pressed]}>
        <LiquidGlassView style={styles.compactCard} borderRadius={20} intensity={25}>
          <DynamicCharacterImage
            sourceUri={character.avatarUrl}
            characterName={character.name}
            seriesName={character.series}
            style={styles.compactAvatar}
            contentFit="cover"
            contentPosition="top"
          />
          <View style={styles.compactContent}>
            <View style={styles.headerRow}>
              <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                {character.name}
              </Text>
              <View style={[styles.onlineDot, { backgroundColor: '#34C759' }]} />
            </View>
            <Text style={[styles.series, { color: theme.secondary }]} numberOfLines={1}>
              {character.series || character.role}
            </Text>
            <Text style={[styles.compactPreview, { color: theme.muted }]} numberOfLines={1}>
              {character.shortDescription}
            </Text>
          </View>
          <View style={[styles.compactChatBtn, { backgroundColor: theme.text }]}>
            <Ionicons name="chatbubble" size={12} color={theme.background} style={{ marginRight: 4 }} />
            <Text style={[styles.compactChatBtnText, { color: theme.background }]}>Chat</Text>
          </View>
        </LiquidGlassView>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={handlePress} style={({ pressed }) => [styles.cardPressable, pressed && styles.pressed]}>
      <LiquidGlassView style={styles.card} borderRadius={22} intensity={35} elevated>
        <View style={styles.imageContainer}>
          <DynamicCharacterImage
            sourceUri={character.coverUrl || character.avatarUrl}
            characterName={character.name}
            seriesName={character.series}
            style={styles.avatar}
            contentFit="cover"
            contentPosition="top"
          />
        </View>

        <View style={styles.content}>
          <View>
            <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>
              {character.name}
            </Text>
            <Text style={[styles.cardRole, { color: theme.secondary }]} numberOfLines={1}>
              {character.series ? `${character.series} · ${character.role}` : character.role}
            </Text>
            <Text style={[styles.description, { color: theme.muted }]} numberOfLines={2}>
              {character.shortDescription}
            </Text>
          </View>

          <View style={[styles.cardActionBtn, { backgroundColor: theme.text }]}>
            <Ionicons name="chatbubble-ellipses" size={12} color={theme.background} />
            <Text style={[styles.cardActionBtnText, { color: theme.background }]}>
              Chat with {character.name.split(' ')[0]}
            </Text>
          </View>
        </View>
      </LiquidGlassView>
    </Pressable>
  );
}

export const CharacterCard = React.memo(CharacterCardComponent);

const styles = StyleSheet.create({
  cardPressable: {
    width: 220,
    marginRight: 14,
  },
  card: {
    padding: 9,
    height: 390,
    justifyContent: 'space-between',
  },
  compactPressable: {
    width: '100%',
    marginBottom: 10,
  },
  compactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
  },
  compactChatBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
  },
  compactChatBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },
  imageContainer: {
    position: 'relative',
    width: '100%',
    height: 250,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  avatar: {
    width: '100%',
    height: '100%',
  },
  cardActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: 13,
    marginTop: 8,
    gap: 6,
  },
  cardActionBtnText: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 6,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  content: {
    flex: 1,
    paddingTop: 8,
    paddingHorizontal: 2,
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  cardRole: {
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 2,
  },
  description: {
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 4,
    height: 32,
  },
  compactAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  compactContent: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  series: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 1,
  },
  compactPreview: {
    fontSize: 12,
    marginTop: 3,
  },
});
