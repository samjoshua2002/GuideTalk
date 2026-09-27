import React, { useState, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Animated,
  Dimensions,
  ScrollView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/context/ThemeContext';
import { useAuth } from '@/src/context/AuthContext';
import { GlowButton } from './GlowButton';
import { triggerHaptic } from '@/src/lib/haptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface EmailVerificationGateProps {
  visible: boolean;
  onDismiss?: () => void;
  onSuccess?: () => void;
  title?: string;
  subtitle?: string;
}

type Step = 'email' | 'otp' | 'passkey' | 'completed';

export function EmailVerificationGate({
  visible,
  onDismiss,
  onSuccess,
  title = 'Verify Your Email to Continue',
  subtitle = 'To safeguard your chats, storylines, and custom characters, please link and verify your active email address.',
}: EmailVerificationGateProps) {
  const { theme, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user, sendVerificationOtp, verifyOtpCode, registerPasskey } = useAuth();

  const [step, setStep] = useState<Step>('email');
  const [emailInput, setEmailInput] = useState('');
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const [cooldown, setCooldown] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Passkey prompt state
  const [isPasskeyLoading, setIsPasskeyLoading] = useState(false);
  const [passkeyEnrolled, setPasskeyEnrolled] = useState(false);

  // OTP inputs references
  const digitInputRefs = useRef<Array<TextInput | null>>([]);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Initialize email input from existing user profile if available
  useEffect(() => {
    if (visible) {
      const existingEmail = user?.email || '';
      // Only prefill if it looks somewhat like an email (even dummy)
      setEmailInput(existingEmail);
      setStep('email');
      setErrorMessage(null);
      setSuccessMessage(null);
      setOtpDigits(['', '', '', '', '', '']);
      setPasskeyEnrolled(false);
    }
  }, [visible, user?.email]);

  // Handle 60s cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Subtle pulsing animation on step change
  useEffect(() => {
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1.03, duration: 150, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
    ]).start();
  }, [step]);

  const handleSendCode = async () => {
    const cleanEmail = emailInput.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      triggerHaptic('warning');
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await sendVerificationOtp(cleanEmail);
      triggerHaptic('success');
      setCooldown(res.cooldownSeconds || 60);
      setSuccessMessage(`A 6-digit code has been sent to ${cleanEmail}`);
      setStep('otp');
      // Auto-focus first digit after step transition
      setTimeout(() => {
        digitInputRefs.current[0]?.focus();
      }, 350);
    } catch (err: any) {
      triggerHaptic('warning');
      setErrorMessage(err?.message || 'Failed to send verification email. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtpDigitChange = (value: string, index: number) => {
    const cleanVal = value.replace(/[^0-9]/g, '');
    const newDigits = [...otpDigits];

    if (cleanVal.length > 1) {
      // Pasted multi-digit code (e.g. 6 digits)
      const pasted = cleanVal.slice(0, 6).split('');
      for (let i = 0; i < pasted.length; i++) {
        newDigits[i] = pasted[i];
      }
      setOtpDigits(newDigits);
      const nextFocus = Math.min(pasted.length, 5);
      digitInputRefs.current[nextFocus]?.focus();
      if (pasted.length === 6) {
        submitVerificationCode(newDigits.join(''));
      }
      return;
    }

    newDigits[index] = cleanVal;
    setOtpDigits(newDigits);

    if (cleanVal && index < 5) {
      digitInputRefs.current[index + 1]?.focus();
    }

    // Auto submit if all 6 digits are filled
    if (newDigits.every((d) => d.length === 1)) {
      submitVerificationCode(newDigits.join(''));
    }
  };

  const handleOtpKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !otpDigits[index] && index > 0) {
      digitInputRefs.current[index - 1]?.focus();
    }
  };

  const submitVerificationCode = async (codeOverride?: string) => {
    const code = codeOverride || otpDigits.join('');
    if (code.length !== 6) {
      triggerHaptic('warning');
      setErrorMessage('Please enter the full 6-digit code.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    try {
      await verifyOtpCode(emailInput.trim().toLowerCase(), code);
      triggerHaptic('success');
      setStep('passkey');
    } catch (err: any) {
      triggerHaptic('warning');
      setErrorMessage(err?.message || 'Invalid or expired code. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnrollPasskey = async () => {
    setIsPasskeyLoading(true);
    setErrorMessage(null);
    try {
      await registerPasskey(
        Platform.OS === 'ios'
          ? 'Apple Face ID / Touch ID'
          : Platform.OS === 'android'
          ? 'Android Biometrics'
          : 'Personal Device Passkey'
      );
      triggerHaptic('success');
      setPasskeyEnrolled(true);
      setTimeout(() => {
        setStep('completed');
      }, 1000);
    } catch (err: any) {
      triggerHaptic('warning');
      setErrorMessage('Could not register passkey on this device. You can set it up anytime later.');
      // Continue to completed step anyway so user isn't stuck
      setStep('completed');
    } finally {
      setIsPasskeyLoading(false);
    }
  };

  const handleFinish = () => {
    triggerHaptic('selection');
    if (onSuccess) onSuccess();
    if (onDismiss) onDismiss();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent statusBarTranslucent>
      <View style={styles.backdrop}>
        <LinearGradient
          colors={
            isDark
              ? ['rgba(10, 15, 30, 0.98)', 'rgba(5, 7, 15, 0.99)']
              : ['rgba(240, 243, 250, 0.98)', 'rgba(255, 255, 255, 0.99)']
          }
          style={StyleSheet.absoluteFill}
        />

        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.keyboardAvoid}
          >
            {/* Top Bar with Dismiss (if optional) */}
            <View style={styles.headerBar}>
              <View style={styles.securityTag}>
                <Ionicons name="shield-checkmark" size={14} color="#30D158" style={{ marginRight: 6 }} />
                <Text style={styles.securityTagText}>ACCOUNT SECURITY UPGRADE</Text>
              </View>

              {onDismiss && (
                <Pressable
                  onPress={onDismiss}
                  style={[
                    styles.closeBtn,
                    { backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' },
                  ]}
                  hitSlop={12}
                >
                  <Ionicons name="close" size={20} color={theme.text} />
                </Pressable>
              )}
            </View>

            <ScrollView
              contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* STEP 1: EMAIL ENTRY OR CONFIRMATION */}
              {step === 'email' && (
                <Animated.View style={[styles.stepCard, { transform: [{ scale: pulseAnim }] }]}>
                  <View style={[styles.iconCircle, { backgroundColor: 'rgba(10, 132, 255, 0.12)' }]}>
                    <Ionicons name="mail" size={32} color="#0A84FF" />
                  </View>

                  <Text style={[styles.stepTitle, { color: theme.text }]}>{title}</Text>
                  <Text style={[styles.stepSubtitle, { color: theme.secondary }]}>{subtitle}</Text>

                  <View style={styles.guaranteeBox}>
                    <Ionicons name="checkmark-done-circle" size={18} color="#30D158" style={{ marginRight: 8, marginTop: 1 }} />
                    <Text style={[styles.guaranteeText, { color: theme.text }]}>
                      Your profile, companion conversations, custom characters, and unlocked storylines will be completely preserved.
                    </Text>
                  </View>

                  <View style={styles.inputSection}>
                    <Text style={[styles.inputLabel, { color: theme.text }]}>Email Address</Text>
                    <View
                      style={[
                        styles.inputContainer,
                        {
                          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : '#FFFFFF',
                          borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
                        },
                      ]}
                    >
                      <Ionicons name="at" size={20} color={theme.secondary} style={{ marginRight: 10 }} />
                      <TextInput
                        style={[styles.textInput, { color: theme.text }]}
                        value={emailInput}
                        onChangeText={(txt) => {
                          setEmailInput(txt);
                          setErrorMessage(null);
                        }}
                        placeholder="you@example.com"
                        placeholderTextColor={theme.secondary}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus
                      />
                    </View>
                    <Text style={[styles.helperNote, { color: theme.secondary }]}>
                      You can enter your existing email or update to a new real email address.
                    </Text>
                  </View>

                  {errorMessage && (
                    <View style={styles.errorBanner}>
                      <Ionicons name="alert-circle" size={16} color="#FF453A" style={{ marginRight: 6 }} />
                      <Text style={styles.errorBannerText}>{errorMessage}</Text>
                    </View>
                  )}

                  <GlowButton
                    label={isLoading ? 'Sending Code...' : 'Send 6-Digit Code'}
                    onPress={handleSendCode}
                    variant="primary"
                    disabled={isLoading || !emailInput.trim()}
                    style={{ width: '100%', marginTop: 8 }}
                  />
                </Animated.View>
              )}

              {/* STEP 2: OTP VERIFICATION */}
              {step === 'otp' && (
                <Animated.View style={[styles.stepCard, { transform: [{ scale: pulseAnim }] }]}>
                  <View style={[styles.iconCircle, { backgroundColor: 'rgba(48, 209, 88, 0.12)' }]}>
                    <Ionicons name="keypad" size={32} color="#30D158" />
                  </View>

                  <Text style={[styles.stepTitle, { color: theme.text }]}>Enter Verification Code</Text>
                  <Text style={[styles.stepSubtitle, { color: theme.secondary }]}>
                    We sent a 6-digit code to{' '}
                    <Text style={{ color: '#0A84FF', fontWeight: '700' }}>{emailInput}</Text>. Enter it below
                    to confirm.
                  </Text>

                  {/* 6 Digit Inputs */}
                  <View style={styles.otpRow}>
                    {otpDigits.map((digit, idx) => (
                      <TextInput
                        key={`digit-${idx}`}
                        ref={(ref) => {
                          digitInputRefs.current[idx] = ref;
                        }}
                        style={[
                          styles.otpBox,
                          {
                            backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : '#FFFFFF',
                            borderColor: digit
                              ? '#0A84FF'
                              : isDark
                              ? 'rgba(255, 255, 255, 0.15)'
                              : 'rgba(0, 0, 0, 0.15)',
                            color: theme.text,
                          },
                        ]}
                        value={digit}
                        onChangeText={(val) => handleOtpDigitChange(val, idx)}
                        onKeyPress={(e) => handleOtpKeyPress(e, idx)}
                        keyboardType="number-pad"
                        maxLength={6}
                        selectTextOnFocus
                      />
                    ))}
                  </View>

                  <Text style={[styles.expiryText, { color: '#FF9F0A' }]}>
                    ⏱ Code expires in 10 minutes
                  </Text>

                  {errorMessage && (
                    <View style={styles.errorBanner}>
                      <Ionicons name="alert-circle" size={16} color="#FF453A" style={{ marginRight: 6 }} />
                      <Text style={styles.errorBannerText}>{errorMessage}</Text>
                    </View>
                  )}

                  <GlowButton
                    label={isLoading ? 'Verifying...' : 'Verify & Continue'}
                    onPress={() => submitVerificationCode()}
                    variant="primary"
                    disabled={isLoading || otpDigits.some((d) => !d)}
                    style={{ width: '100%', marginTop: 12 }}
                  />

                  {/* Resend and Edit Actions */}
                  <View style={styles.otpActionsRow}>
                    <Pressable
                      onPress={handleSendCode}
                      disabled={cooldown > 0 || isLoading}
                      style={[styles.resendBtn, cooldown > 0 && { opacity: 0.6 }]}
                    >
                      <Ionicons name="refresh" size={14} color={cooldown > 0 ? theme.secondary : '#0A84FF'} style={{ marginRight: 4 }} />
                      <Text style={[styles.resendText, { color: cooldown > 0 ? theme.secondary : '#0A84FF' }]}>
                        {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend Code'}
                      </Text>
                    </Pressable>

                    <Pressable
                      onPress={() => {
                        setStep('email');
                        setErrorMessage(null);
                      }}
                      style={styles.changeEmailBtn}
                    >
                      <Text style={[styles.changeEmailText, { color: theme.secondary }]}>Edit Email</Text>
                    </Pressable>
                  </View>
                </Animated.View>
              )}

              {/* STEP 3: OPTIONAL PASSKEY / BIOMETRICS ENROLLMENT */}
              {step === 'passkey' && (
                <Animated.View style={[styles.stepCard, { transform: [{ scale: pulseAnim }] }]}>
                  <View style={[styles.iconCircle, { backgroundColor: 'rgba(191, 90, 242, 0.14)' }]}>
                    <Ionicons name="finger-print" size={36} color="#BF5AF2" />
                  </View>

                  <Text style={[styles.stepTitle, { color: theme.text }]}>Email Verified! 🎉</Text>
                  <Text style={[styles.stepSubtitle, { color: theme.secondary }]}>
                    Unlock instantaneous 1-tap login with Apple Face ID, Touch ID, or Android Biometrics.
                    Never wait for verification codes again.
                  </Text>

                  <View style={styles.passkeyBenefitsBox}>
                    <View style={styles.benefitRow}>
                      <Ionicons name="flash" size={16} color="#F4CD2A" style={{ marginRight: 10 }} />
                      <Text style={[styles.benefitText, { color: theme.text }]}>Zero passwords or verification codes needed</Text>
                    </View>
                    <View style={styles.benefitRow}>
                      <Ionicons name="lock-closed" size={16} color="#30D158" style={{ marginRight: 10 }} />
                      <Text style={[styles.benefitText, { color: theme.text }]}>Hardware-grade encryption stored safely on device</Text>
                    </View>
                    <View style={styles.benefitRow}>
                      <Ionicons name="sync" size={16} color="#0A84FF" style={{ marginRight: 10 }} />
                      <Text style={[styles.benefitText, { color: theme.text }]}>Seamlessly tied to your existing companion profile</Text>
                    </View>
                  </View>

                  {passkeyEnrolled ? (
                    <View style={[styles.passkeySuccessBox, { backgroundColor: 'rgba(48, 209, 88, 0.12)' }]}>
                      <Ionicons name="checkmark-circle" size={24} color="#30D158" style={{ marginRight: 8 }} />
                      <Text style={[styles.passkeySuccessText, { color: '#30D158' }]}>
                        Passkey successfully enrolled!
                      </Text>
                    </View>
                  ) : (
                    <View style={{ width: '100%', gap: 10, marginTop: 12 }}>
                      <GlowButton
                        label={
                          isPasskeyLoading
                            ? 'Activating Biometrics...'
                            : Platform.OS === 'ios'
                            ? 'Enable Face ID / Touch ID'
                            : 'Enable Native Passkey'
                        }
                        onPress={handleEnrollPasskey}
                        variant="primary"
                        disabled={isPasskeyLoading}
                      />

                      <Pressable onPress={() => setStep('completed')} style={styles.skipPasskeyBtn}>
                        <Text style={[styles.skipPasskeyText, { color: theme.secondary }]}>
                          Maybe Later
                        </Text>
                      </Pressable>
                    </View>
                  )}
                </Animated.View>
              )}

              {/* STEP 4: ALL SET */}
              {step === 'completed' && (
                <Animated.View style={[styles.stepCard, { transform: [{ scale: pulseAnim }] }]}>
                  <View style={[styles.iconCircle, { backgroundColor: 'rgba(48, 209, 88, 0.15)' }]}>
                    <Ionicons name="checkmark-done" size={38} color="#30D158" />
                  </View>

                  <Text style={[styles.stepTitle, { color: theme.text }]}>You're All Set!</Text>
                  <Text style={[styles.stepSubtitle, { color: theme.secondary }]}>
                    Your account is fully verified and upgraded. You can now chat continuously with your companions with zero interruptions.
                  </Text>

                  <GlowButton
                    label="Continue to Chat"
                    onPress={handleFinish}
                    variant="primary"
                    style={{ width: '100%', marginTop: 20 }}
                  />
                </Animated.View>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  keyboardAvoid: {
    flex: 1,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  securityTag: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(48, 209, 88, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.28)',
  },
  securityTagText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#30D158',
    letterSpacing: 0.8,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    alignItems: 'center',
  },
  stepCard: {
    width: '100%',
    maxWidth: 440,
    alignItems: 'center',
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  stepTitle: {
    fontSize: 24,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -0.4,
    marginBottom: 8,
  },
  stepSubtitle: {
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 20,
  },
  guaranteeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(48, 209, 88, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(48, 209, 88, 0.22)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
    width: '100%',
  },
  guaranteeText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600',
  },
  inputSection: {
    width: '100%',
    marginBottom: 16,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 52,
  },
  textInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: '500',
  },
  helperNote: {
    fontSize: 12,
    marginTop: 6,
    lineHeight: 16,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 69, 58, 0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 14,
    width: '100%',
  },
  errorBannerText: {
    color: '#FF453A',
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
    fontWeight: '500',
  },
  otpRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginVertical: 16,
    gap: 8,
  },
  otpBox: {
    flex: 1,
    height: 56,
    borderRadius: 14,
    borderWidth: 1.5,
    textAlign: 'center',
    fontSize: 24,
    fontWeight: '800',
  },
  expiryText: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 12,
  },
  otpActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 18,
    paddingHorizontal: 4,
  },
  resendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  resendText: {
    fontSize: 13,
    fontWeight: '700',
  },
  changeEmailBtn: {
    paddingVertical: 6,
  },
  changeEmailText: {
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  passkeyBenefitsBox: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 18,
    padding: 16,
    gap: 12,
    marginVertical: 14,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  benefitText: {
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
    fontWeight: '500',
  },
  passkeySuccessBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    borderRadius: 16,
    width: '100%',
    marginTop: 16,
  },
  passkeySuccessText: {
    fontSize: 15,
    fontWeight: '700',
  },
  skipPasskeyBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  skipPasskeyText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
