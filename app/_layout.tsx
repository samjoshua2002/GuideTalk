import React, { useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import { ThemeProvider, useTheme } from '@/src/context/ThemeContext';
import { AuthProvider, useAuth } from '@/src/context/AuthContext';

function RootNav() {
  const router = useRouter();
  const { theme, isDark } = useTheme();
  const { isLoading } = useAuth();

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response?.notification?.request?.content?.data;
      if (data?.type === 'character_chat' && data?.characterId) {
        router.push(`/chat/${data.characterId}`);
      }
    });
    return () => sub.remove();
  }, [router]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, justifyContent: 'center', alignItems: 'center' }}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ActivityIndicator size="large" color={theme.text} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.background },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="search" options={{ animation: 'fade_from_bottom' }} />
        <Stack.Screen name="chat/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="character/[id]" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RootNav />
      </AuthProvider>
    </ThemeProvider>
  );
}
