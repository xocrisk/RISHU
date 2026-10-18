import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import "./auth.css";
import { signedInBootScript } from "../lib/boot-script";
import NativeDeepLinks from "./native-deep-links";
import ServiceWorkerRegistration from "./service-worker-registration";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const schibsted = Schibsted_Grotesk({
  variable: "--font-schibsted",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "XOCRISK | Practice Trading",
  description: "A practice account for learning market mechanics without real money.",
  manifest: "/manifest.json",
  icons: {
    icon: "/icon.svg",
    apple: "/apple-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "XOCRISK",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

// The mobile app (static export) feels native: no pinch or double-tap zoom of the whole page. The stock chart
// still zooms, since it handles touch gestures itself. The website stays zoomable for readability.
const isAppBuild = process.env.XOCRISK_STATIC_EXPORT === "1";

export const viewport: Viewport = {
  themeColor: "#111111",
  width: "device-width",
  initialScale: 1,
  ...(isAppBuild ? { maximumScale: 1, minimumScale: 1, userScalable: false } : {}),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${schibsted.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: signedInBootScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegistration />
        <NativeDeepLinks />
      </body>
    </html>
  );
}
