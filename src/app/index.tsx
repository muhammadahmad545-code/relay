import { Card, EmptyState, ListItem, Pressable, Screen, Text, UpdateCard, formatBytes, formatRelativeTime, useTheme, useUpdater } from '@basalt/core';
import { useRouter } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight, CircleAlert, History, QrCode, ScanLine, Settings, ShieldCheck } from 'lucide-react-native';
import React from 'react';
import { View } from 'react-native';
import { UPDATE_SOURCE } from '../lib/settings';
import { useRelay } from '../lib/store';

export default function Home() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const updater = useUpdater({ source: UPDATE_SOURCE });
  const history = useRelay((s) => s.history);
  const recent = history.slice(0, 4);

  const action = (title: string, body: string, Icon: typeof QrCode, href: '/receive' | '/send', primary: boolean) => (
    <Card
      onPress={() => router.push(href)}
      accessibilityLabel={`${title}. ${body}`}
      style={{ flex: 1, gap: spacing.md, backgroundColor: primary ? colors.accent : colors.surface, borderColor: primary ? colors.accent : colors.border, minHeight: 168 }}
    >
      <View style={{ width: 48, height: 48, borderRadius: radius.lg, backgroundColor: primary ? 'rgba(0,0,0,0.12)' : colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon size={24} color={primary ? colors.onAccent : colors.accent} />
      </View>
      <View style={{ gap: 4 }}>
        <Text variant="heading" style={{ color: primary ? colors.onAccent : colors.text }}>
          {title}
        </Text>
        <Text variant="caption" style={{ color: primary ? colors.onAccent : colors.textMuted, opacity: primary ? 0.8 : 1 }}>
          {body}
        </Text>
      </View>
    </Card>
  );

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text variant="overline" color="accent">
            Basalt
          </Text>
          <Text variant="display">Relay</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings')}
          style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
        >
          <Settings size={20} color={colors.text} />
        </Pressable>
      </View>

      <Text color="textMuted">Move files and text between nearby devices. No internet, no account, no cloud.</Text>

      <UpdateCard updater={updater} />

      <View style={{ flexDirection: 'row', gap: spacing.md }}>
        {action('Receive', 'Show a QR code. Works with phones and any laptop browser.', QrCode, '/receive', true)}
        {action('Send', 'Scan another phone’s Relay code and send files or text.', ScanLine, '/send', false)}
      </View>

      <Card style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
        <ShieldCheck size={22} color={colors.success} />
        <Text variant="caption" color="textMuted" style={{ flex: 1 }}>
          Every transfer is encrypted with a one-time key that exists only in the QR code. Files travel directly between the two devices.
        </Text>
      </Card>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="overline" color="textMuted">
          Recent
        </Text>
        {history.length > 0 ? (
          <Pressable accessibilityRole="button" accessibilityLabel="See all history" onPress={() => router.push('/history')} hitSlop={12}>
            <Text variant="label" color="accent">
              See all
            </Text>
          </Pressable>
        ) : null}
      </View>

      {recent.length === 0 ? (
        <EmptyState icon={History} title="No transfers yet" message="Files you send or receive will be listed here." />
      ) : (
        <Card style={{ paddingVertical: spacing.xs }}>
          {recent.map((entry) => (
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
