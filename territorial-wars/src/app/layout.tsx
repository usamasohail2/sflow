import type { Metadata, Viewport } from "next";
import { Archivo_Black, DM_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { AuthSessionProvider } from "@/components/AuthSessionProvider";
import { SoundBootstrap } from "@/components/SoundBootstrap";

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const display = Archivo_Black({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

const siteDescription =
  "Draw Islamabad territories. Station villagers. Dig resources.";

export const metadata: Metadata = {
  title: "Islamabad Territorial Wars",
  description: siteDescription,
  applicationName: "Islamabad Territorial Wars",
  openGraph: {
    title: "Islamabad Territorial Wars",
    description: siteDescription,
    type: "website",
    locale: "en_PK",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${sans.variable} ${display.variable} ${mono.variable} bg-[var(--surface)] font-sans text-[var(--ink)] antialiased`}
      >
        <AuthSessionProvider>{children}</AuthSessionProvider>
        <SoundBootstrap />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
