import { Redirect, Tabs } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { LoadingState, Screen, Text } from '@/components';
import { useQuery } from '@/data/DatabaseProvider';
import { getProfile } from '@/data/local/repositories/profile';
import { useReducedMotion } from '@/state/motion';
import { colors, spacing } from '@/theme/tokens';
import { haptics } from '@/utils/haptics';

/** Text-only tab label: ink when active with a small accent dot, faint otherwise. */
function TabLabel({ focused, children }: { focused: boolean; children: string }) {
  const reduced = useReducedMotion();
  const dot = useRef(new Animated.Value(focused ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) dot.setValue(focused ? 1 : 0);
    else
      Animated.spring(dot, {
        toValue: focused ? 1 : 0,
        useNativeDriver: true,
        speed: 18,
        bounciness: 8,
      }).start();
  }, [focused, reduced, dot]);
  return (
    <View style={styles.tab}>
      <Text
        variant="label"
        color={focused ? colors.text : colors.textFaint}
        numberOfLines={1}
        allowFontScaling={false}
      >
        {children}
      </Text>
      <Animated.View style={[styles.dot, { opacity: dot, transform: [{ scale: dot }] }]} />
    </View>
  );
}

export default function TabsLayout() {
  const profile = useQuery((db) => getProfile(db));
  if (profile.loading && profile.data === undefined) {
    return (
      <Screen scroll={false}>
        <LoadingState />
      </Screen>
    );
  }
  if (!profile.data?.onboarded_at) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      screenListeners={{ tabPress: () => haptics.select() }}
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: true,
        tabBarIcon: () => null,
        tabBarIconStyle: styles.hidden,
        tabBarLabel: ({ focused, children }) => <TabLabel focused={focused}>{children}</TabLabel>,
        tabBarStyle: styles.bar,
        tabBarItemStyle: styles.item,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="train" options={{ title: 'Train' }} />
      <Tabs.Screen name="progress" options={{ title: 'Progress' }} />
      <Tabs.Screen name="coach" options={{ title: 'Coach' }} />
      <Tabs.Screen name="profile" options={{ title: 'You' }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.bg,
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    elevation: 0,
  },
  item: { justifyContent: 'center', paddingTop: spacing.sm },
  hidden: { display: 'none' },
  tab: { alignItems: 'center', gap: spacing.sm - 2 },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent },
});
