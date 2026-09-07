-- Sharing a trip as a social post: a post can point at a trip instead of (or
-- alongside) text/an image. The post always shows the trip's current state --
-- it is a live link via shared_trip_id, not a snapshot -- so ON DELETE SET
-- NULL is enough to keep the post row valid if the trip is later deleted; the
-- post just stops showing a trip card.

ALTER TABLE posts ADD COLUMN IF NOT EXISTS shared_trip_id UUID REFERENCES trips(id) ON DELETE SET NULL;

ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_text_or_image;
ALTER TABLE posts ADD CONSTRAINT posts_text_or_image CHECK (
    text IS NOT NULL OR image_s3_key IS NOT NULL OR shared_trip_id IS NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_posts_shared_trip_id ON posts(shared_trip_id);
