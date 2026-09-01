import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

import {
  FontFamily,
  FontSize,
  Radius,
  Spacing,
  ThemeColors,
} from "../constants/theme";
import { useThemeColors } from "../contexts/ThemeContext";
import { WALLET_ICON_GROUPS, WalletIcon } from "../constants/walletIcons";
import { readableTextColor } from "../utils/color";

type Props = {
  value: WalletIcon;
  onChange: (icon: WalletIcon) => void;
  /** The card's colour, so the selected chip previews the real pairing. */
  cardColor: string;
};

/**
 * Icon chips, grouped and scrolled horizontally.
 *
 * The selected chip is filled with the card's own colour and its glyph uses
 * the same contrast rule the card does, so the icon is previewed against the
 * background it will actually sit on rather than against the sheet.
 */
export function IconPicker({ value, onChange, cardColor }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const selectedGlyphColor = readableTextColor(cardColor);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Icon</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
      >
        {WALLET_ICON_GROUPS.map((group, groupIndex) => (
          <View key={group.title} style={styles.group}>
            {/* A hairline between groups is enough structure here; labelling
                each one would push the icons off a phone screen. */}
            {groupIndex > 0 && <View style={styles.divider} />}
            <View style={styles.groupIcons}>
              {group.icons.map((icon) => {
                const selected = icon === value;
                return (
                  <TouchableOpacity
                    key={icon}
                    style={[
                      styles.chip,
                      selected && { backgroundColor: cardColor, borderColor: cardColor },
                    ]}
                    onPress={() => onChange(icon)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`${icon} icon`}
                  >
                    <Ionicons
                      name={icon}
                      size={20}
                      color={selected ? selectedGlyphColor : colors.textSecondary}
                    />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
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
    rail: { alignItems: "center", paddingVertical: Spacing.xs },
    group: { flexDirection: "row", alignItems: "center" },
    groupIcons: { flexDirection: "row", gap: Spacing.sm },
    divider: {
      width: StyleSheet.hairlineWidth,
      height: 24,
      backgroundColor: colors.border,
      marginHorizontal: Spacing.md,
    },
    chip: {
      width: 42,
      height: 42,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceSunken,
      alignItems: "center",
      justifyContent: "center",
    },
  });
