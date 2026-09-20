import type { Metadata } from "next";
import { Bebas_Neue, Manrope, JetBrains_Mono, Newsreader } from "next/font/google";
import { AppShell } from "@/components/brand/AppShell";
import "./globals.css";

const display = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--font-display" });
const body = Manrope({ subsets: ["latin"], variable: "--font-body" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });
const serif = Newsreader({ style: ["italic"], subsets: ["latin"], variable: "--font-serif" });

export const metadata: Metadata = {
  title: "BloomCast — Predictive Algal Bloom Early Warning",
  description:
    "3–7 day cyanobacteria bloom forecasts for urban freshwater — free, predictive, provably accurate.",
  openGraph: {
    title: "BloomCast — See it coming",
    description: "3–7 day cyanobacteria bloom forecasts — free, predictive, provably accurate.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BloomCast",
    description: "Predictive algal bloom early warning for urban freshwater.",
  },
  icons: {
    icon: "/favicon.svg",
    apple: "/apple-touch-icon.svg",
  },
};

export const viewport = {
  themeColor: "#02060f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${display.variable} ${body.variable} ${mono.variable} ${serif.variable} dark`}
    >
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="font-body bg-bg-abyss text-fg-primary antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
