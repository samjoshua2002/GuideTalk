import React, { useState, useRef } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
  Platform,
  Dimensions,
  Animated,
  PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTheme } from '@/src/context/ThemeContext';
import { LiquidGlassView } from './LiquidGlassView';
import { InAppNotification } from '@/src/lib/notificationService';
import { triggerHaptic } from '@/src/lib/haptics';

interface NotificationsModalProps {
  visible: boolean;
  onClose: () => void;
  notifications: InAppNotification[];
  onMarkAllRead: () => void;
  onClearAll: () => void;
  onDismissNotification: (id: string) => void;
  onSelectNotification: (notif: InAppNotification) => void;
  userName?: string;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// ─── Swipeable Notification Card Row ─────────────────────────────────────────
function SwipeableNotificationCard({
  item,
  onDismiss,
  onOpenChat,
  onSelect,
  theme,
  isDark,
}: {
  item: InAppNotification;
  onDismiss: (id: string) => void;
  onOpenChat: (characterId?: string) => void;
  onSelect: (notif: InAppNotification) => void;
  theme: any;
  isDark: boolean;
}) {
  const pan = useRef(new Animated.ValueXY()).current;
  const isCompanion = item.type === 'companion_reminder';

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) => {
        // Only respond to predominantly horizontal swipes
        return Math.abs(gestureState.dx) > 15 && Math.abs(gestureState.dx) > Math.abs(gestureState.dy);
      },
      onPanResponderMove: (_, gestureState) => {
        // Only allow swiping left (negative dx)
        if (gestureState.dx < 0) {
          pan.setValue({ x: Math.max(gestureState.dx, -120), y: 0 });
        }
      },
      onPanResponderRelease: (_, gestureState) => {
        if (gestureState.dx < -75) {
          // Swipe passed threshold -> animate away and dismiss
          triggerHaptic();
          Animated.timing(pan, {
            toValue: { x: -400, y: 0 },
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            onDismiss(item.id);
          });
        } else {
          // Snap back
          Animated.spring(pan, {
            toValue: { x: 0, y: 0 },
            useNativeDriver: true,
            bounciness: 4,
          }).start();
        }
      },
    })
  ).current;

  return (
    <View style={styles.cardWrapperOuter}>
      {/* Red Swipe Delete Background */}
      <View style={styles.deleteBackground}>
        <Ionicons name="trash" size={20} color="#FFFFFF" />
        <Text style={styles.deleteBackgroundText}>Dismiss</Text>
      </View>

      {/* Foreground Swipeable Card */}
      <Animated.View
        style={{ transform: [{ translateX: pan.x }] }}
        {...panResponder.panHandlers}
      >
        <Pressable
          onPress={() => {
            onSelect(item);
            if (isCompanion && item.characterId) {
              onOpenChat(item.characterId);
            }
          }}
          style={({ pressed }) => [pressed && { opacity: 0.85 }]}
        >
          <LiquidGlassView
            style={[
              styles.cardGlass,
              {
                backgroundColor: isDark ? 'rgba(28,24,42,0.92)' : 'rgba(255,255,255,0.95)',
                borderColor: item.unread
                  ? isDark
                    ? 'rgba(255,255,255,0.25)'
                    : 'rgba(0,0,0,0.15)'
                  : theme.border,
              },
              item.unread && { borderWidth: 1.5 },
            ]}
            borderRadius={18}
            intensity={30}
          >
            {/* Avatar / Icon */}
            {isCompanion && item.characterAvatar ? (
              <Image
                source={{ uri: item.characterAvatar }}
                style={styles.avatarImg}
                contentFit="cover"
              />
            ) : (
              <View
                style={[
                  styles.updateIconWrap,
                  { backgroundColor: isDark ? 'rgba(244,205,42,0.2)' : 'rgba(244,205,42,0.15)' },
                ]}
              >
                <Ionicons
                  name={item.badge === 'Upcoming' ? 'mic' : 'sparkles'}
                  size={20}
                  color="#F4CD2A"
                />
              </View>
            )}

            {/* Content */}
            <View style={styles.cardBody}>
              <View style={styles.cardHeaderRow}>
                <View style={styles.badgeRow}>
                  <Text style={[styles.cardTitle, { color: theme.text }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {item.unread && <View style={styles.unreadDot} />}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[styles.timeAgo, { color: theme.muted }]}>{item.timeAgo}</Text>
                  <Pressable
                    hitSlop={8}
                    onPress={() => {
                      triggerHaptic();
                      onDismiss(item.id);
                    }}
                    style={styles.deleteCardBtn}
                  >
                    <Ionicons name="close-circle-outline" size={16} color={theme.muted} />
                  </Pressable>
                </View>
              </View>

              <Text style={[styles.cardBodyText, { color: theme.secondary }]} numberOfLines={3}>
                {item.body}
              </Text>

              {/* Action Footer */}
              {isCompanion && item.characterId && (
                <View style={styles.actionRow}>
                  <Pressable
                    onPress={() => onOpenChat(item.characterId)}
                    style={[styles.replyBtn, { backgroundColor: theme.text }]}
                  >
                    <Ionicons name="chatbubble-ellipses" size={12} color={theme.background} />
                    <Text style={[styles.replyBtnText, { color: theme.background }]}>
                      Reply to {item.characterName || 'Chat'}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          </LiquidGlassView>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ─── Modal Main Component ───────────────────────────────────────────────────
export function NotificationsModal({
  visible,
  onClose,
  notifications,
  onMarkAllRead,
  onClearAll,
  onDismissNotification,
  onSelectNotification,
  userName,
}: NotificationsModalProps) {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const [filter, setFilter] = useState<'all' | 'companions'>('all');

  const filteredList = notifications.filter((item) => {
    if (filter === 'companions') return item.type === 'companion_reminder';
    // Never show app_update notifications in this list (moved to Profile screen)
    if (item.type === 'app_update') return false;
    return true;
  });

  const unreadCount = notifications.filter((n) => n.unread).length;

  const handleOpenChat = (characterId?: string) => {
    if (!characterId) return;
    triggerHaptic();
    onClose();
    setTimeout(() => {
      router.push(`/chat/${characterId}`);
    }, 100);
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />

        <LiquidGlassView
          style={[
            styles.modalSheet,
            { backgroundColor: isDark ? 'rgba(18,14,32,0.97)' : 'rgba(255,255,255,0.98)' },
          ]}
          borderRadius={28}
          intensity={55}
          elevated
        >
          {/* Top Handle */}
          <View style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: theme.border }]} />
          </View>

          {/* Header */}
          <View style={[styles.header, { borderBottomColor: theme.border }]}>
            <View style={styles.headerLeft}>
              <View style={[styles.bellWrap, { backgroundColor: theme.surfaceSolid }]}>
                <Ionicons name="notifications" size={19} color={theme.text} />
                {unreadCount > 0 && <View style={styles.headerBadgeDot} />}
              </View>
              <View>
                <Text style={[styles.title, { color: theme.text }]}>Notifications</Text>
                <Text style={[styles.subtitle, { color: theme.secondary }]}>
                  {unreadCount > 0 ? `${unreadCount} unread updates` : `${notifications.length} alerts`}
                </Text>
              </View>
            </View>

            <View style={styles.headerRight}>
              {notifications.length > 0 && (
                <Pressable
                  onPress={() => {
                    triggerHaptic();
                    onClearAll();
                  }}
                  style={[
                    styles.headerBtn,
                    { backgroundColor: theme.surfaceSolid, borderColor: theme.border },
                  ]}
                >
                  <Ionicons name="trash-outline" size={13} color="#FF3B30" />
                  <Text style={[styles.headerBtnText, { color: '#FF3B30' }]}>Clear All</Text>
                </Pressable>
              )}
              {unreadCount > 0 && (
                <Pressable
                  onPress={() => {
                    triggerHaptic();
                    onMarkAllRead();
                  }}
                  style={[
                    styles.headerBtn,
                    { backgroundColor: theme.surfaceSolid, borderColor: theme.border },
                  ]}
                >
                  <Ionicons name="checkmark-done" size={13} color={theme.text} />
                  <Text style={[styles.headerBtnText, { color: theme.text }]}>Read All</Text>
                </Pressable>
              )}
              <Pressable onPress={onClose} style={[styles.closeBtn, { backgroundColor: theme.surfaceSolid }]}>
                <Ionicons name="close" size={18} color={theme.secondary} />
              </Pressable>
            </View>
          </View>

          {/* Filter Pills */}
          <View style={styles.filterRow}>
            {[
              { key: 'all', label: 'All', icon: 'grid-outline' },
              { key: 'companions', label: 'Companions', icon: 'heart-outline' },
            ].map((tab) => {
              const active = filter === tab.key;
              return (
                <Pressable
                  key={tab.key}
                  onPress={() => {
                    triggerHaptic();
                    setFilter(tab.key as any);
                  }}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: active ? theme.text : theme.surfaceSolid,
                      borderColor: active ? theme.text : theme.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={tab.icon as any}
                    size={13}
                    color={active ? theme.background : theme.secondary}
                    style={{ marginRight: 5 }}
                  />
                  <Text style={[styles.filterChipText, { color: active ? theme.background : theme.secondary }]}>
                    {tab.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Notifications Scroll */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContainer}
          >
            {filteredList.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="notifications-off-outline" size={44} color={theme.muted} />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>All clear</Text>
                <Text style={[styles.emptySub, { color: theme.secondary }]}>
                  {filter === 'companions'
                    ? 'Add characters to Favorites to receive personalized check-ins!'
                    : 'All caught up! Check back later for companion check-ins.'}
                </Text>
              </View>
            ) : (
              filteredList.map((item) => (
                <SwipeableNotificationCard
                  key={item.id}
                  item={item}
                  onDismiss={onDismissNotification}
                  onOpenChat={handleOpenChat}
                  onSelect={onSelectNotification}
                  theme={theme}
                  isDark={isDark}
                />
              ))
            )}
          </ScrollView>
        </LiquidGlassView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  modalSheet: {
    maxHeight: SCREEN_HEIGHT * 0.86,
    minHeight: SCREEN_HEIGHT * 0.55,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    overflow: 'hidden',
  },
  handleWrap: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bellWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  headerBadgeDot: {
    position: 'absolute',
    top: 5,
    right: 5,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 11.5,
    fontWeight: '500',
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  headerBtnText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterChipText: {
    fontSize: 11.5,
    fontWeight: '600',
  },
  listContainer: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 24,
    gap: 10,
  },
  cardWrapperOuter: {
    width: '100%',
    position: 'relative',
    borderRadius: 18,
    overflow: 'hidden',
  },
  deleteBackground: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#FF3B30',
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingRight: 20,
    gap: 6,
  },
  deleteBackgroundText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 12,
  },
  cardGlass: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 18,
    gap: 12,
  },
  avatarImg: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(150,150,150,0.2)',
  },
  updateIconWrap: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: {
    flex: 1,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 6,
  },
  cardTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  unreadDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FF3B30',
  },
  timeAgo: {
    fontSize: 11,
    fontWeight: '500',
  },
  deleteCardBtn: {
    padding: 2,
  },
  cardBodyText: {
    fontSize: 12.5,
    lineHeight: 17,
    fontWeight: '400',
  },
  actionRow: {
    marginTop: 8,
    flexDirection: 'row',
  },
  replyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: 12,
  },
  replyBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  emptySub: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
});
