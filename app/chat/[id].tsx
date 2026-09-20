import React, { useMemo, useState, useEffect, useRef } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  FlatList,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Alert,
  Switch,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { useTheme } from '@/src/context/ThemeContext';
import { useAuth } from '@/src/context/AuthContext';
import { getCharacter, characters } from '@/src/data/characters';
import { Character } from '@/src/types/character';
import { DynamicCharacterImage } from '@/src/lib/dynamicImageService';
import {
  createConversation,
  getConversationMessages,
  requestCharacterReply,
  editMessageAndRegenerate,
  fetchCharacters,
  fetchCharacterById,
  clearConversationMessages,
  deleteCharacterProfile,
  StoredMessage,
} from '@/src/lib/chatApi';
import { LiquidGlassView } from '@/src/components/LiquidGlassView';
import { VoiceWaveformBar } from '@/src/components/VoiceWaveformBar';
import { VoiceMessageBubble } from '@/src/components/VoiceMessageBubble';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { triggerHaptic } from '@/src/lib/haptics';
import {
  isFavorite,
  toggleFavorite,
  isCharHiddenFromRecent,
  toggleHideFromRecent,
  subscribeToFavorites,
} from '@/src/lib/favorites';

interface SpeechPreset {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
  promptDirective: string;
}

const SPEECH_PRESETS: SpeechPreset[] = [
  {
    id: 'sarcastic',
    label: 'Witty & Sarcastic',
    icon: 'flash',
    description: 'Brimming with razor-sharp wit, playful eye-rolling, clever sarcastic banter, and dry humor.',
    promptDirective: 'Speak with razor-sharp wit, cheeky sarcastic banter, humorous teasing, and clever comebacks while remaining charismatic and engaged.',
  },
  {
    id: 'battle',
    label: 'Fierce & Warrior',
    icon: 'shield',
    description: 'Speaks with warrior intensity, tactical brevity, battlefield pride, and protective resolve.',
    promptDirective: 'Speak with intense warrior grit, direct commanding brevity, battlefield focus, and tactical instincts.',
  },
  {
    id: 'poetic',
    label: 'Poetic & Cryptic',
    icon: 'moon',
    description: 'Speaks in enigmatic metaphors, atmospheric riddles, deep literary cadence, and thoughtful pauses.',
    promptDirective: 'Speak in profound poetic cadence, evocative metaphors, enigmatic wisdom, and atmospheric pauses.',
  },
  {
    id: 'warm',
    label: 'Gentle & Warm',
    icon: 'heart',
    description: 'Deep tenderness, comforting empathy, sweet gentle teasing, and genuine emotional warmth.',
    promptDirective: 'Speak with deep tenderness, reassuring emotional warmth, gentle listening, and genuine affectionate care.',
  },
  {
    id: 'formal',
    label: 'Formal & Aristocratic',
    icon: 'ribbon',
    description: 'Impeccable high-society etiquette, eloquent vocabulary, aristocratic posture, and refined elegance.',
    promptDirective: 'Speak with impeccable aristocratic dignity, eloquent refined vocabulary, courtly etiquette, and poised restraint.',
  },
  {
    id: 'playful',
    label: 'Playful & Mischievous',
    icon: 'happy',
    description: 'High energy, cheerful banter, teasing nicknames, and enthusiastic curiosity.',
    promptDirective: 'Speak with high playful energy, cheerful teasing, spontaneous laughs, and vibrant curiosity.',
  },
];

interface Message {
  id: string;
  role: 'user' | 'character';
  content: string;
  photo?: string | null;
  audioUri?: string | null;
}

interface MessageRowProps {
  item: Message;
  avatarUri: string;
  bubbleUserColor: string;
  bubbleUserTextColor: string;
  bubbleAiColor: string;
  bubbleAiTextColor: string;
  borderColor: string;
  onLongPress: (message: Message) => void;
}

const MessageRow = React.memo(function MessageRow({
  item,
  avatarUri,
  bubbleUserColor,
  bubbleUserTextColor,
  bubbleAiColor,
  bubbleAiTextColor,
  borderColor,
  onLongPress,
}: MessageRowProps) {
  const isUser = item.role === 'user';
  return (
    <View style={[styles.bubbleWrapper, isUser ? styles.userBubbleWrap : styles.characterBubbleWrap]}>
      {!isUser && <Image source={{ uri: avatarUri }} style={styles.bubbleMiniAvatar} />}
      <Pressable
        onLongPress={() => onLongPress(item)}
        delayLongPress={350}
        style={[
          styles.bubble,
          isUser
            ? [styles.userBubble, { backgroundColor: bubbleUserColor }]
            : [styles.characterBubble, { backgroundColor: bubbleAiColor, borderColor }],
        ]}
      >
        {item.photo && <Image source={{ uri: item.photo }} style={styles.bubblePhoto} />}
        {item.content.includes('Voice message') || item.content.startsWith('🎤') ? (
          <VoiceMessageBubble content={item.content} isUser={isUser} audioUri={item.audioUri} />
        ) : (
          <Text style={[styles.bubbleText, { color: isUser ? bubbleUserTextColor : bubbleAiTextColor }]}>
            {item.content}
          </Text>
        )}
      </Pressable>
    </View>
  );
});

const DEVICE_STORAGE_KEY = 'guildtalk_device_id';

