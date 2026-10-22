import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const scryptKeyLength = 64;
const dummyPasswordSalt = Buffer.alloc(16, 1);

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function isAdultOn(dateOfBirth: string, today = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return false;
  const birth = new Date(`${dateOfBirth}T00:00:00.000Z`);
  if (Number.isNaN(birth.valueOf()) || birth.toISOString().slice(0, 10) !== dateOfBirth) {
    return false;
  }

  const cutoff = new Date(Date.UTC(today.getUTCFullYear() - 18, today.getUTCMonth(), today.getUTCDate()));
  return birth <= cutoff;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, scryptKeyLength)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash?: string | null): Promise<boolean> {
  const [saltHex, hashHex] = storedHash?.split(":") ?? [];
  const salt = saltHex && /^[0-9a-f]{32}$/i.test(saltHex)
    ? Buffer.from(saltHex, "hex")
    : dummyPasswordSalt;
  const expected = hashHex && /^[0-9a-f]{128}$/i.test(hashHex)
    ? Buffer.from(hashHex, "hex")
    : Buffer.alloc(scryptKeyLength);
  const actual = (await scrypt(password, salt, scryptKeyLength)) as Buffer;
  const matches = timingSafeEqual(actual, expected);
  return Boolean(storedHash && matches);
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function hashRateLimitSubject(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function createOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtp(code: string, secret: string): string {
  return createHmac("sha256", secret).update(code).digest("hex");
}

export function matchesHash(actualHex: string, expectedHex: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(actualHex) || !/^[0-9a-f]{64}$/i.test(expectedHex)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(actualHex, "hex"), Buffer.from(expectedHex, "hex"));
}
