-- Social feed: posts, likes, and threaded comments.
--
-- Comments are one self-referencing table rather than a comments/replies
-- split. parent_comment_id points at the immediate parent (NULL for a
-- top-level comment), so a reply to a reply is just another row pointing at
-- that reply -- nesting is not capped at one level the way the original
-- mock data's Comment/Reply types were. lambdas/social/handler.py flattens
-- the whole thread under its top-level comment for display, the way
-- Instagram/Facebook do, so the app never has to render more than one level
-- of visual nesting.
--
-- init_db.py replays every file in sql/ on each run, so this must stay
-- idempotent, matching the rest of sql/.

CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT,
    image_s3_key TEXT,
    -- Same two-phase upload as wallet_documents: the row exists before the
    -- image lands in S3, so there is a key to sign an upload URL for. A
    -- pending row still missing its image after an hour is a failed upload,
    -- not a broken post; handler.py hides those from the feed.
    upload_status TEXT NOT NULL DEFAULT 'ready',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT posts_text_or_image CHECK (text IS NOT NULL OR image_s3_key IS NOT NULL)
);

ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_upload_status_valid;
ALTER TABLE posts ADD CONSTRAINT posts_upload_status_valid CHECK (
    upload_status IN ('pending', 'ready')
);

CREATE TABLE IF NOT EXISTS post_likes (
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
);

CREATE TABLE IF NOT EXISTS post_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- ON DELETE CASCADE here means deleting any comment takes its whole
    -- reply subtree with it, not just its direct children.
    parent_comment_id UUID REFERENCES post_comments(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_likes_post_id ON post_likes(post_id);
CREATE INDEX IF NOT EXISTS idx_post_comments_post_id ON post_comments(post_id, created_at);
CREATE INDEX IF NOT EXISTS idx_post_comments_parent_id ON post_comments(parent_comment_id);
