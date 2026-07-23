import type { Metadata } from "next";
import { DM_Sans, Fraunces, Press_Start_2P } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

const sans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
});

const pixel = Press_Start_2P({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-pixel",
});

const siteDescription =
  "A community map of spots in Islamabad — tap pins for cafés, trails, hangouts, and hidden gems, or add your own.";

export const metadata: Metadata = {
  title: "Islamabad Explore — Community map of spots",
  description: siteDescription,
  openGraph: {
    title: "Islamabad Explore",
    description: siteDescription,
    type: "website",
    locale: "en_PK",
  },
  twitter: {
    card: "summary",
    title: "Islamabad Explore",
    description: siteDescription,
  },
};

const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('islamabad-map-theme');
    var root = document.documentElement;
    if (stored === 'dark') root.classList.add('dark');
    else if (stored === 'dusk') root.classList.add('dusk');
    else if (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.classList.add('dark');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body
        className={`${sans.variable} ${display.variable} ${pixel.variable} bg-[var(--surface)] font-sans text-[var(--ink)] antialiased`}
      >
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
