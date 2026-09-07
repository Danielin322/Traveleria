# Plan: Automatic Destination Cover Photo

## Goal
When a user creates a new trip and picks a destination, the trip should automatically get a quality, trustworthy cover photo of that destination, instead of just a free-text field with no visual.

## Current state (verified against the code)
- The "Destination" field on the frontend lives at `app/(tabs)/home.tsx:594` — a plain `FormField` that writes to `newLocation` and is sent to the server as `location`.
- The `trips` table (`traveleria-backend/sql/001_create_tables.sql`) has a `location TEXT NOT NULL` column. There is currently no image/cover column.
- **Important:** `CLAUDE.md` describes a single-`main.py` architecture, but the backend has actually already been split into per-resource Lambdas: `lambdas/trips/handler.py`, `lambdas/itinerary/`, `lambdas/users/`, `lambdas/chat/`, `lambdas/wallet/`, `lambdas/health/`, run locally via `local_server.py`. Trip creation is the `_create_trip` function in `lambdas/trips/handler.py:57`; updating is `_update_trip` at line 68.
- `OPENAI_API_KEY` and `GOOGLE_PLACES_API_KEY` already exist in `.env.example` — no new secrets infrastructure is needed.
  - `OPENAI_API_KEY` is currently used only in `lambdas/chat/handler.py` (`gpt-4.1-nano` model, text chat for itinerary planning).
  - `GOOGLE_PLACES_API_KEY` is currently used only in `lambdas/chat/handler.py`, in the `_lookup_place` function, which calls the `findplacefromtext` endpoint to find a place's coordinates — not Autocomplete, and not photos.
- An S3 pattern already exists in `lambdas/wallet/handler.py`: a dedicated bucket (`WALLET_BUCKET`), `boto3.client("s3")`, and per-user presigned URLs (`_view_url`). This fits private user files, but is **not** a good fit as-is for cover photos — those are public and shared across all users, and the URL shouldn't expire.
- There is currently no separate `TripCard` component and no image rendering on trip cards — this is a brand-new UI addition, not just wiring into an existing component.
- Libraries already in use that can be reused: `httpx` (in `chat/handler.py`) and `boto3` (in `wallet/handler.py`).

## Planned workflow (as you described it)
1. **Destination selection — Google Places Autocomplete (Frontend)**
   The Destination field becomes an autocomplete field. Selecting a result returns a normalized destination name (city+country, or just country if no city was specified) — e.g. `"Tokyo, Japan"`.
2. **S3 cache check (Backend, before any external call)**
   The destination name is normalized into a fixed key (slug), e.g. `covers/destinations/japan_tokyo.jpg`. If the file already exists in S3, the URL is returned immediately, with no external API call.
3. **Fetch a photo — Pexels API** (only if not already cached)
   Search with `orientation=landscape`, using the destination name as the query (+ "landmark landscape" etc.).
4. **Permanent storage + DB update**
   Download the image from Pexels, upload it to S3 under the same key, and save the URL/key on the `trips` table.
5. **Fallback**
   On a network failure or Pexels quota being hit → a fixed, quality default cover image stored in S3 (`defaults/travel-cover.jpg`).

