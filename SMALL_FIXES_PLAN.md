# Traveleria — Small Fixes Plan (Round 2)

Implementation plan for five requested fixes, based on an audit of the current
code on branch `small-fixes-round-2` (branched from `dev`, 2026-08-31).

Nothing has been implemented yet. This document is the agreement on *what* and
*how* before any code is written.

---

## Will the API URL change? — No.

The invoke URL is built as
`https://{API_ID}.execute-api.us-east-1.amazonaws.com/prod`, and `API_ID` is
minted by exactly one command: `aws apigateway create-rest-api`. Nothing in
this plan runs it.

What each deploy step does and does not touch:

| Command | Touches the URL? |
|---|---|
| `aws lambda update-function-code` | **No.** Replaces the function's zip. The API Gateway integration points at the Lambda by ARN (by name, not by version), so new code is live on the next request. |
| `python scripts/init_db.py` | **No.** Talks to RDS directly; never touches AWS APIs. |
| `aws apigateway create-deployment` | **No.** Republishes existing routes to the `prod` stage. Same API ID, same URL. Not needed here anyway — this plan adds no routes. |
| `aws apigateway delete-rest-api` | **Yes — this is the one that breaks it.** Only `deploy_cloudshell.sh` calls it. |

So: `EXPO_PUBLIC_API_URL` in `traveleria/.env` stays exactly as it is, and no
EAS update is needed to carry a new URL to installed apps.

**The single rule to hold to: never run `deploy_cloudshell.sh`.** It calls
`delete-rest-api` then `create-rest-api`, which mints a new ID and silently
breaks every installed build. It is only ever correct for a first-time rebuild
from nothing.

This is also the reason change 3 (bulk delete) fans out over the existing
per-event route instead of adding a `/bulk-delete` one — see §3.

---

## Summary

| # | Change | Layers touched | Deploy needed | Effort |
|---|--------|----------------|---------------|--------|
| 1 | Pick **date + time** when adding an event, limited to the trip's dates | Frontend + `itinerary` Lambda | Lambda code update | Medium |
| 2 | Order events by day+time, with a header per trip day (incl. empty ones) | Frontend only | — | Small–Medium |
| 3 | Multi-select events and delete them in one action | Frontend only | — | Small–Medium |
| 4 | "Resend code" after 60s on the signup verification screen | Frontend only | — | Small |
| 5 | Interests as a chip picker with "Other", like Preferred Nutrition | Frontend + `users` Lambda + DB migration | Lambda code update + migration | Medium |

**Sequencing:** 1 → 2 → 3 (each builds on the previous), then 4 and 5 in any
order. 4 and 5 are independent of 1–3 and could be done first if you want an
early, low-risk win.

---

## Audit findings that shape this plan

Measured from the code, not assumed:

1. **Every event currently lands on the trip's first day.**
   `shared/utils.py::get_or_create_default_trip_day()` returns the earliest
   `trip_days` row for the trip and creates one at `trips.start_date` if none
   exists. `POST /trips/{id}/itinerary` never looks at a requested date. So the
   `trip_days` table exists and is correct in shape, but in practice holds
   exactly one row per trip.

2. **The itinerary API never returns the day.** `_get_itinerary()` selects
   `dp.visit_time`, notes, and place fields — but not `td.day_date`. It already
   `ORDER BY td.day_date, dp.visit_time`, so the ordering is right; the client
   just cannot *see* the day. Change 1 must add it to the payload.

3. **The client re-sorts by time only.** `trip-details.tsx::sortByTime()` does
   `a.time.localeCompare(b.time)`. Once events span days this is wrong and must
   become a day-then-time comparison.

4. **`DD.MM.YYYY` is the established wire format** for trip dates
   (`shared/utils.py::parse_trip_dates` / `format_trip_date`, and
   `utils/validation.ts::formatDate` / `parseDate`). Change 1 should use the
   same format for the per-event date rather than inventing an ISO variant.

5. **`DateRangePicker` is a *range* picker.** It hardcodes two-tap
   start/end logic and `markingType="period"`. Change 1 needs a *single-day*
   picker bounded by the trip, so this is a new component — but the calendar
   theme block, and the `toKey` / `fromKey` helpers, should be shared rather
   than copy-pasted.

