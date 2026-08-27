/**
 * Fixed option sets for the profile form.
 *
 * Values are the stable identifiers stored in the database; labels are what
 * the user sees. Never store the label — renaming one would orphan existing
 * rows.
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

export const genderLabel = (value?: string | null) =>
  value ? labelFor(GENDER_OPTIONS, value) : null;

/** Stored as a comma-separated string, matching how `interests` already works. */
export const parseDietary = (raw?: string | null): string[] =>
  raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : [];

export const serializeDietary = (values: string[]) => values.join(", ");

export const dietaryLabels = (raw?: string | null): string[] =>
  parseDietary(raw).map((v) => labelFor(DIETARY_OPTIONS, v));
