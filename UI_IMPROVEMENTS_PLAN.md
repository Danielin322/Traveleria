# Traveleria — UI Improvements Plan

Implementation plan for five requested UI changes, based on an audit of the
current codebase on branch `small-UI-fixes` (as of 2026-08-27).

---

## Summary of requested changes

| # | Change | Layers touched | Est. effort |
|---|--------|----------------|-------------|
| 1 | Calendar-style date selection, defaulting to today | Frontend only | Small |
| 2 | Profile: gender + preferred nutrition (option pickers) | **Frontend + backend + DB** | Medium |
| 3 | Make the app look/feel professional (UX polish) | Frontend only | Large |
| 4 | App logo on login and elsewhere | Frontend + assets | Small–Medium |
| 5 | Dark mode | Frontend only | **Large** |

**Key sequencing insight:** changes 3 and 5 share the same prerequisite — a
design-token layer. Doing #5 before #3 (or either before the tokens exist)
means touching all ~240 hardcoded colour literals twice. **Do Phase 0 first.**

---

## Audit findings that shape this plan

These were measured from the current code, not assumed:

1. **No design tokens exist.** 51 distinct hex colours across `app/`, including
   **five different "primary blues"**: `#2f6deb` (38 uses), `#1e90ff` (5),
   `#2063e0` (3), `#007aff` (2), `#0a84ff` (1). Also four different reds
   (`#e53935`, `#ff4d4d`, `#ff3b30`, `#c0392b`), 13 distinct `borderRadius`
   values and 10 distinct `padding` values.

2. **Theme scaffolding exists but is broken and unused.** `hooks/use-theme-color.ts`,
   `components/themed-text.tsx`, `components/themed-view.tsx` and
   `components/ui/collapsible.tsx` all import `@/constants/theme` — **which does
   not exist**. This is the source of the 2 pre-existing TypeScript errors. None
   of these components are imported by any screen in `app/`; they are leftover
   Expo template files.

3. **`app.json` is not valid strict JSON** — there is a trailing comma in the
   `plugins` array. Expo's config loader tolerates it, but `JSON.parse` fails.
   Worth fixing while we are editing that file anyway.

4. **The logo has no alpha channel.** `traveleria_logo.png` is 1536×1024, RGB
   with a baked-in white background. It cannot be dropped onto a dark screen or
   used as an Android adaptive-icon foreground as-is.

5. **App icons are still Expo defaults** (`icon.png`, `splash-icon.png`,
   `react-logo*.png` are template assets).

6. **No custom fonts.** `expo-font` is installed but no font is ever loaded;
   everything renders in the system default.

7. **`users` table has an established migration pattern** —
   `sql/002_user_profile.sql` uses `ALTER TABLE users ADD COLUMN IF NOT EXISTS`.
   Change #2 should follow it exactly.

---

## Phase 0 — Design foundations (prerequisite for #3 and #5)

Nothing user-visible ships here, but it makes #3 and #5 tractable instead of
sprawling.

### 0.1 Create `traveleria/constants/theme.ts`

This file is already imported by four existing files and is missing. Creating it
fixes the 2 standing TypeScript errors *and* becomes the dark-mode foundation.

Define semantic tokens (not raw colour names) in light and dark variants:

```ts
export const Colors = {
  light: {
    background:       '#f4f6f8',
    surface:          '#ffffff',
    surfaceAlt:       '#eef2ff',
    textPrimary:      '#1a1a1a',
    textSecondary:    '#666666',
    textMuted:        '#8a97a5',
    primary:          '#2f6deb',   // the single canonical blue
    primaryContrast:  '#ffffff',
    danger:           '#e53935',
    success:          '#1a9e5c',
    border:           '#e0e0e0',
    overlay:          'rgba(0,0,0,0.5)',
  },
  dark: { /* same keys, dark values */ },
} as const;
```

Also add scales so #3 has something to enforce:

```ts
export const Spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const Radius  = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 };
export const Type    = { h1: 30, h2: 22, h3: 18, body: 16, small: 13, tiny: 11 };
```

### 0.2 Colour consolidation map

Apply during the migration in later phases:

| Replace | With | Occurrences |
|---|---|---|
| `#1e90ff`, `#2063e0`, `#007aff`, `#0a84ff` | `colors.primary` | 11 |
| `#ff4d4d`, `#ff3b30`, `#c0392b` | `colors.danger` | 10 |
| `#1a1a1a`, `#333` | `colors.textPrimary` | ~20 |
| `#666`, `#888`, `#999` | `colors.textSecondary` | ~25 |

### 0.3 Fix `app.json`

Remove the trailing comma in `plugins`. Verify with
`node -e "JSON.parse(require('fs').readFileSync('app.json','utf8'))"`.

