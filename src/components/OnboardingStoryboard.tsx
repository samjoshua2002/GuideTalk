import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '@/src/context/ThemeContext';
import { useAuth } from '@/src/context/AuthContext';
import { GlowButton } from './GlowButton';
import { LiquidGlassView } from './LiquidGlassView';
import { CATEGORY_PRESETS, UniverseCategory } from '@/src/data/rivals';
import { Character } from '@/src/types/character';
import { triggerHaptic } from '@/src/lib/haptics';

const ONBOARDING_AVATAR_PRESETS = [
  'https://api.dicebear.com/9.x/adventurer/png?seed=Alex&backgroundColor=120D26',
  'https://api.dicebear.com/9.x/adventurer/png?seed=Luna&backgroundColor=120D26',
  'https://api.dicebear.com/9.x/adventurer/png?seed=Kai&backgroundColor=120D26',
  'https://api.dicebear.com/9.x/adventurer/png?seed=Rin&backgroundColor=120D26',
  'https://api.dicebear.com/9.x/adventurer/png?seed=Sora&backgroundColor=120D26',
];

const RANDOM_LORE_CHARACTERS = [
  {
    name: 'Gojo Satoru',
    series: 'Jujutsu Kaisen',
    quote: 'Looking powerful! Ready to conquer infinite domains?',
    avatar: 'https://s4.anilist.co/file/anilistcdn/character/large/b127518-d0xI8FhXNf9t.png',
  },
  {
    name: 'Furina',
    series: 'Genshin Impact',
    quote: 'Ah! A dazzling name fit for the grandest theater of Fontaine!',
    avatar: 'https://s4.anilist.co/file/anilistcdn/character/large/b316405-cMv87o2fO5W.png',
  },
  {
    name: 'Hu Tao',
    series: 'Genshin Impact',
    quote: 'Oho! Look who wandered into my realm. Ready for spooky rhymes?',
    avatar: 'https://s4.anilist.co/file/anilistcdn/character/large/b178491-cMv87o2fO5W.png',
  },
  {
    name: 'Raiden Shogun',
    series: 'Inazuma',
    quote: 'Your presence is acknowledged. Do you bring sweets or destiny?',
    avatar: 'https://s4.anilist.co/file/anilistcdn/character/large/b181464-dMv87o2fO5W.png',
  },
  {
    name: 'Levi Ackerman',
    series: 'Attack on Titan',
    quote: 'Stay sharp and keep moving. We have work to do.',
    avatar: 'https://s4.anilist.co/file/anilistcdn/character/large/b45627-c5m3rFw5fO5W.png',
  },
  {
    name: 'Mikasa Ackerman',
    series: 'Attack on Titan',
    quote: 'I will stay by your side no matter what realm we enter.',
    avatar: 'https://s4.anilist.co/file/anilistcdn/character/large/b40882-f5qO2Kj5nJ2K.png',
  },
];

interface OnboardingProps {
  visible: boolean;
  onComplete: () => void;
  onOpenSignIn: () => void;
}

