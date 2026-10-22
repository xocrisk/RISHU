// NSE equity market hours: 09:15 to 15:30 IST, Monday to Friday, except exchange holidays.
// IST has no daylight saving, so a fixed +05:30 offset is exact.

const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
export const openMinute = 9 * 60 + 15;
export const closeMinute = 15 * 60 + 30;

// NSE equity segment trading holidays that fall on weekdays.
// Add next year's list when NSE publishes its holiday circular (usually in December).
export const nseHolidays: Record<string, string> = {
  "2026-01-15": "Municipal Corporation Elections (Maharashtra)",
  "2026-01-26": "Republic Day",
  "2026-03-03": "Holi",
  "2026-03-26": "Shri Ram Navami",
  "2026-03-31": "Shri Mahavir Jayanti",
  "2026-04-03": "Good Friday",
  "2026-04-14": "Dr. Baba Saheb Ambedkar Jayanti",
  "2026-05-01": "Maharashtra Day",
  "2026-05-28": "Bakri Id",
  "2026-06-26": "Muharram",
  "2026-09-14": "Ganesh Chaturthi",
  "2026-10-02": "Mahatma Gandhi Jayanti",
  "2026-10-20": "Dussehra",
  "2026-11-10": "Diwali Balipratipada",
  "2026-11-24": "Guru Nanak Jayanti",
  "2026-12-25": "Christmas",
};

export type MarketStatus = {
  isOpen: boolean;
  /** Why the market is closed, e.g. "Weekend" or a holiday name; null while open. */
  reason: string | null;
  /** When the current session closes (while open) or the next session opens (while closed). */
  nextChangeAt: Date;
};

/** IST calendar date (YYYY-MM-DD) for an instant. */
export function istDate(at: Date): string {
  return new Date(at.getTime() + istOffsetMs).toISOString().slice(0, 10);
}

function istMinute(at: Date): number {
  const shifted = new Date(at.getTime() + istOffsetMs);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** The instant at the given IST date and minute of day. */
function atIst(date: string, minute: number): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) + minute * 60_000 - istOffsetMs);
}

export function isTradingDay(date: string): boolean {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !(date in nseHolidays);
}

function closedReason(date: string, minute: number): string {
  if (date in nseHolidays) return `NSE holiday: ${nseHolidays[date]}`;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return "Weekend";
  return minute < openMinute ? "Before market hours" : "After market hours";
}

export function marketStatus(now: Date): MarketStatus {
  const today = istDate(now);
  const minute = istMinute(now);
  if (isTradingDay(today) && minute >= openMinute && minute < closeMinute) {
    return { isOpen: true, reason: null, nextChangeAt: atIst(today, closeMinute) };
  }
  let next = isTradingDay(today) && minute < openMinute ? today : addDays(today, 1);
  while (!isTradingDay(next)) next = addDays(next, 1);
  return { isOpen: false, reason: closedReason(today, minute), nextChangeAt: atIst(next, openMinute) };
}

/** The close time of the most recent session that has already ended. */
export function lastSessionClose(now: Date): Date {
  let date = istDate(now);
  if (!isTradingDay(date) || istMinute(now) < closeMinute) date = addDays(date, -1);
  while (!isTradingDay(date)) date = addDays(date, -1);
  return atIst(date, closeMinute);
}
