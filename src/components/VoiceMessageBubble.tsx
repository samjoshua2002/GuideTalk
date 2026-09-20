import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Speech from 'expo-speech';
import { createAudioPlayer } from 'expo-audio';
import { useTheme } from '@/src/context/ThemeContext';
import { triggerHaptic } from '@/src/lib/haptics';

interface VoiceMessageBubbleProps {
  content: string;
  isUser: boolean;
  audioUri?: string | null;
}

// Preset natural voice note wave heights
const BARS = [
  6, 11, 18, 14, 8, 20, 24, 16, 10, 23, 19, 13, 21, 16, 11, 20, 14, 8,
];

export function VoiceMessageBubble({ content, isUser, audioUri }: VoiceMessageBubbleProps) {
  const { theme, isDark } = useTheme();

  // Extract duration from content string, e.g. "🎤 Voice message (0:05)" -> 5 seconds
  const parseDuration = (str: string): number => {
    const match = str.match(/\((\d+):(\d+)\)/);
    if (match) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      return Math.max(1, mins * 60 + secs);
    }
    return 5; // default 5 seconds
  };

  const totalDuration = parseDuration(content);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const playerRef = useRef<any>(null);

  // Play audio frequency chime / tone via Web Audio API on web
  const playWebTone = () => {
    if (typeof window !== 'undefined') {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(340, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(580, ctx.currentTime + 0.25);
          gain.gain.setValueAtTime(0.35, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.55);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.55);
        }
      } catch (e) {}
    }
  };

  const stopAudioPlayback = () => {
    setIsPlaying(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (playerRef.current) {
      try {
        playerRef.current.pause();
      } catch (e) {}
    }
    try {
      Speech.stop();
    } catch (e) {}
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {}
    }
  };

  const startAudioPlayback = () => {
    setIsPlaying(true);
    setPlaybackTime(0);

    // 1. Play actual audio recording file if available
    if (audioUri) {
      try {
        const player = createAudioPlayer(audioUri);
        playerRef.current = player;
        player.play();
      } catch (err) {
        console.log('Audio file playback fallback to speech:', err);
      }
    }

    // 2. Audible voice speech playback through device speaker
    const cleanText = content.replace(/🎤\s*Voice message\s*(\(\d+:\d+\))?/, '').trim();
    const textToSpeak = cleanText || (isUser ? 'Voice message recording' : 'Voice note from companion');

    playWebTone();

    try {
      Speech.speak(textToSpeak, {
        rate: 1.0,
        pitch: isUser ? 1.0 : 1.1,
        onDone: () => {
          stopAudioPlayback();
          setPlaybackTime(0);
        },
        onStopped: () => {
          stopAudioPlayback();
        },
        onError: () => {
          // If error occurs, timer handles visual playback
        },
      });
    } catch (e) {
      console.log('Speech speak error:', e);
    }

    // Web SpeechSynthesis for browsers
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(textToSpeak);
        utter.onend = () => {
          stopAudioPlayback();
          setPlaybackTime(0);
        };
        window.speechSynthesis.speak(utter);
      } catch (e) {}
    }

    // 3. Increment UI timer while playing
    timerRef.current = setInterval(() => {
      setPlaybackTime((prev) => {
        if (prev + 1 >= totalDuration) {
          stopAudioPlayback();
          return 0;
        }
        return prev + 1;
      });
    }, 1000);
  };

  const togglePlay = () => {
    triggerHaptic('light');
    if (isPlaying) {
      stopAudioPlayback();
    } else {
      startAudioPlayback();
    }
  };

  useEffect(() => {
    return () => {
      stopAudioPlayback();
    };
  }, []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const progressFraction = totalDuration > 0 ? playbackTime / totalDuration : 0;
  const activeBarCount = Math.round(progressFraction * BARS.length);

  // In dark theme, user bubble is #FFFFFF (white), so foreground must be dark/black.
  // In light theme, user bubble is #000000 (black), so foreground is white.
  // For AI companion bubbles, it uses theme.text and vibrant audio green #30D158.
  const userForegroundColor = isDark ? '#000000' : '#FFFFFF';
  const userIdleBarColor = isDark ? 'rgba(0, 0, 0, 0.68)' : 'rgba(255, 255, 255, 0.85)';
  const userPlayedBarColor = isDark ? '#000000' : '#FFFFFF';
  const userUnplayedBarColor = isDark ? 'rgba(0, 0, 0, 0.26)' : 'rgba(255, 255, 255, 0.38)';
  const userBtnBg = isDark ? 'rgba(0, 0, 0, 0.09)' : 'rgba(255, 255, 255, 0.22)';
  const userDurationColor = isDark ? 'rgba(0, 0, 0, 0.75)' : 'rgba(255, 255, 255, 0.85)';

  const aiIdleBarColor = isDark ? 'rgba(255, 255, 255, 0.65)' : 'rgba(0, 0, 0, 0.55)';
  const aiPlayedBarColor = '#30D158';
  const aiUnplayedBarColor = isDark ? 'rgba(255, 255, 255, 0.28)' : 'rgba(0, 0, 0, 0.22)';

  const playBtnBg = isUser ? userBtnBg : theme.surfaceSecondary;
  const playBtnColor = isUser ? userForegroundColor : theme.text;
  const durationColor = isUser ? userDurationColor : theme.secondary;

  return (
    <View style={styles.container}>
      {/* Play / Pause button */}
      <Pressable
        hitSlop={8}
        accessibilityLabel={isPlaying ? 'Pause voice message' : 'Play voice message'}
        onPress={togglePlay}
        style={[
          styles.playBtn,
          {
            backgroundColor: playBtnBg,
          },
        ]}
      >
        <Ionicons
          name={isPlaying ? 'pause' : 'play'}
          size={16}
          color={playBtnColor}
          style={{ marginLeft: isPlaying ? 0 : 2 }}
        />
      </Pressable>

      {/* Waveform with active playback progress */}
      <View style={styles.waveContainer}>
        {BARS.map((height, i) => {
          let barColor: string;
          if (isPlaying) {
            if (i <= activeBarCount) {
              barColor = isUser ? userPlayedBarColor : aiPlayedBarColor;
            } else {
              barColor = isUser ? userUnplayedBarColor : aiUnplayedBarColor;
            }
          } else {
            barColor = isUser ? userIdleBarColor : aiIdleBarColor;
          }

          // While playing, add dynamic wave pulsation
          const dynamicHeight = isPlaying
            ? Math.max(height, Math.round(8 + Math.sin((playbackTime * 4) + i) * 10))
            : height;

          return (
            <View
              key={i}
              style={[
                styles.bar,
                {
                  height: dynamicHeight,
                  backgroundColor: barColor,
                },
              ]}
            />
          );
        })}
      </View>

      {/* Duration / Progress counter */}
      <Text
        style={[
          styles.durationText,
          { color: durationColor },
        ]}
      >
        {isPlaying ? formatTime(playbackTime) : formatTime(totalDuration)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
    minWidth: 195,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waveContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 28,
    gap: 3,
  },
  bar: {
    width: 3,
    borderRadius: 2,
  },
  durationText: {
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    minWidth: 32,
    textAlign: 'right',
  },
});
