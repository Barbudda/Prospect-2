"use client";

// COLOR THEME PROVIDER
// Manages the accent color independently from the light/dark mode. The five
// supported themes are defined in globals.css as `.theme-violet`,
// `.theme-emerald`, `.theme-azure`, `.theme-amber`, `.theme-rose`. The
// active class is applied to <html> alongside the `.dark` class managed by
// next-themes, so the combined selector `.dark.theme-emerald` works as
// intended.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const COLOR_THEMES = [
  { id: "violet", label: "Violet", hue: 283, sample: "oklch(0.62 0.24 283)" },
  { id: "emerald", label: "Emerald", hue: 160, sample: "oklch(0.62 0.16 160)" },
  { id: "azure", label: "Azure", hue: 240, sample: "oklch(0.62 0.2 240)" },
  { id: "amber", label: "Amber", hue: 70, sample: "oklch(0.7 0.16 70)" },
  { id: "rose", label: "Rose", hue: 10, sample: "oklch(0.65 0.22 10)" },
] as const;

export type ColorThemeId = (typeof COLOR_THEMES)[number]["id"];

const STORAGE_KEY = "prospect-color-theme";
const DEFAULT_THEME: ColorThemeId = "violet";
const ALL_THEME_CLASSES = COLOR_THEMES.map((t) => `theme-${t.id}`);

interface ColorThemeContextValue {
  theme: ColorThemeId;
  setTheme: (theme: ColorThemeId) => void;
}

const ColorThemeContext = createContext<ColorThemeContextValue | null>(null);

export function ColorThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ColorThemeId>(DEFAULT_THEME);

  // Read persisted choice on mount
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY) as ColorThemeId | null;
      if (stored && COLOR_THEMES.some((t) => t.id === stored)) {
        setThemeState(stored);
      }
    } catch {
      // localStorage may be blocked — fall back to default
    }
  }, []);

  // Apply class to <html> whenever the theme changes
  useEffect(() => {
    const root = document.documentElement;
    for (const cls of ALL_THEME_CLASSES) root.classList.remove(cls);
    root.classList.add(`theme-${theme}`);
  }, [theme]);

  function setTheme(next: ColorThemeId) {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore quota / disabled localStorage
    }
  }

  return (
    <ColorThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ColorThemeContext.Provider>
  );
}

export function useColorTheme(): ColorThemeContextValue {
  const ctx = useContext(ColorThemeContext);
  if (!ctx) {
    // Safe no-op fallback for pages rendered outside the provider (e.g. /login)
    return { theme: DEFAULT_THEME, setTheme: () => undefined };
  }
  return ctx;
}
