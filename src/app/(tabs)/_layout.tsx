import { SlotTabs } from '@basalt/core';
import History from 'lucide-react-native/icons/rotate-ccw-clock';
import Home from 'lucide-react-native/icons/house';
import Settings from 'lucide-react-native/icons/settings';
import React from 'react';

const TABS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/history', label: 'History', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function TabsLayout() {
  return <SlotTabs tabs={TABS} />;
}
