# Traveleria — Round 3 Fixes Plan

Implementation plan for three requested changes, based on an audit of the code
on branch `small-fixes-round-2` (2026-08-31).

Nothing has been implemented yet.

---

## Summary

| # | Change | Layers touched | Deploy needed | Effort |
|---|--------|----------------|---------------|--------|
| 1 | Signup: drop first name, add confirm-password | Frontend only | — | Small |
| 2 | Wallet + avatar to S3, per-user isolation | **Frontend + new Lambda + S3 + DB + new API routes** | Lambda, routes, migration | **Large** |
| 3 | Home: edit, delete, and bulk-delete trips | Frontend + `trips` Lambda + new API routes | Lambda, routes | Medium |

**Change 2 is not a tweak — it is building a feature that does not exist yet.**
It is roughly as much work as 1 and 3 combined. See the audit below.

**Suggested order:** 1 → 3 → 2. Changes 1 and 3 are self-contained and ship
quickly; 2 needs AWS resources confirmed first and has the longest tail.

---

## Audit findings

Measured from the code, not assumed.

1. **Wallet documents were never in S3.** There is no wallet Lambda, no S3
   call, and no API call anywhere in the repo.
   `app/(tabs)/wallet.tsx:39` keeps a JSON array in AsyncStorage under the
   device-global key `"wallet_documents"`, and each entry holds only a `uri`
   pointing into the device's DocumentPicker cache.

   `CLAUDE.md` states the wallet is "handled separately by a dedicated AWS
   Lambda… Documents stored in S3 with per-user folder isolation." **That is
   not true of this codebase.** Either it was never built, or it was lost. The
   `wallet_documents` table exists in `sql/001_create_tables.sql` and nothing
   has ever written to it.

   Consequences beyond the account leak that prompted this:
   - Documents vanish when the OS clears the cache directory.
   - They do not survive a reinstall, and do not follow the user to a new device.
   - Every account signed in on a device sees the same list.

2. **The profile photo has the identical bug.** `profile.tsx:37` —
   `PHOTO_KEY = "profile_photo_uri"`, device-global, no user scoping.

3. **`given_name` is collected at signup and never used.** `shared/auth.py`
   upserts only `email` and `cognito_sub`; the profile's "Full Name" is typed
   separately in Edit Profile and stored in `users.full_name`. Removing the
   first-name field therefore costs nothing on the backend. **The one risk is
   the Cognito pool itself** — if `given_name` is marked a required attribute,
   `signUp` will start failing. This must be checked before shipping (§0).

4. **Adding API Gateway routes is safe. My earlier advice was over-cautious.**
   The routes wired today are:

   | Resource | Methods |
   |---|---|
   | `/` | GET |
   | `/trips` | GET, POST |
   | `/trips/{trip_id}` | **none — resource exists, no methods** |
   | `/trips/{trip_id}/itinerary` | GET, POST |
   | `/trips/{trip_id}/itinerary/{event_id}` | PUT, DELETE |
   | `/users/me` | GET, PATCH |
   | `/chat` | POST |

   `/trips/{trip_id}` already exists as the parent of `/itinerary`, so change 3
   only needs two methods added to it. `create-resource`, `put-method`,
   `put-integration` and `create-deployment` all operate on the **existing** API
   id and republish the **same** stage. The invoke URL is unchanged. Only
   `delete-rest-api` — which just `deploy_cloudshell.sh` calls — changes it.

5. **`places` rows leak on trip deletion.** `day_places.place_id` is
   `ON DELETE RESTRICT`, and `_create_item` inserts a fresh `places` row per
   event (`google_place_id = manual:<uuid>`). Deleting a trip cascades
   `trip_days` → `day_places` away but strands every `places` row. Change 3
   must clean these up or the table grows without bound.

6. **`wallet_documents` lacks the columns the UI needs.** It has `id`,
   `user_id`, `trip_id`, `document_type`, `s3_key`, timestamps. The wallet UI
   also shows a `title` and a user-chosen `color`, and needs `mime_type` to
   decide between the image viewer and the WebView.

---

## §0 — Facts needed before change 2 can be finalised

Run these in CloudShell and paste the output. The plan below has placeholders
that these fill in.

**a. The bucket name**

```bash
aws s3 ls
```

**b. Whether a wallet Lambda / second API already exists**

```bash
aws lambda list-functions --region us-east-1 --query "Functions[].FunctionName" --output text && aws apigateway get-rest-apis --region us-east-1 --query "items[].{id:id,name:name}" --output table
```

If a wallet Lambda is already deployed, we may be able to reuse it rather than
writing a new one — that would materially shrink change 2.

