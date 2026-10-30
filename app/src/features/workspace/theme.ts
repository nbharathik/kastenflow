// Light, dark, or follow the system. The choice is a
// per-window preference, kept in this browser's storage; the resolved theme
// goes on <html> as `data-theme`, and the desktop window hears it so it
// opens in it next time.

import { invoke } from "@tauri-apps/api/core";

import { inTauri } from "../../lib/api";

export type ThemePref = "system" | "light" | "dark";

const KEY = "kasten.theme";

export function loadTheme(): ThemePref {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  } catch {
    return "system";
  }
}

const systemDark = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export function resolveTheme(pref: ThemePref): "light" | "dark" {
  return pref === "system" ? (systemDark() ? "dark" : "light") : pref;
}

let told: string | undefined;

/** Puts `theme` on the page, and tells the desktop window once it changes,
 * so the window's background matches and its next start opens in it
 * rather than as a flash of the other. */
function show(theme: "light" | "dark"): void {
  document.documentElement.dataset.theme = theme;
  if (theme === told || !inTauri()) return;
  told = theme;
  // Only for the next start's first paint; the theme in use is already applied.
  void invoke("remember_theme", { dark: theme === "dark" }).catch(() => {});
}

/** Applies and remembers `pref`. */
export function applyTheme(pref: ThemePref): void {
  show(resolveTheme(pref));
  try {
    if (pref === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Storage can be off; the theme still applies for this session.
  }
}

/** Follows the system's changes while the preference is `system`. */
export function watchSystemTheme(current: () => ThemePref): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const onChange = () => {
    if (current() === "system") show(resolveTheme("system"));
  };
  query.addEventListener?.("change", onChange);
  return () => query.removeEventListener?.("change", onChange);
}

/** Ctrl+Shift+L flips between light and dark, as in Notion. */
export const flipTheme = (pref: ThemePref): ThemePref => (resolveTheme(pref) === "dark" ? "light" : "dark");

/** Accent colours for buttons, selection and focus (styles.css). */
export const ACCENTS = ["blue", "violet", "green", "orange", "pink", "graphite"] as const;
export type Accent = (typeof ACCENTS)[number];

export function applyAccent(accent: Accent): void {
  if (accent === "blue") delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = accent;
}
