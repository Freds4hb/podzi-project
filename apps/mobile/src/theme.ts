/**
 * Design tokens for the mobile client.
 *
 * These values are transcribed from `tokens/colors.css` in the repository root,
 * which is the source of truth for the brand palette. React Native cannot read
 * CSS custom properties, so the subset the app uses is mirrored here — in one
 * file, so a palette change is a single edit rather than a hunt through screens.
 *
 * Keep the names aligned with the CSS token names (`--red-500` → `red500`) so the
 * correspondence stays obvious when comparing web and mobile.
 */
export const theme = {
  /** --red-500 · PRIMARY, Podzi Red */
  red500: "#E5322B",
  /** --red-600 · deep, pressed state */
  red600: "#C8241D",
  /** --ink-900 · near-black, dark surfaces */
  ink900: "#16181D",
  /** --ink-700 · body text */
  ink700: "#2A2F3A",
  /** --slate-500 · muted text */
  slate500: "#5B6373",
  /** --slate-200 · borders */
  slate200: "#CDD2DB",
  /** --slate-50 · quiet fills */
  slate50: "#F2F4F7",
  /** --paper · warm off-white page background */
  paper: "#FAF9F7",
  white: "#FFFFFF",
} as const;

export type Theme = typeof theme;
