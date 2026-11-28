import { AppearanceScreen } from '@basalt/core';
import { useRouter } from 'expo-router';
import React from 'react';

export default function Appearance() {
  const router = useRouter();
  return <AppearanceScreen appName="Relay" onBack={() => router.back()} />;
}