6. **Recreating the API Gateway breaks the app.** Per
   `deploy_cloudshell.sh`, the script calls `delete-rest-api` and mints a new
   invoke URL, which invalidates `EXPO_PUBLIC_API_URL`. **This plan therefore
   adds no new API routes.** Everything reuses the five existing resources
   (`/trips`, `/trips/{trip_id}/itinerary`, `/trips/{trip_id}/itinerary/{event_id}`,
   `/users/me`, `/chat`). Shipping is `aws lambda update-function-code` on a
   single function.

7. **`users.interests` is a plain `TEXT` column** (`sql/002_user_profile.sql`),
   comma-split on the client in `profile.tsx:77`. `users.dietary` is a
   `TEXT[]` with a CHECK constraint (`sql/004_user_preferences.sql`). Change 5
   should follow the `dietary` pattern, because that's the decision this
   codebase already made for exactly this shape of data.

8. **Amplify v6 is installed** (`aws-amplify@^6.16.3`), which exports
   `resendSignUpCode` — change 4 needs no AWS console work at all. See §4.

---

## 1. Pick date **and** time when adding an event

### Goal
The event form's "Time" field becomes a "When" field that captures a day *and*
a time in one flow. Only days inside the trip's date range are selectable. The
day is picked on a calendar that looks like the trip-creation calendar; the
time is picked on the same scroll wheel as today.

### UX flow
One field in the New/Edit Event modal:

```
When
┌────────────────────────────────────┐
│  Tue, 12 Aug 2026 · 14:30          │   ← or "Select date and time"
└────────────────────────────────────┘
```

Tapping it opens a two-step modal:

- **Step 1 — day.** Calendar constrained to the trip range. Confirm advances
  to step 2. Cancel closes with no change.
- **Step 2 — time.** The existing `DateTimePickerModal` spinner. Confirm sets
  *both* values at once. Back returns to step 1; cancel closes with no change.

Committing both values only on the final confirm keeps the field atomic — a
half-set "date but no time" state never reaches the form.

