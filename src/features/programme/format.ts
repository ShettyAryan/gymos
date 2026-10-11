import type { LoggingType } from '@/domain/models/constants';
import { formatClock, WEEKDAY_SHORT } from '@/utils/dates';

export function formatRange(min: number, max: number, loggingType?: LoggingType): string {
  const unit = loggingType === 'duration' || loggingType === 'hold' ? 's' : '';
  if (loggingType === 'distance') return '';
  return min === max ? `${min}${unit}` : `${min}–${max}${unit}`;
}

export function formatPrescription(p: {
  sets: number;
  repMin: number;
  repMax: number;
  restSeconds: number;
  targetRir?: number | null;
  loggingType?: LoggingType;
}): string {
  const range = formatRange(p.repMin, p.repMax, p.loggingType);
  const main = range ? `${p.sets} × ${range}` : `${p.sets} ${p.sets === 1 ? 'set' : 'sets'}`;
  const rest = p.restSeconds > 0 ? ` · ${formatClock(p.restSeconds)} rest` : '';
  const rir = p.targetRir !== null && p.targetRir !== undefined ? ` · RIR ${p.targetRir}` : '';
  return `${main}${rest}${rir}`;
}

export function weekdayLabel(w: number | null): string {
  return w === null ? 'Unscheduled' : WEEKDAY_SHORT[w]!;
}
