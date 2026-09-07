import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme as useSystemColorScheme } from "react-native";

import { ColorScheme, Colors, ThemeColors } from "../constants/theme";

const STORAGE_KEY = "theme_mode";

/** What the user picked. "system" defers to the OS setting. */
export type ThemeMode = "system" | "light" | "dark";

type ThemeCtx = {
  /** The user's preference. */
  mode: ThemeMode;
  /** The scheme actually in effect once "system" is resolved. */
  scheme: ColorScheme;
  /** Palette for the active scheme. */
  colors: ThemeColors;
  isDark: boolean;
  setMode: (mode: ThemeMode) => void;
};

const Context = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Re-renders on its own when the OS theme changes, which is what makes
  // "system" mode track the phone live rather than only at launch.
  const systemScheme = useSystemColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === "light" || saved === "dark" || saved === "system") {
          setModeState(saved);
        }
      })
      .catch(() => {
        // A missing or unreadable preference is not an error; keep "system".
      });
  }, []);

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Persisting is best-effort — the choice still applies this session.
    });
  };

  const value = useMemo<ThemeCtx>(() => {
    const scheme: ColorScheme =
      mode === "system" ? (systemScheme === "dark" ? "dark" : "light") : mode;
    return {
      mode,
      scheme,
      colors: Colors[scheme],
      isDark: scheme === "dark",
      setMode,
    };
  }, [mode, systemScheme]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useTheme() {
  const ctx = useContext(Context);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}

/** Shorthand for the common case of only needing the palette. */
export function useThemeColors() {
  return useTheme().colors;
}
