import { LockGate, useLock } from '@basalt/core/src/lock/LockGate';
import { ErrorBoundary, Onboarding, ThemeProvider, ToastProvider, useBasaltFonts, useTheme } from '@basalt/core';
import { router } from 'expo-router';
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
import { ACCENT, lockSetting, onboardedSetting } from '../lib/settings';
import RelayTransfer from '../../modules/relay-transfer';
import { collectShare } from '../lib/share';
import { subscribeToRelayEvents, useRelay } from '../lib/store';

SplashScreen.preventAutoHideAsync().catch(() => {});

const PAGES = [
  { icon: Zap, title: 'Send anything, instantly', body: 'Photos, videos, documents and text between phones, at local Wi-Fi speed. No internet, no account, no size limit.' },
  { icon: Laptop, title: 'Laptops too, nothing to install', body: 'Open the address Relay shows in any browser, scan the code on its screen, and drag files across.' },
  { icon: Wifi, title: 'No router? Use a hotspot', body: 'Turn on one phone’s hotspot and connect the other device to it. Mobile data is never used.' },
  { icon: ShieldCheck, title: 'Encrypted end to end', body: 'Every file is encrypted with a one-time key that lives only in the QR code. Transfers resume if the connection drops.' },
];

function Navigator() {
  const { colors, scheme, reduceMotion } = useTheme();
  const [onboarded, setOnboarded] = onboardedSetting.use();
  const [locked] = lockSetting.use();
  const lock = useLock();

  // With the lock on, keep Relay out of screenshots and the recent-apps preview.
  useEffect(() => {
    try {
      RelayTransfer.setSecure(locked);
    } catch {
      // Older native build.
    }
  }, [locked]);

  // Shared from another app (Android share sheet): open Send with the items already added.
  useEffect(() => {
    if (!onboarded) return;
    const open = () => {
      if (collectShare()) lock.whenUnlocked(() => setTimeout(() => router.push({ pathname: '/send', params: { shared: String(Date.now()) } }), 0));
    };
    open();
    let sub: { remove: () => void } | null = null;
    try {
      sub = RelayTransfer.addListener('onShare', open);
    } catch {
      sub = null;
    }
    return () => sub?.remove();
  }, [onboarded]);
  if (!onboarded) return <Onboarding appName="Relay" pages={PAGES} onDone={() => setOnboarded(true)} />;
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: reduceMotion ? 'fade' : 'slide_from_right' }} />
    </>
  );
}

export default function RootLayout() {
  const fontsReady = useBasaltFonts();

  useEffect(() => {
    subscribeToRelayEvents();
    try {
      RelayTransfer.installShortcuts();
    } catch {
      // Launcher shortcuts are a nice-to-have.
    }
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
              <LockGate setting={lockSetting} appName="Relay" message="Unlock to see your transfers and received files.">
                <Navigator />
              </LockGate>
            </ToastProvider>
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
