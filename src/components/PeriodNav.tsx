import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/tokens';

import { IconButton } from './Button';
import { Text } from './Text';

/** Symmetric period navigator: ‹ label › with equal-width controls so the label stays centred. */
export function PeriodNav({
  label,
  onPrev,
  onNext,
}: {
  label: string;
  onPrev: () => void;
  onNext?: () => void;
}) {
  return (
    <View style={styles.row}>
      <IconButton
        icon="chevron-back"
        label="Previous period"
        onPress={onPrev}
        color={colors.text}
      />
      <Text variant="bodyStrong" style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <IconButton
        icon="chevron-forward"
        label="Next period"
        onPress={onNext}
        disabled={!onNext}
        color={colors.text}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginHorizontal: -12 },
  label: { flex: 1, textAlign: 'center', fontVariant: ['tabular-nums'] },
});
