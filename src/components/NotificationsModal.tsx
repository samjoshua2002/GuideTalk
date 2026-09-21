import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  View,
  Pressable,
  ScrollView,
  Platform,
  Dimensions,
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
  onSelectNotification: (notif: InAppNotification) => void;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export function NotificationsModal({
  visible,
  onClose,
  notifications,
  onMarkAllRead,
  onSelectNotification,
}: NotificationsModalProps) {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const [filter, setFilter] = useState<'all' | 'companions' | 'updates'>('all');

  const filteredList = notifications.filter((item) => {
    if (filter === 'companions') return item.type === 'companion_reminder';
    if (filter === 'updates') return item.type === 'app_update';
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
          style={[styles.modalSheet, { backgroundColor: isDark ? 'rgba(18,14,32,0.96)' : 'rgba(255,255,255,0.97)' }]}
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
                  {unreadCount > 0 ? `${unreadCount} unread updates` : 'All caught up'}
                </Text>
              </View>
            </View>

            <View style={styles.headerRight}>
              {unreadCount > 0 && (
                <Pressable
                  onPress={() => {
                    triggerHaptic();
                    onMarkAllRead();
                  }}
                  style={[styles.markReadBtn, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}
                >
                  <Ionicons name="checkmark-done" size={14} color={theme.text} />
                  <Text style={[styles.markReadText, { color: theme.text }]}>Read All</Text>
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
              { key: 'updates', label: 'App Updates', icon: 'sparkles-outline' },
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

          {/* Push Info Banner */}
          <View style={[styles.infoBanner, { backgroundColor: isDark ? 'rgba(108,71,255,0.12)' : 'rgba(108,71,255,0.08)', borderColor: 'rgba(108,71,255,0.25)' }]}>
            <Ionicons name="time-outline" size={16} color="#6C47FF" />
            <Text style={[styles.infoBannerText, { color: theme.text }]}>
              Liked companions check in hourly with in-character reminders!
            </Text>
          </View>

          {/* Notifications Scroll */}
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContainer}
          >
            {filteredList.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="notifications-off-outline" size={44} color={theme.muted} />
                <Text style={[styles.emptyTitle, { color: theme.text }]}>No notifications</Text>
                <Text style={[styles.emptySub, { color: theme.secondary }]}>
                  {filter === 'companions'
                    ? 'Add characters to Favorites to receive personalized check-ins!'
                    : 'Check back later for fresh updates and character check-ins.'}
                </Text>
              </View>
            ) : (
              filteredList.map((item) => {
                const isCompanion = item.type === 'companion_reminder';
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      onSelectNotification(item);
                      if (isCompanion && item.characterId) {
                        handleOpenChat(item.characterId);
                      }
                    }}
                    style={({ pressed }) => [
                      styles.cardWrap,
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <LiquidGlassView
                      style={[
                        styles.cardGlass,
                        { borderColor: item.unread ? (isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.15)') : theme.border },
                        item.unread && { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)' },
                      ]}
                      borderRadius={18}
                      intensity={25}
                    >
                      {/* Avatar / Icon */}
                      {isCompanion && item.characterAvatar ? (
                        <Image
                          source={{ uri: item.characterAvatar }}
                          style={styles.avatarImg}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={[styles.updateIconWrap, { backgroundColor: isDark ? 'rgba(108,71,255,0.2)' : 'rgba(108,71,255,0.1)' }]}>
                          <Ionicons
                            name={item.badge === 'Upcoming' ? 'mic' : 'sparkles'}
                            size={20}
                            color="#6C47FF"
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
                          <Text style={[styles.timeAgo, { color: theme.muted }]}>{item.timeAgo}</Text>
                        </View>

                        <Text style={[styles.cardBodyText, { color: theme.secondary }]} numberOfLines={3}>
                          {item.body}
                        </Text>

                        {/* Action Footer */}
                        {isCompanion && item.characterId && (
                          <View style={styles.actionRow}>
                            <Pressable
                              onPress={() => handleOpenChat(item.characterId)}
                              style={[styles.replyBtn, { backgroundColor: theme.text }]}
                            >
                              <Ionicons name="chatbubble-ellipses" size={12} color={theme.background} />
                              <Text style={[styles.replyBtnText, { color: theme.background }]}>Reply to {item.characterName || 'Chat'}</Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    </LiquidGlassView>
                  </Pressable>
                );
              })
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
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bellWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  headerBadgeDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF3B30',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  markReadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  markReadText: {
    fontSize: 12,
    fontWeight: '600',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterRow: {
    flexDirection: 'row',
    paddingHorizontal: 18,
    paddingVertical: 10,
    gap: 8,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 18,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  infoBannerText: {
    fontSize: 11.5,
    fontWeight: '500',
    flex: 1,
  },
  listContainer: {
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 24,
    gap: 10,
  },
  cardWrap: {
    width: '100%',
  },
  cardGlass: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  avatarImg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(150,150,150,0.2)',
  },
  updateIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
    fontSize: 14,
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
  cardBodyText: {
    fontSize: 13,
    lineHeight: 18,
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
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  replyBtnText: {
    fontSize: 11.5,
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
