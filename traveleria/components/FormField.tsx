import { ReactNode, useMemo } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
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

type Props = TextInputProps & {
  label: string;
  /** Message shown under the field; also turns the border red. */
  error?: string;
  /**
   * Render a custom control instead of a TextInput — used for the date and
   * time triggers, which look like inputs but open a picker.
   */
  children?: ReactNode;
};

export function FormField({ label, error, children, style, ...inputProps }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      {children ?? (
        <TextInput
          style={[styles.input, !!error && styles.inputError, style]}
          placeholderTextColor={colors.textDisabled}
          {...inputProps}
        />
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

/** Exported so screens can style custom controls to match a real input. */
export function useFieldStyles() {
  const colors = useThemeColors();
  return useMemo(() => makeStyles(colors), [colors]);
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    group: { marginBottom: Spacing.lg },
    label: {
      fontSize: FontSize.caption,
      fontFamily: FontFamily.semibold,
      color: colors.textSecondary,
      marginBottom: Spacing.xs + 2,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      padding: Spacing.md,
      fontSize: FontSize.body,
      fontFamily: FontFamily.regular,
      color: colors.textPrimary,
      backgroundColor: colors.surfaceSunken,
      // Matches the TextInput height so picker triggers line up with inputs.
      minHeight: 48,
    },
    inputError: { borderColor: colors.danger },
    error: {
      color: colors.danger,
      fontSize: FontSize.caption,
      fontFamily: FontFamily.regular,
      marginTop: Spacing.xs,
    },
  });
