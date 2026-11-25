// ---------------- SHARED TUNING CONSTANTS ----------------
// Numbers several parts of the game must agree on.

// Player and ropes use the SAME gravity, or a swing would feel different
// from a jump. (Games use more than real 9.8 so motion feels snappy.)
export const GRAVITY = 30; // m/s²

// The run begins here and heads toward -z.
export const START_Z = 8;

// Ropes hang from this height; their end (the grab knot) hangs
// ROPE_LENGTH below - 3 m above the ground, reachable with a jump.
export const ROPE_ANCHOR_HEIGHT = 9;
export const ROPE_LENGTH = 6;
