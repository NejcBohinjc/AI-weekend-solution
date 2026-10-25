// The Global Shapers site's fonts, self-hosted from src/fonts (downloaded from the files the site's own CSS
// points to; Fontshare's free licence allows web use). Clash Display for headings and buttons, Satoshi for
// text, Instrument Serif italic for the one accent word in a heading. font-display: swap, with system
// fallbacks, so text is never invisible while a font loads. They are preloaded only where they are used above
// the fold (Satoshi regular and Clash Display semibold).
import localFont from "next/font/local";

export const clash = localFont({
  src: [
    { path: "../fonts/ClashDisplay-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/ClashDisplay-600.woff2", weight: "600", style: "normal" },
    { path: "../fonts/ClashDisplay-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-clash",
  display: "swap",
  fallback: ["Inter Tight", "system-ui", "sans-serif"],
});

export const satoshi = localFont({
  src: [
    { path: "../fonts/Satoshi-400.woff2", weight: "400", style: "normal" },
    { path: "../fonts/Satoshi-500.woff2", weight: "500", style: "normal" },
    { path: "../fonts/Satoshi-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-satoshi",
  display: "swap",
  fallback: ["system-ui", "sans-serif"],
});

export const instrumentSerif = localFont({
  src: [{ path: "../fonts/InstrumentSerif-Italic.woff2", weight: "400", style: "italic" }],
  variable: "--font-instrument",
  display: "swap",
  preload: false,
  fallback: ["Georgia", "serif"],
});
