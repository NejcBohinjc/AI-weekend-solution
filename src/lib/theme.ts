// Theme choice: "system" (default, follows the device), "light" or "dark". Stored in a cookie so the
// server renders the right theme; the inline script below resolves "system" before the first paint.

export const THEMES = ["system", "light", "dark"] as const;
export type ThemePref = (typeof THEMES)[number];
export const THEME_COOKIE = "theme";

export function parseTheme(value: string | undefined): ThemePref {
  return (THEMES as readonly string[]).includes(value ?? "") ? (value as ThemePref) : "system";
}

/**
 * Runs in <head> before the page paints: sets <html data-theme> from <html data-theme-pref> (or the
 * cookie), following prefers-color-scheme live for "system". window.__applyTheme re-applies it.
 * A static string with no user data in it.
 */
export const THEME_SCRIPT = `(function(){try{var d=document.documentElement;var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(system|light|dark)/);if(m)d.dataset.themePref=m[1];var q=window.matchMedia("(prefers-color-scheme: dark)");var a=function(){var p=d.dataset.themePref||"system";d.dataset.theme=p==="system"?(q.matches?"dark":"light"):p;};a();if(!window.__applyTheme){q.addEventListener("change",a);}window.__applyTheme=a;}catch(e){}})();`;
