"use client";

import { Geist, Geist_Mono } from "next/font/google";
import { ErrorScreen } from "@/components/error-screen";
import { ThemeScript } from "@/components/theme/theme-script";
import "./globals.css";

/**
 * When the root layout itself fails, this replaces it, so it brings its own
 * document, fonts and colours - the same ones the layout would have.
 */
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export default function GlobalError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geist.variable} ${geistMono.variable}`}
    >
      <head>
        <title>Something went wrong · Cira</title>
        <ThemeScript />
      </head>
      <body className="min-h-dvh antialiased">
        <ErrorScreen {...props} />
      </body>
    </html>
  );
}
