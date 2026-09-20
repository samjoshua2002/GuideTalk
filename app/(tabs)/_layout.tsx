import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet, Pressable, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/src/context/ThemeContext';
import { triggerHaptic } from '@/src/lib/haptics';

function InteractiveTabButton({
  children,
  onPress,
  accessibilityState,
  style,
  ...props
}: any) {
  const focused = accessibilityState?.selected;
  const { isDark } = useTheme();

  return (
    <Pressable
      {...props}
      onPress={(e) => {
        triggerHaptic('selection');
        onPress?.(e);
      }}
      style={({ pressed }) => [
        styles.tabButtonWrap,
        style,
        {
          opacity: pressed ? 0.75 : 1,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        },
      ]}
    >
      <View
        style={[
          styles.tabActivePill,
          focused && [
            styles.tabActivePillFocused,
            {
              backgroundColor: isDark
                ? 'rgba(255, 255, 255, 0.12)'
                : 'rgba(0, 0, 0, 0.07)',
              borderColor: isDark
                ? 'rgba(255, 255, 255, 0.16)'
                : 'rgba(0, 0, 0, 0.09)',
            },
          ],
        ]}
      >
        {children}
      </View>
    </Pressable>
  );
}

export default function TabsLayout() {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomOffset = Platform.OS === 'ios' ? Math.max(insets.bottom, 16) : 16;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.text,
        tabBarInactiveTintColor: isDark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.45)',
        tabBarButton: (props) => <InteractiveTabButton {...props} />,
        tabBarStyle: {
          position: 'absolute',
          bottom: bottomOffset,
          left: 20,
          right: 20,
          height: 64,
          borderRadius: 32,
          borderWidth: 1,
          borderColor: isDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(0, 0, 0, 0.09)',
          backgroundColor: Platform.OS === 'web'
            ? (isDark ? 'rgba(18, 14, 28, 0.88)' : 'rgba(255, 255, 255, 0.92)')
            : 'transparent',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: isDark ? 0.45 : 0.12,
          shadowRadius: 20,
          elevation: 12,
          paddingBottom: 0,
          paddingHorizontal: 8,
          overflow: 'hidden',
          ...({
            backdropFilter: Platform.OS === 'web' ? 'blur(20px) saturate(180%)' : undefined,
          } as any),
        },
        tabBarBackground: () =>
          Platform.OS !== 'web' ? (
            <BlurView
              intensity={Platform.OS === 'ios' ? 65 : 90}
              tint={isDark ? 'dark' : 'light'}
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: isDark
                    ? 'rgba(18, 14, 28, 0.72)'
                    : 'rgba(255, 255, 255, 0.82)',
                },
              ]}
            />
          ) : null,
        tabBarLabelStyle: {
          fontSize: 10.5,
          fontWeight: '700',
          letterSpacing: -0.1,
          marginTop: -2,
        },
        tabBarItemStyle: {
          height: 52,
          paddingVertical: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Discover',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'compass' : 'compass-outline'}
              color={color}
              size={size - 1}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'chatbubbles' : 'chatbubbles-outline'}
              color={color}
              size={size - 1}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size, focused }) => (
            <Ionicons
              name={focused ? 'person' : 'person-outline'}
              color={color}
              size={size - 1}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabButtonWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  tabActivePill: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tabActivePillFocused: {
    borderWidth: 1,
  },
});
