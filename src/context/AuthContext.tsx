import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { UserProfile } from '@/src/types/character';
import { env } from '@/src/config/env';

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  isGuest: boolean;
  isLoading: boolean;
  hasCompletedOnboarding: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (
    username: string,
    password: string,
    name?: string,
    email?: string,
    age?: number | string,
    language?: string,
    workspaceCharacterIds?: string[]
  ) => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  setCompletedOnboarding: (done: boolean) => Promise<void>;
  resetOnboarding: () => Promise<void>;
  logout: () => Promise<void>;
  continueAsGuest: () => void;
}

const TOKEN_KEY = 'guildtalk_user_token';
const USER_KEY = 'guildtalk_user_data';
const ONBOARDING_KEY = 'guildtalk_onboarding_done';

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isGuest: true,
  isLoading: true,
  hasCompletedOnboarding: false,
  login: async () => {},
  register: async () => {},
  updateProfile: async () => {},
  setCompletedOnboarding: async () => {},
  resetOnboarding: async () => {},
  logout: async () => {},
  continueAsGuest: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState<boolean>(true);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasCompletedOnboarding, setHasCompletedOnboardingState] = useState<boolean>(false);

  useEffect(() => {
    async function loadAuth() {
      try {
        let savedToken: string | null = null;
        let savedUser: string | null = null;
        let savedOnboarding: string | null = null;

        if (Platform.OS === 'web') {
          savedToken = globalThis.localStorage?.getItem(TOKEN_KEY);
          savedUser = globalThis.localStorage?.getItem(USER_KEY);
          savedOnboarding = globalThis.localStorage?.getItem(ONBOARDING_KEY);
        } else {
          savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
          savedUser = await SecureStore.getItemAsync(USER_KEY);
          savedOnboarding = await SecureStore.getItemAsync(ONBOARDING_KEY);
        }

        if (savedOnboarding === 'true') {
          setHasCompletedOnboardingState(true);
        }

        if (savedToken && savedUser) {
          setToken(savedToken);
          setUser(JSON.parse(savedUser));
          setIsGuest(false);
          setHasCompletedOnboardingState(true);
          if (savedOnboarding !== 'true') {
            if (Platform.OS === 'web') {
              globalThis.localStorage?.setItem(ONBOARDING_KEY, 'true');
            } else {
              SecureStore.setItemAsync(ONBOARDING_KEY, 'true').catch(() => {});
            }
          }
        }
      } catch (e) {
        console.error('Failed to restore auth session:', e);
      } finally {
        setIsLoading(false);
      }
    }
    loadAuth();
  }, []);

  const persistSession = async (userToken: string, userData: UserProfile) => {
    setToken(userToken);
    setUser(userData);
    setIsGuest(false);
    setHasCompletedOnboardingState(true);

    try {
      const userStr = JSON.stringify(userData);
      if (Platform.OS === 'web') {
        globalThis.localStorage?.setItem(TOKEN_KEY, userToken);
        globalThis.localStorage?.setItem(USER_KEY, userStr);
        globalThis.localStorage?.setItem(ONBOARDING_KEY, 'true');
      } else {
        await SecureStore.setItemAsync(TOKEN_KEY, userToken);
        await SecureStore.setItemAsync(USER_KEY, userStr);
        await SecureStore.setItemAsync(ONBOARDING_KEY, 'true');
      }
    } catch {
      // Ignore
    }
  };

  async function resilientFetch(path: string, options: RequestInit) {
    const urls = Array.from(new Set([
      `${env.apiUrl}${path}`,
      `http://192.168.0.232:3000${path}`,
      `http://localhost:3000${path}`,
    ]));
    let lastError: unknown = null;
    for (const url of urls) {
      try {
        const res = await fetch(url, options);
        return res;
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error('Network request failed.');
  }

  const login = async (username: string, password: string) => {
    const res = await resilientFetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed.');
    }
    await persistSession(data.token, data.user);
    await setCompletedOnboarding(true);
  };

  const register = async (
    username: string,
    password: string,
    name?: string,
    email?: string,
    age?: number | string,
    language?: string,
    workspaceCharacterIds?: string[]
  ) => {
    const res = await resilientFetch('/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username,
        password,
        name,
        email,
        age: age ? Number(age) : undefined,
        language,
        workspaceCharacterIds,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed.');
    }
    await persistSession(data.token, data.user);
    await setCompletedOnboarding(true);
  };

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!token) return;
    const res = await resilientFetch('/auth/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    if (res.ok && data.user) {
      setUser(data.user);
      try {
        const userStr = JSON.stringify(data.user);
        if (Platform.OS === 'web') {
          globalThis.localStorage?.setItem(USER_KEY, userStr);
        } else {
          await SecureStore.setItemAsync(USER_KEY, userStr);
        }
      } catch {
        // Ignore
      }
    }
  };

  const setCompletedOnboarding = async (done: boolean) => {
    setHasCompletedOnboardingState(done);
    try {
      if (Platform.OS === 'web') {
        globalThis.localStorage?.setItem(ONBOARDING_KEY, done ? 'true' : 'false');
      } else {
        await SecureStore.setItemAsync(ONBOARDING_KEY, done ? 'true' : 'false');
      }
    } catch {
      // Ignore
    }
  };

  const resetOnboarding = async () => {
    setToken(null);
    setUser(null);
    setIsGuest(true);
    setHasCompletedOnboardingState(false);

    try {
      if (Platform.OS === 'web') {
        globalThis.localStorage?.removeItem(TOKEN_KEY);
        globalThis.localStorage?.removeItem(USER_KEY);
        globalThis.localStorage?.removeItem(ONBOARDING_KEY);
      } else {
        await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
        await SecureStore.deleteItemAsync(USER_KEY).catch(() => {});
        await SecureStore.deleteItemAsync(ONBOARDING_KEY).catch(() => {});
      }
    } catch {
      // Ignore
    }
  };

  const logout = async () => {
    setToken(null);
    setUser(null);
    setIsGuest(true);
    setHasCompletedOnboardingState(false);

    try {
      if (Platform.OS === 'web') {
        globalThis.localStorage?.removeItem(TOKEN_KEY);
        globalThis.localStorage?.removeItem(USER_KEY);
        globalThis.localStorage?.removeItem(ONBOARDING_KEY);
      } else {
        await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => {});
        await SecureStore.deleteItemAsync(USER_KEY).catch(() => {});
        await SecureStore.deleteItemAsync(ONBOARDING_KEY).catch(() => {});
      }
    } catch {
      // Ignore
    }
  };

  const continueAsGuest = () => {
    setIsGuest(true);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isGuest,
        isLoading,
        hasCompletedOnboarding,
        login,
        register,
        updateProfile,
        setCompletedOnboarding,
        resetOnboarding,
        logout,
        continueAsGuest,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