**c. Whether Cognito requires `given_name`** (needed for change 1)

```bash
aws cognito-idp describe-user-pool --user-pool-id us-east-1_hxHdB32mE --region us-east-1 --query "UserPool.SchemaAttributes[?Name=='given_name'].{name:Name,required:Required,mutable:Mutable}" --output table
```

`required: False` (or no row) means the first-name field can be removed with no
pool change. `required: True` means the attribute must stay populated — see §1.

> These commands print no secrets. Unlike `update-function-code`, none of them
> return a function's environment block.

---

## 1. Signup: drop first name, confirm the password

### Goal
Signup collects **email**, **password**, and **confirm password**. The two
passwords must match, and the password must meet the existing strength rules.

### UX
Three fields. Errors render **inline under the field** via `FormField`'s
`error` prop, rather than the `Alert` dialogs used today — the trip and event
forms already work this way, and an alert cannot point at which field is wrong.

- Confirm-password mismatch is only shown once the user has typed something in
  the confirm field, so it does not shout while they are still typing.
- The strength hint stays where it is, under the password field.

### Changes — frontend only

**`app/signup.tsx`**
- Delete `firstName` state and its `FormField`.
- Add `confirmPassword` state and field, `secureTextEntry`, `autoComplete="new-password"`.
- Replace the three `Alert.alert` validation branches with a
  `SignupFieldErrors = { email?, password?, confirm? }` object, matching the
  `EventFieldErrors` pattern in `trip-details.tsx`.
- Validation, in order: required → email format → password strength →
  passwords match.
- Clear a field's error as the user edits it (`clearFieldError`, same helper
  shape as the event form).

**`services/authService.ts`**
- `registerUser({ email, password })` — drop the `firstName` parameter and the
  `given_name` user attribute.

**If §0c shows `given_name` is required**, do not fight the pool. Two options,
in order of preference:
1. Make the attribute optional in the Cognito console (User pool → Sign-up →
   Attributes). Cognito **does not allow changing `Required` after the pool is
   created**, so this likely means it cannot be changed.
2. Keep sending a value derived from the email local-part
   (`shirel.sam@…` → `shirel`) so the pool stays satisfied while the user is
   never asked. It is unused by the app either way (finding 3).

### Manual test checklist
- Empty fields → per-field errors, no alert.
- `a@b` → email error only.
- `password` → strength error only.
- Strong password, mismatched confirm → confirm error only.
- All valid → verification step appears, code arrives, account verifies.
- **Then log in.** This is the check that proves the pool accepted a signup
  without `given_name`.

---

## 2. Wallet and avatar in S3, isolated per user

### Goal
Documents and the profile photo live in S3 under a per-user prefix, are fetched
from S3 rather than the device, and follow the user across reinstalls and
devices. No account can see another's files.

### Architecture

**Files never pass through Lambda.** The Lambda issues **presigned URLs** and
the app talks to S3 directly. Proxying bytes through API Gateway would cap
uploads at ~6 MB after base64, and burn Lambda time on transfer.

**Key layout** — `users/{user_id}/wallet/{document_id}{ext}` and
`users/{user_id}/avatar{ext}`, where `user_id` is `users.id` (the UUID the
`wallet_documents.user_id` foreign key already points at).

Isolation is enforced **in the handler, not by the key format**: every request
resolves `user_id` from the validated Cognito token, and every query is scoped
`WHERE user_id = %s`. A key prefix alone is a naming convention, not a control
— a client never gets to name its own key.

### New Lambda — `lambdas/wallet/handler.py`

| Route | Method | Behaviour |
|---|---|---|
| `/wallet` | GET | List the user's documents, each with a short-lived presigned **GET** URL for viewing. |
| `/wallet` | POST | Insert the `wallet_documents` row, return its id plus a presigned **PUT** URL the app uploads to. |
| `/wallet/{document_id}` | PUT | Update `title` / `color` / `trip_id`. Never touches the S3 object. |
| `/wallet/{document_id}` | DELETE | Delete the S3 object, then the row. |

Details that matter:
- **Presigned GET TTL: 15 minutes.** Long enough to open a document, short
  enough that a leaked URL is not a standing grant. The list is re-fetched on
  focus, so URLs refresh naturally.
- **Presigned PUT TTL: 5 minutes**, and pinned to the exact `ContentType` the
  client declared, so the URL cannot be reused to upload something else.
- **`boto3` is preinstalled in the Lambda runtime** — no change to the pip
  dependency list, and the deploy recipe is unchanged.
