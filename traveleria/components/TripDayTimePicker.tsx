import { useEffect, useMemo, useState } from "react";
import { Modal, StyleSheet, Text, View } from "react-native";
import { Calendar, DateData } from "react-native-calendars";
import DateTimePickerModal from "react-native-modal-datetime-picker";

import {
  Elevation,
  FontFamily,
  FontSize,
  Radius,
  Spacing,
  ThemeColors,
} from "../constants/theme";
import { useTheme } from "../contexts/ThemeContext";
import { makeCalendarTheme, fromKey, toKey } from "../utils/calendar";
import { formatDate, formatTime, parseTime, startOfDay } from "../utils/validation";
import { AppButton } from "./AppButton";

type Props = {
  visible: boolean;
  /** Trip bounds. Null means the range is unknown, so no day is barred. */
  tripStart: Date | null;
  tripEnd: Date | null;
  initialDate: Date | null;
  /** "HH:MM", or "" when nothing is chosen yet. */
  initialTime: string;
  onConfirm: (date: Date, time: string) => void;
  onCancel: () => void;
};

/**
 * Picks a day and a time as one value.
 *
 * Two steps — the trip calendar, then the time wheel — but a single result:
 * nothing is handed back until both are chosen, so the caller can never end
 * up holding a date without a time. Cancelling at either step discards both.
 */
export function TripDayTimePicker({
  visible,
  tripStart,
  tripEnd,
  initialDate,
  initialTime,
  onConfirm,
  onCancel,
}: Props) {
  const { colors, isDark } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [step, setStep] = useState<"day" | "time">("day");
  const [day, setDay] = useState<Date | null>(initialDate);

  // Re-seed each time the sheet opens, so it reopens on the value the form is
  // actually holding rather than whatever was picked last.
  useEffect(() => {
    if (visible) {
      setDay(initialDate);
      setStep("day");
    }
  }, [visible, initialDate]);

  /**
   * The day the calendar opens on when nothing is chosen: today if the trip
   * is already under way, otherwise its first day. Both are one tap from the
   * thing a traveller most likely wants.
   */
  const defaultDay = useMemo(() => {
    const today = startOfDay(new Date());
    if (!tripStart || !tripEnd) return today;
    if (today < startOfDay(tripStart)) return tripStart;
    if (today > startOfDay(tripEnd)) return tripStart;
    return today;
  }, [tripStart, tripEnd]);

  const selected = day ?? defaultDay;

  const markedDates = useMemo(
    () => ({
      [toKey(selected)]: {
        selected: true,
        selectedColor: colors.primary,
        selectedTextColor: colors.primaryContrast,
      },
    }),
    [selected, colors],
  );

  const handleTimeConfirm = (picked: Date) => {
    onConfirm(selected, formatTime(picked));
  };

  return (
    <>
      <Modal visible={visible && step === "day"} transparent animationType="fade">
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <Text style={styles.title}>Pick a day</Text>
            <Text style={styles.summary}>
              {formatDate(selected)}
              {tripStart && tripEnd ? " · within your trip dates" : ""}
            </Text>

            <Calendar
              current={toKey(selected)}
              onDayPress={(d: DateData) => setDay(fromKey(d.dateString))}
              markedDates={markedDates}
              // Days outside the trip are greyed out by the theme's
              // textDisabledColor; this makes them genuinely untappable too.
              minDate={tripStart ? toKey(tripStart) : undefined}
              maxDate={tripEnd ? toKey(tripEnd) : undefined}
              disableAllTouchEventsForDisabledDays
              enableSwipeMonths
              // Remount on theme change; the library caches its theme internally.
              key={isDark ? "dark" : "light"}
              theme={makeCalendarTheme(colors)}
            />

            <View style={styles.actions}>
              <AppButton
                label="Cancel"
                variant="secondary"
                style={styles.action}
                onPress={onCancel}
              />
              <AppButton
                label="Next: time"
                style={styles.action}
                onPress={() => setStep("time")}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Same scroll-wheel picker the form used before, now step two. */}
      <DateTimePickerModal
        isVisible={visible && step === "time"}
        mode="time"
        display="spinner"
        is24Hour={true}
        date={parseTime(initialTime) ?? new Date()}
        confirmTextIOS="Done"
        onConfirm={handleTimeConfirm}
        // Backing out returns to the calendar rather than dropping the day.
        onCancel={() => setStep("day")}
      />
    </>
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
