import { useMemo, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { Calendar, DateData } from "react-native-calendars";

import {
  Elevation,
  FontFamily,
  FontSize,
  Radius,
  Spacing,
  ThemeColors,
} from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { formatDate, startOfDay } from "../utils/validation";
import { AppButton } from "./AppButton";

/** react-native-calendars keys everything by "YYYY-MM-DD". */
const toKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

const fromKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Every date from start to end inclusive, for the highlighted band. */
const datesBetween = (start: Date, end: Date) => {
  const out: string[] = [];
  const cursor = startOfDay(start);
  const last = startOfDay(end);
  while (cursor <= last) {
    out.push(toKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
};

type Props = {
  visible: boolean;
  initialStart: Date | null;
  initialEnd: Date | null;
  onConfirm: (start: Date, end: Date) => void;
  onCancel: () => void;
};

export function DateRangePicker({
  visible,
  initialStart,
  initialEnd,
  onConfirm,
  onCancel,
}: Props) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [start, setStart] = useState<Date | null>(initialStart);
  const [end, setEnd] = useState<Date | null>(initialEnd);

  const today = useMemo(() => new Date(), []);

  /**
   * First tap sets the start and clears the end. Second tap sets the end,
   * unless it is before the start — then it becomes the new start, which is
   * friendlier than rejecting the tap.
   */
  const handleDayPress = (day: DateData) => {
    const picked = fromKey(day.dateString);
    if (!start || end) {
      setStart(picked);
      setEnd(null);
      return;
    }
    if (picked < start) {
      setStart(picked);
      return;
    }
    setEnd(picked);
  };

  const markedDates = useMemo(() => {
    const marks: Record<string, any> = {};
    if (start && end) {
      const keys = datesBetween(start, end);
      keys.forEach((key, i) => {
        marks[key] = {
          color: colors.primary,
          textColor: colors.primaryContrast,
          startingDay: i === 0,
          endingDay: i === keys.length - 1,
        };
      });
    } else if (start) {
      marks[toKey(start)] = {
        color: colors.primary,
        textColor: colors.primaryContrast,
        startingDay: true,
        endingDay: true,
      };
    }
    return marks;
  }, [start, end, colors]);

  const summary = start
    ? end
      ? `${formatDate(start)} - ${formatDate(end)}`
      : `${formatDate(start)} — now pick the end date`
    : "Pick your start date";

  const reset = () => {
    setStart(initialStart);
    setEnd(initialEnd);
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Trip dates</Text>
          <Text style={styles.summary}>{summary}</Text>

          <Calendar
            // Opens on the current month, or the month of an existing selection.
            current={toKey(start ?? today)}
            onDayPress={handleDayPress}
            markingType="period"
            markedDates={markedDates}
            enableSwipeMonths
            // Remount on theme change; the library caches its theme internally.
            key={isDark ? "dark" : "light"}
            theme={{
              calendarBackground: colors.surface,
              monthTextColor: colors.textPrimary,
              textMonthFontFamily: FontFamily.semibold,
              textMonthFontSize: FontSize.body,
              arrowColor: colors.primary,
              dayTextColor: colors.textPrimary,
              textDisabledColor: colors.textDisabled,
              textDayFontFamily: FontFamily.regular,
              textDayHeaderFontFamily: FontFamily.medium,
              textSectionTitleColor: colors.textSecondary,
              // Today is marked so the calendar always shows "now" on open.
              todayTextColor: colors.primary,
            }}
          />

          <View style={styles.actions}>
            <AppButton
              label="Cancel"
              variant="secondary"
              style={styles.action}
              onPress={() => {
                reset();
                onCancel();
              }}
            />
            <AppButton
              label="Confirm"
              style={styles.action}
              disabled={!start || !end}
              onPress={() => start && end && onConfirm(start, end)}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: colors.overlay,
      justifyContent: "center",
      padding: Spacing.xl,
    },
    sheet: {
      backgroundColor: colors.surface,
      borderRadius: Radius.xl,
      padding: Spacing.xl,
      ...Elevation.lg,
    },
    title: {
      fontSize: FontSize.h2,
      fontFamily: FontFamily.bold,
      color: colors.textPrimary,
      textAlign: "center",
    },
    summary: {
      fontSize: FontSize.small,
      fontFamily: FontFamily.regular,
      color: colors.textSecondary,
      textAlign: "center",
      marginTop: Spacing.xs,
      marginBottom: Spacing.md,
    },
    actions: { flexDirection: "row", gap: Spacing.md, marginTop: Spacing.lg },
    action: { flex: 1 },
  });
