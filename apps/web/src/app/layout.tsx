import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Schibsted_Grotesk } from "next/font/google";
import "./globals.css";
import "./auth.css";
import { signedInBootScript, themeBootScript } from "../lib/theme";
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
    apple: "/icon-192.png",
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

export const viewport: Viewport = {
  themeColor: "#111111",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${schibsted.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: signedInBootScript + themeBootScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegistration />
        <NativeDeepLinks />
      </body>
    </html>
  );
}
