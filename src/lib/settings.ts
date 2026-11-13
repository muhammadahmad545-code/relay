import { createSetting } from '@basalt/core';
import Constants from 'expo-constants';

export const deviceName = createSetting<string>('relay.deviceName', (Constants.deviceName ?? 'My phone').slice(0, 40));

export const autoCopySetting = createSetting<boolean>('relay.autoCopyText', false);
export const onboardedSetting = createSetting<boolean>('relay.onboarded', false);

export const UPDATE_SOURCE = { owner: 'muhammadahmad545-code', repo: 'relay' } as const;
export const REPO_URL = `https://github.com/${UPDATE_SOURCE.owner}/${UPDATE_SOURCE.repo}`;
export const ACCENT = { dark: '#2DE1C2', dark2: '#38BDF8', light: '#0B8F7A', light2: '#0369A1', onAccent: '#06110F' } as const;
