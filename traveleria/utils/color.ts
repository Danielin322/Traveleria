/**
 * Colour maths for the wallet card palette.
 *
 * Wallet cards can be any of ~300 colours, and their title and icons sit
 * directly on that colour. White text was safe while the palette was six dark
 * swatches; it is not safe now. `readableTextColor` is what keeps every card
 * legible, and it is the reason this file exists.
 */

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

const toHex = (n: number) =>
  clamp(Math.round(n * 255), 0, 255)
    .toString(16)
    .padStart(2, "0");

/**
 * HSL to "#rrggbb".
 * `h` in degrees (0–360), `s` and `l` as percentages (0–100).
 */
export function hslToHex(h: number, s: number, l: number): string {
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;

  // Chroma, then the intermediate component, then the lightness offset.
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = light - c / 2;

  const [r, g, b] =
    hp < 1 ? [c, x, 0] :
    hp < 2 ? [x, c, 0] :
    hp < 3 ? [0, c, x] :
    hp < 4 ? [0, x, c] :
    hp < 5 ? [x, 0, c] :
             [c, 0, x];

  return `#${toHex(r + m)}${toHex(g + m)}${toHex(b + m)}`;
}

/** "#rrggbb" to {r,g,b} in 0–255. Returns null when the string is malformed. */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

/**
 * Relative luminance, per WCAG 2.1.
 *
 * The channel weights are not arbitrary: the eye is far more sensitive to
 * green than to blue, so a saturated blue is much darker to us than its raw
 * numbers suggest. Averaging the channels instead would put white text on
 * colours it cannot be read on.
 */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;

  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };

  return (
    0.2126 * channel(rgb.r) +
    0.7152 * channel(rgb.g) +
    0.0722 * channel(rgb.b)
  );
}

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black/white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Near-black rather than pure black: easier to read on bright yellows and
 *  cyans, and it matches how the rest of the app renders primary text. */
const INK = "#111111";
const PAPER = "#ffffff";

/**
 * Whichever of white or near-black is more readable on `background`.
 *
 * Compares actual contrast ratios rather than testing luminance against a
 * fixed threshold, so the answer stays right at the awkward middle of the
 * range where a threshold would flip on the wrong side.
 */
export function readableTextColor(background: string): string {
  if (!hexToRgb(background)) return PAPER;
  return contrastRatio(background, INK) >= contrastRatio(background, PAPER)
    ? INK
    : PAPER;
}

/** A translucent version of the readable colour, for secondary card text. */
export function readableMutedColor(background: string): string {
  return readableTextColor(background) === INK
    ? "rgba(17,17,17,0.6)"
    : "rgba(255,255,255,0.7)";
}
