"use client";

import { ThemeProvider as NextThemes } from "next-themes";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes
      attribute="data-theme"
      defaultTheme="system"
      enableSystem
      // Colour is allowed to ease between the two worlds; the usual advice to
      // kill transitions here exists to stop layout juddering, and nothing in
      // the transition below touches layout.
      disableTransitionOnChange={false}
    >
      {children}
    </NextThemes>
  );
}
