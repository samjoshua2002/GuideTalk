import React from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  View,
  Pressable,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '@/src/context/ThemeContext';
import { LiquidGlassView } from './LiquidGlassView';
import { AppVersionInfo } from '@/src/lib/chatApi';
import { triggerHaptic } from '@/src/lib/haptics';

interface UpdateAvailableModalProps {
  visible: boolean;
  onClose: () => void;
  versionInfo: AppVersionInfo | null;
  currentVersion: string;
}

export function UpdateAvailableModal({
  visible,
  onClose,
  versionInfo,
  currentVersion,
}: UpdateAvailableModalProps) {
  const { theme, isDark } = useTheme();

  if (!visible || !versionInfo) return null;

  const handleUpdate = () => {
    triggerHaptic();
    if (versionInfo.apkUrl) {
      Linking.openURL(versionInfo.apkUrl).catch(() => {});
    }
    if (!versionInfo.forceUpdate) {
      onClose();
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={versionInfo.forceUpdate ? undefined : onClose}>
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={versionInfo.forceUpdate ? undefined : onClose}
        />

        <LiquidGlassView
          style={[
            styles.dialog,
            { backgroundColor: isDark ? 'rgba(18,14,32,0.95)' : 'rgba(255,255,255,0.96)' },
          ]}
          borderRadius={28}
          intensity={60}
          elevated
        >
          {/* App Icon with Yellow Glow */}
          <View style={styles.iconContainer}>
            <View style={styles.iconGlow}>
              <Image
                source={require('@/assets/images/icon.png')}
                style={styles.appIcon}
                contentFit="cover"
              />
            </View>
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>v{versionInfo.latestVersion}</Text>
            </View>
          </View>

          {/* Title & Version Compare */}
          <Text style={[styles.title, { color: theme.text }]}>
            {versionInfo.title || 'Update Available!'}
          </Text>
          <Text style={[styles.versionCompare, { color: theme.secondary }]}>
            Current: v{currentVersion} ➔ New: v{versionInfo.latestVersion}
          </Text>

          {/* Message */}
          <Text style={[styles.message, { color: theme.secondary }]}>
            {versionInfo.message}
          </Text>

          {/* Release Notes */}
          {versionInfo.releaseNotes && versionInfo.releaseNotes.length > 0 && (
            <View style={[styles.notesBox, { backgroundColor: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', borderColor: theme.border }]}>
              {versionInfo.releaseNotes.map((note, idx) => (
                <View key={idx} style={styles.noteRow}>
                  <Ionicons name="checkmark-circle" size={15} color="#FFD200" style={{ marginTop: 2 }} />
                  <Text style={[styles.noteText, { color: theme.text }]}>{note}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Action Buttons */}
          <View style={styles.actions}>
            <Pressable
              onPress={handleUpdate}
              style={({ pressed }) => [
                styles.updateBtn,
                { backgroundColor: theme.text },
                pressed && { opacity: 0.85 },
              ]}
            >
              <Ionicons name="download-outline" size={18} color={theme.background} />
              <Text style={[styles.updateBtnText, { color: theme.background }]}>
                Download & Update Now
              </Text>
            </Pressable>

            {!versionInfo.forceUpdate && (
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [
                  styles.laterBtn,
                  pressed && { opacity: 0.6 },
                ]}
              >
                <Text style={[styles.laterBtnText, { color: theme.muted }]}>
                  Remind Me Later
                </Text>
              </Pressable>
            )}
          </View>
        </LiquidGlassView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)',
    padding: 24,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  dialog: {
    width: '100%',
    maxWidth: 380,
    padding: 24,
    borderRadius: 28,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  iconContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  iconGlow: {
    width: 76,
    height: 76,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#FFD200',
    shadowColor: '#FFD200',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  appIcon: {
    width: '100%',
    height: '100%',
  },
  newBadge: {
    position: 'absolute',
    bottom: -6,
    right: -6,
    backgroundColor: '#FFD200',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  newBadgeText: {
    color: '#000',
    fontSize: 10,
    fontWeight: '800',
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  versionCompare: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 10,
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 16,
  },
  notesBox: {
    width: '100%',
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    marginBottom: 20,
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  noteText: {
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
    flex: 1,
  },
  actions: {
    width: '100%',
    gap: 10,
    alignItems: 'center',
  },
  updateBtn: {
    width: '100%',
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  updateBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  laterBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  laterBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
