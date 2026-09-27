import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

/**
 * JS-level release version and build code.
 * This is updated on every OTA publish so the app immediately reflects the new version
 * without requiring a full native binary rebuild when only JavaScript/React Native code changes.
 */
export const JS_APP_VERSION = '1.0.8';
export const JS_APP_VERSION_CODE = 9;

export function getEffectiveAppVersion(): string {
  // If running under Expo Updates and an update is active, we report the JS release version
  return JS_APP_VERSION || Constants.expoConfig?.version || '1.0.5';
}

export function getEffectiveVersionCode(): number {
  return JS_APP_VERSION_CODE || (Constants.expoConfig?.android?.versionCode as number) || 6;
}

export function isRunningOtaUpdate(): boolean {
  return !!Updates.updateId;
}