## Final decisions
1. **OpenAI key** — not relevant to this feature. It remains exclusive to `chat/handler.py` and is not touched by the cover-photo flow.
2. **~~Global cache per destination~~ → a pool per destination (revised, see decision 9).** Originally: one cover photo per destination (slug), shared across every trip/user that picks it. Revised after testing: a second trip to a destination already in use by another trip should get a *different* photo, not the same one — see decision 9 for the actual design.
3. **Where the Autocomplete call runs** — proxied through the backend. The frontend does not call Google directly; `GOOGLE_PLACES_API_KEY` stays server-side only (as it does today).
4. **Editing the destination on an existing trip** — yes. Changing the destination in `_update_trip` triggers the same cover-photo flow (cache → Pexels → fallback) and updates the trip's linked cover accordingly.
5. **Photo provider — Pexels, not Unsplash.** Unsplash's API guidelines require photographer attribution (name + link, with UTM params) plus a one-time `GET /photos/:id/download` call whenever a photo is permanently cached — both were originally planned for here. Pexels's license permits caching/rehosting images indefinitely with no attribution requirement and no equivalent download-trigger call, which is both simpler to implement correctly and removes the ToS-compliance risk entirely. This switch happened after `UNSPLASH_ACCESS_KEY` was found to be unobtainable (no way to create a key), and Pexels was suggested as the alternative. `credit_name`/`credit_url` are still fetched and stored (in case they're wanted later), but are **no longer shown in the UI** — confirmed directly against Pexels's terms that attribution is optional, and the "Photo by … on Pexels" line was removed from the trip card.
6. **Stored image resolution** — Pexels's `large` size (~940px wide) from the `src` object in the API response. A good balance between quality and file size, and the closest equivalent to Unsplash's `regular` size from the original plan.
7. **URL storage** — the full public S3 URL is stored (not just the S3 key). Simpler to consume on both backend and frontend; a future move to CloudFront would mean a one-time backfill rather than a schema change.
8. **Schema shape** — a separate `destination_covers` table rather than columns duplicated on every `trips` row: the cover data is stored once per photo and trips just reference it.
9. **Variety within a destination, scoped per user (revises decision 2).** Requested after the feature was working end-to-end: a second trip *you* make to a destination you're already using should show a *different* photo — but two different users can still land on the same photo for the same destination; only one user's own trips compete with each other for the pool. `destination_covers` moved from being keyed by `slug` (exactly one row per destination) to being keyed by its own `id`, with `slug` as a plain (non-unique) column — so a destination can now hold a *pool* of several cover photos. `trips.destination_slug` became `trips.destination_cover_id`, pointing at one specific row. Assigning a cover to a trip (`get_or_create_cover_id(db, destination, owner_user_id, exclude_trip_id=None)` in `shared/cover_image.py`) picks an existing pool photo for that slug not already used by another of `owner_user_id`'s own trips; if every one already-used-by-this-user is taken (or there are none yet), it fetches one more from Pexels and adds it to the pool. Editing a trip without changing its destination keeps its own current photo — the trip's own id is excluded from the "already used" check via `exclude_trip_id` — rather than being bumped to a new one on every unrelated edit. Migration `sql/014_destination_cover_variants.sql` performs the schema change, backfilling `destination_cover_id` from the old `destination_slug` link before dropping the old column.

## Required changes

### DB
- Migration `sql/013_destination_covers.sql` created the original shape:
  ```sql
  CREATE TABLE IF NOT EXISTS destination_covers (
      slug TEXT PRIMARY KEY,
      cover_image_url TEXT NOT NULL,
      credit_name TEXT,
      credit_url TEXT,
      photo_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  ALTER TABLE trips ADD COLUMN IF NOT EXISTS destination_slug TEXT REFERENCES destination_covers(slug) ON DELETE SET NULL;
  ```
- Migration `sql/014_destination_cover_variants.sql` then revised it for decision 9 (a pool per destination, not one row): `destination_covers` gets an `id UUID PRIMARY KEY` (generated), `slug` becomes a plain indexed column (no longer unique — multiple rows can share a slug), and `trips.destination_slug` is replaced by `trips.destination_cover_id UUID REFERENCES destination_covers(id) ON DELETE SET NULL`, backfilled from the old link before the old column is dropped. `credit_name`/`credit_url` remain the optional photographer credit (decision 5, not shown in the UI); `photo_id` is the Pexels photo id, kept for reference/debugging; `cover_image_url` is still the full public S3 URL (decision 7).
- Reading a trip's cover means a `LEFT JOIN destination_covers dc ON dc.id = trips.destination_cover_id` in the trip queries in `lambdas/trips/handler.py` (`_get_trips`, `_respond_to_invitation`, and the `RETURNING`/re-select in `_create_trip`/`_update_trip`), and exposing `cover_image_url`/`credit_name`/`credit_url` in `serialize_trip` (`shared/utils.py:55`).

### S3
- **Decision: a new, separate bucket** (not a prefix inside `WALLET_BUCKET`) — because this is public-read versus wallet's private access, and it's better to fully isolate it so wallet permissions can't be put at risk by mistake. Env var name: `TRIP_COVERS_BUCKET`.
- Folder structure inside the bucket: `covers/destinations/<slug>/<photo_id>.jpg` (a destination can hold several, see decision 9) + `covers/defaults/travel-cover.jpg`.
- Permissions: the whole bucket is public-read (`GetObject` only, not `List`/`Write`) — it's dedicated solely to cover photos, so nothing sensitive will ever be stored there.
- Region: `us-east-1`, matching the rest of the project's AWS resources (RDS, Cognito) — per [CLAUDE.md](CLAUDE.md).

#### Setting up the bucket (run manually by you — not an action I perform)
S3 bucket names are global and unique, so replace `trip-covers-traveleria` with a name that's available to you.

```bash
# 1. Create the bucket
aws s3api create-bucket \
  --bucket trip-covers-traveleria \
  --region us-east-1

# 2. Open the public-access block at the bucket-policy level (ACLs stay blocked)
aws s3api put-public-access-block \
  --bucket trip-covers-traveleria \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=false,RestrictPublicBuckets=false

# 3. Bucket policy granting public GetObject only (no List, no Write)
aws s3api put-bucket-policy \
  --bucket trip-covers-traveleria \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [{
      "Sid": "PublicReadCovers",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::trip-covers-traveleria/*"
    }]
  }'
```

After running this, the public URL for each image will be in the format:
`https://trip-covers-traveleria.s3.us-east-1.amazonaws.com/covers/destinations/<slug>/<photo_id>.jpg`

You also need to upload `covers/defaults/travel-cover.jpg` (the fallback image) ahead of time, before the feature ships — otherwise the fallback itself would fail.

### Backend
- Add to `.env.example`: `PEXELS_API_KEY` and `TRIP_COVERS_BUCKET` (the bucket name created above).
- A shared helper in `shared/` (`shared/cover_image.py`, function `get_or_create_cover_id`): normalize destination to a slug → look for a `destination_covers` row with that slug that no *other* trip currently uses (decision 9) → if none: search Pexels (`orientation=landscape`, `large` size) → download and upload to S3 under a photo-id-specific key (`covers/destinations/<slug>/<photo_id>.jpg`, since a slug can now have several files) → insert the new row into `destination_covers` → fall back to a fixed `travel-default` row pointing at `covers/defaults/travel-cover.jpg` on any failure. The helper returns the cover's `id` to store on the trip, and takes an optional `exclude_trip_id` so an edit that keeps the same destination keeps the same photo (decision 9).
- Both `_create_trip` **and** `_update_trip` (`lambdas/trips/handler.py`) call this helper and set `trips.destination_cover_id` to the returned id, so editing the destination also updates the cover (decision 4).
- An Autocomplete proxy endpoint, `GET /trips/autocomplete?q=...`, added inside `lambdas/trips/handler.py` (not a new dedicated lambda — avoids extra Lambda/API-Gateway wiring for a form-support endpoint), wrapping the Google Places Autocomplete API and returning only name+place_id to the frontend, without exposing the key (decision 3).
- Reuses `httpx` (for Pexels + Google Places) and `boto3` (for S3) — added explicitly to `requirements.txt` for local dev; `boto3` ships in the Lambda runtime already, same as for `wallet`.

### Frontend
- The plain Destination `FormField` (`app/(tabs)/home.tsx:594`) is replaced with an autocomplete field (debounced `TextInput` + a suggestions dropdown) that calls the new backend proxy endpoint (not Google directly).
- Trip cards render the cover photo as the card's full background (`ImageBackground`, with a dark scrim so title/date stay legible), not a small side thumbnail — revised from the original thumbnail design after seeing it in the app. No photographer credit is shown (decision 5). There is no separate `TripCard` component — this is inlined directly in `home.tsx`'s `renderTripItem`.

## Status: implemented
All of the above has been built:
- `traveleria-backend/sql/013_destination_covers.sql`, `sql/014_destination_cover_variants.sql`
- `traveleria-backend/shared/cover_image.py`
- `traveleria-backend/lambdas/trips/handler.py` (cover-photo wiring + `/trips/autocomplete`)
- `traveleria-backend/shared/utils.py` (`serialize_trip` returns `coverImageUrl`/`creditName`/`creditUrl`)
- `traveleria-backend/local_server.py`, `deploy_cloudshell.sh`, `scripts/add_routes.sh`, `requirements.txt`, `.env.example` updated accordingly
- `traveleria/app/(tabs)/home.tsx` (destination autocomplete + full-card cover background)

This has already been deployed once to the shared AWS lab and tested working end-to-end from the app. Migration `014` (this session's variety change) still needs to be applied there and the `traveleria-trips` Lambda redeployed with the current code before the variety behavior is live — the same manual, URL-preserving process used for `013` (rebuild the Lambda zip in CloudShell with `deps` copied *without* pre-creating the destination directory first, or `zip` will nest everything under an extra `deps/` prefix and the import will fail; delete any existing output zip before rebuilding, since `zip` updates an existing archive in place rather than starting fresh).
