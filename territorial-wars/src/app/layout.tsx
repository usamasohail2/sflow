import type { Metadata } from "next";
import { Archivo_Black, DM_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Analytics } from "@vercel/analytics/react";
import { SpeedInsights } from "@vercel/speed-insights/next";

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
  "Claim sectors. Hold ground. Outplay rivals across Islamabad.";

export const metadata: Metadata = {
  title: "Islamabad Territorial Wars",
  description: siteDescription,
  openGraph: {
    title: "Islamabad Territorial Wars",
    description: siteDescription,
    type: "website",
    locale: "en_PK",
  },
  twitter: {
    card: "summary",
    title: "Islamabad Territorial Wars",
    description: siteDescription,
  },
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
        {children}
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
