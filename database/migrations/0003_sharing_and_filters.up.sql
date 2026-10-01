-- Sharing word lists and activities with colleagues (view or edit rights).
CREATE TABLE vocabulary_set_shares (
    vocabulary_set_id uuid NOT NULL REFERENCES vocabulary_sets (id) ON DELETE CASCADE,
    user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role              text NOT NULL CHECK (role IN ('viewer', 'editor')),
    created_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (vocabulary_set_id, user_id)
);
CREATE INDEX vocabulary_set_shares_user_id_idx ON vocabulary_set_shares (user_id);

CREATE TABLE activity_shares (
    activity_id uuid NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role        text NOT NULL CHECK (role IN ('viewer', 'editor')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (activity_id, user_id)
);
CREATE INDEX activity_shares_user_id_idx ON activity_shares (user_id);

-- Which words of a list an activity uses, by extra column values
-- (vocabulary_items.metadata.fields), e.g. {"Unit": ["3", "4"]}. Empty = all words.
ALTER TABLE activity_vocabulary_sets ADD COLUMN filter jsonb NOT NULL DEFAULT '{}';
