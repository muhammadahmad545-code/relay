import { Appear, Button, Card, EmptyState, Header, ListItem, Pressable, Ring, Screen, Text, formatBytes, toMessage, useTheme, useToast } from '@basalt/core';
import { deletePickedCopies } from '../lib/cleanup';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import ClipboardPaste from 'lucide-react-native/icons/clipboard-paste';
import FileText from 'lucide-react-native/icons/file-text';
import Files from 'lucide-react-native/icons/files';
import Plus from 'lucide-react-native/icons/plus';
import ScanLine from 'lucide-react-native/icons/scan-line';
import Smartphone from 'lucide-react-native/icons/smartphone';
import X from 'lucide-react-native/icons/x';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import RelayTransfer from '../../modules/relay-transfer';
import { QrScanner } from '../components/QrScanner';
import { TransferRow } from '../components/TransferRow';
import { parsePairing } from '../lib/pairing';
import type { Pairing } from '../lib/pairing';
import { useRelay } from '../lib/store';

interface Picked {
  uri: string;
  name: string;
  mime: string;
  size: number;
}

type Step =
  | { name: 'pick' }
  | { name: 'scan' }
  | { name: 'connecting'; pairing: Pairing }
  | { name: 'sending'; peer: string }
  | { name: 'done'; peer: string; sent: number; failed: number }
  | { name: 'error'; message: string };

