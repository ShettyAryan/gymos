import type { NativeStackHeaderProps } from '@react-navigation/native-stack';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, layout } from '@/theme/tokens';

import { IconButton } from './Button';
import { Text } from './Text';

const BAR_HEIGHT = 52;
const SIDE = 96;

/**
 * Stack header drawn by the app (not the native header) so it always sits below the status bar
 * in Android edge-to-edge mode. Title is truly centred; side slots are equal width.
 * Uses each screen's existing `title` and `headerRight` options.
 */
export function NavHeader({ navigation, options, back }: NativeStackHeaderProps) {
  const insets = useSafeAreaInsets();
  const title =
    typeof options.headerTitle === 'string' ? options.headerTitle : (options.title ?? '');
  const showBack = !!back && options.headerBackVisible !== false;
  return (
    <View style={[styles.wrap, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <View style={styles.side}>
          {showBack ? (
            <IconButton
              icon="chevron-back"
              label="Back"
              onPress={navigation.goBack}
              color={colors.text}
            />
          ) : null}
        </View>
        <Text
          variant="bodyStrong"
          numberOfLines={1}
          style={styles.title}
          accessibilityRole="header"
        >
          {title}
        </Text>
        <View style={[styles.side, styles.right]}>
          {options.headerRight?.({ tintColor: colors.text, canGoBack: showBack })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.bg },
  bar: {
    height: BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: layout.gutter - 12,
  },
  side: { width: SIDE, flexDirection: 'row', alignItems: 'center' },
  right: { justifyContent: 'flex-end' },
  title: { position: 'absolute', left: SIDE + 8, right: SIDE + 8, textAlign: 'center' },
});
