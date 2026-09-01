/**
 * Icons a wallet document can carry.
 *
 * Values are Ionicons glyph names and are stored in the database as-is, so
 * renaming one orphans existing rows — add new entries rather than editing
 * existing ones. Must stay in step with WALLET_ICONS in
 * traveleria-backend/lambdas/wallet/handler.py, which rejects anything not in
 * the set. There is deliberately no CHECK constraint in sql/007.
 */

import type { Ionicons } from "@expo/vector-icons";

export type WalletIcon = keyof typeof Ionicons.glyphMap;

export type WalletIconGroup = {
  title: string;
  icons: readonly WalletIcon[];
};

/** Grouped so the picker can be scanned rather than read. */
export const WALLET_ICON_GROUPS: readonly WalletIconGroup[] = [
  {
    title: "Travel",
    icons: ["airplane", "boat", "train", "bus", "car-sport", "bicycle", "subway"],
  },
  {
    title: "Stay",
    icons: ["bed", "home", "business", "key"],
  },
  {
    title: "Money",
    icons: ["card", "cash", "pricetag", "receipt"],
  },
  {
    // shield-checkmark covers insurance; id-card covers passports and IDs.
    title: "Documents",
    icons: ["document-text", "id-card", "shield-checkmark", "newspaper", "qr-code"],
  },
  {
    title: "Activities",
    icons: ["restaurant", "ticket", "musical-notes", "camera", "map", "football"],
  },
  {
    title: "Health",
    icons: ["medkit", "fitness"],
  },
];

export const WALLET_ICONS: readonly WalletIcon[] = WALLET_ICON_GROUPS.flatMap(
  (group) => group.icons,
);

/**
 * The icon to show when a document has none.
 *
 * Documents saved before icons existed have `icon = NULL`, and there are only
 * a handful of them, so inferring from the mime type we already store beats
 * both a backfill and a generic placeholder on every old card.
 */
export function iconForMimeType(mimeType?: string | null): WalletIcon {
  if (!mimeType) return "document";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "document-text";
  return "document";
}

/** The icon a card should render: its own, or the mime-type fallback. */
export function resolveIcon(
  icon?: string | null,
  mimeType?: string | null,
): WalletIcon {
  return (icon as WalletIcon) || iconForMimeType(mimeType);
}

/** New documents start on the app's brand blue rather than black. */
export const DEFAULT_CARD_COLOR = "#2f6deb";
