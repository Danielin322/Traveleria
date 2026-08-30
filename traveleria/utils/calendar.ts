/**
 * Shared plumbing for every `react-native-calendars` surface in the app.
 *
 * Two calendars exist — the trip-creation range picker and the event day
 * picker — and they must look identical and agree on how a date is keyed.
 * Both concerns live here so the two cannot drift apart.
 */

import { FontFamily, FontSize, ThemeColors } from "../constants/theme";
import { startOfDay } from "./validation";

/** react-native-calendars keys everything by "YYYY-MM-DD". */
export const toKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;

export const fromKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Every date from start to end inclusive, for a highlighted band. */
export const datesBetween = (start: Date, end: Date) => {
  const out: string[] = [];
  const cursor = startOfDay(start);
  const last = startOfDay(end);
  while (cursor <= last) {
    out.push(toKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
};

/**
 * The calendar theme, derived from the app's tokens.
 *
 * Pair it with `key={isDark ? "dark" : "light"}` on the Calendar: the library
 * caches its theme internally, so it needs a remount to pick up a change.
 */
export const makeCalendarTheme = (colors: ThemeColors) => ({
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
});
