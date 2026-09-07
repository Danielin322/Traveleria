import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import {
  FontFamily,
  FontSize,
  Radius,
  Spacing,
  ThemeColors,
} from "../constants/theme";
import { useThemeColors } from "../contexts/ThemeContext";
import { hslToHex } from "../utils/color";

/**
 * Two rails: pick a hue, then a shade of it.
 *
 * 24 hues x 12 shades is 288 colours reachable in two taps, without the
 * gradient-wheel dependency a continuous picker would need. The shade grid is
 * computed only for the selected hue, so nothing renders 288 views at once.
 */

const HUE_STEPS = 24;
const HUES = Array.from({ length: HUE_STEPS }, (_, i) => (i * 360) / HUE_STEPS);

// These exact values are what the contrast of the palette was verified
// against: every colour they produce clears WCAG AA for large text against
// whichever of black or white readableTextColor picks. Widening the lightness
// range past this is what would start producing unreadable cards.
const SATURATIONS = [45, 70, 95];
const LIGHTNESSES = [25, 40, 55, 70];

/** Greys get their own swatch, since HSL hue is meaningless at zero saturation. */
const NEUTRALS = [
  "#000000", "#1c1c1e", "#3a3a3c", "#636366",
  "#8e8e93", "#aeaeb2", "#d1d1d6", "#ffffff",
];

const shadesFor = (hue: number) =>
  SATURATIONS.flatMap((s) => LIGHTNESSES.map((l) => hslToHex(hue, s, l)));

/** Which hue rail entry a hex belongs to, so reopening lands on it. */
function nearestHue(hex: string): number | "neutral" {
  if (NEUTRALS.includes(hex.toLowerCase())) return "neutral";
  const match = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!match) return HUES[0];

  const [r, g, b] = match.slice(1).map((v) => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return "neutral";

  const d = max - min;
  let h =
    max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;

  // Snap to the closest rail entry.
  return HUES.reduce((best, candidate) =>
    Math.abs(candidate - h) < Math.abs(best - h) ? candidate : best,
  );
}

type Props = {
  value: string;
  onChange: (hex: string) => void;
};

export function ColorPalettePicker({ value, onChange }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Seeded from the current colour so reopening the sheet lands on its hue
  // rather than resetting to red.
  const [hue, setHue] = useState<number | "neutral">(() => nearestHue(value));

  const shades = useMemo(
    () => (hue === "neutral" ? NEUTRALS : shadesFor(hue)),
    [hue],
  );

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Colour</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.hueRail}
      >
        {HUES.map((h) => (
          <TouchableOpacity
            key={h}
            style={[
              styles.hueSwatch,
              { backgroundColor: hslToHex(h, 85, 50) },
              hue === h && styles.railSelected,
            ]}
            onPress={() => setHue(h)}
            accessibilityRole="radio"
            accessibilityState={{ selected: hue === h }}
            accessibilityLabel={`Hue ${Math.round(h)} degrees`}
          />
        ))}
        <TouchableOpacity
          style={[
            styles.hueSwatch,
            styles.neutralSwatch,
            hue === "neutral" && styles.railSelected,
          ]}
          onPress={() => setHue("neutral")}
          accessibilityRole="radio"
          accessibilityState={{ selected: hue === "neutral" }}
          accessibilityLabel="Greys"
        >
          <View style={styles.neutralHalf} />
        </TouchableOpacity>
      </ScrollView>

      <View style={styles.shadeGrid}>
        {shades.map((hex) => (
          <TouchableOpacity
            key={hex}
            style={[
              styles.shadeSwatch,
              { backgroundColor: hex },
              value.toLowerCase() === hex.toLowerCase() && styles.shadeSelected,
            ]}
            onPress={() => onChange(hex)}
            accessibilityRole="radio"
            accessibilityState={{ selected: value.toLowerCase() === hex.toLowerCase() }}
            accessibilityLabel={`Colour ${hex}`}
          />
        ))}
      </View>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { width: "100%", marginBottom: Spacing.xl },
    label: {
      color: colors.textPrimary,
      alignSelf: "flex-start",
      marginBottom: Spacing.md,
      fontSize: FontSize.body,
      fontFamily: FontFamily.medium,
    },
    hueRail: { gap: Spacing.sm, paddingVertical: Spacing.xs },
    hueSwatch: {
      width: 30,
      height: 30,
      borderRadius: 15,
      borderWidth: 2,
      borderColor: "transparent",
    },
    // Half black, half white, so the greys rail is recognisable at a glance.
    neutralSwatch: { backgroundColor: "#ffffff", overflow: "hidden" },
    neutralHalf: {
      position: "absolute",
      left: 0,
      top: 0,
      bottom: 0,
      width: "50%",
      backgroundColor: "#000000",
    },
    // The ring follows the theme so it stays visible on both light and dark
    // sheets, and against any swatch colour underneath it.
    railSelected: { borderColor: colors.textPrimary },
    shadeGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: Spacing.sm,
      marginTop: Spacing.lg,
    },
    shadeSwatch: {
      width: 46,
      height: 34,
      borderRadius: Radius.sm,
      borderWidth: 2,
      borderColor: "transparent",
    },
    shadeSelected: { borderColor: colors.textPrimary },
  });
