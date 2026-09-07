import { Ionicons } from "@expo/vector-icons";
import { useMemo } from "react";
import {
  ActivityIndicator,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewStyle,
} from "react-native";

import {
  FontFamily,
  FontSize,
  Radius,
  Spacing,
  ThemeColors,
} from "../constants/theme";
import { useThemeColors } from "../contexts/ThemeContext";

type Variant = "primary" | "secondary" | "danger" | "ghost";

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  /** Shows a spinner in place of the label and blocks presses. */
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function AppButton({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  icon,
  style,
  accessibilityLabel,
}: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const isInactive = loading || disabled;
  const background = {
    primary: colors.primary,
    secondary: colors.surfaceAlt,
    danger: colors.dangerSoft,
    ghost: "transparent",
  }[variant];
  const foreground = {
    primary: colors.primaryContrast,
    secondary: colors.textSecondary,
    danger: colors.danger,
    ghost: colors.primary,
  }[variant];

  return (
    <TouchableOpacity
      style={[
        styles.base,
        { backgroundColor: background },
        isInactive && styles.inactive,
        style,
      ]}
      onPress={onPress}
      disabled={isInactive}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isInactive, busy: loading }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : (
        <View style={styles.content}>
          {icon && (
            <Ionicons
              name={icon}
              size={18}
              color={foreground}
              style={styles.icon}
            />
          )}
          <Text style={[styles.label, { color: foreground }]}>{label}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    base: {
      paddingVertical: Spacing.lg,
      paddingHorizontal: Spacing.xl,
      borderRadius: Radius.md,
      alignItems: "center",
      justifyContent: "center",
      // Keeps height stable when the label swaps for a spinner.
      minHeight: 52,
    },
    inactive: { opacity: 0.6 },
    content: { flexDirection: "row", alignItems: "center" },
    icon: { marginRight: Spacing.sm },
    label: {
      fontSize: FontSize.body,
      fontFamily: FontFamily.semibold,
    },
  });
