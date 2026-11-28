# WILDBOUND Leaderboard API

A small **Node.js + Express** API backed by **PostgreSQL** that saves runs and returns the top players.
The game (GitHub Pages) calls it; it never stores anything personal - just a nickname and the run's numbers.

| Method | Route | What it does |
|---|---|---|
| `GET` | `/health` | Returns `{ ok: true }`. Also wakes a sleeping free server. |
| `GET` | `/scores/top?limit=10` | Each player's best run, best first (max 50). |
| `POST` | `/scores` | Saves `{ name, distance, relics, time }` and returns `{ rank }`. |

Every score is checked on the server (`src/validate.js`): name format and a word filter, a maximum
average speed, a relic limit, plus rate limiting on saving (5 scores per minute per IP) and CORS
(only the game's site may call it).

## Run it locally

```bash
cd server
npm install
npm run dev
```

It needs a `DATABASE_URL`: copy `.env.example` to `.env` and paste your Neon connection string
(`npm run dev` loads it automatically). Then, in the project root, create `.env.local` containing `VITE_API_URL=http://localhost:3000` and run
`npm run dev` for the game.

## Environment variables

| Name | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgresql://…neon.tech/neondb?sslmode=require` | **Secret.** Set it in the host's dashboard, never in code. |
| `ALLOWED_ORIGINS` | `https://hafsa2n.github.io` | Comma-separated. Must match the game's site exactly. |
| `PORT` | `3000` | Set automatically by Render. |

The `scores` table is created automatically on start-up (see `src/schema.sql`).

## Deploy

- **Database:** [Neon](https://neon.tech) (free Postgres) - copy the connection string.
- **Server:** [Render](https://render.com) Web Service from this repository, root directory `server`,
  build command `npm install`, start command `npm start`, with the environment variables above.
- **Game:** add a GitHub repository **variable** `VITE_API_URL` = the Render URL, then re-run the deploy workflow.

> Render's free tier sleeps after ~15 minutes idle; the first request then takes 30-50 s.
> The game shows "Waking the server…" and keeps working either way.
