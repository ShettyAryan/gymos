/** Canonical storage: kilograms, centimetres, metres. Conversion happens only at the UI edge. */
export type UnitSystem = 'metric' | 'imperial';

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;
export const M_PER_MILE = 1609.344;

export const kgToLb = (kg: number) => kg / KG_PER_LB;
export const lbToKg = (lb: number) => lb * KG_PER_LB;
export const cmToIn = (cm: number) => cm / CM_PER_IN;
export const inToCm = (inch: number) => inch * CM_PER_IN;

export function round(value: number, step = 0.1): number {
  const inv = 1 / step;
  return Math.round(value * inv) / inv;
}

export const loadUnit = (u: UnitSystem) => (u === 'imperial' ? 'lb' : 'kg');
export const lengthUnit = (u: UnitSystem) => (u === 'imperial' ? 'in' : 'cm');
export const distanceUnit = (u: UnitSystem) => (u === 'imperial' ? 'mi' : 'km');

/** Display value for a canonical kg load. */
export function displayLoad(kg: number | null | undefined, u: UnitSystem): number | null {
  if (kg === null || kg === undefined) return null;
  return u === 'imperial' ? round(kgToLb(kg), 0.1) : round(kg, 0.01);
}

/** Parse a user-entered load in display units to canonical kg (null for blank/invalid). */
export function parseLoad(input: string, u: UnitSystem): number | null {
  const v = parseDecimal(input);
  if (v === null) return null;
  return u === 'imperial' ? lbToKg(v) : v;
}

export function displayLength(cm: number | null | undefined, u: UnitSystem): number | null {
  if (cm === null || cm === undefined) return null;
  return u === 'imperial' ? round(cmToIn(cm), 0.1) : round(cm, 0.1);
}

export function parseLength(input: string, u: UnitSystem): number | null {
  const v = parseDecimal(input);
  if (v === null) return null;
  return u === 'imperial' ? inToCm(v) : v;
}

export function displayDistance(m: number | null | undefined, u: UnitSystem): number | null {
  if (m === null || m === undefined) return null;
  return u === 'imperial' ? round(m / M_PER_MILE, 0.01) : round(m / 1000, 0.01);
}

export function parseDistance(input: string, u: UnitSystem): number | null {
  const v = parseDecimal(input);
  if (v === null) return null;
  return u === 'imperial' ? v * M_PER_MILE : v * 1000;
}

/** Accepts "62.5" or "62,5"; returns null for blank/non-numeric/negative. */
export function parseDecimal(input: string): number | null {
  const t = input.trim().replace(',', '.');
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

export function parseIntSafe(input: string): number | null {
  const v = parseDecimal(input);
  return v === null ? null : Math.round(v);
}

export function formatLoad(kg: number | null | undefined, u: UnitSystem): string {
  const v = displayLoad(kg, u);
  return v === null ? '—' : `${v} ${loadUnit(u)}`;
}
