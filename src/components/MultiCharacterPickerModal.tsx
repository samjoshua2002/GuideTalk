import React from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useTheme } from '@/src/context/ThemeContext';
import { LiquidGlassView } from './LiquidGlassView';
import { CharacterCandidate } from '@/src/lib/chatApi';
import { DynamicCharacterImage } from '@/src/lib/dynamicImageService';

interface MultiCharacterPickerModalProps {
  visible: boolean;
  query: string;
  loading: boolean;
  candidates: CharacterCandidate[];
  onSelect: (candidate: CharacterCandidate) => void;
  onClose: () => void;
}

export function MultiCharacterPickerModal({
  visible,
  query,
  loading,
  candidates,
  onSelect,
  onClose,
}: MultiCharacterPickerModalProps) {
  const { theme, isDark } = useTheme();

  if (!visible) {
    return null;
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        {Platform.OS !== 'web' ? (
          <BlurView intensity={70} tint={theme.blurTint} style={StyleSheet.absoluteFill} />
        ) : (
          <View style={[styles.webBackdrop, { backgroundColor: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.85)' }]} />
        )}

        <SafeAreaGlassContent
          query={query}
          loading={loading}
          candidates={candidates}
          onSelect={onSelect}
          onClose={onClose}
          theme={theme}
          isDark={isDark}
        />
      </View>
    </Modal>
  );
}

function SafeAreaGlassContent({
  query,
  loading,
  candidates,
  onSelect,
  onClose,
  theme,
  isDark,
}: {
  query: string;
  loading: boolean;
  candidates: CharacterCandidate[];
  onSelect: (c: CharacterCandidate) => void;
  onClose: () => void;
  theme: any;
  isDark: boolean;
}) {
  return (
    <View style={styles.container}>
      <LiquidGlassView style={styles.modalCard} borderRadius={30} intensity={60} elevated>
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <View style={styles.badgeRow}>
              <Ionicons name="sparkles" size={13} color={theme.text} />
              <Text style={[styles.badgeText, { color: theme.secondary }]}>AI MULTI-CANDIDATES</Text>
            </View>
            <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
              {loading ? `Searching "${query}"…` : `Choose "${query}" Variant`}
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            style={[styles.closeBtn, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}
          >
            <Ionicons name="close" size={18} color={theme.text} />
          </Pressable>
        </View>

        {/* Content Body */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <View style={styles.skeletonCardsRow}>
              {[1, 2, 3].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.skeletonCard,
                    {
                      backgroundColor: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)',
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.skeletonImage,
                      { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' },
                    ]}
                  >
                    <ActivityIndicator size="small" color={theme.text} />
                  </View>
                  <View style={styles.skeletonLines}>
                    <View
                      style={[
                        styles.skeletonLineShort,
                        { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)' },
                      ]}
                    />
                    <View
                      style={[
                        styles.skeletonLineLong,
                        { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)' },
                      ]}
                    />
                  </View>
                </View>
              ))}
            </View>
            <View style={styles.searchingNotice}>
              <Ionicons name="images-outline" size={16} color={theme.secondary} />
              <Text style={[styles.searchingText, { color: theme.secondary }]}>
                Gathering portraits and character lore from the web…
              </Text>
            </View>
          </View>
        ) : candidates.length === 0 ? (
          <View style={styles.emptyNotice}>
            <Ionicons name="alert-circle-outline" size={32} color={theme.muted} />
            <Text style={[styles.emptyText, { color: theme.text }]}>No characters found</Text>
            <Text style={[styles.emptySubtext, { color: theme.secondary }]}>
              Try searching with another name or series.
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.candidatesList}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[styles.instructions, { color: theme.secondary }]}>
              Select the version you want in your companion guild:
            </Text>
            {candidates.map((cand, idx) => (
              <Pressable
                key={`${cand.name}-${idx}`}
                onPress={() => onSelect(cand)}
                style={({ pressed }) => [styles.candidateCardPressable, pressed && { opacity: 0.85 }]}
              >
                <LiquidGlassView style={styles.candidateCard} borderRadius={20} intensity={25}>
                  <DynamicCharacterImage
                    sourceUri={cand.coverUrl || cand.avatarUrl}
                    characterName={cand.name}
                    seriesName={cand.series}
                    style={styles.candidateCover}
                    contentFit="cover"
                    contentPosition="top"
                  />
                  <View style={styles.candidateInfo}>
                    <View style={styles.candidateSeriesRow}>
                      <Ionicons name="film-outline" size={12} color={theme.secondary} />
                      <Text style={[styles.candidateSeries, { color: theme.secondary }]} numberOfLines={1}>
                        {cand.series || 'Original'}
                      </Text>
                    </View>
                    <Text style={[styles.candidateName, { color: theme.text }]} numberOfLines={1}>
                      {cand.name}
                    </Text>
                    <Text style={[styles.candidateRole, { color: theme.secondary }]} numberOfLines={1}>
                      {cand.role}
                    </Text>
                    <Text style={[styles.candidateDesc, { color: theme.muted }]} numberOfLines={2}>
                      {cand.shortDescription || cand.description}
                    </Text>
                    <View style={[styles.selectBtn, { backgroundColor: theme.text }]}>
                      <Ionicons name="chatbubble-ellipses" size={13} color={theme.background} />
                      <Text style={[styles.selectBtnText, { color: theme.background }]}>Select & Chat</Text>
                    </View>
                  </View>
                </LiquidGlassView>
              </Pressable>
            ))}
          </ScrollView>
        )}
      </LiquidGlassView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  webBackdrop: {
    ...StyleSheet.absoluteFill,
  },
  container: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '90%',
  },
  modalCard: {
    padding: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  loadingContainer: {
    paddingVertical: 20,
  },
  skeletonCardsRow: {
    gap: 12,
  },
  skeletonCard: {
    flexDirection: 'row',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    alignItems: 'center',
    gap: 12,
  },
  skeletonImage: {
    width: 70,
    height: 70,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeletonLines: {
    flex: 1,
    gap: 8,
  },
  skeletonLineShort: {
    width: '45%',
    height: 14,
    borderRadius: 7,
  },
  skeletonLineLong: {
    width: '85%',
    height: 12,
    borderRadius: 6,
  },
  searchingNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 22,
  },
  searchingText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  emptyNotice: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptySubtext: {
    fontSize: 13,
  },
  instructions: {
    fontSize: 13,
    marginBottom: 12,
  },
  candidatesList: {
    paddingBottom: 10,
    gap: 12,
  },
  candidateCardPressable: {
    borderRadius: 20,
  },
  candidateCard: {
    flexDirection: 'row',
    padding: 12,
    gap: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  candidateCover: {
    width: 90,
    height: 120,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  candidateInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  candidateSeriesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  candidateSeries: {
    fontSize: 11,
    fontWeight: '700',
  },
  candidateName: {
    fontSize: 17,
    fontWeight: '800',
    marginTop: 2,
    letterSpacing: -0.2,
  },
  candidateRole: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  candidateDesc: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
  },
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    marginTop: 8,
  },
  selectBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
});
