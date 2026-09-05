-- Follow graph for the social feed.
--
-- One row per (follower, followed) pair. The feed query in
-- lambdas/social/handler.py filters posts to the current user plus whoever
-- they follow, so this table is what turns the global feed into an
-- Instagram-style following feed.
--
-- init_db.py replays every file in sql/ on each run, so this must stay
-- idempotent, matching the rest of sql/.

CREATE TABLE IF NOT EXISTS follows (
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followed_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, followed_id)
);

ALTER TABLE follows DROP CONSTRAINT IF EXISTS follows_no_self_follow;
ALTER TABLE follows ADD CONSTRAINT follows_no_self_follow CHECK (follower_id != followed_id);

-- "Posts from people I follow" (the feed query).
CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
-- "Who follows this person" (follower counts, follower lists).
CREATE INDEX IF NOT EXISTS idx_follows_followed ON follows(followed_id);