---

## Change 1 — Calendar date selection

**Current state:** `react-native-modal-datetime-picker` with `display="spinner"`
in two places, both in `app/(tabs)/home.tsx` (start date ~line 333, end date
~line 341). `app/trip-details.tsx:632` is a **time** picker and is out of scope
for this change. The "default to today" requirement is already partly satisfied
(`date={startDate ?? new Date()}`).

### Option A — minimal change (recommended if time is tight)

Swap `display="spinner"` for the platform's native calendar view:

```tsx
display={Platform.OS === 'ios' ? 'inline' : 'calendar'}
```

- No new dependency.
- iOS 14+ renders the native calendar grid; Android renders the native calendar dialog.
- ~1 line changed per picker.
- Limitation: still two separate pickers for start and end.

### Option B — range calendar (recommended for best UX)

Add `react-native-calendars` and replace the two pickers with **one** calendar
where the user taps the start date then the end date, with the range highlighted
between them (`markingType="period"`).

Steps:
1. `npx expo install react-native-calendars`
2. New component `components/DateRangePicker.tsx` — props
   `{ visible, initialStart, initialEnd, onConfirm, onCancel }`.
3. Open on the current month with today marked (`current={todayISO}`,
   `markedDates` includes a `today` marker).
4. Keep the existing `formatDateRange(start, end)` from `utils/validation.ts`
   for the `DD.MM.YYYY - DD.MM.YYYY` API contract — **do not change the wire
   format**, the backend parses it in `shared/utils.py:parse_trip_dates`.
5. Replace both `DateTimePickerModal` blocks in `home.tsx` with one trigger.
6. Keep the existing `validateTripDates` guard as a backstop.

### Acceptance criteria
- Tapping the date field opens a **calendar**, not a wheel.
- The calendar opens on the current month with **today visually marked**.
- Selecting end-before-start is impossible (or auto-corrected, as today).
- Trips still save and render correctly (`utils/tripFormat.ts` unchanged).

---

## Change 2 — Profile: gender + preferred nutrition

> ⚠️ **This is the one change that cannot be frontend-only.** New data must be
> stored, so it needs a DB migration, a Lambda change, and a redeploy. Flagging
> because the last two rounds of work were explicitly frontend-only.

### 2.1 Terminology recommendation

For gender, "none" reads as missing data rather than an identity. Recommended
option set (values stored lowercase, labels shown in UI):

| Stored value | Label |
|---|---|
| `male` | Male |
| `female` | Female |
| `non_binary` | Non-binary |
| `prefer_not_to_say` | Prefer not to say |

For nutrition — note the intended spellings are **keto** and **lactose
intolerant**. Suggested multi-select set:

`vegetarian`, `vegan`, `pescatarian`, `keto`, `halal`, `kosher`,
`gluten_free`, `lactose_intolerant`, `nut_allergy`

### 2.2 Database — `sql/003_user_preferences.sql`

Follow the existing `002` pattern exactly:

```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS dietary TEXT;
```

`dietary` is a comma-separated `TEXT` to match how `interests` is already
stored and parsed — consistent with the codebase rather than introducing an
array/JSONB pattern used nowhere else.

### 2.3 Backend — `lambdas/users/handler.py`

Three edits, mirroring how `interests` is already handled:
1. `_get_profile` — add `gender, dietary` to the `SELECT` column list.
2. `_get_profile` — add both keys to the returned dict.
3. `_update_profile` — add two `COALESCE(%s, col)` clauses, two params, and
   both columns to `RETURNING`.

Optionally validate `gender` against the allowed set and return `AppError` on a
bad value.

### 2.4 Frontend

- `app/(tabs)/profile.tsx` — display gender in the "About Me" block (new
  `Ionicons` row) and dietary as chips reusing the existing `interestTag` style.
  Apply the same `"Not set"` fallback pattern already used for country/language/age.
- `app/edit-profile.tsx` — add a **segmented control** for gender (single
  choice) and a **chip multi-select** for dietary. No free-text, per the request.
- Send `gender` and `dietary` (joined with `", "`) in the existing `PATCH` body.
- New shared components: `components/OptionSelector.tsx` (single-select) and
  `components/ChipMultiSelect.tsx` (multi-select) — reusable, theme-aware.

### 2.5 Deployment note

Requires running `003_user_preferences.sql` against RDS and redeploying the
`users` Lambda. Note that `deploy_cloudshell.sh` **deletes and recreates the API
Gateway**, which mints a new invoke URL and requires updating
`EXPO_PUBLIC_API_URL` in the frontend `.env`. Coordinate with whoever owns the
`aws-account-migration` branch before deploying.

### Acceptance criteria
- Gender and dietary can be set without typing, persist across app restarts,
  and appear on the profile screen.
