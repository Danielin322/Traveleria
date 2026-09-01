# Traveleria — Wallet Card Icons & Colour Picker

Plan for two wallet UI changes, from an audit of the code on branch
`wallet-s3-storage` (2026-09-01). **Nothing implemented yet.**

---

## Summary

| # | Change | Layers | Deploy | Effort |
|---|--------|--------|--------|--------|
| 1 | Pick an icon for a document card | Frontend + `wallet` Lambda + DB | Migration + 1 Lambda | Small–Medium |
| 2 | Pick a colour from a wide palette | Frontend + `wallet` Lambda | 1 Lambda | Medium |

**No new API routes.** Both ride on the existing `POST /wallet` and
`PUT /wallet/{document_id}`, so `add_routes.sh` is not needed and the invoke
URL is untouched.

---

## Audit findings that shape this plan

1. **Only the top ~100px of each card is ever visible.** `renderItem` applies
   `marginTop: -100` to every card after the first, so they overlap like a real
   wallet. The card is 200px tall, meaning **the bottom half of all but the
   last card is covered.**

   This decides the icon's placement: it must sit in `cardHeader`, next to the
   title. An icon in the card body — the obvious "big logo" design — would be
   invisible on every card except the last one. `cardBody` is defined in the
   stylesheet and never rendered, which is a hint that the body was already
   found to be dead space.

2. **Card text is hardcoded white** — `cardTopTitle` is `color: "#fff"` and the
   ⋯ button is `color="#fff"`. That is safe today only because all six
   `APPLE_COLORS` are dark. **The moment a light colour can be picked, the
   title becomes unreadable.** Change 2 cannot ship without solving this.

3. **`color` is currently not validated at all.** The Lambda passes
   `body.get("color")` straight into the INSERT. Any string is accepted and fed
   back into a React Native `backgroundColor`. Worth fixing while we are here,
   and mandatory once the client can send arbitrary values.

4. **No colour or gradient library is installed.** No `expo-linear-gradient`,
   no colour-picker package. A true drag-and-pick gradient wheel would mean a
   new dependency; §2 proposes an approach that does not.

5. **`wallet_documents.color` already exists** (from `006`). Only `icon` is a
   new column.

---

## 1. Document icons

### UX

The icon sits left of the title in the card header — the only strip that is
reliably visible:

```
┌──────────────────────────────────────┐
│  ✈  FLIGHT TO ROME              ⋯   │   ← visible strip
│                                      │
└──────────────────────────────────────┘
```

In the Add and Edit sheets an icon row appears above the colour row: a
horizontally scrolling strip of icon chips, the selected one filled with the
document's current colour so both choices are seen together.

### Proposed icon set

28 Ionicons glyphs, grouped so the picker scans quickly. All ship with
`@expo/vector-icons`, already a dependency — no new assets.

| Group | Icons |
|---|---|
| Travel | `airplane`, `boat`, `train`, `bus`, `car-sport`, `bicycle`, `subway` |
| Stay | `bed`, `home`, `business`, `key` |
| Money | `card`, `cash`, `pricetag`, `receipt` |
| Documents | `document-text`, `id-card`, `shield-checkmark`, `newspaper`, `qr-code` |
| Activities | `restaurant`, `ticket`, `musical-notes`, `camera`, `map`, `football` |
| Health | `medkit`, `fitness` |

`shield-checkmark` covers insurance and `id-card` covers passports and IDs —
the two most common wallet documents after boarding passes.

### Default for existing documents

Every document created so far has no icon. Rather than a generic placeholder,
infer one from `mime_type`, which is already stored:

- `image/*` → `image`
- `application/pdf` → `document-text`
- anything else → `document`

Existing cards then get a sensible icon with no data migration, and the column
stays nullable.

### Backend

**New `sql/007_wallet_document_icon.sql`** — one additive column, matching the
`ALTER … IF NOT EXISTS` pattern of 002/003/006:

```sql
ALTER TABLE wallet_documents ADD COLUMN IF NOT EXISTS icon TEXT;
```

No CHECK constraint. The allowed set is a **UI concern that will change** as
icons are added or renamed, and a constraint would turn a future icon rename
into a migration. Validation lives in the Lambda, mirroring how `interests`
was handled in `005`.

**`lambdas/wallet/handler.py`**

- `WALLET_ICONS` — the 28 names as a frozenset, with a comment naming
  `traveleria/constants/walletIcons.ts` as its mirror, the same convention
  `GENDER_VALUES` / `DIETARY_VALUES` already use in the users Lambda.
- `_clean_icon(body)` — absent means unchanged; a value outside the set raises
  `AppError`. Returns `None` for "leave alone", so it fits the existing
  `COALESCE` in `_update_document`.
- `icon` added to the SELECT, INSERT, UPDATE and both response bodies.

### Frontend

**New `constants/walletIcons.ts`** — the grouped list plus
`iconForMimeType(mime)` implementing the fallback above.

**New `components/IconPicker.tsx`** — horizontally scrolling chip strip. The
selected chip fills with the card's current colour; unselected chips are
outlined. Keeps `OptionSelector`'s accessibility shape (`accessibilityRole`
`radio`, `accessibilityState.selected`).

