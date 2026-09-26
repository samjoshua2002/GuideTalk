import React, { useState, useRef } from 'react';
import {
  Modal,
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
} from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import { useTheme } from '@/src/context/ThemeContext';
import { LiquidGlassView } from './LiquidGlassView';
import { GlowButton } from './GlowButton';
import { triggerHaptic } from '@/src/lib/haptics';
import { AppVersionInfo } from '@/src/lib/chatApi';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface NewVersionModalProps {
  visible: boolean;
  updateInfo: AppVersionInfo | null;
  otaUpdateAvailable?: boolean;
  onDismiss: () => void;
}

const DEFAULT_FEATURE_HIGHLIGHTS = [
  {
    icon: 'sparkles' as const,
    color: '#F4CD2A',
    title: 'AniList & Live Character Art',
    description: 'Instant authentic anime & cinema portraits fetched dynamically with zero dummy placeholders.',
  },
  {
    icon: 'images' as const,
    color: '#0A84FF',
    title: 'Companion Look Switcher',
    description: 'Preview and cycle verified outfits, official posters, and alternate looks directly in your chat.',
  },
  {
    icon: 'notifications' as const,
    color: '#30D158',
    title: 'Smart Push Reminders',
    description: 'Receive thoughtful in-character check-ins on your Android status bar and lockscreen.',
  },
  {
    icon: 'flash' as const,
    color: '#BF5AF2',
    title: 'Zero-Latency AI Streaming',
    description: 'Ultra-fast roleplay generation, dynamic voices, and persistent context memory across chats.',
  },
];

