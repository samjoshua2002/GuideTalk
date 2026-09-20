import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
  ScrollView,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/context/ThemeContext';
import { useAuth } from '@/src/context/AuthContext';
import { Character } from '@/src/types/character';
import { generateCharacterWithAI, saveCustomCharacter } from '@/src/lib/chatApi';
import { LiquidGlassView } from './LiquidGlassView';
import { GlowButton } from './GlowButton';
import { DynamicCharacterImage } from '@/src/lib/dynamicImageService';

interface AddCharacterModalProps {
  visible: boolean;
  onClose: () => void;
  onCharacterCreated: (character: Character) => void;
}

export function AddCharacterModal({ visible, onClose, onCharacterCreated }: AddCharacterModalProps) {
  const { theme } = useTheme();
  const { token, user } = useAuth();
  const [query, setQuery] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [generated, setGenerated] = useState<Character | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!query.trim()) return;
    setError(null);
    setIsGenerating(true);
    try {
      const result = await generateCharacterWithAI(query.trim());
      setGenerated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate character.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!generated) return;
    setIsSaving(true);
    setError(null);
    try {
      const saved = await saveCustomCharacter(
        { ...generated, userId: user?.id || 'guest' },
        token
      );
      onCharacterCreated(saved);
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save character to MongoDB.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setQuery('');
    setGenerated(null);
    setError(null);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <LiquidGlassView style={styles.sheet} borderRadius={28} intensity={50} elevated>
          <View style={styles.header}>
            <View>
              <Text style={[styles.eyebrow, { color: theme.secondary }]}>AI COMPANION FORGE</Text>
              <Text style={[styles.title, { color: theme.text }]}>Summon Any Character</Text>
            </View>
            <Pressable onPress={handleClose} style={[styles.closeBtn, { backgroundColor: theme.surfaceSecondary }]}>
              <Ionicons name="close" size={20} color={theme.text} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <Text style={[styles.subtitle, { color: theme.secondary }]}>
              Enter any name (e.g. <Text style={{ color: theme.text, fontWeight: '700' }}>Furina</Text>, Gojo, Raiden, or custom). Our Azure AI will search their lore, speech rules, and emotional quirks.
            </Text>

            <View style={[styles.inputWrapper, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
              <Ionicons name="sparkles-outline" size={20} color={theme.secondary} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="e.g. Furina from Genshin Impact"
                placeholderTextColor={theme.muted}
                style={[styles.input, { color: theme.text }]}
                onSubmitEditing={handleGenerate}
                returnKeyType="search"
              />
              {query.length > 0 && (
                <Pressable onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={18} color={theme.muted} />
                </Pressable>
              )}
            </View>

            <View style={{ marginTop: 12 }}>
              <GlowButton
                label={isGenerating ? 'Analyzing Lore & Rules…' : 'Summon Companion'}
                icon={<Ionicons name="sparkles" size={16} color={theme.background} />}
                onPress={handleGenerate}
                loading={isGenerating}
                disabled={!query.trim()}
              />
            </View>

            {error && (
              <View style={[styles.errorBox, { borderColor: theme.border }]}>
                <Ionicons name="alert-circle-outline" size={18} color="#FF3B30" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {generated && (
              <View style={[styles.previewCard, { backgroundColor: theme.surfaceSolid, borderColor: theme.borderActive }]}>
                <View style={styles.previewHeader}>
                  <DynamicCharacterImage
                    sourceUri={generated.avatarUrl}
                    characterName={generated.name}
                    seriesName={generated.series}
                    style={styles.previewAvatar}
                    contentFit="cover"
                    contentPosition="top"
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.previewSeries, { color: theme.secondary }]}>
                      {generated.series || 'Custom Origin'}
                    </Text>
                    <Text style={[styles.previewName, { color: theme.text }]}>{generated.name}</Text>
                    <Text style={[styles.previewRole, { color: theme.secondary }]}>{generated.role}</Text>
                  </View>
                </View>

                <Text style={[styles.previewSectionTitle, { color: theme.text }]}>Greeting</Text>
                <Text style={[styles.previewGreeting, { color: theme.secondary }]}>"{generated.greeting}"</Text>

                <Text style={[styles.previewSectionTitle, { color: theme.text }]}>Personality & Quirks</Text>
                <View style={styles.traitsRow}>
                  {generated.personality.map((trait) => (
                    <View
                      key={trait}
                      style={[styles.traitPill, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}
                    >
                      <Text style={[styles.traitText, { color: theme.text }]}>{trait}</Text>
                    </View>
                  ))}
                </View>

                <Text style={[styles.previewSectionTitle, { color: theme.text }]}>Backstory & Lore</Text>
                <Text style={[styles.previewLore, { color: theme.secondary }]} numberOfLines={4}>
                  {generated.description}
                </Text>

                <View style={{ marginTop: 20 }}>
                  <GlowButton
                    label={isSaving ? 'Saving to Guild…' : 'Save to My Guild & Chat'}
                    icon={<Ionicons name="chatbubble-ellipses" size={16} color={theme.background} />}
                    onPress={handleSave}
                    loading={isSaving}
                  />
                </View>
              </View>
            )}
          </ScrollView>
        </LiquidGlassView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '90%',
    padding: 20,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
    letterSpacing: -0.4,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingBottom: 40,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 52,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 12,
    flex: 1,
  },
  previewCard: {
    marginTop: 20,
    padding: 18,
    borderRadius: 20,
    borderWidth: 1,
  },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 14,
  },
  previewAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  previewSeries: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  previewName: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  previewRole: {
    fontSize: 12,
    marginTop: 2,
  },
  previewSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 6,
  },
  previewGreeting: {
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  traitsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  traitPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  traitText: {
    fontSize: 11,
    fontWeight: '600',
  },
  previewLore: {
    fontSize: 12,
    lineHeight: 18,
  },
});
