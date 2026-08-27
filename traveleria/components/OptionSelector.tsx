import { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import {
  FontFamily,
  FontSize,
  Radius,
  Spacing,
  ThemeColors,
} from "../constants/theme";
import { useThemeColors } from "../contexts/ThemeContext";

export type Option = { value: string; label: string };

type SingleProps = {
  options: readonly Option[];
  /** Currently selected value, or null when nothing is chosen. */
  value: string | null;
  onChange: (value: string) => void;
  /** Tapping the selected chip clears it. Off by default. */
  allowDeselect?: boolean;
};

/**
 * Single-choice chip group — used for gender, where exactly one value applies.
 */
export function OptionSelector({
  options,
  value,
  onChange,
  allowDeselect = false,
}: SingleProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.group}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.chip, selected && styles.chipSelected]}
            onPress={() => {
              if (selected && allowDeselect) onChange("");
              else onChange(opt.value);
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={opt.label}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

type MultiProps = {
  options: readonly Option[];
  values: string[];
  onChange: (values: string[]) => void;
};

/**
 * Multi-choice chip group — used for dietary preferences, where any number
 * of options can apply at once.
 */
export function ChipMultiSelect({ options, values, onChange }: MultiProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const toggle = (value: string) => {
    onChange(
      values.includes(value)
        ? values.filter((v) => v !== value)
        : [...values, value],
    );
  };

  return (
    <View style={styles.group}>
      {options.map((opt) => {
        const selected = values.includes(opt.value);
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.chip, selected && styles.chipSelected]}
            onPress={() => toggle(opt.value)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={opt.label}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    group: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.sm },
    chip: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm + 2,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceSunken,
    },
    chipSelected: {
      backgroundColor: colors.primarySoft,
      borderColor: colors.primary,
    },
    label: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.medium,
      color: colors.textSecondary,
    },
    labelSelected: {
      color: colors.primary,
      fontFamily: FontFamily.semibold,
    },
  });
