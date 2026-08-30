import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

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

type MultiWithOtherProps = MultiProps & {
  /** Presets. Anything selected that is not here is a custom entry. */
  options: readonly Option[];
  /** How a custom value is shown; defaults to the value itself. */
  labelOf?: (value: string) => string;
  isCustom: (value: string) => boolean;
  maxCount: number;
  maxLength: number;
  placeholder?: string;
};

/**
 * Multi-choice chips over a list that the user can extend.
 *
 * Presets toggle like any chip group; custom entries sit after them with a
 * remove affordance, because there is no chip to toggle them back on once
 * they are gone. Duplicates are rejected case-insensitively so "Hiking" and
 * "hiking" cannot both end up in the list.
 */
export function ChipMultiSelectWithOther({
  options,
  values,
  onChange,
  labelOf = (v) => v,
  isCustom,
  maxCount,
  maxLength,
  placeholder = "Add your own",
}: MultiWithOtherProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const custom = values.filter(isCustom);
  const isFull = values.length >= maxCount;

  const toggle = (value: string) => {
    if (values.includes(value)) {
      onChange(values.filter((v) => v !== value));
      return;
    }
    if (isFull) {
      setError(`You can pick up to ${maxCount}.`);
      return;
    }
    onChange([...values, value]);
  };

  const addCustom = () => {
    const value = draft.trim();
    if (!value) return;

    if (value.length > maxLength) {
      setError(`Keep it to ${maxLength} characters or fewer.`);
      return;
    }
    // Compare against labels as well as values, so typing "Museums" when the
    // preset chip is already there is caught rather than duplicated.
    const taken = values.some(
      (v) => v.toLowerCase() === value.toLowerCase() ||
        labelOf(v).toLowerCase() === value.toLowerCase(),
    );
    if (taken) {
      setError("That one is already on your list.");
      return;
    }
    if (isFull) {
      setError(`You can pick up to ${maxCount}.`);
      return;
    }

    onChange([...values, value]);
    setDraft("");
    setError(null);
  };

  return (
    <View>
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

      {custom.length > 0 && (
        <View style={[styles.group, styles.customGroup]}>
          {custom.map((value) => (
            <View key={value} style={[styles.chip, styles.chipSelected, styles.customChip]}>
              <Text style={[styles.label, styles.labelSelected]}>
                {labelOf(value)}
              </Text>
              <TouchableOpacity
                onPress={() => onChange(values.filter((v) => v !== value))}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${labelOf(value)}`}
              >
                <Ionicons name="close" size={15} color={colors.primary} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}

      {isAdding ? (
        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              setError(null);
            }}
            placeholder={placeholder}
            placeholderTextColor={colors.textDisabled}
            maxLength={maxLength}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={addCustom}
          />
          <TouchableOpacity
            style={styles.addButton}
            onPress={addCustom}
            accessibilityRole="button"
            accessibilityLabel="Add this interest"
          >
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setIsAdding(false);
              setDraft("");
              setError(null);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Cancel adding"
          >
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          style={[styles.chip, styles.otherChip]}
          onPress={() => setIsAdding(true)}
          accessibilityRole="button"
          accessibilityLabel="Add your own option"
        >
          <Ionicons name="add" size={15} color={colors.textSecondary} />
          <Text style={styles.label}>Other</Text>
        </TouchableOpacity>
      )}

      {!!error && <Text style={styles.errorText}>{error}</Text>}
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

    customGroup: { marginTop: Spacing.sm },
    customChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
      // Tighter on the right so the × does not sit adrift of the label.
      paddingRight: Spacing.md,
    },
    // Dashed, so it reads as "add one" rather than as another option.
    otherChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.xs,
      alignSelf: "flex-start",
      marginTop: Spacing.sm,
      borderStyle: "dashed",
      backgroundColor: "transparent",
    },
    addRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: Spacing.sm,
      marginTop: Spacing.sm,
    },
    addInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm + 2,
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      color: colors.textPrimary,
      backgroundColor: colors.surfaceSunken,
      minHeight: 44,
    },
    addButton: {
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm + 2,
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
      minHeight: 44,
      justifyContent: "center",
    },
    addButtonText: {
      color: colors.primaryContrast,
      fontFamily: FontFamily.semibold,
      fontSize: FontSize.small,
    },
    errorText: {
      color: colors.danger,
      fontSize: FontSize.caption,
      fontFamily: FontFamily.regular,
      marginTop: Spacing.sm,
    },
  });
