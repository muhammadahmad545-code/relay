import { Appear, Button, Card, Chip, EmptyState, Hero, ListItem, Screen, StatTile, TAB_BAR_SPACE, Text, TextField, formatBytes, formatRelativeTime, toMessage, useTheme, useToast } from '@basalt/core';
import { useFocusEffect } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight, CircleAlert, History as HistoryIcon, Trash2 } from 'lucide-react-native';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import type { HistoryEntry } from '../../lib/history';
import { openReceived } from '../../lib/open';
import { useRelay } from '../../lib/store';

type Filter = 'all' | 'in' | 'out' | 'failed';

export default function History() {
  const { spacing } = useTheme();
  const toast = useToast();
  const history = useRelay((s) => s.history);
  const historyError = useRelay((s) => s.historyError);
  const loadHistory = useRelay((s) => s.loadHistory);
  const wipeHistory = useRelay((s) => s.wipeHistory);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  useFocusEffect(
    useCallback(() => {
      void loadHistory();
    }, [loadHistory]),
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return history.filter((h) => {
      if (filter === 'failed' && h.status !== 'failed') return false;
      if ((filter === 'in' || filter === 'out') && (h.direction !== filter || h.status !== 'done')) return false;
      return !q || h.name.toLowerCase().includes(q);
    });
  }, [history, filter, search]);

  const totals = useMemo(() => {
    const done = history.filter((h) => h.status === 'done');
    return { files: done.length, bytes: done.reduce((n, h) => n + h.size, 0), failed: history.length - done.length };
  }, [history]);

  const open = async (entry: HistoryEntry) => {
    if (!entry.savedUri) return;
    if (!(await openReceived(entry.savedUri))) toast('No app on this phone can open that file. It is in Downloads/Relay.', 'danger');
  };

  const confirmClear = () => {
    Alert.alert('Clear history?', 'This removes the list only. Files you received stay in Downloads/Relay.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => void wipeHistory().catch((error) => toast(toMessage(error, 'Could not clear history.'), 'danger')) },
    ]);
  };

  return (
    <Screen aurora bottomSpace={TAB_BAR_SPACE}>
      <Hero overline="Relay" title="History" subtitle="Kept on this phone only." />
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <StatTile label="Files moved" value={String(totals.files)} />
        <StatTile label="Data" value={formatBytes(totals.bytes)} />
        <StatTile label="Failed" value={String(totals.failed)} />
      </View>
      {historyError ? (
        <Card style={{ gap: spacing.sm }}>
          <Text color="danger">{historyError}</Text>
          <Button label="Retry" variant="secondary" onPress={() => void loadHistory()} />
        </Card>
      ) : null}
      <TextField value={search} onChangeText={setSearch} placeholder="Search file names" accessibilityLabel="Search history" autoCorrect={false} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {(
          [
            ['all', 'All'],
            ['in', 'Received'],
            ['out', 'Sent'],
            ['failed', 'Failed'],
          ] as const
        ).map(([value, label]) => (
          <Chip key={value} label={label} selected={filter === value} onPress={() => setFilter(value)} />
        ))}
      </View>
      {shown.length === 0 ? (
        <EmptyState icon={HistoryIcon} title={history.length ? 'Nothing matches' : 'Nothing here yet'} message={history.length ? 'Try another filter or name.' : 'Every file you send or receive is logged here.'} />
      ) : (
        <Card style={{ paddingVertical: spacing.xs }}>
          {shown.slice(0, 300).map((entry, i) => {
            const failed = entry.status === 'failed';
            const openable = !failed && entry.direction === 'in' && !!entry.savedUri;
            return (
              <Appear key={entry.id} index={Math.min(i, 10)}>
                <ListItem
                  title={entry.name}
                  subtitle={`${failed ? (entry.error ?? 'Failed') : entry.direction === 'in' ? 'Received' : 'Sent'} · ${formatBytes(entry.size)} · ${formatRelativeTime(entry.createdAt)}`}
                  icon={failed ? CircleAlert : entry.direction === 'in' ? ArrowDownLeft : ArrowUpRight}
                  iconTone={failed ? 'danger' : 'accent'}
                  onPress={openable ? () => void open(entry) : undefined}
                  chevron={openable}
                />
              </Appear>
            );
          })}
        </Card>
      )}
      {history.length > 0 ? <Button label="Clear history" icon={Trash2} variant="danger" onPress={confirmClear} /> : null}
    </Screen>
  );
}
