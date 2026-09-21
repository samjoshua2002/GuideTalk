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
    const host = hostUri.split(':')[0];
    // Only use host if it is a real local IPv4 address (e.g. 192.168.x.x)
    // Tunnel hostnames (e.g. exp.direct, ngrok, u.expo.dev) do not forward port 3000
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) && host !== '127.0.0.1') {
      return `http://${host}:3000`;
    }
  }

  const configured = process.env.EXPO_PUBLIC_API_URL;
  if (configured && !configured.includes('localhost') && !configured.includes('127.0.0.1')) {
    return configured;
  }

  return 'http://192.168.0.232:3000';
}

export const env = {
  apiUrl: resolveApiUrl(),
  azureEndpoint: process.env.EXPO_PUBLIC_AZURE_OPENAI_ENDPOINT || '',
  azureApiKey: process.env.EXPO_PUBLIC_AZURE_OPENAI_API_KEY || '',
  azureApiVersion: process.env.EXPO_PUBLIC_AZURE_OPENAI_API_VERSION || '2025-01-01-preview',
  azureDefaultDeployment: process.env.EXPO_PUBLIC_AZURE_OPENAI_DEPLOYMENT || '',
  appEnvironment: process.env.EXPO_PUBLIC_APP_ENV || 'development',
} as const;
