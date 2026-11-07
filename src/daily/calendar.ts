/**
 * Daily chamber numbering. Chamber #1 is the launch day; each local
 * calendar day after that gets the next number.
 */
const EPOCH_UTC = Date.UTC(2026, 10, 1); // 1 November 2026
const DAY_MS = 86_400_000;

/** The daily chamber number for a date, using the player's local calendar day. */
export function dayNumber(date: Date = new Date()): number {
  const local = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((local - EPOCH_UTC) / DAY_MS) + 1;
}

/** Midday local time on the calendar day of chamber `day` (midday avoids DST edges). */
export function dateForDay(day: number): Date {
  const utc = new Date(EPOCH_UTC + (day - 1) * DAY_MS);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate(), 12);
}

export function formatDay(day: number, style: 'long' | 'short' = 'long'): string {
  const opts: Intl.DateTimeFormatOptions = style === 'long'
    ? { weekday: 'long', month: 'long', day: 'numeric' }
    : { weekday: 'short', month: 'short', day: 'numeric' };
  return dateForDay(day).toLocaleDateString(undefined, opts);
}

/** Milliseconds until the next local midnight, when a new chamber unlocks. */
export function msUntilNextDay(now: Date = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function formatCountdown(ms: number): string {
  const mins = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** m:ss (or h:mm:ss) for a duration in seconds. */
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
