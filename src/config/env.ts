import Constants from 'expo-constants';
import { Platform } from 'react-native';

function resolveApiUrl(): string {
  if (Platform.OS === 'web') {
    return 'http://localhost:3000';
  }

  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost ||
    (Constants as any).manifest?.debuggerHost;

  if (hostUri) {
    const ip = hostUri.split(':')[0];
    if (ip && ip !== 'localhost' && ip !== '127.0.0.1') {
      return `http://${ip}:3000`;
    }
  }

  return process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';
}

export const env = {
  apiUrl: resolveApiUrl(),
  azureEndpoint: process.env.EXPO_PUBLIC_AZURE_OPENAI_ENDPOINT || '',
  azureApiKey: process.env.EXPO_PUBLIC_AZURE_OPENAI_API_KEY || '',
  azureApiVersion: process.env.EXPO_PUBLIC_AZURE_OPENAI_API_VERSION || '2025-01-01-preview',
  azureDefaultDeployment: process.env.EXPO_PUBLIC_AZURE_OPENAI_DEPLOYMENT || '',
  appEnvironment: process.env.EXPO_PUBLIC_APP_ENV || 'development',
} as const;
