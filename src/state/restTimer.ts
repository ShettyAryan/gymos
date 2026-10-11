import { create } from 'zustand';

/**
 * Rest timer — transient UI state only (not workout data). It is based on an absolute end time,
 * so it stays correct across re-renders and app backgrounding while the process is alive.
 */
type RestTimerState = {
  endsAt: number | null;
  duration: number;
  label: string | null;
  start: (seconds: number, label?: string) => void;
  add: (seconds: number) => void;
  stop: () => void;
};

export const useRestTimer = create<RestTimerState>((set, get) => ({
  endsAt: null,
  duration: 0,
  label: null,
  start: (seconds, label) =>
    set(
      seconds > 0
        ? { endsAt: Date.now() + seconds * 1000, duration: seconds, label: label ?? null }
        : { endsAt: null },
    ),
  add: (seconds) => {
    const { endsAt, duration } = get();
    if (endsAt)
      set({
        endsAt: Math.max(Date.now(), endsAt + seconds * 1000),
        duration: Math.max(0, duration + seconds),
      });
  },
  stop: () => set({ endsAt: null, label: null }),
}));
