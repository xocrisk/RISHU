"use client";

// App lock for the Android/iOS app: the session stays signed in on the device, and opening the app asks for
// the phone's own unlock (fingerprint, face, PIN, pattern) or an XOCRISK PIN, whichever the user picked.
export type LockMode = "off" | "device" | "pin";

const modeKey = "xocrisk.lock.mode";
const pinKey = "xocrisk.lock.pin";

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage blocked */ }
}

export function lockMode(): LockMode {
  const mode = read(modeKey);
  return mode === "device" || mode === "pin" ? mode : "off";
}

export function clearAppLock(): void {
  write(modeKey, null);
  write(pinKey, null);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function setPinLock(pin: string): Promise<void> {
  const salt = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  write(pinKey, `${salt}:${await sha256(`${salt}:${pin}`)}`);
  write(modeKey, "pin");
}

export async function checkPin(pin: string): Promise<boolean> {
  const [salt, hash] = (read(pinKey) ?? "").split(":");
  if (!salt || !hash) return false;
  return (await sha256(`${salt}:${pin}`)) === hash;
}

/** Whether the phone can verify its owner (biometrics, or at least a screen lock). */
export async function deviceLockAvailable(): Promise<boolean> {
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    const result = await BiometricAuth.checkBiometry();
    return result.isAvailable || result.deviceIsSecure;
  } catch {
    return false;
  }
}

/** Shows the phone's own unlock prompt. Resolves true once the owner is verified. */
export async function unlockWithDevice(reason = "Unlock XOCRISK"): Promise<boolean> {
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    await BiometricAuth.authenticate({
      reason, cancelTitle: "Cancel", allowDeviceCredential: true,
      androidTitle: "Unlock XOCRISK", androidSubtitle: "Use fingerprint, face or your phone's screen lock",
    });
    return true;
  } catch {
    return false;
  }
}

export async function enableDeviceLock(): Promise<boolean> {
  if (!await unlockWithDevice("Turn on app lock")) return false;
  write(pinKey, null);
  write(modeKey, "device");
  return true;
}

export function disableAppLock(): void {
  clearAppLock();
}
