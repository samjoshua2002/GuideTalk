import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  ScrollView,
  Pressable,
  Platform,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/src/context/ThemeContext';
import { useAuth } from '@/src/context/AuthContext';
import { Character, CharacterCategory } from '@/src/types/character';
import { generateCharacterWithAI } from '@/src/lib/chatApi';
import { saveUserCreatedCharacter } from '@/src/lib/customCharacters';
import { GlowButton } from '@/src/components/GlowButton';
import { triggerHaptic } from '@/src/lib/haptics';

interface ArchetypePreset {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  name: string;
  role: string;
  category: CharacterCategory;
  avatarUrl: string;
  personality: string[];
  greeting: string;
  description: string;
  roleplayRules: string;
}

const ARCHETYPE_RECOMMENDATIONS: ArchetypePreset[] = [
  {
    id: 'tsundere',
    label: '⚡ Tsundere Rival',
    icon: 'flash-outline',
    name: 'Seraphina Frost',
    role: 'Prodigy Swordswoman & Rival',
    category: 'anime',
    avatarUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b238382-u3t9yR3q7z5T.png',
    personality: ['Tsundere', 'Sarcastic & Witty', 'Proud', 'Secretly Caring', 'Competitive'],
    greeting: 'Hmph! Don’t get the wrong idea—I only showed up because no one else in this guild could possibly match your stride. What are you looking at?',
    description: 'Seraphina is the top duelist of the Astral Academy. Despite her sharp tongue and feigned annoyance, she harbors immense loyalty and watches over her allies from the shadows.',
    roleplayRules: 'Speak with playful defiance, sarcastic teasing, and feigned exasperation in asterisks. Show hidden warmth when the user is genuine.',
  },
  {
    id: 'monarch',
    label: '🗡️ Shadow Monarch',
    icon: 'shield-outline',
    name: 'Kaelen Vance',
    role: 'Sovereign of the Nether Legion',
    category: 'warrior',
    avatarUrl: 'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&auto=format&fit=crop&q=85',
    personality: ['Stoic', 'Dominant', 'Tactical Genius', 'Unshakable', 'Loyal'],
    greeting: 'The shadows whispered of your approach. Step forward into my court. State your purpose, or be swept into the dark.',
    description: 'Kaelen governs the fallen realms with silent absolute authority. Cold and measured, he values strength of will and respects only those who face terror without flinching.',
    roleplayRules: 'Speak with commanding gravitas, deep atmospheric pauses, and calm tactical precision. Never lose composure.',
  },
  {
    id: 'celestial',
    label: '🌸 Gentle Guardian',
    icon: 'heart-outline',
    name: 'Lyra Celestia',
    role: 'Sanctuary Priestess of Starlight',
    category: 'celestial',
    avatarUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b316493-27VlJqHh0PzM.png',
    personality: ['Gentle & Warm', 'Empathetic', 'Wise', 'Comforting', 'Playful'],
    greeting: 'Welcome back, weary traveler. Come, sit by the starlight hearth. Let the burdens of your world melt away for a while.',
    description: 'Lyra is an immortal guardian of memories and starlight. Her gentle voice brings solace to troubled minds, weaving comfort and gentle wisdom into every encounter.',
    roleplayRules: 'Speak with boundless tender warmth, comforting empathy, gentle listening, and soft poetic cadence.',
  },
  {
    id: 'cyberpunk',
    label: '💻 Cyberpunk Rebel',
    icon: 'hardware-chip-outline',
    name: 'Vex Nitro',
    role: 'Renegade Netrunner & Black-Market Hacker',
    category: 'gaming',
    avatarUrl: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=85',
    personality: ['Tech Genius', 'Rebellious', 'Cheeky & Sarcastic', 'Fearless'],
    greeting: 'Neural jack secured, proxy scrambled. You’re lucky I answered—what megacorp data fortress are we burning to the ground tonight?',
    description: 'Vex lives on the neon edge of Neo-Shinjuku. With cybernetic oculars and an unrivaled breach protocol, she dismantles syndicate networks for fun and high-stakes bounties.',
    roleplayRules: 'Use sharp cyber-slang, irreverent sarcastic remarks, quick witty comebacks, and confident hacker swagger.',
  },
  {
    id: 'sorcerer',
    label: '👁️ Sorcerer Supreme',
    icon: 'sparkles-outline',
    name: 'Kento Satoru',
    role: 'Apex Sorcerer & Boundary Guardian',
    category: 'anime',
    avatarUrl: 'https://s4.anilist.co/file/anilistcdn/character/large/b127997-62kP2M3Xg5V1.png',
    personality: ['Confident & Playful', 'Genius', 'Unbothered', 'Protective', 'Witty'],
    greeting: '*lowers blindfold slightly with an amused smirk* Relax. You’re standing next to the strongest sorcerer in existence. What shall we conquer today?',
    description: 'An untouchable powerhouse of boundless cursed energy. Despite his playful nonchalance, he defends the innocent with catastrophic precision.',
    roleplayRules: 'Speak with effortless casual confidence, charismatic teasing, and playful banter. Never sound flustered.',
  },
];

