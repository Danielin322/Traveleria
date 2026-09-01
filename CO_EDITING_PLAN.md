# Traveleria — Trip Co-Editing

Plan for sharing a single trip between several users, from an audit of the code
on branch `feature/co-editing` (2026-09-01). **Nothing implemented yet.**

Revised after the first design review — invitations are now accepted or
declined rather than auto-joined, shared trips get their own section, ownership
can be transferred, and the chat side is deliberately deferred (see
[§7](#7-chat--deferred)).

---

## What we are building

The owner of a trip adds another user's **email** to that trip's co-editing
list. That person sees an **invitation** they accept or decline. Once accepted:

* the trip appears in their trip list, in a **Shared trips** section;
* either of them can change the title, destination, dates, and events, and the
  other sees the change.

---

## Summary

| # | Piece | Layers | Deploy | Effort |
|---|-------|--------|--------|--------|
| 1 | `trip_collaborators` table + invite-claim on sign-in | DB + `shared/auth.py` | Migration + all Lambdas | Small |
| 2 | Access checks move from "owner" to "owner or collaborator" | `shared/utils.py`, `trips`, `itinerary` | 2 Lambdas | **Medium — highest risk** |
| 3 | Members API (list / add / remove / leave) | `trips` Lambda + 2 routes | `add_routes.sh` | Medium |
| 4 | Invitations screen (accept ✓ / decline ✕) | `trips` Lambda + 2 routes + new screen | `add_routes.sh` | Medium |
| 5 | Members UI, Shared trips section, Leave trip | Frontend | — | Medium |
| 6 | Change propagation (refresh-on-focus) | Frontend | — | Small |
| 7 | Ownership transfer | `trips` Lambda + 1 route | `add_routes.sh` | Small |

Six new routes across five new API Gateway resources, all served by the
**existing `traveleria-trips` Lambda**. `scripts/add_routes.sh` gains one block;
it is additive and **the invoke URL does not change**. `deploy_cloudshell.sh`
must not be used for this.

---

## Audit findings that shape this plan

1. **Ownership is hardcoded in nine SQL statements, three of them in shared
   helpers.** `owner_user_id = %s` appears in
   [shared/utils.py:75](traveleria-backend/shared/utils.py:75),
   [:132](traveleria-backend/shared/utils.py:132),
   [:144](traveleria-backend/shared/utils.py:144),
   [itinerary/handler.py:48](traveleria-backend/lambdas/itinerary/handler.py:48),
   [:95](traveleria-backend/lambdas/itinerary/handler.py:95),
   [:137](traveleria-backend/lambdas/itinerary/handler.py:137), and
   [trips/handler.py:47](traveleria-backend/lambdas/trips/handler.py:47),
   [:79](traveleria-backend/lambdas/trips/handler.py:79),
   [:112](traveleria-backend/lambdas/trips/handler.py:112).

   The three in `shared/utils.py` matter most: `resolve_trip_day` and its two
   callees take a parameter literally named `owner_user_id`. **If they are
   missed, a collaborator can read the itinerary but every attempt to add or
   move an event 404s** — and that 404 will look like a routing problem, not a
   permission one. This is where the feature is most likely to break.

2. **404 is already the answer for "not yours".** Every handler deliberately
   collapses "missing" and "someone else's" into `Trip not found`
   ([trips/handler.py:75](traveleria-backend/lambdas/trips/handler.py:75)).
   Keeping that convention means a revoked collaborator gets a clean 404, not a
   leak — but it also means the app must tell "removed from the trip" apart
   from "trip deleted" to write a good message. Handled in [§6](#6-seeing-each-others-changes).

3. **The wallet is not connected to trips — and the column that implied it was
   has been removed.** `wallet_documents.trip_id` existed from `001` and the
   list endpoint returned it as `tripId`, but **nothing had ever written it**:
   no `INSERT INTO wallet_documents` in the history of this repository listed
   the column, so every value was NULL, and `walletService.ts` declared the
   field without a single reader. It is now dropped —
   `sql/008_drop_wallet_document_trip_id.sql`, plus the column and index in
   `001`, the `SELECT` and the response field. The wallet is purely per-user,
   and **co-editing touches it in exactly zero places.**

4. **The trip card's delete button is unconditional**
   ([home.tsx:468](traveleria/app/(tabs)/home.tsx:468)), as is select-all →
   delete. A collaborator tapping it would fire `DELETE /trips/{id}`, get a
   404, and see "could not be removed" with no explanation. The card must show
   **Leave** rather than **Delete** on a trip you do not own.

5. **`CurrentUserContext` is a stub** — id `"u_me"`, name `"Your Name"`, a
   pravatar URL
   ([contexts/CurrentUserContext.tsx](traveleria/contexts/CurrentUserContext.tsx)).
   The members list needs the real signed-in email to render "You" correctly.
   `GET /users` already returns `email`, `full_name`, and `avatar_url`.

6. **`trips_count` on the profile counts owned trips only**
   ([users/handler.py:187](traveleria-backend/lambdas/users/handler.py:187)).
   It will disagree with the home list the moment sharing exists.

7. **`groupTripsByTime` splits a flat list into upcoming/past**
   ([tripFormat.ts:98](traveleria/utils/tripFormat.ts:98)) and `home.tsx` turns
   that into `SectionList` sections in a single `useMemo`
   ([home.tsx:78](traveleria/app/(tabs)/home.tsx:78)). Adding a third section is
   genuinely a few lines — the helper does not need to change at all, it just
   gets called on the owned trips only.

8. **`places` rows are private per event**, and `_delete_trip` cleans them up by
   collecting ids before the cascade
   ([trips/handler.py:118](traveleria-backend/lambdas/trips/handler.py:118)).
   Co-editing does not change this — a collaborator's event owns its own
   `places` row, and the existing `NOT EXISTS` guard already covers reuse.

---

## 1. Data model

New migration `traveleria-backend/sql/009_trip_collaborators.sql`, additive, in
the style of 002/003/006 (no type changes, safe to re-run):

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

-- "Which trips can I see?" runs on every trip list.
CREATE INDEX IF NOT EXISTS idx_trip_collaborators_user
    ON trip_collaborators(user_id) WHERE user_id IS NOT NULL;

-- "Claim my pending invites" runs on every sign-in.
CREATE INDEX IF NOT EXISTS idx_trip_collaborators_email_unclaimed
    ON trip_collaborators(email) WHERE user_id IS NULL;
```

### The three states

| `status` | `user_id` | Meaning | Grants access? |
|---|---|---|---|
| `pending` | `NULL` | Invited by email; that person has never signed in | No |
| `pending` | set | Invitation is sitting in their Invitations screen | **No** |
| `active` | set | They tapped ✓ | **Yes** |
| `declined` | set | They tapped ✕ | No |

Only `active` grants access. This is the change from the first draft: claiming
an invite on sign-in now only attaches the `user_id`; it does **not** grant
anything. Acceptance is an explicit act.

Other notes on the shape:

* **The owner is not a row in this table.** `trips.owner_user_id` stays the
  single source of truth for ownership, so no existing trip has to be
  backfilled and no migration can accidentally orphan one. `role` is therefore
  `'editor'` only today; the CHECK is written so adding `'viewer'` later is a
  one-line change.
* **A declined invite is kept, not deleted.** It stops the same invitation
  reappearing, and it lets the owner see "Declined" rather than silence. The
  owner re-inviting flips it back to `pending` (see [§3](#3-api-surface)).
* **No `ON DELETE` surprises:** deleting a trip cascades its collaborators;
  deleting a user cascades their claimed rows but leaves an unclaimed invite
  intact under the email, which is what we want.

---

## 2. Access control

### One helper, used everywhere

Add to `traveleria-backend/shared/utils.py`:

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
    is None — or AppError(..., 403) when owner_only is set and the caller is a
    collaborator. Returns the role so callers can branch without a second query.
    """
```

Backed by one predicate, reused inside the list query too:

```sql
t.owner_user_id = %(user_id)s
OR EXISTS (SELECT 1 FROM trip_collaborators tc
           WHERE tc.trip_id = t.id AND tc.user_id = %(user_id)s
             AND tc.status = 'active')
```

`status = 'active'` is the whole security model in one line. A pending or
declined invitation is invisible to every trip and itinerary endpoint.

### Per-endpoint rules

| Endpoint | Owner | Editor |
|---|---|---|
| `GET /trips` | sees it | sees it (with `role: "editor"`) |
| `POST /trips` | creator becomes owner | n/a |
| `PUT /trips/{id}` (title, location, dates) | ✅ | ✅ |
| `DELETE /trips/{id}` | ✅ | ❌ 403 — must use *leave* |
| `GET/POST/PUT/DELETE .../itinerary...` | ✅ | ✅ |
| `GET /trips/{id}/collaborators` | ✅ | ✅ (sees who else is on the trip) |
| `POST /trips/{id}/collaborators` | ✅ | ❌ |
| `PUT /trips/{id}/owner` (transfer) | ✅ | ❌ |
| `DELETE .../collaborators/{id}` — someone else | ✅ | ❌ |
| `DELETE .../collaborators/{id}` — yourself | n/a | ✅ (this is "leave trip") |
| `GET /invitations`, `PUT /invitations/{id}` | your own invitations only | your own invitations only |

**Inviting is owner-only.** Either rule is one line of code, so this is a
product call, not a convenience one: with one person managing the list, "who
let this person in and who can remove them" always has the same answer. It is a
one-word change (`owner_only=False`) if you later want any editor to invite.

`DELETE /trips/{id}` is the one place a **403 with a real message** beats the
house-style 404: the caller demonstrably can see the trip, and "Only the trip
owner can delete this trip. You can leave it instead." is exactly the sentence
the UI needs.

### Concrete edits

**`shared/utils.py`** — rename the `owner_user_id` parameter to `user_id` in
`get_or_create_trip_day_for_date`, `resolve_trip_day`, and
`get_or_create_default_trip_day`, and replace their inline ownership SQL with
`require_trip_access`. Per finding 1, this is the make-or-break edit.

**`lambdas/trips/handler.py`**

* `_get_trips` — swap the `WHERE` for the access predicate; add `role`,
  `owner_email`, and `collaborators_count` to each row so the card can render a
  badge without a second request; keep `events_count`.
* `_update_trip` — `require_trip_access(...)` first, then an UPDATE keyed on
  `id` alone.
* `_delete_trip` — `require_trip_access(..., owner_only=True)`.
* new `_list_collaborators` / `_add_collaborator` / `_remove_collaborator` /
  `_transfer_owner` / `_list_invitations` / `_respond_to_invitation`.

**`lambdas/itinerary/handler.py`** — replace `t.owner_user_id = %s` in the three
queries with the access predicate; the four handlers otherwise stay as they are.

**`lambdas/users/handler.py`** — `trips_count` becomes owned + shared, so the
profile agrees with the home screen.

---

## 3. API surface

All six routes are served by the **existing `traveleria-trips` Lambda** rather
than a new function: it already owns `/trips/{trip_id}`, shares `shared/auth`
and `shared/utils`, and adding to it makes the deploy one
`update-function-code` plus an additive `add_routes.sh` run.

```
GET    /trips/{trip_id}/collaborators
POST   /trips/{trip_id}/collaborators
DELETE /trips/{trip_id}/collaborators/{collaborator_id}
PUT    /trips/{trip_id}/owner
GET    /invitations
PUT    /invitations/{invitation_id}
```

`/invitations` is a slightly odd tenant of a Lambda called `traveleria-trips`,
but a seventh Lambda for two endpoints costs a function, a role attachment, and
another thing to remember to redeploy. Worth revisiting only if invitations grow.

### `GET /trips/{trip_id}/collaborators`

```json
{
  "owner": {
    "email": "ana@example.com", "full_name": "Ana",
    "avatar_url": "https://…", "is_you": true
  },
  "collaborators": [
    { "id": "uuid", "email": "ben@example.com", "full_name": "Ben",
      "avatar_url": null, "status": "active", "is_you": false },
    { "id": "uuid", "email": "cara@example.com", "full_name": null,
      "avatar_url": null, "status": "pending", "is_you": false },
    { "id": "uuid", "email": "dan@example.com", "full_name": "Dan",
      "avatar_url": null, "status": "declined", "is_you": false }
  ],
  "your_role": "owner"
}
```

`avatar_url` is presigned the same way `_get_profile` does it, and only for
users who have an account — a never-claimed invite has no photo to show.

### `POST /trips/{trip_id}/collaborators`

Request `{ "email": "ben@example.com" }`. Server-side rules:

1. Trim and lowercase; validate with the same shape the signup screen uses
   (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`,
   [signup.tsx:127](traveleria/app/signup.tsx:127)). Worth lifting into
   `utils/validation.ts` so both screens share one definition.
2. Reject your own email and the owner's email — "They already have access to
   this trip."
3. Cap at **10 collaborators per trip** — a guard against a runaway client, not
   a product limit; easy to raise.
4. Look the email up in `users`; set `user_id` when found, leave it `NULL` when
   not. `status` is `'pending'` either way.
5. `ON CONFLICT (trip_id, email) DO UPDATE` — resets `status` to `'pending'` and
   clears `responded_at` **only when the existing row is `declined`**; an
   `active` or already-`pending` row is returned untouched, so a double tap is
   idempotent and re-inviting a declined person works without a second endpoint.

The response is one entry in the shape above, plus a `message` for the sheet to
show: *"Ben has been invited"* or *"Cara will see the invitation when they sign
in with that email."*

**Neither outcome is a failure**, so no status code or error path distinguishes
"this email has an account" from "it does not" — no email enumeration.

### `DELETE /trips/{trip_id}/collaborators/{collaborator_id}`

Allowed if you are the owner, or if the row is your own (this is *leave trip*).
Deletes the row outright rather than marking it declined — leaving should not
leave a tombstone in the owner's members list. Returns
`{ "message": "Removed from trip" }`. The removed user's next request 404s
normally; [§6](#6-seeing-each-others-changes) covers how the app explains that.

### `PUT /trips/{trip_id}/owner`

Owner-only. Request `{ "collaborator_id": "uuid" }`, which must be an `active`
row on this trip. In one transaction:

```sql
INSERT INTO trip_collaborators (trip_id, user_id, email, status, responded_at,
                                invited_by_user_id)
VALUES (%(trip)s, %(old_owner)s, %(old_owner_email)s, 'active', NOW(), %(old_owner)s)
ON CONFLICT (trip_id, email) DO UPDATE SET status = 'active', user_id = EXCLUDED.user_id;

DELETE FROM trip_collaborators WHERE id = %(collaborator_id)s;

UPDATE trips SET owner_user_id = %(new_owner)s, updated_at = NOW() WHERE id = %(trip)s;
```

The old owner stays on the trip as an editor — silently demoting someone off
their own trip would be worse than not offering the feature. Order matters:
insert the new row before deleting the old one so the trip is never
collaborator-less mid-transaction.

### `GET /invitations`

Pending invitations addressed to the signed-in user, with enough trip detail to
decide without opening anything:

```json
[
  { "id": "uuid", "trip": { "title": "Summer in Rome", "location": "ROME",
                            "date": "12.06.2026 - 19.06.2026" },
    "invited_by": { "email": "ana@example.com", "full_name": "Ana",
                    "avatar_url": "https://…" },
    "created_at": "2026-09-01T10:00:00Z" }
]
```

Filtered by `user_id = me AND status = 'pending'`. Never by email — the claim
step in [§4](#4-invite-claim-accept) is what turns an email into a `user_id`.

### `PUT /invitations/{invitation_id}`

Request `{ "action": "accept" }` or `{ "action": "decline" }`. Only the invitee
may respond; anyone else gets a 404. Sets `status` and `responded_at`.

Accept returns the trip in the same shape `GET /trips` uses, so the home screen
can drop it straight into the list without a round trip.

One route with an `action` rather than `/accept` and `/decline` sub-resources:
each extra path is another API Gateway resource, method, integration, and
Lambda permission in `add_routes.sh`, and this saves two of each for no loss in
clarity.

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

The claim is one statement added to `get_current_user`
([shared/auth.py](traveleria-backend/shared/auth.py)), right after the existing
user upsert and in the same transaction:

```sql
UPDATE trip_collaborators
   SET user_id = %s
 WHERE user_id IS NULL AND email = LOWER(%s)
```

Note what it does **not** do: it does not touch `status`. Claiming means "this
invitation now has a person attached", not "this person is on the trip".

It runs on every authenticated request, is a single indexed statement
(`idx_trip_collaborators_email_unclaimed`), and matches zero rows in the
overwhelming majority of cases.

**The email must be the verified Cognito email.** `get_current_user` reads it
from the ID token's `email` claim and already falls back to
`{sub}@cognito.local` when absent — that synthetic address can never match a
real invite, so the fallback is safe as it stands.

---

## 5. Frontend

### New — Invitations screen (`app/invitations.tsx`)

A pushed screen, not a tab. Five tabs is already the practical limit and an
invitation list is empty almost all of the time.

```
┌──────────────────────────────────────────┐
│  ←   Invitations                          │
├──────────────────────────────────────────┤
│  ⟨A⟩  Ana invited you to co-edit          │
│       ROME · Summer in Rome               │
│       12.06.2026 – 19.06.2026             │
│                          [ ✕ ]   [ ✓ ]    │
├──────────────────────────────────────────┤
│  ⟨M⟩  maya@example.com invited you to     │
│       LISBON · Long weekend               │
│       03.10.2026 – 06.10.2026             │
│                          [ ✕ ]   [ ✓ ]    │
└──────────────────────────────────────────┘
```

* ✓ accepts, ✕ declines, both through `PUT /invitations/{id}`.
* The row is disabled while its request is in flight and removed from the list
  on success — the same optimistic-with-rollback pattern the trip list uses for
  deletes.
* ✕ confirms through `Alert.alert` ("Decline this invitation? Ana would have to
  invite you again."); ✓ does not — accepting is trivially undoable by leaving.
* On accept, the trip is pushed into the home list immediately from the
  response, and a toast/Alert offers **Open trip**.
* Empty state: "No invitations right now."

### Entry point

A banner above the trip list on the home screen, shown **only when there is at
least one pending invitation**:

```
┌──────────────────────────────────────────┐
│  ✉  2 trip invitations              ›    │
└──────────────────────────────────────────┘
```

No dead UI when the count is zero, and no permanent bell icon competing with
the existing header. `home.tsx` fetches `/invitations` alongside `/trips` on
focus — the banner needs the count anyway, and it is one indexed query.

**Alternative if you want a permanent entry point:** a bell icon with a count
badge in the home header, always visible, opening the same screen. Say the word
and the plan switches; it is the same screen either way.

### Changed — home screen sections

`groupTripsByTime` stays exactly as it is; it just gets called on owned trips
only, and shared trips form their own section
([home.tsx:78](traveleria/app/(tabs)/home.tsx:78)):

```
Upcoming          ← trips you own, soonest first
Shared trips      ← trips shared with you, soonest first, past ones dimmed
Past              ← trips you own that have ended
```

Each section still only renders when it has rows, so a user with no shared
trips sees exactly today's screen. Section order is a one-line change if you
would rather have Shared at the top.

### Changed — trip card

* A **Shared** chip beside the existing status badge, plus a small "Shared by
  ana@…" line, on trips you do not own.
* The trash icon becomes **exit-outline / Leave**
  ([home.tsx:468](traveleria/app/(tabs)/home.tsx:468)), with its own
  confirmation copy: "Leave this trip? You will lose access until someone
  invites you again."
* Bulk selection must not fire a doomed `DELETE` on a shared trip. Exclude
  non-owned trips from **Select all** and say why — "3 of 5 selected — shared
  trips can't be deleted". Mixing delete and leave into one bulk action is a
  good way to lose a trip by accident.

### New — members sheet

A `person-add-outline` button in the `trip-details.tsx` header opens a modal in
the same style as the existing event modal:

```
┌─────────────────────────────────────┐
│  Trip members                    ✕  │
├─────────────────────────────────────┤
│  ⟨A⟩  Ana        Owner · You        │
│  ⟨B⟩  Ben        Editor        ⋯    │
│  ⟨ ⟩  cara@…     Invited       ⊖    │
│  ⟨D⟩  Dan        Declined      ⊖    │
├─────────────────────────────────────┤
│  Add by email                       │
│  [ name@example.com          ] [+]  │
│  They will get an invitation to     │
│  accept before they can edit.       │
└─────────────────────────────────────┘
```

* Owner's view: `⊖` removes; `⋯` on an **active** collaborator offers **Make
  owner** (transfer) and **Remove**.
* Collaborator's view: no add field, and the only action is **Leave** on their
  own row.
* Transfer confirms hard: "Make Ben the owner? You will become an editor and
  will no longer be able to delete this trip or manage members."
* Validation errors appear inline under the field, in the
  `FormField`/`fieldErrors` idiom both existing forms already use — not in an
  `Alert`.

### Changed — trip details

* Header shows small stacked member avatars; tapping opens the members sheet.
* 404 handling per [§6](#6-seeing-each-others-changes).

### New — service module

`services/tripSharingService.ts`, mirroring `walletService.ts`: typed
`listCollaborators`, `addCollaborator`, `removeCollaborator`, `transferOwner`,
`listInvitations`, `respondToInvitation`, all through `apiFetch`.

### Identity

`CurrentUserContext` is a stub with a hardcoded id and name (finding 5). The
members sheet needs the real email to mark "You" and to catch "don't invite
yourself" before the round trip. Smallest fix: have the context load
`GET /users` once on mount and expose `{ email, full_name, avatar_url }`. The
server checks anyway, so this is for display only.

---

## 6. Seeing each other's changes

There is no realtime infrastructure in this stack — REST over API Gateway,
Lambda, RDS. This plan does **not** add WebSockets.

**a. Refetch when the screen is looked at.** `home.tsx` fetches once in a
`useEffect` ([:384](traveleria/app/(tabs)/home.tsx:384)) and `trip-details.tsx`
does the same ([:429](traveleria/app/trip-details.tsx:429)). Switch both to
`useFocusEffect`, so returning from another tab or screen re-reads. This alone
fixes the common case: two people with the app open, taking turns. Pull-to-
refresh already exists on the home list and covers the rest.

**b. Optional, only if that feels stale:** a `touch_trip(db, trip_id)` helper
called by every itinerary write, so `trips.updated_at` becomes a real "anything
in this trip changed" marker, plus a `GET /trips/{trip_id}/version` polled every
20s while the trip screen is focused, refetching only when the timestamp moves.
One indexed row read per poll. **Not in the v1 scope above** — it is a seventh
route, and refresh-on-focus should be measured first.

**c. Explaining disappearance.** When a screen gets a 404 for a trip it was just
showing, say *"This trip is no longer shared with you"* and pop back to the
list, rather than showing the generic connection error. One status check in
`fetchItinerary`.

### Conflicts

Granularity is one row per event and one row per trip header, and last write
wins. That is the right call for a two-person trip planner, but it should be
stated rather than assumed:

| Situation | Behaviour |
|---|---|
| Both edit different events | Both saved. No conflict. |
| Both edit the same event | The later save wins silently. |
| A edits an event B just deleted | A gets 404 → *"That event was removed by someone else."* and the list refreshes. |
| A narrows the dates, B adds an event outside them | Existing behaviour: nothing is deleted, the event still shows under its own day, and the `events_outside_range` warning already covers it ([trips/handler.py:88](traveleria-backend/lambdas/trips/handler.py:88)). |
| Both edit the trip header | Later write wins. |

Optimistic concurrency — sending back the `updated_at` you read and rejecting a
stale write with 409 — is deliberately **out of scope**. This table is here so
the decision is on the record rather than accidental.

---

## 7. Chat — deferred

The AI chat is being rebuilt on another branch. **This plan does not design the
shared-trip chat architecture**, and no work in it touches chat.

What is true today, and what co-editing relies on:

* Chat is **not persisted anywhere**. `messages` is plain component state seeded
  on mount ([trip-details.tsx:62](traveleria/app/trip-details.tsx:62)), and
  `POST /chat` ([:381](traveleria/app/trip-details.tsx:381)) is stateless — it
  does not even receive a trip id. So a shared trip cannot leak a conversation,
  because there is no conversation to leak.
* Co-editing adds nothing to the chat path, so shipping it cannot change that.

Two constraints to carry into the chat design once that branch merges, so the
work does not have to be redone:

1. **A conversation is keyed by (trip, user), never by trip alone.** Every read
   filters on both. This is the requirement from the original brief and it does
   not change.
2. **If chat is ever cached on the device, the key includes the user id.**
   `sql/006_wallet_documents.sql` exists precisely because the wallet kept state
   in AsyncStorage under a device-global key, so every account signed in on one
   device saw the same files. A `chat:{tripId}` key would reproduce that bug
   exactly.

Settled now so it does not need re-litigating later: **the assistant may read
the full shared trip** — every event, date, and detail, whoever created it. Trip
data is shared; conversations are not.

Revisit this section once the chat branch is on `dev`.

---

## Files touched

| File | Change |
|---|---|
| `traveleria-backend/sql/009_trip_collaborators.sql` | **new** — table + indexes |
| `traveleria-backend/shared/utils.py` | `get_trip_access` / `require_trip_access`; `owner_user_id` → `user_id` in the three trip-day helpers |
| `traveleria-backend/shared/auth.py` | claim unclaimed invites on sign-in |
| `traveleria-backend/lambdas/trips/handler.py` | list query, access checks, collaborators, transfer, invitations |
| `traveleria-backend/lambdas/itinerary/handler.py` | access predicate in three queries |
| `traveleria-backend/lambdas/users/handler.py` | `trips_count` includes shared trips |
| `traveleria-backend/scripts/add_routes.sh` | five new resources, six methods |
| `traveleria/services/tripSharingService.ts` | **new** |
| `traveleria/components/TripMembersSheet.tsx` | **new** |
| `traveleria/app/invitations.tsx` | **new** |
| `traveleria/utils/validation.ts` | shared `validateEmail` |
| `traveleria/contexts/CurrentUserContext.tsx` | real signed-in identity |
| `traveleria/app/(tabs)/home.tsx` | invitations banner, Shared trips section, shared chip, leave vs delete, bulk-select rule, focus refetch |
| `traveleria/app/trip-details.tsx` | members button and sheet, avatars, 404 copy, focus refetch |

Untouched, and worth stating: `lambdas/wallet/handler.py`,
`app/(tabs)/wallet.tsx`, `services/walletService.ts` (beyond the dead-column
cleanup in finding 3), `lambdas/chat/handler.py`,
and the chat pane in `trip-details.tsx`.

---

## Deployment

1. `python scripts/init_db.py` — additive migration, safe any time, safe to
   re-run.
2. `update-function-code` for **`traveleria-trips`**, **`traveleria-itinerary`**
   and **`traveleria-users`**. All Lambdas bundle `shared/`, and `shared/auth.py`
   changes, so `traveleria-wallet`, `-chat` and `-health` should be redeployed
   too for consistency even though their behaviour is unchanged.
3. `bash scripts/add_routes.sh` in CloudShell for the six new routes.

**Do not run `deploy_cloudshell.sh`.** It deletes and recreates the REST API,
which mints a new invoke URL and breaks `EXPO_PUBLIC_API_URL` in every installed
build. `add_routes.sh` is additive and leaves the URL alone.

Order matters: migration first (the new table is one the old code never touches,
so old Lambdas keep working), then the Lambdas, then the routes. Rolling back is
redeploying the previous zips; the table can stay.

---

## Manual test checklist

Two accounts, A (owner) and B.

**Invitations**

- A adds B's email → B refreshes home → banner shows "1 trip invitation"; the
  trip is **not** in B's list yet.
- B opens Invitations → sees the trip, the dates, and A's name → taps ✓ → the
  trip appears under **Shared trips**; the banner is gone.
- A invites B to a second trip, B taps ✕ → the trip never appears for B; A's
  members sheet shows **Declined**.
- A invites the declined B again → the invitation comes back as pending, no
  duplicate row.
- A invites an email with no account → shows **Invited**; that person signs up
  with that email → the invitation is waiting on first load.
- A invites their own email → refused with a readable message.
- A invites the same email twice in a row → no duplicate, no error.
- B declines, then tries to open the trip by any means → 404, no access.

**Co-editing**

- B renames the trip and adds an event → A refreshes → both changes are there.
- A adds an event → B's open trip screen picks it up on focus.
- Both add an event to the same day at once → both survive.
- A deletes an event B is editing → B gets "removed by someone else", not a
  silent failure.

**Roles**

- B tries to delete the trip → offered **Leave**, not delete; leaving removes it
  from B's list and leaves A's untouched.
- B's members sheet has no add field and no ⊖ on A's row.
- A removes B → B's next action says the trip is no longer shared and returns to
  the list, rather than showing a connection error.
- A transfers ownership to B → B can now delete and manage members; A is an
  editor on the same trip and sees **Leave** where **Delete** used to be.
- Bulk select on B's home screen: shared trips are excluded from Select all and
  the count explains why.
- A deletes the trip → it disappears for B too, with a sensible message.

**Regression**

- Sign in as a user with no invites → no measurable slowdown (the claim UPDATE
  matches nothing).
- A user with no shared trips and no invitations sees today's home screen
  exactly: no banner, no Shared section.
- The wallet is unchanged for both accounts.

---

## Risks

| Risk | Mitigation |
|---|---|
| A missed `owner_user_id` leaves collaborators unable to write | One helper, and `grep -rn owner_user_id lambdas shared` must afterwards return only `_create_trip`, `_delete_trip`, `_transfer_owner` and the access helper |
| A `pending` row accidentally granting access | `status = 'active'` is in the single shared predicate; nothing else queries the table for access |
| A collaborator deletes the whole trip | `owner_only=True` on delete, plus the UI offering **Leave** instead |
| Ownership transferred to the wrong person, irreversibly | Only `active` collaborators are offered; hard confirmation naming them; the new owner can transfer back |
| Invite typo grants access to the wrong real person | They must accept before seeing anything, the address is shown in the members sheet, and the owner can revoke at any time |
| Email enumeration through the invite endpoint | Both outcomes are a success; no path distinguishes registered from not |
| Two people editing the same event lose a change | Accepted for v1 and documented; refresh-on-focus keeps the window small |
| Invitations never noticed, because there is no push | The banner is on the first screen of the app and cannot be missed once the app is opened; push is out of scope by decision |
| A stale invitation accepted much later | `created_at` and `responded_at` are recorded, so pending invitations can be listed and expired later if wanted |

---

## Settled design decisions

Recorded so they are not re-opened by accident:

1. **Invitations are accepted or declined**, not auto-joined — dedicated
   Invitations screen with ✓ / ✕ per row, reached from a banner on home.
2. **Only the owner invites and removes.** One line to relax later.
3. **Shared trips get their own section** on the home list.
4. **The wallet is not involved.** It is per-user and has no link to trips. The
   vestigial `wallet_documents.trip_id` column that implied one has been
   dropped (`sql/008_drop_wallet_document_trip_id.sql`).
5. **The assistant sees the whole shared trip.**
6. **Ownership transfer is in scope** — `PUT /trips/{trip_id}/owner`, owner-only,
   old owner stays on as an editor.
7. **No notifications** — no push, no email. The banner is the whole surface.

## Still open

1. **Invitations entry point:** banner-when-nonzero (planned) or a permanent
   bell with a badge in the home header. Same screen either way.
2. **Section order on home:** Upcoming / Shared trips / Past (planned), or
   Shared first.
3. **Chat**, entirely — deferred until the chat branch merges. See
   [§7](#7-chat--deferred).
4. **Owner account deletion.** No account-deletion endpoint exists today, so
   nothing is broken. Whenever one is added, note that `ON DELETE CASCADE` on
   `trips.owner_user_id` would delete shared trips out from under their
   collaborators; auto-transfer to the longest-standing editor would be the
   kinder behaviour.
