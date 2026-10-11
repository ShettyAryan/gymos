/**
 * GymOS design tokens — "training instrument".
 *
 * Near-black canvas, warm off-white ink, one signal accent reserved for live state
 * (active session, timers, progress, records). Primary actions use ink, not the accent.
 * Crisp corners, uppercase micro-labels, large tabular numerals, hairline structure.
 * Status colours always travel with a text label so meaning never depends on colour alone.
 */
import { fonts } from './fonts';

export const colors = {
  bg: '#0A0A0A',
  surface: '#131313',
  surfaceAlt: '#1B1B1B',
  surfacePressed: '#232323',
  border: '#232323',
  borderStrong: '#363636',
  text: '#F2F1EC',
  textMuted: '#9A9993',
  textFaint: '#63625E',
  /** Primary action fill (ink on dark). */
  ink: '#F2F1EC',
  onInk: '#0A0A0A',
  /** Signal accent: live/active state only. */
  accent: '#FF5B26',
  accentPressed: '#E54E1C',
  onAccent: '#0A0A0A',
  accentSoft: 'rgba(255, 91, 38, 0.14)',
  success: '#5BC287',
  warning: '#E6A740',
  danger: '#F2584F',
  info: '#8DA2FF',
  overlay: 'rgba(0, 0, 0, 0.6)',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/** Single horizontal gutter shared by every screen so all edges line up. */
export const layout = {
  gutter: 20,
  sectionGap: 28,
  cardPadding: 16,
  rowMinHeight: 56,
} as const;

export const radius = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  pill: 999,
} as const;

/**
 * Font sizes scale with the OS text-size setting (allowFontScaling defaults to true).
 * Poppins for words, DM Mono for labels and numbers. `fontWeight` here selects the Poppins
 * weight file via the Text component (custom fonts ignore fontWeight on Android).
 */
export const typography = {
  display: {
    fontFamily: fonts.bold,
    fontSize: 38,
    fontWeight: '700',
    letterSpacing: -1,
    lineHeight: 46,
  },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 27,
    fontWeight: '600',
    letterSpacing: -0.6,
    lineHeight: 36,
  },
  heading: {
    fontFamily: fonts.semibold,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
    lineHeight: 24,
  },
  body: { fontFamily: fonts.regular, fontSize: 15, fontWeight: '400', lineHeight: 22 },
  bodyStrong: { fontFamily: fonts.medium, fontSize: 15, fontWeight: '500', lineHeight: 22 },
  label: {
    fontFamily: fonts.monoMedium,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 1.2,
    lineHeight: 15,
    textTransform: 'uppercase',
  },
  caption: { fontFamily: fonts.regular, fontSize: 13, fontWeight: '400', lineHeight: 19 },
  metric: {
    fontFamily: fonts.monoMedium,
    fontSize: 28,
    fontWeight: '500',
    letterSpacing: -1,
    lineHeight: 34,
  },
} as const;

/** Minimum comfortable touch target (WCAG / platform guidance). */
export const touchTarget = 48;

export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export const toneColor: Record<StatusTone, string> = {
  neutral: colors.textFaint,
  accent: colors.accent,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
  info: colors.info,
};
