import { useEffect, useState } from 'react';

/** Re-renders every `intervalMs` while mounted; returns the current time. */
export function useNow(intervalMs = 1000, enabled = true): Date {
  const [nowValue, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs, enabled]);
  return nowValue;
}
