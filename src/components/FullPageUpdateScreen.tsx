import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Animated,
  Platform,
  ActivityIndicator,
  Linking,
  Dimensions,
  StatusBar,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import * as FileSystemLegacy from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { useTheme } from '@/src/context/ThemeContext';
import { GlowButton } from './GlowButton';
import { triggerHaptic } from '@/src/lib/haptics';
import { AppVersionInfo } from '@/src/lib/chatApi';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface FullPageUpdateScreenProps {
  updateInfo: AppVersionInfo | null;
  otaUpdateAvailable?: boolean;
  onDismiss: () => void;
}

const UPDATE_FEATURES = [
  {
    icon: 'shield-checkmark' as const,
    color: '#30D158',
    title: 'Production Gmail Auth & OTP',
    description: 'Guaranteed account safety with 6-digit email verification. Your chats, profiles, and custom companions stay 100% intact.',
  },
  {
    icon: 'finger-print' as const,
    color: '#0A84FF',
    title: 'Native Passkey & Biometrics',
    description: 'Instant 1-tap sign in with Apple Face ID, Touch ID, and Android biometrics. No passwords or OTP codes needed.',
  },
  {
    icon: 'sparkles' as const,
    color: '#F4CD2A',
    title: 'Live Character Art & AniList',
    description: 'Verified anime and cinema portraits rendered in ultra-sharp HD with official look previews and alternate styles.',
  },
  {
    icon: 'flash' as const,
    color: '#BF5AF2',
    title: 'Full-Page Home Updates',
    description: 'In-app download & reload without browser redirects or intrusive popup interruptions.',
  },
];

