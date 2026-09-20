export interface ThemeColors {
  isDark: boolean;
  background: string;
  surface: string;
  surfaceSolid: string;
  surfaceSecondary: string;
  elevated: string;
  border: string;
  borderActive: string;
  text: string;
  secondary: string;
  muted: string;
  accent: string;
  accentSubtle: string;
  cardGlass: string;
  bubbleUser: string;
  bubbleUserText: string;
  bubbleAi: string;
  bubbleAiText: string;
  blurTint: 'light' | 'dark';
}

export const darkTheme: ThemeColors = {
  isDark: true,
  background: '#000000',
  surface: 'rgba(28, 28, 30, 0.65)',
  surfaceSolid: '#161618',
  surfaceSecondary: 'rgba(255, 255, 255, 0.06)',
  elevated: 'rgba(44, 44, 46, 0.85)',
  border: 'rgba(255, 255, 255, 0.12)',
  borderActive: 'rgba(255, 255, 255, 0.3)',
  text: '#FFFFFF',
  secondary: '#8E8E93',
  muted: '#636366',
  accent: '#FFFFFF',
  accentSubtle: 'rgba(255, 255, 255, 0.1)',
  cardGlass: 'rgba(255, 255, 255, 0.06)',
  bubbleUser: '#FFFFFF',
  bubbleUserText: '#000000',
  bubbleAi: 'rgba(28, 28, 30, 0.8)',
  bubbleAiText: '#FFFFFF',
  blurTint: 'dark',
};

export const lightTheme: ThemeColors = {
  isDark: false,
  background: '#F2F2F7',
  surface: 'rgba(255, 255, 255, 0.75)',
  surfaceSolid: '#FFFFFF',
  surfaceSecondary: 'rgba(0, 0, 0, 0.04)',
  elevated: 'rgba(255, 255, 255, 0.9)',
  border: 'rgba(0, 0, 0, 0.08)',
  borderActive: 'rgba(0, 0, 0, 0.22)',
  text: '#000000',
  secondary: '#6C6C70',
  muted: '#AEAEB2',
  accent: '#000000',
  accentSubtle: 'rgba(0, 0, 0, 0.06)',
  cardGlass: 'rgba(255, 255, 255, 0.7)',
  bubbleUser: '#000000',
  bubbleUserText: '#FFFFFF',
  bubbleAi: 'rgba(255, 255, 255, 0.9)',
  bubbleAiText: '#000000',
  blurTint: 'light',
};

// Default export for backward compatibility
export const colors = darkTheme;