export function OnboardingStoryboard({ visible, onComplete, onOpenSignIn }: OnboardingProps) {
  const { theme, isDark } = useTheme();
  const { register, login, setCompletedOnboarding, loginWithPasskey, sendVerificationOtp, verifyOtpCode } = useAuth();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<number>(1);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [avatarUri, setAvatarUri] = useState<string>(ONBOARDING_AVATAR_PRESETS[1]);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [randomCharIdx, setRandomCharIdx] = useState(0);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('marvel');
  const [selectedCompanionIds, setSelectedCompanionIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Active focus state for glowing input containers
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // In-storyboard Sign In mode
  const [isSignInMode, setIsSignInMode] = useState(false);
  const [signInUsername, setSignInUsername] = useState('');
  const [signInPassword, setSignInPassword] = useState('');
  const [signInLoading, setSignInLoading] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signInWithOtp, setSignInWithOtp] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpSending, setOtpSending] = useState(false);
  const [otpSuccessMessage, setOtpSuccessMessage] = useState<string | null>(null);

  const categoriesList: UniverseCategory[] = Object.values(CATEGORY_PRESETS);
  const currentCat = CATEGORY_PRESETS[selectedCategory] || categoriesList[0];

  useEffect(() => {
    if (selectedCompanionIds.length === 0 && currentCat) {
      setSelectedCompanionIds(currentCat.defaultPicks);
    }
  }, [selectedCategory]);

  const handleSelectCategory = (catId: string) => {
    triggerHaptic('selection');
    setSelectedCategory(catId);
    const cat = CATEGORY_PRESETS[catId];
    if (cat) {
      setSelectedCompanionIds(cat.defaultPicks);
    }
  };

  const handleSignIn = async () => {
    if (!signInUsername.trim() || !signInPassword.trim()) {
      triggerHaptic('warning');
      setSignInError('Please enter your username and password.');
      return;
    }
    setSignInLoading(true);
    setSignInError(null);
    try {
      await login(signInUsername.trim(), signInPassword.trim());
      await setCompletedOnboarding(true);
      triggerHaptic('success');
      onComplete();
    } catch (err: any) {
      triggerHaptic('warning');
      setSignInError(err?.message || 'Login failed. Please check your credentials.');
    } finally {
      setSignInLoading(false);
    }
  };

  const handleSendOtp = async () => {
    const clean = signInUsername.trim().toLowerCase();
    if (!clean || !clean.includes('@') || !clean.includes('.')) {
      triggerHaptic('warning');
      setSignInError('Please enter a valid email address to receive your login code.');
      return;
    }
    setOtpSending(true);
    setSignInError(null);
    try {
      const res = await sendVerificationOtp(clean);
      triggerHaptic('success');
      setOtpSent(true);
      if (res.fallbackCode) {
        setOtpCode(res.fallbackCode);
        setOtpSuccessMessage(`Code ready: ${res.fallbackCode}`);
      } else {
        setOtpSuccessMessage(`A 6-digit code has been sent to ${clean}`);
      }
    } catch (err: any) {
      triggerHaptic('warning');
      setSignInError(err?.message || 'Failed to send login code. Please try again.');
    } finally {
      setOtpSending(false);
    }
  };

  const handleVerifyOtp = async () => {
    const clean = signInUsername.trim().toLowerCase();
    if (!clean || !otpCode.trim() || otpCode.trim().length !== 6) {
      triggerHaptic('warning');
      setSignInError('Please enter the 6-digit code sent to your email.');
      return;
    }
    setSignInLoading(true);
    setSignInError(null);
    try {
      await verifyOtpCode(clean, otpCode.trim());
      await setCompletedOnboarding(true);
      triggerHaptic('success');
      onComplete();
    } catch (err: any) {
      triggerHaptic('warning');
      setSignInError(err?.message || 'Invalid or expired code. Please try again.');
    } finally {
      setSignInLoading(false);
    }
  };

  const handlePasskeySignIn = async () => {
    setSignInLoading(true);
    setSignInError(null);
    try {
      const ok = await loginWithPasskey(signInUsername.trim() || undefined);
      if (ok) {
        await setCompletedOnboarding(true);
        triggerHaptic('success');
        onComplete();
      } else {
        triggerHaptic('warning');
        setSignInError('No passkey found for this account.');
      }
    } catch (err: any) {
      triggerHaptic('warning');
      setSignInError(err?.message || 'Passkey sign-in failed.');
    } finally {
      setSignInLoading(false);
    }
  };

  const toggleCompanion = (charId: string) => {
    triggerHaptic('selection');
    if (selectedCompanionIds.includes(charId)) {
      setSelectedCompanionIds(selectedCompanionIds.filter((id) => id !== charId));
    } else {
      if (selectedCompanionIds.length < 3) {
        setSelectedCompanionIds([...selectedCompanionIds, charId]);
      } else {
        setSelectedCompanionIds([...selectedCompanionIds.slice(1), charId]);
      }
    }
  };

  const handlePickCustomAvatar = async () => {
    try {
      triggerHaptic('light');
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Photo Permission Needed',
          'Please allow photo library access to upload your custom profile picture.'
        );
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });
      if (!result.canceled && result.assets?.[0]?.uri) {
        setIsUploadingPhoto(true);
        setAvatarUri(result.assets[0].uri);
        triggerHaptic('success');
      }
    } catch (err) {
      console.warn('Pick avatar error in onboarding:', err);
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handleFinish = async (picksOverride?: string[]) => {
    const finalPicks =
      picksOverride && picksOverride.length > 0
        ? picksOverride
        : selectedCompanionIds.length > 0
        ? selectedCompanionIds
        : currentCat?.defaultPicks || ['tony-stark', 'batman', 'joker'];

    if (finalPicks.length === 0) {
      triggerHaptic('warning');
      setError('Please pick at least 1 companion to create your workspace.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const generatedUsername =
        username.trim() ||
        `${name.trim().toLowerCase().replace(/\s+/g, '')}${Math.floor(100 + Math.random() * 900)}`;
      const userPass = password || 'GuildTalk123!';

      await register(
        generatedUsername,
        userPass,
        name.trim(),
        email.trim(),
        age ? Number(age) : undefined,
        selectedCategory,
        finalPicks,
        avatarUri
      );
      await setCompletedOnboarding(true);
      triggerHaptic('success');
      onComplete();
    } catch (err: any) {
      triggerHaptic('warning');
      setError(err?.message || 'Failed to complete workspace setup.');
    } finally {
      setLoading(false);
    }
  };

  const availableCompanions: Character[] = currentCat?.characters || [];
  const safeTopPadding = Math.max(insets.top + 8, Platform.OS === 'ios' ? 52 : 24);

  if (!visible) {
    return null;
  }

  return (
    <Modal visible={visible} animationType="fade" statusBarTranslucent>
      <View style={[styles.fullPageContainer, { backgroundColor: theme.background }]}>
        {/* Modern Ambient Floating Glow Orbs for VisionOS/Liquid Glass depth */}
        <View style={styles.ambientGlowContainer} pointerEvents="none">
          <LinearGradient
            colors={
              isDark
                ? ['rgba(99, 102, 241, 0.20)', 'rgba(99, 102, 241, 0)']
                : ['rgba(99, 102, 241, 0.10)', 'rgba(99, 102, 241, 0)']
            }
            style={styles.ambientOrbTop}
          />
          <LinearGradient
            colors={
              isDark
                ? ['rgba(236, 72, 153, 0.16)', 'rgba(236, 72, 153, 0)']
                : ['rgba(236, 72, 153, 0.08)', 'rgba(236, 72, 153, 0)']
            }
            style={styles.ambientOrbBottom}
          />
        </View>

        {Platform.OS !== 'web' ? (
          <BlurView intensity={25} tint={theme.blurTint} style={StyleSheet.absoluteFill} />
        ) : null}

        <SafeAreaView style={styles.safeArea} edges={['bottom']}>
          {/* Top Liquid Glass Progress Bar & Controls */}
          <View style={[styles.topBar, { paddingTop: safeTopPadding }]}>
            {!isSignInMode && (
              <View style={styles.topProgressTrack}>
                {[1, 2, 3, 4].map((s) => {
                  const isActive = s === step;
                  const isDone = s < step;
                  return (
                    <View
                      key={s}
                      style={[
                        styles.topProgressSegment,
                        {
                          backgroundColor: isActive
                            ? theme.text
                            : isDone
                            ? theme.borderActive
                            : isDark
                            ? 'rgba(255,255,255,0.12)'
                            : 'rgba(0,0,0,0.08)',
                          flex: isActive ? 2.5 : 1,
                          height: isActive ? 5 : 4,
                          opacity: isActive ? 1 : isDone ? 0.8 : 0.45,
                        },
                      ]}
                    />
                  );
                })}
              </View>
            )}

            <View style={styles.topHeaderRow}>
              {isSignInMode ? (
                <Pressable
                  onPress={() => {
                    triggerHaptic('light');
                    setIsSignInMode(false);
                    setSignInError(null);
                  }}
                  hitSlop={12}
                  style={[styles.backIconBtn, { borderColor: theme.border, backgroundColor: theme.surfaceSecondary }]}
                >
                  <Ionicons name="arrow-back" size={17} color={theme.text} />
                </Pressable>
              ) : step > 1 ? (
                <Pressable
                  onPress={() => {
                    triggerHaptic('light');
                    setStep(step - 1);
                  }}
                  hitSlop={12}
                  style={[styles.backIconBtn, { borderColor: theme.border, backgroundColor: theme.surfaceSecondary }]}
                >
                  <Ionicons name="arrow-back" size={17} color={theme.text} />
                </Pressable>
              ) : (
                <View style={{ width: 38 }} />
              )}

              <View style={[styles.stepIndicatorPill, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}>
                <Ionicons name="sparkles" size={11} color={theme.secondary} style={{ marginRight: 4 }} />
                <Text style={[styles.stepIndicatorText, { color: theme.secondary }]}>
                  {isSignInMode ? 'ACCOUNT LOGIN' : `STEP ${step} OF 4`}
                </Text>
              </View>

              {!isSignInMode && step === 1 ? (
                <Pressable
                  onPress={() => {
                    triggerHaptic('light');
                    setIsSignInMode(true);
                    setSignInError(null);
                  }}
                  hitSlop={12}
                  style={[styles.signInTopBtnWrap, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}
                >
                  <Text style={[styles.signInTopBtn, { color: theme.text }]}>Sign In</Text>
                </Pressable>
              ) : (
                <View style={{ width: 38 }} />
              )}
            </View>
          </View>

          {/* SIGN IN SCREEN */}
          {isSignInMode ? (
            <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
              <LiquidGlassView style={styles.logoEmblemGlass} intensity={40} borderRadius={36} elevated>
                <Ionicons name="log-in-outline" size={36} color={theme.text} />
              </LiquidGlassView>

              <Text style={[styles.pageEyebrow, { color: theme.secondary }]}>WELCOME BACK</Text>
              <Text style={[styles.pageTitle, { color: theme.text }]}>Sign in to GuildTalk</Text>
              <Text style={[styles.pageSubtitle, { color: theme.secondary }]}>
                Log in to access your custom companions, workspace, and synced chat memory.
              </Text>

              {signInError && (
                <View style={[styles.errorBox, { borderColor: '#FF3B30', backgroundColor: 'rgba(255, 59, 48, 0.08)' }]}>
                  <Ionicons name="alert-circle-outline" size={16} color="#FF3B30" style={{ marginRight: 8 }} />
                  <Text style={{ color: '#FF3B30', fontSize: 13, flex: 1, fontWeight: '600' }}>{signInError}</Text>
                </View>
              )}

              {/* Mode Selector: Password vs Email OTP */}
              <View style={[styles.loginModeTabsRow, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}>
                <Pressable
                  onPress={() => {
                    triggerHaptic('selection');
                    setSignInWithOtp(false);
                    setSignInError(null);
                  }}
                  style={[
                    styles.loginModeTabBtn,
                    !signInWithOtp && [styles.loginModeTabBtnActive, { backgroundColor: theme.text }],
                  ]}
                >
                  <Text style={[styles.loginModeTabText, { color: !signInWithOtp ? theme.background : theme.secondary }]}>
                    Password
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    triggerHaptic('selection');
                    setSignInWithOtp(true);
                    setSignInError(null);
                  }}
                  style={[
                    styles.loginModeTabBtn,
                    signInWithOtp && [styles.loginModeTabBtnActive, { backgroundColor: theme.text }],
                  ]}
                >
                  <Text style={[styles.loginModeTabText, { color: signInWithOtp ? theme.background : theme.secondary }]}>
                    Email 6-Digit Code
                  </Text>
                </Pressable>
              </View>

              {!signInWithOtp ? (
                <>
                  {/* Username or Email field */}
                  <LiquidGlassView
                    style={[
                      styles.fullPageInputWrap,
                      focusedField === 'signInUser' && { borderColor: theme.text, borderWidth: 1.5 },
                    ]}
                    intensity={30}
                    borderRadius={18}
                  >
                    <Ionicons name="person-outline" size={19} color={focusedField === 'signInUser' ? theme.text : theme.secondary} />
                    <TextInput
                      value={signInUsername}
                      onChangeText={setSignInUsername}
                      placeholder="Username or Email"
                      placeholderTextColor={theme.muted}
                      style={[styles.fullPageInput, { color: theme.text }]}
                      autoCapitalize="none"
                      autoCorrect={false}
                      onFocus={() => setFocusedField('signInUser')}
                      onBlur={() => setFocusedField(null)}
                    />
                  </LiquidGlassView>

                  {/* Password field */}
                  <LiquidGlassView
                    style={[
                      styles.fullPageInputWrap,
                      { marginTop: 14 },
                      focusedField === 'signInPass' && { borderColor: theme.text, borderWidth: 1.5 },
                    ]}
                    intensity={30}
                    borderRadius={18}
                  >
                    <Ionicons name="lock-closed-outline" size={19} color={focusedField === 'signInPass' ? theme.text : theme.secondary} />
                    <TextInput
                      value={signInPassword}
                      onChangeText={setSignInPassword}
                      placeholder="Password"
                      placeholderTextColor={theme.muted}
                      secureTextEntry
                      style={[styles.fullPageInput, { color: theme.text }]}
                      onSubmitEditing={handleSignIn}
                      onFocus={() => setFocusedField('signInPass')}
                      onBlur={() => setFocusedField(null)}
                    />
                  </LiquidGlassView>

                  <View style={styles.bottomCtaContainer}>
                    <GlowButton
                      label={signInLoading ? 'Signing in…' : 'Sign In'}
                      icon={<Ionicons name="log-in-outline" size={16} color={theme.background} />}
                      loading={signInLoading}
                      disabled={!signInUsername.trim() || !signInPassword.trim()}
                      onPress={handleSignIn}
                    />
                  </View>
                </>
              ) : (
                <>
                  {/* Email field */}
                  <LiquidGlassView
                    style={[
                      styles.fullPageInputWrap,
                      focusedField === 'signInUser' && { borderColor: theme.text, borderWidth: 1.5 },
                    ]}
                    intensity={30}
                    borderRadius={18}
                  >
                    <Ionicons name="mail-outline" size={19} color={focusedField === 'signInUser' ? theme.text : theme.secondary} />
                    <TextInput
                      value={signInUsername}
                      onChangeText={setSignInUsername}
                      placeholder="Enter your email address"
                      placeholderTextColor={theme.muted}
                      keyboardType="email-address"
                      style={[styles.fullPageInput, { color: theme.text }]}
                      autoCapitalize="none"
                      autoCorrect={false}
                      onFocus={() => setFocusedField('signInUser')}
                      onBlur={() => setFocusedField(null)}
                    />
                  </LiquidGlassView>

                  {otpSuccessMessage && (
                    <View style={[styles.errorBox, { borderColor: '#30D158', backgroundColor: 'rgba(48, 209, 88, 0.08)', marginTop: 12 }]}>
                      <Ionicons name="checkmark-circle-outline" size={16} color="#30D158" style={{ marginRight: 8 }} />
                      <Text style={{ color: '#30D158', fontSize: 13, flex: 1, fontWeight: '600' }}>{otpSuccessMessage}</Text>
                    </View>
                  )}

                  {otpSent && (
                    <LiquidGlassView
                      style={[
                        styles.fullPageInputWrap,
                        { marginTop: 14 },
                        focusedField === 'otpCode' && { borderColor: theme.text, borderWidth: 1.5 },
                      ]}
                      intensity={30}
                      borderRadius={18}
                    >
                      <Ionicons name="key-outline" size={19} color={focusedField === 'otpCode' ? theme.text : theme.secondary} />
                      <TextInput
                        value={otpCode}
                        onChangeText={setOtpCode}
                        placeholder="Enter 6-digit code"
                        placeholderTextColor={theme.muted}
                        keyboardType="numeric"
                        maxLength={6}
                        style={[styles.fullPageInput, { color: theme.text, letterSpacing: 4, fontWeight: '700' }]}
                        onSubmitEditing={handleVerifyOtp}
                        onFocus={() => setFocusedField('otpCode')}
                        onBlur={() => setFocusedField(null)}
                      />
                    </LiquidGlassView>
                  )}

                  <View style={styles.bottomCtaContainer}>
                    {!otpSent ? (
                      <GlowButton
                        label={otpSending ? 'Sending Code…' : 'Send 6-Digit Code'}
                        icon={<Ionicons name="paper-plane-outline" size={16} color={theme.background} />}
                        loading={otpSending}
                        disabled={!signInUsername.trim() || otpSending}
                        onPress={handleSendOtp}
                      />
                    ) : (
                      <>
                        <GlowButton
                          label={signInLoading ? 'Verifying…' : 'Verify Code & Sign In'}
                          icon={<Ionicons name="shield-checkmark-outline" size={16} color={theme.background} />}
                          loading={signInLoading}
                          disabled={otpCode.trim().length !== 6 || signInLoading}
                          onPress={handleVerifyOtp}
                        />
                        <Pressable
                          onPress={handleSendOtp}
                          disabled={otpSending}
                          style={{ marginTop: 10, alignItems: 'center' }}
                        >
                          <Text style={{ fontSize: 12, color: '#0A84FF', fontWeight: '600' }}>
                            {otpSending ? 'Resending…' : 'Resend Code'}
                          </Text>
                        </Pressable>
                      </>
                    )}
                  </View>
                </>
              )}

                <View style={{ marginTop: 10 }}>
                  <GlowButton
                    label={signInLoading ? 'Authenticating…' : 'Sign In with Passkey / Face ID'}
                    icon={<Ionicons name="finger-print" size={16} color={theme.text} />}
                    variant="secondary"
                    disabled={signInLoading}
                    onPress={handlePasskeySignIn}
                  />
                </View>

                <Pressable
                  onPress={() => {
                    triggerHaptic('light');
                    setIsSignInMode(false);
                    setSignInError(null);
                  }}
                  style={{ marginTop: 16, alignItems: 'center' }}
                >
                  <Text style={[styles.switchModeText, { color: theme.secondary }]}>
                    Don’t have an account? <Text style={{ color: theme.text, fontWeight: '800' }}>Start Onboarding</Text>
                  </Text>
                </Pressable>
            </ScrollView>
          ) : null}

          {/* SCREEN 1: Unified Identity & Avatar (Instagram / Snap Style) */}
          {!isSignInMode && step === 1 && (
            <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
              {/* Dynamic Live Random Character Reactions Box */}
              <View style={[styles.randomReactionCard, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}>
                <Image
                  source={{ uri: RANDOM_LORE_CHARACTERS[randomCharIdx].avatar }}
                  style={styles.randomReactionAvatar}
                  contentFit="cover"
                />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={[styles.randomReactionName, { color: theme.text }]}>
                      {RANDOM_LORE_CHARACTERS[randomCharIdx].name}
                    </Text>
                    <View style={styles.livePulseDot} />
                  </View>
                  <Text style={[styles.randomReactionQuote, { color: theme.secondary }]} numberOfLines={2}>
                    {name.trim()
                      ? `"${name}! ${RANDOM_LORE_CHARACTERS[randomCharIdx].quote}"`
                      : `"${RANDOM_LORE_CHARACTERS[randomCharIdx].quote}"`}
                  </Text>
                </View>
              </View>

              {/* Instagram / Snap Story Ring User Avatar with Camera Badge */}
              <View style={styles.storyAvatarCenter}>
                <Pressable
                  onPress={handlePickCustomAvatar}
                  disabled={isUploadingPhoto}
                  style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}
                >
                  <LinearGradient
                    colors={['#F58529', '#DD2A7B', '#8134AF', '#515BD4']}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.storyRing}
                  >
                    <View style={[styles.storyAvatarInner, { backgroundColor: theme.background }]}>
                      <Image source={{ uri: avatarUri }} style={styles.storyAvatarImg} />
                    </View>
                  </LinearGradient>
                  <View style={[styles.cameraBadge, { backgroundColor: theme.text }]}>
                    {isUploadingPhoto ? (
                      <ActivityIndicator size="small" color={theme.background} />
                    ) : (
                      <Ionicons name="camera" size={15} color={theme.background} />
                    )}
                  </View>
                </Pressable>

                <Text style={[styles.storyAvatarHint, { color: theme.secondary }]}>
                  Tap avatar to upload your own picture
                </Text>

                {/* Avatar Quick Presets Strip */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.avatarPresetsRow}
                >
                  <Pressable
                    onPress={handlePickCustomAvatar}
                    style={[styles.uploadPresetChip, { backgroundColor: theme.surfaceSecondary, borderColor: theme.border }]}
                  >
                    <Ionicons name="cloud-upload-outline" size={14} color={theme.text} />
                    <Text style={[styles.uploadPresetText, { color: theme.text }]}>Upload</Text>
                  </Pressable>
                  {ONBOARDING_AVATAR_PRESETS.map((uri, idx) => (
                    <Pressable
                      key={idx}
                      onPress={() => {
                        triggerHaptic('selection');
                        setAvatarUri(uri);
                      }}
                      style={[
                        styles.miniAvatarPreset,
                        avatarUri === uri && { borderColor: theme.text, borderWidth: 2.5 },
                      ]}
                    >
                      <Image source={{ uri }} style={styles.miniAvatarPresetImg} />
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              <Text style={[styles.pageEyebrow, { color: theme.secondary, marginTop: 14 }]}>YOUR IDENTITY</Text>
              <Text style={[styles.pageTitle, { color: theme.text }]}>What should we call you?</Text>

              {/* Name Field */}
              <LiquidGlassView
                style={[
                  styles.fullPageInputWrap,
                  focusedField === 'name' && { borderColor: theme.text, borderWidth: 1.5 },
                ]}
                intensity={30}
                borderRadius={18}
              >
                <Ionicons name="person-outline" size={20} color={focusedField === 'name' ? theme.text : theme.secondary} />
                <TextInput
                  value={name}
                  onChangeText={(val) => {
                    setName(val);
                    if (val.length > 0) {
                      setRandomCharIdx(val.length % RANDOM_LORE_CHARACTERS.length);
                    }
                  }}
                  placeholder="Enter your name or alias"
                  placeholderTextColor={theme.muted}
                  style={[styles.fullPageInput, { color: theme.text }]}
                  autoFocus
                  onFocus={() => setFocusedField('name')}
                  onBlur={() => setFocusedField(null)}
                />
              </LiquidGlassView>

              {/* Age Field (Clean, NO suggestions/chips) */}
              <LiquidGlassView
                style={[
                  styles.fullPageInputWrap,
                  { marginTop: 12 },
                  focusedField === 'age' && { borderColor: theme.text, borderWidth: 1.5 },
                ]}
                intensity={30}
                borderRadius={18}
              >
                <Ionicons name="calendar-outline" size={19} color={focusedField === 'age' ? theme.text : theme.secondary} />
                <TextInput
                  value={age}
                  onChangeText={setAge}
                  placeholder="Enter your age (e.g. 21)"
                  placeholderTextColor={theme.muted}
                  keyboardType="numeric"
                  style={[styles.fullPageInput, { color: theme.text }]}
                  onFocus={() => setFocusedField('age')}
                  onBlur={() => setFocusedField(null)}
                />
              </LiquidGlassView>

              <View style={styles.bottomCtaContainer}>
                <GlowButton
                  label="Continue"
                  icon={<Ionicons name="arrow-forward" size={16} color={theme.background} />}
                  disabled={!name.trim()}
                  onPress={() => {
                    triggerHaptic('medium');
                    setStep(2);
                  }}
                />
              </View>
            </ScrollView>
          )}

          {/* SCREEN 2: Account Credentials */}
          {step === 2 && (
            <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
              <LiquidGlassView style={styles.logoEmblemSmallGlass} intensity={35} borderRadius={30} elevated>
                <Ionicons name="shield-checkmark-outline" size={26} color={theme.text} />
              </LiquidGlassView>

              <Text style={[styles.pageEyebrow, { color: theme.secondary }]}>CLOUD SYNC</Text>
              <Text style={[styles.pageTitle, { color: theme.text }]}>Create your account</Text>
              <Text style={[styles.pageSubtitle, { color: theme.secondary }]}>
                Stores conversation histories and custom companion lore securely in your MongoDB cloud.
              </Text>

              <LiquidGlassView
                style={[
                  styles.fullPageInputWrap,
                  focusedField === 'email' && { borderColor: theme.text, borderWidth: 1.5 },
                ]}
                intensity={30}
                borderRadius={18}
              >
                <Ionicons name="mail-outline" size={19} color={focusedField === 'email' ? theme.text : theme.secondary} />
                <TextInput
                  value={email}
                  onChangeText={setEmail}
                  placeholder="Email address"
                  placeholderTextColor={theme.muted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={[styles.fullPageInput, { color: theme.text }]}
                  onFocus={() => setFocusedField('email')}
                  onBlur={() => setFocusedField(null)}
                />
              </LiquidGlassView>

              <LiquidGlassView
                style={[
                  styles.fullPageInputWrap,
                  { marginTop: 14 },
                  focusedField === 'password' && { borderColor: theme.text, borderWidth: 1.5 },
                ]}
                intensity={30}
                borderRadius={18}
              >
                <Ionicons name="lock-closed-outline" size={19} color={focusedField === 'password' ? theme.text : theme.secondary} />
                <TextInput
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Choose a password"
                  placeholderTextColor={theme.muted}
                  secureTextEntry
                  style={[styles.fullPageInput, { color: theme.text }]}
                  onFocus={() => setFocusedField('password')}
                  onBlur={() => setFocusedField(null)}
                />
              </LiquidGlassView>

              <View style={styles.bottomCtaContainer}>
                <GlowButton
                  label="Continue to Preferences"
                  icon={<Ionicons name="arrow-forward" size={16} color={theme.background} />}
                  onPress={() => {
                    triggerHaptic('medium');
                    setStep(3);
                  }}
                />
              </View>
            </ScrollView>
          )}

          {/* SCREEN 3: Category Selection (Marvel, Anime, Games, Hollywood, Bollywood) */}
          {step === 3 && (
            <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
              <LiquidGlassView style={styles.logoEmblemSmallGlass} intensity={35} borderRadius={30} elevated>
                <Ionicons name="compass-outline" size={26} color={theme.text} />
              </LiquidGlassView>

              <Text style={[styles.pageEyebrow, { color: theme.secondary }]}>FAVORITE UNIVERSE</Text>
              <Text style={[styles.pageTitle, { color: theme.text }]}>Pick your favorite category</Text>
              <Text style={[styles.pageSubtitle, { color: theme.secondary }]}>
                Select your universe. Your AI workspace will open directly populated with its top iconic legends.
              </Text>

              <View style={styles.categoriesList}>
                {categoriesList.map((cat) => {
                  const isSelected = selectedCategory === cat.id;
                  return (
                    <Pressable
                      key={cat.id}
                      onPress={() => handleSelectCategory(cat.id)}
                      style={{ width: '100%' }}
                    >
                      <LiquidGlassView
                        style={[
                          styles.categoryRowCardGlass,
                          {
                            borderColor: isSelected ? theme.text : theme.border,
                            borderWidth: isSelected ? 1.8 : 1,
                          },
                        ]}
                        intensity={isSelected ? 45 : 25}
                        borderRadius={20}
                        elevated={isSelected}
                      >
                        {/* Left Icon Emblem */}
                        <View
                          style={[
                            styles.catIconWrap,
                            {
                              backgroundColor: isSelected ? theme.text : theme.surfaceSecondary,
                            },
                          ]}
                        >
                          <Ionicons
                            name={cat.icon as any}
                            size={21}
                            color={isSelected ? theme.background : theme.text}
                          />
                        </View>

                        {/* Center Info & Avatars */}
                        <View style={{ flex: 1 }}>
                          <View style={styles.categoryTitleRow}>
                            <Text style={[styles.categoryRowTitle, { color: theme.text }]}>
                              {cat.name}
                            </Text>
                            <View
                              style={[
                                styles.categoryBadgePill,
                                {
                                  backgroundColor: isSelected ? theme.text : theme.surfaceSecondary,
                                  borderColor: theme.border,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.categoryBadgeText,
                                  { color: isSelected ? theme.background : theme.secondary },
                                ]}
                              >
                                {cat.badge}
                              </Text>
                            </View>
                          </View>

                          <Text
                            style={[styles.categoryRowSubtitle, { color: theme.secondary }]}
                            numberOfLines={1}
                          >
                            {cat.subtitle}
                          </Text>

                          {/* Overlapping mini avatar stack preview */}
                          <View style={styles.avatarMiniStack}>
                            {cat.previewAvatars.map((imgUri, idx) => (
                              <Image
                                key={idx}
                                source={{ uri: imgUri }}
                                style={[
                                  styles.avatarMini,
                                  {
                                    marginLeft: idx > 0 ? -8 : 0,
                                    borderColor: theme.background,
                                  },
                                ]}
                                contentFit="cover"
                                contentPosition="top"
                              />
                            ))}
                            <Text style={[styles.includesLabel, { color: theme.muted }]}>
                              Includes top 3 legends
                            </Text>
                          </View>
                        </View>

                        {/* Right Checkmark circle */}
                        <View
                          style={[
                            styles.checkRadio,
                            {
                              backgroundColor: isSelected ? theme.text : 'transparent',
                              borderColor: isSelected ? theme.text : theme.border,
                            },
                          ]}
                        >
                          {isSelected && (
                            <Ionicons name="checkmark" size={13} color={theme.background} />
                          )}
                        </View>
                      </LiquidGlassView>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.bottomCtaContainer}>
                <GlowButton
                  label={loading ? 'Building Workspace…' : `Open Workspace with ${currentCat.name}`}
                  icon={<Ionicons name="sparkles" size={16} color={theme.background} />}
                  loading={loading}
                  onPress={() => handleFinish(currentCat.defaultPicks)}
                />

                <Pressable
                  onPress={() => {
                    triggerHaptic('light');
                    setStep(4);
                  }}
                  style={styles.customizeRowBtn}
                  hitSlop={12}
                >
                  <Ionicons name="options-outline" size={15} color={theme.secondary} />
                  <Text style={[styles.customizeRowText, { color: theme.secondary }]}>
                    Or customize 3 individual companions
                  </Text>
                  <Ionicons name="chevron-forward" size={14} color={theme.secondary} />
                </Pressable>
              </View>
            </ScrollView>
          )}

          {/* SCREEN 4: Netflix-Style Boxed Companions & Favorites */}
          {step === 4 && (
            <View style={styles.netflixStepContainer}>
              <View style={styles.netflixHeader}>
                <View>
                  <Text style={[styles.pageEyebrow, { color: theme.secondary }]}>CUSTOMIZE WORKSPACE</Text>
                  <Text style={[styles.netflixTitle, { color: theme.text }]}>
                    Pick 3 Favorite Legends
                  </Text>
                </View>
                <View
                  style={[
                    styles.netflixCounterBadge,
                    {
                      backgroundColor: selectedCompanionIds.length === 3 ? theme.text : theme.surfaceSecondary,
                      borderColor: theme.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.netflixCounterText,
                      { color: selectedCompanionIds.length === 3 ? theme.background : theme.text },
                    ]}
                  >
                    {selectedCompanionIds.length} / 3 Selected
                  </Text>
                </View>
              </View>

              <Text style={[styles.netflixSubtitle, { color: theme.secondary }]}>
                Choose companions from {currentCat.name} for your personal workspace. We will also unlock their arch-rivals automatically.
              </Text>

              {error && (
                <View style={[styles.errorAlert, { borderColor: theme.border }]}>
                  <Ionicons name="alert-circle-outline" size={16} color="#FF3B30" />
                  <Text style={styles.errorAlertText}>{error}</Text>
                </View>
              )}

              {/* Netflix-Style 2-Column Boxed Grid */}
              <ScrollView
                style={styles.netflixScroll}
                contentContainerStyle={styles.netflixGrid}
                showsVerticalScrollIndicator={false}
              >
                {availableCompanions.map((char) => {
                  const isPicked = selectedCompanionIds.includes(char.id);
                  return (
                    <Pressable
                      key={char.id}
                      onPress={() => toggleCompanion(char.id)}
                      style={[
                        styles.netflixBox,
                        {
                          borderColor: isPicked ? theme.text : theme.border,
                          borderWidth: isPicked ? 2.5 : 1,
                        },
                      ]}
                    >
                      <Image
                        source={{ uri: char.coverUrl || char.avatarUrl }}
                        style={styles.netflixBoxCover}
                        contentFit="cover"
                        contentPosition="top"
                        transition={200}
                      />

                      {/* Frosted glass overlay at bottom */}
                      <View style={styles.netflixBoxOverlay}>
                        <View style={styles.netflixBadgePill}>
                          <Text style={styles.netflixBadgeText} numberOfLines={1}>
                            {char.series}
                          </Text>
                        </View>
                        <Text style={styles.netflixBoxName} numberOfLines={1}>
                          {char.name}
                        </Text>
                        <Text style={styles.netflixBoxRole} numberOfLines={1}>
                          {char.role}
                        </Text>
                      </View>

                      {/* Active Checkmark in Top Right */}
                      <View
                        style={[
                          styles.netflixCheckCircle,
                          {
                            backgroundColor: isPicked ? theme.text : 'rgba(0,0,0,0.5)',
                            borderColor: isPicked ? theme.text : 'rgba(255,255,255,0.7)',
                          },
                        ]}
                      >
                        {isPicked && <Ionicons name="checkmark" size={13} color={theme.background} />}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <View style={styles.bottomCtaContainerSticky}>
                <GlowButton
                  label={loading ? 'Setting up Workspace…' : 'Enter My Workspace'}
                  icon={<Ionicons name="sparkles" size={16} color={theme.background} />}
                  loading={loading}
                  disabled={selectedCompanionIds.length === 0}
                  onPress={() => handleFinish()}
                />
              </View>
            </View>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fullPageContainer: {
    flex: 1,
  },
  ambientGlowContainer: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  ambientOrbTop: {
    position: 'absolute',
    top: -80,
    left: -60,
    width: 280,
    height: 280,
    borderRadius: 140,
  },
  ambientOrbBottom: {
    position: 'absolute',
    bottom: 60,
    right: -80,
    width: 320,
    height: 320,
    borderRadius: 160,
  },
  safeArea: {
    flex: 1,
  },
  topBar: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
  },
  topProgressTrack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 16,
  },
  topProgressSegment: {
    borderRadius: 3,
  },
  topHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  backIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  stepIndicatorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  stepIndicatorText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.1,
    includeFontPadding: false,
  },
  signInTopBtnWrap: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
  },
  signInTopBtn: {
    fontSize: 12,
    fontWeight: '800',
    includeFontPadding: false,
  },
  stepContent: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  logoEmblemGlass: {
    width: 76,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    marginBottom: 20,
  },
  logoEmblemSmallGlass: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  pageEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 6,
    textAlign: 'center',
  },
  pageTitle: {
    fontSize: 27,
    fontWeight: '800',
    letterSpacing: -0.6,
    textAlign: 'center',
    marginBottom: 8,
  },
  pageSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 26,
    maxWidth: 320,
  },
  fullPageInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  fullPageInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
  },
  bottomCtaContainer: {
    width: '100%',
    marginTop: 26,
  },
  switchModeText: {
    fontSize: 13,
    fontWeight: '600',
  },
  ageChipsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 20,
    justifyContent: 'center',
  },
  ageChipBox: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  ageChipBoxText: {
    fontSize: 15,
    fontWeight: '700',
    includeFontPadding: false,
  },
  categoriesList: {
    width: '100%',
    gap: 12,
    marginBottom: 6,
  },
  categoryRowCardGlass: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 14,
    width: '100%',
  },
  catIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryRowTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  categoryBadgePill: {
    paddingHorizontal: 8,
    paddingVertical: Platform.OS === 'android' ? 4 : 3,
    borderRadius: 8,
    borderWidth: 0.5,
  },
  categoryBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    includeFontPadding: false,
  },
  categoryRowSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  avatarMiniStack: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  avatarMini: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  includesLabel: {
    fontSize: 11,
    fontWeight: '600',
    marginLeft: 8,
  },
  checkRadio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customizeRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 16,
    paddingVertical: 8,
  },
  customizeRowText: {
    fontSize: 13,
    fontWeight: '700',
    includeFontPadding: false,
  },
  netflixStepContainer: {
    flex: 1,
    paddingHorizontal: 20,
  },
  netflixHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  netflixTitle: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  netflixSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
    marginBottom: 12,
  },
  netflixCounterBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
  },
  netflixCounterText: {
    fontSize: 12,
    fontWeight: '800',
    includeFontPadding: false,
  },
  netflixScroll: {
    flex: 1,
  },
  netflixGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingBottom: 20,
  },
  netflixBox: {
    width: '48%',
    height: 220,
    borderRadius: 20,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000',
  },
  netflixBoxCover: {
    width: '100%',
    height: '100%',
  },
  netflixBoxOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 10,
    backgroundColor: 'rgba(0,0,0,0.74)',
  },
  netflixBadgePill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.22)',
    paddingHorizontal: 8,
    paddingVertical: Platform.OS === 'android' ? 4 : 3,
    borderRadius: 8,
    marginBottom: 4,
  },
  netflixBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    includeFontPadding: false,
  },
  netflixBoxName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  netflixBoxRole: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    marginTop: 1,
  },
  netflixCheckCircle: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  bottomCtaContainerSticky: {
    paddingVertical: 12,
  },
  errorAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 59, 48, 0.12)',
    borderWidth: 1,
    marginBottom: 10,
  },
  errorAlertText: {
    color: '#FF3B30',
    fontSize: 12,
    fontWeight: '600',
    includeFontPadding: false,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  randomReactionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 20,
    marginTop: 4,
  },
  randomReactionAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  randomReactionName: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  livePulseDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#34C759',
  },
  randomReactionQuote: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
    fontStyle: 'italic',
  },
  storyAvatarCenter: {
    alignItems: 'center',
    marginBottom: 14,
  },
  storyAvatarWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyRing: {
    width: 104,
    height: 104,
    borderRadius: 52,
    padding: 3.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyAvatarInner: {
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyAvatarImg: {
    width: '100%',
    height: '100%',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 6,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#000',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  storyAvatarHint: {
    fontSize: 12,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 14,
  },
  avatarPresetsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
  },
  uploadPresetChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 18,
    borderWidth: 1,
  },
  uploadPresetText: {
    fontSize: 12,
    fontWeight: '700',
  },
  miniAvatarPreset: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  miniAvatarPresetImg: {
    width: '100%',
    height: '100%',
  },
  loginModeTabsRow: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 3,
    marginBottom: 16,
    borderWidth: 1,
  },
  loginModeTabBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  loginModeTabBtnActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  loginModeTabText: {
    fontSize: 13,
    fontWeight: '700',
    includeFontPadding: false,
  },
});
