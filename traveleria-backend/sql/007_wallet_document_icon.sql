-- An icon for each wallet card, alongside the colour added in 006.
--
-- Additive and nullable, following 002/003/006. Existing documents keep NULL
-- and the app falls back to an icon inferred from mime_type, so no backfill is
-- needed and no card renders blank.
ALTER TABLE wallet_documents ADD COLUMN IF NOT EXISTS icon TEXT;

-- Deliberately no CHECK constraint, unlike users_gender_valid in 004. The set
-- of icons is a UI concern that will change as icons are added or renamed, and
-- a constraint would turn every future icon rename into a migration. The
-- allow-list lives in lambdas/wallet/handler.py instead, the same way the open
-- interests set is handled in 005.
