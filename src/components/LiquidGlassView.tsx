import React from 'react';
import { StyleSheet, View, ViewProps, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '@/src/context/ThemeContext';

interface LiquidGlassViewProps extends ViewProps {
  children?: React.ReactNode;
  intensity?: number;
  borderRadius?: number;
  elevated?: boolean;
}

export function LiquidGlassView({
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
      backgroundColor: theme.cardGlass,
    },
    !isAndroid && (isDark ? styles.shadowDark : styles.shadowLight),
    isAndroid && elevated && { borderWidth: 1.2 },
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

  return (
    <View style={containerStyle} {...rest}>
      <BlurView
        intensity={intensity}
        tint={theme.blurTint}
        style={[StyleSheet.absoluteFill, { borderRadius }]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    borderWidth: 1,
  },
  shadowDark: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
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