export default function Send() {
  useKeepAwake();
  const { colors, spacing } = useTheme();
  const toast = useToast();
  const router = useRouter();
  const [files, setFiles] = useState<Picked[]>([]);
  const [text, setText] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [step, setStep] = useState<Step>({ name: 'pick' });
  const transfers = useRelay((s) => s.transfers);
  const mounted = useRef(true);
  const filesRef = useRef<Picked[]>([]);
  filesRef.current = files;

  useEffect(() => {
    useRelay.getState().resetSession();
    return () => {
      mounted.current = false;
      try {
        RelayTransfer.cancelSend();
      } catch {
        // Nothing in flight.
      }
      deletePickedCopies(filesRef.current.map((f) => f.uri));
    };
  }, []);

  const outgoing = useMemo(
    () => Object.values(transfers).filter((t) => t.direction === 'out').sort((a, b) => a.startedAt - b.startedAt),
    [transfers],
  );
  const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
  const hasPayload = files.length > 0 || text != null;

  const pick = async () => {
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      if (result.canceled) return;
      const picked = result.assets.map((a) => ({ uri: a.uri, name: a.name, mime: a.mimeType ?? '', size: a.size ?? 0 }));
      setFiles((current) => [...current, ...picked]);
    } catch (error) {
      toast(toMessage(error, 'Could not open those files.'), 'danger');
    } finally {
      setPicking(false);
    }
  };

  const useClipboard = async () => {
    try {
      const value = await Clipboard.getStringAsync();
      if (!value.trim()) return toast('Your clipboard is empty.');
      setText(value);
    } catch (error) {
      toast(toMessage(error, 'Could not read the clipboard.'), 'danger');
    }
  };

  const run = async (pairing: Pairing) => {
    setStep({ name: 'connecting', pairing });
    try {
      const peer = await RelayTransfer.connect(pairing.baseUrl, pairing.key);
      if (!mounted.current) return;
      setStep({ name: 'sending', peer });
      let sent = 0;
      let failed = 0;
      if (text != null) {
        try {
          await RelayTransfer.sendText(pairing.baseUrl, pairing.key, text);
          sent++;
        } catch {
          failed++;
        }
      }
      if (files.length > 0) {
        const result = await RelayTransfer.sendFiles(pairing.baseUrl, pairing.key, files.map(({ uri, name, mime }) => ({ uri, name, mime })));
        sent += result.sent;
        failed += result.failed;
      }
      if (mounted.current) setStep({ name: 'done', peer, sent, failed });
    } catch (error) {
      const message = toMessage(error, 'Could not reach the other device.');
      if (mounted.current) setStep(message === 'Cancelled.' ? { name: 'pick' } : { name: 'error', message });
    }
  };

  const onScan = (data: string): string | void => {
    const pairing = parsePairing(data);
    if (!pairing) return 'That is not a Relay code. On the other phone, open Relay and tap Receive.';
    void run(pairing);
  };

  const reset = () => {
    deletePickedCopies(files.map((f) => f.uri));
    setFiles([]);
    setText(null);
    useRelay.getState().resetSession();
    setStep({ name: 'pick' });
  };

  return (
    <Screen
      aurora
      footer={
        step.name === 'pick' ? (
          <Button label={hasPayload ? 'Scan receiver’s code' : 'Choose something to send'} icon={ScanLine} size="lg" disabled={!hasPayload} onPress={() => setStep({ name: 'scan' })} />
        ) : step.name === 'sending' ? (
          <Button label="Cancel" variant="danger" size="lg" onPress={() => RelayTransfer.cancelSend()} />
        ) : step.name === 'done' ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button label="Send more" variant="secondary" size="lg" onPress={reset} style={{ flex: 1 }} />
            <Button label="Done" size="lg" onPress={() => router.back()} style={{ flex: 1 }} />
          </View>
        ) : step.name === 'error' ? (
          <Button label="Scan again" icon={ScanLine} size="lg" onPress={() => setStep({ name: 'scan' })} />
        ) : step.name === 'connecting' ? (
          <Button label="Cancel" variant="secondary" size="lg" onPress={() => RelayTransfer.cancelSend()} />
        ) : step.name === 'scan' ? (
          <Button label="Back to selection" variant="secondary" size="lg" onPress={() => setStep({ name: 'pick' })} />
        ) : undefined
      }
    >
      <Header title="Send" subtitle={hasPayload ? `${files.length} file${files.length === 1 ? '' : 's'}${text != null ? ' + text' : ''} · ${formatBytes(totalBytes)}` : 'Phone to phone'} onBack={() => router.back()} />

      {step.name === 'pick' ? (
        <>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <Button label="Add files" icon={Plus} variant="secondary" loading={picking} onPress={pick} style={{ flex: 1 }} />
            <Button label={text != null ? 'Text added' : 'Clipboard'} icon={ClipboardPaste} variant="secondary" onPress={useClipboard} style={{ flex: 1 }} />
          </View>
          {!hasPayload ? (
            <EmptyState icon={Files} title="Nothing selected" message="Add files of any type and size, or send the text on your clipboard." />
          ) : (
            <Card style={{ paddingVertical: spacing.xs }}>
              {text != null ? (
                <ListItem
                  title={text.trim().slice(0, 60) || 'Text'}
                  subtitle="Clipboard text"
                  icon={ClipboardPaste}
                  trailing={
                    <Pressable accessibilityRole="button" accessibilityLabel="Remove text" hitSlop={12} onPress={() => setText(null)}>
                      <X size={18} color={colors.textFaint} />
                    </Pressable>
                  }
                />
              ) : null}
              {files.map((file, index) => (
                <ListItem
                  key={`${file.uri}-${index}`}
                  title={file.name}
                  subtitle={formatBytes(file.size)}
                  icon={FileText}
                  trailing={
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${file.name}`}
                      hitSlop={12}
                      onPress={() => {
                        deletePickedCopies([file.uri]);
                        setFiles((list) => list.filter((_, i) => i !== index));
                      }}
                    >
                      <X size={18} color={colors.textFaint} />
                    </Pressable>
                  }
                />
              ))}
            </Card>
          )}
        </>
      ) : null}

      {step.name === 'scan' ? <QrScanner onScan={onScan} hint="Point at the QR code on the receiving phone’s Receive screen." /> : null}

      {step.name === 'connecting' ? (
        <Card style={{ alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxxl }}>
          <ActivityIndicator color={colors.accent} />
          <Text color="textMuted">Connecting to {step.pairing.host}…</Text>
        </Card>
      ) : null}

      {step.name === 'error' ? (
        <Card style={{ gap: spacing.sm }}>
          <Text variant="heading">Could not send</Text>
          <Text color="textMuted">{step.message}</Text>
        </Card>
      ) : null}

      {step.name === 'sending' || step.name === 'done' ? (
        <>
          <Card variant={step.name === 'done' && step.failed === 0 ? 'glow' : 'raised'} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
            <Ring
              progress={outgoing.length ? outgoing.filter((t) => t.status === 'done').length / outgoing.length : step.name === 'done' ? 1 : 0}
              size={56}
              stroke={6}
              tone={step.name === 'done' && step.failed > 0 ? 'danger' : step.name === 'done' ? 'success' : 'accent'}
            >
              {step.name === 'done' && step.failed === 0 ? <CircleCheck size={22} color={colors.success} /> : <Smartphone size={20} color={colors.accent} />}
            </Ring>
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong">{step.peer}</Text>
              <Text variant="caption" color={step.name === 'done' && step.failed > 0 ? 'danger' : 'textMuted'}>
                {step.name === 'sending'
                  ? 'Sending · encrypted'
                  : step.failed === 0
                    ? `All ${step.sent} item${step.sent === 1 ? '' : 's'} delivered`
                    : `${step.sent} delivered, ${step.failed} failed`}
              </Text>
            </View>
          </Card>
          {outgoing.map((transfer, i) => (
            <Appear key={transfer.id} index={i}>
              <TransferRow transfer={transfer} />
            </Appear>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