- Existing users with `NULL` values render "Not set" rather than blank.

---

## Change 3 — Professional look & feel (UX recommendations)

Ordered by visual impact per unit of effort. All depend on Phase 0.

### 3.1 Typography (highest impact, lowest effort)
Currently everything is the system font at ad-hoc sizes. Load one font family
(`expo-font` is already installed) — e.g. **Inter** or **Plus Jakarta Sans** —
and apply the `Type` scale. This single change is what most reads as
"professionally designed".

### 3.2 Enforce spacing and radius scales
Collapse 10 padding values → 6 tokens, 13 radii → 5 tokens. Removes the subtle
raggedness of the current layouts.

### 3.3 Extract shared components
`modalButton` / `cancelButton` / `saveButton` / `input` / `inputError` /
`fieldErrorText` are duplicated nearly verbatim between `home.tsx` and
`trip-details.tsx`. Extract to:
- `components/AppButton.tsx` (variants: primary / secondary / danger, with the
  built-in loading state added in commit `2ff9d35`)
- `components/FormField.tsx` (label + input + inline error)
- `components/AppModal.tsx` (overlay + sheet + keyboard handling)

This also means dark mode only has to be applied once per component, not once
per screen — a significant multiplier on Change 5.

### 3.4 Elevation consistency
Shadow values are currently ad-hoc (`shadowOpacity` ranges 0.08–0.4). Define
`Elevation.sm/md/lg` and apply.

### 3.5 Screen-level polish
- **Login** — currently a bare centred form. Add the logo (Change 4), a subtitle,
  and more vertical rhythm.
- **Tab bar** — currently default styling. Add a custom height, icon/label
  spacing, and a subtle top border.
- **Trip details header** — flat blue block; consider a gradient or the trip
  destination as a subtle background treatment.
- **Haptics** — `components/haptic-tab.tsx` exists but is unused; wire it into
  the tab bar and key actions (`expo-haptics` is already a dependency).
- **Social feed** (`social.tsx`, 890 lines) — has no pull-to-refresh and no
  empty state; both were added elsewhere in commit `2ff9d35` and should be
  brought in line.

### 3.6 Motion
Add `LayoutAnimation` or `react-native-reanimated` transitions for list inserts
and modal open/close. Small effort, disproportionate perceived-quality gain.

---

## Change 4 — Logo placement

### 4.1 Asset preparation (blocking)
`traveleria_logo.png` is **RGB with no alpha and a baked white background**. Before
use it needs:
- A **transparent-background** variant (remove the white matte).
- A **trimmed** variant (crop the surrounding whitespace) for inline placement.
- A **square 1024×1024** variant for the app icon.
- Ideally a **light-on-dark** variant, or a monochrome/white version, for dark mode.

Produce: `assets/images/logo-full.png` (wordmark + boot), `assets/images/logo-mark.png`
(boot only, square), `assets/images/logo-full-dark.png`.

> This is image editing, not code — it needs a design tool or a background-removal
> pass. Flagging as a dependency rather than something that falls out of the code changes.

### 4.2 Placements
| Location | Asset | Notes |
|---|---|---|
| Login screen (`app/index.tsx`) | `logo-full` | Above the title; likely replaces the plain "Traveleria" text |
| Login splash/session-check state | `logo-mark` | The gate added in `2ff9d35` currently shows text + spinner |
| Signup header (`app/signup.tsx`) | `logo-mark` | Small, in the header bar |
| App icon (`app.json`) | `logo-mark` square | Replaces the Expo default `icon.png` |
| Splash screen (`app.json`) | `logo-mark` | Replaces `splash-icon.png`; set `dark.image` too |
| Android adaptive icon | `logo-mark` **with alpha** | `foregroundImage` requires transparency |
| Profile default avatar | `logo-mark` | Optional; currently a generic person icon |

### 4.3 Implementation notes
- Use `expo-image` (already a dependency) rather than RN `Image` for better
  caching and transitions.
- Always set explicit `width`/`height` or `contentFit="contain"` — the source is
  3:2, so unconstrained rendering will distort.
- Consider downscaling; 676 KB is heavy for an inline logo.

---

## Change 5 — Dark mode

**Scope reality check:** ~240 colour literals across 9 screens, none currently
theme-aware. This is the largest item on the list. It is much cheaper *after*
Phase 0 and 3.3.

### 5.1 Infrastructure
1. `constants/theme.ts` from Phase 0 (light + dark palettes).
2. `hooks/use-theme-color.ts` already exists and will start working once
   `constants/theme.ts` exists — no rewrite needed.
