import { ErrorBoundary, Onboarding, ThemeProvider, ToastProvider, useBasaltFonts, useTheme } from '@basalt/core';
import { Stack } from 'expo-router/stack';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import Laptop from 'lucide-react-native/icons/laptop';
import ShieldCheck from 'lucide-react-native/icons/shield-check';
import Wifi from 'lucide-react-native/icons/wifi';
import Zap from 'lucide-react-native/icons/zap';
import React, { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ACCENT, onboardedSetting } from '../lib/settings';
import { subscribeToRelayEvents, useRelay } from '../lib/store';

SplashScreen.preventAutoHideAsync().catch(() => {});

const PAGES = [
  { icon: Zap, title: 'Send anything, instantly', body: 'Photos, videos, documents and text between phones, at local Wi-Fi speed. No internet, no account, no size limit.' },
  { icon: Laptop, title: 'Laptops too, nothing to install', body: 'Open the address Relay shows in any browser, scan the code on its screen, and drag files across.' },
  { icon: Wifi, title: 'No router? Use a hotspot', body: 'Turn on one phone’s hotspot and connect the other device to it. Mobile data is never used.' },
  { icon: ShieldCheck, title: 'Encrypted end to end', body: 'Every file is encrypted with a one-time key that lives only in the QR code. Transfers resume if the connection drops.' },
];

function Navigator() {
  const { colors, scheme } = useTheme();
  const [onboarded, setOnboarded] = onboardedSetting.use();
  if (!onboarded) return <Onboarding appName="Relay" pages={PAGES} onDone={() => setOnboarded(true)} />;
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'slide_from_right' }} />
    </>
  );
}

export default function RootLayout() {
  const fontsReady = useBasaltFonts();

  useEffect(() => {
    subscribeToRelayEvents();
    void useRelay.getState().loadHistory();
  }, []);

  useEffect(() => {
    if (fontsReady) SplashScreen.hideAsync().catch(() => {});
  }, [fontsReady]);

  if (!fontsReady) return null;

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider accent={ACCENT}>
            <ToastProvider>
              <Navigator />
            </ToastProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
