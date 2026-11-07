/** Per-device record of which daily chambers have been cleared, kept in localStorage. */
const STORAGE_KEY = 'loop-lab-daily';

export interface DayRecord {
  /** Best (lowest) clear time, in seconds. */
  time: number;
  /** Fewest portals fired in a clear. */
  portals: number;
  /** True if it was ever cleared on its own calendar day (counts toward the streak). */
  onDay: boolean;
}

export type Progress = Record<number, DayRecord>;

function isRecord(v: unknown): v is DayRecord {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.time === 'number' && typeof r.portals === 'number' && typeof r.onDay === 'boolean';
}

export function loadProgress(): Progress {
  const out: Progress = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      for (const [k, v] of Object.entries(parsed)) {
        const day = Number(k);
        if (Number.isInteger(day) && isRecord(v)) out[day] = v;
      }
    }
  } catch {
    // storage unavailable or corrupt — start fresh
  }
  return out;
}

function saveProgress(progress: Progress): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // ignore
  }
}

/** Records a clear, keeping the best time and fewest portals. Returns the updated record. */
export function recordClear(progress: Progress, day: number, time: number, portals: number, onDay: boolean): DayRecord {
  const prev = progress[day];
  const rec: DayRecord = prev
    ? { time: Math.min(prev.time, time), portals: Math.min(prev.portals, portals), onDay: prev.onDay || onDay }
    : { time, portals, onDay };
  progress[day] = rec;
  saveProgress(progress);
  return rec;
}

/** Consecutive days cleared on the day, ending today (or yesterday, if today isn't done yet). */
export function currentStreak(progress: Progress, today: number): number {
  let d = progress[today]?.onDay ? today : today - 1;
  let streak = 0;
  while (progress[d]?.onDay) {
    streak++;
    d--;
  }
  return streak;
}
