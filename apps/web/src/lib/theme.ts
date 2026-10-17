// No "use client": the layout (a server component) inlines themeBootScript.
export type ThemeChoice = "light" | "dark" | "system";
const themeKey = "xocrisk.theme";

export function themeChoice(): ThemeChoice {
  try {
    const value = localStorage.getItem(themeKey);
    return value === "dark" || value === "system" ? value : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b0d12" : "#ffffff");
}

export function saveTheme(choice: ThemeChoice): void {
  try { localStorage.setItem(themeKey, choice); } catch { /* storage blocked */ }
  applyTheme(choice);
}

/** Runs before the page paints (inlined in <head>) so a dark theme never flashes white first. */
export const themeBootScript = `try{var t=localStorage.getItem("${themeKey}");var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}`;
