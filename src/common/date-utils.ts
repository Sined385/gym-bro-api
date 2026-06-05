/**
 * Returns Monday 00:00:00.000 of the week containing the given date.
 * Week starts on Monday (ISO standard).
 *
 * Uses the Node process's local timezone. On Railway this is UTC, which
 * silently mis-aligns the week boundary against users in eastern
 * timezones (a Saturday late-night workout in Bucharest is Sunday in
 * UTC, lands in the wrong week). Pass `tz` and use the user-tz variant
 * below for any path that compares against user activity.
 */
export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon ... 6=Sat
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Converts JS `getDay()` (0=Sun) to Monday-based day-of-week (0=Mon..6=Sun).
 *
 * Uses the Node process's local timezone — see getWeekStart caveat.
 */
export function toMondayDow(date?: Date): number {
  const d = date ?? new Date();
  const day = d.getDay();
  return day === 0 ? 6 : day - 1;
}

const DOW_MAP: Record<string, number> = {
  Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
};

/**
 * Monday-based day-of-week (0=Mon..6=Sun) for the given instant as seen
 * in the user's IANA timezone (e.g. "Europe/Bucharest"). Falls back to
 * the server-local computation when `tz` is missing or invalid so the
 * caller doesn't need to branch.
 */
export function toMondayDowInTz(
  date: Date,
  tz: string | null | undefined,
): number {
  if (!tz) return toMondayDow(date);
  try {
    const wd = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
    }).format(date);
    return DOW_MAP[wd] ?? toMondayDow(date);
  } catch {
    return toMondayDow(date);
  }
}

/**
 * The UTC instants that bound the user's local calendar day containing
 * `date` (start inclusive, end exclusive), plus the Monday-based DOW of
 * that local day. Used by reconcile / linkSessionToToday so a session
 * completed at 00:30 local time isn't matched against the prior UTC
 * day's plan day.
 *
 * The offset trick:
 *   - Format `date` in the user's tz → gives the wall-clock components
 *   - Treat those components as if they were UTC to get a pseudo-instant
 *   - The delta between pseudo-instant and real instant IS the tz offset
 *   - Subtract that delta from "midnight of those components" to get
 *     real UTC midnight of the user's local day
 */
export function userLocalDayBoundsUtc(
  date: Date,
  tz: string | null | undefined,
): { start: Date; end: Date; dow: number } {
  if (!tz) {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end, dow: toMondayDow(date) };
  }
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (t: string) =>
      parts.find((p) => p.type === t)?.value ?? '0';
    const y = +get('year');
    const m = +get('month');
    const d = +get('day');
    const lh = +get('hour');
    const lm = +get('minute');
    const ls = +get('second');
    const pseudoUtc = Date.UTC(y, m - 1, d, lh, lm, ls);
    const offsetMs = pseudoUtc - date.getTime();
    const startUtc = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs;
    return {
      start: new Date(startUtc),
      end: new Date(startUtc + 86_400_000),
      dow: toMondayDowInTz(date, tz),
    };
  } catch {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end, dow: toMondayDow(date) };
  }
}

/**
 * Monday 00:00:00.000 (as a UTC instant) of the week containing `date`
 * as seen in the user's IANA timezone. For a Bucharest user this is
 * 21:00 UTC the prior Sunday; for a Los Angeles user it's 07:00 UTC
 * Monday.
 */
export function getWeekStartInTz(
  date: Date,
  tz: string | null | undefined,
): Date {
  if (!tz) return getWeekStart(date);
  const today = userLocalDayBoundsUtc(date, tz);
  return new Date(today.start.getTime() - today.dow * 86_400_000);
}
