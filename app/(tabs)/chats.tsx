import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { useTheme } from '@/src/context/ThemeContext';
import { useAuth } from '@/src/context/AuthContext';
import { listConversations, ConversationSummary } from '@/src/lib/chatApi';
import { LiquidGlassView } from '@/src/components/LiquidGlassView';
import { characters } from '@/src/data/characters';
import { triggerHaptic } from '@/src/lib/haptics';
import { getHiddenRecentIds, subscribeToFavorites } from '@/src/lib/favorites';
import { DynamicCharacterImage } from '@/src/lib/dynamicImageService';

const DEVICE_STORAGE_KEY = 'guildtalk_device_id';

interface ConversationRowProps {
  item: ConversationSummary;
  avatarUri: string;
  textColor: string;
  secondaryColor: string;
  onPress: () => void;
}

const ConversationRow = React.memo(function ConversationRow({
  item,
  avatarUri,
  textColor,
  secondaryColor,
  onPress,
}: ConversationRowProps) {
  return (
    <Pressable
      onPress={() => {
        triggerHaptic('light');
        onPress();
      }}
      style={({ pressed }) => [styles.itemPressable, pressed && { opacity: 0.8 }]}
    >
      <LiquidGlassView style={styles.itemCard} borderRadius={18} intensity={25}>
        <DynamicCharacterImage
          character={{ name: item.characterName, avatarUrl: avatarUri }}
          style={styles.avatar}
          contentFit="cover"
          contentPosition="top"
        />
        <View style={styles.info}>
          <View style={styles.row}>
            <Text style={[styles.name, { color: textColor }]} numberOfLines={1}>{item.characterName}</Text>
            <Text style={[styles.time, { color: secondaryColor }]}>
              {new Date(item.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </Text>
          </View>
          <Text style={[styles.preview, { color: secondaryColor }]} numberOfLines={1}>
            {item.preview || 'Start a conversation…'}
          </Text>
        </View>
        <Ionicons name="chevron-forward" color={secondaryColor} size={16} />
      </LiquidGlassView>
    </Pressable>
  );
});

export default function ChatsScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { user, token } = useAuth();

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadChats = async () => {
    setLoading(true);
    try {
      let deviceId = 'guest';
      if (Platform.OS === 'web') {
        deviceId = globalThis.localStorage?.getItem(DEVICE_STORAGE_KEY) || 'web-guest';
      } else {
        deviceId = (await SecureStore.getItemAsync(DEVICE_STORAGE_KEY)) || 'device-guest';
      }
      const activeUserId = user?.id || deviceId;
      const [list, hidden] = await Promise.all([
        listConversations(activeUserId, token),
        getHiddenRecentIds(),
      ]);
      setConversations(list || []);
      setHiddenIds(hidden || []);
    } catch (err) {
      console.log('Failed to load chats from MongoDB:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadChats();
    const unsub = subscribeToFavorites(() => {
      loadChats();
    });
    return unsub;
  }, [user, token]);

  useFocusEffect(
    useCallback(() => {
      loadChats();
    }, [user, token])
  );

  const getAvatar = useCallback((item: ConversationSummary) => {
    if (item.characterAvatar) return item.characterAvatar;
    const match = characters.find((c) => c.id === item.characterId);
    if (match) return match.avatarUrl;
    return `https://api.dicebear.com/9.x/adventurer/png?seed=${encodeURIComponent(item.characterName)}&backgroundColor=000000`;
  }, []);

  const groupedConversations = React.useMemo(() => {
    const map = new Map<string, ConversationSummary>();
    for (const c of conversations) {
      if (!c.characterId || hiddenIds.includes(c.characterId)) continue;
      if (!map.has(c.characterId)) {
        map.set(c.characterId, c);
      } else {
        const existing = map.get(c.characterId)!;
        if (new Date(c.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
          map.set(c.characterId, c);
        }
      }
    }
    return Array.from(map.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [conversations, hiddenIds]);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.eyebrow, { color: theme.secondary }]}>RECENT COMPANIONS</Text>
          <Text style={[styles.title, { color: theme.text }]}>Messages</Text>
        </View>
        <Pressable
          onPress={loadChats}
          hitSlop={8}
          style={[styles.refreshBtn, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}
        >
          <Ionicons name="refresh-outline" size={20} color={theme.text} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="small" color={theme.text} />
        </View>
      ) : groupedConversations.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="chatbubbles-outline" size={48} color={theme.muted} />
          <Text style={[styles.emptyTitle, { color: theme.text }]}>No Conversations Yet</Text>
          <Text style={[styles.emptySubtitle, { color: theme.secondary }]}>
            Pick a companion on the Discover tab to start chatting.
          </Text>
        </View>
      ) : (
        <FlatList
          data={groupedConversations}
          keyExtractor={(item) => item.characterId || item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ConversationRow
              item={item}
              avatarUri={getAvatar(item)}
              textColor={theme.text}
              secondaryColor={theme.secondary}
              onPress={() => router.push(`/chat/${item.characterId}`)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
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
    letterSpacing: -0.5,
  },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 14,
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  list: {
    paddingBottom: 80,
  },
  itemPressable: {
    marginBottom: 10,
  },
  itemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  info: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    fontSize: 15,
    fontWeight: '700',
  },
  time: {
    fontSize: 11,
    fontWeight: '500',
  },
  preview: {
    fontSize: 13,
    marginTop: 3,
  },
});
