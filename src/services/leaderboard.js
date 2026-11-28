// ---------------- LEADERBOARD CLIENT ----------------
// Everything the game knows about the leaderboard server lives here, so
// the rest of the game never deals with URLs, fetch or errors directly.
//
// The server's address comes from VITE_API_URL, set at BUILD time:
//   - locally:  a .env.local file  (VITE_API_URL=http://localhost:3000)
//   - live:     a GitHub repository variable, passed in by the workflow
// If it's not set, the leaderboard is simply switched off and the game
// works exactly as before.

const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const NAME_KEY = 'wildbound.name';

export const leaderboardEnabled = Boolean(API_URL);

// The same rule the server uses, so mistakes show up instantly.
export const NAME_PATTERN = /^[A-Za-z0-9_]{3,12}$/;

// fetch() with a time limit. A free server that has gone to sleep can take
// up to ~50 s to wake, so the default is generous.
async function request(path, options = {}, timeoutMs = 60_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(API_URL + path, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...options.headers },
            signal: controller.signal
        });
        const body = await response.json().catch(() => ({}));

        if (!response.ok) throw new Error(body.error || `Server error (${response.status})`);
        return body;
    } catch (error) {
        if (error.name === 'AbortError') throw new Error('The leaderboard took too long to answer.');
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

// Nudge a sleeping server awake early (e.g. while you're on the title
// screen), so it's ready by the time you submit a score.
export function wakeServer() {
    if (leaderboardEnabled) request('/health').catch(() => {});
}

// [{ name, distance, relics, time, createdAt }], best first
export function fetchTopScores(limit = 5) {
    return request(`/scores/top?limit=${limit}`, {}, 60_000);
}

// Resolves to { rank }
export function submitScore({ name, distance, relics, time }) {
    return request('/scores', {
        method: 'POST',
        body: JSON.stringify({ name, distance, relics, time })
    });
}

// ---------------- REMEMBERED NICKNAME ----------------

export function loadName() {
    try {
        return localStorage.getItem(NAME_KEY) || '';
    } catch {
        return '';
    }
}

export function saveName(name) {
    try {
        localStorage.setItem(NAME_KEY, name);
    } catch {
        // Not saved; you'll just type it again next time.
    }
}
