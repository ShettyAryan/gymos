import { DMMono_400Regular } from '@expo-google-fonts/dm-mono/400Regular';
import { DMMono_500Medium } from '@expo-google-fonts/dm-mono/500Medium';
import { Poppins_400Regular } from '@expo-google-fonts/poppins/400Regular';
import { Poppins_500Medium } from '@expo-google-fonts/poppins/500Medium';
import { Poppins_600SemiBold } from '@expo-google-fonts/poppins/600SemiBold';
import { Poppins_700Bold } from '@expo-google-fonts/poppins/700Bold';

/**
 * Type pairing: Poppins (geometric sans) for headings and body; DM Mono for micro-labels,
 * numbers and timers — the "instrument readout". Both are SIL OFL fonts, bundled with the app.
 * Only the weights below are bundled.
 */
export const fontAssets = {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
  DMMono_400Regular,
  DMMono_500Medium,
};

export const fonts = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semibold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
  mono: 'DMMono_400Regular',
  monoMedium: 'DMMono_500Medium',
} as const;

const MONO = new Set<string>([fonts.mono, fonts.monoMedium]);

/**
 * Custom fonts on Android ignore `fontWeight`, so weight must select the family file.
 * Returns the family for a base family (sans or mono) and a numeric/keyword weight.
 */
export function familyFor(base: string | undefined, weight: string | number | undefined): string {
  const w = Number(
    weight === 'bold' ? 700 : weight === 'normal' || weight === undefined ? NaN : weight,
  );
  if (base && MONO.has(base)) return Number.isFinite(w) && w >= 500 ? fonts.monoMedium : base;
  if (!Number.isFinite(w)) return base ?? fonts.regular;
  if (w >= 700) return fonts.bold;
  if (w >= 600) return fonts.semibold;
  if (w >= 500) return fonts.medium;
  return fonts.regular;
}
