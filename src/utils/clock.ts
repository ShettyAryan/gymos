let nowFn: () => Date = () => new Date();

/** Current instant. Injectable so tests can control time. */
export function now(): Date {
  return nowFn();
}

/** Current instant as a UTC ISO-8601 string (the canonical stored timestamp format). */
export function nowIso(): string {
  return nowFn().toISOString();
}

export function setClock(fn: () => Date): void {
  nowFn = fn;
}

export function resetClock(): void {
  nowFn = () => new Date();
}