async function getDeviceId(): Promise<string> {
  if (Platform.OS === 'web') {
    let id = globalThis.localStorage?.getItem(DEVICE_STORAGE_KEY);
    if (!id) {
      id = `web-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      globalThis.localStorage?.setItem(DEVICE_STORAGE_KEY, id);
    }
    return id;
  }
  let id = await SecureStore.getItemAsync(DEVICE_STORAGE_KEY);
  if (!id) {
    id = `device-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    await SecureStore.setItemAsync(DEVICE_STORAGE_KEY, id);
  }
  return id;
}

const AVAILABLE_MODELS = [
  { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', label: 'Deep RP & Planner' },
  { id: 'gpt-4o', name: 'GPT-4o', label: 'Omni & Vision' },
  { id: 'gpt-5.1-chat', name: 'GPT-5.1 Chat', label: 'Fast Responsive' },
];

export default function ChatScreen() {
  const router = useRouter();
  const { id, prompt } = useLocalSearchParams<{ id: string; prompt?: string }>();
  const { theme, isDark, toggleTheme } = useTheme();
  const { user, token } = useAuth();

  const [character, setCharacter] = useState<Character | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [attachedPhoto, setAttachedPhoto] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('gpt-5.6-luna');
  const [showModelMenu, setShowModelMenu] = useState<boolean>(false);

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<string>('');
  const [isRegenerating, setIsRegenerating] = useState<boolean>(false);

  // Long press context menu
  const [contextMenu, setContextMenu] = useState<{ visible: boolean; message: Message | null }>({
    visible: false,
    message: null,
  });

  // Voice recording state & controls
  const [isRecording, setIsRecording] = useState(false);
  const [isVoicePaused, setIsVoicePaused] = useState(false);
  const [voiceDuration, setVoiceDuration] = useState(0);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const speechRecognitionRef = useRef<any>(null);
  const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);

  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // Full-screen profile menu & settings state
  const [isFav, setIsFav] = useState<boolean>(false);
  const [isHiddenFromRecent, setIsHiddenFromRecent] = useState<boolean>(false);
  const [showFullProfileMenu, setShowFullProfileMenu] = useState<boolean>(false);
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);

  // Speaking style customization state
  const [speakingStyle, setSpeakingStyle] = useState<string>('');
  const [selectedSpeechPresetId, setSelectedSpeechPresetId] = useState<string | null>(null);
  const [customSpeechText, setCustomSpeechText] = useState<string>('');
  const [isSpeechSavedBanner, setIsSpeechSavedBanner] = useState<boolean>(false);

  useEffect(() => {
    async function loadSpeakingStyle() {
      if (!character?.id) return;
      try {
        const key = `guildtalk_speech_style_${user?.id || 'guest'}_${character.id}`;
        let saved: string | null = null;
        if (Platform.OS === 'web') {
          saved = globalThis.localStorage?.getItem(key) || null;
        } else {
          saved = await SecureStore.getItemAsync(key);
        }
        if (saved) {
          setSpeakingStyle(saved);
          setCustomSpeechText(saved);
          const matched = SPEECH_PRESETS.find((p) => p.promptDirective === saved);
          if (matched) {
            setSelectedSpeechPresetId(matched.id);
          } else {
            setSelectedSpeechPresetId('custom');
          }
        } else {
          setSpeakingStyle('');
          setCustomSpeechText('');
          setSelectedSpeechPresetId(null);
        }
      } catch (e) {
        console.log('Error loading speaking style:', e);
      }
    }
    loadSpeakingStyle();
  }, [character?.id, user?.id]);

  const handleSelectSpeechPreset = async (preset: SpeechPreset) => {
    triggerHaptic('selection');
    setSelectedSpeechPresetId(preset.id);
    setCustomSpeechText(preset.promptDirective);
    setSpeakingStyle(preset.promptDirective);
    try {
      const key = `guildtalk_speech_style_${user?.id || 'guest'}_${character?.id}`;
      if (Platform.OS === 'web') {
        globalThis.localStorage?.setItem(key, preset.promptDirective);
      } else {
        await SecureStore.setItemAsync(key, preset.promptDirective);
      }
      setIsSpeechSavedBanner(true);
      setTimeout(() => setIsSpeechSavedBanner(false), 2500);
    } catch (e) {
      console.log('Error saving speech preset:', e);
    }
  };

  const handleSaveCustomSpeech = async () => {
    triggerHaptic('success');
    const textToSave = customSpeechText.trim();
    setSpeakingStyle(textToSave);
    if (!textToSave) {
      setSelectedSpeechPresetId(null);
    } else {
      const matched = SPEECH_PRESETS.find((p) => p.promptDirective === textToSave);
      setSelectedSpeechPresetId(matched ? matched.id : 'custom');
    }
    try {
      const key = `guildtalk_speech_style_${user?.id || 'guest'}_${character?.id}`;
      if (Platform.OS === 'web') {
        if (textToSave) {
          globalThis.localStorage?.setItem(key, textToSave);
        } else {
          globalThis.localStorage?.removeItem(key);
        }
      } else {
        if (textToSave) {
          await SecureStore.setItemAsync(key, textToSave);
        } else {
          await SecureStore.deleteItemAsync(key);
        }
      }
      setIsSpeechSavedBanner(true);
      setTimeout(() => setIsSpeechSavedBanner(false), 2500);
    } catch (e) {
      console.log('Error saving custom speech style:', e);
    }
  };

  useEffect(() => {
    if (!character?.id) return;
    const uid = user?.id;
    isFavorite(character.id, uid).then(setIsFav);
    isCharHiddenFromRecent(character.id, uid).then(setIsHiddenFromRecent);
    const unsub = subscribeToFavorites(() => {
      isFavorite(character.id, uid).then(setIsFav);
      isCharHiddenFromRecent(character.id, uid).then(setIsHiddenFromRecent);
    });
    return unsub;
  }, [character?.id, user?.id]);

  const handleToggleFavorite = async () => {
    if (!character) return;
    triggerHaptic('medium');
    const newState = await toggleFavorite(character.id, user?.id);
    setIsFav(newState);
  };

  const handleToggleHideRecent = async () => {
    if (!character) return;
    triggerHaptic('medium');
    const newState = await toggleHideFromRecent(character.id, user?.id);
    setIsHiddenFromRecent(newState);
  };

  const handleClearHistory = async () => {
    if (!character) return;
    triggerHaptic('warning');
    Alert.alert(
      'Clear Chat History?',
      `Are you sure you want to erase all messages with ${character.name}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All',
          style: 'destructive',
          onPress: async () => {
            triggerHaptic('heavy');
            setIsActionLoading(true);
            try {
              if (conversationId) {
                await clearConversationMessages(conversationId, token);
              }
              setMessages([]);
              setShowFullProfileMenu(false);
            } catch (err) {
              console.warn('Failed to clear conversation:', err);
            } finally {
              setIsActionLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteProfile = async () => {
    if (!character) return;
    triggerHaptic('heavy');
    Alert.alert(
      'Delete Complete Profile?',
      `Are you sure you want to permanently delete ${character.name} and all chat records?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Forever',
          style: 'destructive',
          onPress: async () => {
            triggerHaptic('heavy');
            setIsActionLoading(true);
            try {
              if (conversationId) {
                await clearConversationMessages(conversationId, token);
              }
              await deleteCharacterProfile(character.id, token);
              setShowFullProfileMenu(false);
              router.replace('/(tabs)/chats');
            } catch (err) {
              console.warn('Failed to delete character profile:', err);
            } finally {
              setIsActionLoading(false);
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, () => {
      setKeyboardVisible(true);
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      }, 60);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardVisible(false);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Voice recording timer
  useEffect(() => {
    if (isRecording && !isVoicePaused) {
      recordingTimerRef.current = setInterval(() => {
        setVoiceDuration((prev) => prev + 1);
      }, 1000);
    } else {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    }
    return () => {
      if (recordingTimerRef.current) {
        clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
    };
  }, [isRecording, isVoicePaused]);

  const flatListRef = useRef<FlatList>(null);

  // 1. Resolve character (either built-in, runtime registered, or custom from DB)
  useEffect(() => {
    async function resolve() {
      const local = getCharacter(id || '');
      if (local) {
        setCharacter(local);
        return;
      }
      try {
        const direct = await fetchCharacterById(id || '', token);
        if (direct) {
          setCharacter(direct);
          return;
        }
        const customChars = await fetchCharacters(user?.id, token);
        const match = customChars.find((c: any) => c.id === id || c.mongoId === id || c._id === id);
        if (match) setCharacter(match);
      } catch {
        // Not found
      }
    }
    resolve();
  }, [id, user, token]);

  // 2. Initialize Conversation & Load History from MongoDB
  useEffect(() => {
    if (!character) return;
    const targetChar: Character = character;

    async function initConversation(char: Character) {
      try {
        const deviceId = await getDeviceId();
        const activeUserId = user?.id || deviceId;

        // Try to create or find active conversation
        const convId = await createConversation(activeUserId, char, token);
        setConversationId(convId);

        // Fetch existing history from MongoDB
        const history: StoredMessage[] = await getConversationMessages(convId, activeUserId, token);
        if (history && history.length > 0) {
          setMessages(
            history.map((m) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              photo: m.photo,
            }))
          );
        } else {
          // New conversation: set greeting and optional prompt
          const initialList: Message[] = [
            {
              id: 'greeting',
              role: 'character',
              content: char.greeting || 'Greetings, traveler.',
            },
          ];
          if (prompt) {
            initialList.push({
              id: 'prompt',
              role: 'user',
              content: prompt,
            });
          }
          setMessages(initialList);

          // If prompt was passed, auto-trigger first response
          if (prompt) {
            send(prompt, null, convId, initialList);
          }
        }
      } catch (err) {
        console.log('Using local conversation mode:', err);
        // Fallback local initial state
        setMessages([
          {
            id: 'greeting',
            role: 'character',
            content: char.greeting || 'Greetings, traveler.',
          },
        ]);
      }
    }
    initConversation(targetChar);
  }, [character]);

  const suggestions = useMemo(() => character?.starters.slice(0, 3) ?? [], [character]);

  // Photo Picker
  const pickPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [4, 3],
        quality: 0.6,
        base64: true,
      });

      if (!result.canceled && result.assets[0]?.base64) {
        const mimeType = result.assets[0].mimeType || 'image/jpeg';
        const dataUri = `data:${mimeType};base64,${result.assets[0].base64}`;
        setAttachedPhoto(dataUri);
      }
    } catch (err) {
      console.error('Image picker error:', err);
    }
  };

  const send = async (
    textToSend: string,
    photoToSend: string | null = attachedPhoto,
    activeConvId: string | null = conversationId,
    currentHistory: Message[] = messages,
    audioUriToSend?: string | null
  ) => {
    const trimmed = textToSend.trim();
    if ((!trimmed && !photoToSend && !audioUriToSend) || isSending || !character) return;

    setError(null);
    setInput('');
    setAttachedPhoto(null);

    const userMessage: Message = {
      id: `${Date.now()}-user`,
      role: 'user',
      content: trimmed || (photoToSend ? 'Look at this photo I sent you.' : '🎤 Voice message'),
      photo: photoToSend,
      audioUri: audioUriToSend || null,
    };

    const newHistory = [...currentHistory, userMessage];
    setMessages(newHistory);
    setIsSending(true);

    try {
      const deviceId = await getDeviceId();
      const activeUserId = user?.id || deviceId;
      const convId = activeConvId || (await createConversation(activeUserId, character, token));
      if (!conversationId) setConversationId(convId);

      const reply = await requestCharacterReply({
        character,
        conversationId: convId,
        userId: activeUserId,
        messages: newHistory.map(({ role, content, photo }) => ({ role, content, photo })),
        photo: photoToSend,
        model: selectedModel,
        token,
        userName: user?.name,
        userAge: user?.age,
        userLanguage: user?.language,
        speakingStyle: speakingStyle || undefined,
      });

      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-reply`,
          role: 'character',
          content: reply.content,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach the character service.');
    } finally {
      setIsSending(false);
    }
  };

  const startEditing = (msg: Message) => {
    if (msg.role !== 'user') return;
    setEditingMessageId(msg.id);
    setEditContent(msg.content);
  };

  const cancelEditing = () => {
    setEditingMessageId(null);
    setEditContent('');
  };

  const submitEdit = async () => {
    if (!editingMessageId || !conversationId || !editContent.trim()) return;
    setIsRegenerating(true);
    setError(null);
    try {
      const result = await editMessageAndRegenerate({
        conversationId,
        messageId: editingMessageId,
        newContent: editContent.trim(),
        token,
        model: selectedModel,
        userName: user?.name,
        userAge: user?.age,
        userLanguage: user?.language,
      });

      if (result && Array.isArray(result.messages)) {
        setMessages(
          result.messages.map((m) => ({
            id: m.id || `${Date.now()}-${Math.random()}`,
            role: m.role,
            content: m.content,
            photo: m.photo,
          }))
        );
      }
      setEditingMessageId(null);
      setEditContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update message.');
    } finally {
      setIsRegenerating(false);
    }
  };

  const deleteMessage = (msgId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== msgId));
    setContextMenu({ visible: false, message: null });
    triggerHaptic('warning');
  };

  const openContextMenu = (msg: Message) => {
    if (msg.role !== 'user') return;
    triggerHaptic('medium');
    setContextMenu({ visible: true, message: msg });
  };

  const closeContextMenu = () => setContextMenu({ visible: false, message: null });

  const handleMessageLongPress = React.useCallback((message: Message) => {
    openContextMenu(message);
  }, []);

  // Voice input handling: Web Speech API on Web & responsive audio session with equalizer
  const startVoiceInput = async () => {
    triggerHaptic('medium');

    if (Platform.OS !== 'web') {
      try {
        const { granted } = await requestRecordingPermissionsAsync();
        if (!granted) {
          setError('Microphone permission is required to record voice.');
          return;
        }
      } catch (err) {
        console.log('Permission request error:', err);
      }
    }

    setIsRecording(true);
    setIsVoicePaused(false);
    setVoiceDuration(0);
    setVoiceTranscript('');

    if (Platform.OS === 'web' && (('webkitSpeechRecognition' in window) || ('SpeechRecognition' in (window as any)))) {
      try {
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = user?.language || 'en-US';

        recognition.onresult = (event: any) => {
          let fullText = '';
          for (let i = 0; i < event.results.length; i++) {
            fullText += event.results[i][0].transcript + ' ';
          }
          setVoiceTranscript(fullText.trim());
        };

        recognition.onerror = (err: any) => {
          console.log('Speech recognition error:', err);
        };

        recognition.start();
        speechRecognitionRef.current = recognition;
      } catch (e) {
        console.log('Web speech init error:', e);
      }
    }
  };

  const toggleVoicePause = () => {
    if (isVoicePaused) {
      // Resume recording
      setIsVoicePaused(false);
      if (Platform.OS === 'web' && speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.start();
        } catch {
          // Already active
        }
      }
    } else {
      // Pause recording
      setIsVoicePaused(true);
      if (Platform.OS === 'web' && speechRecognitionRef.current) {
        try {
          speechRecognitionRef.current.stop();
        } catch {}
      }
    }
  };

  const cancelVoiceRecording = () => {
    setIsRecording(false);
    setIsVoicePaused(false);
    setVoiceDuration(0);
    setVoiceTranscript('');
    if (Platform.OS === 'web' && speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.abort();
      } catch {}
      speechRecognitionRef.current = null;
    }
  };

  const sendVoiceRecording = (recordedUri?: string | null) => {
    if (Platform.OS === 'web' && speechRecognitionRef.current) {
      try {
        speechRecognitionRef.current.stop();
      } catch {}
      speechRecognitionRef.current = null;
    }

    const durationSec = voiceDuration;
    const capturedText = voiceTranscript.trim();

    setIsRecording(false);
    setIsVoicePaused(false);
    setVoiceDuration(0);
    setVoiceTranscript('');

    if (capturedText) {
      send(capturedText, null, conversationId, messages, recordedUri);
    } else {
      // Voice message note representation
      const m = Math.floor(durationSec / 60);
      const s = (durationSec % 60).toString().padStart(2, '0');
      const voiceLabel = `🎤 Voice message (${m}:${s})`;
      send(voiceLabel, null, conversationId, messages, recordedUri);
    }
  };

  if (!character) {
    return (
      <SafeAreaView style={[styles.center, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.text} />
        <Text style={[styles.loadingText, { color: theme.secondary }]}>Connecting with companion…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        {/* iOS Liquid Glass Header */}
        <LiquidGlassView style={styles.header} borderRadius={0} intensity={35}>
          <Pressable
            hitSlop={12}
            onPress={() => {
              triggerHaptic('light');
              router.back();
            }}
            style={[styles.headerBtn, { backgroundColor: theme.surfaceSecondary }]}
          >
            <Ionicons name="chevron-back" size={20} color={theme.text} />
          </Pressable>

          {/* Tappable Character Profile - opens full screen menu */}
          <Pressable
            onPress={() => {
              triggerHaptic('medium');
              setShowFullProfileMenu(true);
            }}
            style={styles.headerProfilePressable}
          >
            <View style={styles.headerAvatarWrap}>
              <DynamicCharacterImage character={character} style={styles.headerAvatar} />
              <View style={[styles.headerOnlineDot, { backgroundColor: '#34C759' }]} />
            </View>

            <View style={styles.headerInfo}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={[styles.headerName, { color: theme.text }]} numberOfLines={1}>
                  {character.name}
                </Text>
                <Ionicons name="chevron-down" size={11} color={theme.secondary} />
              </View>
              <Text style={[styles.headerSeries, { color: theme.secondary }]} numberOfLines={1}>
                {character.series || character.role}
              </Text>
            </View>
          </Pressable>

          <View style={styles.headerRightActions}>
            {/* Dedicated Heart Button */}
            <Pressable
              hitSlop={8}
              onPress={handleToggleFavorite}
              accessibilityLabel={isFav ? 'Remove from favorites' : 'Add to favorites'}
              style={[
                styles.headerBtn,
                { backgroundColor: theme.surfaceSecondary },
                isFav && { backgroundColor: 'rgba(255, 59, 48, 0.15)' },
              ]}
            >
              <Ionicons
                name={isFav ? 'heart' : 'heart-outline'}
                size={19}
                color={isFav ? '#FF3B30' : theme.text}
              />
            </Pressable>

            {/* Model Switcher Pill */}
            <Pressable
              onPress={() => {
                triggerHaptic('selection');
                setShowModelMenu(!showModelMenu);
              }}
              style={[styles.modelPill, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}
            >
              <Ionicons name="flash" size={11} color={theme.text} />
              <Text style={[styles.modelPillText, { color: theme.text }]}>
                {selectedModel === 'gpt-5.6-luna' ? 'Luna' : selectedModel === 'gpt-4o' ? '4o' : '5.1'}
              </Text>
              <Ionicons name="chevron-down" size={9} color={theme.secondary} />
            </Pressable>

            {/* Ellipsis button to open full profile menu */}
            <Pressable
              hitSlop={8}
              onPress={() => {
                triggerHaptic('medium');
                setShowFullProfileMenu(true);
              }}
              style={[styles.headerBtn, { backgroundColor: theme.surfaceSecondary }]}
            >
              <Ionicons name="ellipsis-horizontal" size={18} color={theme.text} />
            </Pressable>
          </View>
        </LiquidGlassView>

        {/* ============================================================ */}
        {/* FULL SCREEN PROFILE & CHAT SETTINGS MODAL                   */}
        {/* ============================================================ */}
        <Modal
          visible={showFullProfileMenu}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={() => setShowFullProfileMenu(false)}
        >
          <View style={[styles.modalScreen, { backgroundColor: theme.background }]}>
            <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
              {/* Modal Top Bar */}
              <View style={styles.modalTopBar}>
                <Pressable
                  hitSlop={12}
                  onPress={() => {
                    triggerHaptic('light');
                    setShowFullProfileMenu(false);
                  }}
                  style={[styles.modalCloseBtn, { backgroundColor: theme.surfaceSecondary }]}
                >
                  <Ionicons name="close" size={20} color={theme.text} />
                </Pressable>
                <Text style={[styles.modalTopTitle, { color: theme.text }]}>Companion Profile</Text>
                <Pressable
                  hitSlop={12}
                  onPress={handleToggleFavorite}
                  style={[
                    styles.modalCloseBtn,
                    { backgroundColor: theme.surfaceSecondary },
                    isFav && { backgroundColor: 'rgba(255, 59, 48, 0.15)' },
                  ]}
                >
                  <Ionicons
                    name={isFav ? 'heart' : 'heart-outline'}
                    size={20}
                    color={isFav ? '#FF3B30' : theme.text}
                  />
                </Pressable>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.modalScrollContent}
              >
                {/* Character Hero Card with Face Top Preservation */}
                <View style={styles.modalHeroCard}>
                  <DynamicCharacterImage
                    character={character}
                    preferCover
                    style={styles.modalHeroImage}
                    contentFit="cover"
                    contentPosition="top"
                    transition={200}
                  />
                  <LinearGradient
                    colors={['transparent', isDark ? 'rgba(10,8,20,0.82)' : 'rgba(255,255,255,0.85)', isDark ? 'rgba(10,8,20,0.98)' : 'rgba(255,255,255,0.98)']}
                    style={styles.modalHeroGradient}
                  />
                  <View style={styles.modalHeroInfo}>
                    <View style={styles.modalHeroAvatarWrap}>
                      <DynamicCharacterImage
                        character={character}
                        style={styles.modalHeroAvatar}
                        contentFit="cover"
                        contentPosition="top"
                        transition={200}
                      />
                      <View style={[styles.modalOnlineDot, { backgroundColor: '#34C759' }]} />
                    </View>
                    <Text style={[styles.modalCharName, { color: theme.text }]}>{character.name}</Text>
                    <Text style={[styles.modalCharRole, { color: theme.secondary }]}>
                      {character.role} · {character.series || 'Guild Universe'}
                    </Text>

                    {/* Personality Traits */}
                    {Array.isArray(character.personality) && (
                      <View style={styles.modalTagsRow}>
                        {character.personality.slice(0, 4).map((trait) => (
                          <View
                            key={trait}
                            style={[
                              styles.modalTraitPill,
                              { backgroundColor: theme.surfaceSecondary, borderColor: theme.border },
                            ]}
                          >
                            <Text style={[styles.modalTraitText, { color: theme.text }]}>{trait}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </View>

                {/* SECTION 1: ABOUT THE CHAT */}
                <Text style={[styles.modalSectionLabel, { color: theme.secondary }]}>ABOUT THE CHAT</Text>
                <LiquidGlassView style={styles.modalCard} borderRadius={20} intensity={30} elevated>
                  <Text style={[styles.modalLoreText, { color: theme.text }]}>
                    {character.description || character.shortDescription || 'An intelligent AI companion crafted for deep storytelling and immersive conversation.'}
                  </Text>
                  {character.greeting ? (
                    <View style={[styles.modalQuoteBox, { backgroundColor: theme.surfaceSecondary }]}>
                      <Ionicons
                        name="chatbubble-ellipses-outline"
                        size={14}
                        color={theme.secondary}
                        style={{ marginRight: 8, marginTop: 2 }}
                      />
                      <Text style={[styles.modalQuoteText, { color: theme.secondary }]}>
                        "{character.greeting}"
                      </Text>
                    </View>
                  ) : null}
                </LiquidGlassView>

                {/* SECTION 2: CUSTOMIZE SPEAKING STYLE & VOICE */}
                <View style={styles.speechSectionHeaderRow}>
                  <Text style={[styles.modalSectionLabel, { color: theme.secondary, marginBottom: 0 }]}>
                    CUSTOMIZE SPEAKING STYLE
                  </Text>
                  {isSpeechSavedBanner && (
                    <View style={styles.savedBannerPill}>
                      <Ionicons name="checkmark-circle" size={13} color="#34C759" />
                      <Text style={styles.savedBannerText}>Voice Tuned & Saved</Text>
                    </View>
                  )}
                </View>

                <LiquidGlassView style={styles.modalCard} borderRadius={20} intensity={30} elevated>
                  <Text style={[styles.speechSectionHint, { color: theme.secondary }]}>
                    Choose how you want {character.name} to speak. They will authentically adopt this cadence, humor, and tone in their replies.
                  </Text>

                  {/* Preset Tone Chips */}
                  <View style={styles.speechPresetsGrid}>
                    {SPEECH_PRESETS.map((preset) => {
                      const isSelected = selectedSpeechPresetId === preset.id;
                      return (
                        <Pressable
                          key={preset.id}
                          onPress={() => handleSelectSpeechPreset(preset)}
                          style={[
                            styles.speechPresetChip,
                            {
                              backgroundColor: isSelected ? theme.text : theme.surfaceSecondary,
                              borderColor: isSelected ? theme.text : theme.border,
                            },
                          ]}
                        >
                          <Ionicons
                            name={preset.icon}
                            size={13}
                            color={isSelected ? theme.background : theme.secondary}
                            style={{ marginRight: 5 }}
                          />
                          <Text
                            style={[
                              styles.speechPresetChipText,
                              { color: isSelected ? theme.background : theme.text },
                            ]}
                          >
                            {preset.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  {/* Custom Description Text Input */}
                  <View
                    style={[
                      styles.speechCustomInputWrap,
                      { backgroundColor: theme.surfaceSecondary, borderColor: theme.border },
                    ]}
                  >
                    <TextInput
                      value={customSpeechText}
                      onChangeText={setCustomSpeechText}
                      placeholder={`Describe ${character.name}'s speech quirks, dialect, slang or mood...`}
                      placeholderTextColor={theme.muted}
                      multiline
                      numberOfLines={3}
                      style={[styles.speechCustomInput, { color: theme.text }]}
                    />
                  </View>

                  <View style={styles.speechActionRow}>
                    <Pressable
                      onPress={handleSaveCustomSpeech}
                      style={[styles.saveSpeechBtn, { backgroundColor: theme.text }]}
                    >
                      <Ionicons name="save-outline" size={14} color={theme.background} style={{ marginRight: 6 }} />
                      <Text style={[styles.saveSpeechBtnText, { color: theme.background }]}>Apply Voice Tuning</Text>
                    </Pressable>

                    {speakingStyle ? (
                      <Pressable
                        onPress={async () => {
                          triggerHaptic('warning');
                          setSpeakingStyle('');
                          setCustomSpeechText('');
                          setSelectedSpeechPresetId(null);
                          const key = `guildtalk_speech_style_${user?.id || 'guest'}_${character?.id}`;
                          if (Platform.OS === 'web') {
                            globalThis.localStorage?.removeItem(key);
                          } else {
                            await SecureStore.deleteItemAsync(key);
                          }
                          setIsSpeechSavedBanner(true);
                          setTimeout(() => setIsSpeechSavedBanner(false), 2000);
                        }}
                        style={styles.resetSpeechBtn}
                      >
                        <Text style={[styles.resetSpeechText, { color: theme.muted }]}>Reset to Original</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </LiquidGlassView>

                {/* SECTION 3: CONVERSATION ACTIONS (MODERN LIQUID GLASS TILES) */}
                <Text style={[styles.modalSectionLabel, { color: theme.secondary }]}>CONVERSATION ACTIONS</Text>

                {/* Action 1: Hide from Recent */}
                <LiquidGlassView style={styles.actionCardModern} borderRadius={18} intensity={30} elevated>
                  <View style={styles.actionCardHeaderRow}>
                    <View
                      style={[
                        styles.actionIconPill,
                        {
                          backgroundColor: isHiddenFromRecent
                            ? 'rgba(255, 149, 0, 0.15)'
                            : theme.surfaceSecondary,
                        },
                      ]}
                    >
                      <Ionicons
                        name="eye-off"
                        size={18}
                        color={isHiddenFromRecent ? '#FF9500' : theme.secondary}
                      />
                    </View>
                    <View style={{ flex: 1, paddingHorizontal: 12 }}>
                      <Text style={[styles.actionModernTitle, { color: theme.text }]}>Hide from Recent</Text>
                      <Text style={[styles.actionModernSubtitle, { color: theme.secondary }]}>
                        Hide conversation from Discover and Recent Chats
                      </Text>
                    </View>
                    <Switch
                      value={isHiddenFromRecent}
                      onValueChange={handleToggleHideRecent}
                      trackColor={{ false: theme.border, true: '#FF9500' }}
                      thumbColor="#fff"
                    />
                  </View>
                </LiquidGlassView>

                {/* Action 2: Clear Chat History */}
                <Pressable
                  onPress={handleClearHistory}
                  disabled={isActionLoading}
                  style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1, marginTop: 10 }]}
                >
                  <LiquidGlassView style={styles.actionCardModern} borderRadius={18} intensity={30} elevated>
                    <View style={styles.actionCardHeaderRow}>
                      <View style={[styles.actionIconPill, { backgroundColor: 'rgba(255, 149, 0, 0.15)' }]}>
                        <Ionicons name="trash" size={18} color="#FF9500" />
                      </View>
                      <View style={{ flex: 1, paddingHorizontal: 12 }}>
                        <Text style={[styles.actionModernTitle, { color: '#FF9500' }]}>Clear Chat History</Text>
                        <Text style={[styles.actionModernSubtitle, { color: theme.secondary }]}>
                          Reset all messages in this conversation
                        </Text>
                      </View>
                      <View style={[styles.actionCountPill, { backgroundColor: theme.surfaceSecondary }]}>
                        <Text style={[styles.actionCountPillText, { color: theme.text }]}>
                          {messages.length} msgs
                        </Text>
                      </View>
                    </View>
                  </LiquidGlassView>
                </Pressable>

                {/* Action 3: Delete Complete Profile */}
                <Pressable
                  onPress={handleDeleteProfile}
                  disabled={isActionLoading}
                  style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1, marginTop: 10 }]}
                >
                  <LiquidGlassView style={styles.actionCardModern} borderRadius={18} intensity={30} elevated>
                    <View style={styles.actionCardHeaderRow}>
                      <View style={[styles.actionIconPill, { backgroundColor: 'rgba(255, 59, 48, 0.15)' }]}>
                        <Ionicons name="person-remove" size={18} color="#FF3B30" />
                      </View>
                      <View style={{ flex: 1, paddingHorizontal: 12 }}>
                        <Text style={[styles.actionModernTitle, { color: '#FF3B30' }]}>
                          Delete Complete Profile
                        </Text>
                        <Text style={[styles.actionModernSubtitle, { color: theme.secondary }]}>
                          Permanently delete {character.name} and clear companion records
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#FF3B30" />
                    </View>
                  </LiquidGlassView>
                </Pressable>

                {/* Return to Chat Button */}
                <Pressable
                  onPress={() => {
                    triggerHaptic('light');
                    setShowFullProfileMenu(false);
                  }}
                  style={[styles.modalReturnBtn, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}
                >
                  <Text style={[styles.modalReturnBtnText, { color: theme.text }]}>Back to Conversation</Text>
                </Pressable>
              </ScrollView>
            </SafeAreaView>
          </View>
        </Modal>

        {/* Model Selection Dropdown Menu */}
        {showModelMenu && (
          <LiquidGlassView style={styles.modelMenu} borderRadius={16} intensity={45} elevated>
            <Text style={[styles.modelMenuTitle, { color: theme.secondary }]}>AI INTELLIGENCE</Text>
            {AVAILABLE_MODELS.map((m) => {
              const isSelected = selectedModel === m.id;
              return (
                <Pressable
                  key={m.id}
                  onPress={() => {
                    setSelectedModel(m.id);
                    setShowModelMenu(false);
                  }}
                  style={[
                    styles.modelMenuItem,
                    isSelected && { backgroundColor: theme.surfaceSecondary },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.modelItemName, { color: theme.text, fontWeight: isSelected ? '700' : '500' }]}>
                      {m.name}
                    </Text>
                    <Text style={[styles.modelItemLabel, { color: theme.secondary }]}>{m.label}</Text>
                  </View>
                  {isSelected && <Ionicons name="checkmark" size={18} color={theme.text} />}
                </Pressable>
              );
            })}
          </LiquidGlassView>
        )}

        {/* Message Stream */}
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          contentContainerStyle={styles.messagesContainer}
          onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <MessageRow
              item={item}
              avatarUri={character.avatarUrl}
              bubbleUserColor={theme.bubbleUser}
              bubbleUserTextColor={theme.bubbleUserText}
              bubbleAiColor={theme.bubbleAi}
              bubbleAiTextColor={theme.bubbleAiText}
              borderColor={theme.border}
              onLongPress={handleMessageLongPress}
            />
          )}
          ListFooterComponent={
            isSending ? (
              <View style={[styles.bubbleWrapper, styles.characterBubbleWrap]}>
                <DynamicCharacterImage character={character} style={styles.bubbleMiniAvatar} />
                <View
                  style={[
                    styles.bubble,
                    styles.characterBubble,
                    { backgroundColor: theme.bubbleAi, borderColor: theme.border },
                  ]}
                >
                  <View style={styles.typingRow}>
                    <ActivityIndicator size="small" color={theme.text} />
                    <Text style={[styles.typingText, { color: theme.secondary }]}>
                      {character.name.split(' ')[0]} is formulating an emotional reply…
                    </Text>
                  </View>
                </View>
              </View>
            ) : error ? (
              <Pressable onPress={() => setError(null)} style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={16} color="#FF3B30" />
                <Text style={styles.errorBannerText}>{error} (Tap to dismiss)</Text>
              </Pressable>
            ) : null
          }
        />

        {/* Floating Starter Suggestions */}
        {messages.length <= 2 && (
          <View style={styles.suggestionsContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.suggestionsRow}>
              {suggestions.map((starter) => (
                <Pressable
                  key={starter}
                  disabled={isSending}
                  onPress={() => send(starter)}
                  style={[
                    styles.suggestionPill,
                    { backgroundColor: theme.cardGlass, borderColor: theme.border },
                  ]}
                >
                  <Ionicons name="chatbubble-ellipses-outline" size={14} color={theme.secondary} />
                  <Text style={[styles.suggestionText, { color: theme.text }]}>{starter}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        {/* Attached Photo Preview */}
        {attachedPhoto && (
          <View style={[styles.attachedPhotoBanner, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
            <Image source={{ uri: attachedPhoto }} style={styles.attachedPreviewImage} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.attachedTitle, { color: theme.text }]}>Photo ready for analysis</Text>
              <Text style={[styles.attachedSubtitle, { color: theme.secondary }]}>
                {character.name.split(' ')[0]} will see and react to this with GPT-4o vision.
              </Text>
            </View>
            <Pressable hitSlop={8} onPress={() => setAttachedPhoto(null)} style={styles.removePhotoBtn}>
              <Ionicons name="close-circle" size={22} color={theme.muted} />
            </Pressable>
          </View>
        )}

        {/* Inline Message Edit Bar */}
        {editingMessageId && (
          <View style={[styles.editBar, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
            <View style={styles.editHeaderRow}>
              <View style={styles.editTitleRow}>
                <Ionicons name="pencil" size={13} color={theme.text} />
                <Text style={[styles.editBarTitle, { color: theme.text }]}>Edit Message & Update Response</Text>
              </View>
              <Pressable onPress={cancelEditing} hitSlop={8}>
                <Ionicons name="close" size={18} color={theme.secondary} />
              </Pressable>
            </View>
            <TextInput
              value={editContent}
              onChangeText={setEditContent}
              style={[
                styles.editInput,
                { color: theme.text, backgroundColor: theme.surfaceSecondary, borderColor: theme.border },
              ]}
              multiline
              autoFocus
            />
            <View style={styles.editActionsRow}>
              <Pressable onPress={cancelEditing} style={[styles.editCancelBtn, { borderColor: theme.border }]}>
                <Text style={[styles.editCancelBtnText, { color: theme.secondary }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={submitEdit}
                disabled={isRegenerating || !editContent.trim()}
                style={[styles.editSaveBtn, { backgroundColor: theme.text }]}
              >
                {isRegenerating ? (
                  <ActivityIndicator size="small" color={theme.background} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={14} color={theme.background} />
                    <Text style={[styles.editSaveBtnText, { color: theme.background }]}>Update & Regenerate</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        )}

        {/* Composer Bar or Voice Recording Bar */}
        <LiquidGlassView
          style={[
            styles.composer,
            {
              paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 10),
              paddingHorizontal: isRecording ? 6 : 14,
            },
          ]}
          borderRadius={0}
          intensity={40}
        >
          {isRecording ? (
            <VoiceWaveformBar
              duration={voiceDuration}
              isPaused={isVoicePaused}
              transcript={voiceTranscript}
              onTogglePause={toggleVoicePause}
              onCancel={cancelVoiceRecording}
              onSend={sendVoiceRecording}
            />
          ) : (
            <>
              <Pressable
                onPress={pickPhoto}
                accessibilityLabel="Attach photo"
                style={[styles.attachBtn, { backgroundColor: theme.surfaceSecondary }]}
              >
                <Ionicons name="camera-outline" size={22} color={theme.text} />
              </Pressable>

              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder={`Message ${character.name.split(' ')[0]}…`}
                placeholderTextColor={theme.muted}
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    backgroundColor: theme.surfaceSolid,
                    borderColor: theme.border,
                  },
                ]}
                onSubmitEditing={() => send(input)}
                returnKeyType="send"
                multiline
              />

              {/* Microphone / voice button */}
              <Pressable
                onPress={startVoiceInput}
                accessibilityLabel="Voice input"
                style={[
                  styles.attachBtn,
                  { backgroundColor: theme.surfaceSecondary },
                ]}
              >
                <Ionicons
                  name="mic-outline"
                  size={22}
                  color={theme.text}
                />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                onPress={() => { triggerHaptic('light'); send(input); }}
                disabled={(!input.trim() && !attachedPhoto) || isSending}
                style={[
                  styles.sendBtn,
                  { backgroundColor: theme.text },
                  (!input.trim() && !attachedPhoto) || isSending ? { opacity: 0.35 } : null,
                ]}
              >
                <Ionicons name="arrow-up" size={18} color={theme.background} />
              </Pressable>
            </>
          )}
        </LiquidGlassView>

        {/* Long-press context menu modal */}
        <Modal
          visible={contextMenu.visible}
          transparent
          animationType="fade"
          onRequestClose={closeContextMenu}
        >
          <TouchableWithoutFeedback onPress={closeContextMenu}>
            <View style={styles.contextOverlay}>
              <TouchableWithoutFeedback>
                <View style={[styles.contextSheet, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
                  <Text style={[styles.contextTitle, { color: theme.secondary }]}>Message Actions</Text>
                  <TouchableOpacity
                    style={[styles.contextItem, { borderBottomColor: theme.border }]}
                    onPress={() => {
                      closeContextMenu();
                      if (contextMenu.message) startEditing(contextMenu.message);
                    }}
                  >
                    <Ionicons name="pencil-outline" size={18} color={theme.text} />
                    <Text style={[styles.contextItemText, { color: theme.text }]}>Edit Message</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.contextItem}
                    onPress={() => contextMenu.message && deleteMessage(contextMenu.message.id)}
                  >
                    <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                    <Text style={[styles.contextItemText, { color: '#FF3B30' }]}>Delete Message</Text>
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  keyboard: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    gap: 10,
    zIndex: 10,
  },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarWrap: {
    position: 'relative',
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  headerOnlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#000',
  },
  headerInfo: {
    flex: 1,
  },
  headerName: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  headerSeries: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  headerProfilePressable: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modalScreen: {
    flex: 1,
  },
  modalTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  modalCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTopTitle: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  modalScrollContent: {
    padding: 20,
    paddingBottom: 60,
  },
  modalHeroCard: {
    height: 330,
    borderRadius: 24,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: 24,
    justifyContent: 'flex-end',
  },
  modalHeroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalHeroGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalHeroInfo: {
    padding: 18,
    alignItems: 'center',
  },
  modalHeroAvatarWrap: {
    position: 'relative',
    marginBottom: 10,
  },
  modalHeroAvatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3,
    borderColor: '#fff',
  },
  modalOnlineDot: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#fff',
  },
  modalCharName: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 2,
    textAlign: 'center',
  },
  modalCharRole: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 10,
    textAlign: 'center',
  },
  modalTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
  },
  modalTraitPill: {
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'android' ? 6 : 5,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTraitText: {
    fontSize: 12,
    fontWeight: '600',
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  modalSectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 10,
    marginLeft: 4,
  },
  modalCard: {
    padding: 16,
    marginBottom: 22,
  },
  modalLoreText: {
    fontSize: 14,
    lineHeight: 21,
  },
  modalQuoteBox: {
    flexDirection: 'row',
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
  },
  modalQuoteText: {
    flex: 1,
    fontSize: 13,
    fontStyle: 'italic',
    lineHeight: 18,
  },
  modalDivider: {
    height: 1,
    backgroundColor: 'rgba(128,128,128,0.15)',
    marginVertical: 14,
  },
  modalToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalToggleTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  modalToggleDesc: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  modalActionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
  },
  modalActionIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalActionTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  modalActionSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },

  // Speaking Style Customization Styles
  speechSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 4,
    paddingHorizontal: 4,
  },
  savedBannerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(52, 199, 89, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  savedBannerText: {
    color: '#34C759',
    fontSize: 11,
    fontWeight: '700',
  },
  speechSectionHint: {
    fontSize: 12.5,
    lineHeight: 17,
    marginBottom: 14,
  },
  speechPresetsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  speechPresetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: 1,
  },
  speechPresetChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  speechCustomInputWrap: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    marginBottom: 12,
  },
  speechCustomInput: {
    fontSize: 13,
    lineHeight: 18,
    minHeight: 56,
    textAlignVertical: 'top',
  },
  speechActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  saveSpeechBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  saveSpeechBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  resetSpeechBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  resetSpeechText: {
    fontSize: 11.5,
    fontWeight: '600',
  },

  // Modern Action Cards
  actionCardModern: {
    padding: 12,
  },
  actionCardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionIconPill: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionModernTitle: {
    fontSize: 14.5,
    fontWeight: '700',
  },
  actionModernSubtitle: {
    fontSize: 11.5,
    lineHeight: 15,
    marginTop: 2,
  },
  actionCountPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  actionCountPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  modalReturnBtn: {
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginTop: 8,
  },
  modalReturnBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  modelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  modelPillText: {
    fontSize: 11,
    fontWeight: '700',
  },
  modelMenu: {
    position: 'absolute',
    top: 64,
    right: 16,
    width: 240,
    padding: 12,
    zIndex: 100,
    borderWidth: 1,
  },
  modelMenuTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    marginBottom: 8,
  },
  modelMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
  },
  modelItemName: {
    fontSize: 13,
  },
  modelItemLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  messagesContainer: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 12,
    flexGrow: 1,
  },
  bubbleWrapper: {
    flexDirection: 'row',
    gap: 8,
    maxWidth: '85%',
  },
  userBubbleWrap: {
    alignSelf: 'flex-end',
    flexDirection: 'row-reverse',
  },
  characterBubbleWrap: {
    alignSelf: 'flex-start',
  },
  bubbleMiniAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginTop: 4,
  },
  bubble: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 22,
    borderWidth: 1,
  },
  characterBubble: {
    borderTopLeftRadius: 6,
  },
  userBubble: {
    borderTopRightRadius: 6,
    borderWidth: 0,
  },
  bubblePhoto: {
    width: 200,
    height: 150,
    borderRadius: 14,
    marginBottom: 8,
  },
  bubbleText: {
    fontSize: 15,
    lineHeight: 22,
    letterSpacing: -0.1,
  },
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typingText: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
    alignSelf: 'center',
    marginTop: 8,
  },
  errorBannerText: {
    color: '#FF3B30',
    fontSize: 12,
    fontWeight: '600',
  },
  suggestionsContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  suggestionsRow: {
    gap: 8,
  },
  suggestionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    borderWidth: 1,
  },
  suggestionText: {
    fontSize: 12,
    fontWeight: '600',
  },
  attachedPhotoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  attachedPreviewImage: {
    width: 44,
    height: 44,
    borderRadius: 8,
  },
  attachedTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  attachedSubtitle: {
    fontSize: 11,
    marginTop: 1,
  },
  removePhotoBtn: {
    padding: 4,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 8,
    borderTopWidth: 1,
  },
  attachBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 110,
    borderRadius: 21,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    borderWidth: 1,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  editBubbleBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    padding: 3,
  },
  editBar: {
    marginHorizontal: 14,
    marginBottom: 8,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
  },
  editHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  editTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  editBarTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  editInput: {
    minHeight: 44,
    maxHeight: 100,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    borderWidth: 1,
  },
  editActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 4,
  },
  editCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  editCancelBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  editSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
  },
  editSaveBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  contextOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  contextSheet: {
    marginHorizontal: 16,
    marginBottom: 32,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    paddingTop: 4,
  },
  contextTitle: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textAlign: 'center',
    paddingVertical: 12,
  },
  contextItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(128,128,128,0.15)',
  },
  contextItemText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
