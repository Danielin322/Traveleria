-- Wallet documents and the profile photo, backed by S3.
--
-- wallet_documents has existed since 001 and has never had a row written to
-- it: the wallet kept everything in device-local AsyncStorage, which is why
-- every account signed in on one device saw the same files. These columns are
-- what the UI actually needs in order to move that state server-side.
--
-- Additive only, following 002/003. Nothing like the type change in 005.

-- Shown on the card. `document_type` already exists but is a category, not a
-- name, and the wallet UI has always had a user-entered title.
ALTER TABLE wallet_documents ADD COLUMN IF NOT EXISTS title TEXT;

-- The Apple-Wallet-style label colour the user picks.
ALTER TABLE wallet_documents ADD COLUMN IF NOT EXISTS color TEXT;

-- Decides between the image viewer and the WebView, and is pinned into the
-- presigned upload URL so it cannot be swapped for something else.
ALTER TABLE wallet_documents ADD COLUMN IF NOT EXISTS mime_type TEXT;

-- The name the file had on the user's device, for display and downloads.
ALTER TABLE wallet_documents ADD COLUMN IF NOT EXISTS file_name TEXT;

-- Uploads are two-phase: the row is created first so we can sign a URL for a
-- key, then the client confirms once S3 has accepted the bytes. Without this
-- a failed upload would leave a row pointing at an object that never arrived.
ALTER TABLE wallet_documents ADD COLUMN IF NOT EXISTS upload_status TEXT NOT NULL DEFAULT 'ready';

ALTER TABLE wallet_documents DROP CONSTRAINT IF EXISTS wallet_documents_upload_status_valid;
ALTER TABLE wallet_documents ADD CONSTRAINT wallet_documents_upload_status_valid CHECK (
    upload_status IN ('pending', 'ready')
);

-- The profile photo has the same device-local problem, and the same fix. One
-- key per user; the object is replaced in place when the photo changes.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_s3_key TEXT;

-- The wallet list is always "this user's documents, newest first".
CREATE INDEX IF NOT EXISTS idx_wallet_documents_user_created
    ON wallet_documents(user_id, created_at DESC);
