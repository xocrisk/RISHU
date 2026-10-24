"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import type { Dashboard } from "./types";
import "./invite-friends.css";

export function InviteFriends({ user, referralBonus, onBack, notify }: {
  user: Dashboard["user"]; referralBonus: number; onBack: () => void;
  notify: (kind: "ok" | "error", text: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [friendUid, setFriendUid] = useState("");
  const [qrReady, setQrReady] = useState(false);

  useEffect(() => {
    let active = true;
    if (canvas.current && user.uid) {
      QRCode.toCanvas(canvas.current, user.uid, { width: 240, margin: 4, errorCorrectionLevel: "M" })
        .then(() => { if (active) setQrReady(true); })
        .catch(() => { if (active) setError("Your QR code couldn't load. You can still copy your UID."); });
    }
    return () => { active = false; };
  }, [user.uid]);

  useEffect(() => {
    if (!scanning) return;
    let active = true;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = document.createElement("canvas");
    const context = frame.getContext("2d", { willReadFrequently: true });
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!active) { stream.getTracks().forEach((track) => track.stop()); return; }
        const preview = video.current;
        if (!preview || !context) throw new Error("unsupported");
        preview.srcObject = stream;
        await preview.play();
        function scan() {
          if (!active || !preview || !context) return;
          if (preview.readyState >= 2 && preview.videoWidth) {
            frame.width = Math.min(preview.videoWidth, 640);
            frame.height = Math.round(preview.videoHeight * frame.width / preview.videoWidth);
            context.drawImage(preview, 0, 0, frame.width, frame.height);
            const pixels = context.getImageData(0, 0, frame.width, frame.height);
            const result = jsQR(pixels.data, pixels.width, pixels.height);
            if (result) {
              const uid = result.data.trim();
              if (!/^[A-Z0-9]{6,64}$/.test(uid)) setError("This isn't a XOCRISK UID QR. Scan a friend's code from Invite friends.");
              else if (uid === user.uid) setError("That's your own UID. Scan a friend's QR code.");
              else { setFriendUid(uid); setError(""); }
              setScanning(false);
              return;
            }
          }
          timer = setTimeout(scan, 180);
        }
        scan();
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Camera access was denied. Allow camera access in settings, then try again."
          : "Camera couldn't open. Check camera permissions and try again.");
        setScanning(false);
      }
    }
    void start();
    const onVisibility = () => { if (document.hidden) setScanning(false); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      clearTimeout(timer);
      stream?.getTracks().forEach((track) => track.stop());
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [scanning, user.uid]);

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); notify("ok", "UID copied."); }
    catch { setError("Couldn't copy. Press and hold the UID to copy it manually."); }
  }

  async function share() {
    const text = `Join me on XOCRISK! Enter ${user.uid} in the optional Inviter UID field when creating your account. I'll receive ₹1,000 virtual cash for your first signup. Your account starts with ₹1,00,000 practice money.`;
    try {
      if (navigator.share) await navigator.share({ title: "Join me on XOCRISK", text });
      else { await navigator.clipboard.writeText(text); notify("ok", "Invite copied. Share it with a friend."); }
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) setError("Couldn't share your invite. Try copying your UID.");
    }
  }

  return <div className="xq-page narrow xq-invite">
    <button className="xq-btn" type="button" onClick={onBack}>← Back to profile</button>
    <header><span className="xq-invite-eyebrow">BETTER WITH FRIENDS</span><h1>Invite friends. Earn ₹1,000.</h1><p>Get ₹1,000 virtual cash when a new friend signs up using your UID. Ask them to enter it in the Inviter UID field during signup. Each new account earns you one reward; sharing, scanning or logging in again does not.</p></header>
    <section className="xq-invite-card" aria-label="Your trader identity">
      <p>Invite rewards earned: <strong>₹{referralBonus.toLocaleString("en-IN")}</strong> · {Math.floor(referralBonus / 1000)} successful invites</p>
      <span className="xq-invite-avatar" aria-hidden="true">{(user.fullName || "X").slice(0, 1).toUpperCase()}</span>
      <h2>{user.fullName || "XOCRISK trader"}</h2>
      <p>Your unique XOCRISK UID</p>
      <code className="xq-invite-uid">{user.uid || "UID unavailable"}</code>
      <button className="xq-btn" disabled={!user.uid} onClick={() => void copy(user.uid)} type="button">Copy UID</button>
      <div className="xq-invite-qr"><canvas ref={canvas} role="img" aria-label={`QR code for XOCRISK UID ${user.uid}`} />{!qrReady && <small>Preparing your QR…</small>}</div>
      <p>Scan this QR to get my UID</p>
      <button className="xq-btn primary" disabled={!user.uid} onClick={() => void share()} type="button">Share invite</button>
    </section>
    <section className="xq-invite-scan">
      <div><h2>Have a friend&apos;s QR?</h2><p>Scan their code to see and copy their UID.</p></div>
      <button className="xq-btn" onClick={() => { setError(""); setFriendUid(""); setScanning(!scanning); }} type="button">{scanning ? "Stop scanning" : "Scan QR"}</button>
      {scanning && <div className="xq-invite-camera"><video ref={video} muted playsInline aria-label="QR scanner camera preview" /><p role="status">Point your camera at a friend&apos;s XOCRISK QR</p></div>}
      {friendUid && <div className="xq-invite-result" role="status"><span>Scanned UID</span><code className="xq-invite-uid">{friendUid}</code><small>UID read from QR. Account ownership has not been verified.</small><button className="xq-btn" type="button" onClick={() => void copy(friendUid)}>Copy friend&apos;s UID</button></div>}
    </section>
    {error && <p className="xt-order-error" role="alert">{error}</p>}
  </div>;
}