export function FullPageUpdateScreen({
  updateInfo,
  otaUpdateAvailable = false,
  onDismiss,
}: FullPageUpdateScreenProps) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadBytes, setDownloadBytes] = useState<{ written: number; total: number } | null>(null);
  const [downloadDone, setDownloadDone] = useState(false);
  const [downloadedUri, setDownloadedUri] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const progressAnim = useRef(new Animated.Value(0)).current;

  const rawApkUrl = updateInfo?.apkUrl || '';
  const directApk = rawApkUrl.toLowerCase().includes('.apk')
    ? rawApkUrl
    : 'https://expo.dev/artifacts/eas/1Ocs_q69VOCzESXZZVcXGFIkgNVKolLQ7ZUI3bRTYc0.apk';

  const handleUpdatePress = async () => {
    // If download is already completed, re-trigger action immediately
    if (downloadDone) {
      if (otaUpdateAvailable && !updateInfo?.apkUrl) {
        await Updates.reloadAsync();
        return;
      }
      if (Platform.OS === 'android' && downloadedUri) {
        try {
          const contentUri = await FileSystemLegacy.getContentUriAsync(downloadedUri);
          await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data: contentUri,
            flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
            type: 'application/vnd.android.package-archive',
          });
          return;
        } catch (e) {
          Linking.openURL(directApk).catch(() => {});
          return;
        }
      }
    }

    if (isDownloading) return;

    triggerHaptic('heavy');
    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadBytes(null);
    setDownloadDone(false);
    setDownloadError(null);
    progressAnim.setValue(0);

    // 1. In-app Expo OTA update: ONLY execute when genuine JS OTA update is available AND no native APK url provided
    if (otaUpdateAvailable && !updateInfo?.apkUrl && Updates.isEnabled && Platform.OS !== 'web') {
      let currentP = 0.08;
      setDownloadProgress(currentP);
      progressAnim.setValue(currentP);

      const otaProgressInterval = setInterval(() => {
        currentP = Math.min(currentP + 0.12, 0.92);
        setDownloadProgress(currentP);
        Animated.timing(progressAnim, {
          toValue: currentP,
          duration: 250,
          useNativeDriver: false,
        }).start();
      }, 300);

      try {
        await Updates.fetchUpdateAsync();
        clearInterval(otaProgressInterval);

        setDownloadProgress(1);
        Animated.timing(progressAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: false,
        }).start();

        setDownloadDone(true);
        triggerHaptic('success');
        setTimeout(async () => {
          await Updates.reloadAsync();
        }, 800);
        return;
      } catch (err: any) {
        clearInterval(otaProgressInterval);
        console.log('OTA fetch failed, falling back to direct APK:', err);
      }
    }

    // 2. Direct APK download inside app & launch Android installer
    if (Platform.OS === 'android') {
      try {
        const targetUri = `${FileSystemLegacy.cacheDirectory}guidetalk_update.apk`;

        try {
          const existingInfo = await FileSystemLegacy.getInfoAsync(targetUri);
          if (existingInfo.exists) {
            await FileSystemLegacy.deleteAsync(targetUri, { idempotent: true });
          }
        } catch {}

        const downloadResumable = FileSystemLegacy.createDownloadResumable(
          directApk,
          targetUri,
          {},
          (data) => {
            const { totalBytesWritten, totalBytesExpectedToWrite } = data;
            const ratio = totalBytesExpectedToWrite > 0 ? totalBytesWritten / totalBytesExpectedToWrite : 0;
            setDownloadProgress(ratio);
            setDownloadBytes({ written: totalBytesWritten, total: totalBytesExpectedToWrite });
            Animated.timing(progressAnim, {
              toValue: ratio,
              duration: 100,
              useNativeDriver: false,
            }).start();
          }
        );

        const result = await downloadResumable.downloadAsync();
        if (!result?.uri) {
          throw new Error('APK download failed: No file URI received.');
        }

        setDownloadedUri(result.uri);
        setDownloadProgress(1);
        Animated.timing(progressAnim, {
          toValue: 1,
          duration: 150,
          useNativeDriver: false,
        }).start();

        setDownloadDone(true);
        setIsDownloading(false);
        triggerHaptic('success');

        try {
          const contentUri = await FileSystemLegacy.getContentUriAsync(result.uri);
          await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
            data: contentUri,
            flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
            type: 'application/vnd.android.package-archive',
          });
        } catch (intentErr) {
          console.log('Intent launcher failed, falling back to browser:', intentErr);
          await Linking.openURL(directApk);
        }
        return;
      } catch (apkErr: any) {
        console.log('APK download error:', apkErr);
        setDownloadError(apkErr?.message || 'Failed to download installer within app.');
        setIsDownloading(false);
        // Direct browser fallback on error
        Linking.openURL(directApk).catch(() => {});
        return;
      }
    }

    if (rawApkUrl && (Platform.OS as string) !== 'android') {
      Linking.openURL(rawApkUrl).catch(() => {});
      setIsDownloading(false);
      return;
    }

    setDownloadError('Update could not be applied automatically.');
    setIsDownloading(false);
  };

  const versionTag = updateInfo?.latestVersion ? `v${updateInfo.latestVersion}` : 'v1.0.8';
  const notes = updateInfo?.releaseNotes && updateInfo.releaseNotes.length > 0
    ? updateInfo.releaseNotes
    : [
        'Production Gmail Authentication & 6-digit OTP verification',
        'Face ID, Touch ID & native Passkey 1-tap sign in',
        'Full-page update presentation directly on Home',
        'Zero-placeholder authentic character portraits & AniList lookup',
        'Storyline memory retention and account data preservation',
      ];

  const formatBytes = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#05070E' : '#F4F6FB' }]}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Ambient background glows */}
      <View pointerEvents="none" style={styles.ambientGlowContainer}>
        <LinearGradient
          colors={['rgba(10, 132, 255, 0.28)', 'rgba(94, 92, 230, 0.15)', 'transparent']}
          style={[styles.glowOrb, { top: -80, right: -40 }]}
        />
        <LinearGradient
          colors={['rgba(191, 90, 242, 0.22)', 'rgba(255, 45, 85, 0.1)', 'transparent']}
          style={[styles.glowOrb, { bottom: 100, left: -60 }]}
        />
      </View>

      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {/* Top Header */}
        <View style={styles.topBar}>
          <View style={styles.topBadge}>
            <Ionicons name="sparkles" size={13} color="#F4CD2A" style={{ marginRight: 6 }} />
            <Text style={styles.topBadgeText}>WHAT'S NEW IN GUIDETALK</Text>
          </View>
          {!updateInfo?.forceUpdate && (
            <Pressable
              onPress={onDismiss}
              style={[
                styles.closeButton,
                { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
              ]}
              hitSlop={12}
            >
              <Ionicons name="close" size={20} color={theme.text} />
            </Pressable>
          )}
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 120 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Hero Section */}
          <View style={styles.heroSection}>
            <View style={styles.versionPill}>
              <View style={styles.pulsingDot} />
              <Text style={styles.versionPillText}>{versionTag} Ready</Text>
            </View>
            <Text style={[styles.heroTitle, { color: theme.text }]}>
              {updateInfo?.title || 'Experience The New GuideTalk'}
            </Text>
            <Text style={[styles.heroSubtitle, { color: theme.secondary }]}>
              {updateInfo?.message ||
                'A landmark upgrade featuring production Gmail verification, native Face ID passkeys, and verified high-definition companions.'}
            </Text>
          </View>

          {/* Feature Highlights Grid */}
          <Text style={[styles.sectionHeading, { color: theme.text }]}>Feature Highlights</Text>
          <View style={styles.featuresContainer}>
            {UPDATE_FEATURES.map((feature, idx) => (
              <View
                key={`feat-${idx}`}
                style={[
                  styles.featureCard,
                  {
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : '#FFFFFF',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
                  },
                ]}
              >
                <View style={[styles.featureIconBox, { backgroundColor: `${feature.color}1F` }]}>
                  <Ionicons name={feature.icon} size={22} color={feature.color} />
                </View>
                <View style={styles.featureInfo}>
                  <Text style={[styles.featureTitle, { color: theme.text }]}>{feature.title}</Text>
                  <Text style={[styles.featureDescription, { color: theme.secondary }]}>
                    {feature.description}
                  </Text>
                </View>
              </View>
            ))}
          </View>

          {/* Release Notes List */}
          <Text style={[styles.sectionHeading, { color: theme.text, marginTop: 28 }]}>
            Changelog & Improvements
          </Text>
          <View
            style={[
              styles.changelogCard,
              {
                backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : '#FFFFFF',
                borderColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
              },
            ]}
          >
            {notes.map((note, index) => (
              <View key={`note-${index}`} style={styles.noteRow}>
                <View style={styles.checkCircle}>
                  <Ionicons name="checkmark" size={12} color="#30D158" />
                </View>
                <Text style={[styles.noteText, { color: theme.text }]}>{note}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* Bottom Floating Action Bar */}
        <View
          style={[
            styles.bottomBar,
            {
              backgroundColor: isDark ? 'rgba(5, 7, 14, 0.95)' : 'rgba(244, 246, 251, 0.95)',
              borderTopColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)',
              paddingBottom: insets.bottom + 8,
            },
          ]}
        >
          {isDownloading && (
            <View style={styles.progressContainer}>
              <View style={styles.progressTextRow}>
                <Text style={[styles.progressLabel, { color: theme.text }]}>
                  {downloadDone ? 'Update Ready' : 'Downloading update...'}
                </Text>
                <Text style={[styles.progressPercent, { color: '#0A84FF' }]}>
                  {Math.round(downloadProgress * 100)}%
                </Text>
              </View>

              <View style={[styles.progressBarTrack, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }]}>
                <Animated.View
                  style={[
                    styles.progressBarFill,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              </View>

              {downloadBytes && downloadBytes.total > 0 && (
                <Text style={[styles.bytesText, { color: theme.secondary }]}>
                  {formatBytes(downloadBytes.written)} of {formatBytes(downloadBytes.total)}
                </Text>
              )}
            </View>
          )}

          {downloadError && (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={16} color="#FF453A" style={{ marginRight: 6 }} />
              <Text style={styles.errorText}>{downloadError}</Text>
            </View>
          )}

          <View style={styles.actionButtonsRow}>
            <GlowButton
              label={
                isDownloading
                  ? downloadDone
                    ? 'Launching Installer...'
                    : 'Downloading APK...'
                  : downloadDone
                  ? (otaUpdateAvailable && !updateInfo?.apkUrl ? 'Reload App' : 'Launch Package Installer')
                  : (otaUpdateAvailable && !updateInfo?.apkUrl ? 'Download & Reload Update' : 'Download & Install APK')
              }
              onPress={handleUpdatePress}
              variant="primary"
              style={styles.primaryActionButton}
              disabled={isDownloading && !downloadDone}
            />

            {Platform.OS === 'android' && (
              <Pressable
                onPress={() => {
                  triggerHaptic('light');
                  Linking.openURL(directApk).catch(() => {});
                }}
                style={styles.directBrowserButton}
                hitSlop={8}
              >
                <Ionicons name="cloud-download-outline" size={14} color="#0A84FF" style={{ marginRight: 6 }} />
                <Text style={styles.directBrowserText}>
                  Direct Browser Download (APK)
                </Text>
              </Pressable>
            )}

            {!updateInfo?.forceUpdate && (
              <Pressable
                onPress={onDismiss}
                style={[
                  styles.skipButton,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' },
                ]}
              >
                <Text style={[styles.skipButtonText, { color: theme.secondary }]}>
                  Continue to Home
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  ambientGlowContainer: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  glowOrb: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  topBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(244, 205, 42, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 205, 42, 0.28)',
  },
  topBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#F4CD2A',
    letterSpacing: 0.8,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  heroSection: {
    marginBottom: 24,
  },
  versionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(10, 132, 255, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(10, 132, 255, 0.3)',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 12,
  },
  pulsingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#0A84FF',
    marginRight: 6,
  },
  versionPillText: {
    color: '#0A84FF',
    fontSize: 12,
    fontWeight: '700',
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.6,
    lineHeight: 34,
    marginBottom: 8,
  },
  heroSubtitle: {
    fontSize: 14,
    lineHeight: 22,
  },
  sectionHeading: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: 12,
  },
  featuresContainer: {
    gap: 12,
  },
  featureCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
  },
  featureIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  featureInfo: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 4,
  },
  featureDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  changelogCard: {
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    gap: 12,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  checkCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(48, 209, 88, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    marginTop: 2,
  },
  noteText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 19,
  },
  bottomBar: {
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 14,
  },
  progressContainer: {
    marginBottom: 12,
  },
  progressTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  progressPercent: {
    fontSize: 12,
    fontWeight: '800',
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#0A84FF',
    borderRadius: 3,
  },
  bytesText: {
    fontSize: 11,
    marginTop: 4,
    textAlign: 'right',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 69, 58, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 10,
  },
  errorText: {
    color: '#FF453A',
    fontSize: 12,
    flex: 1,
  },
  actionButtonsRow: {
    gap: 10,
  },
  primaryActionButton: {
    width: '100%',
  },
  skipButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 16,
  },
  skipButtonText: {
    fontSize: 14,
    fontWeight: '600',
  },
  directBrowserButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    marginTop: 4,
  },
  directBrowserText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0A84FF',
  },
});
