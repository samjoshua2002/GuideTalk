import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Image,
  ScrollView,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/context/ThemeContext';
import { useAuth } from '@/src/context/AuthContext';
import { LiquidGlassView } from '@/src/components/LiquidGlassView';
import { GlowButton } from '@/src/components/GlowButton';
import { AuthModal } from '@/src/components/AuthModal';
import { getHapticsEnabled, setHapticsEnabled, triggerHaptic } from '@/src/lib/haptics';

export default function ProfileScreen() {
  const { theme, isDark, toggleTheme } = useTheme();
  const { user, isGuest, logout } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [hapticsOn, setHapticsOn] = useState<boolean>(getHapticsEnabled());

  const handleToggleHaptics = async () => {
    const next = !hapticsOn;
    setHapticsOn(next);
    await setHapticsEnabled(next);
    if (next) {
      triggerHaptic('medium');
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Text style={[styles.eyebrow, { color: theme.secondary }]}>IOS LIQUID GLASS</Text>
        <Text style={[styles.title, { color: theme.text }]}>Profile & Settings</Text>

        {/* User Card */}
        <LiquidGlassView style={styles.profileCard} borderRadius={24} intensity={35} elevated>
          <View style={styles.profileHeader}>
            <Image
              source={{
                uri:
                  user?.avatarUrl ||
                  `https://api.dicebear.com/9.x/adventurer/png?seed=${encodeURIComponent(user?.username || 'Guest')}&backgroundColor=000000`,
              }}
              style={styles.avatar}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: theme.text }]}>
                {user?.name || (isGuest ? 'Guest Traveler' : user?.username)}
              </Text>
              <Text style={[styles.username, { color: theme.secondary }]}>
                {user ? `@${user.username} · MongoDB Cloud Active` : 'Guest Mode (Local Session)'}
              </Text>
              {(user?.age || user?.language) && (
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 6 }}>
                  {user.age && (
                    <View style={[styles.profileBadge, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}>
                      <Ionicons name="calendar-outline" size={11} color={theme.secondary} />
                      <Text style={[styles.profileBadgeText, { color: theme.text }]}>{user.age} yrs</Text>
                    </View>
                  )}
                  {user.language && (
                    <View style={[styles.profileBadge, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}>
                      <Ionicons name="language-outline" size={11} color={theme.secondary} />
                      <Text style={[styles.profileBadgeText, { color: theme.text }]}>{user.language.toUpperCase()}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </View>

          <View style={{ marginTop: 16 }}>
            {user ? (
              <GlowButton
                label="Sign Out"
                variant="glass"
                icon={<Ionicons name="log-out-outline" size={16} color={theme.text} />}
                onPress={logout}
              />
            ) : (
              <GlowButton
                label="Sign In / Create Account"
                icon={<Ionicons name="log-in-outline" size={16} color={theme.background} />}
                onPress={() => setShowAuthModal(true)}
              />
            )}
          </View>
        </LiquidGlassView>

        {/* Appearance (Dark / Light) */}
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Appearance</Text>
        <LiquidGlassView style={styles.settingCard} borderRadius={18} intensity={25}>
          <View style={styles.settingRow}>
            <View style={[styles.iconWrap, { backgroundColor: theme.surfaceSecondary }]}>
              <Ionicons name={isDark ? 'moon' : 'sunny'} size={20} color={theme.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingLabel, { color: theme.text }]}>Liquid Glass Theme</Text>
              <Text style={[styles.settingSub, { color: theme.secondary }]}>
                Current: {isDark ? 'Dark Glass' : 'Light Glass'}
              </Text>
            </View>
            <Pressable
              onPress={toggleTheme}
              style={[styles.toggleBtn, { backgroundColor: theme.text }]}
            >
              <Text style={[styles.toggleBtnText, { color: theme.background }]}>
                Switch to {isDark ? 'Light' : 'Dark'}
              </Text>
            </Pressable>
          </View>

          {/* Divider */}
          <View style={[styles.settingDivider, { backgroundColor: theme.border }]} />

          {/* Haptic Feedback Toggle */}
          <View style={styles.settingRow}>
            <View style={[styles.iconWrap, { backgroundColor: theme.surfaceSecondary }]}>
              <Ionicons name="phone-portrait-outline" size={20} color={theme.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingLabel, { color: theme.text }]}>Haptic Feedback</Text>
              <Text style={[styles.settingSub, { color: theme.secondary }]}>
                {hapticsOn ? 'Vibration on taps & actions' : 'Vibration disabled'}
              </Text>
            </View>
            <Switch
              value={hapticsOn}
              onValueChange={handleToggleHaptics}
              trackColor={{ false: theme.border, true: '#34C759' }}
              thumbColor={hapticsOn ? '#fff' : theme.secondary}
              ios_backgroundColor={theme.border}
            />
          </View>
        </LiquidGlassView>

        {/* AI & Backend Engine Diagnostics */}
        <Text style={[styles.sectionTitle, { color: theme.text }]}>AI Engine Diagnostics</Text>
        <LiquidGlassView style={styles.settingCard} borderRadius={18} intensity={25}>
          <View style={styles.diagRow}>
            <View style={[styles.statusDot, { backgroundColor: '#34C759' }]} />
            <Text style={[styles.diagLabel, { color: theme.text }]}>Azure OpenAI Connected</Text>
          </View>
          <View style={styles.diagItem}>
            <Text style={[styles.diagKey, { color: theme.secondary }]}>Primary RP Engine:</Text>
            <Text style={[styles.diagValue, { color: theme.text }]}>GPT-5.6 Luna</Text>
          </View>
          <View style={styles.diagItem}>
            <Text style={[styles.diagKey, { color: theme.secondary }]}>Photo & Vision Model:</Text>
            <Text style={[styles.diagValue, { color: theme.text }]}>GPT-4o Multimodal</Text>
          </View>
          <View style={styles.diagItem}>
            <Text style={[styles.diagKey, { color: theme.secondary }]}>Fast Chat Engine:</Text>
            <Text style={[styles.diagValue, { color: theme.text }]}>GPT-5.1 Chat</Text>
          </View>
          <View style={styles.diagItem}>
            <Text style={[styles.diagKey, { color: theme.secondary }]}>Database Storage:</Text>
            <Text style={[styles.diagValue, { color: theme.text }]}>MongoDB (Sessions & Lore)</Text>
          </View>
        </LiquidGlassView>

        {/* Privacy & Safe AI */}
        <Text style={[styles.sectionTitle, { color: theme.text }]}>Safety & Character Rules</Text>
        <LiquidGlassView style={styles.settingCard} borderRadius={18} intensity={25}>
          <Text style={[styles.safeText, { color: theme.secondary }]}>
            All characters feature customized emotional and sarcastic roleplay guidelines. Responses are produced by your configured Azure OpenAI models with end-to-end memory stored in your MongoDB collections.
          </Text>
        </LiquidGlassView>
      </ScrollView>

      <AuthModal visible={showAuthModal} onClose={() => setShowAuthModal(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  container: {
    padding: 14,
    paddingBottom: 90,
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
    marginBottom: 20,
    letterSpacing: -0.5,
  },
  profileCard: {
    padding: 20,
    marginBottom: 24,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  name: {
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  username: {
    fontSize: 12,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginTop: 18,
    marginBottom: 10,
    letterSpacing: -0.2,
  },
  settingCard: {
    padding: 16,
    marginBottom: 8,
    gap: 0,
  },
  settingDivider: {
    height: 1,
    marginVertical: 12,
    opacity: 0.4,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  settingSub: {
    fontSize: 12,
    marginTop: 1,
  },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
  },
  toggleBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  diagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  diagLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  diagItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  diagKey: {
    fontSize: 12,
  },
  diagValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  safeText: {
    fontSize: 12,
    lineHeight: 18,
  },
  profileBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  profileBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
});
