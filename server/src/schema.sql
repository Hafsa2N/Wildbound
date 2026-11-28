-- The leaderboard's only table. The server creates it automatically on
-- start-up (see db.js), so you never have to run this by hand. It's kept
-- here so you can read exactly what's stored.
--
-- Nothing personal is saved: just a nickname and the run's numbers.

CREATE TABLE IF NOT EXISTS scores (
    id          BIGSERIAL   PRIMARY KEY,
    name        VARCHAR(12) NOT NULL,
    distance    INTEGER     NOT NULL CHECK (distance >= 0),
    relics      INTEGER     NOT NULL DEFAULT 0 CHECK (relics >= 0),
    time_s      REAL        NOT NULL CHECK (time_s > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Makes "best runs first" fast, even with many scores.
CREATE INDEX IF NOT EXISTS scores_by_distance ON scores (distance DESC, created_at ASC);

-- Makes "this player's best run" fast.
CREATE INDEX IF NOT EXISTS scores_by_name ON scores (name, distance DESC);
