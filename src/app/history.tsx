import { Button, Card, EmptyState, ListItem, Screen, Text, formatBytes, formatRelativeTime, toMessage, useTheme, useToast } from '@basalt/core';
import * as IntentLauncher from 'expo-intent-launcher';
import { ArrowDownLeft, ArrowUpRight, CircleAlert, History as HistoryIcon, Trash2 } from 'lucide-react-native';
import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { Header } from '../components/Header';
import type { HistoryEntry } from '../lib/history';
import { useRelay } from '../lib/store';

const FLAG_GRANT_READ_URI_PERMISSION = 1;

export default function History() {
  const { spacing } = useTheme();
  const toast = useToast();
  const history = useRelay((s) => s.history);
  const historyError = useRelay((s) => s.historyError);
  const loadHistory = useRelay((s) => s.loadHistory);
  const wipeHistory = useRelay((s) => s.wipeHistory);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const open = async (entry: HistoryEntry) => {
    if (!entry.savedUri) return;
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: entry.savedUri, flags: FLAG_GRANT_READ_URI_PERMISSION });
    } catch {
      toast('No app on this phone can open that file. It is in Downloads/Relay.', 'danger');
    }
  };

  const confirmClear = () => {
    Alert.alert('Clear history?', 'This removes the list only. Files you received stay in Downloads/Relay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          wipeHistory().catch((error) => toast(toMessage(error, 'Could not clear history.'), 'danger'));
        },
      },
    ]);
  };

  return (
    <Screen>
      <Header title="History" subtitle={`${history.length} transfer${history.length === 1 ? '' : 's'}`} />
      {historyError ? (
        <Card style={{ gap: spacing.sm }}>
          <Text color="danger">{historyError}</Text>
          <Button label="Retry" variant="secondary" onPress={() => void loadHistory()} />
        </Card>
      ) : null}
      {history.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="Nothing here yet" message="Every file you send or receive is logged on this phone only." />
      ) : (
        <>
          <Card style={{ paddingVertical: spacing.xs }}>
            {history.map((entry) => {
              const failed = entry.status === 'failed';
              const openable = !failed && entry.direction === 'in' && !!entry.savedUri;
              return (
                <ListItem
                  key={entry.id}
                  title={entry.name}
                  subtitle={`${failed ? (entry.error ?? 'Failed') : entry.direction === 'in' ? 'Received' : 'Sent'} · ${formatBytes(entry.size)} · ${formatRelativeTime(entry.createdAt)}`}
                  icon={failed ? CircleAlert : entry.direction === 'in' ? ArrowDownLeft : ArrowUpRight}
                  iconTone={failed ? 'danger' : 'accent'}
                  onPress={openable ? () => void open(entry) : undefined}
                  chevron={openable}
                />
              );
            })}
          </Card>
          <Button label="Clear history" icon={Trash2} variant="danger" onPress={confirmClear} />
        </>
      )}
    </Screen>
  );
}