**`app/(tabs)/wallet.tsx`** — icon state in both modals, rendered in
`cardHeader` before the title.

**`services/walletService.ts`** — `icon` on create and update.

---

## 2. Colour from a wide palette

### The approach, and why

Three ways to do this:

| Option | Colours | New dependency | Notes |
|---|---|---|---|
| **A. HSL two-rail picker** | ~360 + neutrals | **None** | Recommended |
| B. Bigger fixed grid | 40–60 | None | Still "known options" — does not meet the ask |
| C. Gradient wheel | Continuous | `reanimated-color-picker` | True freedom, but a dependency and a native-gesture surface to get right |

**Recommend A.** It reads as a real palette rather than a list, needs nothing
new installed, and is straightforward to build:

- **Hue rail** — 24 swatches at 15° intervals around the colour wheel, plus a
  neutrals swatch (black → white).
- **Shade grid** — once a hue is chosen, 12 variants of *that* hue at three
  saturation levels × four lightness levels.

24 × 12 = 288 colours plus 8 neutrals, reachable in two taps. If you would
rather have a genuine draggable wheel, say so and I will plan option C instead
— a bigger change, but not a hard one.

```
Hue      ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ● ●  ◐
Shade    ▪ ▪ ▪ ▪
         ▪ ▪ ▪ ▪
         ▪ ▪ ▪ ▪
Preview  ┌────────────────┐
         │ ✈  FLIGHT   ⋯ │   ← live, with real contrast applied
         └────────────────┘
```

The preview matters: it is the only place the contrast rule below is visible
before saving.

### Readable text — the part that is not optional

With free colours, white-on-pale is unreadable. **New `utils/color.ts`:**

```ts
hslToHex(h, s, l): string
relativeLuminance(hex): number     // WCAG 2.1 definition
readableTextColor(hex): string     // "#ffffff" | "#111111"
```

`readableTextColor` returns whichever of white or near-black has the higher
contrast ratio against the card. Applied to the title, the ⋯ button and the
document icon, replacing the three hardcoded `"#fff"` values.

Near-black rather than pure black: `#111111` on a bright yellow is materially
easier to read than `#000000`, and it matches how the rest of the app treats
`textPrimary`.

> This is why change 2 is Medium rather than Small. The picker itself is
> straightforward; keeping every card legible across 288 colours is the actual
> work.

### Backend

**`lambdas/wallet/handler.py`** — `_clean_color(body)`:

- must match `^#[0-9A-Fa-f]{6}$`
- normalised to lowercase before storage, so `#FF3B30` and `#ff3b30` do not
  become two different stored values

This closes finding 3 regardless of the picker.

### Frontend

**New `components/ColorPalettePicker.tsx`** — the two rails plus the live card
preview.

**`app/(tabs)/wallet.tsx`** — replaces the six-swatch `colorPicker` row in both
modals. `APPLE_COLORS` shrinks to a single `DEFAULT_CARD_COLOR` for new
documents.

---

## Files touched

| File | Change |
|---|---|
| `sql/007_wallet_document_icon.sql` | **new** — one column |
| `lambdas/wallet/handler.py` | icon + colour validation, both in responses |
| `constants/walletIcons.ts` | **new** — icon set + mime fallback |
| `utils/color.ts` | **new** — HSL, luminance, contrast |
| `components/IconPicker.tsx` | **new** |
| `components/ColorPalettePicker.tsx` | **new** |
| `app/(tabs)/wallet.tsx` | card header, both modals, contrast colours |
| `services/walletService.ts` | pass `icon` through |

## Deployment

1. `scripts/init_db.py` — additive column, safe any time.
2. `update-function-code` for `traveleria-wallet`.

**No `add_routes.sh`, no new routes, no URL change.**

## Manual test checklist

- Pick a pale yellow → title and ⋯ turn dark and stay readable.
- Pick near-black → they turn white.
- Change a card's icon, reopen the app → it persists.
- An existing document with no icon → shows the mime-inferred one.
- Send an invalid icon name or malformed colour via the API → rejected with a
  readable message, not stored.

## Risks

| Risk | Mitigation |
|---|---|
| Unreadable title on a light card | `readableTextColor` on every card element; live preview in the picker |
| A stored colour that is not valid hex reaching a style | Server-side regex, normalised to lowercase |
| Icon renamed in a future Ionicons version | Names validated server-side; a bad one is rejected, not rendered blank |
| 288 swatches feeling slow | Swatches are plain Views; the shade grid is computed only for the chosen hue |

## Open questions

1. **Gradient wheel instead?** Plan assumes option A (no new dependency).
   Option C gives continuous colour but adds `reanimated-color-picker`.
2. **Should the icon also show in the full-screen viewer header?** Plan says
   no — the viewer shows the document itself and the title is already there.
3. **Defaults for new documents** — plan uses the current first `APPLE_COLORS`
   value (`#000000`) plus a mime-inferred icon. Happy to default to a
   friendlier blue instead.
