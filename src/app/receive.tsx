import { Appear, Badge, Button, Card, Header, ListItem, Pressable, Screen, SegmentedControl, Text, toMessage, useTheme, useToast } from '@basalt/core';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { useKeepAwake } from 'expo-keep-awake';
import { ClipboardPaste, Copy, FileText, Laptop, Maximize2, MonitorSmartphone, Plus, RefreshCw, Type, WifiOff, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, View, useWindowDimensions } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import RelayTransfer from '../../modules/relay-transfer';
import type { SessionInfo } from '../../modules/relay-transfer';
import { deletePickedCopies } from '../lib/cleanup';
import { TransferRow } from '../components/TransferRow';
import { QrScanner } from '../components/QrScanner';
import { buildPairingUrl, parseLinkCode } from '../lib/pairing';
import { deviceName } from '../lib/settings';
import { useRelay } from '../lib/store';

interface Shared {
  id: string;
  label: string;
  kind: 'file' | 'text';
  uri?: string;
}

type Phase = { status: 'starting' } | { status: 'error'; message: string } | { status: 'ready'; session: SessionInfo };

export default function Receive() {
  useKeepAwake();
  const { colors, spacing, radius } = useTheme();
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>({ status: 'starting' });
  const [addressIndex, setAddressIndex] = useState(0);
  const [shared, setShared] = useState<Shared[]>([]);
  const [busy, setBusy] = useState(false);
  const [linking, setLinking] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const sharedRef = React.useRef<Shared[]>([]);
  sharedRef.current = shared;
  const transfers = useRelay((s) => s.transfers);
  const texts = useRelay((s) => s.texts);
  const peers = useRelay((s) => s.peers);

  const start = useCallback(async () => {
    setPhase({ status: 'starting' });
    setShared([]);
    useRelay.getState().resetSession();
    try {
      const session = await RelayTransfer.start(deviceName.get());
      setAddressIndex(0);
      setPhase({ status: 'ready', session });
    } catch (error) {
      const message = toMessage(error, 'Could not start receiving.');
      if (message !== 'The session was closed.') setPhase({ status: 'error', message });
    }
  }, []);

  useEffect(() => {
    const ended = RelayTransfer.addListener('onSessionEnded', (event) => setPhase({ status: 'error', message: event.reason }));
    return () => ended.remove();
  }, []);

  useEffect(() => {
    void start();
    return () => {
      try {
        RelayTransfer.stop();
      } catch {
        // The session is gone either way.
      }
      deletePickedCopies(sharedRef.current.flatMap((s) => (s.uri ? [s.uri] : [])));
    };
  }, [start]);

  const session = phase.status === 'ready' ? phase.session : null;
  const address = session?.addresses[Math.min(addressIndex, Math.max(0, (session?.addresses.length ?? 1) - 1))];
  const url = session && address ? buildPairingUrl(address, session.port, session.key) : null;
  const live = useMemo(() => Object.values(transfers).sort((a, b) => b.startedAt - a.startedAt), [transfers]);

  const addFiles = async () => {
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      const added: Shared[] = [];
      for (const asset of result.assets) {
        const id = RelayTransfer.shareFile({ uri: asset.uri, name: asset.name, mime: asset.mimeType ?? '' });
        added.push({ id, label: asset.name, kind: 'file', uri: asset.uri });
      }
      setShared((list) => [...added, ...list]);
      toast(`${added.length} file${added.length === 1 ? '' : 's'} ready to download on the other device`, 'success');
    } catch (error) {
      toast(toMessage(error, 'Could not share those files.'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const addClipboard = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (!text.trim()) return toast('Your clipboard is empty.');
      const id = RelayTransfer.shareText(text);
      setShared((list) => [{ id, label: text.trim().slice(0, 80), kind: 'text' }, ...list]);
      toast('Clipboard shared', 'success');
    } catch (error) {
      toast(toMessage(error, 'Could not read the clipboard.'), 'danger');
    }
  };

  const onLinkScan = (data: string): string | void => {
    const code = parseLinkCode(data);
    if (!code) return 'That is not a laptop link code. Open the address below in the laptop’s browser first.';
    try {
      RelayTransfer.linkBrowser(code.id, code.publicKey);
    } catch (error) {
      return toMessage(error, 'Could not link that browser.');
    }
    setLinking(false);
    toast('Laptop linked. It will connect in a moment.', 'success');
  };

  const unshare = (id: string) => {
    RelayTransfer.unshare(id);
    const item = shared.find((s) => s.id === id);
    if (item?.uri) deletePickedCopies([item.uri]);
    setShared((list) => list.filter((s) => s.id !== id));
  };

  const copy = async (text: string, message: string) => {
    await Clipboard.setStringAsync(text);
    toast(message, 'success');
  };

  return (
    <Screen aurora>
      <Header title="Receive" subtitle={peers.length > 0 ? `${peers.length} device${peers.length === 1 ? '' : 's'} connected` : 'Waiting for a device'} onBack={() => router.back()} />
      {peers.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
          {peers.map((p) => (
            <Badge key={p} label={`Connected · ${p}`} tone="success" />
          ))}
        </View>
      ) : null}

      {phase.status === 'starting' ? (
        <Card style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxxl }}>
          <ActivityIndicator color={colors.accent} />
          <Text color="textMuted">Opening a secure session…</Text>
        </Card>
      ) : null}

      {phase.status === 'error' ? (
        <Card style={{ gap: spacing.md }}>
          <Text variant="heading">Could not start</Text>
          <Text color="textMuted">{phase.message}</Text>
          <Button label="Try again" icon={RefreshCw} onPress={start} />
        </Card>
      ) : null}

      {session && !url ? (
        <Card style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl }}>
          <WifiOff size={32} color={colors.warning} />
          <Text variant="heading" align="center">
            No local network
          </Text>
          <Text color="textMuted" align="center">
            Connect this phone to Wi-Fi, or turn on its hotspot and connect the other device to it. Mobile data is not used.
          </Text>
          <Button label="Check again" icon={RefreshCw} onPress={start} />
        </Card>
      ) : null}

      {session && url && address ? (
        <>
          <Appear index={0}>
          <Card variant="glow" style={{ alignItems: 'center', gap: spacing.lg }}>
            <Pressable accessibilityRole="imagebutton" accessibilityLabel="Pairing QR code. Tap to show it full screen." onPress={() => setFullscreen(true)} style={{ padding: spacing.lg, backgroundColor: '#FFFFFF', borderRadius: radius.lg }}>
              <QRCode value={url} size={212} backgroundColor="#FFFFFF" color="#0B0D10" ecl="M" />
              <View style={{ position: 'absolute', right: 8, bottom: 8 }}>
                <Maximize2 size={16} color="#0B0D10" />
              </View>
            </Pressable>
            <View style={{ gap: 4, alignItems: 'center' }}>
              <Text variant="bodyStrong" align="center">
                Scan with Relay or any phone camera
              </Text>
              <Text variant="caption" color="textMuted" align="center">
                For a laptop: type the address below into its browser, then tap Link a laptop.
              </Text>
            </View>
            {session.addresses.length > 1 ? (
              <View style={{ alignSelf: 'stretch' }}>
                <SegmentedControl
                  options={session.addresses.slice(0, 3).map((a, i) => ({ value: String(i), label: a }))}
                  value={String(addressIndex)}
                  onChange={(v) => setAddressIndex(Number(v))}
                />
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy full link"
              onPress={() => copy(url, 'Link copied. Anyone with it can use this session.')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceRaised, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, alignSelf: 'stretch' }}
            >
              <Laptop size={16} color={colors.textMuted} />
              <Text variant="mono" color="textMuted" numberOfLines={1} style={{ flex: 1 }}>
                {address}:{session.port}
              </Text>
              <Copy size={16} color={colors.accent} />
            </Pressable>
          </Card>
          </Appear>
          <Modal visible={fullscreen} animationType="fade" onRequestClose={() => setFullscreen(false)} statusBarTranslucent>
            <Pressable accessibilityRole="button" accessibilityLabel="Close full-screen code" onPress={() => setFullscreen(false)} pressScale={1} style={{ flex: 1, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', gap: spacing.xl }}>
              <QRCode value={url} size={Math.min(width - 48, 420)} backgroundColor="#FFFFFF" color="#000000" ecl="M" />
              <Text variant="label" style={{ color: '#55606E' }}>
                Tap anywhere to close
              </Text>
            </Pressable>
          </Modal>

          {linking ? (
            <Card style={{ gap: spacing.md }}>
              <QrScanner onScan={onLinkScan} hint={`Open ${address}:${session.port} in the laptop’s browser and point the phone at the code it shows.`} />
              <Button label="Cancel" variant="secondary" onPress={() => setLinking(false)} />
            </Card>
          ) : (
            <Button label="Link a laptop" icon={MonitorSmartphone} variant="secondary" size="lg" onPress={() => setLinking(true)} />
          )}

          <Card style={{ gap: spacing.sm }}>
            <Text variant="overline" color="textMuted">
              Share to this session
            </Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Button label="Add files" icon={Plus} variant="secondary" loading={busy} onPress={addFiles} style={{ flex: 1 }} />
              <Button label="Clipboard" icon={ClipboardPaste} variant="secondary" onPress={addClipboard} style={{ flex: 1 }} />
            </View>
            {shared.map((item) => (
              <ListItem
                key={item.id}
                title={item.label}
                subtitle={item.kind === 'file' ? 'Available to download' : 'Text'}
                icon={item.kind === 'file' ? FileText : Type}
                trailing={
                  <Pressable accessibilityRole="button" accessibilityLabel={`Stop sharing ${item.label}`} hitSlop={12} onPress={() => unshare(item.id)}>
                    <X size={18} color={colors.textFaint} />
                  </Pressable>
                }
              />
            ))}
          </Card>
        </>
      ) : null}

      {texts.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="overline" color="textMuted">
            Received text
          </Text>
          {texts.map((item) => (
            <Card key={item.id} onPress={() => copy(item.text, 'Copied')} accessibilityLabel="Received text. Tap to copy." style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' }}>
              <Text selectable numberOfLines={8} style={{ flex: 1 }}>
                {item.text}
              </Text>
              <Copy size={16} color={colors.accent} />
            </Card>
          ))}
        </View>
      ) : null}

      {live.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="overline" color="textMuted">
            Transfers
          </Text>
          {live.map((transfer) => (
            <TransferRow key={transfer.id} transfer={transfer} />
          ))}
          <Text variant="caption" color="textFaint">
            Received files are saved to Downloads/Relay.
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}
