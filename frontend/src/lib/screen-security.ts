"use client";

import { isNativeApp } from "./auth-session";

type ScreenSecurity = { enable(): Promise<void>; disable(): Promise<void> };
let plugin: Promise<ScreenSecurity> | null = null;

/** In the Android app, blocks screenshots and screen recording (FLAG_SECURE). Browsers can't block them. */
export async function setScreenSecure(secure: boolean): Promise<void> {
  if (!isNativeApp()) return;
  plugin ??= import("@capacitor/core").then(({ registerPlugin }) => registerPlugin<ScreenSecurity>("ScreenSecurity"));
  // Older app builds don't have the native plugin yet; chats still work there.
  await (await plugin)[secure ? "enable" : "disable"]().catch(() => {});
}
