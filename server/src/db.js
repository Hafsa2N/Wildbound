import fs from 'node:fs';
import pg from 'pg';

// ---------------- STORAGE ----------------
// All database access lives here, so the routes never write SQL themselves.
//
// The leaderboard shows each player's BEST run once, so one person can't
// fill the whole top 10.

export function createStore(connectionString) {
    if (!connectionString) {
        throw new Error('DATABASE_URL is not set. Add your Neon connection string (see server/.env.example).');
    }

    const local = /localhost|127\.0\.0\.1/.test(connectionString);
    const pool = new pg.Pool({
        connectionString,
        // Hosted databases like Neon require an encrypted connection.
        ssl: local ? false : { rejectUnauthorized: true },
        max: 5
    });

    return {
        // Creates the table on first start (safe to run every time).
        async init() {
            await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
        },

        async insertScore({ name, distance, relics, time }) {
            await pool.query(
                'INSERT INTO scores (name, distance, relics, time_s) VALUES ($1, $2, $3, $4)',
                [name, distance, relics, time]
            );
        },

        // Each name's best run (ties: whoever got there first), best first.
        async topScores(limit) {
            const { rows } = await pool.query(
                `SELECT name, distance, relics, time_s AS time, created_at AS "createdAt"
                 FROM (
                     SELECT DISTINCT ON (name) *
                     FROM scores
                     ORDER BY name, distance DESC, created_at ASC
                 ) best
                 ORDER BY distance DESC, created_at ASC
                 LIMIT $1`,
                [limit]
            );
            return rows;
        },

        // Where a distance places: 1 + how many OTHER players did better.
        async rankOf(name, distance) {
            const { rows } = await pool.query(
                `SELECT COUNT(*)::int AS better
                 FROM (SELECT name, MAX(distance) AS best FROM scores GROUP BY name) b
                 WHERE b.best > $2 AND b.name <> $1`,
                [name, distance]
            );
            return rows[0].better + 1;
        }
    };
}
