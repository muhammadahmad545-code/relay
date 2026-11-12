import { Button, Text, useTheme } from '@basalt/core';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Camera } from 'lucide-react-native';
import React, { useCallback, useRef, useState } from 'react';
import { Linking, View } from 'react-native';

export interface QrScannerProps {
  /** Return an error message to reject the code and keep scanning, or nothing to accept it. */
  onScan: (data: string) => string | void;
  hint: string;
}

export function QrScanner({ onScan, hint }: QrScannerProps) {
  const { colors, spacing, radius } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [problem, setProblem] = useState<string | null>(null);
  const accepted = useRef(false);
  const lastRejected = useRef<{ data: string; at: number } | null>(null);

  const handle = useCallback(
    ({ data }: { data: string }) => {
      if (accepted.current) return;
      // The camera reports the same code many times a second: do not re-run a rejection each frame.
      const last = lastRejected.current;
      if (last && last.data === data && Date.now() - last.at < 2500) return;
      const error = onScan(data);
      if (error) {
        lastRejected.current = { data, at: Date.now() };
        setProblem(error);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
        return;
      }
      accepted.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    },
    [onScan],
  );

  const frame = { aspectRatio: 1, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border } as const;

  if (!permission) return <View style={frame} />;

  if (!permission.granted) {
    return (
      <View style={[frame, { alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md }]}>
        <Camera size={32} color={colors.accent} />
        <Text variant="heading" align="center">
          Camera access needed
        </Text>
        <Text color="textMuted" align="center">
          Relay uses the camera only to read pairing codes. Nothing is recorded or stored.
        </Text>
        {permission.canAskAgain ? (
          <Button label="Allow camera" onPress={() => void requestPermission()} />
        ) : (
          <Button label="Open settings" onPress={() => void Linking.openSettings()} />
        )}
      </View>
    );
  }

  return (
    <View style={{ gap: spacing.md }}>
      <View style={frame}>
        <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={handle} />
        <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: '62%', aspectRatio: 1, borderRadius: radius.lg, borderWidth: 3, borderColor: colors.accent }} />
        </View>
      </View>
      <Text color={problem ? 'danger' : 'textMuted'} align="center" accessibilityLiveRegion="polite">
        {problem ?? hint}
      </Text>
    </View>
  );
}
