import { SlotTabs } from '@basalt/core';
import { History, Home, Settings } from 'lucide-react-native';
import React from 'react';

const TABS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/history', label: 'History', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function TabsLayout() {
  return <SlotTabs tabs={TABS} />;
}
