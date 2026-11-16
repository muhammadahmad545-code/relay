import { Appear, Card, EmptyState, Gradient, Hero, ListItem, Pressable, Ring, Screen, SectionTitle, TAB_BAR_SPACE, Text, UpdateCard, formatBytes, formatRelativeTime, useTheme, useUpdater } from '@basalt/core';
import { useRouter } from 'expo-router';
import ArrowDownLeft from 'lucide-react-native/icons/arrow-down-left';
import ArrowUpRight from 'lucide-react-native/icons/arrow-up-right';
import CircleAlert from 'lucide-react-native/icons/circle-exclamation-point';
import History from 'lucide-react-native/icons/rotate-ccw-clock';
import QrCode from 'lucide-react-native/icons/qr-code';
import ScanLine from 'lucide-react-native/icons/scan-line';
import ShieldCheck from 'lucide-react-native/icons/shield-check';
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { UPDATE_SOURCE } from '../../lib/settings';
import { useRelay } from '../../lib/store';

const WEEK = 7 * 86_400_000;

export default function Home() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const updater = useUpdater({ source: UPDATE_SOURCE });
  const history = useRelay((s) => s.history);

  const week = useMemo(() => {
    const since = Date.now() - WEEK;
    const recent = history.filter((h) => h.createdAt > since && h.status === 'done');
    const bytesIn = recent.filter((h) => h.direction === 'in').reduce((n, h) => n + h.size, 0);
    const bytesOut = recent.filter((h) => h.direction === 'out').reduce((n, h) => n + h.size, 0);
    return { count: recent.length, bytesIn, bytesOut, total: bytesIn + bytesOut };
  }, [history]);

  return (
    <Screen aurora bottomSpace={TAB_BAR_SPACE}>
      <Hero overline="Basalt" title="Relay" subtitle="Move files and text between nearby devices. No internet, no account, no cloud." />
      <UpdateCard updater={updater} />

      <Appear index={0}>
        <Pressable accessibilityRole="button" accessibilityLabel="Receive. Show a QR code for phones and laptops." haptic pressScale={0.98} onPress={() => router.push('/receive')}>
          <Gradient colors={[colors.accent, colors.accent2]} radius={radius.xl} style={{ padding: spacing.xl, gap: spacing.lg, minHeight: 168 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <View style={{ width: 56, height: 56, borderRadius: radius.lg, backgroundColor: 'rgba(0,0,0,0.14)', alignItems: 'center', justifyContent: 'center' }}>
                <QrCode size={28} color={colors.onAccent} />
              </View>
              <ArrowDownLeft size={26} color={colors.onAccent} />
            </View>
            <View style={{ gap: 4 }}>
              <Text variant="title" style={{ color: colors.onAccent }}>
                Receive
              </Text>
              <Text style={{ color: colors.onAccent, opacity: 0.8 }}>Show a code. Works with phones and any laptop browser.</Text>
            </View>
          </Gradient>
        </Pressable>
      </Appear>

      <Appear index={1}>
        <Card variant="raised" onPress={() => router.push('/send')} accessibilityLabel="Send. Scan another phone's Relay code." style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg, padding: spacing.xl }}>
          <View style={{ width: 56, height: 56, borderRadius: radius.lg, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <ScanLine size={28} color={colors.accent} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="title">Send</Text>
            <Text color="textMuted">Scan the other phone’s code and send files or text.</Text>
          </View>
          <ArrowUpRight size={24} color={colors.accent} />
        </Card>
      </Appear>

      <Appear index={2}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }}>
          <Ring progress={week.total ? week.bytesIn / week.total : 0} size={96} stroke={10}>
            <Text variant="heading">{week.count}</Text>
            <Text variant="caption" color="textMuted">
              files
            </Text>
          </Ring>
          <View style={{ flex: 1, gap: 4 }}>
            <Text variant="heading">This week</Text>
            <Text variant="caption" color="textMuted">
              {formatBytes(week.bytesIn)} received · {formatBytes(week.bytesOut)} sent
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
              <ShieldCheck size={14} color={colors.success} />
              <Text variant="caption" color="success">
                All of it encrypted, none of it uploaded
              </Text>
            </View>
          </View>
        </Card>
      </Appear>

      <SectionTitle title="Recent" action={history.length > 0 ? 'See all' : undefined} onAction={() => router.push('/history')} />
      {history.length === 0 ? (
        <EmptyState icon={History} title="No transfers yet" message="Files you send or receive will be listed here." />
      ) : (
        <Card style={{ paddingVertical: spacing.xs }}>
          {history.slice(0, 5).map((entry) => (
            <ListItem
              key={entry.id}
              title={entry.name}
              subtitle={`${entry.status === 'failed' ? 'Failed' : entry.direction === 'in' ? 'Received' : 'Sent'} · ${formatBytes(entry.size)} · ${formatRelativeTime(entry.createdAt)}`}
              icon={entry.status === 'failed' ? CircleAlert : entry.direction === 'in' ? ArrowDownLeft : ArrowUpRight}
              iconTone={entry.status === 'failed' ? 'danger' : 'accent'}
            />
          ))}
        </Card>
      )}
    </Screen>
  );
}
