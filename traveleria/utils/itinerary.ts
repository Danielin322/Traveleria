/**
 * Grouping and ordering for the daily plan.
 *
 * The itinerary API hands back a flat list of events, each carrying a
 * "DD.MM.YYYY" date and an "HH:MM" time. The screen shows it as one section
 * per day of the trip — including days with nothing on them, which are the
 * fastest way to add something to a specific day.
 */

import { toKey } from "./calendar";
import { formatDayHeader } from "./tripFormat";
import { parseDate, startOfDay } from "./validation";

export type ItineraryEvent = {
  id: string;
  /** "DD.MM.YYYY". Absent on events written before per-day scheduling. */
  date?: string;
  /** "HH:MM" */
  time: string;
  place: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
  notes?: string | null;
};

export type DaySection = {
  /** "Tue, 12 Aug" */
  title: string;
  /** 1-based position in the list of days shown. */
  dayNumber: number;
  date: Date;
  /** Empty for a day with nothing planned. */
  data: ItineraryEvent[];
};

export type TripRange = { start: Date; end: Date };

/**
 * Orders by calendar day first, then clock time.
 *
 * Note the parse: "02.09.2026" sorts *before* "12.08.2026" as a string, so
 * comparing the display form directly would silently mis-order any trip that
 * crosses a month boundary.
 */
export const eventSortKey = (e: ItineraryEvent) => {
  const parsed = e.date ? parseDate(e.date) : null;
  return `${String(parsed?.getTime() ?? 0).padStart(16, "0")}|${e.time}`;
};

export const sortEvents = (events: ItineraryEvent[]) =>
  [...events].sort((a, b) => eventSortKey(a).localeCompare(eventSortKey(b)));

/** Every "YYYY-MM-DD" from start to end inclusive. */
const dayKeysInRange = (range: TripRange) => {
  const keys: string[] = [];
  const cursor = startOfDay(range.start);
  const last = startOfDay(range.end);
  while (cursor <= last) {
    keys.push(toKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
};

/**
 * One section per trip day, days ascending, empty days included.
 *
 * Sections come from the *union* of the trip's days and the days its events
 * actually fall on. Building them from the trip range alone would hide any
 * event sitting outside it — a leftover from before the trip's dates were
 * edited, say — while it still existed in the database.
 *
 * `tripRange` is null when the screen was opened without the trip's dates;
 * then only days that have events get a section.
 */
export function groupEventsByDay(
  events: ItineraryEvent[],
  tripRange: TripRange | null,
): DaySection[] {
  const byDay = new Map<string, ItineraryEvent[]>();
  const undated: ItineraryEvent[] = [];

  for (const event of sortEvents(events)) {
    const parsed = event.date ? parseDate(event.date) : null;
    if (!parsed) {
      undated.push(event);
      continue;
    }
    const key = toKey(parsed);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(event);
    else byDay.set(key, [event]);
  }

  const keys = new Set<string>(byDay.keys());
  if (tripRange) dayKeysInRange(tripRange).forEach((k) => keys.add(k));

  // "YYYY-MM-DD" is the one date format that does sort correctly as a string.
  const ordered = [...keys].sort();

  // Events from before the API returned a date belong to the trip's first
  // day, which is where the backend put them.
  if (undated.length > 0 && ordered.length > 0) {
    byDay.set(ordered[0], [...(byDay.get(ordered[0]) ?? []), ...undated]);
  }

  return ordered.map((key, index) => {
    const date = startOfDay(
      new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))),
    );
    return {
      title: formatDayHeader(date),
      dayNumber: index + 1,
      date,
      data: byDay.get(key) ?? [],
    };
  });
}
