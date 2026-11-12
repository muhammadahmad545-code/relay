import { Pressable, Text, useTheme } from '@basalt/core';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import React from 'react';
import { View } from 'react-native';

export function Header({ title, subtitle, right }: { title: string; subtitle?: string; right?: React.ReactNode }) {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        hitSlop={8}
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
      >
        <ArrowLeft size={20} color={colors.text} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text variant="title" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="textMuted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}
