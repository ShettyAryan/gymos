import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { NavHeader } from '@/components/NavHeader';
import { DatabaseProvider } from '@/data/DatabaseProvider';
import { SyncManager } from '@/features/sync/SyncManager';
import { startMotionMonitor } from '@/state/motion';
import { startNetworkMonitor } from '@/state/network';
import { fontAssets } from '@/theme/fonts';
import { colors } from '@/theme/tokens';

// Keep the native splash up until the bundled fonts are ready (no flash of system font).
SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  useEffect(() => startNetworkMonitor(), []);
  useEffect(() => startMotionMonitor(), []);
  useEffect(() => {
    // A font failure must never block the app: fall back to system fonts and continue.
    if (fontsLoaded || fontError) SplashScreen.hideAsync().catch(() => undefined);
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider style={{ backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <DatabaseProvider>
        <SyncManager />
        <Stack
          screenOptions={{
            // App-drawn header: always clears the status bar in edge-to-edge mode.
            header: (props) => <NavHeader {...props} />,
            contentStyle: { backgroundColor: colors.bg },
            animation: 'fade_from_bottom',
            animationDuration: 220,
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen
            name="onboarding"
            options={{ headerShown: false, gestureEnabled: false, animation: 'fade' }}
          />
        </Stack>
      </DatabaseProvider>
    </SafeAreaProvider>
  );
}