- **Upload is two-phase**, so a failed upload cannot leave a row pointing at a
  missing object: POST creates the row with `upload_status='pending'`, and the
  app calls PUT (or a tiny `?confirm=1`) to mark it `ready` once S3 returns
  200. The list endpoint hides `pending` rows older than an hour.

### Database — new `sql/006_wallet_documents.sql`

```sql
ALTER TABLE wallet_documents ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE wallet_documents ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE wallet_documents ADD COLUMN IF NOT EXISTS mime_type TEXT;
ALTER TABLE wallet_documents ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE wallet_documents ADD COLUMN IF NOT EXISTS upload_status TEXT NOT NULL DEFAULT 'ready';
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_s3_key TEXT;
```

Follows the additive `ALTER … IF NOT EXISTS` pattern of 002/003. Idempotent, no
type changes — nothing like the 005 migration.

### Profile photo — no new routes

Reuses `/users/me`, which already exists:
- `GET /users/me` returns `avatar_url`, a presigned GET URL, when
  `avatar_s3_key` is set.
- `PATCH /users/me` with `{"avatar_content_type": "image/jpeg"}` sets the key
  and returns a presigned PUT URL.

This keeps the avatar out of the wallet Lambda and adds zero API surface.

### S3 bucket configuration

Against the existing bucket (name from §0a):
- **Block all public access: ON.** Presigned URLs work regardless — that is the
  point of them.
- **CORS**: not needed for the native app, but add a rule allowing `GET`/`PUT`
  so `npm run web` keeps working.
- **IAM**: the Lambda runs as `LabRole`. A presigned URL carries the *signer's*
  permissions, so `LabRole` needs `s3:PutObject`, `s3:GetObject` and
  `s3:DeleteObject` on `arn:aws:s3:::<bucket>/users/*`. In AWS Academy labs
  `LabRole` is usually broad enough already — to be confirmed, and it is the
  most likely thing to block this change.

### Migrating existing local documents

One-time, client-side, best-effort, on first launch of the new build: if
AsyncStorage still holds `wallet_documents`, upload each entry through the new
flow, then clear the key.

