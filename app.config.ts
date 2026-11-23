import type { ConfigContext, ExpoConfig } from 'expo/config';
import pkg from './package.json';

/** 1.4.2 -> 10402. Android only installs an update whose versionCode is higher than the installed one. */
function versionCode(version: string): number {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map((part) => parseInt(part, 10) || 0);
  return major * 10000 + minor * 100 + patch;
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Relay',
  slug: 'relay',
  scheme: 'relay',
  version: pkg.version,
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  android: {
    package: 'dev.basalt.relay',
    versionCode: versionCode(pkg.version),
    adaptiveIcon: {
      backgroundColor: '#0C0D10',
      backgroundImage: './assets/android-icon-background.png',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    permissions: ['android.permission.REQUEST_INSTALL_PACKAGES'],
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    allowBackup: false,
    predictiveBackGestureEnabled: false,
    // Appear in Android's share sheet so files and text can be sent from any app.
    intentFilters: [
      // Expo prefixes these with android.intent.action. / android.intent.category. itself.
      { action: 'SEND', category: ['DEFAULT'], data: [{ mimeType: '*/*' }] },
      { action: 'SEND_MULTIPLE', category: ['DEFAULT'], data: [{ mimeType: '*/*' }] },
    ],
  },
  plugins: [
    'expo-router',
    'expo-sqlite',
    ['expo-local-authentication', { faceIDPermission: false }],
    'expo-font',
    ['expo-splash-screen', { backgroundColor: '#0C0D10', image: './assets/splash-icon.png', imageWidth: 220 }],
    ['expo-camera', { cameraPermission: 'Relay uses the camera only to scan pairing codes.', recordAudioAndroid: false }],
    // Transfers run over plain HTTP on the local network; the payloads themselves are AES-256-GCM encrypted.
    ['expo-build-properties', { android: { usesCleartextTraffic: true, useLegacyPackaging: true } }],
    './plugins/withReleaseSigning',
    './plugins/withAbiSplits',
  ],
  experiments: { typedRoutes: true },
});
