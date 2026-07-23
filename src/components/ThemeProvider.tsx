"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
} from "react";

export type Theme = "light" | "dusk" | "dark";

const THEME_ORDER: Theme[] = ["light", "dusk", "dark"];

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  toggleTheme: () => {},
});

const STORAGE_KEY = "islamabad-map-theme";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("dusk", theme === "dusk");
}

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dusk" || value === "dark";
}

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (isTheme(stored)) return stored;
  // Prefer class already set by the blocking layout script (avoids day flash)
  const root = document.documentElement;
  if (root.classList.contains("dusk")) return "dusk";
  if (root.classList.contains("dark")) return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function nextTheme(current: Theme): Theme {
  const i = THEME_ORDER.indexOf(current);
  return THEME_ORDER[(i + 1) % THEME_ORDER.length];
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Read storage/DOM synchronously on the client so the first paint isn't
  // stuck on "light" while a useEffect catches up (map day→dusk flicker).
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useLayoutEffect(() => {
    const initial = getInitialTheme();
    setTheme(initial);
    applyTheme(initial);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = nextTheme(prev);
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
