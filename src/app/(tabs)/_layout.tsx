import { FloatingTabBar } from '@basalt/core';
import { Tabs } from 'expo-router/js-tabs';
import { History, Home, Settings } from 'lucide-react-native';
import React from 'react';

const ITEMS = [
  { name: 'index', label: 'Home', icon: Home },
  { name: 'history', label: 'History', icon: History },
  { name: 'settings', label: 'Settings', icon: Settings },
];

export default function TabsLayout() {
  return <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingTabBar {...props} items={ITEMS} />} />;
}