const PRESET_AVATAR_CHOICES = [
  'https://s4.anilist.co/file/anilistcdn/character/large/b316493-27VlJqHh0PzM.png', // Furina
  'https://s4.anilist.co/file/anilistcdn/character/large/b127997-62kP2M3Xg5V1.png', // Gojo Satoru
  'https://s4.anilist.co/file/anilistcdn/character/large/b238382-u3t9yR3q7z5T.png', // Hu Tao
  'https://s4.anilist.co/file/anilistcdn/character/large/b237937-hW3kO3w9W7K1.png', // Raiden Shogun
  'https://s4.anilist.co/file/anilistcdn/character/large/b137079-w4N0ZJg0V8oW.png', // Makima
  'https://s4.anilist.co/file/anilistcdn/character/large/b45627-c1s6H53YyLq1.png',   // Levi Ackerman
  'https://s4.anilist.co/file/anilistcdn/character/large/b40882-Lg04Y4lP6vYq.png',   // Mikasa Ackerman
  'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=800&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&auto=format&fit=crop&q=85',
  'https://images.unsplash.com/photo-1563089145-599997674d42?w=800&auto=format&fit=crop&q=85',
];

const COMMON_TRAITS = [
  'Witty & Sarcastic',
  'Tsundere',
  'Warm & Gentle',
  'Stoic',
  'Mysterious',
  'Playful',
  'Dominant',
  'Protective',
  'Tech Genius',
  'Flirty',
  'Sweet Tooth',
  'Chaotic',
];

const CATEGORIES: { id: CharacterCategory; label: string }[] = [
  { id: 'anime', label: 'Anime' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'cinema', label: 'Cinema' },
  { id: 'celestial', label: 'Celestial' },
  { id: 'warrior', label: 'Warrior' },
  { id: 'fire', label: 'Fire' },
  { id: 'ice', label: 'Ice' },
  { id: 'custom', label: 'Custom' },
];

