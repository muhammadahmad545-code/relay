import { Appear, Button, Card, Chip, EmptyState, Hero, ListItem, Pressable, Screen, StatTile, TAB_BAR_SPACE, Text, TextField, formatBytes, formatRelativeTime, toMessage, useTheme, useToast } from '@basalt/core';
import { useFocusEffect } from 'expo-router';
import ArrowDownLeft from 'lucide-react-native/icons/arrow-down-left';
import ArrowUpRight from 'lucide-react-native/icons/arrow-up-right';
import CircleAlert from 'lucide-react-native/icons/circle-exclamation-point';
import MoreVertical from 'lucide-react-native/icons/ellipsis-vertical';
import HistoryIcon from 'lucide-react-native/icons/rotate-ccw-clock';
import Trash2 from 'lucide-react-native/icons/trash';
import React, { useCallback, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import type { HistoryEntry } from '../../lib/history';
import { openReceived } from '../../lib/open';
import RelayTransfer from '../../../modules/relay-transfer';
import { useLock } from '@basalt/core/src/lock/LockGate';
import { useRelay } from '../../lib/store';

type Filter = 'all' | 'in' | 'out' | 'failed';

export default function History() {
  const { colors, spacing } = useTheme();
  const toast = useToast();
  const history = useRelay((s) => s.history);
  const historyError = useRelay((s) => s.historyError);
  const loadHistory = useRelay((s) => s.loadHistory);
  const wipeHistory = useRelay((s) => s.wipeHistory);
  const forgetFile = useRelay((s) => s.forgetFile);
  const lock = useLock();
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
    const kept = done.filter((h) => h.direction === 'in' && h.savedUri);
    return {
      files: done.length,
      bytes: done.reduce((n, h) => n + h.size, 0),
      failed: history.length - done.length,
      keptCount: kept.length,
      keptBytes: kept.reduce((n, h) => n + h.size, 0),
    };
  }, [history]);

  const missing = (entry: HistoryEntry): boolean => {
    try {
      if (entry.savedUri && RelayTransfer.receivedExists(entry.savedUri)) return false;
    } catch {
      return false;
    }
    void forgetFile(entry.id);
    toast('That file is no longer on this phone.', 'danger');
    return true;
  };

  const open = async (entry: HistoryEntry) => {
    if (!entry.savedUri || missing(entry)) return;
    if (!(await openReceived(entry.savedUri))) toast('No app on this phone can open that file. It is in Downloads/Relay.', 'danger');
  };

  const share = (entry: HistoryEntry) => {
    if (!entry.savedUri || missing(entry)) return;
    try {
      void lock.runExternal(async () => RelayTransfer.shareReceived(entry.savedUri!, '*/*'));
    } catch (error) {
      toast(toMessage(error, 'Could not share that file.'), 'danger');
    }
  };

  const remove = (entry: HistoryEntry) => {
    if (!entry.savedUri) return;
    Alert.alert('Delete this file?', `“${entry.name}” will be removed from Downloads/Relay. The history row stays.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          let ok = false;
          try {
            ok = RelayTransfer.deleteReceived(entry.savedUri!);
          } catch {
            ok = false;
          }
          if (!ok) return toast('Could not delete that file. Remove it from Downloads/Relay in your file manager.', 'danger');
          void forgetFile(entry.id);
          toast('File deleted', 'success');
        },
      },
    ]);
  };

  const actions = (entry: HistoryEntry) => {
    Alert.alert(entry.name, `${formatBytes(entry.size)} · received ${formatRelativeTime(entry.createdAt)}`, [
      { text: 'Share', onPress: () => share(entry) },
      { text: 'Delete file', style: 'destructive', onPress: () => remove(entry) },
      { text: 'Open', onPress: () => void open(entry) },
    ], { cancelable: true });
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
      {totals.keptCount > 0 ? (
        <Text variant="caption" color="textMuted">
          {totals.keptCount} received file{totals.keptCount === 1 ? '' : 's'} on this phone · {formatBytes(totals.keptBytes)} in Downloads/Relay. Tap ⋮ on a file to share or delete it.
        </Text>
      ) : null}
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
            const gone = !failed && entry.direction === 'in' && !entry.savedUri;
            return (
              <Appear key={entry.id} index={Math.min(i, 10)}>
                <ListItem
                  title={entry.name}
                  subtitle={`${failed ? (entry.error ?? 'Failed') : entry.direction === 'in' ? (gone ? 'Received · file deleted' : 'Received') : 'Sent'} · ${formatBytes(entry.size)} · ${formatRelativeTime(entry.createdAt)}`}
                  icon={failed ? CircleAlert : entry.direction === 'in' ? ArrowDownLeft : ArrowUpRight}
                  iconTone={failed ? 'danger' : 'accent'}
                  onPress={openable ? () => void open(entry) : undefined}
                  trailing={
                    openable ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`More for ${entry.name}`}
                        hitSlop={10}
                        onPress={() => actions(entry)}
                        style={{ padding: spacing.xs }}
                      >
                        <MoreVertical size={20} color={colors.textMuted} />
                      </Pressable>
                    ) : undefined
                  }
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
