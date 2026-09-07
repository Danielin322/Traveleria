-- Who added an event.
--
-- Only interesting once a trip can have more than one editor (010), and it
-- pays for three things there:
--
--   * an "added by Ben" line under an event in the daily plan
--   * the assistant knowing whose event it is about to delete, so it can ask
--     first instead of removing a co-editor's plan on a fuzzy name match
--   * an answer to "who put this here?" three weeks into planning
--
-- Nullable and not backfilled. Events that predate this column keep NULL and
-- render without an author, which is honest — the information genuinely was
-- not recorded at the time. ON DELETE SET NULL rather than CASCADE: losing the
-- author of an event is not a reason to lose the event.

ALTER TABLE day_places
    ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
