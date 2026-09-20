import React from 'react';
import { Pressable, StyleSheet, Text, ActivityIndicator, View } from 'react-native';
import { useTheme } from '@/src/context/ThemeContext';
import { triggerHaptic } from '@/src/lib/haptics';

interface GlowButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'glass';
  disabled?: boolean;
  icon?: React.ReactNode;
}

export function GlowButton({
  label,
  onPress,
  loading = false,
  variant = 'primary',
  disabled = false,
  icon,
}: GlowButtonProps) {
  const { theme, isDark } = useTheme();

  const getBackgroundColor = () => {
    if (disabled) return isDark ? '#222' : '#E5E5EA';
    if (variant === 'primary') return theme.text;
    if (variant === 'glass') return theme.cardGlass;
    return theme.surfaceSecondary;
  };

  const getTextColor = () => {
    if (disabled) return theme.muted;
    if (variant === 'primary') return theme.background;
    return theme.text;
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        triggerHaptic(variant === 'primary' ? 'medium' : 'light');
        onPress();
      }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: getBackgroundColor(),
          borderColor: variant === 'glass' ? theme.borderActive : theme.border,
          borderWidth: variant === 'primary' ? 0 : 1,
        },
        pressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={getTextColor()} />
      ) : (
        <View style={styles.contentRow}>
          {icon && <View style={styles.iconContainer}>{icon}</View>}
          <Text style={[styles.label, { color: getTextColor() }]}>{label}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    paddingHorizontal: 20,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainer: {
    marginRight: 8,
  },
  label: {
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: -0.2,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
});
