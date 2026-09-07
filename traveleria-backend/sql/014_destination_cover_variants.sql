-- A destination can now hold a pool of cover photos rather than exactly one.
-- Creating a second trip to a destination already in use by another trip
-- gets a different photo from the pool (fetching a new one from Pexels if
-- every existing photo for that destination is already taken), instead of
-- every trip to the same place sharing one fixed image.
--
-- `destination_covers` moves from being keyed by `slug` (one row per
-- destination) to being keyed by its own `id` (many rows per slug allowed).
-- `trips` links to one specific cover row by id rather than sharing a row by
-- slug.

ALTER TABLE destination_covers ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();
UPDATE destination_covers SET id = gen_random_uuid() WHERE id IS NULL;
ALTER TABLE destination_covers ALTER COLUMN id SET NOT NULL;

ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_destination_slug_fkey;
ALTER TABLE destination_covers DROP CONSTRAINT IF EXISTS destination_covers_pkey;
ALTER TABLE destination_covers ADD CONSTRAINT destination_covers_pkey PRIMARY KEY (id);

CREATE INDEX IF NOT EXISTS idx_destination_covers_slug ON destination_covers(slug);

ALTER TABLE trips ADD COLUMN IF NOT EXISTS destination_cover_id UUID REFERENCES destination_covers(id) ON DELETE SET NULL;

-- One-time backfill from the old slug-based link, guarded so re-running this
-- file after `destination_slug` is already gone is a no-op rather than an
-- error referencing a dropped column.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'trips' AND column_name = 'destination_slug'
    ) THEN
        UPDATE trips t SET destination_cover_id = dc.id
        FROM destination_covers dc
        WHERE dc.slug = t.destination_slug AND t.destination_cover_id IS NULL;

        ALTER TABLE trips DROP COLUMN destination_slug;
    END IF;
END $$;
