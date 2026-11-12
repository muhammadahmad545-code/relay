import { Card, ProgressBar, Text, formatBytes, formatSpeed, useTheme } from '@basalt/core';
import { ArrowDownLeft, ArrowUpRight, CircleAlert, CircleCheck } from 'lucide-react-native';
import React from 'react';
import { View } from 'react-native';
import type { LiveTransfer } from '../lib/store';

export function TransferRow({ transfer }: { transfer: LiveTransfer }) {
  const { colors, spacing } = useTheme();
  const progress = transfer.size > 0 ? transfer.bytes / transfer.size : transfer.status === 'done' ? 1 : 0;
  const seconds = Math.max(0.2, (transfer.updatedAt - transfer.startedAt) / 1000);
  const Icon = transfer.status === 'failed' ? CircleAlert : transfer.status === 'done' ? CircleCheck : transfer.direction === 'in' ? ArrowDownLeft : ArrowUpRight;
  const tone = transfer.status === 'failed' ? colors.danger : transfer.status === 'done' ? colors.success : colors.accent;

  let detail: string;
  if (transfer.status === 'failed') detail = transfer.error ?? 'Failed';
  else if (transfer.status === 'done') detail = `${transfer.direction === 'in' ? 'Received' : 'Sent'} · ${formatBytes(transfer.size)}`;
  else detail = `${formatBytes(transfer.bytes)} of ${formatBytes(transfer.size)} · ${formatSpeed(transfer.bytes / seconds)}`;

  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <Icon size={18} color={tone} />
        <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
          {transfer.name}
        </Text>
        {transfer.status === 'active' ? (
          <Text variant="label" color="textMuted">
            {Math.round(progress * 100)}%
          </Text>
        ) : null}
      </View>
      {transfer.status === 'active' ? <ProgressBar progress={progress} /> : null}
      <Text variant="caption" color={transfer.status === 'failed' ? 'danger' : 'textMuted'}>
        {detail}
      </Text>
    </Card>
  );
}
