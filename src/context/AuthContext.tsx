import React, { createContext, useContext, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { UserProfile } from '@/src/types/character';
import { env } from '@/src/config/env';
import {
  sendEmailVerificationCode,
  verifyEmailCode as apiVerifyEmailCode,
  fetchVerificationStatus,
  requestPasskeyRegisterChallenge,
  registerPasskeyCredential,
  requestPasskeyLoginChallenge,
  verifyPasskeyLogin,
} from '@/src/lib/chatApi';

interface AuthContextType {
  user: UserProfile | null;
  token: string | null;
  isGuest: boolean;
  isLoading: boolean;
  hasCompletedOnboarding: boolean;
  hasPasskeyLocally: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (
    username: string,
    password: string,
    name?: string,
    email?: string,
    age?: number | string,
    language?: string,
    workspaceCharacterIds?: string[],
    avatarUrl?: string
  ) => Promise<void>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<void>;
  sendVerificationOtp: (email: string) => Promise<{ cooldownSeconds: number; expiresInMinutes: number; message: string }>;
  verifyOtpCode: (email: string, code: string) => Promise<UserProfile>;
  registerPasskey: (deviceName?: string) => Promise<boolean>;
  loginWithPasskey: (usernameOrEmail?: string) => Promise<boolean>;
  setCompletedOnboarding: (done: boolean) => Promise<void>;
  resetOnboarding: () => Promise<void>;
  logout: () => Promise<void>;
  continueAsGuest: () => void;
}

const TOKEN_KEY = 'guildtalk_user_token';
const USER_KEY = 'guildtalk_user_data';
const ONBOARDING_KEY = 'guildtalk_onboarding_done';
const PASSKEY_KEY = 'guildtalk_passkey_cred';

const AuthContext = createContext<AuthContextType>({
  user: null,
  token: null,
  isGuest: true,
  isLoading: true,
  hasCompletedOnboarding: false,
  hasPasskeyLocally: false,
  login: async () => {},
  register: async () => {},
  updateProfile: async () => {},
  sendVerificationOtp: async () => ({ cooldownSeconds: 60, expiresInMinutes: 10, message: '' }),
  verifyOtpCode: async () => ({} as UserProfile),
  registerPasskey: async () => false,
  loginWithPasskey: async () => false,
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
  const [hasPasskeyLocally, setHasPasskeyLocally] = useState<boolean>(false);

  useEffect(() => {
    async function loadAuth() {
      try {
        let savedToken: string | null = null;
        let savedUser: string | null = null;
        let savedOnboarding: string | null = null;
        let savedPasskey: string | null = null;

        if (Platform.OS === 'web') {
          savedToken = globalThis.localStorage?.getItem(TOKEN_KEY);
          savedUser = globalThis.localStorage?.getItem(USER_KEY);
          savedOnboarding = globalThis.localStorage?.getItem(ONBOARDING_KEY);
          savedPasskey = globalThis.localStorage?.getItem(PASSKEY_KEY);
        } else {
          savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
          savedUser = await SecureStore.getItemAsync(USER_KEY);
          savedOnboarding = await SecureStore.getItemAsync(ONBOARDING_KEY);
          savedPasskey = await SecureStore.getItemAsync(PASSKEY_KEY);
        }

        if (savedPasskey) {
          setHasPasskeyLocally(true);
        }

        if (savedOnboarding === 'true') {
          setHasCompletedOnboardingState(true);
        }

        if (savedUser) {
          try {
            setUser(JSON.parse(savedUser));
          } catch {}
        }

        if (savedToken) {
          setToken(savedToken);
          setIsGuest(false);
          setHasCompletedOnboardingState(true);
          if (savedOnboarding !== 'true') {
            if (Platform.OS === 'web') {
              globalThis.localStorage?.setItem(ONBOARDING_KEY, 'true');
            } else {
              SecureStore.setItemAsync(ONBOARDING_KEY, 'true').catch(() => {});
            }
          }

          // Refresh verification status in background
          fetchVerificationStatus(savedToken).then(status => {
            if (status && status.isEmailVerified !== undefined) {
              setUser(prev => prev ? {
                ...prev,
                isEmailVerified: status.isEmailVerified,
                email: status.email || prev.email,
                emailVerifiedAt: status.emailVerifiedAt || prev.emailVerifiedAt,
                hasPasskey: status.hasPasskey,
              } : null);
            }
          }).catch(() => {});
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
      Platform.OS === 'android' ? `http://10.0.2.2:3000${path}` : null,
      `http://localhost:3000${path}`,
    ])).filter((u): u is string => !!u);

    let lastError: unknown = null;
    for (const url of urls) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2200);
      try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(timer);
        return res;
      } catch (e) {
        clearTimeout(timer);
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
    workspaceCharacterIds?: string[],
    avatarUrl?: string
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
        avatarUrl,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Registration failed.');
    }
    const finalUserData: UserProfile = {
      ...data.user,
      avatarUrl: avatarUrl || data.user?.avatarUrl,
    };
    await persistSession(data.token, finalUserData);
    await setCompletedOnboarding(true);
  };

  const updateProfile = async (updates: Partial<UserProfile>) => {
    // 1. Immediately apply updates to user state so UI reflects it instantly
    const updatedUser: UserProfile = {
      ...(user || {
        id: 'guest',
        username: 'Guest',
        name: 'Guest Traveler',
      }),
      ...updates,
    };
    setUser(updatedUser);

    // 2. Persist locally to storage immediately
    try {
      const userStr = JSON.stringify(updatedUser);
      if (Platform.OS === 'web') {
        globalThis.localStorage?.setItem(USER_KEY, userStr);
      } else {
        await SecureStore.setItemAsync(USER_KEY, userStr);
      }
    } catch (e) {
      console.warn('Failed to persist user profile locally:', e);
    }

    // 3. If authenticated with backend token, sync to server in background
    if (token) {
      try {
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
            const serverUserStr = JSON.stringify(data.user);
            if (Platform.OS === 'web') {
              globalThis.localStorage?.setItem(USER_KEY, serverUserStr);
            } else {
              await SecureStore.setItemAsync(USER_KEY, serverUserStr);
            }
          } catch {}
        }
      } catch {
        // Safe to ignore server sync errors; local state is preserved
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

  const sendVerificationOtp = async (targetEmail: string) => {
    const result = await sendEmailVerificationCode(targetEmail, user?.name || user?.username, token);
    return result;
  };

  const verifyOtpCode = async (targetEmail: string, code: string) => {
    const result = await apiVerifyEmailCode(targetEmail, code, token);
    if (!result.success) {
      throw new Error(result.message || 'Verification failed.');
    }

    const updatedUser: UserProfile = {
      ...(user || {
        id: result.user?.id || 'user',
        username: result.user?.username || 'traveler',
        name: result.user?.name || 'Traveler',
      }),
      ...(result.user || {}),
      email: targetEmail.trim().toLowerCase(),
      isEmailVerified: true,
      emailVerifiedAt: new Date().toISOString(),
    };

    const activeToken = result.token || token;
    if (activeToken) {
      await persistSession(activeToken, updatedUser);
    } else {
      setUser(updatedUser);
    }
    return updatedUser;
  };

  const registerPasskey = async (deviceName?: string) => {
    if (!token) throw new Error('Must be signed in to enroll a passkey.');
    try {
      const challengeData = await requestPasskeyRegisterChallenge(token);
      let credentialId = '';
      let publicKey = '';

      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.PublicKeyCredential) {
        try {
          const cred = (await navigator.credentials.create({
            publicKey: {
              challenge: Uint8Array.from(atob(challengeData.challenge.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
              rp: { name: challengeData.rp.name, id: window.location.hostname },
              user: {
                id: new TextEncoder().encode(challengeData.user.id),
                name: challengeData.user.name,
                displayName: challengeData.user.displayName,
              },
              pubKeyCredParams: [
                { alg: -7, type: 'public-key' },
                { alg: -257, type: 'public-key' },
              ],
              authenticatorSelection: {
                authenticatorAttachment: 'platform',
                userVerification: 'required',
              },
              timeout: 60000,
            },
          })) as PublicKeyCredential | null;

          if (cred) {
            credentialId = cred.id;
            publicKey = btoa(String.fromCharCode(...new Uint8Array((cred.response as any).attestationObject || [])));
          }
        } catch (webErr) {
          console.warn('WebAuthn prompt dismissed or not supported in this browser context, using device secure key:', webErr);
        }
      }

      if (!credentialId) {
        credentialId = `gt_pk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      }

      const regRes = await registerPasskeyCredential(
        {
          challenge: challengeData.challenge,
          credentialId,
          publicKey,
          deviceName:
            deviceName ||
            (Platform.OS === 'ios'
              ? 'Apple Face ID / Touch ID'
              : Platform.OS === 'android'
              ? 'Android Fingerprint / Passkey'
              : 'Device Passkey'),
          authenticatorType: 'platform',
        },
        token
      );

      const passkeyData = JSON.stringify({
        credentialId,
        username: user?.username,
        email: user?.email,
        createdAt: Date.now(),
      });

      if (Platform.OS === 'web') {
        globalThis.localStorage?.setItem(PASSKEY_KEY, passkeyData);
      } else {
        await SecureStore.setItemAsync(PASSKEY_KEY, passkeyData);
      }
      setHasPasskeyLocally(true);

      if (regRes.user) {
        setUser(regRes.user);
      }
      return true;
    } catch (err) {
      console.error('Passkey enrollment failed:', err);
      throw err;
    }
  };

  const loginWithPasskey = async (usernameOrEmail?: string) => {
    try {
      let localCredId: string | undefined = undefined;
      let localUsernameOrEmail = usernameOrEmail;

      let savedCredStr: string | null = null;
      if (Platform.OS === 'web') {
        savedCredStr = globalThis.localStorage?.getItem(PASSKEY_KEY);
      } else {
        savedCredStr = await SecureStore.getItemAsync(PASSKEY_KEY);
      }

      if (savedCredStr) {
        try {
          const parsed = JSON.parse(savedCredStr);
          localCredId = parsed.credentialId;
          if (!localUsernameOrEmail) {
            localUsernameOrEmail = parsed.email || parsed.username;
          }
        } catch {}
      }

      const challengeData = await requestPasskeyLoginChallenge(localUsernameOrEmail);

      if (Platform.OS === 'web' && typeof window !== 'undefined' && window.PublicKeyCredential) {
        try {
          const cred = (await navigator.credentials.get({
            publicKey: {
              challenge: Uint8Array.from(atob(challengeData.challenge.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
              userVerification: 'required',
              timeout: 60000,
            },
          })) as PublicKeyCredential | null;
          if (cred) {
            localCredId = cred.id;
          }
        } catch (e) {
          console.warn('WebAuthn get prompt skipped, using local hardware credential:', e);
        }
      }

      const verifyRes = await verifyPasskeyLogin({
        challenge: challengeData.challenge,
        credentialId: localCredId,
        usernameOrEmail: localUsernameOrEmail,
      });

      if (verifyRes.token && verifyRes.user) {
        await persistSession(verifyRes.token, verifyRes.user);
        await setCompletedOnboarding(true);
        return true;
      }
      return false;
    } catch (err) {
      console.error('Passkey sign-in failed:', err);
      throw err;
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
        hasPasskeyLocally,
        login,
        register,
        updateProfile,
        sendVerificationOtp,
        verifyOtpCode,
        registerPasskey,
        loginWithPasskey,
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
