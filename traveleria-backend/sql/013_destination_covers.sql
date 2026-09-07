-- Cover photos for trip destinations, cached once per destination and shared
-- by every trip that uses it (see photo_cover.md, decision 2). A cache miss
-- fetches one Pexels photo, re-hosts it in S3, and upserts the row here —
-- Pexels is never called again for that destination afterwards.

CREATE TABLE IF NOT EXISTS destination_covers (
    slug TEXT PRIMARY KEY,
    cover_image_url TEXT NOT NULL,
    credit_name TEXT,
    credit_url TEXT,
    photo_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trips ADD COLUMN IF NOT EXISTS destination_slug TEXT REFERENCES destination_covers(slug) ON DELETE SET NULL;