**Default day:** the trip's start date if the trip is in the future, otherwise
today when today falls inside the range. This means the common case ("add
something to today") is one tap.

### Frontend changes

**New — `traveleria/utils/calendar.ts`**
Move the date-key helpers out of `DateRangePicker.tsx` so both pickers share
one implementation:
```ts
toKey(d: Date): string          // Date -> "YYYY-MM-DD" (react-native-calendars key)
fromKey(key: string): Date
datesBetween(start, end): string[]
```
`DateRangePicker.tsx` then imports them instead of defining them.

**New — `traveleria/components/CalendarTheme.ts`** (or export a
`makeCalendarTheme(colors)` from `calendar.ts`)
Extract the ~15-line `theme={{ ... }}` object currently inline in
`DateRangePicker.tsx` so the two calendars cannot drift apart visually. This is
the smallest change that satisfies "the same as the date picker in trip
creation".

**New — `traveleria/components/TripDayTimePicker.tsx`**
Props:
```ts
{
  visible: boolean;
  tripStart: Date;
  tripEnd: Date;
  initialDate: Date | null;   // currently selected day, if editing
  initialTime: string;        // "HH:MM", or "" when unset
  onConfirm: (date: Date, time: string) => void;
  onCancel: () => void;
}
```
Implementation notes:
- Bound the calendar with `minDate={toKey(tripStart)}` and
  `maxDate={toKey(tripEnd)}` — this is what makes out-of-trip days
  untappable, and `textDisabledColor` already greys them out.
- Also pass `disableAllTouchEventsForDisabledDays` so a stray tap outside the
  range is fully inert, not just visually muted.
- `markingType="custom"` (or plain `selected: true`) for the single chosen day.
  The `period` marking used by the range picker is not appropriate here.
- Reuse `parseTime()` from `utils/validation.ts` to seed the spinner, exactly
  as `trip-details.tsx` does today.

**`traveleria/app/trip-details.tsx`**
- Derive the trip bounds once:
  ```ts
  const tripRange = useMemo(() => parseDateRange(String(date ?? "")), [date]);
  ```
  If `tripRange` is `null` (screen opened without the `date` param), fall back
  to an unbounded calendar rather than crashing — the header already assumes
  the param is present, so this is a defensive branch only.
- Replace `newTime` state with `newTime` **and** `newDate: Date | null`.
- `resetEventForm()` clears `newDate` too.
- `openEditModal()` seeds `newDate` from `parseDate(event.date)`.
- Validation: add `date: !newDate ? "Please choose a date." : undefined` to
  `EventFieldErrors`; keep the existing time check. Both errors can render
  under the single "When" field.
- Send `date: formatDate(newDate)` in the POST/PUT body.
- Replace the `DateTimePickerModal` block with `<TripDayTimePicker …>`.

### Backend changes — `lambdas/itinerary/handler.py` + `shared/utils.py`

**`shared/utils.py` — new helper** (alongside, not replacing,
`get_or_create_default_trip_day`):
```python
def get_or_create_trip_day_for_date(db, trip_id, owner_user_id, day_date):
    """
    Resolves the trip_days row for one calendar date, creating it on demand.
    Rejects dates outside the trip's own start/end range.
    """
```
Behaviour:
1. `SELECT start_date, end_date FROM trips WHERE id=%s AND owner_user_id=%s`
   → `AppError("Trip not found", 404)` when missing. This is also the
   ownership check, so it must stay before any write.
2. `if not (start_date <= day_date <= end_date): raise AppError("Event date must fall inside the trip dates")`
   — the server must enforce this too, not just the calendar's `minDate`.
3. `INSERT INTO trip_days (trip_id, day_date) VALUES (%s,%s) ON CONFLICT (trip_id, day_date) DO UPDATE SET updated_at=NOW() RETURNING id`
   — the existing `trip_days_trip_date_unique` constraint makes this a safe
   one-statement upsert with no read-then-write race. (`DO UPDATE` rather than
   `DO NOTHING` because `DO NOTHING` returns no row.)

Also add a `parse_event_date(value)` helper next to `parse_trip_dates`, raising
`AppError("Event date must use the format DD.MM.YYYY")` on bad input.

**`_get_itinerary`** — add `td.day_date` to the SELECT and
`"date": row["day_date"].strftime("%d.%m.%Y")` to each serialized item. The
`ORDER BY td.day_date, dp.visit_time, p.name` clause is already correct.

**`_create_item`** — when `body` carries a `date`, resolve the trip day with
the new helper; when it does not, keep calling
`get_or_create_default_trip_day`. Echo the resolved date back in the
`item` payload so the client's optimistic insert has it. Keeping the fallback
means older installed clients keep working through the update, and it costs
three lines.

**`_update_item`** — after the existing ownership check, if `body` has a
`date`, resolve the target trip day and add `trip_day_id=%s` to the
`UPDATE day_places SET …`. That is the whole "move an event to another day"
operation; no delete/re-insert is needed.

> **Note on empty days.** Moving the last event off a day leaves an orphan
> `trip_days` row. That is harmless — `_get_itinerary` joins *from*
> `day_places`, so an empty day is invisible. Not worth a cleanup pass.

### Data & compatibility
- **No migration.** `trip_days` and `day_places.trip_day_id` already model this.
- **Existing events** keep whatever `trip_day_id` they have — the trip's first
  day — and will now correctly display under that day's header. Nothing is
  orphaned and no backfill is needed.
- **`UNIQUE (trip_day_id, place_id)`** is not a hazard: `_create_item` inserts a
  fresh `places` row (`google_place_id = f"manual:{uuid4()}"`) for every event,
  so two events on the same day never share a `place_id`.

### Deploy
```bash
aws lambda update-function-code --function-name traveleria-itinerary --zip-file fileb://zips/lambda_itinerary.zip --region us-east-1 --no-cli-pager
```
(Built the same way as the `traveleria-users` recipe: stage `deps` + `shared` +
`lambdas/itinerary/handler.py` as `lambda_function.py`, zip, upload. **Do not
run `deploy_cloudshell.sh`** — it recreates the API Gateway and changes the
invoke URL.)

### Manual test checklist
- Add an event on the trip's last day → appears under that day.
- Try to tap a day outside the range → not selectable.
- Edit an event and change only its day → it moves; time is preserved.
- Edit an event and change only its time → day is preserved.
- Cancel at the time step → the field keeps its previous value, not a half-set one.
- Pre-existing events created before this change still render and still edit.

---

## 2. Order events by day and time, with day separators

### Goal
The daily plan reads as the shape of the whole trip — **every trip day gets a
header, including days with nothing on them** — and each day's events sit in
time order beneath it.

```
┌────────────────────────────────────────────┐
│  DAY 1  ·  Tue, 12 Aug           2 events  │   ← sticky header
├────────────────────────────────────────────┤
│  09:00 │ Colosseum                         │
│  14:30 │ Trastevere lunch                  │
├────────────────────────────────────────────┤
│  DAY 2  ·  Wed, 13 Aug                     │
├────────────────────────────────────────────┤
│      ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐       │
│        ✦  Nothing planned yet              │   ← tappable
│        Tap to add something to this day    │
│      └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘       │
└────────────────────────────────────────────┘
```

### The empty-day design

Showing a bare "Nothing planned" line would read as a dead end. Three details
turn it into the most useful element on the screen:

1. **It is the primary call to action, not a message.** The whole placeholder
   is a `TouchableOpacity` that opens the New Event modal **with that day's
   date already selected** — so adding to day 4 is one tap, not "tap Add, then
   open the calendar, then find day 4". This is the payoff for having built the
   date picker in change 1, and it is why change 2 comes after it.
2. **It recedes visually.** A dashed 1px `colors.border` outline on a
   transparent background — not a filled `colors.surface` card. Filled cards
   read as content; an outline reads as a slot waiting to be filled. Empty days
   must not out-shout the real events next to them, which matters on a 14-day
   trip that is mostly empty.
3. **Copy is invitational, not accusatory.** *"Nothing planned yet"* with a
   muted `colors.textMuted` sub-line *"Tap to add something to this day"* — the
   "yet" does real work. No warning icon; a light `sparkles-outline` or
   `add-circle-outline` in `colors.textDisabled`.

Height is roughly half an event card, so empty days compress and a mostly-empty
trip stays scannable.

**Day headers** carry `DAY {n}` (position in the trip, so "day 3 of the trip"
is answerable at a glance) alongside `Tue, 12 Aug`, with a right-aligned count
(`2 events`) that is simply omitted when zero — the placeholder below already
says so, and repeating "0 events" is noise.

**Brand-new trip (zero events anywhere):** still show all the day headers with
placeholders — the structure is the point, and every day is now a one-tap
target. The existing onboarding line moves to a `ListHeaderComponent` shown
only while `itinerary.length === 0`, so its guidance is not lost.
(`ListEmptyComponent` will never fire once every trip day is a section, which
is the one non-obvious consequence of this decision.)

### Changes — frontend only

**New — `traveleria/utils/itinerary.ts`**
```ts
export type ItineraryEvent = { id: string; date: string; time: string; /* … */ };
export type DaySection = {
  title: string;      // "Tue, 12 Aug"
  dayNumber: number;  // 1-based position in the trip
  date: Date;
  data: ItineraryEvent[];   // empty for a day with nothing planned
};

/** Sort key that orders by calendar day first, then clock time. */
export const eventSortKey = (e: ItineraryEvent) =>
  `${parseDate(e.date)?.getTime() ?? 0}|${e.time}`;

/**
 * One section per trip day, days ascending, empty days included.
 * `tripRange` is null when the screen was opened without a date param —
 * then only days that actually have events are returned.
 */
export function groupEventsByDay(
  events: ItineraryEvent[],
  tripRange: { start: Date; end: Date } | null,
): DaySection[];
```

Two details that are easy to get wrong:

- **Sort on parsed timestamps, never on the display string.** `"02.09.2026"`
  sorts before `"12.08.2026"` lexically. This is the one real trap in change 2.
- **Union the trip days with the event days.** An event can legitimately fall
  outside the current range — legacy rows, or a trip whose dates were edited
  after the fact. Building sections *only* from the trip range would make those
  events vanish from the list while still existing in the database. Take the
  union, so an out-of-range day still gets its own header.

**New — `formatDayHeader(d: Date)` in `utils/tripFormat.ts`**
`"Tue, 12 Aug"`. It belongs next to `formatTripDates` and reuses the existing
`MONTHS` array.

**`trip-details.tsx`**
- Delete `sortByTime`; sort with `eventSortKey` in `fetchItinerary` and in both
  optimistic-update branches of `handleAddEvent`.
- Swap the itinerary `FlatList` for a `SectionList` with
  `sections={groupEventsByDay(itinerary, tripRange)}` — reusing the `tripRange`
  memo already added in change 1 — plus `renderSectionHeader` and
  `renderSectionFooter`. `renderEventCard` is unchanged.
- Render the placeholder in **`renderSectionFooter`** when `section.data` is
  empty. (`SectionList` renders no rows for an empty section, so a footer is
  the correct hook — this is the standard RN idiom and avoids faking a
  placeholder row that selection mode in change 3 would then have to special-
  case.)
- `stickySectionHeadersEnabled` so the current day stays visible while
  scrolling a long trip.
- Tapping a placeholder calls `openAddModalForDate(section.date)` — a thin
  wrapper that does `resetEventForm()`, `setNewDate(section.date)`,
  `setIsModalVisible(true)`.

### Manual test checklist
- 5-day trip with events on days 1 and 4 → five headers, three placeholders.
- Tap the day-3 placeholder → New Event modal opens with 3rd day pre-selected.
- Save it → the placeholder is replaced by the event, count reads `1 event`.
- Delete the only event on a day → the placeholder comes back.
- Brand-new trip → all headers + placeholders, plus the onboarding line on top.
- A trip spanning a month boundary (e.g. 28 Aug – 3 Sep) → days in correct
  order, *not* `02.09` before `28.08`.
- An event dated outside the trip range → still visible under its own header.

### Out of scope
Map view still shows all markers for the whole trip. Filtering the map by day
is a separate, larger change.

---

## 3. Multi-select events and delete in one action

### Goal
Enter a selection mode, tick several events, delete them all with one tap and
one confirmation.

### UX
- A **"Select"** text button appears in the Daily Plan header next to the
  map/add buttons. **Long-pressing** any event card also enters selection mode
  with that card already ticked (the standard mobile gesture).
- In selection mode:
  - Each card shows a checkbox (`ellipse-outline` / `checkmark-circle`) in
    place of its pencil and trash icons — per-card edit and delete are hidden,
    because tapping a card now toggles selection.
  - The header becomes: `Cancel` · **"3 selected"** · `Select all` · a trash
    button (disabled at zero selected).
  - The Add Event button and the chat FAB are hidden, so there is exactly one
    thing to do.
- Tapping the trash button confirms via `Alert`:
  *"Delete 3 events? This cannot be undone."*
- Deleting leaves selection mode and refreshes the list.

### Implementation — frontend only
**`trip-details.tsx`** state:
```ts
const [isSelecting, setIsSelecting] = useState(false);
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
const [isBulkDeleting, setIsBulkDeleting] = useState(false);
```
Guard rails worth writing down:
- Exiting selection mode always clears `selectedIds`, so a stale id can never
  survive into a later selection.
- Switching to map view or chat exits selection mode.
- `isBulkDeleting` disables the trash button, matching the existing
  `isSubmitting` pattern in the event form.

**The delete itself — reuse the existing per-event route.** No new endpoint:
```ts
const results = await Promise.allSettled(
  [...selectedIds].map((eventId) =>
    apiFetch(`/trips/${id}/itinerary/${eventId}`, { method: "DELETE" })),
);
```
Then remove only the ids whose request actually succeeded, and if any failed,
`Alert` with `"2 of 5 events could not be deleted."` and leave those selected
so the user can retry.

**Why not a bulk endpoint?** A `POST /trips/{id}/itinerary/bulk-delete` route
would need a new API Gateway resource, and per finding 6 the only script that
builds routes also destroys and recreates the API — changing the invoke URL and
breaking the app. Fanning out over the existing route costs N requests for a
list that realistically holds 5–30 events, is already authorized per-event by
the handler's ownership check, and needs zero backend deployment. If bulk
delete ever needs to be atomic, the right move is a hand-added API Gateway
resource, not a rerun of the deploy script.

**Note:** partial failure is possible by design here. That is the honest
trade-off for avoiding a new route, and the UI reports it rather than hiding it.

### Manual test checklist
- Select 3 of 5, delete → exactly those 3 disappear; the other 2 remain.
- Select all, delete → empty state renders.
- Cancel selection → pencil/trash icons come back on every card.
- Long-press a card → selection mode with that card ticked.
- Kill the network mid-delete → partial-failure alert, list stays consistent
  with the server after a pull-to-refresh.

---

## 4. "Resend code" on the signup verification screen

### The short answer to your question
**No AWS lab or Cognito console work is needed.** Cognito already exposes a
`ResendConfirmationCode` API on every user pool app client, and it is enabled by
default — the same one that sent the first code. Amplify v6 (already installed,
`aws-amplify@^6.16.3`) wraps it as `resendSignUpCode`. This is a **frontend-only
change**.

The one thing worth checking in the console: whether your pool sends email via
**Cognito's default sender** or **Amazon SES**. The default sender is capped at
~50 emails per day for the whole pool, which a resend button makes easier to
hit while testing. If you run into it, switching the pool to SES lifts the cap.
Not a blocker for shipping this.

### UX
On the "Confirm Your Account" screen, below the code field:

- **First 60 seconds:** disabled grey text — *"Didn't get it? Resend in 43s"*,
  counting down each second.
- **After 60s:** an enabled `AppButton variant="ghost"` — *"Resend code"*.
- **On tap:** shows a spinner, then *"A new code is on its way to
  name@example.com."* and restarts the 60s countdown.
- The timer starts when the verification screen first appears (i.e. when
  `isRegistered` flips to `true`), not on mount of the signup form.

### Changes

**`traveleria/services/authService.ts`** — mirror the existing wrappers exactly:
```ts
import { resendSignUpCode } from "aws-amplify/auth";

export const resendVerificationCode = async (email: string) => {
  try {
    const { destination, deliveryMedium } = await resendSignUpCode({ username: email });
    return { success: true, destination, deliveryMedium };
  } catch (error) {
    return { success: false, error };
  }
};
```

**New — `traveleria/hooks/useCountdown.ts`**
A small `useCountdown(seconds)` returning `{ secondsLeft, restart }`, driven by
a single `setInterval` cleared on unmount. Keeping it out of the screen keeps
`signup.tsx` readable and makes the timer reusable if login ever needs it.

**`traveleria/app/signup.tsx`**
- Start the countdown when `isRegistered` becomes `true` (a `useEffect` on that
  flag) and after each successful resend.
- Add `isResending` state so the resend button can't be double-tapped — same
  pattern as the existing `isSubmitting`.
- Extend the error mapping already in `handleSignup` to cover resend:
  - `LimitExceededException` → *"Too many attempts. Please wait a few minutes
    before requesting another code."*
  - `TooManyRequestsException` → same message.
  - `UserNotFoundException` → *"We couldn't find that account. Please sign up
    again."*
  - `NotAuthorizedException` → *"This account is already verified. Try logging
    in."* (Cognito returns this when the user was confirmed in the meantime.)
  - Anything else → the generic message.
  Pull this mapping into a small `cognitoErrorMessage(error)` helper, since
  `handleSignup`, `handleVerify`, and the new resend handler all need it and
  it's currently inlined once.

### Why 60 seconds
It is long enough that most delivered emails arrive first (so the button isn't
tapped reflexively and wasted), and short enough not to feel stuck. Cognito's
own throttling is stricter than one call per minute in bursts, so the countdown
also keeps most users away from `LimitExceededException` entirely.

### Manual test checklist
- Sign up → countdown starts at 60 and ticks down.
- Button is untappable until it reaches 0.
- Tap resend → new email arrives; countdown restarts.
- Enter the **old** code after a resend → rejected (expected; Cognito
  invalidates the previous code).
- Enter the **new** code → verifies.
- Spam resend to trigger `LimitExceededException` → friendly message, app does
  not crash.

---

## 5. Interests as a chip picker with "Other"

### Goal
Interests behave like Preferred Nutrition — a multi-select chip group — plus an
"Other" affordance for anything not on the list.

### UX
```
Interests
Pick anything you enjoy — we'll use it to suggest activities.

[Food & dining] [Museums] [Hiking] [Nightlife] …          ← preset chips
[Birdwatching ×] [Vintage cars ×]                          ← your own, removable
[ + Other ]                                                ← opens a text input
```
Tapping **+ Other** reveals a `FormField` with an "Add" button; submitting
appends a custom chip and clears the input. Custom chips carry an `×` to
remove them (preset chips just toggle off, as dietary chips do today).

Guard rails, enforced in the UI *and* the API:
- Trim whitespace; ignore empty input.
- Reject a custom entry that duplicates a preset label or an existing custom
  entry, case-insensitively.
- Max 30 characters per entry, max 20 entries total.

### Proposed interest options

24 values, chosen to cover the ways people actually plan a trip. Values are
stable snake_case identifiers; labels are what the user sees.

| Value | Label |
|---|---|
| `food_dining` | Food & dining |
| `street_food` | Street food |
| `wine_breweries` | Wine & breweries |
| `nightlife` | Nightlife |
| `museums` | Museums |
| `art_galleries` | Art & galleries |
| `history_heritage` | History & heritage |
| `architecture` | Architecture |
| `religious_sites` | Religious sites |
| `live_music` | Live music |
| `festivals` | Festivals & events |
| `shopping` | Shopping |
| `local_markets` | Local markets |
| `nature_parks` | Nature & parks |
| `hiking` | Hiking |
| `beaches` | Beaches |
| `water_sports` | Water sports |
| `winter_sports` | Skiing & snowboarding |
| `cycling` | Cycling |
| `wildlife` | Wildlife |
| `photography` | Photography |
| `wellness_spa` | Spa & wellness |
| `theme_parks` | Theme parks |
| `sports_events` | Sports events |

Say the word if you want any added, dropped, or relabelled — this list is the
cheapest thing in the plan to change, and it should be changed *before*
implementation, because the values become rows in the database.

### Storage decision

Migrate `users.interests` from `TEXT` to `TEXT[]`, matching `users.dietary`.

**Why not keep the comma-separated `TEXT`?** Because a custom interest could
itself contain a comma ("food, glorious food"), which silently splits into two
tags on the way out. The array has no such ambiguity, `psycopg` maps it to a
Python list with no parsing, and — decisively — the codebase already made this
exact call for `dietary` and documented the reasoning in
`sql/004_user_preferences.sql`. Two similar fields stored two different ways is
the thing to avoid.

**Preset vs custom values are not distinguished in storage.** A preset is
stored as its slug (`museums`), a custom entry as its raw text
(`Birdwatching`). `interestLabel(value)` looks the value up in the preset table
and falls back to returning it verbatim, so the render path is total. The only
way to confuse it is for a user to type a string that is *exactly* a preset
slug — harmless, and not worth a `custom:` prefix that both layers would then
have to parse.

**No CHECK constraint**, unlike `dietary` — "Other" means the allowed set is
open by definition. Validation lives in the `users` Lambda instead (§ below).

### DB migration — new `sql/005_user_interests.sql`

`scripts/init_db.py` replays every `sql/*.sql` on each run, so the file must be
idempotent. A type change can't use `IF NOT EXISTS`, so guard it on the current
column type:

```sql
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'interests'
          AND data_type = 'text'
    ) THEN
        ALTER TABLE users ALTER COLUMN interests DROP DEFAULT;
        ALTER TABLE users
            ALTER COLUMN interests TYPE TEXT[]
            USING CASE
                WHEN interests IS NULL OR btrim(interests) = '' THEN '{}'::TEXT[]
                ELSE (
                    SELECT COALESCE(array_agg(btrim(part)), '{}')
                    FROM unnest(string_to_array(interests, ',')) AS part
                    WHERE btrim(part) <> ''
                )
            END;
        UPDATE users SET interests = '{}' WHERE interests IS NULL;
        ALTER TABLE users ALTER COLUMN interests SET DEFAULT '{}';
        ALTER TABLE users ALTER COLUMN interests SET NOT NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_interests ON users USING GIN (interests);
```

The `USING CASE` clause is the important part: it **preserves existing
free-text interests as custom tags** rather than dropping them. A user who
typed "Shopping, Hiking, Art" ends up with three custom chips, and can convert
them to presets by re-picking. No data is lost.

The whole block runs once; on every later `init_db.py` run the `IF EXISTS`
guard is false and it is a no-op.

Run it locally — RDS is reachable over the public internet, so no AWS access is
needed:
```bash
traveleria-backend/.venv/Scripts/python.exe scripts/init_db.py
```

### Backend — `lambdas/users/handler.py`

Mirror the existing `_clean_dietary`:

```python
MAX_INTERESTS = 20
MAX_INTEREST_LENGTH = 30

def _clean_interests(body):
    """Absent means "leave unchanged"; an empty list clears the selection."""
```
Rules: must be a list; every entry a non-empty string after trimming;
`len(entry) <= 30`; `len(list) <= 20`; reject control characters; de-duplicate
case-insensitively while preserving the order the user picked. Raise `AppError`
with a readable message on each violation, so the client's existing
`data.detail` surfacing in `edit-profile.tsx` shows something useful.

`_get_profile` returns `row["interests"] or []` (matching how `dietary` is
handled). `_update_profile` passes the cleaned list through the existing
`COALESCE` — no SQL restructuring needed, because `COALESCE` already gives the
"absent means unchanged, empty list means clear" semantics for arrays.

**Compatibility note:** after this migration, `PATCH /users/me` with
`interests` as a *string* will fail validation. The only caller is
`edit-profile.tsx`, which ships in the same change, so the window is the app-
update window. Worth being explicit about since the Lambda and the app deploy
separately: **deploy the migration and the `users` Lambda together, then push
the app update.** A user on the old app build between those two steps would see
"interests must be a list" on save — brief and recoverable, but real.

Deploy:
```bash
aws lambda update-function-code --function-name traveleria-users --zip-file fileb://zips/lambda_users.zip --region us-east-1 --no-cli-pager
```

### Frontend

**`constants/profileOptions.ts`**
- Add `INTEREST_OPTIONS` (the 24 above), following the existing comment
  convention that names the backend and SQL files it must stay in step with.
- Add `parseInterests(raw)` (identical in shape to `parseDietary`) and
  `interestLabels(raw)` — the latter falling back to the raw string for
  custom entries, per the storage decision above.

**`components/OptionSelector.tsx`**
Add a third export, `ChipMultiSelectWithOther`, that composes the existing
`ChipMultiSelect` with a removable-custom-chip row and an inline add field.
`ChipMultiSelect` itself is not modified — dietary keeps using it unchanged, so
change 5 cannot regress the feature shipped in
[#12](https://github.com/Danielin322/Traveleria/pull/12).

**`app/edit-profile.tsx`**
- Replace the free-text `FormField label="Interests (separated by commas)"`
  with a `<View style={styles.group}>` block matching the Preferred Nutrition
  block exactly (label + hint + selector).
- `interests` state becomes `string[]`, parsed from the router param the same
  way `dietary` already is (`JSON.parse` in a `try/catch`).
- Send `interests` as an array in the PATCH body.

**`app/(tabs)/profile.tsx`**
- `interests` state stays `string[]`, but drop the `.split(",")` on line 77 —
  the API now returns an array. Use `parseInterests(data.interests)`.
- Render with `interestLabels(userData.interests)`, exactly like the
  `dietaryLabels` block directly above it.
- `handleEditNavigate` passes `interests: JSON.stringify(userData.interests)`
  instead of `.join(", ")`.

### Manual test checklist
- Existing account with `"Shopping, Hiking, Art"` → after migration shows three
  chips, all removable.
- Pick 3 presets + add "Birdwatching" → save → reopen → all 4 persist.
- Add a duplicate (different case) → rejected with a message, not silently added.
- Clear every interest → saves as empty, profile shows the empty state.
- Add a 31-character entry → rejected client-side before the request goes out.

---

## Suggested commit sequence

Small, reviewable commits — each one leaves the app working:

1. `Extract shared calendar helpers and theme` (refactor only, no behaviour change)
2. `Add date to itinerary API` (backend; still works with the current app)
3. `Pick date and time when adding an event` (frontend, change 1)
4. `Group daily plan by day` (change 2)
5. `Select and bulk-delete events` (change 3)
6. `Add resend verification code` (change 4)
7. `Migrate interests to an array` (SQL + users Lambda, change 5 backend)
8. `Interests chip picker with custom entries` (change 5 frontend)

Commits 2 and 7 are the ones that need a Lambda deploy. Commit 7 also needs the
migration run first.

---

## Risks, ranked

| Risk | Where | Mitigation |
|---|---|---|
| Recreating the API Gateway breaks `EXPO_PUBLIC_API_URL` | Deploy | Plan adds **no new routes**; ship with `update-function-code` only. Never run `deploy_cloudshell.sh`. |
| Interests type change breaks old app builds mid-deploy | Change 5 | Deploy migration + Lambda together, then the app. Window is short and the failure is a readable error, not data loss. |
| Lexical date sorting puts `02.09` before `12.08` | Change 2 | Sort on parsed timestamps (`eventSortKey`), never on the display string. |
| Bulk delete partially fails | Change 3 | `Promise.allSettled`; remove only confirmed deletions; report the count that failed and keep them selected. |
| Cognito's 50-emails/day default sender cap | Change 4 | 60s countdown limits volume; switch the pool to SES if it becomes a problem in testing. |
| `parseDateRange(date)` returns null on a deep link | Changes 1 & 2 | Fall back to an unbounded calendar, and to days-with-events-only sections, instead of crashing. |
| Events outside the trip range vanish once sections are built from the range | Change 2 | Build sections from the **union** of trip days and event days. |

---

## Decisions taken (2026-08-31)

All four open questions are now answered — nothing is blocking implementation.

1. **Interest list** — the 24 options in §5 are approved as written.
2. **Empty days** — **show every trip day**, with a "Nothing planned yet"
   placeholder. Designed in §2: dashed outline, invitational copy, and tappable
   to open the New Event modal with that day pre-selected.
3. **Resend delay** — 60 seconds.
4. **Custom interests** — 20 entries / 30 characters each is approved.

### One consequence worth restating
Because change 2's empty-day placeholder opens the event modal with a
pre-selected date, **change 2 now depends on change 1 being finished first**.
The commit sequence below already has them in that order; it just matters more
than it did before.
