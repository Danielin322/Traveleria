# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Traveleria is a mobile travel planning app built with React Native/Expo (frontend) and FastAPI (backend), using AWS services for auth, storage, and deployment.

## Commands

### Frontend (`traveleria/`)
```bash
npm install          # Install dependencies
npm start            # Start Expo dev server
npm run android      # Run on Android emulator
npm run ios          # Run on iOS simulator
npm run web          # Run web version
npm run lint         # Run ESLint
```

### Backend (`traveleria-backend/`)
```bash
pip install -r requirements.txt   # Install Python deps
python main.py                    # Run dev server on port 8000
python scripts/init_db.py         # Initialize PostgreSQL schema
```

## Architecture

### Three-layer structure:

1. **Frontend** — Expo/React Native app in `traveleria/`, using file-based routing via Expo Router. AWS Amplify handles Cognito auth (sign-in, sign-up, Google OAuth). All API calls go through `services/apiClient.ts` which attaches the Cognito ID token as a Bearer header.

2. **Backend** — FastAPI app in `traveleria-backend/main.py`. All endpoints live in a single file. The `get_current_user()` FastAPI dependency validates the Cognito JWT (via `auth.py`) and upserts the user into PostgreSQL on every authenticated request. Deployed to AWS Lambda via Mangum.

3. **Database** — PostgreSQL on AWS RDS. Schema in `sql/001_create_tables.sql`. Uses UUIDs (pgcrypto) as primary keys. Tables: `users`, `trips`, `trip_days`, `places`, `day_places`, `wallet_documents`.

### Auth flow:
- User signs in via Cognito → frontend gets ID token → sent as `Authorization: Bearer <token>` → backend validates with JWKS and upserts user → returns user context to endpoint handlers.

### Wallet:
- Handled separately by a dedicated AWS Lambda (not in `main.py`). Frontend calls the API Gateway URL directly. Documents stored in S3 with per-user folder isolation.

## Key Patterns

**Date format:** Trips use `DD.MM.YYYY - DD.MM.YYYY` string format between frontend and backend; stored as `DATE` in PostgreSQL.

**Itinerary hierarchy:** `Trip` → `TripDay` (one per calendar day) → `DayPlace` (a visit to a `Place` at a specific `visit_time` string like `"14:30"`). `Places` are a shared table — restrict-delete to preserve integrity.

**UUID serialization:** Backend converts UUIDs to strings before returning JSON.

**Local development:** The frontend's `EXPO_PUBLIC_API_URL` env var is typically set to an ngrok tunnel URL pointing at the local FastAPI server.

## Environment Variables

**Frontend (`traveleria/.env`):**
- `EXPO_PUBLIC_API_URL` — backend API URL (ngrok for local, API Gateway for prod)

**Backend (`traveleria-backend/.env`):**
- `DATABASE_URL` — PostgreSQL connection string
- `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`

## AWS Resources

- **Cognito User Pool:** `us-east-1_hxHdB32mE` — handles auth
- **RDS PostgreSQL:** `us-east-1` — main database
- **S3 + Lambda + API Gateway:** wallet document storage (separate from main backend)
