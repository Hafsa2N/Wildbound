// ---------------- SCORE CHECKS ----------------
// Anyone can send anything to a public API, so the server never trusts a
// score just because the game sent it. Each check below rejects runs that
// can't have happened. (A determined cheater can still fake a plausible
// score - these stop the obvious ones.)

// The lemur runs at 7 m/s and swings/launches can briefly go faster, but
// over a whole run the AVERAGE can't get much above this.
const MAX_AVERAGE_SPEED = 9;      // metres per second
const MAX_DISTANCE = 1_000_000;   // a sanity ceiling
const MAX_TIME = 24 * 60 * 60;    // one day, in seconds

// Relics appear on roughly one ravine in five, so they're rare.
// Allow at most one per 40 m, plus a little slack.
const METRES_PER_RELIC = 40;

const NAME_PATTERN = /^[A-Za-z0-9_]{3,12}$/;

// A small word filter. Not perfect (no filter is), but it catches the
// obvious. Compared with the name lower-cased, ignoring underscores and
// common digit-for-letter swaps.
const BLOCKED = ['fuck', 'shit', 'bitch', 'cunt', 'nigg', 'fag', 'rape', 'nazi', 'slut', 'whore', 'dick', 'cock', 'pussy'];

function normalise(name) {
    return name
        .toLowerCase()
        .replace(/_/g, '')
        .replace(/0/g, 'o')
        .replace(/1/g, 'i')
        .replace(/3/g, 'e')
        .replace(/4/g, 'a')
        .replace(/5/g, 's')
        .replace(/7/g, 't');
}

// Returns { ok: true, score } with clean values, or { ok: false, error }.
export function validateScore(body) {
    if (!body || typeof body !== 'object') {
        return { ok: false, error: 'Missing score.' };
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const distance = Number(body.distance);
    const relics = Number(body.relics ?? 0);
    const time = Number(body.time);

    if (!NAME_PATTERN.test(name)) {
        return { ok: false, error: 'Name must be 3-12 letters, numbers or _.' };
    }
    if (BLOCKED.some((word) => normalise(name).includes(word))) {
        return { ok: false, error: 'Please choose a different name.' };
    }
    if (!Number.isInteger(distance) || distance < 1 || distance > MAX_DISTANCE) {
        return { ok: false, error: 'Invalid distance.' };
    }
    if (!Number.isFinite(time) || time <= 0 || time > MAX_TIME) {
        return { ok: false, error: 'Invalid time.' };
    }
    if (distance / time > MAX_AVERAGE_SPEED) {
        return { ok: false, error: 'That run is faster than the lemur can go.' };
    }
    if (!Number.isInteger(relics) || relics < 0 || relics > Math.floor(distance / METRES_PER_RELIC) + 1) {
        return { ok: false, error: 'Invalid relic count.' };
    }

    return { ok: true, score: { name, distance, relics, time: Math.round(time * 10) / 10 } };
}
