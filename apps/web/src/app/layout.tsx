import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemeScript } from "@/components/theme/theme-script";
import "./globals.css";

/**
 * Geist for the interface, Geist Mono for anything literal.
 *
 * Chosen for the register the product is aiming at: tight apertures and flat
 * terminals read as drawn rather than friendly, which is what lets a near-black
 * ground stay precise instead of going soft.
 */
const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cira",
  description: "Your company's software, in one place.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider afterSignOutUrl="/sign-in">
      <html
        lang="en"
        // The colours are stamped before paint, so nobody sees a light flash on
        // the way to a dark page.
        suppressHydrationWarning
        className={`${geist.variable} ${geistMono.variable}`}
      >
        <head>
          <ThemeScript />
        </head>
        <body className="min-h-dvh antialiased">
          <ThemeProvider>{children}</ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
