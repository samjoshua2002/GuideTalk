import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AudioModule, requestRecordingPermissionsAsync, RecordingPresets } from 'expo-audio';
import { useTheme } from '@/src/context/ThemeContext';
import { triggerHaptic } from '@/src/lib/haptics';

interface VoiceWaveformBarProps {
  duration: number;
  isPaused: boolean;
  transcript?: string;
  onTogglePause: () => void;
  onCancel: () => void;
  onSend: (recordedUri?: string | null) => void;
}

const BAR_COUNT = 24;

export function VoiceWaveformBar({
  duration,
  isPaused,
  onTogglePause,
  onCancel,
  onSend,
}: VoiceWaveformBarProps) {
  const { theme, isDark } = useTheme();

  // Array of heights for the 24 wave bars (default 3px flat when silent)
  const [barHeights, setBarHeights] = useState<number[]>(() => Array(BAR_COUNT).fill(3));

  // Web audio analyser refs
  const audioCtxRef = useRef<any>(null);
  const analyserRef = useRef<any>(null);
  const mediaStreamRef = useRef<any>(null);
  const animFrameRef = useRef<number | null>(null);

  // Native audio recorder refs (iOS & Android)
  const nativeRecorderRef = useRef<any>(null);
  const nativePollingRef = useRef<NodeJS.Timeout | null>(null);

  // Handle Pause/Resume for native recorder
  useEffect(() => {
    if (nativeRecorderRef.current) {
      if (isPaused) {
        try {
          nativeRecorderRef.current.pause();
        } catch {}
      } else {
        try {
          nativeRecorderRef.current.record();
        } catch {}
      }
    }
  }, [isPaused]);

  // Initialize microphone audio analyser (Web Audio on web, native AudioRecorder on iOS/Android)
  useEffect(() => {
    let isMounted = true;

    // 1. Native iOS & Android: Use expo-audio with isMeteringEnabled
    async function initNativeAudio() {
      try {
        const { granted } = await requestRecordingPermissionsAsync();
        if (!granted || !isMounted) return;

        const recorder = new AudioModule.AudioRecorder({
          ...RecordingPresets.HIGH_QUALITY,
          isMeteringEnabled: true,
        });

        await recorder.prepareToRecordAsync();
        if (!isMounted) return;

        recorder.record();
        nativeRecorderRef.current = recorder;

        // Poll metering every 50ms for smooth real-time response
        nativePollingRef.current = setInterval(() => {
          if (!isMounted) return;
          if (isPaused) {
            setBarHeights(Array(BAR_COUNT).fill(4));
            return;
          }

          try {
            const status = recorder.getStatus();
            const rawMetering = status.metering ?? -160;

            // Normalize dBFS: ambient silence is around -55dB or lower, normal speech is -45dB to -5dB
            const volume = Math.max(0, Math.min(1, (rawMetering + 55) / 48));

            if (volume <= 0.05) {
              // Ambient silence: keep subtle natural breathing wave so user clearly sees it's alive
              const now = Date.now() / 250;
              const subtleHeights = Array.from({ length: BAR_COUNT }, (_, i) => {
                const sine = Math.sin(now + i * 0.45);
                return Math.round(4 + Math.max(0, sine * 3));
              });
              setBarHeights(subtleHeights);
            } else {
              // Sound heard: scale bars dynamically based on volume with natural equalizer curve
              const heights = Array.from({ length: BAR_COUNT }, (_, i) => {
                const centerFactor = 1 - Math.abs((i - BAR_COUNT / 2) / (BAR_COUNT / 2)) * 0.4;
                const variation = 0.8 + ((i * 7) % 5) * 0.1;
                const h = Math.round(4 + volume * 25 * centerFactor * variation);
                return Math.min(h, 28);
              });
              setBarHeights(heights);
            }
          } catch (e) {
            const now = Date.now() / 250;
            setBarHeights(Array.from({ length: BAR_COUNT }, (_, i) => Math.round(4 + Math.max(0, Math.sin(now + i * 0.45) * 3))));
          }
        }, 50);
      } catch (err) {
        console.log('Native microphone setup error:', err);
      }
    }

    // 2. Web browser: Use Web Audio API with AnalyserNode for multi-band frequencies
    async function initWebAudio() {
      try {
        if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: false,
              autoGainControl: true,
            },
          });

          if (!isMounted) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          mediaStreamRef.current = stream;

          const AudioCtxClass =
            (window as any).AudioContext || (window as any).webkitAudioContext;
          if (AudioCtxClass) {
            const ctx = new AudioCtxClass();
            audioCtxRef.current = ctx;

            if (ctx.state === 'suspended') {
              await ctx.resume();
            }

            const analyser = ctx.createAnalyser();
            analyser.fftSize = 64; // 32 frequency bins
            analyser.smoothingTimeConstant = 0.35;
            analyserRef.current = analyser;

            const source = ctx.createMediaStreamSource(stream);
            source.connect(analyser);

            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);

            const renderFrame = () => {
              if (!isMounted) return;

              if (isPaused) {
                setBarHeights(Array(BAR_COUNT).fill(3));
                animFrameRef.current = requestAnimationFrame(renderFrame);
                return;
              }

              analyser.getByteFrequencyData(dataArray);

              let sum = 0;
              for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
              }
              const averageVolume = sum / bufferLength;

              if (averageVolume < 4) {
                // Ambient silence: subtle breathing wave
                const now = Date.now() / 250;
                setBarHeights(Array.from({ length: BAR_COUNT }, (_, i) => Math.round(4 + Math.max(0, Math.sin(now + i * 0.45) * 3))));
              } else {
                // Sound heard
                const newHeights = [];
                for (let i = 0; i < BAR_COUNT; i++) {
                  const binIdx = Math.min(bufferLength - 1, Math.floor((i / BAR_COUNT) * 22));
                  const val = dataArray[binIdx] || 0;

                  if (val < 6) {
                    newHeights.push(3);
                  } else {
                    const height = Math.round(3 + (val / 255) * 25);
                    newHeights.push(Math.min(height, 28));
                  }
                }
                setBarHeights(newHeights);
              }

              animFrameRef.current = requestAnimationFrame(renderFrame);
            };

            animFrameRef.current = requestAnimationFrame(renderFrame);
          }
        }
      } catch (err) {
        console.log('Web mic analyser initialization:', err);
      }
    }

    if (Platform.OS === 'web') {
      initWebAudio();
    } else {
      initNativeAudio();
    }

    return () => {
      isMounted = false;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t: any) => t.stop());
        mediaStreamRef.current = null;
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      if (nativePollingRef.current) {
        clearInterval(nativePollingRef.current);
        nativePollingRef.current = null;
      }
      if (nativeRecorderRef.current) {
        try {
          nativeRecorderRef.current.stop();
        } catch {}
        nativeRecorderRef.current = null;
      }
    };
  }, []);

  // Format seconds to mm:ss
  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.surfaceSolid, borderColor: theme.border }]}>
      {/* 1. Left: Delete / Trash icon */}
      <Pressable
        hitSlop={10}
        accessibilityLabel="Cancel recording"
        onPress={() => {
          triggerHaptic('warning');
          onCancel();
        }}
        style={styles.trashBtn}
      >
        <Ionicons name="trash-outline" size={20} color="#FF3B30" />
      </Pressable>

      {/* 2. Middle: Full Wave (reacts only to real audio sound heard) */}
      <View style={styles.fullWaveContainer}>
        {barHeights.map((height, i) => {
          const isSounding = height > 5 && !isPaused;
          const inactiveColor = isDark ? 'rgba(255, 255, 255, 0.40)' : 'rgba(0, 0, 0, 0.25)';
          return (
            <View
              key={i}
              style={[
                styles.waveBar,
                {
                  height: Math.max(height, 4),
                  backgroundColor: isPaused
                    ? (isDark ? 'rgba(255, 255, 255, 0.22)' : theme.muted)
                    : isSounding
                    ? '#30D158'
                    : inactiveColor,
                  opacity: isPaused ? 0.4 : isSounding ? 1 : 0.9,
                },
              ]}
            />
          );
        })}
      </View>

      {/* 3. Right: Timer, Pause, Send */}
      <View style={styles.rightControls}>
        <Text style={[styles.timerText, { color: isPaused ? '#FF9500' : theme.text }]}>
          {formatDuration(duration)}
        </Text>

        <Pressable
          hitSlop={8}
          accessibilityLabel={isPaused ? 'Resume recording' : 'Pause recording'}
          onPress={() => {
            triggerHaptic('light');
            onTogglePause();
          }}
          style={[styles.controlBtn, { backgroundColor: theme.surfaceSecondary }]}
        >
          <Ionicons
            name={isPaused ? 'mic' : 'pause'}
            size={18}
            color={isPaused ? '#34C759' : theme.text}
          />
        </Pressable>

        <Pressable
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Send voice message"
          onPress={async () => {
            triggerHaptic('success');
            let recordedUri: string | null = null;
            if (nativeRecorderRef.current) {
              try {
                await nativeRecorderRef.current.stop();
                recordedUri = nativeRecorderRef.current.uri;
                nativeRecorderRef.current = null;
              } catch (e) {
                console.log('Stop recorder error:', e);
              }
            }
            onSend(recordedUri);
          }}
          style={[styles.sendBtn, { backgroundColor: theme.text }]}
        >
          <Ionicons name="arrow-up" size={19} color={theme.background} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 24,
    borderWidth: 1,
    gap: 8,
  },
  trashBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 59, 48, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWaveContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    height: 36,
    overflow: 'hidden',
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
  },
  rightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timerText: {
    fontSize: 13,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    minWidth: 40,
    textAlign: 'center',
  },
  controlBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
