/**
 * Fixed option sets for the profile form.
 *
 * Values are the stable identifiers stored in the database; labels are what
 * the user sees. Never store the label — renaming one would orphan existing
 * rows. These must stay in step with GENDER_VALUES / DIETARY_VALUES in
 * traveleria-backend/lambdas/users/handler.py and the CHECK constraints in
 * sql/004_user_preferences.sql.
 */

import type { Option } from "../components/OptionSelector";

export const GENDER_OPTIONS: readonly Option[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non_binary", label: "Non-binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

export const DIETARY_OPTIONS: readonly Option[] = [
  { value: "vegetarian", label: "Vegetarian" },
  { value: "vegan", label: "Vegan" },
  { value: "pescatarian", label: "Pescatarian" },
  { value: "keto", label: "Keto" },
  { value: "halal", label: "Halal" },
  { value: "kosher", label: "Kosher" },
  { value: "gluten_free", label: "Gluten free" },
  { value: "lactose_intolerant", label: "Lactose intolerant" },
  { value: "nut_allergy", label: "Nut allergy" },
];

/**
 * Interests differ from the two sets above: the list is a starting point, not
 * a closed set. "Other" lets the user add anything, so there is no CHECK
 * constraint in sql/005_user_interests.sql — only the length and count caps in
 * lambdas/users/handler.py.
 *
 * A preset is stored as its slug; a custom entry as the text the user typed.
 * `interestLabel` looks a value up here and falls back to returning it as-is,
 * so both render correctly without needing to be told apart.
 */
export const INTEREST_OPTIONS: readonly Option[] = [
  { value: "food_dining", label: "Food & dining" },
  { value: "street_food", label: "Street food" },
  { value: "wine_breweries", label: "Wine & breweries" },
  { value: "nightlife", label: "Nightlife" },
  { value: "museums", label: "Museums" },
  { value: "art_galleries", label: "Art & galleries" },
  { value: "history_heritage", label: "History & heritage" },
  { value: "architecture", label: "Architecture" },
  { value: "religious_sites", label: "Religious sites" },
  { value: "live_music", label: "Live music" },
  { value: "festivals", label: "Festivals & events" },
  { value: "shopping", label: "Shopping" },
  { value: "local_markets", label: "Local markets" },
  { value: "nature_parks", label: "Nature & parks" },
  { value: "hiking", label: "Hiking" },
  { value: "beaches", label: "Beaches" },
  { value: "water_sports", label: "Water sports" },
  { value: "winter_sports", label: "Skiing & snowboarding" },
  { value: "cycling", label: "Cycling" },
  { value: "wildlife", label: "Wildlife" },
  { value: "photography", label: "Photography" },
  { value: "wellness_spa", label: "Spa & wellness" },
  { value: "theme_parks", label: "Theme parks" },
  { value: "sports_events", label: "Sports events" },
];

/** Mirrors MAX_INTERESTS / MAX_INTEREST_LENGTH in the users Lambda. */
export const INTEREST_LIMITS = { maxCount: 20, maxLength: 30 } as const;

const labelFor = (options: readonly Option[], value: string) =>
  options.find((o) => o.value === value)?.label ?? value;

export const genderLabel = (value?: string | null): string | null =>
  value ? labelFor(GENDER_OPTIONS, value) : null;

/**
 * `dietary` is a Postgres TEXT[] and arrives as a JSON array, so no parsing is
 * needed. This only guards against a null or unexpected shape from the API.
 */
export const parseDietary = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];

export const dietaryLabels = (raw: unknown): string[] =>
  parseDietary(raw).map((v) => labelFor(DIETARY_OPTIONS, v));

/** `interests` is a TEXT[] too, since sql/005_user_interests.sql. */
export const parseInterests = (raw: unknown): string[] =>
  Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];

/** A preset's label, or the custom text itself. */
export const interestLabel = (value: string) =>
  labelFor(INTEREST_OPTIONS, value);

export const interestLabels = (raw: unknown): string[] =>
  parseInterests(raw).map(interestLabel);

/** True when the value is not one of the presets — i.e. typed under "Other". */
export const isCustomInterest = (value: string) =>
  !INTEREST_OPTIONS.some((o) => o.value === value);