export function NewVersionModal({
  visible,
  updateInfo,
  otaUpdateAvailable = false,
  onDismiss,
}: NewVersionModalProps) {
  const { theme, isDark } = useTheme();

  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadBytes, setDownloadBytes] = useState<{ written: number; total: number } | null>(null);
  const [downloadDone, setDownloadDone] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const progressAnim = useRef(new Animated.Value(0)).current;

  const handleUpdatePress = async () => {
    if (!updateInfo?.apkUrl && !otaUpdateAvailable) return;
    if (isDownloading) return;

    triggerHaptic('heavy');
    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadBytes(null);
    setDownloadDone(false);
    setDownloadError(null);
    progressAnim.setValue(0);

    // 1. Expo OTA update
    if (otaUpdateAvailable && Updates.isEnabled) {
      try {
        await Updates.fetchUpdateAsync();
        setDownloadDone(true);
        triggerHaptic('success');
        setTimeout(async () => {
          await Updates.reloadAsync();
        }, 1200);
        return;
      } catch (err: any) {
        setDownloadError(err?.message || 'OTA update failed to apply.');
        setIsDownloading(false);
        return;
      }
    }

    const apkUrl = updateInfo?.apkUrl || '';
    const isDirectApk = apkUrl.toLowerCase().split('?')[0].endsWith('.apk');

    // 2. Web or non-Android redirect
    if (!isDirectApk || Platform.OS !== 'android') {
      try {
        await Linking.openURL(apkUrl);
        setIsDownloading(false);
      } catch {
        setDownloadError('Unable to open update link.');
        setIsDownloading(false);
      }
      return;
    }

    // 3. Android APK direct download and package installer
    try {
      const destFile = new FileSystem.File(FileSystem.Paths.cache, 'guidetalk_update.apk');
      if (destFile.exists) {
        try {
          destFile.delete();
        } catch {}
      }

      const downloadTask = FileSystem.File.createDownloadTask(apkUrl, destFile, {
        onProgress: (data) => {
          const { bytesWritten, totalBytes } = data;
          const ratio = totalBytes > 0 ? bytesWritten / totalBytes : 0;
          setDownloadProgress(ratio);
          setDownloadBytes({ written: bytesWritten, total: totalBytes });
          Animated.timing(progressAnim, {
            toValue: ratio,
            duration: 100,
            useNativeDriver: false,
          }).start();
        },
      });

      const result = await downloadTask.downloadAsync();
      if (!result?.uri) {
        throw new Error('Download failed: No file URI received.');
      }

      setDownloadProgress(1);
      progressAnim.setValue(1);

      try {
        const contentUri = await FileSystem.getContentUriAsync(result.uri);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
          type: 'application/vnd.android.package-archive',
        });
        setDownloadDone(true);
      } catch (installErr: any) {
        try {
          await Linking.openURL(apkUrl);
        } catch {
          setDownloadError('Installer could not launch automatically.');
        }
      }
    } catch (err: any) {
      setDownloadError(err?.message || 'Download failed. Please check internet connection.');
    } finally {
      setIsDownloading(false);
    }
  };

  const versionTag = updateInfo?.latestVersion ? `v${updateInfo.latestVersion}` : 'New Version';

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        {Platform.OS !== 'web' && (
          <BlurView
            intensity={isDark ? 85 : 55}
            tint={isDark ? 'dark' : 'light'}
            style={StyleSheet.absoluteFill}
          />
        )}
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: isDark ? 'rgba(5, 7, 14, 0.88)' : 'rgba(240, 243, 248, 0.92)' },
          ]}
        />

        <View style={styles.centerContainer}>
          <LiquidGlassView
            style={styles.modalCard}
            borderRadius={32}
            intensity={45}
            elevated
          >
            {/* Header Badge */}
            <View style={styles.topBadgeRow}>
              <View style={styles.sparkleBadge}>
                <Ionicons name="sparkles" size={13} color="#F4CD2A" style={{ marginRight: 5 }} />
                <Text style={styles.sparkleBadgeText}>WHAT'S NEW</Text>
              </View>
              <View style={[styles.versionChip, { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }]}>
                <Text style={[styles.versionChipText, { color: theme.text }]}>
                  {versionTag} Available
                </Text>
              </View>
            </View>

            {/* Title & Headline */}
            <Text style={[styles.title, { color: theme.text }]}>
              {updateInfo?.title || 'Discover New Features'}
            </Text>
            <Text style={[styles.subtitle, { color: theme.secondary }]}>
              {updateInfo?.message || 'A major upgrade is ready to elevate your companion roleplay experience.'}
            </Text>

            {/* Features List */}
            <ScrollView
              style={styles.featuresScroll}
              contentContainerStyle={styles.featuresScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {DEFAULT_FEATURE_HIGHLIGHTS.map((item, idx) => (
                <View key={idx} style={[styles.featureRow, { borderColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)' }]}>
                  <View style={[styles.iconWrap, { backgroundColor: `${item.color}18` }]}>
                    <Ionicons name={item.icon} size={20} color={item.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.featureTitle, { color: theme.text }]}>
                      {item.title}
                    </Text>
                    <Text style={[styles.featureDesc, { color: theme.secondary }]}>
                      {item.description}
                    </Text>
                  </View>
                </View>
              ))}

              {Array.isArray(updateInfo?.releaseNotes) && updateInfo.releaseNotes.length > 0 && (
                <View style={styles.notesSection}>
                  <Text style={[styles.notesSectionTitle, { color: theme.text }]}>Release Notes</Text>
                  {updateInfo.releaseNotes.map((note, idx) => (
                    <View key={idx} style={styles.bulletRow}>
                      <Ionicons name="checkmark-circle" size={14} color="#30D158" style={{ marginTop: 2, marginRight: 6 }} />
                      <Text style={[styles.bulletText, { color: theme.secondary }]}>{note}</Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>

            {/* Progress / Status banner during download */}
            {isDownloading && (
              <View style={styles.progressContainer}>
                <View style={styles.progressHeader}>
                  <Text style={[styles.progressLabel, { color: theme.text }]}>
                    Downloading Update... {Math.round(downloadProgress * 100)}%
                  </Text>
                  <ActivityIndicator size="small" color="#F4CD2A" />
                </View>
                <View style={[styles.progressBarBg, { backgroundColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }]}>
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
              </View>
            )}

            {downloadDone && (
              <View style={styles.doneBanner}>
                <Ionicons name="checkmark-circle" size={16} color="#30D158" style={{ marginRight: 6 }} />
                <Text style={styles.doneText}>Download complete — installer launched!</Text>
              </View>
            )}

            {downloadError && (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={16} color="#FF453A" style={{ marginRight: 6 }} />
                <Text style={styles.errorText} numberOfLines={2}>
                  {downloadError}
                </Text>
              </View>
            )}

            {/* Actions */}
            <View style={styles.actionContainer}>
              <GlowButton
                label={isDownloading ? 'Installing Update...' : `Update Now (${versionTag})`}
                onPress={handleUpdatePress}
                disabled={isDownloading}
                variant="primary"
                style={{ width: '100%' }}
              />

              <Pressable
                onPress={() => {
                  triggerHaptic('light');
                  onDismiss();
                }}
                disabled={isDownloading}
                hitSlop={10}
                style={({ pressed }) => [styles.skipBtn, pressed && { opacity: 0.6 }]}
              >
                <Text style={[styles.skipBtnText, { color: theme.secondary }]}>
                  Skip for now
                </Text>
              </Pressable>
            </View>
          </LiquidGlassView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },
  centerContainer: {
    width: '100%',
    maxWidth: 440,
    maxHeight: SCREEN_HEIGHT * 0.88,
  },
  modalCard: {
    padding: 24,
    borderWidth: 1.2,
    borderColor: 'rgba(244, 205, 42, 0.25)',
  },
  topBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sparkleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(244, 205, 42, 0.16)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 205, 42, 0.3)',
  },
  sparkleBadgeText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#F4CD2A',
    letterSpacing: 0.8,
  },
  versionChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  versionChipText: {
    fontSize: 11,
    fontWeight: '600',
  },
  title: {
    fontSize: 23,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 18,
  },
  featuresScroll: {
    maxHeight: 280,
    marginBottom: 16,
  },
  featuresScrollContent: {
    gap: 12,
    paddingVertical: 2,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  featureDesc: {
    fontSize: 11.5,
    lineHeight: 16,
  },
  notesSection: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)',
  },
  notesSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 6,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  bulletText: {
    fontSize: 12,
    lineHeight: 17,
    flex: 1,
  },
  progressContainer: {
    marginBottom: 14,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  progressBarBg: {
    height: 7,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#F4CD2A',
    borderRadius: 4,
  },
  doneBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(48, 209, 88, 0.12)',
    padding: 10,
    borderRadius: 12,
    marginBottom: 14,
  },
  doneText: {
    fontSize: 12,
    color: '#30D158',
    fontWeight: '600',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 69, 58, 0.12)',
    padding: 10,
    borderRadius: 12,
    marginBottom: 14,
  },
  errorText: {
    fontSize: 12,
    color: '#FF453A',
    flex: 1,
  },
  actionContainer: {
    alignItems: 'center',
    gap: 10,
  },
  skipBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  skipBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
