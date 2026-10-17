const rupee = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const plain = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const whole = new Intl.NumberFormat("en-IN");
const compact = new Intl.NumberFormat("en-IN", { notation: "compact", maximumFractionDigits: 2 });

/** ₹1,23,456.70 */
export const money = (value: number) => rupee.format(value);
/** 1,23,456.70 (prices, where the ₹ sign is noise) */
export const price = (value: number) => plain.format(value);
export const count = (value: number) => whole.format(value);
export const shortNumber = (value: number) => compact.format(value);
/** Rounds to paise so float noise like -0.0000001 doesn't show as "−0.00". */
const cents = (value: number) => Math.round(value * 100) / 100;
export const signed = (value: number, format: (v: number) => string = money) => {
  const rounded = cents(value);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${format(Math.abs(rounded))}`;
};
export const percent = (value: number) => {
  const rounded = cents(value);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded).toFixed(2)}%`;
};
export const tone = (value: number) => {
  const rounded = cents(value);
  return rounded > 0 ? "up" : rounded < 0 ? "down" : "flat";
};
export const num = (value: string | number | null | undefined) => (value === null || value === undefined ? null : Number(value));

const ist = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", ...options });
export const istDateTime = ist({ weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
export const istTime = ist({ hour: "2-digit", minute: "2-digit", hour12: false });
export const istTimeSeconds = ist({ hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export const istDay = ist({ day: "numeric", month: "short" });
export const istDayYear = ist({ day: "numeric", month: "short", year: "2-digit" });
export const istOrderTime = ist({ day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

/** IST calendar date, YYYY-MM-DD. */
export const istDate = (at: Date | string) => new Date(new Date(at).getTime() + 330 * 60_000).toISOString().slice(0, 10);
