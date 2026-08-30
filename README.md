<div align="center">

<img src="traveleria_logo.png" alt="Traveleria" width="360" />

**A mobile travel-planning app — plan trips, build day-by-day itineraries, keep your travel documents close, and share the journey.**

[![Expo SDK](https://img.shields.io/badge/Expo-SDK%2054-000020?logo=expo&logoColor=white)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React%20Native-0.81-61DAFB?logo=react&logoColor=black)](https://reactnative.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)](https://www.python.org)
[![AWS Lambda](https://img.shields.io/badge/AWS-Lambda-FF9900?logo=awslambda&logoColor=white)](https://aws.amazon.com/lambda/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-RDS-4169E1?logo=postgresql&logoColor=white)](https://aws.amazon.com/rds/postgresql/)

</div>

---

## Table of contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Tech stack](#tech-stack)
- [API reference](#api-reference)
- [Data model](#data-model)
- [AWS configuration](#aws-configuration)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Deployment](#deployment)
- [Conventions](#conventions)
- [Current limitations & roadmap](#current-limitations--roadmap)
- [Contributing](#contributing)

---

## Overview

Traveleria is a cross-platform mobile app (iOS, Android, and web) for planning and running a trip end to end:

1. **Create a trip** — title, destination, and a date range.
2. **Build the itinerary** — add timed stops backed by Google Places, view them as a list or on a map, and annotate them with notes.
3. **Ask the in-app assistant** — a per-trip chat panel for quick suggestions.
4. **Carry your documents** — a wallet of boarding passes, bookings, and IDs.
5. **Share the trip** — a social feed of posts, likes, comments, and replies.

The app is split into three layers: an Expo/React Native client, a set of five Python AWS Lambda functions behind a single API Gateway REST API, and a PostgreSQL database on Amazon RDS. Authentication is handled by Amazon Cognito, and every API call carries a Cognito ID token that each Lambda validates independently.

---

## Features

### Authentication
- Email + password sign-up with a Cognito **email verification code** step.
- Client-side password strength and email format checks before the request is made, with readable errors mapped from Cognito exceptions.
- Persistent sessions — a returning user is routed straight past the login screen, with no form flash while the stored session is being checked.
- Global sign-out and account deletion (`signOut({ global: true })`, `deleteUser()`).
- Every authenticated request attaches the Cognito **ID token** as `Authorization: Bearer <token>`; the backend upserts the user row on each request, so a Cognito user exists in Postgres from their very first call.

### Trips
- Create a trip with a title, destination, and date range picked from a calendar (`react-native-calendars`).
- Trips are automatically grouped into **Upcoming** (soonest first) and **Past** (most recent first).
- Relative status badges — `Today`, `Tomorrow`, `In 12 days`, `Ongoing`.
- Human-friendly date collapsing: `11.08.2026 - 15.08.2026` renders as `11-15 Aug 2026`.
- Pull-to-refresh, loading skeletons, empty states, and inline field-level validation.

### Itinerary
- Add, edit, and delete timed stops for a trip.
- Place search via **Google Places Autocomplete**, which supplies the name, address, and coordinates.
- Free-text notes per stop (500-character limit, validated on both client and server).
- Two views of the same data: a chronological **list** and an interactive **map** (`react-native-maps`) with a marker per stop and a dark map style that follows the app theme.
- Time entry through a native time picker, normalized to a `HH:MM` string.
- Destructive actions are confirmed before they run.

### Trip assistant (chat)
- A chat panel inside each trip, backed by the `/chat` endpoint.
- Currently a deterministic keyword responder (food / weather / fallback) — the endpoint and client are in place so a real model can be dropped in behind the same contract. See [limitations](#current-limitations--roadmap).

### Wallet
- Apple-Wallet-style stack of document cards with a colour picker.
- Attach any file via the system document picker; preview it in an in-app `WebView`.
- Rename, recolour, and delete cards, with confirmation before deletion.
- Documents are stored **on the device** (`AsyncStorage`) in the current build — see [limitations](#current-limitations--roadmap).

### Social
- Feed of posts with text and images (picked from the device library).
- Likes, comments, threaded replies, and relative timestamps (`just now`, `3h`, `2d`).
- Backed by in-memory mock data in the current build — see [limitations](#current-limitations--roadmap).

### Profile & preferences
- Profile fields: full name, country, language, age, interests, gender, and dietary needs.
- **Gender** is a single choice; **dietary needs** is a multi-select stored as a PostgreSQL `TEXT[]`, validated identically in the client, the Lambda, and a database `CHECK` constraint.
- Trip count computed server-side.
- Avatar picked from the device library and cached locally.
- Theme control: **System / Light / Dark**, persisted across launches.

### Design system & UX
- Central design tokens (`constants/theme.ts`) — colours, spacing, radii, elevation, and type scale — with matched light and dark palettes enforced by a shared key set.
- Inter is vendored as four weights rather than pulled from the full Google Fonts package, keeping ~6 MB of unused font faces out of the bundle.
- Native splash screen is held until fonts resolve, so text never reflows from the system font into Inter.
- Shared components: `AppButton`, `FormField`, `OptionSelector`, `DateRangePicker`.
- Haptic feedback on tab presses, edge-to-edge Android layout, typed routes, and the React Compiler enabled.

---

## Architecture

```mermaid
flowchart TB
    subgraph Client["📱 Expo / React Native client"]
        UI["Screens — expo-router file-based routes"]
        AMP["AWS Amplify Auth"]
        API["services/apiClient.ts"]
    end

    subgraph AWS["☁️ AWS — us-east-1"]
        COG["Amazon Cognito<br/>User Pool"]
        GW["API Gateway<br/>REST API · stage: prod"]

        subgraph L["AWS Lambda — Python 3.11"]
            LH["traveleria-health"]
            LT["traveleria-trips"]
            LI["traveleria-itinerary"]
            LU["traveleria-users"]
            LC["traveleria-chat"]
        end

        RDS[("Amazon RDS<br/>PostgreSQL")]
    end

    GP["Google Places / Maps"]

    UI --> AMP
    UI --> API
    AMP -->|"sign-in / sign-up"| COG
    AMP -->|"ID token"| API
    API -->|"Bearer ID token"| GW
    GW --> LH & LT & LI & LU & LC
    LT & LI & LU & LC -->|"JWKS validation"| COG
    LT & LI & LU --> RDS
    UI -.->|"place search, maps"| GP
```

### Request lifecycle

1. The user signs in through Amplify; Cognito returns an ID token.
2. `apiClient.apiFetch()` reads the token from the current session and sets `Authorization: Bearer <token>`.
3. API Gateway proxies the request (`AWS_PROXY`) to the Lambda mapped to that route. **API Gateway itself performs no authorization** — `authorization-type` is `NONE`.
4. `shared/auth.get_current_user()` inside the Lambda:
   - reads the `Authorization` header,
   - fetches the Cognito **JWKS** and verifies the RS256 signature, issuer, and audience,
   - rejects anything that is not an **ID token** (`token_use == "id"`),
   - upserts the user into `users` keyed by `cognito_sub`, and returns the internal user row.
5. The handler runs its query scoped to that user's id, and `shared/response.py` serializes the result with CORS headers.

### Design notes

- **One Lambda per resource, not per route.** Each function branches on `event["httpMethod"]` (and `event["resource"]` for the nested itinerary paths). Five deployment units instead of ten keeps cold starts and IAM surface small while still isolating failures per domain.
- **Shared code is vendored into each zip.** `shared/` is copied into every Lambda bundle at build time — no Lambda layer to keep in sync.
- **Authorization lives in SQL.** Every query joins back to `trips.owner_user_id`, so a user can never read or mutate another user's trip, even with a valid token.
- **UUID primary keys** via `pgcrypto`'s `gen_random_uuid()`, serialized to strings before leaving the API.
- **Migrations are idempotent.** `scripts/init_db.py` replays every file in `sql/` on each run, so all statements use `IF NOT EXISTS` / `DROP … IF EXISTS` guards.

---

## Repository layout

```
Traveleria/
├── traveleria/                     # Expo / React Native client
│   ├── app/                        # expo-router file-based routes
│   │   ├── _layout.tsx             # Amplify config, fonts, theme + user providers
│   │   ├── index.tsx               # Login (also the session-restore gate)
│   │   ├── signup.tsx              # Sign-up + email verification code
│   │   ├── trip-details.tsx        # Itinerary list/map, add-event modal, chat
│   │   ├── edit-profile.tsx        # Profile form
│   │   └── (tabs)/                 # Bottom tab navigator
│   │       ├── home.tsx            # Trips list, create-trip modal
│   │       ├── social.tsx          # Feed, posts, comments, replies
│   │       ├── wallet.tsx          # Document cards
│   │       └── profile.tsx         # Profile, theme switch, sign out
│   ├── components/                 # AppButton, FormField, OptionSelector, DateRangePicker …
│   ├── config/awsConfig.ts         # Amplify Cognito configuration
│   ├── constants/                  # theme tokens, API URLs, map style, profile options
│   ├── contexts/                   # ThemeContext, CurrentUserContext
│   ├── hooks/                      # colour-scheme and theme-colour hooks
│   ├── services/                   # apiClient (token attachment), authService (Amplify auth)
│   ├── utils/                      # validation rules, trip date formatting/grouping
│   ├── assets/                     # Inter font faces, icons, splash
│   ├── app.json                    # Expo app config, EAS project, update channel
│   └── eas.json                    # EAS build profiles (preview / production)
│
├── traveleria-backend/             # Python AWS Lambda backend
│   ├── lambdas/
│   │   ├── health/handler.py       # GET /
│   │   ├── trips/handler.py        # GET, POST /trips
│   │   ├── itinerary/handler.py    # GET, POST, PUT, DELETE itinerary items
│   │   ├── users/handler.py        # GET, PATCH /users/me
│   │   └── chat/handler.py         # POST /chat
│   ├── shared/
│   │   ├── auth.py                 # Cognito JWT validation + user upsert
│   │   ├── database.py             # psycopg connection context manager
│   │   ├── response.py             # JSON + CORS response helpers
│   │   └── utils.py                # AppError, parsing, trip-date format, serializers
│   ├── sql/                        # Idempotent, numbered schema migrations
│   ├── scripts/init_db.py          # Applies every sql/*.sql in order
│   ├── deploy_cloudshell.sh        # Full AWS CloudShell deployment (see warning below)
│   ├── requirements.txt
│   └── .env.example
│
└── CLAUDE.md                       # Repo guidance for AI coding assistants
```

---

## Tech stack

| Layer | Technology |
|---|---|
| **Mobile client** | React Native 0.81, Expo SDK 54, TypeScript 5.9 (strict), Expo Router 6, React 19 |
| **UI** | Custom design-token system, Inter, `@expo/vector-icons`, React Navigation bottom tabs, Reanimated |
| **Maps & places** | `react-native-maps`, `react-native-google-places-autocomplete` |
| **Client auth** | AWS Amplify 6 (`aws-amplify/auth`) |
| **Local storage** | `@react-native-async-storage/async-storage` |
| **Backend** | Python 3.11 on AWS Lambda, `psycopg[binary]`, `PyJWT[crypto]`, `python-dotenv` |
| **API** | Amazon API Gateway (REST, Lambda proxy integration) |
| **Database** | PostgreSQL on Amazon RDS, `pgcrypto` for UUIDs |
| **Identity** | Amazon Cognito User Pool |
| **Builds & OTA** | EAS Build, EAS Update |
| **Tooling** | ESLint (`eslint-config-expo`), ngrok for local API tunnelling |

---

## API reference

Base URL: `https://{api-id}.execute-api.us-east-1.amazonaws.com/prod`

All endpoints except `GET /` require `Authorization: Bearer <cognito-id-token>`.

| Method | Path | Lambda | Description |
|---|---|---|---|
| `GET` | `/` | `traveleria-health` | Health check. No auth. |
| `GET` | `/trips` | `traveleria-trips` | List the caller's trips, newest first. |
| `POST` | `/trips` | `traveleria-trips` | Create a trip. → `201` |
| `GET` | `/trips/{trip_id}/itinerary` | `traveleria-itinerary` | List stops, ordered by day then time. |
| `POST` | `/trips/{trip_id}/itinerary` | `traveleria-itinerary` | Add a stop. → `201` |
| `PUT` | `/trips/{trip_id}/itinerary/{event_id}` | `traveleria-itinerary` | Update a stop. |
| `DELETE` | `/trips/{trip_id}/itinerary/{event_id}` | `traveleria-itinerary` | Delete a stop and its place row. |
| `GET` | `/users/me` | `traveleria-users` | Profile + trip count. |
| `PATCH` | `/users/me` | `traveleria-users` | Partial profile update. |
| `POST` | `/chat` | `traveleria-chat` | Trip assistant reply. |

<details>
<summary><strong>Request / response examples</strong></summary>

**`POST /trips`**

```json
{ "title": "Summer in Rome", "location": "Rome, Italy", "date": "11.08.2026 - 15.08.2026" }
```

```json
{
  "message": "Trip added successfully",
  "trip": {
    "id": "6f1c…",
    "title": "Summer in Rome",
    "location": "Rome, Italy",
    "date": "11.08.2026 - 15.08.2026"
  }
}
```

**`POST /trips/{trip_id}/itinerary`**

```json
{
  "place": "Colosseum",
  "address": "Piazza del Colosseo, 1, Rome",
  "time": "14:30",
  "lat": 41.8902,
  "lng": 12.4922,
  "notes": "Book tickets in advance"
}
```

**`PATCH /users/me`** — every field is optional; omitted fields are left unchanged.

```json
{ "full_name": "Ada Lovelace", "country": "UK", "gender": "female", "dietary": ["vegan", "nut_allergy"] }
```

**Errors** are returned uniformly as `{ "detail": "<message>" }` with an appropriate status: `400` validation, `401` missing/invalid token, `404` not found, `405` method not allowed, `500` unexpected.

</details>

### Semantics worth knowing

- `PATCH /users/me` uses `COALESCE`, so an **absent or `null`** field means *leave unchanged*. An **empty `dietary` array does clear** the selection (an empty array is not `NULL`). Clearing `gender` back to `NULL` is deliberately unsupported — the picker offers `prefer_not_to_say` instead.
- `dietary` values are de-duplicated server-side while preserving the order they were picked in.
- Creating an itinerary item lazily creates the trip's first `trip_days` row if none exists yet.

---

## Data model

```mermaid
erDiagram
    users ||--o{ trips : owns
    users ||--o{ wallet_documents : owns
    trips ||--o{ trip_days : "has"
    trips ||--o{ wallet_documents : "may reference"
    trip_days ||--o{ day_places : "has"
    places ||--o{ day_places : "visited in"

    users {
        uuid id PK
        text email UK
        text cognito_sub UK
        text full_name
        text country
        text language
        int age
        text interests
        text gender "CHECK"
        text_array dietary "CHECK, GIN index"
    }
    trips {
        uuid id PK
        uuid owner_user_id FK
        text title
        text location
        date start_date
        date end_date
    }
    trip_days {
        uuid id PK
        uuid trip_id FK
        date day_date "UNIQUE(trip_id, day_date)"
    }
    places {
        uuid id PK
        text name
        text address
        text google_place_id UK
        float lat
        float lng
    }
    day_places {
        uuid id PK
        uuid trip_day_id FK
        uuid place_id FK
        text visit_time
        text notes
    }
    wallet_documents {
        uuid id PK
        uuid user_id FK
        uuid trip_id FK
        text document_type
        text s3_key
    }
```

**Hierarchy:** `Trip → TripDay` (one per calendar day) `→ DayPlace` (a visit to a `Place` at a `visit_time` such as `"14:30"`).

**Referential rules**

| Relationship | On delete |
|---|---|
| `trips.owner_user_id → users` | `CASCADE` |
| `trip_days.trip_id → trips` | `CASCADE` |
| `day_places.trip_day_id → trip_days` | `CASCADE` |
| `day_places.place_id → places` | `RESTRICT` — `places` is shared, so integrity is preserved |
| `wallet_documents.user_id → users` | `CASCADE` |
| `wallet_documents.trip_id → trips` | `SET NULL` |

**Migrations**

| File | Purpose |
|---|---|
| `001_create_tables.sql` | Core tables, foreign keys, indexes, `pgcrypto` |
| `002_user_profile.sql` | Profile fields on `users` |
| `003_places_lat_lng_notes.sql` | Coordinates on `places`, notes on `day_places` |
| `004_user_preferences.sql` | `gender` + `dietary` with `CHECK` constraints and a GIN index |

---

## AWS configuration

Everything runs in **`us-east-1`**.

### Amazon Cognito — identity

| Setting | Value |
|---|---|
| User Pool | `us-east-1_hxHdB32mE` |
| Sign-in | Email + password (`USER_PASSWORD_AUTH`) |
| Sign-up attributes | `email`, `given_name` |
| Confirmation | Emailed verification code |
| Token used by the API | **ID token** (RS256), validated against the pool's JWKS |

The client is configured in `traveleria/config/awsConfig.ts` and initialised once in `app/_layout.tsx` via `Amplify.configure()`. The backend derives the issuer and JWKS URL from `COGNITO_REGION` and `COGNITO_USER_POOL_ID`, and checks the `aud` claim against `COGNITO_APP_CLIENT_ID`.

### AWS Lambda — compute

| Setting | Value |
|---|---|
| Functions | `traveleria-health`, `traveleria-trips`, `traveleria-itinerary`, `traveleria-users`, `traveleria-chat` |
| Runtime | `python3.11` |
| Handler | `lambda_function.lambda_handler` |
| Timeout | 30 s |
| Execution role | `LabRole` (AWS Academy lab account) |
| Environment | `DATABASE_URL`, `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID` |

Dependencies are installed with `--platform manylinux2014_x86_64 --python-version 3.11 --only-binary=:all:` so the wheels match the Lambda runtime, then zipped together with `shared/` and the function's `handler.py` (renamed to `lambda_function.py`).

### Amazon API Gateway — routing

| Setting | Value |
|---|---|
| API name | `traveleria-api` (REST) |
| Stage | `prod` |
| Integration | `AWS_PROXY` (Lambda proxy) |
| Authorization | `NONE` at the gateway — JWT validation happens inside each Lambda |
| CORS | `Access-Control-Allow-Origin: *` set by the Lambda response helper |

Resource tree:

```
/                                          → traveleria-health      (GET)
/trips                                     → traveleria-trips       (GET, POST)
/trips/{trip_id}/itinerary                 → traveleria-itinerary   (GET, POST)
/trips/{trip_id}/itinerary/{event_id}      → traveleria-itinerary   (PUT, DELETE)
/users/me                                  → traveleria-users       (GET, PATCH)
/chat                                      → traveleria-chat        (POST)
```

### Amazon RDS — PostgreSQL

Managed PostgreSQL instance reached over a standard `postgresql://` connection string held in `DATABASE_URL`. Lambdas open a short-lived connection per invocation through `shared/database.get_db()`, a context manager that commits on clean exit. `pgcrypto` supplies `gen_random_uuid()` for primary keys.

### Amazon S3 — document storage

The `wallet_documents` table (`s3_key`, per-user prefix isolation) and the `EXPO_PUBLIC_WALLET_API_URL` client variable are in place for S3-backed wallet storage behind a dedicated Lambda + API Gateway endpoint. **This path is not wired up in the current build** — see [limitations](#current-limitations--roadmap).

### EAS — builds and over-the-air updates

| Profile | Distribution | Android artifact | Update channel |
|---|---|---|---|
| `preview` | internal | APK | `preview` |
| `production` | store | AAB | `production` |

Runtime version follows the Expo SDK version policy, and updates are served from `https://u.expo.dev/<projectId>`.

---

## Getting started

### Prerequisites

- Node.js 20+ and npm
- Python 3.11+
- An Expo account (for EAS builds) and the Expo Go app, or a simulator/emulator
- Access to the project's Cognito User Pool and RDS instance
- A Google Maps Platform API key with **Places API** and **Maps SDK** enabled

### 1. Backend

```bash
cd traveleria-backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # then fill in the real values
python scripts/init_db.py        # applies every sql/*.sql in order — safe to re-run
```

`init_db.py` is the only supported way to apply schema changes; it is idempotent, so run it whenever a new migration lands.

> The Lambda handlers are written against the API Gateway proxy event shape, so they are invoked through AWS rather than served locally. To develop against a local HTTP server, point `EXPO_PUBLIC_API_URL` at an [ngrok](https://ngrok.com) tunnel fronting whatever local shim you use.

### 2. Frontend

```bash
cd traveleria
npm install
# create traveleria/.env with the keys listed under "Environment variables"
npm start
```

Then press `a` for Android, `i` for iOS, or `w` for web.

| Command | What it does |
|---|---|
| `npm start` | Start the Expo dev server |
| `npm run android` | Launch on an Android emulator/device |
| `npm run ios` | Launch on an iOS simulator/device |
| `npm run web` | Run the web build |
| `npm run lint` | Run ESLint |
| `npm run deploy` | Publish an EAS Update to the `main` branch for both platforms |

---

## Environment variables

### Frontend — `traveleria/.env`

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_API_URL` | Backend base URL — API Gateway stage URL, or an ngrok tunnel for local work |
| `EXPO_PUBLIC_COGNITO_REGION` | Cognito region, e.g. `us-east-1` |
| `EXPO_PUBLIC_COGNITO_USER_POOL_ID` | Cognito User Pool id |
| `EXPO_PUBLIC_COGNITO_APP_CLIENT_ID` | Cognito app client id |
| `EXPO_PUBLIC_GOOGLE_PLACES_API_KEY` | Google Places / Maps key |
| `EXPO_PUBLIC_WALLET_API_URL` | Wallet document API endpoint (reserved; not yet used) |

> `EXPO_PUBLIC_*` variables are **inlined into the client bundle** and are therefore not secret. Restrict the Google key by platform, bundle id, and API, and keep anything genuinely sensitive server-side.

### Backend — `traveleria-backend/.env`

| Variable | Description |
|---|---|
| `DATABASE_URL` | `postgresql://user:password@host:5432/dbname` |
| `COGNITO_REGION` | Region of the User Pool |
| `COGNITO_USER_POOL_ID` | User Pool id |
| `COGNITO_APP_CLIENT_ID` | App client id, checked as the token audience |

`.env` files are git-ignored in both projects. `traveleria-backend/.env.example` is the reference for names and formats.

---

## Deployment

### Backend

`deploy_cloudshell.sh` performs a **full, from-scratch provisioning run** in AWS CloudShell: it installs dependencies, builds one zip per Lambda, creates or updates all five functions, then builds the API Gateway resource tree and deploys the `prod` stage.

```bash
# In AWS CloudShell, after uploading and unzipping the backend source,
# with a populated .env in the same directory:
bash deploy_cloudshell.sh
```

> [!WARNING]
> **This script deletes the existing `traveleria-api` API Gateway and recreates it, which produces a new API id and therefore a new API URL.** Every installed client pointing at the old URL breaks until it is rebuilt with the new `EXPO_PUBLIC_API_URL`.
>
> For a routine code change, do **not** re-run the whole script. Rebuild the affected zip and update just that function:
>
> ```bash
> aws lambda update-function-code --function-name traveleria-trips --zip-file fileb://zips/lambda_trips.zip --region us-east-1
> ```

The script prints the resulting API URL; set it as `EXPO_PUBLIC_API_URL` in `traveleria/.env` and rebuild the client.

### Frontend

```bash
# Internal APK for testers
eas build --profile preview --platform android

# Store build
eas build --profile production --platform android

# Over-the-air JS update (no store review)
npm run deploy
```

OTA updates only ship JavaScript and assets. Anything that changes native code — a new native module, an SDK upgrade, a permission — needs a fresh build.

---

## Conventions

**Trip date format.** Trips travel between client and server as the string `DD.MM.YYYY - DD.MM.YYYY` and are stored as two `DATE` columns. `shared/utils.py` owns parsing and formatting; `utils/tripFormat.ts` owns presentation.

**Validation is defined once and enforced twice.** `utils/validation.ts` and `shared/utils.py` carry matching rules so the user gets an immediate, readable message and the server never trusts the client. Profile option sets exist in three places that must stay in step — `constants/profileOptions.ts`, `GENDER_VALUES`/`DIETARY_VALUES` in `lambdas/users/handler.py`, and the `CHECK` constraints in `sql/004_user_preferences.sql`.

**Error handling.** Handlers raise `AppError(message, status)` for anything expected; the top-level `try/except` in each Lambda converts it to a JSON body of `{"detail": …}`. Unexpected exceptions become a `500`.

**UUID serialization.** UUIDs are converted to strings before being returned as JSON.

**Design tokens over inline styles.** Colours, spacing, radii, and type sizes come from `constants/theme.ts`. `Colors.light` and `Colors.dark` must keep identical key sets — `hooks/use-theme-color.ts` types its argument as the intersection of the two.

**Idempotent SQL.** Every migration is replayed on each `init_db.py` run, so all statements must be safe to execute repeatedly.

---

## Current limitations & roadmap

Being explicit about what is real and what is scaffolding:

| Area | Today | Planned |
|---|---|---|
| **Wallet** | Documents are stored on-device in `AsyncStorage`; nothing is uploaded | Upload to S3 with per-user prefix isolation through a dedicated Lambda, persisted in `wallet_documents` |
| **Social** | Feed, posts, comments, and likes run on in-memory mock data and reset on reload | Backend-persisted social graph and feed |
| **Trip assistant** | `/chat` returns keyword-matched canned replies | Replace the handler body with a real model call behind the same request/response contract |
| **Multi-day itinerary** | `trip_days` exists and is populated lazily with a single default day | Expose per-day planning in the UI across a trip's full date range |
| **Profile identity in Social** | `CurrentUserContext` seeds a placeholder name and avatar | Source from the authenticated Cognito profile |
| **API authorization** | JWT is validated inside each Lambda | Optionally move to a Cognito authorizer at API Gateway to reject unauthenticated traffic earlier |
| **Testing** | No automated test suite | Unit tests for `shared/utils.py` and `utils/validation.ts`, plus API integration tests |

---

## Contributing

**Branches**

| Branch | Purpose |
|---|---|
| `main` | Stable, release-ready |
| `dev` | Integration branch — target for feature PRs |
| `feature/*`, fix branches | Individual pieces of work |

**Workflow**

1. Branch off `dev`.
2. Keep client and server validation in sync when you touch shared rules.
3. Add schema changes as a new numbered, idempotent file in `traveleria-backend/sql/`; never edit an applied migration.
4. Run `npm run lint` in `traveleria/` before opening a PR.
5. Open the PR against `dev`.

Never commit `.env` files, API keys, or database credentials — both projects git-ignore them, and `.env.example` is the place to document new variables.

---

<div align="center">

Built by **shirelbar80**, **Daniel Lin**, and **hadar ferber**.

</div>
