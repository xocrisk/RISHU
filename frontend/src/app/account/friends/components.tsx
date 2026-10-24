"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import type { User } from "./model";

const paths = {
  plus: "M10 3v14M3 10h14", back: "M12 4l-6 6 6 6", chevron: "M7 4l6 6-6 6",
  search: "M14 14l4 4M15 8.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0",
  friend: "M7 10a3.5 3.5 0 100-7 3.5 3.5 0 000 7M1 18c0-4 12-4 12 0M16 6v6M13 9h6",
  group: "M7 9a3 3 0 100-6 3 3 0 000 6M13 4a3 3 0 010 6M1 17c0-5 12-5 12 0M14 13c3 0 5 2 5 4",
  qr: "M3 3h5v5H3zM12 3h5v5h-5zM3 12h5v5H3zM5.5 5.5h0M14.5 5.5h0M5.5 14.5h0M12 12h2v2M17 12v2M12 17h5M15 14.5v.5",
  scan: "M3 7V5a2 2 0 012-2h2M13 3h2a2 2 0 012 2v2M17 13v2a2 2 0 01-2 2h-2M7 17H5a2 2 0 01-2-2v-2M3 10h14",
  invite: "M18 2L9 11M18 2l-6 16-3-7-7-3z",
  copy: "M7 7h10v11H7zM13 7V2H2v11h5",
  check: "M4 10.5l4 4 8-9",
  bell: "M4 14h12l-2-3V7a4 4 0 00-8 0v4zM8 17h4",
  chat: "M2 3h16v11H8l-5 4v-4H2zM6 7h8M6 10h5",
  close: "M4 4l12 12M16 4L4 16",
};
export type IconName = keyof typeof paths;
export function Icon({ name }: { name: IconName }) { return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>; }
export function Avatar({ user }: { user: User }) { return <span className="fg-avatar" aria-hidden="true">{user.avatar || user.nickname.slice(0, 1)}</span>; }
export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="fg-search"><Icon name="search" /><input aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} type="search" /></label>;
}
export function EmptyState({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return <div className="fg-empty"><div className="fg-empty-art" aria-hidden="true"><Icon name="chat" /><span><Icon name="group" /></span></div><h2>{title}</h2>{detail && <p>{detail}</p>}{children}</div>;
}
export function UserRow({ user, children, onClick }: { user: User; children?: ReactNode; onClick?: () => void }) {
  const body = <><Avatar user={user} /><span className="fg-row-copy"><strong>{user.nickname}</strong><small>{user.publicId ?? user.id}</small></span></>;
  return <div className="fg-row">{onClick ? <button type="button" className="fg-user-button" onClick={onClick}>{body}</button> : body}{children}</div>;
}
export function MyQr({ uid }: { uid: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (canvas.current) void QRCode.toCanvas(canvas.current, uid, { width: 248, margin: 4 }).catch(() => { if (active) setError("QR couldn't load. You can still copy your ID."); });
    return () => { active = false; };
  }, [uid]);
  return <div className="fg-myqr"><div className="fg-qr-paper"><canvas ref={canvas} role="img" aria-label={`QR code for user ${uid}`} /></div><code>{uid}</code><p>Let a friend scan this code to add you.</p>{error && <p role="alert">{error}</p>}</div>;
}

/**
 * Mount only after a Scan tap. getUserMedia triggers the browser/native permission prompt.
 * The camera follows the permission: revoking it stops the scanner, granting it again restarts it,
 * and returning to the app after it was backgrounded resumes scanning.
 */
export function QrScanner({ onScan }: { onScan: (uid: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const callback = useRef(onScan);
  useEffect(() => { callback.current = onScan; }, [onScan]);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { active = false; clearTimeout(timer); stream?.getTracks().forEach((track) => track.stop()); };
    const hide = () => { if (document.hidden) stop(); else if (!active) setAttempt((n) => n + 1); };
    document.addEventListener("visibilitychange", hide);
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable. Open the app on HTTPS or use Search User ID.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
        stream.getVideoTracks().forEach((track) => track.addEventListener("ended", () => { if (!active) return; stop(); setError("Camera turned off. Allow camera access, then tap Try again."); }));
        const preview = video.current;
        if (!preview) { stop(); return; }
        preview.srcObject = stream;
        await preview.play();
        setError("");
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Camera preview unavailable.");
        const scan = () => {
          if (!active) return;
          if (preview.videoWidth && preview.readyState >= 2) {
            canvas.width = Math.min(640, preview.videoWidth);
            canvas.height = Math.round(preview.videoHeight * canvas.width / preview.videoWidth);
            context.drawImage(preview, 0, 0, canvas.width, canvas.height);
            const frame = context.getImageData(0, 0, canvas.width, canvas.height);
            const result = jsQR(frame.data, frame.width, frame.height);
            if (result) {
              const uid = result.data.trim().toUpperCase();
              stop();
              if (!/^[A-Z0-9]{6,64}$/.test(uid)) setError("This QR does not contain a user ID. Try a XOCRISK QR.");
              else callback.current(uid);
              return;
            }
          }
          timer = setTimeout(scan, 180);
        };
        scan();
      } catch (cause) {
        if (!active) return;
        stop();
        setError(cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access in your browser or app settings, then try again."
          : cause instanceof DOMException && cause.name === "NotFoundError" ? "No camera found. Use Search User ID to add a friend."
          : cause instanceof Error ? cause.message : "Camera couldn't start. Try again.");
      }
    }
    void start();
    return () => { stop(); document.removeEventListener("visibilitychange", hide); };
  }, [attempt]);
  useEffect(() => {
    let status: PermissionStatus | undefined;
    let disposed = false;
    // Restarting either reopens the camera (granted) or reports the denial (denied).
    const onChange = () => { if (status?.state !== "prompt") setAttempt((n) => n + 1); };
    // Not every WebView supports querying "camera"; the getUserMedia errors still cover those.
    navigator.permissions?.query({ name: "camera" as PermissionName }).then((result) => {
      if (disposed) return;
      status = result;
      status.addEventListener("change", onChange);
    }, () => {});
    return () => { disposed = true; status?.removeEventListener("change", onChange); };
  }, []);
  return <div className="fg-scanner"><div className="fg-camera"><video ref={video} muted playsInline aria-label="QR scanner camera" /><div className="fg-scan-guide" /></div>
    <p>Allow camera access when prompted, then point it at a friend&apos;s QR. A friend request is sent as soon as their ID is found.</p>
    {error && <div role="alert"><p>{error}</p><button className="xq-btn" type="button" onClick={() => { setError(""); setAttempt((n) => n + 1); }}>Try again</button></div>}</div>;
}
