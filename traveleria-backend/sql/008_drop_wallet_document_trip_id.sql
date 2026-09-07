-- Drop wallet_documents.trip_id.
--
-- The column has existed since 001 and no code has ever written to it. The
-- only INSERT INTO wallet_documents that has ever existed in this repository
-- does not list the column, and neither PUT /wallet/{document_id} nor any
-- other statement sets it, so every value in the table is NULL. It was read in
-- exactly one place — the list endpoint returned it as `tripId` — and nothing
-- consumed that field: `walletService.ts` declared it on WalletDocument and
-- `wallet.tsx` never touched it. `_update_document` did not even echo it back.
--
-- It described a wallet-to-trip link that the app has never had: there is no
-- trip picker in the wallet, and documents are per user, not per trip. Leaving
-- a NULL column and its index in place invites someone to design around a
-- relationship that does not exist — which is exactly what happened while
-- planning trip co-editing.
--
-- Nothing is lost: the column is empty in every row. If a document-to-trip
-- link is wanted later it should be added deliberately, with a UI and an
-- endpoint that write it, and with an answer for what happens to a document
-- attached to a shared trip.
--
-- 001 no longer creates the column or the index, so a fresh database never
-- gets them; this file is what removes them from a database that already ran
-- the old 001. Both statements are idempotent, like the rest of sql/.

DROP INDEX IF EXISTS idx_wallet_documents_trip_id;

ALTER TABLE wallet_documents DROP COLUMN IF EXISTS trip_id;
