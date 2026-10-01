-- Requires PostgreSQL 13+ (gen_random_uuid is built in).

CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email         text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token_hash bytea PRIMARY KEY,
    user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);

CREATE TABLE vocabulary_sets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title           text NOT NULL,
    source_language text NOT NULL DEFAULT '',
    target_language text NOT NULL DEFAULT '',
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vocabulary_sets_owner_id_idx ON vocabulary_sets (owner_id);

CREATE TABLE vocabulary_items (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vocabulary_set_id uuid NOT NULL REFERENCES vocabulary_sets (id) ON DELETE CASCADE,
    source            text NOT NULL,
    target            text NOT NULL,
    metadata          jsonb,
    position          integer NOT NULL DEFAULT 0,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vocabulary_items_set_id_idx ON vocabulary_items (vocabulary_set_id, position);

CREATE TABLE activities (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    title      text NOT NULL,
    public_id  text NOT NULL UNIQUE,
    published  boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_owner_id_idx ON activities (owner_id);

CREATE TABLE activity_vocabulary_sets (
    activity_id       uuid NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
    vocabulary_set_id uuid NOT NULL REFERENCES vocabulary_sets (id) ON DELETE CASCADE,
    PRIMARY KEY (activity_id, vocabulary_set_id)
);
CREATE INDEX activity_vocabulary_sets_set_id_idx ON activity_vocabulary_sets (vocabulary_set_id);

CREATE TABLE activity_games (
    activity_id uuid NOT NULL REFERENCES activities (id) ON DELETE CASCADE,
    game_type   text NOT NULL,
    settings    jsonb NOT NULL DEFAULT '{}',
    position    integer NOT NULL DEFAULT 0,
    PRIMARY KEY (activity_id, game_type)
);
