// ---------------- PATTERNS ----------------
// A pattern is one short, HAND-DESIGNED piece of gameplay: "a ravine with
// a rope", "a Snapjaw", "a low lash then a high lash". The endless course
// is just patterns strung together at random - so every stretch is still
// something a person designed and tested, never pure noise.
//
// Distances are measured ALONG the chunk from its start (`d`), in metres.
// The chunk turns them into world z (z = chunkStart - d).
//
// Every pattern starts and ends with a little safe ground, so any pattern
// can follow any other: you never land from a swing straight into a bite.

import { ROPE_ANCHOR_HEIGHT, ROPE_LENGTH } from '../../config.js';
import { rand, randomSide } from '../../utils/math.js';


// Tuned by simulation (see the notes beside each pattern):
const ROPE_CHAIN_SPACING = 11.5;  // rope 1 to rope 2: releases from 40° to 60° catch it; 35° misses
// Coin arcs that only a plant-tool launch reaches, as [distance past
// the plant, height]. Each one was collected 4/4 in every simulated
// bounce / fling; a normal jump (peaks ~3.1 m) can't reach them.
const BOUNCE_ARC = [[-0.2, 4.6], [1.0, 5.9], [2.2, 6.4], [3.4, 6.1]];  // over a Snapjaw
const FLING_ARC = [[-1.5, 3.8], [-0.5, 4.6], [0.6, 5.0], [1.7, 4.7]];  // over a Thornlash
// (A fling arc's first coin IS reachable by a plain jump: a lure that
// makes you look up and wonder how to get the rest.)

// Player's body centre swings at this distance from the rope anchor.
const SWING_RADIUS = ROPE_LENGTH + 0.8;

// A point on a rope's swing circle (+ forward, - backward), as {y, d}.
function onSwingArc(ropeD, degrees) {
    const a = (degrees * Math.PI) / 180;
    return {
        y: ROPE_ANCHOR_HEIGHT - SWING_RADIUS * Math.cos(a),
        d: ropeD + SWING_RADIUS * Math.sin(a)
    };
}

// A gentle side-to-side trail of coins between two distances.
function coinTrail(coins, from, to, phase = Math.random() * 6) {
    for (let d = from; d <= to; d += 2.2) {
        coins.push({ x: Math.sin(d * 0.35 + phase) * 1.9, y: 0.9, d });
    }
}

// ---------------- THE PATTERNS ----------------
// Each returns { length, gaps, ropes, enemies, coins, relic }.
// `level` is 0..1 difficulty, growing with distance.

const empty = (length) => ({ length, gaps: [], ropes: [], enemies: [], coins: [], relic: null });

// A breather: just a coin trail.
function calm() {
    const p = empty(16);
    coinTrail(p.coins, 2, 14);
    return p;
}

// The signature: a ravine (or open water) you must swing across.
function ravine({ level, allowRelic = true }) {
    const approach = 5.5;
    const width = 7 + level * 1.5 + rand(0, 0.4);   // 7 .. 8.9 m
    const landing = 4.5;
    const p = empty(approach + width + landing);

    const ropeD = approach - 1.5;  // rope hangs just before the edge
    p.gaps.push({ from: approach, to: approach + width });
    p.ropes.push({ d: ropeD });

    // "Take off here" coin, then two coins along the swing arc
    p.coins.push({ x: 0, y: 2.2, d: ropeD - 1.4 });
    for (const degrees of [14, 30]) {
        const point = onSwingArc(ropeD, degrees);
        p.coins.push({ x: 0, ...point });
    }

    // Sometimes an Emerald Relic, placed to test one swing skill.
    // (Positions tuned by simulating releases at different angles.)
    if (allowRelic && Math.random() < 0.22) {
        const kind = Math.floor(Math.random() * 3);
        if (kind === 0) {
            // Let go LATE: a 45° release flies through it, 35° misses.
            p.relic = { x: 0, y: 6.3, d: ropeD + 7.9 };
        } else if (kind === 1) {
            // Very high: needs a pumped 55-70° release.
            p.relic = { x: 0, y: 7.6, d: ropeD + 7.9 };
        } else {
            // BEHIND the rope: pump backward with S to reach it.
            p.relic = { x: 0, ...onSwingArc(ropeD, -50) };
        }
    }

    return p;
}

