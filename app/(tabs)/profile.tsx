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
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import * as Updates from 'expo-updates';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/src/context/ThemeContext';
import { useAuth } from '@/src/context/AuthContext';
import { LiquidGlassView } from '@/src/components/LiquidGlassView';
import { GlowButton } from '@/src/components/GlowButton';
import { AuthModal } from '@/src/components/AuthModal';
import { EmailVerificationGate } from '@/src/components/EmailVerificationGate';
import { getHapticsEnabled, setHapticsEnabled, triggerHaptic } from '@/src/lib/haptics';
import { getEffectiveAppVersion, getEffectiveVersionCode, isRunningOtaUpdate } from '@/src/lib/version';
import { fetchAppVersion, AppVersionInfo } from '@/src/lib/chatApi';

export default function ProfileScreen() {
  const { theme, isDark, toggleTheme } = useTheme();
  const { user, isGuest, logout, updateProfile } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [hapticsOn, setHapticsOn] = useState<boolean>(getHapticsEnabled());
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarSuccessBanner, setAvatarSuccessBanner] = useState(false);

  // ── Name & Verification State ─────────────────────────────────────────────
  const [showEditNameModal, setShowEditNameModal] = useState(false);
  const [editNameInput, setEditNameInput] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [nameSavedBanner, setNameSavedBanner] = useState(false);
  const [showVerificationGate, setShowVerificationGate] = useState(false);

  // ── Update Check State ────────────────────────────────────────────────────
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<AppVersionInfo | null>(null);
  const [updateChecked, setUpdateChecked] = useState(false);
  const [isUpToDate, setIsUpToDate] = useState(false);
  const [otaUpdateAvailable, setOtaUpdateAvailable] = useState<boolean>(false);
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

  const currentVer = getEffectiveAppVersion();
  const currentCode = getEffectiveVersionCode();

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
    setOtaUpdateAvailable(false);
    setDownloadDone(false);
    setDownloadError(null);
    bannerAnim.setValue(0);
    startSpinLoop();

    try {
      // 1. Check Expo OTA updates if supported in this environment
      if (Updates.isEnabled) {
        try {
          const update = await Updates.checkForUpdateAsync();
          if (update.isAvailable) {
            setOtaUpdateAvailable(true);
            setUpdateInfo({
              latestVersion: 'Over-the-Air Update',
              latestVersionCode: currentCode + 1,
              apkUrl: '',
              title: 'New Update Available',
              message: 'An over-the-air update is ready to install.',
              releaseNotes: ['Performance improvements and bug fixes available now.'],
              forceUpdate: false,
            });
            setIsUpToDate(false);
            stopSpin();
            setUpdateChecked(true);
            showUpdateBanner();
            triggerHaptic('medium');
            return;
          }
        } catch (otaErr) {
          console.log('Expo Updates check error:', otaErr);
        }
      }

      // 2. Check server-based app version / APK
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
    if (isDownloading) return;

    triggerHaptic('heavy');
    setDownloadProgress(0);
    setDownloadDone(false);
    setDownloadError(null);
    progressAnim.setValue(0);

    // 1. In-app Expo OTA update: downloads within app & reloads immediately
    if (Updates.isEnabled && Platform.OS !== 'web') {
      setIsDownloading(true);
      let curP = 0.08;
      setDownloadProgress(curP);
      progressAnim.setValue(curP);

      const otaTimer = setInterval(() => {
        curP = Math.min(curP + 0.14, 0.92);
        setDownloadProgress(curP);
        Animated.timing(progressAnim, {
          toValue: curP,
          duration: 250,
          useNativeDriver: false,
        }).start();
      }, 300);

      try {
        await Updates.fetchUpdateAsync();
        clearInterval(otaTimer);

        setDownloadProgress(1);
        Animated.timing(progressAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: false,
        }).start();

        setDownloadDone(true);
        setDownloadError(null);
        triggerHaptic('success');
        setTimeout(async () => {
          await Updates.reloadAsync();
        }, 800);
        return;
      } catch (e: any) {
        clearInterval(otaTimer);
        console.log('OTA fetch in profile failed, falling back to direct APK:', e);
      }
    }

    // 2. Direct APK download and install inside app for Android
    const rawApk = updateInfo?.apkUrl || '';
    const apkUrl = rawApk.toLowerCase().includes('.apk')
      ? rawApk
      : 'https://expo.dev/artifacts/eas/1Ocs_q69VOCzESXZZVcXGFIkgNVKolLQ7ZUI3bRTYc0.apk';

    if (Platform.OS === 'android') {
      setIsDownloading(true);
      try {
        const destFile = new FileSystem.File(FileSystem.Paths.cache, 'guidetalk_update.apk');
        if (destFile.exists) {
          try {
            destFile.delete();
          } catch {}
        }

        const downloadTask = FileSystem.File.createDownloadTask(
          apkUrl,
          destFile,
          {
            onProgress: (data) => {
              const { bytesWritten, totalBytes } = data;
              const ratio = totalBytes > 0 ? bytesWritten / totalBytes : 0;
              setDownloadProgress(ratio);
              Animated.timing(progressAnim, {
                toValue: ratio,
                duration: 100,
                useNativeDriver: false,
              }).start();
            },
          }
        );

        const result = await downloadTask.downloadAsync();
        if (!result?.uri) {
          throw new Error('Download failed: No file URI received.');
        }

        setDownloadProgress(1);
        progressAnim.setValue(1);

        const contentUri = await FileSystem.getContentUriAsync(result.uri);
        await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
          data: contentUri,
          flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
          type: 'application/vnd.android.package-archive',
        });
        setDownloadDone(true);
        return;
      } catch (err: any) {
        console.log('APK download error in profile:', err);
        setDownloadError(err?.message || 'Download failed within app.');
        return;
      } finally {
        setIsDownloading(false);
      }
    }

    setDownloadError('Update could not be applied automatically.');
    setIsDownloading(false);
  };

  const spinInterpolate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  const handlePickAvatar = async () => {
    try {
      triggerHaptic('light');
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Photo Permission Needed',
          'Please allow photo gallery access in settings to upload your custom profile picture.'
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
        setIsUploadingAvatar(true);
        triggerHaptic('medium');
        await updateProfile({ avatarUrl: result.assets[0].uri });
        triggerHaptic('success');
        setAvatarSuccessBanner(true);
        setTimeout(() => setAvatarSuccessBanner(false), 3000);
      }
    } catch (err: any) {
      console.warn('Avatar pick error:', err);
      Alert.alert('Upload Error', 'Failed to pick image. Please try again.');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleOpenEditName = () => {
    setEditNameInput(user?.name || user?.username || '');
    setShowEditNameModal(true);
  };

  const handleSaveName = async () => {
    const trimmed = editNameInput.trim();
    if (!trimmed) {
      Alert.alert('Invalid Name', 'Display name cannot be empty.');
      return;
    }
    setIsSavingName(true);
    triggerHaptic('medium');
    try {
      await updateProfile({ name: trimmed });
      triggerHaptic('success');
      setShowEditNameModal(false);
      setNameSavedBanner(true);
      setTimeout(() => setNameSavedBanner(false), 3000);
    } catch (e: any) {
      Alert.alert('Update Failed', e?.message || 'Could not update your display name.');
    } finally {
      setIsSavingName(false);
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
            <Pressable
              onPress={handlePickAvatar}
              disabled={isUploadingAvatar}
              style={({ pressed }) => [
                styles.avatarPressable,
                { opacity: pressed ? 0.85 : 1 },
              ]}
              hitSlop={8}
            >
              <Image
                source={{
                  uri:
                    user?.avatarUrl ||
                    `https://api.dicebear.com/9.x/adventurer/png?seed=${encodeURIComponent(user?.username || 'Guest')}&backgroundColor=000000`,
                }}
                style={styles.avatar}
              />
              <View style={[styles.avatarCameraBadge, { backgroundColor: theme.text }]}>
                {isUploadingAvatar ? (
                  <ActivityIndicator size="small" color={theme.background} />
                ) : (
                  <Ionicons name="camera" size={12} color={theme.background} />
                )}
              </View>
            </Pressable>

            <View style={{ flex: 1 }}>
              {/* Name Row with Verified Checkmark & Quick Edit Pencil */}
              <View style={styles.nameRow}>
                <Text style={[styles.name, { color: theme.text }]} numberOfLines={1}>
                  {user?.name || (isGuest ? 'Guest Traveler' : user?.username)}
                </Text>
                {user?.isEmailVerified && (
                  <View style={styles.verifiedCheckBadge}>
                    <Ionicons name="checkmark-circle" size={19} color="#0A84FF" />
                  </View>
                )}
                {user && !isGuest && (
                  <Pressable
                    onPress={handleOpenEditName}
                    hitSlop={8}
                    style={[styles.editNameIconBtn, { backgroundColor: theme.surfaceSecondary }]}
                    accessibilityLabel="Edit display name"
                  >
                    <Ionicons name="pencil" size={12} color={theme.text} />
                  </Pressable>
                )}
              </View>

              <Text style={[styles.username, { color: theme.secondary }]}>
                {user ? `@${user.username} · Active Session` : 'Guest Mode (Local Session)'}
              </Text>

              {/* Status Badge Pills */}
              <View style={styles.statusPillsRow}>
                {user?.isEmailVerified ? (
                  <View style={[styles.statusBadge, { backgroundColor: 'rgba(10, 132, 255, 0.12)', borderColor: 'rgba(10, 132, 255, 0.35)' }]}>
                    <Ionicons name="shield-checkmark" size={11} color="#0A84FF" />
                    <Text style={[styles.statusBadgeText, { color: '#0A84FF' }]}>Verified Account</Text>
                  </View>
                ) : user && !isGuest ? (
                  <Pressable
                    onPress={() => {
                      triggerHaptic('light');
                      setShowVerificationGate(true);
                    }}
                    style={[styles.statusBadge, { backgroundColor: 'rgba(255, 149, 0, 0.12)', borderColor: 'rgba(255, 149, 0, 0.4)' }]}
                  >
                    <Ionicons name="alert-circle" size={11} color="#FF9500" />
                    <Text style={[styles.statusBadgeText, { color: '#FF9500' }]}>Unverified • Tap to Verify</Text>
                  </Pressable>
                ) : null}

                {user?.hasPasskey && (
                  <View style={[styles.statusBadge, { backgroundColor: 'rgba(52, 199, 89, 0.12)', borderColor: 'rgba(52, 199, 89, 0.35)' }]}>
                    <Ionicons name="finger-print" size={11} color="#34C759" />
                    <Text style={[styles.statusBadgeText, { color: '#34C759' }]}>Passkey</Text>
                  </View>
                )}
              </View>

              {/* Action Buttons: Attach Photo & Edit Name */}
              <View style={styles.profileActionBtnsRow}>
                <Pressable
                  onPress={handlePickAvatar}
                  disabled={isUploadingAvatar}
                  style={[
                    styles.changePhotoBtn,
                    { backgroundColor: theme.surfaceSecondary, borderColor: theme.border },
                  ]}
                >
                  <Ionicons name="camera-outline" size={12} color={theme.text} />
                  <Text style={[styles.changePhotoText, { color: theme.text }]}>
                    {isUploadingAvatar ? 'Updating…' : 'Attach Photo'}
                  </Text>
                </Pressable>

                {user && !isGuest && (
                  <Pressable
                    onPress={handleOpenEditName}
                    style={[
                      styles.changePhotoBtn,
                      { backgroundColor: theme.surfaceSecondary, borderColor: theme.border },
                    ]}
                  >
                    <Ionicons name="create-outline" size={12} color={theme.text} />
                    <Text style={[styles.changePhotoText, { color: theme.text }]}>Edit Name</Text>
                  </Pressable>
                )}
              </View>

              {(user?.age || user?.language) && (
                <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
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

          {avatarSuccessBanner && (
            <View style={styles.avatarSuccessPill}>
              <Ionicons name="checkmark-circle" size={14} color="#34C759" />
              <Text style={styles.avatarSuccessText}>Profile photo updated successfully!</Text>
            </View>
          )}

          {nameSavedBanner && (
            <View style={[styles.avatarSuccessPill, { borderColor: 'rgba(10, 132, 255, 0.35)', backgroundColor: 'rgba(10, 132, 255, 0.14)' }]}>
              <Ionicons name="checkmark-circle" size={14} color="#0A84FF" />
              <Text style={[styles.avatarSuccessText, { color: '#0A84FF' }]}>Display name saved successfully!</Text>
            </View>
          )}

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
                Version {currentVer} (build {currentCode}){isRunningOtaUpdate() ? ' • Live OTA' : ''}
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
              {downloadDone && !isDownloading && !downloadError && (
                <View style={styles.downloadDoneRow}>
                  <View style={[styles.downloadDoneIcon, { backgroundColor: 'rgba(52,199,89,0.15)' }]}>
                    <Ionicons name="checkmark-done-circle" size={18} color="#30D158" />
                  </View>
                  <Text style={[styles.downloadDoneText, { color: '#30D158' }]}>
                    {otaUpdateAvailable ? 'Update downloaded — restarting…' : 'Download complete — installer launched'}
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
                disabled={isDownloading || (downloadDone && !downloadError)}
                style={({ pressed }) => [
                  styles.installBtn,
                  (isDownloading || (downloadDone && !downloadError)) && styles.installBtnDisabled,
                  pressed && !isDownloading && !downloadDone && { opacity: 0.88 },
                ]}
              >
                <View style={styles.installBtnInner}>
                  {isDownloading ? (
                    <>
                      <Ionicons name="cloud-download" size={17} color="#FFFFFF" />
                      <Text style={styles.installBtnText}>Downloading {Math.round(downloadProgress * 100)}%</Text>
                    </>
                  ) : downloadDone && !downloadError ? (
                    <>
                      <Ionicons name="checkmark-circle" size={17} color="#FFFFFF" />
                      <Text style={styles.installBtnText}>
                        {otaUpdateAvailable ? 'Applying Update…' : 'Installer Launched'}
                      </Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="download" size={17} color="#FFFFFF" />
                      <Text style={styles.installBtnText}>
                        {otaUpdateAvailable
                          ? 'Apply OTA Update'
                          : updateInfo?.apkUrl && !updateInfo.apkUrl.toLowerCase().split('?')[0].endsWith('.apk')
                          ? 'Open Update Page'
                          : 'Download & Install'}
                      </Text>
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

      {/* Edit Display Name Modal */}
      <Modal
        visible={showEditNameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEditNameModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <TouchableWithoutFeedback onPress={() => setShowEditNameModal(false)}>
            <View style={styles.modalBackdropFill} />
          </TouchableWithoutFeedback>

          <View style={[styles.editNameModalCard, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
            <View style={styles.modalHeaderRow}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={[styles.modalCardTitle, { color: theme.text }]}>Edit Display Name</Text>
                <Text style={[styles.modalCardSubtitle, { color: theme.secondary }]}>
                  How your companions address you in conversation
                </Text>
              </View>
              <Pressable
                onPress={() => setShowEditNameModal(false)}
                hitSlop={8}
                style={[styles.modalCloseIconBtn, { backgroundColor: theme.surfaceSecondary }]}
              >
                <Ionicons name="close" size={18} color={theme.text} />
              </Pressable>
            </View>

            <View style={[styles.editNameInputWrap, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}>
              <Ionicons name="person-outline" size={17} color={theme.secondary} style={{ marginRight: 10 }} />
              <TextInput
                value={editNameInput}
                onChangeText={setEditNameInput}
                placeholder="Enter your name…"
                placeholderTextColor={theme.muted}
                maxLength={40}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleSaveName}
                style={[styles.editNameTextInput, { color: theme.text }]}
              />
              {editNameInput.length > 0 && (
                <Pressable onPress={() => setEditNameInput('')} hitSlop={6}>
                  <Ionicons name="close-circle" size={16} color={theme.muted} />
                </Pressable>
              )}
            </View>

            <View style={styles.modalActionButtonsRow}>
              <Pressable
                onPress={() => setShowEditNameModal(false)}
                disabled={isSavingName}
                style={[styles.modalCancelBtn, { borderColor: theme.border }]}
              >
                <Text style={[styles.modalCancelBtnText, { color: theme.secondary }]}>Cancel</Text>
              </Pressable>

              <Pressable
                onPress={handleSaveName}
                disabled={isSavingName || !editNameInput.trim()}
                style={[
                  styles.modalSaveBtn,
                  { backgroundColor: theme.text },
                  (!editNameInput.trim() || isSavingName) && { opacity: 0.4 },
                ]}
              >
                {isSavingName ? (
                  <ActivityIndicator size="small" color={theme.background} />
                ) : (
                  <>
                    <Ionicons name="checkmark" size={16} color={theme.background} style={{ marginRight: 6 }} />
                    <Text style={[styles.modalSaveBtnText, { color: theme.background }]}>Save Name</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Email Verification Gate */}
      <EmailVerificationGate
        visible={showVerificationGate}
        onDismiss={() => setShowVerificationGate(false)}
        onSuccess={() => setShowVerificationGate(false)}
        title="Verify Account"
        subtitle="Verify your email to secure your account and unlock your verified badge."
      />

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
  avatarPressable: {
    position: 'relative',
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  avatarCameraBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  changePhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
  },
  changePhotoText: {
    fontSize: 11,
    fontWeight: '700',
  },
  avatarSuccessPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(52, 199, 89, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(52, 199, 89, 0.35)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    marginTop: 14,
  },
  avatarSuccessText: {
    color: '#34C759',
    fontSize: 12,
    fontWeight: '700',
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  verifiedCheckBadge: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  editNameIconBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    marginTop: 5,
    marginBottom: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  profileActionBtnsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalBackdropFill: {
    ...StyleSheet.absoluteFill,
  },
  editNameModalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  modalCardTitle: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  modalCardSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  modalCloseIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editNameInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 48,
    marginBottom: 18,
  },
  editNameTextInput: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
  },
  modalActionButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  modalSaveBtn: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  modalSaveBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
});


