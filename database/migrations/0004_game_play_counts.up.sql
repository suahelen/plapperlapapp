-- Lightweight, anonymous usage stats: a count per game type, no user data.
CREATE TABLE game_play_counts (
    game_type text PRIMARY KEY,
    count     bigint NOT NULL DEFAULT 0
);