// High coins that only a plant-tool launch can reach. They TEACH the
// trick without a word: "how do I get up there?" (Positions tuned by
// simulating bounces and flings.)
function toolArc(coins, d, arc) {
    for (const [dd, y] of arc) {
        coins.push({ x: 0, y, d: d + dd });
    }
}

// A lone Snapjaw on the path. Coins tempt you around its sides - and a
// high arc above it says "bounce on its head".
function snapjaw() {
    const p = empty(15);
    p.enemies.push({ type: 'snapjaw', x: 0, d: 8.5 });
    const side = randomSide();
    for (const d of [5, 6.5, 8.5, 10.5, 12]) {
        p.coins.push({ x: side * 2.6, y: 0.9, d });
    }
    toolArc(p.coins, 8.5, BOUNCE_ARC);
    return p;
}

// Two Snapjaws, staggered left and right.
function snapGauntlet() {
    const p = empty(20);
    const side = randomSide();
    p.enemies.push({ type: 'snapjaw', x: side * 1.5, d: 7 });
    p.enemies.push({ type: 'snapjaw', x: -side * 1.5, d: 14 });
    coinTrail(p.coins, 3, 18);
    return p;
}

// A low lash: JUMP. Coins arc over it to say so.
function lashLow() {
    const p = empty(12);
    p.enemies.push({
        type: 'thornlash', side: randomSide(), d: 6,
        height: 'low', offset: rand(0, 5)
    });
    for (const [d, y] of [[4, 1.4], [5, 2.2], [6, 2.5], [7, 2.2], [8, 1.4]]) {
        p.coins.push({ x: 0, y, d });
    }
    toolArc(p.coins, 6, FLING_ARC);
    return p;
}

// A high lash: SLIDE. Coins low to the ground to say so.
function lashHigh() {
    const p = empty(12);
    p.enemies.push({
        type: 'thornlash', side: randomSide(), d: 6,
        height: 'high', offset: rand(0, 5)
    });
    for (const d of [4, 5, 6, 7, 8]) {
        p.coins.push({ x: 0, y: 0.35, d });
    }
    toolArc(p.coins, 6, FLING_ARC);
    return p;
}

// Low then high: jump, then slide. A safe pocket sits between them.
function lashPair() {
    const p = empty(18);
    const side = randomSide();
    p.enemies.push({ type: 'thornlash', side, d: 5, height: 'low', offset: rand(0, 5) });
    p.enemies.push({ type: 'thornlash', side: -side, d: 11.5, height: 'high', offset: rand(0, 5) });
    coinTrail(p.coins, 2, 16);
    return p;
}

// A gap too wide for one swing: let go of the first rope and catch the
// second in mid-air - a built-in SWING CHAIN. Coins mark the flight path.
function ropeChain({ level }) {
    const approach = 5.5;
    const rope1 = approach - 1.5;
    const rope2 = rope1 + ROPE_CHAIN_SPACING;
    const gapEnd = rope2 + 1.5 + 7 + level * 1.2;  // a normal crossing after rope 2
    const landing = 4.5;
    const p = empty(gapEnd + landing);

    p.gaps.push({ from: approach, to: gapEnd });
    p.ropes.push({ d: rope1 }, { d: rope2 });

    p.coins.push({ x: 0, y: 2.2, d: rope1 - 1.4 });
    // The flight between the ropes, then the far swing
    for (const t of [0.35, 0.55, 0.75]) {
        p.coins.push({ x: 0, y: 5.6 - Math.abs(t - 0.5) * 6, d: rope1 + ROPE_CHAIN_SPACING * t });
    }
    for (const degrees of [14, 30]) {
        p.coins.push({ x: 0, ...onSwingArc(rope2, degrees) });
    }
    return p;
}

export const PATTERNS = { calm, ravine, snapjaw, snapGauntlet, lashLow, lashHigh, lashPair, ropeChain };

// Pick a pattern name using weights, e.g. { ravine: 3, calm: 1 }.
export function pickWeighted(weights) {
    const entries = Object.entries(weights).filter(([, w]) => w > 0);
    let roll = Math.random() * entries.reduce((sum, [, w]) => sum + w, 0);

    for (const [name, w] of entries) {
        roll -= w;
        if (roll <= 0) return name;
    }
    return entries[0][0];
}
