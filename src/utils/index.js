// src/utils/index.js
/**
 * Module: Routing helpers
 *
 * createPageUrl(name)
 * - Returns a simple lowercased path for a given page name, prefixed with "/".
 *   Example: "Dashboard" → "/dashboard", "DailyLog" → "/dailylog".
 */

export const createPageUrl = (name) => `/${name.toLowerCase()}`;
