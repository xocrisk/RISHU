export type { ScanMode, ScanSetup, ScanRequest, ScanStock, MarketScan } from "./market-scan.js";

export type Paise = number & { readonly __brand: "Paise" };

export const STARTING_PRACTICE_BALANCE_PAISE = 10_000_000 as Paise;

export function normalizeIndianMobile(value: string): string | null {
  let normalized = value.trim().replace(/[\s-]/g, "");

  if (normalized.startsWith("+91")) {
    normalized = normalized.slice(3);
  } else if (normalized.startsWith("0")) {
    normalized = normalized.slice(1);
  }

  return /^[6-9]\d{9}$/.test(normalized) ? normalized : null;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function normalizeLoginIdentifier(value: string): string | null {
  const trimmed = value.trim();

  if (trimmed.includes("@")) {
    return isValidEmail(trimmed) ? trimmed.toLowerCase() : null;
  }

  return normalizeIndianMobile(trimmed);
}

export function parseRupees(value: string): Paise {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());

  if (!match) {
    throw new RangeError("Amount must have at most two decimal places");
  }

  const wholeRupees = Number(match[2]);
  const fractionalPaise = Number((match[3] ?? "").padEnd(2, "0"));
  const magnitude = wholeRupees * 100 + fractionalPaise;
  const amount = match[1] === "-" ? -magnitude : magnitude;

  if (!Number.isSafeInteger(amount)) {
    throw new RangeError("Amount is outside the safe integer range");
  }

  return amount as Paise;
}
