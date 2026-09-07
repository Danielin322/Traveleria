/**
 * Shared input rules for trips and itinerary activities.
 *
 * Every validator returns `null` when the value is acceptable, or a
 * user-facing message explaining what to fix. Keeping them here means the
 * "Plan Trip" form and the "Add Event" form stay in sync, and the messages
 * match what the backend enforces (see traveleria-backend/shared/utils.py).
 */

export const LIMITS = {
  tripTitle: { min: 2, max: 60 },
  destination: { min: 2, max: 60 },
  activity: { min: 2, max: 80 },
  notes: { max: 500 },
} as const;

// Control characters never belong in a user-typed name. Built from a string so
// the escapes survive tooling that would otherwise inline the raw code points.
const CONTROL_CHARS = new RegExp("[\u0000-\u001F\u007F]");

// At least one letter or digit, so "..." or "!!!" is rejected. Explicit ranges
// (latin, latin-extended, cyrillic, hebrew, arabic) rather than \p{L}, because
// Hermes does not reliably support unicode property escapes.
const HAS_ALPHANUMERIC = new RegExp(
  "[0-9A-Za-z\u00C0-\u024F\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF]",
);

type TextRule = { min?: number; max: number; label: string };

function validateText(value: string, rule: TextRule): string | null {
  const trimmed = value.trim();

  if (!trimmed) return `${rule.label} is required.`;
  if (CONTROL_CHARS.test(trimmed))
    return `${rule.label} contains invalid characters.`;
  if (!HAS_ALPHANUMERIC.test(trimmed))
    return `${rule.label} must include at least one letter or number.`;
  if (rule.min && trimmed.length < rule.min)
    return `${rule.label} must be at least ${rule.min} characters.`;
  if (trimmed.length > rule.max)
    return `${rule.label} must be ${rule.max} characters or fewer.`;

  return null;
}

/**
 * Deliberately permissive — the same shape the signup screen has always used,
 * and the same one the backend checks. Whether an address really exists is
 * settled by whether its owner ever signs in with it, not by a regex.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidEmail = (email: string) => EMAIL_PATTERN.test(email.trim());

export const validateEmail = (value: string) => {
  const email = value.trim();
  if (!email) return "Enter an email address.";
  if (!isValidEmail(email))
    return "Enter a valid email address, e.g. name@example.com.";
  return null;
};

export const validateTripTitle = (value: string) =>
  validateText(value, { ...LIMITS.tripTitle, label: "Trip title" });

export const validateDestination = (value: string) =>
  validateText(value, { ...LIMITS.destination, label: "Destination" });

export const validateActivity = (value: string) =>
  validateText(value, { ...LIMITS.activity, label: "Activity" });

/** Notes are optional, so only the length ceiling applies. */
export function validateNotes(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Newlines are legitimate here, so exempt them from the control-char check.
  if (CONTROL_CHARS.test(trimmed.replace(/[\r\n]/g, "")))
    return "Notes contain invalid characters.";
  if (trimmed.length > LIMITS.notes.max)
    return `Notes must be ${LIMITS.notes.max} characters or fewer.`;
  return null;
}

/** The backend rejects an end date earlier than the start date. */
export function validateTripDates(
  start: Date | null,
  end: Date | null,
): string | null {
  if (!start) return "Please choose a start date.";
  if (!end) return "Please choose an end date.";
  if (startOfDay(end) < startOfDay(start))
    return "The end date must be on or after the start date.";
  return null;
}

/* ------------------------------------------------------------------ */
/* Date & time formatting                                             */
/*                                                                    */
/* The trips API exchanges dates as "DD.MM.YYYY - DD.MM.YYYY" strings  */
/* and activity times as "HH:MM", so all conversion lives here.        */
/* ------------------------------------------------------------------ */

const pad = (n: number) => n.toString().padStart(2, "0");

export const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Date -> "DD.MM.YYYY" */
export const formatDate = (d: Date) =>
  `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;

/** Two dates -> "DD.MM.YYYY - DD.MM.YYYY" (the format the backend parses). */
export const formatDateRange = (start: Date, end: Date) =>
  `${formatDate(start)} - ${formatDate(end)}`;

/** "DD.MM.YYYY" -> Date, or null when the string is malformed. */
export function parseDate(value: string): Date | null {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim());
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(year, month - 1, day);

  // Rejects rolled-over values such as 31.02.2026 -> 03.03.2026.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

/** "DD.MM.YYYY - DD.MM.YYYY" -> { start, end }, or null when malformed. */
export function parseDateRange(
  value: string,
): { start: Date; end: Date } | null {
  const parts = value.split(" - ");
  if (parts.length !== 2) return null;

  const start = parseDate(parts[0]);
  const end = parseDate(parts[1]);
  if (!start || !end) return null;

  return { start, end };
}

/** Date -> "HH:MM" (24-hour, matching day_places.visit_time). */
export const formatTime = (d: Date) =>
  `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "HH:MM" -> Date (today's date, given time), or null when malformed. */
export function parseTime(value: string): Date | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date;
}
