// No "use client": the layout (a server component) inlines themeBootScript.
// Two themes only. The choice is saved on this device and stays until the person picks the other one.
export type ThemeChoice = "light" | "dark";
const themeKey = "xocrisk.theme";

export function themeChoice(): ThemeChoice {
  try {
    return localStorage.getItem(themeKey) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(choice: ThemeChoice): void {
  const dark = choice === "dark";
  document.documentElement.dataset.theme = choice;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0b0d12" : "#ffffff");
}

export function saveTheme(choice: ThemeChoice): void {
  try { localStorage.setItem(themeKey, choice); } catch { /* storage blocked */ }
  applyTheme(choice);
}

/** Runs before the page paints (inlined in <head>) so a dark theme never flashes white first, on every page. */
export const themeBootScript = `try{var d=localStorage.getItem("${themeKey}")==="dark";document.documentElement.dataset.theme=d?"dark":"light";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",d?"#0b0d12":"#ffffff")}catch(e){}`;

/** Inlined in <head>: on the login/signup pages, someone already signed in on this device goes straight to the
 * dashboard before anything paints. Google's return (?code=) and provider messages (?oauth=) still load the page. */
export const signedInBootScript = `try{var p=location.pathname.replace(/[/]+$/,"");if((p===""||p==="/login"||p==="/signup")&&localStorage.getItem("xocrisk.signedIn")==="1"&&!/[?&](code|error|error_description|oauth)=/.test(location.search))location.replace("/account/")}catch(e){}`;
