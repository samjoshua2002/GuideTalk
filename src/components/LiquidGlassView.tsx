import React from 'react';
import { StyleSheet, View, ViewProps, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient as ExpoLinearGradient } from 'expo-linear-gradient';
import { useTheme } from '@/src/context/ThemeContext';

interface LiquidGlassViewProps extends ViewProps {
  children?: React.ReactNode;
  intensity?: number;
  borderRadius?: number;
  elevated?: boolean;
}

export function LiquidGlassViewBase({
  children,
  style,
  intensity = 35,
  borderRadius = 24,
  elevated = false,
  ...rest
}: LiquidGlassViewProps) {
  const { theme, isDark } = useTheme();

  const isAndroid = Platform.OS === 'android';

  const containerStyle = [
    styles.container,
    {
      borderRadius,
      borderColor: elevated ? theme.borderActive : theme.border,
      // On Android, BlurView cannot blur sibling/underlying views, so transparent backgrounds
      // cause views underneath (like hero backdrops) to bleed through. Use a rich, near-opaque
      // dark glass surface in dark mode and solid surface in light mode.
      backgroundColor: isAndroid
        ? isDark
          ? elevated
            ? 'rgba(26, 23, 40, 0.94)'
            : 'rgba(18, 16, 28, 0.90)'
          : elevated
            ? 'rgba(255, 255, 255, 0.97)'
            : 'rgba(250, 250, 252, 0.92)'
        : isDark
          ? elevated
            ? 'rgba(255, 255, 255, 0.16)'
            : 'rgba(255, 255, 255, 0.11)'
          : theme.cardGlass,
    },
    !isAndroid && (isDark ? styles.shadowDark : styles.shadowLight),
    isAndroid && elevated && { borderWidth: 1.5 },
    style,
  ];

  if (Platform.OS === 'web') {
    return (
      <View
        style={[
          containerStyle,
          ({
            backdropFilter: 'blur(24px) saturate(180%)',
            WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          } as any),
        ]}
        {...rest}
      >
        {children}
      </View>
    );
  }

  // On iOS in dark mode, 'systemThinMaterialDark' produces the genuine
  // Apple-style dark frosted glass with visible specular highlights — unlike
  // tint='dark' which just darkens pixels and disappears against a black BG.
  const blurTint = isDark
    ? (Platform.OS === 'ios' ? 'systemThinMaterialDark' : 'dark')
    : theme.blurTint;

  // Dark mode needs higher intensity to produce visible diffusion
  const blurIntensity = isDark ? Math.min(intensity * 2.2, 100) : intensity;

  return (
    <View style={containerStyle} {...rest}>
      <BlurView
        intensity={blurIntensity}
        tint={blurTint as any}
        style={[StyleSheet.absoluteFill, { borderRadius }]}
      />

      {/* Dark mode: top-edge glint — mimics real glass catching ambient light */}
      {isDark && (
        <ExpoLinearGradient
          colors={['rgba(255,255,255,0.18)', 'rgba(255,255,255,0.0)']}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={[
            StyleSheet.absoluteFill,
            { borderRadius, height: '45%', top: 0 },
          ]}
          pointerEvents="none"
        />
      )}

      {children}
    </View>
  );
}

// Memoize so list items that receive the same props don't re-render LiquidGlassView
export const LiquidGlassView = React.memo(LiquidGlassViewBase);

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderWidth: 1,
  },
  shadowDark: {
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  shadowLight: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
});
