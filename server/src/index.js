import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createStore } from './db.js';
import { validateScore } from './validate.js';

// ---------------- WILDBOUND LEADERBOARD API ----------------
//
//   GET  /health            -> { ok: true }      (also wakes a sleeping server)
//   GET  /scores/top?limit= -> [{ name, distance, relics, time, createdAt }]
//   POST /scores            -> { rank }          body: { name, distance, relics, time }
//
// Settings come from environment variables, never from the code, so no
// secret ever ends up on GitHub:
//
//   DATABASE_URL    Postgres connection string (Neon). Required.
//   ALLOWED_ORIGINS Comma-separated sites allowed to call this API,
//                   e.g. https://hafsa2n.github.io
//   PORT            Set automatically by Render; defaults to 3000 locally.

const PORT = Number(process.env.PORT) || 3000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const store = createStore(process.env.DATABASE_URL);
const app = express();

// Render (like most hosts) puts a proxy in front of the app. This makes
// req.ip the real visitor's address, so rate limiting works per player.
app.set('trust proxy', 1);

// Don't advertise which framework runs the server ("X-Powered-By: Express").
app.disable('x-powered-by');

// CORS: browsers only let pages from these sites call the API.
app.use(cors({
    origin: ALLOWED_ORIGINS,
    methods: ['GET', 'POST']
}));

// Scores are tiny; refuse anything bigger.
app.use(express.json({ limit: '1kb' }));

// Rate limit on SAVING scores (per IP address, used only here, never stored).
// Reading the leaderboard is cheap, so it isn't limited.
const writeLimit = rateLimit({
    windowMs: 60_000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many scores at once - try again in a minute.' }
});

// ---------------- ROUTES ----------------

app.get('/health', (req, res) => {
    res.json({ ok: true });
});

app.get('/scores/top', async (req, res, next) => {
    try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
        res.json(await store.topScores(limit));
    } catch (error) {
        next(error);
    }
});

app.post('/scores', writeLimit, async (req, res, next) => {
    try {
        const result = validateScore(req.body);
        if (!result.ok) {
            res.status(400).json({ error: result.error });
            return;
        }

        await store.insertScore(result.score);
        const rank = await store.rankOf(result.score.name, result.score.distance);
        res.status(201).json({ rank });
    } catch (error) {
        next(error);
    }
});

// Unknown routes
app.use((req, res) => {
    res.status(404).json({ error: 'Not found.' });
});

// Errors. A bad REQUEST (broken JSON, far too big) is the sender's mistake:
// answer 4xx. Anything else is ours: log it, but never show details.
app.use((error, req, res, next) => {
    if (error.status >= 400 && error.status < 500) {
        const message = error.type === 'entity.too.large' ? 'Request too large.' : 'Invalid request.';
        res.status(error.status).json({ error: message });
        return;
    }

    console.error(error);
    res.status(500).json({ error: 'Something went wrong.' });
});

// ---------------- START ----------------

await store.init();

app.listen(PORT, () => {
    console.log(`WILDBOUND leaderboard on port ${PORT} - store: Postgres`);
    console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
});
