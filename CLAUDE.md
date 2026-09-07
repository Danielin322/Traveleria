# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Traveleria is a mobile travel planning app: an Expo/React Native frontend and a backend of six independent AWS Lambda functions behind one API Gateway REST API, with PostgreSQL on RDS, Cognito for auth, S3 for documents, and OpenAI for the in-app travel assistant.

## Commands

### Frontend (`traveleria/`)
```bash
npm install          # Install dependencies
npm start            # Start Expo dev server
npm run android      # Run on Android emulator
npm run ios          # Run on iOS simulator
npm run web          # Run web version
npm run lint         # expo lint
npx tsc --noEmit     # Typecheck
```

### Backend (`traveleria-backend/`)
```bash
pip install -r requirements.txt   # Install Python deps
python local_server.py            # Emulate API Gateway + the Lambdas on port 8000
python scripts/init_db.py         # Replay every sql/*.sql against DATABASE_URL
```

`scripts/init_db.py` re-runs **all** SQL files in order on every invocation, so every file in `sql/` must stay idempotent — `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and no statement that fails when its target already exists (or no longer does).

## Architecture

### Three layers

1. **Frontend** — Expo/React Native in `traveleria/`, file-based routing via Expo Router. AWS Amplify handles Cognito auth. Every API call goes through `services/apiClient.ts`, which attaches the Cognito **ID token** as a Bearer header.

2. **Backend** — six Lambda handlers in `traveleria-backend/lambdas/<name>/handler.py`, each exporting `lambda_handler(event, context)` and dispatching on `event["resource"]` and `event["httpMethod"]`. They share the `shared/` package, which is copied into every deployment zip:
   - `shared/auth.py` — validates the Cognito JWT against JWKS and upserts the user on every authenticated request; `get_current_user(event)` returns `{id, email, cognito_sub}`
   - `shared/database.py` — `get_db()` context manager over psycopg with `dict_row`
   - `shared/response.py` — `success()` / `error()` with CORS headers
   - `shared/utils.py` — `AppError`, body/UUID/date parsing, and the trip-day helpers

3. **Database** — PostgreSQL on AWS RDS, reached over the public internet via `DATABASE_URL`. UUID primary keys (pgcrypto). Tables: `users`, `trips`, `trip_days`, `places`, `day_places`, `wallet_documents`, `chat_messages`.

### The Lambdas and their routes

| Function | Routes |
|---|---|
| `traveleria-health` | `GET /` |
| `traveleria-trips` | `GET/POST /trips`, `PUT/DELETE /trips/{trip_id}` |
| `traveleria-itinerary` | `GET/POST /trips/{trip_id}/itinerary`, `PUT/DELETE /trips/{trip_id}/itinerary/{event_id}` |
| `traveleria-users` | `GET/PATCH /users/me` |
| `traveleria-chat` | `GET/POST /chat` |
| `traveleria-wallet` | `GET/POST /wallet`, `PUT/DELETE /wallet/{document_id}` |

`local_server.py` mirrors these for local development — **except the wallet routes**, which it does not implement, so wallet work has to be tested against the deployed API.

### Auth flow

User signs in via Cognito → frontend receives an ID token → sent as `Authorization: Bearer <token>` → `get_current_user()` verifies it against the pool's JWKS, then upserts the user row keyed on `cognito_sub` → handlers receive the resolved user.

### The assistant (`lambdas/chat/`)

OpenAI `gpt-4.1-nano` with function calling. The system prompt is built per request from the trip's date range and the caller's profile (gender, dietary, interests), and instructs the model to answer in the user's own language. Two tools let it write to the itinerary: `add_itinerary_item` and `remove_itinerary_item`. `GOOGLE_PLACES_API_KEY`, when set, resolves an added place to coordinates and a formatted address so it gets a map pin.

**Chat history is per (trip, user).** `chat_messages` is keyed on both columns and every read filters on both. Two people planning the same trip have two separate conversations — never widen those queries to `trip_id` alone.

### Wallet (`lambdas/wallet/`)

File bytes never pass through the Lambda: it issues presigned S3 URLs and the app transfers directly, because proxying through API Gateway would cap an upload at roughly 6 MB base64-encoded. Uploads are two-phase — create the row and get a presigned PUT, then confirm once S3 has the object. Isolation is enforced by `user_id` on every query, not by the `users/<id>/` key prefix, which is only a naming convention.

## Key Patterns

**Date format:** Trips use `DD.MM.YYYY - DD.MM.YYYY` and events use `DD.MM.YYYY` between frontend and backend; both are stored as `DATE` in PostgreSQL.

**Itinerary hierarchy:** `Trip` → `TripDay` (one per calendar day) → `DayPlace` (a visit to a `Place` at a `visit_time` string like `"14:30"`). `day_places.place_id` is `ON DELETE RESTRICT`, so deleting a trip must collect its place ids *before* the cascade and clean them up afterwards — see `_delete_trip`.

**Ownership checks are inline SQL.** Handlers do not have a permission layer; they append `AND owner_user_id = %s` (or join through `trips`) to the query itself, so a missing row and someone else's row are indistinguishable. Both answer **404**, deliberately — a 403 would confirm the trip exists.

**UUID serialization:** UUIDs are converted to strings before returning JSON.

**Errors:** raise `AppError(message, status)`; each `lambda_handler` catches it and returns `error(...)`. Anything else becomes a 500 with the exception text.

**Theme tokens:** every colour, spacing, radius and font size comes from `constants/theme.ts`. `Colors.light` and `Colors.dark` must keep identical key sets — `hooks/use-theme-color.ts` types its argument as the intersection of the two.

**Local development:** the frontend's `EXPO_PUBLIC_API_URL` typically points at an ngrok tunnel to `local_server.py`, or at the deployed API Gateway URL.

## Deployment

**Never run `deploy_cloudshell.sh` to ship a change.** It calls `delete-rest-api` and rebuilds API Gateway, which mints a new invoke URL and breaks `EXPO_PUBLIC_API_URL` in every installed build. To update one function, build its zip and run `aws lambda update-function-code` in CloudShell. To add a route, run `scripts/add_routes.sh` — it is additive and leaves the URL alone.

**But keep `deploy_cloudshell.sh` current.** It is the only script that stands the backend up from nothing, and it exists for one day: moving to a different AWS lab account. Nothing routine runs it, so it rots silently. Any change that adds a Lambda, a route, an environment variable, a bucket, or a pip dependency must land in it in the same commit.

**A new route therefore lands in three places:**
- `scripts/add_routes.sh` — patches the lab that is already running
- `deploy_cloudshell.sh` — rebuilds a new lab from scratch
- `local_server.py` — keeps local dev matching the deployed API

Missing from any one of them, a route fails later and somewhere more expensive.

Every zip is `deps/` + `shared/` + the function's `handler.py` renamed to `lambda_function.py`. Dependencies are installed with `--platform manylinux2014_x86_64 --python-version 3.11 --only-binary=:all:` so the wheels match the Lambda runtime. `boto3` is deliberately not bundled — it is preinstalled in the runtime.

## Environment Variables

**Frontend (`traveleria/.env`):**
- `EXPO_PUBLIC_API_URL` — backend API URL (ngrok for local, API Gateway for prod)

**Backend (`traveleria-backend/.env`), see `.env.example`:**
- `DATABASE_URL` — PostgreSQL connection string
- `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`
- `OPENAI_API_KEY` — required by `traveleria-chat`; the handler raises on import without it
- `GOOGLE_PLACES_API_KEY` — optional; enables coordinates for chat-added places
- `WALLET_BUCKET` — S3 bucket for wallet documents and profile photos, used by `traveleria-wallet` and `traveleria-users`

## AWS Resources

- **Cognito User Pool:** `us-east-1_hxHdB32mE` — handles auth
- **RDS PostgreSQL:** `us-east-1` — main database, reachable over the public internet
- **API Gateway (REST):** `traveleria-api`, stage `prod` — one API in front of all six Lambdas
- **S3:** wallet documents and profile photos, one prefix per user
