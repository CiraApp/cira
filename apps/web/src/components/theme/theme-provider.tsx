"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  accentInk,
  modeFor,
  parseTheme,
  type Mode,
  type Theme,
} from "@/lib/theme";

interface ThemeState {
  /** The chosen colours, or null while the interface is still on Cira's own. */
  theme: Theme | null;
  /** What is actually on screen, Cira's default included. */
  effective: Theme;
  mode: Mode;
  /** Writes the colours to the document immediately, then remembers them. */
  setTheme: (theme: Theme) => void;
  /** Back to Cira's own colours. */
  reset: () => void;
  /** Shows the colours without committing them, for dragging a picker. */
  preview: (theme: Theme | null) => void;
}

const ThemeContext = createContext<ThemeState | null>(null);

export function useTheme(): ThemeState {
  const value = useContext(ThemeContext);
  if (value === null) throw new Error("useTheme used outside ThemeProvider");
  return value;
}

/**
 * The interface's colours, for this person and this browser.
 *
 * There is no light/dark switch: the mode is read off the base colour, so
 * choosing a near-black ground *is* choosing dark. Until someone chooses
 * anything, Cira's own graphite stands - the operating system is not asked.
 *
 * Nothing about this reaches the server. It is a personal preference, stored
 * next to where the light/dark choice used to live, and a browser that refuses
 * storage still gets a working interface - just not a remembered one.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setStored] = useState<Theme | null>(null);
  const [previewed, setPreviewed] = useState<Theme | null>(null);

  // The document already carries the right colours, stamped before paint by
  // the inline script. This only catches up React's copy of that state.
  useEffect(() => {
    setStored(parseTheme(readStorage()));
  }, []);

  const effective = previewed ?? theme ?? DEFAULT_THEME;
  const mode = modeFor(effective.base);

  // The document is the source of truth for what is painted, so every path
  // that changes colours goes through the same three writes.
  useEffect(() => {
    apply(effective);
  }, [effective]);

  const setTheme = useCallback((next: Theme) => {
    setPreviewed(null);
    setStored(next);
    writeStorage(JSON.stringify(next));
  }, []);

  const reset = useCallback(() => {
    setPreviewed(null);
    setStored(null);
    writeStorage(null);
  }, []);

  const value = useMemo<ThemeState>(
    () => ({ theme, effective, mode, setTheme, reset, preview: setPreviewed }),
    [theme, effective, mode, setTheme, reset],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

function apply(theme: Theme): void {
  const root = document.documentElement;
  root.style.setProperty("--user-base", theme.base);
  root.style.setProperty("--user-accent", theme.accent);
  root.style.setProperty("--user-accent-ink", accentInk(theme.accent));
  root.setAttribute("data-theme", modeFor(theme.base));
}

// Private browsing and blocked site data both throw on access rather than
// returning nothing, and neither is a reason for the page to fail.
function readStorage(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, value);
  } catch {
    // Nothing to do: the colours are applied either way, just not remembered.
  }
}
