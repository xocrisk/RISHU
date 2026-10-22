"use client";

import { useEffect } from "react";
import { isNativeApp } from "../lib/auth-session";

const ssoLink = /^com\.xocrisk\.app:\/\/sso-callback\/?(\?.*)?$/;

/** In the Android/iOS app: when Google sign-in reopens the app (com.xocrisk.app://sso-callback?code=…),
 * close the browser and finish signing in on /sso-callback/. Does nothing on the website. */
export default function NativeDeepLinks() {
  useEffect(() => {
    if (!isNativeApp()) return;
    let remove: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const [{ App }, { Browser }] = await Promise.all([import("@capacitor/app"), import("@capacitor/browser")]);
      const open = (url: string | undefined) => {
        const match = url ? ssoLink.exec(url) : null;
        if (!match) return;
        // Each link carries a one-time code; never replay one (the launch URL stays set for the app's lifetime).
        try {
          if (sessionStorage.getItem("xocrisk.lastSsoLink") === url) return;
          sessionStorage.setItem("xocrisk.lastSsoLink", url!);
        } catch { /* storage blocked */ }
        void Browser.close().catch(() => undefined); // iOS only; on Android the app simply comes to the front
        window.location.replace(`/sso-callback/${match[1] ?? ""}`);
      };
      const handle = await App.addListener("appUrlOpen", ({ url }) => open(url));
      if (cancelled) { void handle.remove(); return; }
      remove = () => void handle.remove();
      // Android may have closed the app while the browser was open; then the link is the launch URL instead.
      if (!window.location.pathname.startsWith("/sso-callback")) open((await App.getLaunchUrl())?.url);
    })();
    return () => { cancelled = true; remove?.(); };
  }, []);
  return null;
}
