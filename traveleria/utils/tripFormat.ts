/**
 * Presentation helpers for trips.
 *
 * The API hands back a "DD.MM.YYYY - DD.MM.YYYY" string; these turn it into
 * something friendlier to read and let the trips list sort itself into
 * upcoming and past sections.
 */

import { parseDateRange, startOfDay } from "./validation";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type TripStatus =
  | { kind: "upcoming"; daysUntil: number }
  | { kind: "ongoing"; daysLeft: number }
  | { kind: "past" };

/**
 * "11.08.2026 - 15.08.2026" -> "11-15 Aug 2026"
 * Collapses whatever the two dates share: same month and year, same year, or
 * neither. Falls back to the raw string if it cannot be parsed, so a trip is
 * never rendered blank.
 */
export function formatTripDates(range: string): string {
  const parsed = parseDateRange(range);
  if (!parsed) return range;

  const { start, end } = parsed;
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth) {
    return `${start.getDate()}-${end.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()}`;
  }
  if (sameYear) {
    return `${start.getDate()} ${MONTHS[start.getMonth()]} - ${end.getDate()} ${MONTHS[end.getMonth()]} ${start.getFullYear()}`;
  }
  return `${start.getDate()} ${MONTHS[start.getMonth()]} ${start.getFullYear()} - ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}`;
}

/** Where a trip sits relative to today. `null` when the range is unparseable. */
export function getTripStatus(range: string, now: Date = new Date()): TripStatus | null {
  const parsed = parseDateRange(range);
  if (!parsed) return null;

  const today = startOfDay(now);
  const start = startOfDay(parsed.start);
  const end = startOfDay(parsed.end);

  if (today < start) {
    return {
      kind: "upcoming",
      daysUntil: Math.round((start.getTime() - today.getTime()) / MS_PER_DAY),
    };
  }
  if (today <= end) {
    return {
      kind: "ongoing",
      daysLeft: Math.round((end.getTime() - today.getTime()) / MS_PER_DAY),
    };
  }
  return { kind: "past" };
}

/** Short badge text, e.g. "In 12 days", "Tomorrow", "Ongoing". */
export function formatTripBadge(status: TripStatus | null): string | null {
  if (!status) return null;

  if (status.kind === "ongoing") return "Ongoing";
  if (status.kind === "past") return null;

  if (status.daysUntil === 0) return "Today";
  if (status.daysUntil === 1) return "Tomorrow";
  if (status.daysUntil < 30) return `In ${status.daysUntil} days`;

  const months = Math.round(status.daysUntil / 30);
  return months <= 1 ? "In a month" : `In ${months} months`;
}

type TripLike = { date: string };

/**
 * Splits trips into upcoming (soonest first) and past (most recent first).
 * Trips whose dates cannot be parsed are kept in `upcoming` so they stay
 * visible rather than silently disappearing.
 */
export function groupTripsByTime<T extends TripLike>(
  trips: T[],
  now: Date = new Date(),
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = [];
  const past: T[] = [];

  for (const trip of trips) {
    const status = getTripStatus(trip.date, now);
    if (status?.kind === "past") past.push(trip);
    else upcoming.push(trip);
  }

  const startOf = (t: T) => parseDateRange(t.date)?.start?.getTime() ?? 0;
  upcoming.sort((a, b) => startOf(a) - startOf(b));
  past.sort((a, b) => startOf(b) - startOf(a));

  return { upcoming, past };
}