**Expect most of these to fail**, and design for it: the stored `uri` values
point into a cache directory the OS may have already emptied. Entries that
cannot be read are reported once ("3 documents could not be moved — please add
them again") and dropped, rather than retried forever.

### Frontend changes

**New `services/walletService.ts`** — list / create+upload / update / delete,
wrapping `apiFetch` plus the direct `fetch(presignedUrl, { method: "PUT", body })`.

**`app/(tabs)/wallet.tsx`** — replace all AsyncStorage use with the service.
Add loading, error and pull-to-refresh states, which a local-only list never
needed. The viewer modal takes the presigned URL instead of a `file://` URI;
`allowFileAccess*` props on the WebView can go.

**`app/(tabs)/profile.tsx`** — `handleChangePhoto` uploads to S3 and stores
nothing locally. `PHOTO_KEY` and its AsyncStorage reads/writes are deleted.

> **Deleting `PHOTO_KEY` is what actually fixes the leak you saw.** Scoping the
> key per user would also have worked, but the photo has to go to S3 anyway to
> survive a reinstall, so there is no reason to keep a device-local copy.

### Manual test checklist
- Add a document → appears; force-quit and reopen → still there.
- **Sign out, sign in as the other account → wallet is empty and the avatar is
  the default.** This is the bug being fixed; test it explicitly.
- Sign back in as the first account → both are back.
- Delete a document → gone from the list, and the S3 object is gone
  (`aws s3 ls s3://<bucket>/users/<id>/wallet/`).
- Open a document more than 15 minutes after loading the list → still opens
  (the list refreshed on focus).
- Reinstall the app → documents and photo are still there. This is the check
  that proves nothing is local any more.

---

## 3. Edit, delete, and bulk-delete trips

### Goal
From Home: edit every value of an existing trip, delete one trip, or select
several and delete them together — the same interaction the daily plan now has.

### Backend — `lambdas/trips/handler.py`

Add to the existing handler, routed on `/trips/{trip_id}`:

- **PUT** — update `title`, `location`, and the date range. Reuses
  `parse_trip_dates` and the same validation as create. Scoped
  `WHERE id = %s AND owner_user_id = %s`; a miss is 404, which is also the
  ownership check.

- **DELETE** — remove the trip and everything under it.

  `trips → trip_days → day_places` all cascade, but **`places` does not**: it is
  `ON DELETE RESTRICT` from `day_places`, and every event owns a private
  `places` row. The handler must therefore collect the trip's `place_id`s
  *before* deleting, then remove the ones no longer referenced afterwards:

  ```sql
  -- 1. collect
  SELECT dp.place_id FROM day_places dp
  JOIN trip_days td ON td.id = dp.trip_day_id
  WHERE td.trip_id = %s;
  -- 2. DELETE FROM trips ... (cascades trip_days, day_places)
  -- 3. DELETE FROM places WHERE id = ANY(%s)
  --    AND NOT EXISTS (SELECT 1 FROM day_places WHERE place_id = places.id)
  ```

  Step 3's `NOT EXISTS` guard matters: a `places` row shared with another trip
  must survive. Today they never are, but the guard costs nothing and stops
  this becoming a data-loss bug the moment place reuse is introduced.

**Shrinking a trip's dates** is allowed and does not delete anything. Events
that fall outside the new range keep their `trip_days` row and still appear —
`groupEventsByDay` builds sections from the union of trip days and event days
precisely so nothing hides. The edit form warns when the new range excludes
existing events, but does not block it.

### API Gateway — two methods on an existing resource

`/trips/{trip_id}` exists already with no methods. Adding PUT and DELETE needs
no new resource and **does not change the invoke URL**.

New `scripts/add_routes.sh` — a small, idempotent, **additive-only** script:
looks up the API by name, adds only missing methods/integrations/permissions,
then `create-deployment` to `prod`. It contains no `delete-*` call of any kind.
It also creates the `/wallet` and `/wallet/{document_id}` resources for change
2, so routes are added once rather than twice.

> This script exists so that adding a route never again means reaching for
> `deploy_cloudshell.sh`.

### Frontend — `app/(tabs)/home.tsx`

The create-trip form is currently inline. Extract it into
`components/TripFormModal.tsx` taking an optional `trip` prop, so create and
edit are one component rather than two copies that drift.

Then mirror the daily plan's interaction exactly, so the app has one way of
doing this:
- Long-press a trip card, or a **Select** button in the section header, enters
  selection mode.
- Cards show a checkbox; the header becomes Cancel · "3 selected" · Select all · trash.
- Bulk delete fans out with `Promise.allSettled` over `DELETE /trips/{id}`,
  removes only confirmed deletions, and leaves failures selected.
- Single delete gets a confirmation naming the trip **and its consequences**:
  *"Delete 'Rome 2026'? Its 12 events will be deleted too. This cannot be
  undone."* Trips carry much more than an event does; the count makes that
  concrete.

Edit is a pencil on the card, opening `TripFormModal` prefilled.

### Manual test checklist
- Edit a trip's title, location and dates → Home reflects all three; the trip
  detail header updates too.
- Shrink the dates below existing events → events still visible under their own
  day headers, not lost.
- Delete a trip with events → gone, and `SELECT COUNT(*) FROM places` drops by
  the number of events it had (proving finding 5 is handled).
- Select 2 of 3 trips, delete → exactly those two go.
- Confirm another account's trips are untouched throughout.

---

## Deployment, in order

1. `sql/006_wallet_documents.sql` via `init_db.py` — additive, safe to run any time.
2. `scripts/add_routes.sh` in CloudShell — adds routes, redeploys the `prod` stage.
3. `update-function-code` for `traveleria-trips`, `traveleria-users`, and the
   new `traveleria-wallet` (which needs `create-function` the first time).
4. App OTA.

**Never `deploy_cloudshell.sh`.**

---

## Risks, ranked

| Risk | Where | Mitigation |
|---|---|---|
| `LabRole` cannot sign S3 operations | Change 2 | Verify before building; it is the single most likely blocker. Check early (§0). |
| Cognito requires `given_name` | Change 1 | `Required` cannot be altered after pool creation — fall back to deriving it from the email. |
| Existing local wallet documents are unrecoverable | Change 2 | Their URIs point at a cache the OS may have cleared. Best-effort migration, reported once, then dropped. |
| Orphaned `places` rows on trip delete | Change 3 | Explicit cleanup with a `NOT EXISTS` guard. |
| Presigned URL expiring while a document is open | Change 2 | 15-minute TTL, list refreshed on focus. |
| A new route needs the full deploy script | Changes 2 & 3 | `add_routes.sh` is additive-only and contains no `delete-*` call. |

---

## Open questions

1. **The three §0 commands** — bucket name, existing wallet Lambda, and the
   `given_name` requirement. Change 2 cannot be finalised without (a).
2. **Should wallet documents be attachable to a trip?** `wallet_documents.trip_id`
   exists and is unused. Adding a trip picker is small now and awkward later.
   Plan assumes the column stays nullable and unused for now.
3. **Avatar size cap.** Photos are already compressed to `quality: 0.7` by the
   picker; propose rejecting anything over 5 MB server-side.
