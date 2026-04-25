CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    cognito_sub TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trips (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    location TEXT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT trips_valid_date_range CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS trip_days (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    day_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT trip_days_trip_date_unique UNIQUE (trip_id, day_date)
);

CREATE TABLE IF NOT EXISTS places (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    address TEXT,
    google_place_id TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS day_places (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_day_id UUID NOT NULL REFERENCES trip_days(id) ON DELETE CASCADE,
    place_id UUID NOT NULL REFERENCES places(id) ON DELETE RESTRICT,
    visit_time TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT day_places_trip_day_place_unique UNIQUE (trip_day_id, place_id)
);

CREATE TABLE IF NOT EXISTS wallet_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
    document_type TEXT NOT NULL,
    s3_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trips_owner_user_id
    ON trips(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_trip_days_trip_id
    ON trip_days(trip_id);

CREATE INDEX IF NOT EXISTS idx_day_places_trip_day_id
    ON day_places(trip_day_id);

CREATE INDEX IF NOT EXISTS idx_day_places_place_id
    ON day_places(place_id);

CREATE INDEX IF NOT EXISTS idx_wallet_documents_user_id
    ON wallet_documents(user_id);

CREATE INDEX IF NOT EXISTS idx_wallet_documents_trip_id
    ON wallet_documents(trip_id);

ALTER TABLE places
    ADD COLUMN IF NOT EXISTS address TEXT;

ALTER TABLE day_places
    ADD COLUMN IF NOT EXISTS visit_time TEXT NOT NULL DEFAULT '00:00';
