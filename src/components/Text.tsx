import { Text as RNText, StyleSheet, type TextProps, type TextStyle } from 'react-native';

import { familyFor } from '@/theme/fonts';
import { colors, typography } from '@/theme/tokens';

export type TextVariant = keyof typeof typography;

type Props = TextProps & {
  variant?: TextVariant;
  color?: string;
  muted?: boolean;
  faint?: boolean;
  center?: boolean;
};

/**
 * Typography primitive. Resolves `fontWeight` (from the variant or a style override) to the
 * matching bundled font file, because custom fonts ignore fontWeight on Android.
 */
export function Text({ variant = 'body', color, muted, faint, center, style, ...rest }: Props) {
  const tint = color ?? (faint ? colors.textFaint : muted ? colors.textMuted : colors.text);
  const { fontWeight, ...flat } =
    StyleSheet.flatten([typography[variant] as TextStyle, style]) ?? {};
  return (
    <RNText
      {...rest}
      style={[
        flat,
        { color: tint, fontFamily: familyFor(flat.fontFamily, fontWeight) },
        center ? { textAlign: 'center' } : null,
      ]}
    />
  );
}
