-- Interests: from a comma-separated TEXT column to a TEXT[], matching the
-- `dietary` column added in 004.
--
-- Why the type change: interests now include free-text "Other" entries, and a
-- custom interest can itself contain a comma ("food, glorious food"), which a
-- comma-separated string silently splits into two tags. An array has no such
-- ambiguity and psycopg maps it straight to a Python list.
--
-- init_db.py replays every file in sql/ on each run, so this must be
-- idempotent. ALTER COLUMN ... TYPE has no IF NOT EXISTS form, so the guard is
-- on the column's current type: after the first run it is no longer `text` and
-- the whole block is skipped.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users'
          AND column_name = 'interests'
          AND data_type = 'text'
    ) THEN
        ALTER TABLE users ALTER COLUMN interests DROP DEFAULT;

        -- The USING clause is what preserves existing data: whatever a user
        -- typed into the old free-text field becomes their custom tags, so
        -- nobody loses their interests in the migration.
        --
        -- The middle branch handles rows written by a client that already
        -- sent a JSON array while this column was still TEXT: psycopg
        -- coerced the list into a Postgres array literal, so the stored text
        -- reads '{Love,sports_events}'. Splitting that on commas would weld
        -- the braces onto the first and last entries ('{Love'), so those rows
        -- are cast directly instead.
        -- No subquery below: a USING transform expression may not contain
        -- one, so the comma split is done with array functions instead of
        -- unnest + array_agg. regexp_replace collapses the whitespace around
        -- each comma so " a , b " splits to {a,b}, and array_remove drops the
        -- empty element a trailing comma would leave behind.
        ALTER TABLE users
            ALTER COLUMN interests TYPE TEXT[]
            USING CASE
                WHEN interests IS NULL OR btrim(interests) = '' THEN '{}'::TEXT[]
                WHEN btrim(interests) LIKE '{%}' THEN btrim(interests)::TEXT[]
                ELSE array_remove(
                    string_to_array(
                        regexp_replace(btrim(interests), '\s*,\s*', ',', 'g'),
                        ','
                    ),
                    ''
                )
            END;

        -- Same shape as `dietary`: "nothing chosen" is an empty array, never
        -- NULL, so readers never have to handle both.
        UPDATE users SET interests = '{}' WHERE interests IS NULL;
        ALTER TABLE users ALTER COLUMN interests SET DEFAULT '{}';
        ALTER TABLE users ALTER COLUMN interests SET NOT NULL;
    END IF;
END $$;

-- Deliberately no CHECK constraint, unlike users_dietary_valid: "Other" means
-- the allowed set is open by design. Length and count limits are enforced in
-- lambdas/users/handler.py instead.

-- Supports "find users who like this" without a sequential scan.
CREATE INDEX IF NOT EXISTS idx_users_interests ON users USING GIN (interests);
