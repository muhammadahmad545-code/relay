import { Button, Card, ListItem, Screen, SegmentedControl, Text, UpdateCard, themePreference, useTheme, useToast, useUpdater } from '@basalt/core';
import * as Linking from 'expo-linking';
import { Code, RefreshCw, ShieldCheck } from 'lucide-react-native';
import React, { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Header } from '../components/Header';
import { REPO_URL, UPDATE_SOURCE, deviceName } from '../lib/settings';

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

export default function Settings() {
  const { colors, spacing, radius, typography } = useTheme();
  const toast = useToast();
  const [theme, setTheme] = themePreference.use();
  const [name, setName] = deviceName.use();
  const [draft, setDraft] = useState(name);
  const updater = useUpdater({ source: UPDATE_SOURCE, auto: false });

  const saveName = () => {
    const cleaned = draft.trim().slice(0, 40);
    if (!cleaned) {
      setDraft(name);
      return toast('The device name cannot be empty.', 'danger');
    }
    if (cleaned !== name) {
      setName(cleaned);
      toast('Device name saved', 'success');
    }
    setDraft(cleaned);
  };

  return (
    <Screen>
      <Header title="Settings" />

      <Card style={{ gap: spacing.sm }}>
        <Text variant="overline" color="textMuted">
          Device name
        </Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onBlur={saveName}
          onSubmitEditing={saveName}
          maxLength={40}
          returnKeyType="done"
          accessibilityLabel="Device name"
          placeholder="My phone"
          placeholderTextColor={colors.textFaint}
          style={[typography.body, { color: colors.text, backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md }]}
        />
        <Text variant="caption" color="textMuted">
          Shown to devices that connect to you.
        </Text>
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text variant="overline" color="textMuted">
          Appearance
        </Text>
        <SegmentedControl options={THEMES} value={theme} onChange={setTheme} />
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Text variant="overline" color="textMuted">
          Updates
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Text variant="bodyStrong">Version {updater.currentVersion}</Text>
            <Text variant="caption" color="textMuted">
              Updates come from this app’s GitHub releases.
            </Text>
          </View>
          <Button label="Check" icon={RefreshCw} variant="secondary" loading={updater.state.phase === 'checking'} onPress={() => void updater.check()} />
        </View>
      </Card>
      <UpdateCard updater={updater} />

      <Card style={{ paddingVertical: spacing.xs }}>
        <ListItem
          title="Private by design"
          subtitle="No account, no analytics, no servers. The only request Relay makes to the internet is the update check."
          icon={ShieldCheck}
          iconTone="success"
        />
        <ListItem title="Source code" subtitle="MIT licensed on GitHub" icon={Code} chevron onPress={() => void Linking.openURL(REPO_URL)} />
      </Card>
    </Screen>
  );
}
