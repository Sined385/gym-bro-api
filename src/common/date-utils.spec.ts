import {
  getWeekStartInTz,
  toMondayDow,
  toMondayDowInTz,
  userLocalDayBoundsUtc,
} from './date-utils';

describe('date-utils tz helpers', () => {
  describe('toMondayDowInTz', () => {
    // 2026-06-06 (Saturday) at 00:30 Europe/Bucharest = 21:30 UTC Friday.
    // The server's plain toMondayDow would say Friday (4); the user
    // experiences it as Saturday (5). This is the exact misalignment
    // that left late-night Coach completions linked to the wrong plan
    // day in prod.
    const lateSaturdayBucharest = new Date('2026-06-05T21:30:00.000Z');

    it('returns the day-of-week as seen in the user tz', () => {
      expect(toMondayDowInTz(lateSaturdayBucharest, 'Europe/Bucharest')).toBe(5);
    });

    it('falls back to server-local when tz is null', () => {
      // The UTC instant maps to Friday in UTC; the fallback path should
      // mirror toMondayDow exactly so this is a regression guard for
      // accounts that never registered a device.
      expect(toMondayDowInTz(lateSaturdayBucharest, null)).toBe(
        toMondayDow(lateSaturdayBucharest),
      );
    });

    it('handles a western tz the other direction', () => {
      // 2026-06-05 (Friday) 23:00 Los Angeles = 2026-06-06 06:00 UTC.
      // Server says Saturday; the LA user is still on Friday.
      const lateFridayLA = new Date('2026-06-06T06:00:00.000Z');
      expect(toMondayDowInTz(lateFridayLA, 'America/Los_Angeles')).toBe(4);
    });
  });

  describe('userLocalDayBoundsUtc', () => {
    it('anchors the day at the user-local midnight in UTC instants', () => {
      // 2026-06-05 22:30 Bucharest → user-local Friday should span
      // [2026-06-04 21:00Z, 2026-06-05 21:00Z).
      const friBucharest = new Date('2026-06-05T19:30:00.000Z');
      const bounds = userLocalDayBoundsUtc(friBucharest, 'Europe/Bucharest');
      expect(bounds.start.toISOString()).toBe('2026-06-04T21:00:00.000Z');
      expect(bounds.end.toISOString()).toBe('2026-06-05T21:00:00.000Z');
      expect(bounds.dow).toBe(4); // Fri = 4 (Mon-based)
    });

    it('keeps an instant within its user-local day', () => {
      // Sat 00:30 Bucharest = Fri 21:30 UTC. Bucharest-anchored Saturday
      // bounds must cover it (start Fri 21:00 UTC, end Sat 21:00 UTC).
      const sat0030Bucharest = new Date('2026-06-05T21:30:00.000Z');
      const bounds = userLocalDayBoundsUtc(
        sat0030Bucharest,
        'Europe/Bucharest',
      );
      expect(bounds.dow).toBe(5);
      expect(bounds.start.getTime()).toBeLessThanOrEqual(
        sat0030Bucharest.getTime(),
      );
      expect(bounds.end.getTime()).toBeGreaterThan(sat0030Bucharest.getTime());
    });
  });

  describe('getWeekStartInTz', () => {
    it('returns the UTC instant for Monday 00:00 in the user tz', () => {
      const sat = new Date('2026-06-06T10:00:00.000Z'); // Sat 13:00 Bucharest
      const monday = getWeekStartInTz(sat, 'Europe/Bucharest');
      // Mon 2026-06-01 00:00 Bucharest = Sun 2026-05-31 21:00 UTC.
      expect(monday.toISOString()).toBe('2026-05-31T21:00:00.000Z');
    });
  });
});
