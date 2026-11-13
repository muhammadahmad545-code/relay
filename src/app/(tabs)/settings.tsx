import { Button, Card, Hero, ListItem, Screen, SectionTitle, SegmentedControl, TAB_BAR_SPACE, Text, TextField, Toggle, UpdateCard, themePreference, useTheme, useToast, useUpdater } from '@basalt/core';
import * as Linking from 'expo-linking';
import { Code, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react-native';
import React, { useState } from 'react';
import { View } from 'react-native';
import { REPO_URL, UPDATE_SOURCE, autoCopySetting, deviceName, onboardedSetting } from '../../lib/settings';

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

export default function Settings() {
  const { spacing } = useTheme();
  const toast = useToast();
  const [theme, setTheme] = themePreference.use();
  const [name, setName] = deviceName.use();
  const [autoCopy, setAutoCopy] = autoCopySetting.use();
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
    <Screen aurora bottomSpace={TAB_BAR_SPACE}>
      <Hero overline="Relay" title="Settings" />

      <SectionTitle title="This phone" />
      <Card style={{ gap: spacing.md }}>
        <TextField label="Device name" value={draft} onChangeText={setDraft} onBlur={saveName} onSubmitEditing={saveName} maxLength={40} returnKeyType="done" hint="Shown to devices that connect to you." />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text variant="bodyStrong">Copy received text automatically</Text>
            <Text variant="caption" color="textMuted">
              Text sent to this phone goes straight to the clipboard, ready to paste.
            </Text>
          </View>
          <Toggle value={autoCopy} onChange={setAutoCopy} accessibilityLabel="Copy received text automatically" />
        </View>
      </Card>

      <SectionTitle title="Appearance" />
      <SegmentedControl options={THEMES} value={theme} onChange={setTheme} />

      <SectionTitle title="Updates" />
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{ flex: 1 }}>
          <Text variant="bodyStrong">Version {updater.currentVersion}</Text>
          <Text variant="caption" color="textMuted">
            Updates come from this app’s GitHub releases.
          </Text>
        </View>
        <Button label="Check" icon={RefreshCw} variant="secondary" loading={updater.state.phase === 'checking'} onPress={() => void updater.check()} />
      </Card>
      <UpdateCard updater={updater} />

      <Card style={{ paddingVertical: spacing.xs }}>
        <ListItem title="Private by design" subtitle="No account, no analytics, no servers. The only request Relay makes to the internet is the update check." icon={ShieldCheck} iconTone="success" />
        <ListItem title="Show the introduction again" icon={Sparkles} chevron onPress={() => onboardedSetting.set(false)} />
        <ListItem title="Source code" subtitle="MIT licensed on GitHub" icon={Code} chevron onPress={() => void Linking.openURL(REPO_URL)} />
      </Card>
    </Screen>
  );
}
