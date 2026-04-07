/**
 * Returns Monday 00:00:00.000 of the week containing the given date.
 * Week starts on Monday (ISO standard).
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
 */
export function toMondayDow(date?: Date): number {
  const d = date ?? new Date();
  const day = d.getDay();
  return day === 0 ? 6 : day - 1;
}
