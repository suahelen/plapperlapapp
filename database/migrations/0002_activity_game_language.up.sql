-- Language the games of an activity are shown in (de, fr, en, it, es); '' = automatic
-- (the language being learned, derived from the word lists).
ALTER TABLE activities ADD COLUMN game_language text NOT NULL DEFAULT '';