3. Add `contexts/ThemeContext.tsx` exposing `{ scheme, setScheme }` with three
   modes: `system` / `light` / `dark`, persisted to `AsyncStorage` (already a
   dependency, and the pattern is already used in `wallet.tsx` and `profile.tsx`).
4. `app.json` already has `"userInterfaceStyle": "automatic"` — correct, no change.
5. The splash screen already defines a `dark.backgroundColor` — correct.

### 5.2 Migration approach
Convert `StyleSheet.create({...})` statics into a `useMemo`'d factory per screen:

```tsx
const colors = useThemeColors();
const styles = useMemo(() => makeStyles(colors), [colors]);
```

Suggested order (simplest → hardest, so the pattern is proven early):
1. `app/index.tsx` (9 literals)
2. `app/edit-profile.tsx` (9)
3. `app/signup.tsx` (12)
4. `app/(tabs)/social.tsx` (33)
5. `app/(tabs)/wallet.tsx` (39) — note: was *deliberately* made white in
   `48ad40f`; dark mode should restore a proper dark variant
6. `app/(tabs)/profile.tsx` (39)
7. `app/(tabs)/home.tsx` (40)
8. `app/trip-details.tsx` (70)

### 5.3 Things that need explicit attention
- **`StatusBar`** — `wallet.tsx` currently hardcodes `style="dark"`. Must become
  theme-driven, or the status bar becomes unreadable in dark mode.
- **Tab bar / navigation** — pass a React Navigation theme in
  `app/(tabs)/_layout.tsx` and `app/_layout.tsx`, otherwise nav chrome stays light.
- **Map** (`trip-details.tsx`) — `react-native-maps` needs a dark
  `customMapStyle`, it will not follow automatically.
- **WebView** (`wallet.tsx` document viewer) — renders third-party documents;
  keep the container light, do not attempt to invert.
- **Google Places autocomplete** (`trip-details.tsx`) — its dropdown styling is
  passed via a `styles` prop and must be themed explicitly.
- **The logo** — needs the dark variant from Change 4.
- **Toggle UI** — add a Light/Dark/System selector to the profile screen.

### Acceptance criteria
- Every screen is legible in both themes, with no white-on-white or black-on-black.
- Switching theme takes effect immediately without an app restart.
- The choice persists across restarts.
- `System` mode follows the OS setting live.

---

## Recommended sequencing

| Phase | Contents | Rationale |
|---|---|---|
| **0** | Design tokens, `constants/theme.ts`, `app.json` fix | Unblocks 3 and 5; fixes 2 standing TS errors |
| **1** | Change 1 (calendar) | Self-contained, quick visible win |
| **2** | Change 4 asset prep + login/signup placement | Asset work can run in parallel with code |
| **3** | Change 3.1–3.3 (typography, scales, shared components) | Biggest perceived-quality gain; halves Change 5's cost |
| **4** | Change 5 (dark mode) | Cheapest once components are extracted |
| **5** | Change 2 (profile fields) | Needs backend coordination; schedule around the AWS migration |
| **6** | Change 3.4–3.6 (elevation, screen polish, motion) | Final polish |

Changes 1, 3, 4 and 5 are **frontend-only** and can ship on a feature branch
without touching AWS. Change 2 is the only one requiring a deploy.

---

## Risks & open questions

1. **Backend is currently unreachable.** The API Gateway URL in the frontend
   `.env` no longer resolves, so trip/profile flows cannot be tested end-to-end
   until it is redeployed. Changes 1–5 can all be *built* without it, but
   Change 2 cannot be *verified*.
2. **`aws-account-migration` branch is in flight** — a teammate has migrated RDS
   to a new AWS account. Change 2's migration must target the correct database.
3. **Logo asset preparation is a design task**, not a coding one, and blocks
   parts of Change 4.
4. **Dark mode + the deliberate white Wallet** — `48ad40f` intentionally made the
   Wallet white. Confirm the intent is "white in light mode, dark in dark mode"
   rather than "always white".
5. **Custom font choice** needs a decision (licence + file size).
6. **Testing** — the project has no test suite; all verification to date has been
   `tsc --noEmit`, ESLint, and `expo export`. A visual regression pass on a real
   device is advisable for Change 5 given its breadth.

---

## Incidental fixes to fold in

Found during the audit, cheap to fix alongside the above:

- `app.json` trailing comma (invalid strict JSON).
- Missing `constants/theme.ts` → 2 standing TypeScript errors.
- Unescaped quotes in `trip-details.tsx` empty state → 2 standing ESLint errors.
- Unused Expo template files (`hello-wave.tsx`, `parallax-scroll-view.tsx`,
  `react-logo*.png`, `partial-react-logo.png`) → delete or adopt.
- `social.tsx` still renders entirely from `constants/socialMockData.ts` with no
  API integration.