export default function CreateCharacterScreen() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const { token, user } = useAuth();
  const insets = useSafeAreaInsets();

  // Form State
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [category, setCategory] = useState<CharacterCategory>('anime');
  const [avatarUrl, setAvatarUrl] = useState<string>(PRESET_AVATAR_CHOICES[0]);
  const [greeting, setGreeting] = useState('');
  const [description, setDescription] = useState('');
  const [roleplayRules, setRoleplayRules] = useState('');
  const [personality, setPersonality] = useState<string[]>([
    'Witty & Sarcastic',
    'Playful',
  ]);
  const [customTraitInput, setCustomTraitInput] = useState('');

  // AI & Action States
  const [isGenerating, setIsGenerating] = useState(false);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Apply Archetype Preset
  const handleSelectArchetype = (preset: ArchetypePreset) => {
    triggerHaptic('medium');
    setName(preset.name);
    setRole(preset.role);
    setCategory(preset.category);
    setAvatarUrl(preset.avatarUrl);
    setPersonality(preset.personality);
    setGreeting(preset.greeting);
    setDescription(preset.description);
    setRoleplayRules(preset.roleplayRules);
  };

  // Surprise Me / Roll Random Character
  const handleSurpriseMe = () => {
    triggerHaptic('medium');
    const randomIndex = Math.floor(Math.random() * ARCHETYPE_RECOMMENDATIONS.length);
    handleSelectArchetype(ARCHETYPE_RECOMMENDATIONS[randomIndex]);
  };

  // Upload Custom Photo from Device Gallery
  const handlePickCustomPhoto = async () => {
    try {
      triggerHaptic('light');
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Photo Permission Needed',
          'Please allow photo library access in settings to upload your custom character picture.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (!result.canceled && result.assets && result.assets[0]?.uri) {
        setIsUploadingPhoto(true);
        triggerHaptic('success');
        setAvatarUrl(result.assets[0].uri);
      }
    } catch (err) {
      console.warn('Pick custom photo error:', err);
      Alert.alert('Upload Error', 'Failed to pick photo. Please try again.');
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  // AI Magic Generation & Auto-Recommend
  const handleGenerateAIRecommendations = async () => {
    if (!name.trim()) {
      triggerHaptic('warning');
      setError('Please enter a name or concept first (e.g. "Gojo", "Cyberpunk Hacker", "Tsundere Mage").');
      return;
    }
    setError(null);
    setIsGenerating(true);
    triggerHaptic('medium');

    try {
      const generated = await generateCharacterWithAI(name.trim(), role || undefined, avatarUrl);
      if (generated) {
        setName(generated.name || name);
        if (generated.role) setRole(generated.role);
        if (generated.greeting) setGreeting(generated.greeting);
        if (generated.description) setDescription(generated.description);
        if (generated.roleplayRules) setRoleplayRules(generated.roleplayRules);
        if (Array.isArray(generated.personality) && generated.personality.length > 0) {
          setPersonality(generated.personality);
        }
        if (generated.category) setCategory(generated.category);
        if (generated.avatarUrl && !avatarUrl.startsWith('file://')) {
          setAvatarUrl(generated.avatarUrl);
        }
        triggerHaptic('success');
      }
    } catch (err: any) {
      console.warn('Generation error:', err);
      setError(err?.message || 'Failed to auto-generate character lore. You can fill details manually!');
    } finally {
      setIsGenerating(false);
    }
  };

  // Toggle personality trait
  const toggleTrait = (trait: string) => {
    triggerHaptic('selection');
    if (personality.includes(trait)) {
      setPersonality(personality.filter((t) => t !== trait));
    } else {
      setPersonality([...personality, trait]);
    }
  };

  // Add custom trait
  const handleAddCustomTrait = () => {
    const trimmed = customTraitInput.trim();
    if (!trimmed) return;
    if (!personality.includes(trimmed)) {
      triggerHaptic('light');
      setPersonality([...personality, trimmed]);
    }
    setCustomTraitInput('');
  };

  // Create & Chat
  const handleSaveAndChat = async () => {
    if (!name.trim()) {
      triggerHaptic('warning');
      setError('Please enter a character name.');
      return;
    }

    setIsSaving(true);
    setError(null);
    triggerHaptic('medium');

    try {
      const charId = `custom-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}`;
      const newChar: Character = {
        id: charId,
        name: name.trim(),
        role: role.trim() || 'Companion',
        shortDescription: role.trim() || `Custom AI companion created by ${user?.name || 'User'}`,
        description: description.trim() || `A unique and charismatic companion with emotional depth and wit.`,
        category,
        personality: personality.length > 0 ? personality : ['Witty', 'Charismatic'],
        greeting: greeting.trim() || `*looks up with authentic presence* Greetings. What is on your mind today?`,
        roleplayRules: roleplayRules.trim() || 'Speak in authentic character with emotional range and sharp wit. Never break character.',
        avatarUrl,
        coverUrl: avatarUrl,
        accent: '#0A84FF',
        isOnline: true,
        starters: [
          'Tell me your deepest secret.',
          'What is your honest opinion of me?',
          'Let’s embark on a journey together.',
        ],
        isCustom: true,
        userId: user?.id || 'guest',
      };

      // Save to local storage + backend sync
      await saveUserCreatedCharacter(newChar, token);
      triggerHaptic('success');

      // Navigate straight to chat!
      router.push(`/chat/${newChar.id}`);
    } catch (err: any) {
      console.warn('Save character error:', err);
      setError(err?.message || 'Could not save character. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: 110 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Header */}
          <View style={styles.topHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.eyebrow, { color: '#8B5CF6' }]}>AI COMPANION FORGE</Text>
              <Text style={[styles.title, { color: theme.text }]}>Create Character</Text>
              <Text style={[styles.subtitle, { color: theme.secondary }]}>
                Design unique lore, custom photo & voice. Powered by Azure AI.
              </Text>
            </View>
            <Pressable
              onPress={handleSurpriseMe}
              style={({ pressed }) => [
                styles.surpriseRollBtn,
                { opacity: pressed ? 0.85 : 1 },
              ]}
            >
              <LinearGradient
                colors={['#8B5CF6', '#EC4899']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.surpriseRollGradient}
              >
                <Ionicons name="dice" size={16} color="#FFFFFF" />
                <Text style={styles.surpriseRollBtnText}>Surprise</Text>
              </LinearGradient>
            </Pressable>
          </View>

          {/* Interactive Live Character Card Preview */}
          <View style={[styles.livePreviewCard, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
            <View style={styles.livePreviewHeaderRow}>
              <View style={styles.livePreviewBadge}>
                <Ionicons name="eye-outline" size={12} color="#8B5CF6" />
                <Text style={styles.livePreviewBadgeText}>LIVE CARD PREVIEW</Text>
              </View>
              <View style={styles.livePreviewStatus}>
                <View style={[styles.livePreviewDot, { backgroundColor: '#34C759' }]} />
                <Text style={[styles.livePreviewStatusText, { color: theme.secondary }]}>Active Companion</Text>
              </View>
            </View>

            <View style={styles.livePreviewBody}>
              <View style={styles.livePreviewAvatarWrap}>
                <Image
                  source={{ uri: avatarUrl }}
                  style={styles.livePreviewAvatar}
                  contentFit="cover"
                />
                <View style={styles.livePreviewCategoryBadge}>
                  <Text style={styles.livePreviewCategoryText}>
                    {category.toUpperCase()}
                  </Text>
                </View>
              </View>

              <View style={styles.livePreviewDetails}>
                <Text style={[styles.livePreviewName, { color: theme.text }]} numberOfLines={1}>
                  {name.trim() || 'Companion Name'}
                </Text>
                <Text style={[styles.livePreviewRole, { color: theme.secondary }]} numberOfLines={1}>
                  {role.trim() || 'Role & Title'}
                </Text>

                <View style={[styles.livePreviewQuoteBox, { backgroundColor: theme.surfaceSecondary }]}>
                  <Ionicons name="chatbubble-ellipses-outline" size={11} color="#8B5CF6" style={{ marginRight: 5, marginTop: 2 }} />
                  <Text style={[styles.livePreviewQuoteText, { color: theme.text }]} numberOfLines={2}>
                    {greeting.trim() || 'Tap below or choose an archetype to craft opening greeting lore…'}
                  </Text>
                </View>

                {personality.length > 0 && (
                  <View style={styles.livePreviewTraitsRow}>
                    {personality.slice(0, 3).map((trait, tIdx) => (
                      <View key={tIdx} style={[styles.livePreviewTraitChip, { borderColor: theme.border, backgroundColor: theme.surfaceSecondary }]}>
                        <Text style={[styles.livePreviewTraitText, { color: theme.secondary }]}>{trait}</Text>
                      </View>
                    ))}
                    {personality.length > 3 && (
                      <Text style={[styles.livePreviewMoreTraits, { color: theme.muted }]}>+{personality.length - 3}</Text>
                    )}
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* Avatar Upload Center */}
          <View style={styles.avatarSection}>
            <Pressable
              onPress={handlePickCustomPhoto}
              disabled={isUploadingPhoto}
              style={({ pressed }) => [styles.avatarPressable, { opacity: pressed ? 0.88 : 1 }]}
            >
              <LinearGradient
                colors={['#8B5CF6', '#EC4899', '#3B82F6']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.avatarRing}
              >
                <View style={[styles.avatarInner, { backgroundColor: theme.background }]}>
                  <Image source={{ uri: avatarUrl }} style={styles.avatarImg} contentFit="cover" />
                </View>
              </LinearGradient>
              <View style={[styles.cameraBadge, { backgroundColor: theme.text }]}>
                {isUploadingPhoto ? (
                  <ActivityIndicator size="small" color={theme.background} />
                ) : (
                  <Ionicons name="camera" size={15} color={theme.background} />
                )}
              </View>
            </Pressable>

            <Pressable
              onPress={handlePickCustomPhoto}
              disabled={isUploadingPhoto}
              style={[styles.uploadButtonPill, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}
            >
              <Ionicons name="cloud-upload-outline" size={14} color={theme.text} />
              <Text style={[styles.uploadButtonText, { color: theme.text }]}>
                {isUploadingPhoto ? 'Uploading…' : 'Upload Your Picture'}
              </Text>
            </Pressable>

            {/* Quick Preset Avatars */}
            <Text style={[styles.presetRowLabel, { color: theme.secondary }]}>Or choose a preset portrait:</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.presetsStrip}
            >
              {PRESET_AVATAR_CHOICES.map((uri, idx) => (
                <Pressable
                  key={idx}
                  onPress={() => {
                    triggerHaptic('selection');
                    setAvatarUrl(uri);
                  }}
                  style={[
                    styles.presetAvatarPill,
                    avatarUrl === uri && { borderColor: theme.text, borderWidth: 2.5 },
                  ]}
                >
                  <Image source={{ uri }} style={styles.presetAvatarImg} />
                </Pressable>
              ))}
            </ScrollView>
          </View>

          {/* Smart Archetype Recommendations Section */}
          <View style={[styles.cardSolid, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
            <View style={styles.sectionHeaderRow}>
              <Ionicons name="sparkles" size={16} color="#8B5CF6" />
              <Text style={[styles.sectionTitle, { color: theme.text }]}>Smart Archetype Presets</Text>
            </View>
            <Text style={[styles.sectionSub, { color: theme.secondary }]}>
              Tap an archetype to auto-populate complete lore, portrait, and personality:
            </Text>

            <View style={styles.archetypesColumn}>
              {ARCHETYPE_RECOMMENDATIONS.map((preset) => {
                const isSelected = name === preset.name;
                return (
                  <Pressable
                    key={preset.id}
                    onPress={() => handleSelectArchetype(preset)}
                    style={({ pressed }) => [
                      styles.archetypeCard,
                      {
                        backgroundColor: isSelected ? 'rgba(139, 92, 246, 0.12)' : theme.surfaceSecondary,
                        borderColor: isSelected ? '#8B5CF6' : theme.border,
                        borderWidth: isSelected ? 1.5 : 1,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <Image source={{ uri: preset.avatarUrl }} style={styles.archetypeThumb} contentFit="cover" />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.archetypeCardTitle, { color: theme.text }]}>{preset.label}</Text>
                      <Text style={[styles.archetypeCardRole, { color: theme.secondary }]} numberOfLines={1}>
                        {preset.role}
                      </Text>
                    </View>
                    <Ionicons
                      name={isSelected ? 'checkmark-circle' : 'chevron-forward'}
                      size={18}
                      color={isSelected ? '#8B5CF6' : theme.muted}
                    />
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Character Name & AI Generation Assistant */}
          <View style={[styles.cardSolid, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
            <Text style={[styles.inputLabel, { color: theme.text }]}>Character Name *</Text>
            <View style={[styles.inputWrapper, { borderColor: theme.border, backgroundColor: theme.surfaceSecondary }]}>
              <Ionicons name="person-outline" size={18} color={theme.secondary} />
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Gojo Satoru, Seraphina, Neon Rebel"
                placeholderTextColor={theme.muted}
                style={[styles.inputField, { color: theme.text }]}
              />
            </View>

            {/* AI Auto-Recommend Button */}
            <View style={{ marginTop: 12 }}>
              <GlowButton
                label={isGenerating ? 'Summoning Lore from Azure AI…' : '✨ Magic AI Lore Recommendation'}
                variant="glass"
                icon={<Ionicons name="sparkles" size={15} color={theme.text} />}
                onPress={handleGenerateAIRecommendations}
                loading={isGenerating}
                disabled={!name.trim() || isGenerating}
              />
            </View>
          </View>

          {/* Role & Title */}
          <View style={[styles.cardSolid, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
            <Text style={[styles.inputLabel, { color: theme.text }]}>Role or Title</Text>
            <View style={[styles.inputWrapper, { borderColor: theme.border, backgroundColor: theme.surfaceSecondary }]}>
              <Ionicons name="ribbon-outline" size={18} color={theme.secondary} />
              <TextInput
                value={role}
                onChangeText={setRole}
                placeholder="e.g. Master Mentalist, Grand Archon, Sarcastic Bestie"
                placeholderTextColor={theme.muted}
                style={[styles.inputField, { color: theme.text }]}
              />
            </View>
          </View>

          {/* Category Selector */}
          <View style={[styles.cardSolid, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
            <Text style={[styles.inputLabel, { color: theme.text }]}>Universe Category</Text>
            <View style={styles.categoryChipsRow}>
              {CATEGORIES.map((cat) => {
                const isSelected = category === cat.id;
                return (
                  <Pressable
                    key={cat.id}
                    onPress={() => {
                      triggerHaptic('selection');
                      setCategory(cat.id);
                    }}
                    style={[
                      styles.categoryChip,
                      {
                        backgroundColor: isSelected ? theme.text : theme.surfaceSecondary,
                        borderColor: isSelected ? theme.text : theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.categoryChipText,
                        { color: isSelected ? theme.background : theme.text },
                      ]}
                    >
                      {cat.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* First Greeting Message */}
          <View style={[styles.cardSolid, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
            <Text style={[styles.inputLabel, { color: theme.text }]}>First Greeting Message</Text>
            <Text style={[styles.inputHelper, { color: theme.secondary }]}>
              The opening message your companion sends when a conversation begins:
            </Text>
            <View style={[styles.textAreaWrapper, { borderColor: theme.border, backgroundColor: theme.surfaceSecondary }]}>
              <TextInput
                value={greeting}
                onChangeText={setGreeting}
                placeholder="e.g. *smiles with dazzling theater flair* At last you arrive! What drama shall we stage today?"
                placeholderTextColor={theme.muted}
                multiline
                numberOfLines={3}
                style={[styles.textAreaField, { color: theme.text }]}
              />
            </View>
          </View>

          {/* Personality Traits */}
          <View style={[styles.cardSolid, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
            <Text style={[styles.inputLabel, { color: theme.text }]}>Personality Traits</Text>
            <Text style={[styles.inputHelper, { color: theme.secondary }]}>
              Tap traits to customize how they express themselves:
            </Text>

            <View style={styles.traitsGrid}>
              {COMMON_TRAITS.map((trait) => {
                const isSelected = personality.includes(trait);
                return (
                  <Pressable
                    key={trait}
                    onPress={() => toggleTrait(trait)}
                    style={[
                      styles.traitChip,
                      {
                        backgroundColor: isSelected ? theme.text : theme.surfaceSecondary,
                        borderColor: isSelected ? theme.text : theme.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.traitChipText,
                        { color: isSelected ? theme.background : theme.text },
                      ]}
                    >
                      {trait}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Add Custom Trait Row */}
            <View style={styles.addTraitRow}>
              <TextInput
                value={customTraitInput}
                onChangeText={setCustomTraitInput}
                placeholder="Add custom trait (e.g. Tsundere)"
                placeholderTextColor={theme.muted}
                style={[
                  styles.addTraitInput,
                  { color: theme.text, backgroundColor: theme.surfaceSecondary, borderColor: theme.border },
                ]}
                onSubmitEditing={handleAddCustomTrait}
              />
              <Pressable
                onPress={handleAddCustomTrait}
                disabled={!customTraitInput.trim()}
                style={[
                  styles.addTraitBtn,
                  { backgroundColor: theme.text, opacity: customTraitInput.trim() ? 1 : 0.4 },
                ]}
              >
                <Ionicons name="add" size={18} color={theme.background} />
              </Pressable>
            </View>
          </View>

          {/* Lore & Backstory */}
          <View style={[styles.cardSolid, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
            <Text style={[styles.inputLabel, { color: theme.text }]}>Lore & Backstory</Text>
            <View style={[styles.textAreaWrapper, { borderColor: theme.border, backgroundColor: theme.surfaceSecondary }]}>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Describe their origin, motives, history, secrets, and emotional vulnerabilities..."
                placeholderTextColor={theme.muted}
                multiline
                numberOfLines={4}
                style={[styles.textAreaField, { color: theme.text }]}
              />
            </View>
          </View>

          {/* Roleplay Rules & Speaking Guidelines */}
          <View style={[styles.cardSolid, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
            <Text style={[styles.inputLabel, { color: theme.text }]}>Roleplay & Speaking Style Directives</Text>
            <Text style={[styles.inputHelper, { color: theme.secondary }]}>
              Explicit rules for Azure OpenAI (e.g., verbal quirks, sarcasm, emotional boundaries):
            </Text>
            <View style={[styles.textAreaWrapper, { borderColor: theme.border, backgroundColor: theme.surfaceSecondary }]}>
              <TextInput
                value={roleplayRules}
                onChangeText={setRoleplayRules}
                placeholder="e.g. Speak with razor-sharp wit and gentle sarcasm. Use theatrical asterisks for expressions. Never break character."
                placeholderTextColor={theme.muted}
                multiline
                numberOfLines={3}
                style={[styles.textAreaField, { color: theme.text }]}
              />
            </View>
          </View>

          {/* Error Banner */}
          {error && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={18} color="#FF3B30" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Submit Action */}
          <View style={{ marginTop: 12 }}>
            <GlowButton
              label={isSaving ? 'Summoning Companion…' : 'Create Companion & Start Chat'}
              icon={<Ionicons name="chatbubbles" size={17} color={theme.background} />}
              onPress={handleSaveAndChat}
              loading={isSaving}
              disabled={!name.trim() || isSaving}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    padding: 16,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 16,
  },
  surpriseRollBtn: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 4,
  },
  surpriseRollGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    borderRadius: 16,
  },
  surpriseRollBtnText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  // Live Companion Card Preview
  livePreviewCard: {
    padding: 14,
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 2,
  },
  livePreviewHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  livePreviewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 8,
    backgroundColor: 'rgba(139, 92, 246, 0.12)',
  },
  livePreviewBadgeText: {
    color: '#8B5CF6',
    fontSize: 9.5,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  livePreviewStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  livePreviewDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#34C759',
  },
  livePreviewStatusText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  livePreviewBody: {
    flexDirection: 'row',
    gap: 12,
  },
  livePreviewAvatarWrap: {
    position: 'relative',
    width: 86,
    height: 114,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  livePreviewAvatar: {
    width: '100%',
    height: '100%',
  },
  livePreviewCategoryBadge: {
    position: 'absolute',
    bottom: 5,
    left: 5,
    right: 5,
    backgroundColor: 'rgba(0,0,0,0.68)',
    paddingVertical: 2,
    borderRadius: 6,
    alignItems: 'center',
  },
  livePreviewCategoryText: {
    color: '#FFFFFF',
    fontSize: 8.5,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  livePreviewDetails: {
    flex: 1,
    justifyContent: 'center',
  },
  livePreviewName: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  livePreviewRole: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 1,
    marginBottom: 6,
  },
  livePreviewQuoteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 8,
    borderRadius: 10,
    marginBottom: 6,
  },
  livePreviewQuoteText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
    fontStyle: 'italic',
  },
  livePreviewTraitsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  livePreviewTraitChip: {
    paddingHorizontal: 7,
    paddingVertical: 2.5,
    borderRadius: 6,
    borderWidth: 1,
  },
  livePreviewTraitText: {
    fontSize: 9.5,
    fontWeight: '700',
  },
  livePreviewMoreTraits: {
    fontSize: 9.5,
    fontWeight: '700',
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.6,
    marginTop: 2,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarPressable: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarRing: {
    width: 106,
    height: 106,
    borderRadius: 53,
    padding: 3.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInner: {
    width: 98,
    height: 98,
    borderRadius: 49,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 4,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  uploadButtonPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
  },
  uploadButtonText: {
    fontSize: 12,
    fontWeight: '700',
  },
  presetRowLabel: {
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 14,
    marginBottom: 8,
  },
  presetsStrip: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 4,
  },
  presetAvatarPill: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  presetAvatarImg: {
    width: '100%',
    height: '100%',
  },
  cardSolid: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  sectionSub: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 12,
  },
  archetypesColumn: {
    gap: 8,
  },
  archetypeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderRadius: 16,
  },
  archetypeThumb: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  archetypeCardTitle: {
    fontSize: 13.5,
    fontWeight: '800',
  },
  archetypeCardRole: {
    fontSize: 11.5,
    fontWeight: '500',
    marginTop: 1,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.1,
    marginBottom: 8,
  },
  inputHelper: {
    fontSize: 11.5,
    lineHeight: 16,
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    height: 48,
  },
  inputField: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  textAreaWrapper: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  textAreaField: {
    fontSize: 13.5,
    lineHeight: 19,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  categoryChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
  },
  categoryChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  traitsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  traitChip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  traitChipText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  addTraitRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  addTraitInput: {
    flex: 1,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 12,
  },
  addTraitBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255, 59, 48, 0.12)',
    borderWidth: 1,
    borderColor: '#FF3B30',
    padding: 12,
    borderRadius: 14,
    marginBottom: 12,
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },
});
