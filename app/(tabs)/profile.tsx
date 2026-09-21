import React, { useState, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Pressable,
  Image,
  ScrollView,
  Switch,
  Animated,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { useTheme } from '@/src/context/ThemeContext';
import { useAuth } from '@/src/context/AuthContext';
import { LiquidGlassView } from '@/src/components/LiquidGlassView';
import { GlowButton } from '@/src/components/GlowButton';
import { AuthModal } from '@/src/components/AuthModal';
import { getHapticsEnabled, setHapticsEnabled, triggerHaptic } from '@/src/lib/haptics';
import { fetchAppVersion, AppVersionInfo } from '@/src/lib/chatApi';

export default function ProfileScreen() {
  const { theme, isDark, toggleTheme } = useTheme();
  const { user, isGuest, logout } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [hapticsOn, setHapticsOn] = useState<boolean>(getHapticsEnabled());

  // ── Update Check State ────────────────────────────────────────────────────
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<AppVersionInfo | null>(null);
  const [updateChecked, setUpdateChecked] = useState(false);
  const [isUpToDate, setIsUpToDate] = useState(false);
  // Download progress
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0); // 0–1
  const [downloadDone, setDownloadDone] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const downloadTaskRef = useRef<FileSystem.DownloadTask | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoopRef = useRef<any>(null);

  const currentVer = Constants.expoConfig?.version || '1.0.0';
  const currentCode = (Constants.expoConfig as any)?.android?.versionCode || 1;

  const handleToggleHaptics = async () => {
    const next = !hapticsOn;
    setHapticsOn(next);
    await setHapticsEnabled(next);
    if (next) {
      triggerHaptic('medium');
    }
  };

  const startSpinLoop = () => {
    spinAnim.setValue(0);
    spinLoopRef.current = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      })
    );
    spinLoopRef.current.start();
  };

  const stopSpin = () => {
    if (spinLoopRef.current) spinLoopRef.current.stop();
    spinAnim.setValue(0);
  };

  const showUpdateBanner = () => {
    Animated.spring(bannerAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 60,
      friction: 9,
    }).start();
  };

  const handleCheckUpdate = async () => {
    triggerHaptic('light');
    setIsCheckingUpdate(true);
    setUpdateChecked(false);
    setUpdateInfo(null);
    setIsUpToDate(false);
    bannerAnim.setValue(0);
    startSpinLoop();

    try {
      const info = await fetchAppVersion();
      stopSpin();
      setUpdateChecked(true);
      if (info && (info.latestVersionCode > currentCode || info.latestVersion !== currentVer)) {
        setUpdateInfo(info);
        setIsUpToDate(false);
        showUpdateBanner();
        triggerHaptic('medium');
      } else {
        setIsUpToDate(true);
        triggerHaptic('light');
      }
    } catch {
      stopSpin();
      setUpdateChecked(true);
      setIsUpToDate(true);
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateInfo?.apkUrl) return;
    if (isDownloading) return;

    triggerHaptic('heavy');
    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadDone(false);
    setDownloadError(null);
    progressAnim.setValue(0);

    // Determine a string cache URI for file operations that still need strings
    const cacheUri = FileSystem.Paths.cache.uri;
    const fileUri = cacheUri + 'guidetalk_update.apk';

    try {
      // Delete any stale cached APK (fallback if needed)
      // the new v57 File can do this directly, but let's keep getInfoAsync if it still exists. wait, does getInfoAsync exist?
      // let's use the new File API for this.
      const destFile = new FileSystem.File(FileSystem.Paths.cache, 'guidetalk_update.apk');
      if (destFile.exists) {
        destFile.delete();
      }

      const downloadTask = FileSystem.File.createDownloadTask(
        updateInfo.apkUrl,
        destFile,
        {
          onProgress: (data) => {
            const { bytesWritten, totalBytes } = data;
            const ratio = totalBytes > 0 ? bytesWritten / totalBytes : 0;
            setDownloadProgress(ratio);
            Animated.timing(progressAnim, {
              toValue: ratio,
              duration: 120,
              useNativeDriver: false,
            }).start();
          },
        }
      );
      // Removed downloadResumable ref to simplify, unless user wants to pause

      const result = await downloadTask.downloadAsync();
      if (!result?.uri) throw new Error('Download failed');

      setDownloadProgress(1);
      progressAnim.setValue(1);
      setDownloadDone(true);
      triggerHaptic('medium');

      // Launch Android package installer
      if (Platform.OS === 'android') {
        const contentUri = await FileSystem.getContentUriAsync(result.uri);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
          type: 'application/vnd.android.package-archive',
        });
      }
    } catch (e: any) {
      setDownloadError('Download failed. Please try again.');
      triggerHaptic('light');
    } finally {
      setIsDownloading(false);
    }
  };

  const spinInterpolate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });


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

        {/* ── App Updates ─────────────────────────────────────────────────── */}
        <Text style={[styles.sectionTitle, { color: theme.text }]}>App Updates</Text>
        <LiquidGlassView style={styles.settingCard} borderRadius={18} intensity={25}>
          {/* Current version row */}
          <View style={styles.settingRow}>
            <View style={[styles.iconWrap, { backgroundColor: isDark ? 'rgba(10,132,255,0.18)' : 'rgba(10,132,255,0.12)' }]}>
              <Ionicons name="layers-outline" size={20} color="#0A84FF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingLabel, { color: theme.text }]}>Guide Talk</Text>
              <Text style={[styles.settingSub, { color: theme.secondary }]}>
                Version {currentVer} (build {currentCode})
              </Text>
            </View>
            {/* Check for updates button with spin icon */}
            <Pressable
              onPress={handleCheckUpdate}
              disabled={isCheckingUpdate}
              hitSlop={8}
              style={[
                styles.checkUpdateBtn,
                { backgroundColor: isDark ? 'rgba(10,132,255,0.15)' : 'rgba(10,132,255,0.1)', borderColor: 'rgba(10,132,255,0.35)' },
              ]}
            >
              <Animated.View style={{ transform: [{ rotate: spinInterpolate }] }}>
                <Ionicons name="refresh" size={15} color="#0A84FF" />
              </Animated.View>
              {!isCheckingUpdate && (
                <Text style={styles.checkUpdateBtnText}>
                  {updateChecked && isUpToDate ? 'Up to date ✓' : 'Check'}
                </Text>
              )}
            </Pressable>
          </View>

          {/* Up to date confirmation row */}
          {updateChecked && isUpToDate && (
            <View style={styles.upToDateRow}>
              <Ionicons name="checkmark-circle" size={15} color="#30D158" />
              <Text style={[styles.upToDateText, { color: '#30D158' }]}>
                You are on the latest version
              </Text>
            </View>
          )}
        </LiquidGlassView>

        {/* ── Update Available Banner ──────────────────────────────────────── */}
        {updateInfo && (
          <Animated.View
            style={{
              opacity: bannerAnim,
              transform: [{ scale: bannerAnim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }) }],
              marginBottom: 10,
            }}
          >
            <LiquidGlassView
              style={[styles.updateBanner, { borderColor: 'rgba(10,132,255,0.45)' }]}
              borderRadius={20}
              intensity={35}
              elevated
            >
              {/* Banner Header */}
              <View style={styles.updateBannerHeader}>
                <View style={[styles.updateIconBig, { backgroundColor: 'rgba(10,132,255,0.15)' }]}>
                  <Ionicons name="rocket-outline" size={26} color="#0A84FF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.updateBannerTitle, { color: theme.text }]}>
                    {updateInfo.title || 'New Update Available'}
                  </Text>
                  <Text style={[styles.updateBannerVersion, { color: '#0A84FF' }]}>
                    Version {updateInfo.latestVersion} is ready to install
                  </Text>
                </View>
                <View style={[styles.updateNewBadge, { backgroundColor: '#0A84FF' }]}>
                  <Text style={styles.updateNewBadgeText}>NEW</Text>
                </View>
              </View>

              {updateInfo.message ? (
                <Text style={[styles.updateBannerMessage, { color: theme.secondary }]}>
                  {updateInfo.message}
                </Text>
              ) : null}

              {/* Feature list */}
              {Array.isArray(updateInfo.releaseNotes) && updateInfo.releaseNotes.length > 0 && (
                <View style={styles.featureList}>
                  <Text style={[styles.featureListTitle, { color: theme.text }]}>What's New</Text>
                  {updateInfo.releaseNotes.map((note, i) => (
                    <View key={i} style={styles.featureRow}>
                      <Ionicons name="checkmark-circle" size={13} color="#0A84FF" style={{ marginTop: 2 }} />
                      <Text style={[styles.featureText, { color: theme.secondary }]}>{note}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* ── Download Progress Bar ── */}
              {isDownloading && (
                <View style={styles.downloadProgressWrap}>
                  <View style={styles.downloadProgressHeader}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="cloud-download-outline" size={14} color="#0A84FF" />
                      <Text style={[styles.downloadProgressLabel, { color: theme.text }]}>Downloading update...</Text>
                    </View>
                    <Text style={[styles.downloadPercent, { color: '#0A84FF' }]}>
                      {Math.round(downloadProgress * 100)}%
                    </Text>
                  </View>
                  {/* Track */}
                  <View style={[styles.progressTrack, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)' }]}>
                    <Animated.View
                      style={[
                        styles.progressFill,
                        {
                          width: progressAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          }),
                        },
                      ]}
                    />
                  </View>
                </View>
              )}

              {/* ── Download Complete ── */}
              {downloadDone && !isDownloading && (
                <View style={styles.downloadDoneRow}>
                  <View style={[styles.downloadDoneIcon, { backgroundColor: 'rgba(52,199,89,0.15)' }]}>
                    <Ionicons name="checkmark-done-circle" size={18} color="#30D158" />
                  </View>
                  <Text style={[styles.downloadDoneText, { color: '#30D158' }]}>
                    Download complete — installer launched
                  </Text>
                </View>
              )}

              {/* ── Download Error ── */}
              {downloadError && !isDownloading && (
                <View style={styles.downloadErrorRow}>
                  <Ionicons name="alert-circle-outline" size={14} color="#FF3B30" />
                  <Text style={[styles.downloadErrorText, { color: '#FF3B30' }]}>{downloadError}</Text>
                </View>
              )}

              {/* ── Install Button ── */}
              <Pressable
                onPress={handleInstallUpdate}
                disabled={isDownloading || downloadDone}
                style={({ pressed }) => [
                  styles.installBtn,
                  (isDownloading || downloadDone) && styles.installBtnDisabled,
                  pressed && !isDownloading && !downloadDone && { opacity: 0.88 },
                ]}
              >
                <View style={styles.installBtnInner}>
                  {isDownloading ? (
                    <>
                      <Ionicons name="cloud-download" size={17} color="#FFFFFF" />
                      <Text style={styles.installBtnText}>Downloading {Math.round(downloadProgress * 100)}%</Text>
                    </>
                  ) : downloadDone ? (
                    <>
                      <Ionicons name="checkmark-circle" size={17} color="#FFFFFF" />
                      <Text style={styles.installBtnText}>Installing...</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="download" size={17} color="#FFFFFF" />
                      <Text style={styles.installBtnText}>Download & Install</Text>
                      <Ionicons name="chevron-forward" size={15} color="rgba(255,255,255,0.7)" />
                    </>
                  )}
                </View>
              </Pressable>
            </LiquidGlassView>
          </Animated.View>
        )}

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
  // ── Update styles ──────────────────────────────────────────────────────────
  checkUpdateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
  },
  checkUpdateBtnText: {
    fontSize: 11.5,
    fontWeight: '700',
    color: '#0A84FF',
  },
  upToDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(150,150,150,0.2)',
  },
  upToDateText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  updateBanner: {
    padding: 18,
    borderWidth: 1.5,
  },
  updateBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 10,
  },
  updateIconBig: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateBannerTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  updateBannerVersion: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  updateNewBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  updateNewBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  updateBannerMessage: {
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
  },
  featureList: {
    marginBottom: 14,
  },
  featureListTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    marginBottom: 5,
  },
  featureText: {
    fontSize: 12.5,
    lineHeight: 18,
    flex: 1,
  },
  installBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A84FF',
    paddingVertical: 15,
    borderRadius: 16,
    shadowColor: '#0A84FF',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.38,
    shadowRadius: 12,
    elevation: 6,
    marginTop: 2,
  },
  installBtnDisabled: {
    backgroundColor: 'rgba(10,132,255,0.55)',
    shadowOpacity: 0.12,
    elevation: 2,
  },
  installBtnInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  installBtnText: {
    color: '#FFFFFF',
    fontSize: 14.5,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  // ── Download Progress ──────────────────────────────────────────────────────
  downloadProgressWrap: {
    marginBottom: 14,
    marginTop: 2,
  },
  downloadProgressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  downloadProgressLabel: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  downloadPercent: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#0A84FF',
  },
  downloadDoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(52,199,89,0.1)',
  },
  downloadDoneIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  downloadDoneText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  downloadErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,59,48,0.1)',
  },
  downloadErrorText: {
    fontSize: 12.5,
    fontWeight: '600',
    flex: 1,
  },
});


