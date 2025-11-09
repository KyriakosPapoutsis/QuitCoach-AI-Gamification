// src/utils/formatters.js
/**
 * Module: Lightweight formatting helpers
 *
 * formatRegained(hours)
 * - Converts a duration expressed in hours into a compact human-readable string:
 *   "<h>h" for < 48h, "<d>d" up to ~2 months (1 decimal under 10d), then "<y>y"
 *   (1 decimal under 10y). Input is coerced to Number; invalid → 0.
 */

export function formatRegained(hours) {
  const h = Number(hours) || 0;
  if (h < 48) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 60) return `${d.toFixed(d < 10 ? 1 : 0)}d`;
  const y = d / 365;
  return `${y.toFixed(y < 10 ? 1 : 0)}y`;
}
