/**
 * Design tokens for Traveleria.
 *
 * Every colour, spacing, radius and type size in the app should come from
 * here rather than being written inline, so that:
 *   - light and dark mode stay in sync by construction, and
 *   - the palette stays consistent (before this file existed the app used
 *     five different "primary" blues and four different reds).
 *
 * `Colors.light` and `Colors.dark` MUST keep identical key sets —
 * `hooks/use-theme-color.ts` types its argument as the intersection of both.
 */

/** Brand blue. The one canonical primary; everything else was drift. */
const BRAND = "#2f6deb";
/** Lighter blue for dark mode — BRAND is too dim against a dark surface. */
const BRAND_DARK_MODE = "#6b9bff";

/**
 * Violet marks a trip that is shared with someone else.
 *
 * It has to be a colour of its own rather than a reuse. Green, orange and red
 * already mean ongoing, warning and danger, and being shared is not a status.
 * Blue is worse: `tripCardSelected` uses `primarySoft` as its background, and
 * `surfaceAlt` happens to be that same #eef2ff in light mode, so any blue tint
 * would make every shared card read as permanently selected. Violet is the
 * nearest hue to the brand that is unmistakably not it.
 */
const SHARED = "#6b4ee6";
const SHARED_DARK_MODE = "#a78bfa";

export const Colors = {
  light: {
    // Surfaces
    background: "#f4f6f8",
    surface: "#ffffff",
    surfaceAlt: "#eef2ff",
    surfaceSunken: "#f0f2f5",

    // Text
    textPrimary: "#1a1a1a",
    textSecondary: "#666666",
    textMuted: "#8a97a5",
    textDisabled: "#aab4bf",

    // Brand & status
    primary: BRAND,
    primaryContrast: "#ffffff",
    primarySoft: "#eef2ff",
    danger: "#e53935",
    dangerSoft: "rgba(229, 57, 53, 0.10)",
    success: "#1a9e5c",
    successSoft: "#e6f7ed",
    warning: "#ff9500",

    // Co-edited trips: accent bar and chip, card tint, and the text that sits
    // on the solid accent.
    shared: SHARED,
    sharedSoft: "#f3f0fe",
    sharedContrast: "#ffffff",

    // Lines & scrims
    border: "#e0e0e0",
    borderStrong: "#d1d1d6",
    overlay: "rgba(0, 0, 0, 0.5)",

    // Keys required by the Expo template components (themed-text, themed-view,
    // collapsible, parallax-scroll-view). Kept as aliases so those keep working.
    text: "#1a1a1a",
    icon: "#687076",
    tint: BRAND,
    tabIconDefault: "#687076",
    tabIconSelected: BRAND,
  },

  dark: {
    // Surfaces. In dark mode elevation is expressed by getting *lighter*,
    // not by casting shadows, so these step up in luminance.
    background: "#0f1316",
    surface: "#1a1f24",
    surfaceAlt: "#232b33",
    surfaceSunken: "#141a1f",

    // Text
    textPrimary: "#ecedee",
    textSecondary: "#9ba1a6",
    textMuted: "#767d84",
    textDisabled: "#5a6169",

    // Brand & status
    primary: BRAND_DARK_MODE,
    primaryContrast: "#0f1316",
    primarySoft: "#1e2a42",
    danger: "#ff6b66",
    dangerSoft: "rgba(255, 107, 102, 0.15)",
    success: "#3ddc84",
    successSoft: "#12301f",
    warning: "#ffab2e",

    // #241f36 sits just above `surface` in luminance, so the card reads as
    // tinted without glowing. The accent bar carries the identity here, where
    // the tint alone is deliberately subtle.
    shared: SHARED_DARK_MODE,
    sharedSoft: "#241f36",
    sharedContrast: "#0f1316",

    // Lines & scrims
    border: "#2d353d",
    borderStrong: "#3a444d",
    overlay: "rgba(0, 0, 0, 0.7)",

    // Expo template aliases
    text: "#ecedee",
    icon: "#9ba1a6",
    tint: BRAND_DARK_MODE,
    tabIconDefault: "#9ba1a6",
    tabIconSelected: BRAND_DARK_MODE,
  },
} as const;

export type ColorScheme = keyof typeof Colors;

/**
 * Same keys as a palette, but values widened to `string`. Needed because
 * `as const` gives each colour a literal type, which would otherwise make
 * the dark palette unassignable to the light one.
 */
export type ThemeColors = { [K in keyof typeof Colors.light]: string };

/** 4pt spacing scale. Replaces the 10 ad-hoc padding values used before. */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

/** Corner radii. Replaces 13 ad-hoc values. */
export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

/** Type scale. Sizes pair with the weights below. */
export const FontSize = {
  display: 34,
  h1: 28,
  h2: 22,
  h3: 18,
  body: 16,
  small: 14,
  caption: 12,
  tiny: 11,
} as const;

/**
 * Inter, loaded in app/_layout.tsx. Always reference these constants rather
 * than writing fontWeight, because on Android a weight alone will not pick
 * the right Inter file — the family name has to carry it.
 */
export const FontFamily = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

/**
 * Shadows. Only meaningful in light mode — in dark mode a shadow against a
 * dark background is invisible, so screens should lean on `surfaceAlt`
 * instead of elevation to express depth.
 */
export const Elevation = {
  sm: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  md: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 4,
  },
  lg: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
} as const;
