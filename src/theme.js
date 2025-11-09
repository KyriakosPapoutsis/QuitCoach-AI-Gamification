// src/theme.js
/**
 * Module: Theme management
 *
 * Purpose
 * - Defines gradient themes and applies them via CSS variables.
 * - Persists the last selected theme in localStorage.
 * - Restores the theme before React renders to prevent flicker.
 *
 * Exports
 * - applyTheme(key)
 * - getLastTheme()
 * - bootstrapTheme() → apply saved theme immediately.
 *
 * Data
 * - Themes defined in themeMap: { grad, first } color pairings.
 */

const LS_THEME_KEY = "last_theme";

export const themeMap = {
  purple:  { grad: "linear-gradient(90deg,#42275a 0%,#734b6d 100%)", first: "#42275a" },
  deepblue:{ grad: "linear-gradient(90deg,#1e3c72 0%,#2a5298 100%)", first: "#1e3c72" },
  forest:  { grad: "linear-gradient(90deg,#134E5E 0%,#2d793e 100%)", first: "#134E5E" },
  sunset:  { grad: "linear-gradient(90deg,#f12711 0%,#966c13 100%)", first: "#f12711" },
};

export function applyTheme(key = "forest") {
  const t = themeMap[key] || themeMap.forest;
  const root = document.documentElement;
  root.style.setProperty("--hero-grad", t.grad);
  root.style.setProperty("--hero-grad-first", t.first);
  try { localStorage.setItem(LS_THEME_KEY, key); } catch {}
}

export function getLastTheme() {
  try { return localStorage.getItem(LS_THEME_KEY) || "forest"; } catch { return "forest"; }
}

// Call this once before React renders to avoid flicker
export function bootstrapTheme() {
  applyTheme(getLastTheme());
}
