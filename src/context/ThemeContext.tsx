import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { darkTheme, lightTheme, ThemeColors } from '@/src/theme/colors';

interface ThemeContextType {
  theme: ThemeColors;
  isDark: boolean;
  toggleTheme: () => void;
  setMode: (mode: 'dark' | 'light') => void;
}

const THEME_KEY = 'guildtalk_theme_mode';

const ThemeContext = createContext<ThemeContextType>({
  theme: darkTheme,
  isDark: true,
  toggleTheme: () => {},
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState<boolean>(true);

  useEffect(() => {
    async function loadTheme() {
      try {
        let saved: string | null = null;
        if (Platform.OS === 'web') {
          saved = globalThis.localStorage?.getItem(THEME_KEY);
        } else {
          saved = await SecureStore.getItemAsync(THEME_KEY);
        }
        if (saved === 'light') {
          setIsDark(false);
        } else if (saved === 'dark') {
          setIsDark(true);
        }
      } catch {
        // Default to dark
      }
    }
    loadTheme();
  }, []);

  const saveThemeMode = async (dark: boolean) => {
    setIsDark(dark);
    const value = dark ? 'dark' : 'light';
    try {
      if (Platform.OS === 'web') {
        globalThis.localStorage?.setItem(THEME_KEY, value);
      } else {
        await SecureStore.setItemAsync(THEME_KEY, value);
      }
    } catch {
      // Ignore
    }
  };

  const toggleTheme = () => {
    saveThemeMode(!isDark);
  };

  const setMode = (mode: 'dark' | 'light') => {
    saveThemeMode(mode === 'dark');
  };

  const theme = isDark ? darkTheme : lightTheme;

  return (
    <ThemeContext.Provider value={{ theme, isDark, toggleTheme, setMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
