-- Trip co-editing: one trip, several people.
--
-- The owner adds someone by email. That person gets an invitation they accept
-- or decline; only an accepted one grants access. Deliberately not a friends
-- graph — there isn't one — so an email address is the whole addressing model,
-- and it has to work for someone who has not signed up yet.
--
-- The owner is NOT a row in this table. trips.owner_user_id stays the single
-- source of truth for ownership, so no existing trip needs backfilling and no
-- migration here can leave a trip with nobody attached to it.

CREATE TABLE IF NOT EXISTS trip_collaborators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,

    -- NULL until the invited email signs in for the first time. Inviting
    -- someone without an account has to work, otherwise the owner has to wait
    -- for them to sign up and remember to come back and do it again.
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,

    -- Always stored lowercase. This is what an invite is matched on, and it is
    -- kept after claiming so the owner still sees who they invited even before
    -- that person has filled in a name.
    email TEXT NOT NULL,

    role TEXT NOT NULL DEFAULT 'editor',
    status TEXT NOT NULL DEFAULT 'pending',

    invited_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ,

    -- Only 'editor' today. The constraint is written as an IN list rather than
    -- an equality so that adding 'viewer' later is a one-word change.
    CONSTRAINT trip_collaborators_role_valid CHECK (role IN ('editor')),

    -- pending  = invited, waiting to be accepted (user_id may still be NULL)
    -- active   = accepted; this is the ONLY status that grants access
    -- declined = refused, kept so the invitation does not reappear and so the
    --            owner sees "Declined" rather than silence
    CONSTRAINT trip_collaborators_status_valid
        CHECK (status IN ('pending', 'active', 'declined')),

    -- One invite per email per trip. Re-inviting is an upsert rather than a
    -- duplicate, which is also how a declined invitation gets a second chance.
    CONSTRAINT trip_collaborators_trip_email_unique UNIQUE (trip_id, email)
);

-- A claimed invite must also be unique per user, but only once user_id is set —
-- several unclaimed rows on one trip are legitimate. Hence a partial index
-- rather than a table constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_trip_collaborators_trip_user
    ON trip_collaborators(trip_id, user_id) WHERE user_id IS NOT NULL;

-- "Which trips can I see?" runs on the trip list, every itinerary request and
-- every chat message.
CREATE INDEX IF NOT EXISTS idx_trip_collaborators_user
    ON trip_collaborators(user_id) WHERE user_id IS NOT NULL;

-- "Claim my invitations" runs on every authenticated request, and matches
-- nothing at all in the overwhelming majority of them.
CREATE INDEX IF NOT EXISTS idx_trip_collaborators_email_unclaimed
    ON trip_collaborators(email) WHERE user_id IS NULL;
