# Traveleria — Trip Co-Editing

Plan for sharing a single trip between several users. Re-audited on 2026-09-05
against `feature/co-editing` after the AI assistant merged (PR #18) and reached
this branch through `dev` (PR #19). **Nothing implemented yet.**

The assistant changes this feature more than any other part of the app: it is a
second writer on the itinerary, it has its own ownership checks, and its history
is already per user. [§7](#7-the-assistant-on-a-shared-trip) is the section to
read first if you have read the earlier draft.

Every open question from the previous round is now answered; the answers are
recorded under [Decisions on record](#decisions-on-record).

---

## What we are building

The owner of a trip adds another user's **email** to that trip's co-editing
list. That person sees an **invitation** they accept or decline. Once accepted:

* the trip appears in their trip list, sorted by date among their own trips
  and marked as shared;
* either of them can change the title, destination, dates, and events — by hand
  or through the assistant — and the other sees the change;
* each of them keeps their **own** conversation with the assistant.

---

## Summary

| # | Piece | Layers | Effort |
|---|-------|--------|--------|
| 1 | `trip_collaborators` table + invite-claim on sign-in | DB, `shared/auth.py` | Small |
| 2 | Access checks move from "owner" to "owner or collaborator" | `shared/utils.py` + **4 Lambdas** | **Medium — highest risk** |
| 3 | Members API (list / add / remove / leave) + ownership transfer | `trips` Lambda, 4 routes | Medium |
| 4 | Invitations screen (accept ✓ / decline ✕) | `trips` Lambda, 2 routes, new screen | Medium |
| 5 | Shared-trip card styling, members UI, Leave instead of Delete | Frontend + `constants/theme.ts` | Medium |
| 6 | Change propagation (refresh-on-focus) | Frontend | Small |
| 7 | Assistant: access, `get_itinerary` tool, tool loop, safe removal | `chat` Lambda + migration | **Medium–Large** |

Six new routes over five new API Gateway resources, all served by the existing
`traveleria-trips` Lambda. `scripts/add_routes.sh` gains one block; it is
additive and **the invoke URL does not change**. `deploy_cloudshell.sh` must not
be used.

---

## Audit findings

### 1. Ownership is hardcoded in twelve SQL statements across four Lambdas

`owner_user_id = %s` now appears in:

| File | Lines |
|---|---|
| [shared/utils.py](traveleria-backend/shared/utils.py) | [75](traveleria-backend/shared/utils.py:75), [132](traveleria-backend/shared/utils.py:132), [144](traveleria-backend/shared/utils.py:144) |
| [lambdas/trips/handler.py](traveleria-backend/lambdas/trips/handler.py) | [47](traveleria-backend/lambdas/trips/handler.py:47), [79](traveleria-backend/lambdas/trips/handler.py:79), [112](traveleria-backend/lambdas/trips/handler.py:112) |
| [lambdas/itinerary/handler.py](traveleria-backend/lambdas/itinerary/handler.py) | [48](traveleria-backend/lambdas/itinerary/handler.py:48), [95](traveleria-backend/lambdas/itinerary/handler.py:95), [137](traveleria-backend/lambdas/itinerary/handler.py:137) |
| [lambdas/chat/handler.py](traveleria-backend/lambdas/chat/handler.py) | [191](traveleria-backend/lambdas/chat/handler.py:191), [202](traveleria-backend/lambdas/chat/handler.py:202), [324](traveleria-backend/lambdas/chat/handler.py:324) |

The chat ones are new since the last draft and they matter: `_get_owned_trip`
gates **every** chat message and `_get_chat_history` gates the history load, so
until they change **a collaborator opening the chat on a shared trip gets a 404
before typing anything.**

The three in `shared/utils.py` are still the ones most likely to be missed —
`resolve_trip_day` and its two callees take a parameter literally named
`owner_user_id`, and the chat's `_add_itinerary_item` calls
`get_or_create_trip_day_for_date` directly
([chat/handler.py:294](traveleria-backend/lambdas/chat/handler.py:294)). Miss
them and a collaborator can read the itinerary but neither they nor their
assistant can add to it, with a 404 that reads like a routing bug.

### 2. The assistant deletes events by fuzzy name match, with no notion of who created them

`_remove_itinerary_item`
([chat/handler.py:311](traveleria-backend/lambdas/chat/handler.py:311)) matches
on `p.name ILIKE %<query>%` across the whole trip. One match is deleted
immediately — the `day_places` row **and** the `places` row. Several matches
return `ambiguous` and the model asks which.

On a solo trip that is fine. On a shared trip it means **B saying "drop the
museum" can silently delete an event A added**, with no confirmation and nothing
in the reply saying whose it was. This is the sharpest new edge the assistant
introduces, and [§7](#7-the-assistant-on-a-shared-trip) is mostly about it.

### 3. The assistant cannot currently see the itinerary at all

`_build_system_prompt` takes the trip's start date, end date, and the user's
profile — nothing else
([chat/handler.py:31](traveleria-backend/lambdas/chat/handler.py:31)), and
`_run_conversation` assembles `system + history + user message`
([chat/handler.py:236](traveleria-backend/lambdas/chat/handler.py:236)). **The
existing events are never sent to the model.**

So "the assistant can see all details in the trip", which you settled in the
last review, is not true of the code today. It cannot answer "what do I have on
day 2?" and it cannot reason about clashes. Sharing makes this more visible, not
less: on a shared trip the assistant would be blind to everything the other
person added. Costed in [§7](#7-the-assistant-on-a-shared-trip).

### 4. Chat history is already per (trip, user) — the requirement is met by the schema

`chat_messages` is keyed `(trip_id, user_id)`
([sql/009_chat_messages.sql](traveleria-backend/sql/009_chat_messages.sql)), and
both `_load_history` and `_get_chat_history` filter on **both** columns. Nothing
in this plan should widen that. The work is to keep it exactly as it is while
the *trip* around it becomes shared.

One consequence to be deliberate about: `chat_messages.trip_id` is
`ON DELETE CASCADE`, so when an owner deletes a shared trip, every
collaborator's conversation goes with it.

### 5. `useFocusEffect` is already the house pattern — on two screens out of four

[profile.tsx:103](traveleria/app/(tabs)/profile.tsx:103) and
[wallet.tsx:101](traveleria/app/(tabs)/wallet.tsx:101) both import it from
`expo-router` and refetch on focus. [home.tsx:384](traveleria/app/(tabs)/home.tsx:384)
and [trip-details.tsx:472](traveleria/app/trip-details.tsx:472) still use a
mount-only `useEffect`. Those two screens are exactly the ones that have to show
another person's edits, so §6 is "make the other two match", not "invent a
refresh strategy".

Note the import source: `@react-navigation/native` is **no longer a direct
dependency** after the SDK 57 upgrade (finding 8). `expo-router` is where
`useFocusEffect` comes from.

### 6. `CurrentUserContext` is a stub — and only the mock Social tab uses it

Id `"u_me"`, name `"Your Name"`, a pravatar URL
([contexts/CurrentUserContext.tsx](traveleria/contexts/CurrentUserContext.tsx)).
Its only consumers are `social.tsx` and the provider in `_layout.tsx`; every
comparison there is against `constants/socialMockData.ts`.

The previous draft proposed loading the real signed-in user into that context.
**Dropped** — it would rewire the mock Social tab for no benefit. The members
list needs to know which row is "you", and the server already knows: it returns
an `is_you` flag. No client-side identity plumbing at all.

### 7. The trip card's delete button is unconditional

[home.tsx:468](traveleria/app/(tabs)/home.tsx:468), and the same for select-all →
delete. A collaborator tapping it fires `DELETE /trips/{id}`, gets a 404, and
sees "could not be removed" with no explanation. The card must offer **Leave**
on a trip you do not own.

### 8. The SDK 57 upgrade has landed, so this branch is clean

`4e7aefd changed expo version to SDK57` is committed and the working tree is
clean: React Native 0.86, TypeScript 6.0, `(tabs)/_layout.tsx` importing from
`expo-router/js-tabs`. The previous draft asked for this to be settled before
starting — it is. Nothing here conflicts with it; the new work is one screen,
one component, one service and three theme tokens.

### 9. Smaller things, unchanged from the last audit

* `trips_count` on the profile counts owned trips only
  ([users/handler.py:187](traveleria-backend/lambdas/users/handler.py:187)); it
  will disagree with the home list as soon as sharing exists.
* `groupTripsByTime` ([tripFormat.ts:98](traveleria/utils/tripFormat.ts:98)) does
  not need to change for a third section — it just gets called on owned trips.
* The wallet has no link to trips at all now that `wallet_documents.trip_id` is
  dropped. Co-editing touches it in zero places.
* The Social tab is entirely mock data, so there is **no friends graph to pick
  an invitee from**. Inviting is by typed email, and that is the only option.
* `local_server.py` is new and must learn every route added here, or local dev
  silently diverges from the deployed API.

---

## 1. Data model

New migration `traveleria-backend/sql/010_trip_collaborators.sql` (009 is now
the chat table). Additive, safe to re-run, in the style of 002/003/006:

```sql
CREATE TABLE IF NOT EXISTS trip_collaborators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

    -- NULL until the invited email signs in for the first time. Inviting
    -- someone who has no account yet has to work, otherwise the owner has to
    -- wait for them to sign up and remember to come back.
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,

    -- Always stored lowercase. This is what the invite is matched on, and it
    -- is kept after claiming so the owner still sees who they invited even
    -- before that person has filled in a name.
    email TEXT NOT NULL,

    role TEXT NOT NULL DEFAULT 'editor',
    status TEXT NOT NULL DEFAULT 'pending',

    invited_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ,

    CONSTRAINT trip_collaborators_role_valid CHECK (role IN ('editor')),
    CONSTRAINT trip_collaborators_status_valid
        CHECK (status IN ('pending', 'active', 'declined')),
    -- One invite per email per trip. Re-inviting is an upsert, not a
    -- duplicate, which is also how a declined invite gets a second chance.
    CONSTRAINT trip_collaborators_trip_email_unique UNIQUE (trip_id, email)
);

-- A claimed invite must also be unique per user, but only once user_id is set,
-- so this is a partial index rather than a table constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_collaborators_trip_user
    ON trip_collaborators(trip_id, user_id) WHERE user_id IS NOT NULL;

-- "Which trips can I see?" runs on every trip list, and now on every chat
-- message as well.
CREATE INDEX IF NOT EXISTS idx_trip_collaborators_user
    ON trip_collaborators(user_id) WHERE user_id IS NOT NULL;

-- "Claim my invites" runs on every authenticated request.
CREATE INDEX IF NOT EXISTS idx_trip_collaborators_email_unclaimed
    ON trip_collaborators(email) WHERE user_id IS NULL;
```

### The states

| `status` | `user_id` | Meaning | Grants access? |
|---|---|---|---|
| `pending` | `NULL` | Invited by email; that person has never signed in | No |
| `pending` | set | Invitation is waiting in their Invitations screen | **No** |
| `active` | set | They tapped ✓ | **Yes** |
| `declined` | set | They tapped ✕ | No |

Claiming an invite on sign-in only attaches `user_id`; it grants nothing.
Acceptance is an explicit act.

* **The owner is not a row in this table.** `trips.owner_user_id` stays the one
  source of truth for ownership, so nothing has to be backfilled and no
  migration can orphan a trip. `role` is `'editor'` only today; the CHECK is
  shaped so `'viewer'` is a one-line addition later.
* **A declined invite is kept, not deleted** — it stops the invitation
  reappearing and lets the owner see "Declined" instead of silence. Re-inviting
  flips it back to `pending`.

### Companion migration — event authorship

`011_day_places_created_by.sql`:

```sql
ALTER TABLE day_places
    ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
```

Nullable, so every existing event stays valid and simply reads as "author
unknown". It pays for three things: an "added by Ben" line on an event, an
assistant that knows whose event it is about to delete
([§7c](#c-dont-let-the-assistant-quietly-delete-someone-elses-event)), and an
answer to "who put this here?" three weeks into planning.

Both writers set it — `POST /trips/{id}/itinerary` and the assistant's
`add_itinerary_item`. Nothing backfills it: events that predate the column keep
NULL and render without an author, which is honest, because the information
genuinely was not recorded.

---

## 2. Access control

### One helper, four Lambdas

In `traveleria-backend/shared/utils.py`:

```python
def get_trip_access(db, trip_id, user_id):
    """
    The caller's relationship to a trip: "owner", "editor", or None.

    Every handler goes through this instead of spelling out owner_user_id, so
    there is exactly one definition of who may touch a trip.
    """

def require_trip_access(db, trip_id, user_id, owner_only=False) -> str:
    """
    get_trip_access, but raises AppError("Trip not found", 404) when the answer
    is None, or AppError(..., 403) when owner_only is set and the caller is a
    collaborator. Returns the role, so callers can branch without a second query.
    """
```

One predicate, reused inside the list query:

```sql
t.owner_user_id = %s
OR EXISTS (SELECT 1 FROM trip_collaborators tc
           WHERE tc.trip_id = t.id AND tc.user_id = %s
             AND tc.status = 'active')
```

`status = 'active'` is the entire security model in one line. Pending and
declined invitations are invisible to every trip, itinerary, and chat endpoint.

### Per-endpoint rules

| Endpoint | Owner | Editor |
|---|---|---|
| `GET /trips` | sees it | sees it, with `role: "editor"` |
| `PUT /trips/{id}` — title, location, dates | ✅ | ✅ |
| `DELETE /trips/{id}` | ✅ | ❌ 403 — must *leave* |
| `GET/POST/PUT/DELETE .../itinerary...` | ✅ | ✅ |
| `GET /chat?trip_id=` — own history | ✅ | ✅ |
| `POST /chat` — including its tool calls | ✅ | ✅ |
| `GET /trips/{id}/collaborators` | ✅ | ✅ |
| `POST /trips/{id}/collaborators` | ✅ | ❌ |
| `PUT /trips/{id}/owner` | ✅ | ❌ |
| `DELETE .../collaborators/{id}` — someone else | ✅ | ❌ |
| `DELETE .../collaborators/{id}` — yourself | n/a | ✅ = leave |
| `GET /invitations`, `PUT /invitations/{id}` | own invitations only | own invitations only |

**Inviting is owner-only.** Either rule is one line, so this is a product call:
with one person managing the list, "who let them in and who can remove them"
always has the same answer. `owner_only=False` relaxes it later.

`DELETE /trips/{id}` is the one place a **403 with a real message** beats the
house-style 404 — the caller can demonstrably see the trip, and "Only the trip
owner can delete this trip. You can leave it instead." is the sentence the UI
needs.

### Concrete edits

**`shared/utils.py`** — rename the `owner_user_id` parameter to `user_id` in
`get_or_create_trip_day_for_date`, `resolve_trip_day` and
`get_or_create_default_trip_day`, and replace their inline ownership SQL with
`require_trip_access`. Per finding 1, this is the make-or-break edit, and it now
serves the chat Lambda as well as the itinerary one.

**`lambdas/trips/handler.py`** — `_get_trips` swaps its `WHERE` for the access
predicate and returns `role`, `owner_email` and `collaborators_count` per row;
`_update_trip` calls `require_trip_access` then updates by `id` alone;
`_delete_trip` calls it with `owner_only=True`; six new handlers for §3.

**`lambdas/itinerary/handler.py`** — the access predicate in three queries.

**`lambdas/chat/handler.py`** — `_get_owned_trip` becomes `_get_trip` and calls
`require_trip_access`; `_get_chat_history` does the same; `_remove_itinerary_item`
drops `t.owner_user_id` from its `WHERE` (see [§7](#7-the-assistant-on-a-shared-trip)
for what replaces the safety it was providing).

**`lambdas/users/handler.py`** — `trips_count` counts owned + shared.

---

## 3. API surface

All six routes are served by the existing `traveleria-trips` Lambda. A seventh
Lambda for two endpoints would cost a function, a role attachment, env
variables, and another thing to remember to redeploy.

```
GET    /trips/{trip_id}/collaborators
POST   /trips/{trip_id}/collaborators
DELETE /trips/{trip_id}/collaborators/{collaborator_id}
PUT    /trips/{trip_id}/owner
GET    /invitations
PUT    /invitations/{invitation_id}
```

### `GET /trips/{trip_id}/collaborators`

```json
{
  "owner": { "email": "ana@example.com", "full_name": "Ana",
             "avatar_url": "https://…", "is_you": true },
  "collaborators": [
    { "id": "uuid", "email": "ben@example.com", "full_name": "Ben",
      "avatar_url": null, "status": "active", "is_you": false },
    { "id": "uuid", "email": "cara@example.com", "full_name": null,
      "avatar_url": null, "status": "pending", "is_you": false }
  ],
  "your_role": "owner"
}
```

`is_you` is computed server-side, which is what lets the frontend skip identity
plumbing entirely (finding 6). `avatar_url` is presigned exactly as
`_get_profile` does it, and only for people who have an account.

### `POST /trips/{trip_id}/collaborators`

Request `{ "email": "ben@example.com" }`.

1. Trim and lowercase; validate with the shape the signup screen already uses
   (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`,
   [signup.tsx:127](traveleria/app/signup.tsx:127)) — worth lifting into
   `utils/validation.ts` so both screens share one definition.
2. Reject your own email and the owner's: "They already have access to this trip."
3. Cap at **10 collaborators per trip** — a guard against a runaway client, not
   a product limit.
4. Look the email up in `users`; set `user_id` when found, leave it `NULL` when
   not. `status` is `'pending'` either way.
5. `ON CONFLICT (trip_id, email) DO UPDATE` resets to `pending` **only when the
   existing row is `declined`**. An `active` or `pending` row comes back
   untouched, so a double tap is idempotent and re-inviting a declined person
   needs no second endpoint.

Both outcomes are a success, worded differently — no status code distinguishes
"this email has an account" from "it does not", so the endpoint cannot be used
to enumerate users.

### `DELETE /trips/{trip_id}/collaborators/{collaborator_id}`

Owner removing anyone, or a collaborator removing their own row (*leave trip*).
Deletes the row outright rather than marking it declined — leaving should not
leave a tombstone in the owner's list. Their `chat_messages` rows are **not**
deleted; see [§7](#7-the-assistant-on-a-shared-trip).

### `PUT /trips/{trip_id}/owner`

Owner-only, body `{ "collaborator_id": "uuid" }`, which must be an `active` row
on this trip. In one transaction: insert the old owner as an active
collaborator, delete the promoted row, then `UPDATE trips SET owner_user_id`.
Insert before delete, so the trip is never collaborator-less mid-transaction.
The old owner stays on as an editor — silently demoting someone off their own
trip would be worse than not offering the feature.

### `GET /invitations`

Pending invitations for the signed-in user, with enough detail to decide without
opening anything:

```json
[{ "id": "uuid",
   "trip": { "title": "Summer in Rome", "location": "ROME",
             "date": "12.06.2026 - 19.06.2026" },
   "invited_by": { "email": "ana@example.com", "full_name": "Ana",
                   "avatar_url": "https://…" },
   "created_at": "2026-09-05T10:00:00Z" }]
```

Filtered by `user_id = me AND status = 'pending'` — never by email. The claim
step in §4 is what turns an email into a `user_id`.

### `PUT /invitations/{invitation_id}`

`{ "action": "accept" }` or `{ "action": "decline" }`. Only the invitee may
respond; anyone else gets a 404. Accept returns the trip in the same shape
`GET /trips` uses, so the home list can absorb it without a second round trip.

One route with an action rather than `/accept` and `/decline` sub-resources:
each extra path is another resource, method, integration and Lambda permission
in `add_routes.sh`.

---

## 4. Invite, claim, accept

```
owner types email
      │
      ├── email has an account ────► row (user_id, status='pending')
      │                                   │
      └── no account yet ──────────► row (user_id=NULL, status='pending')
                                          │
                     they sign up / sign in with that email
                                          │
                      claim step in get_current_user sets user_id
                          (status stays 'pending' — no access yet)
                                          │
                                          ▼
                            Invitations screen shows it
                                    ┌─────┴─────┐
                                   ✓ accept   ✕ decline
                                    │             │
                          status='active'   status='declined'
                          trip appears in    nothing appears;
                          "Shared trips"     owner sees "Declined"
```

The claim is one statement in `get_current_user`
([shared/auth.py](traveleria-backend/shared/auth.py)), right after the existing
user upsert and in the same transaction:

```sql
UPDATE trip_collaborators
   SET user_id = %s
 WHERE user_id IS NULL AND email = LOWER(%s)
```

It does not touch `status`. It runs on every authenticated request, is a single
indexed statement, and matches zero rows in almost every call.

**The email is the verified Cognito email.** `get_current_user` reads it from
the ID token and falls back to `{sub}@cognito.local` when absent — a synthetic
address that can never match a real invite, so the fallback is safe as it
stands.

---

## 5. Frontend

### New — Invitations screen (`app/invitations.tsx`)

A pushed screen, not a tab: four tabs is the practical limit, and this list is
empty almost always.

```
┌──────────────────────────────────────────┐
│  ←   Invitations                          │
├──────────────────────────────────────────┤
│  ⟨A⟩  Ana invited you to co-edit          │
│       ROME · Summer in Rome               │
│       12.06.2026 – 19.06.2026             │
│                          [ ✕ ]   [ ✓ ]    │
└──────────────────────────────────────────┘
```

* ✓ accepts, ✕ declines, both `PUT /invitations/{id}`.
* The row disables while its request is in flight and leaves the list on
  success.
* ✕ confirms through `Alert.alert` ("Ana would have to invite you again"); ✓ does
  not — accepting is trivially undone by leaving.
* On accept, the trip goes straight into the home list from the response, with
  an **Open trip** action.

### Entry point — a bell in the Home header

A permanent bell in `titleRow`, left of the existing **Select** action
([home.tsx:538](traveleria/app/(tabs)/home.tsx:538)), carrying a count badge
when invitations are waiting:

```
┌──────────────────────────────────────────────┐
│  Your Journeys                  🔔②   Select │
└──────────────────────────────────────────────┘
```

* Always visible, so the route into invitations never moves or disappears.
* The badge is a small pill in `colors.danger` with `primaryContrast` text,
  rendered only above zero and capped at "9+".
* Tapping with nothing pending still opens the screen, which says "No
  invitations right now."
* Home fetches `/invitations` beside `/trips` on focus — one indexed query, and
  the count is what the badge needs anyway.
* Selection mode replaces the header with `selectionBar`, so the bell goes with
  it. That is correct: selection is a mode with its own actions.

### Changed — Home: shared trips inline, styled apart

**No separate section.** `groupTripsByTime` keeps running over the whole list,
so a shared trip sorts into Upcoming or Past by its own dates exactly like a
solo one and the `sections` memo is untouched. A trip you were invited to next
month appears where next month is.

What marks it out is the card:

* A **Shared** chip in the top row beside the existing status badge, and a
  "Shared by ana@…" line under the title.
* A tinted card background plus a 4px accent bar down the leading edge, in a new
  palette colour (below).
* The trash icon becomes **exit-outline / Leave**
  ([home.tsx:468](traveleria/app/(tabs)/home.tsx:468)), with its own confirmation
  copy.
* Bulk selection excludes non-owned trips from **Select all** and says why: "3 of
  5 selected — shared trips can't be deleted". Mixing delete and leave into one
  bulk action is a good way to lose a trip by accident.
* `fetchTrips` moves to `useFocusEffect` from `expo-router`, matching
  `profile.tsx` and `wallet.tsx`.

#### The colour

Three new tokens in `constants/theme.ts`, added to **both** palettes — the file
requires identical key sets, because `use-theme-color.ts` types its argument as
the intersection of the two:

| Token | Light | Dark | Used for |
|---|---|---|---|
| `shared` | `#6b4ee6` | `#a78bfa` | Accent bar, chip background, `locationText` on a shared card |
| `sharedSoft` | `#f3f0fe` | `#241f36` | The card background |
| `sharedContrast` | `#ffffff` | `#0f1316` | Chip text on the solid accent |

Violet, and violet specifically, for three reasons:

1. **Every other slot already carries meaning.** `success` green is the "Ongoing"
   badge; `warning` orange and `danger` red both signal problems. Being shared is
   not a status, so it must not borrow a status colour.
2. **It cannot collide with selection.** `tripCardSelected` already uses
   `primarySoft` (`#eef2ff`) as its background — and `surfaceAlt` is the *same*
   `#eef2ff` in light mode. Any blue tint would make every shared card look
   permanently selected. Violet is the closest hue to the brand blue that is
   still unmistakably not it.
3. **It survives dark mode.** `#241f36` sits just above `surface` (`#1a1f24`) in
   luminance, so the tint reads without the card glowing, and the accent bar
   carries the identity where the tint is subtle.

Style order in `renderTripItem` matters enough to write down:

```tsx
style={[
  styles.tripCard,
  isShared && styles.tripCardShared,
  isPast && styles.tripCardPast,
  isSelected && styles.tripCardSelected,   // last, so selection always wins
]}
```

One knock-on: `badge` uses `primarySoft`/`primary`, which sits oddly on a violet
card. Simplest fix is for the status badge to switch to `surface`/`shared` when
the card is shared, so the two chips read as a pair instead of blue-on-violet.

### New — members sheet (`components/TripMembersSheet.tsx`)

Opened from a `person-add-outline` button in the `trip-details.tsx` header,
styled like the existing event modal:

```
┌─────────────────────────────────────┐
│  Trip members                    ✕  │
├─────────────────────────────────────┤
│  ⟨A⟩  Ana        Owner · You        │
│  ⟨B⟩  Ben        Editor        ⋯    │
│  ⟨ ⟩  cara@…     Invited       ⊖    │
├─────────────────────────────────────┤
│  Add by email                       │
│  [ name@example.com          ] [+]  │
│  They will get an invitation to     │
│  accept before they can edit.       │
└─────────────────────────────────────┘
```

* Owner: `⊖` removes; `⋯` on an active collaborator offers **Make owner** and
  **Remove**. Transfer confirms hard: "You will become an editor and will no
  longer be able to delete this trip or manage members."
* Collaborator: no add field, and the only action is **Leave** on their own row.
* Validation errors inline under the field, in the `FormField`/`fieldErrors`
  idiom both existing forms use — not in an `Alert`.

### Changed — trip details

* Stacked member avatars in the header, tapping opens the sheet.
* `fetchItinerary` moves to `useFocusEffect`.
* A 404 on the itinerary or the chat means access is gone: say "This trip is no
  longer shared with you" and pop back, rather than the generic connection
  error.
* With authorship (§1 optional migration): a small "added by Ben" line on events
  you did not create.
* The chat pane itself is unchanged.

### New — `services/tripSharingService.ts`

Mirroring `walletService.ts`: `listCollaborators`, `addCollaborator`,
`removeCollaborator`, `transferOwner`, `listInvitations`, `respondToInvitation`,
all through `apiFetch`.

---

## 6. Seeing each other's changes

No realtime infrastructure exists here — REST over API Gateway, Lambda, RDS —
and this plan does not add WebSockets.

**Refetch on focus.** Home and trip-details switch to `useFocusEffect`, which
`profile.tsx` and `wallet.tsx` already do (finding 5). Pull-to-refresh on Home
covers the rest. This handles the real case: two people with the app open,
taking turns.

**Optional, only if that feels stale:** a `touch_trip(db, trip_id)` helper on
every itinerary write — including the assistant's — so `trips.updated_at`
becomes a true "anything changed" marker, plus a `GET /trips/{trip_id}/version`
polled every 20s while the trip screen is focused. One indexed read per poll.
Not in scope above; it is a seventh route and refresh-on-focus should be
measured first.

### Conflicts

One row per event, one row per trip header, last write wins. Right for a
two-person planner, but worth stating rather than assuming:

| Situation | Behaviour |
|---|---|
| Both edit different events | Both saved. |
| Both edit the same event | Later save wins, silently. |
| A edits an event B just deleted | 404 → "That event was removed by someone else", list refreshes. |
| A narrows the dates, B has an event outside them | Nothing is deleted; the event still shows under its own day, and the existing `events_outside_range` warning covers it ([trips/handler.py:88](traveleria-backend/lambdas/trips/handler.py:88)). |
| B's assistant adds an event while A is editing another | Independent rows; A sees it on next focus. |

Optimistic concurrency — echoing `updated_at` back and rejecting stale writes
with 409 — is deliberately out of scope. Recorded so the decision is a decision.

---

## 7. The assistant on a shared trip

Three things have to be true: a collaborator's assistant must work at all, it
must not be a back door around the permission model, and it must not let one
person quietly destroy another's work.

### a. Make it work — access checks

`_get_owned_trip` → `require_trip_access` (rename it `_get_trip`), and the same
in `_get_chat_history`. `_remove_itinerary_item` drops `t.owner_user_id` from
its `WHERE`, and `_add_itinerary_item` inherits the fix through
`get_or_create_trip_day_for_date`. Four edits, all mechanical.

The access check happens once at the top of the request, inside the same
`with get_db()` block the tool calls run in
([chat/handler.py:174](traveleria-backend/lambdas/chat/handler.py:174)), so one
check covers every tool call in that turn. There is no path by which a tool call
reaches a trip the caller could not already reach.

### b. Keep the conversation private — which it already is

`chat_messages` is keyed `(trip_id, user_id)` and both reads filter on both
columns. **Do not** relax either query to `trip_id` alone, and do not add a
"shared conversation" mode. Two people on one trip have two conversations, each
with their own history, their own dietary preferences, and their own language.

Two consequences worth deciding rather than discovering:

* **Removal keeps the history.** When B leaves or is removed, their
  `chat_messages` rows stay. They cannot read them — `require_trip_access` 404s
  — and if they are re-invited, their context comes back. The alternative is
  deleting on removal, which is tidier and irreversible. Recommended: keep.
* **Trip deletion takes it.** `ON DELETE CASCADE` means the owner deleting a
  shared trip deletes every collaborator's conversation. Correct, but it should
  be in the delete confirmation copy: "…and everyone's chat history for it."

### c. Don't let the assistant quietly delete someone else's event

This is finding 2, and it is where sharing genuinely makes the assistant more
dangerous. Today a single fuzzy `ILIKE` match is deleted outright, with no
confirmation and no mention of whose event it was.

Two halves, both resting on the authorship column:

1. **Always name what was removed.** `_remove_itinerary_item` already returns a
   result dict the model sees; extend `{"status": "removed"}` to carry the
   place, day and time, and instruct the model to state them in its reply. Cheap,
   and it makes an unwanted deletion visible immediately rather than three days
   later.

2. **Confirm before removing an event you did not create.** When the match's
   `created_by_user_id` is someone else, the tool returns
   `{"status": "needs_confirmation", "place": "…", "day": "…", "time": "…",
   "created_by": "Ana"}` instead of deleting, and the prompt instructs the model
   to ask — "That was added by Ana. Remove it anyway?" — and to call again with
   `confirm: true` only once the user agrees. Editors are equal, so the answer
   can be yes; it just must not be silent.

**The confirmation question has to name the place in the assistant's visible
text**, not only in the tool arguments. `_save_message` persists only the `user`
and `assistant` text
([chat/handler.py:355](traveleria-backend/lambdas/chat/handler.py:355)) and
`_load_history` replays only those — tool calls and tool results are dropped
between turns. So when the user answers "yes" on the next turn, the only surviving
record of *what* was being confirmed is the sentence the assistant wrote. "Remove
it anyway?" with the place named only inside the tool call would leave the model
guessing.

Both `_add_itinerary_item` and the manual `POST .../itinerary` set
`created_by_user_id` to the acting user.

### d. Give the assistant a `get_itinerary` tool

Finding 3: the assistant cannot see the itinerary at all. That is equally true
on solo trips, so this is fixed for **every** trip rather than only shared ones —
an assistant that cannot see what you already planned is the same problem either
way.

A tool rather than a block in the system prompt, so a trip's events cost input
tokens only on the turns that actually need them:

```python
GET_ITINERARY_TOOL = {
    "type": "function",
    "function": {
        "name": "get_itinerary",
        "description": (
            "Read the trip's current itinerary: every planned event with its day, "
            "time, place and who added it. Call this before answering questions "
            "about what is planned, before suggesting a time so you do not clash "
            "with something existing, and before removing an item."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "day": {
                    "type": "string",
                    "description": "Optional DD.MM.YYYY, to read one day instead of the whole trip",
                },
            },
        },
    },
}
```

It returns one line per event, with empty days included so the model can see the
gaps rather than infer them:

```json
{"days": [
  {"date": "13.06.2026", "events": [
    {"time": "09:00", "place": "Colosseum", "added_by": "Ana"},
    {"time": "13:00", "place": "Trattoria Vecchia", "added_by": "you"}]},
  {"date": "14.06.2026", "events": []}
]}
```

`added_by` is `"you"` for the caller's own events and the other person's name
(or their email, when no name is set) otherwise. On a trip with no
collaborators the field is omitted entirely — no point spending tokens on
attribution nobody needs.

The handler reuses the itinerary Lambda's query shape, with the access predicate
and a join to `users` for the author.

#### This needs the tool loop to actually be a loop

`_run_conversation` is single-shot today: one completion, and if it produced
tool calls, exactly one follow-up — and that follow-up is made **without**
`tools` ([chat/handler.py:270](traveleria-backend/lambdas/chat/handler.py:270)).
The model cannot act on what a tool returned.

That is fine for write-only tools, where the call *is* the action. It does not
work for a read tool: the natural sequence is `get_itinerary` → look →
`add_itinerary_item`, and today the second step is impossible.

So `_run_conversation` becomes a bounded loop — pass `tools=TOOLS` every round,
execute whatever comes back, append the results, go again until the model
returns prose or a **cap of three rounds** is reached. The cap is not decoration:
it is the only thing between a confused model and an unbounded run of OpenAI
calls inside a Lambda holding a database connection open. On hitting it, return
the last prose the model produced, or a plain "I could not finish that — can you
rephrase?" if there is none.

This is the largest single change in §7, and the reason its effort estimate
moved up.

### e. Tell it the trip is shared

One line appended to the system prompt when the trip has active collaborators:
"This trip is shared with Ana (ana@example.com). Other people may add or change
events." It stops the assistant claiming sole authorship of the plan and makes
"who added this?" answerable.

---

## Files touched

| File | Change |
|---|---|
| `traveleria-backend/sql/010_trip_collaborators.sql` | **new** — table + indexes |
| `traveleria-backend/sql/011_day_places_created_by.sql` | **new** — event authorship |
| `traveleria-backend/shared/utils.py` | `get_trip_access` / `require_trip_access`; `owner_user_id` → `user_id` in the three trip-day helpers |
| `traveleria-backend/shared/auth.py` | claim unclaimed invites on sign-in |
| `traveleria-backend/lambdas/trips/handler.py` | list query, access checks, collaborators, transfer, invitations |
| `traveleria-backend/lambdas/itinerary/handler.py` | access predicate ×3; set `created_by_user_id` |
| `traveleria-backend/lambdas/chat/handler.py` | access checks ×3, `get_itinerary` tool, bounded tool loop, removal confirmation, shared-trip line |
| `traveleria-backend/lambdas/users/handler.py` | `trips_count` includes shared trips |
| `traveleria-backend/scripts/add_routes.sh` | five resources, six methods — patches the running lab |
| `traveleria-backend/deploy_cloudshell.sh` | the same five resources and six methods — keeps the from-scratch rebuild complete |
| `traveleria-backend/scripts/deploy_function.sh` | **new** — per-function deploy, generalised from `deploy_wallet.sh` |
| `traveleria-backend/local_server.py` | the same six routes, or local dev diverges |
| `traveleria/app/invitations.tsx` | **new** |
| `traveleria/components/TripMembersSheet.tsx` | **new** |
| `traveleria/services/tripSharingService.ts` | **new** |
| `traveleria/utils/validation.ts` | shared `validateEmail` |
| `traveleria/constants/theme.ts` | `shared` / `sharedSoft` / `sharedContrast` in both palettes |
| `traveleria/app/(tabs)/home.tsx` | invitations bell + badge, Shared chip and card styling, leave vs delete, bulk rule, focus refetch |
| `traveleria/app/trip-details.tsx` | members button and sheet, avatars, authorship line, 404 copy, focus refetch |

Untouched: the whole wallet path, `social.tsx`, `CurrentUserContext.tsx`, and
the chat *UI* in `trip-details.tsx`.

---

## Deployment

There are two deployment paths and this feature has to land in **both**.

### Routine — shipping this change to the running lab

1. `python scripts/init_db.py` — additive, safe any time, safe to re-run.
2. Redeploy **`traveleria-trips`**, **`traveleria-itinerary`**, **`traveleria-chat`**
   and **`traveleria-users`**. All four bundle `shared/`, and both `shared/utils.py`
   and `shared/auth.py` change, so all four go out together.
3. `bash scripts/add_routes.sh` for the six new routes.

There is no safe per-function script for those four today. `deploy_wallet.sh`
covers only the wallet, and `deploy_cloudshell.sh` cannot be used for a code
change because it deletes and recreates the REST API, minting a new invoke URL
and breaking `EXPO_PUBLIC_API_URL` in every installed build. Redeploying
`traveleria-chat` by hand is no longer trivial either: its zip needs `openai`
and `httpx`, and its environment needs `OPENAI_API_KEY` and
`GOOGLE_PLACES_API_KEY` on top of the database and Cognito variables.

So this plan adds **`scripts/deploy_function.sh <name>`**, generalised from
`deploy_wallet.sh`: build the zip from `lambdas/<name>/handler.py` plus
`shared/` plus `deps`, `update-function-code`, and merge — never replace — the
environment map, read from the function's own existing configuration. Same rules
as its ancestor: creates and updates only, never touches API Gateway, never
echoes an environment block.

Order: migration first (the new tables are ones the old code never reads, so the
running Lambdas keep working), then the four functions, then the routes. Rolling
back is redeploying the previous zips; the tables can stay.

### From scratch — `deploy_cloudshell.sh` must stay current

`deploy_cloudshell.sh` is the one script that stands the whole backend up from
nothing, and it exists for a specific day: **moving to a different AWS lab
account.** On that day it has to be complete — every Lambda, every environment
variable, every API Gateway resource and method, every pip dependency — because
there is nothing else to fall back on.

It is never run for a routine change, and that is exactly how it rots: nobody
runs it, so nobody notices when it has fallen behind. Treat it as a deliverable
of this feature, not an afterthought. Co-editing must add to it:

| What | Where in the script |
|---|---|
| `/trips/{trip_id}/collaborators` + `/{collaborator_id}` resources and their 3 methods | the `make_resource` / `add_method` block |
| `/trips/{trip_id}/owner` resource and `PUT` | same |
| `/invitations` + `/{invitation_id}` resources and their 2 methods | same |
| No new Lambda, no new environment variable, no new pip dependency | — |

Every route added here therefore lands in **three** places: `add_routes.sh` (to
patch the running lab), `deploy_cloudshell.sh` (to rebuild a new one), and
`local_server.py` (so local dev matches). A route missing from any one of them
is a bug that only shows up much later, in the place it is most expensive.

The same rule applies beyond co-editing: whenever a feature adds a function, a
route, an environment variable, a bucket, or a dependency, it goes into
`deploy_cloudshell.sh` in the same change. Worth a line in `CLAUDE.md` so it is
not carried by memory alone.

**A gap worth closing while we are here:** `deploy_cloudshell.sh` creates the
API Gateway resources from scratch, but `add_routes.sh` has drifted ahead of it
before — `add_routes.sh` exists precisely because routes were missing from the
deployed API. A short verification pass, comparing the resource list the two
scripts produce, is cheap now and expensive to skip. It belongs with the
co-editing routes rather than as a separate task.

---

## Manual test checklist

Two accounts, A (owner) and B.

**Invitations**

- A adds B's email → B refreshes Home → banner shows "1 trip invitation"; the
  trip is **not** in B's list yet.
- B opens Invitations → sees the trip, dates and A's name → taps ✓ → the trip
  appears under **Shared trips**; the banner is gone.
- A invites B to a second trip, B taps ✕ → never appears for B; A's members sheet
  shows **Declined**. A re-invites → it comes back as pending, no duplicate row.
- A invites an email with no account → shows **Invited**; that person signs up
  with that email → the invitation is waiting on first load.
- A invites their own email → refused with a readable message.
- B declines, then tries to open the trip by any means → 404, no access.

**Co-editing**

- B renames the trip and adds an event → A refreshes → both changes are there.
- A adds an event → B's open trip screen picks it up on focus.
- A deletes an event B is editing → B gets "removed by someone else".

**The assistant** — the section that would previously have been skipped

- B opens the chat on the shared trip → history loads, a message gets a reply.
  (Before the §7a fix this 404s outright.)
- B asks the assistant to add an event → it lands on the shared trip and A sees
  it on next focus.
- A opens the chat on the same trip → sees **only** their own conversation; none
  of B's messages appear, in the history load or in the model's context.
- B asks "what's planned for day 2?" → the assistant calls `get_itinerary`
  and lists A's events too (requires §7d).
- B asks the assistant to add something and it needs the plan first → read then
  write inside one message, without hitting the three-round cap.
- B asks to remove an event **A** created → the assistant says whose it is and
  asks before deleting (requires §7c and the authorship column).
- B is removed from the trip, then sends a chat message → clean "no longer
  shared" message, not a raw error.
- B is re-invited and accepts → their old conversation is still there.
- A deletes the shared trip → B's conversation for it is gone too, and the
  delete confirmation said so.

**Roles**

- B is offered **Leave**, not Delete; leaving removes it from B's list only.
- B's members sheet has no add field and no ⊖ on A's row.
- A transfers ownership to B → B can delete and manage members; A is now an
  editor and sees **Leave**.
- Bulk select on B's Home excludes shared trips and explains why.

**Regression**

- A user with no shared trips and no invitations sees today's Home exactly.
- Sign-in with no pending invites shows no measurable slowdown.
- Solo trips: chat, itinerary and wallet all behave as before.

---

## Risks

| Risk | Mitigation |
|---|---|
| A missed `owner_user_id` leaves collaborators unable to write | One helper; afterwards `grep -rn owner_user_id lambdas shared` must return only `_create_trip`, `_delete_trip`, `_transfer_owner` and the access helper |
| The chat Lambda is forgotten in the access-check pass | It is the *first* place a collaborator will hit a 404 — three of the twelve statements are there, and the test checklist opens with it |
| The assistant deletes a co-editor's event on a fuzzy match | §7c: always name what was removed; confirm when the author is someone else |
| A `pending` row accidentally granting access | `status = 'active'` lives in the one shared predicate; nothing else queries the table for access |
| Chat history leaking across users on a shared trip | The `(trip_id, user_id)` filter is already in both queries and must not be relaxed; there is an explicit test for it |
| A collaborator deletes the whole trip | `owner_only=True`, plus the UI offering Leave |
| Ownership transferred to the wrong person | Only active collaborators are offered, hard confirmation, and the new owner can transfer back |
| Email enumeration through the invite endpoint | Both outcomes are a success; no path distinguishes registered from not |
| Itinerary in the prompt raising per-message token cost | Compact one-line-per-event format; measure on a full trip before shipping |
| Redeploying four Lambdas by hand goes wrong | `scripts/deploy_function.sh`, modelled on the wallet script, merging rather than replacing the environment |
| The tool loop spending OpenAI calls without bound | Hard cap of three rounds per message, with a defined answer on hitting it |
| A shared card reading as "selected" | Violet rather than any blue tint; selection styles applied last |
| `deploy_cloudshell.sh` silently falling behind, so a move to a new lab rebuilds a backend missing half the routes | Every route lands in all three of `add_routes.sh`, `deploy_cloudshell.sh` and `local_server.py`, in the same change; a verification pass against the current API is part of this work |

---

## Decisions on record

Settled across two design reviews. Not re-opened without a reason.

1. **Invitations are accepted or declined**, never auto-joined.
2. **Only the owner invites and removes.** One line to relax later.
3. **Shared trips are not a separate section.** They sort by date alongside
   everything else, marked by a Shared chip and a violet card ([§5](#5-frontend)).
4. **The entry point is a permanent bell with a badge** in the Home header.
5. **Event authorship is in scope** — `day_places.created_by_user_id`.
6. **The assistant reads the itinerary through a `get_itinerary` tool**, on
   every trip, shared or not, so those tokens are spent only when needed.
7. **A collaborator's chat history is kept** when they leave or are removed —
   unreadable while they have no access, restored if they are re-invited.
8. **The wallet is not involved.**
9. **Ownership transfer is in scope.**
10. **No push or email notifications.** The bell is the whole surface.
11. **Account deletion is out of scope** — no such endpoint exists, so there is
    nothing to reconcile.
12. **`deploy_cloudshell.sh` is a maintained deliverable**, not dead weight. It
    is the one-script path to standing the backend up in a new AWS lab, so every
    feature keeps it current even though nothing routine ever runs it.

## Still open

Nothing blocking. Two judgement calls worth revisiting once the code exists:

* **The exact violet.** `#6b4ee6` / `#a78bfa` is a proposal, not a measurement.
  Worth eyeballing on a real device in both themes, next to a solo card and an
  Ongoing badge, before it hardens into a token.
* **The three-round cap on the tool loop** ([§7d](#d-give-the-assistant-a-get_itinerary-tool)).
  Three covers read → write → summarise. If real conversations need four, that
  is a constant, not a redesign.
