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
