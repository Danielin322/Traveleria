-- Profile preferences: gender (single value) and dietary needs (multi-value).
--
-- Numbered 004 because 003_places_lat_lng_notes.sql already exists.
-- init_db.py replays every file in sql/ on each run, so everything here must
-- stay idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS gender TEXT;

-- A Postgres array rather than the comma-separated TEXT used by `interests`:
-- psycopg maps it to a Python list with no parsing, it can be indexed, and it
-- supports containment queries such as `WHERE dietary @> ARRAY['vegan']`.
-- NOT NULL DEFAULT '{}' means "no restrictions" is an empty array, never NULL,
-- so readers never have to handle both.
ALTER TABLE users ADD COLUMN IF NOT EXISTS dietary TEXT[] NOT NULL DEFAULT '{}';

-- Keep invalid values out at the database level, not just in the app.
-- DROP then ADD (rather than a DO block) keeps this re-runnable, and lets the
-- allowed set be edited later by just changing this file.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_gender_valid;
ALTER TABLE users ADD CONSTRAINT users_gender_valid CHECK (
    gender IS NULL
    OR gender IN ('male', 'female', 'non_binary', 'prefer_not_to_say')
);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_dietary_valid;
ALTER TABLE users ADD CONSTRAINT users_dietary_valid CHECK (
    dietary <@ ARRAY[
        'vegetarian', 'vegan', 'pescatarian', 'keto', 'halal', 'kosher',
        'gluten_free', 'lactose_intolerant', 'nut_allergy'
    ]::TEXT[]
);

-- Supports "find users matching this diet" without a sequential scan.
CREATE INDEX IF NOT EXISTS idx_users_dietary ON users USING GIN (dietary);
