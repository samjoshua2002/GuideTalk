import React, { useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/context/ThemeContext';
import { useAuth } from '@/src/context/AuthContext';
import { LiquidGlassView } from './LiquidGlassView';
import { GlowButton } from './GlowButton';

interface AuthModalProps {
  visible: boolean;
  onClose: () => void;
}

export function AuthModal({ visible, onClose }: AuthModalProps) {
  const { theme } = useTheme();
  const { login, register, continueAsGuest } = useAuth();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!username.trim() || !password.trim()) {
      setError('Please enter both username and password.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await login(username.trim(), password.trim());
      } else {
        await register(username.trim(), password.trim(), name.trim(), email.trim());
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  if (!visible) {
    return null;
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <LiquidGlassView style={styles.sheet} borderRadius={28} intensity={50} elevated>
          <View style={styles.header}>
            <View>
              <Text style={[styles.eyebrow, { color: theme.secondary }]}>MY PROFILE</Text>
              <Text style={[styles.title, { color: theme.text }]}>
                {mode === 'login' ? 'Welcome Back' : 'Create Account'}
              </Text>
            </View>
            <Pressable onPress={onClose} style={[styles.closeBtn, { backgroundColor: theme.surfaceSecondary }]}>
              <Ionicons name="close" size={20} color={theme.text} />
            </Pressable>
          </View>

          {/* Tab Selector */}
          <View style={[styles.tabBar, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}>
            <Pressable
              onPress={() => {
                setMode('login');
                setError(null);
              }}
              style={[
                styles.tabBtn,
                mode === 'login' && [styles.activeTab, { backgroundColor: theme.text }],
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: mode === 'login' ? theme.background : theme.secondary },
                ]}
              >
                Log In
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMode('register');
                setError(null);
              }}
              style={[
                styles.tabBtn,
                mode === 'register' && [styles.activeTab, { backgroundColor: theme.text }],
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: mode === 'register' ? theme.background : theme.secondary },
                ]}
              >
                Register
              </Text>
            </Pressable>
          </View>

          {error && (
            <View style={[styles.errorBox, { borderColor: theme.border }]}>
              <Ionicons name="alert-circle" size={18} color="#FF3B30" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.form}>
            {mode === 'register' && (
              <View style={[styles.inputWrapper, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
                <Ionicons name="person-outline" size={18} color={theme.secondary} />
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Display Name (optional)"
                  placeholderTextColor={theme.muted}
                  style={[styles.input, { color: theme.text }]}
                  autoCapitalize="words"
                />
              </View>
            )}

            <View style={[styles.inputWrapper, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
              <Ionicons name="at-outline" size={18} color={theme.secondary} />
              <TextInput
                value={username}
                onChangeText={setUsername}
                placeholder="Username"
                placeholderTextColor={theme.muted}
                style={[styles.input, { color: theme.text }]}
                autoCapitalize="none"
              />
            </View>

            {mode === 'register' && (
              <View style={[styles.inputWrapper, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
                <Ionicons name="mail-outline" size={18} color={theme.secondary} />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email (optional)"
                  placeholderTextColor={theme.muted}
                  style={[styles.input, { color: theme.text }]}
                  autoCapitalize="none"
                  keyboardType="email-address"
                />
              </View>
            )}

            <View style={[styles.inputWrapper, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
              <Ionicons name="lock-closed-outline" size={18} color={theme.secondary} />
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Password"
                placeholderTextColor={theme.muted}
                style={[styles.input, { color: theme.text }]}
                secureTextEntry
                onSubmitEditing={handleSubmit}
              />
            </View>

            <View style={{ marginTop: 16 }}>
              <GlowButton
                label={loading ? 'Authenticating…' : mode === 'login' ? 'Sign In' : 'Create Account'}
                onPress={handleSubmit}
                loading={loading}
              />
            </View>

            <Pressable
              onPress={() => {
                continueAsGuest();
                onClose();
              }}
              style={styles.guestBtn}
            >
              <Text style={[styles.guestText, { color: theme.secondary }]}>Continue as Guest</Text>
            </Pressable>
          </View>
        </LiquidGlassView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    padding: 22,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
    letterSpacing: -0.4,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 3,
    borderWidth: 1,
    marginBottom: 16,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 11,
  },
  activeTab: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '700',
  },
  form: {
    gap: 12,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 12,
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 12,
    flex: 1,
  },
  guestBtn: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  guestText: {
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
