// ---------------- SMALL MATH HELPERS ----------------
// Tiny functions used all over the game, written once here.

// A random number between min and max.
export const rand = (min, max) => min + Math.random() * (max - min);

// A random item from a list.
export const pick = (list) => list[Math.floor(Math.random() * list.length)];

// -1 or 1 at random: "left or right of the path?"
export const randomSide = () => (Math.random() < 0.5 ? -1 : 1);

// Ease-in-out over 0..1: starts slow, speeds up, ends slow.
export const smoothstep = (t) => t * t * (3 - 2 * t);

// Move `current` a fraction `k` (0..1) of the way toward `target`.
export const ease = (current, target, k) => current + (target - current) * k;

// FRAME-RATE INDEPENDENT smoothing. Use as the `k` for ease() or lerp():
//
//     value = ease(value, target, damp(8, dt));
//
// A fixed k (like 0.1) runs more often at 144 fps than at 30 fps, so the
// game would feel different on different screens. damp() gives the same
// result per SECOND at any frame rate. Bigger rate = snappier.
export const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

// Wrap an angle into -PI..PI, so turning always takes the short way round.
export const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
