import * as THREE from 'three';
import Chunk from './Chunk.js';
import { PATTERNS, pickWeighted } from './patterns.js';
import { ZONES, ZONE_ORDER, CHUNKS_PER_ZONE, patternWeights } from './zones.js';
import { START_Z } from '../../config.js';

// ---------------- COURSE ----------------
// The conductor of the endless run.
//
//   - keeps chunks built from just behind the player to AHEAD metres in front
//   - removes chunks once they're BEHIND the player
//   - decides what comes next: a pattern, or a transition into the next zone
//   - answers questions: "is there ground at z?", "what zone is this?"
//
// Difficulty grows with distance AND with each lap of the zone cycle.

const AHEAD = 140;          // build this far in front (fog hides the edge)
const BEHIND = 28;          // keep this much behind (the camera trails the player)
const TRAILHEAD = 34;       // the first chunk starts this far behind the start
const DISTANCE_FOR_MAX = 2500; // metres until the hardest settings
const BUILD_BUDGET_MS = 4;  // time per frame spent finishing chunks

export default class Course {
    constructor(scene, collectibles) {
        this.world = { scene, collectibles };
        this.chunks = [];
        this.ropes = [];
        this.enemies = [];
    }

    // ---------------- BUILD / RESET ----------------

    reset() {
        for (const chunk of this.chunks) chunk.dispose();
        this.chunks = [];
        this.ropes.length = 0;
        this.enemies.length = 0;

        this.zoneIndex = 0;
        this.chunksInZone = 0;
        this.lastPattern = null;
        this.frontier = START_Z + TRAILHEAD; // where the next chunk starts

        // The trailhead: a calm stretch behind and around the start line,
        // then one more breather before the action.
        this.addChunk({ kind: 'start', zone: this.zone, layout: { ...PATTERNS.calm(), length: TRAILHEAD + 4, coins: [] } });
        this.addChunk({ kind: 'play', zone: this.zone, layout: PATTERNS.calm() });

        // Fill the view up front, all at once (behind the title screen).
        while (this.frontier > START_Z - AHEAD) this.spawnNext();
        for (const chunk of this.chunks) chunk.finishNow();
    }

    get zone() {
        return ZONES[ZONE_ORDER[this.zoneIndex % ZONE_ORDER.length]];
    }

    get nextZoneDef() {
        return ZONES[ZONE_ORDER[(this.zoneIndex + 1) % ZONE_ORDER.length]];
    }

    // 0..1 difficulty for a z position.
    levelAt(z) {
        const byDistance = (START_Z - z) / DISTANCE_FOR_MAX;
        const byLap = Math.floor(this.zoneIndex / ZONE_ORDER.length) * 0.15;
        return THREE.MathUtils.clamp(byDistance + byLap, 0, 1);
    }

    spawnNext() {
        if (this.chunksInZone >= CHUNKS_PER_ZONE) {
            // Time for a new zone: a transition chunk (no hazards, just coins).
            const layout = PATTERNS.calm();
            layout.length = 20;
            layout.coins = layout.coins.filter((c) => c.d < 18);

            this.addChunk({ kind: 'transition', zone: this.zone, nextZone: this.nextZoneDef, layout });
            this.zoneIndex++;
            this.chunksInZone = 0;
            return;
        }

        // Pick a pattern for this zone - avoiding an exact repeat.
        const weights = patternWeights(this.zone, this.levelAt(this.frontier));
        if (this.lastPattern && weights[this.lastPattern] && Object.keys(weights).length > 1) {
            weights[this.lastPattern] *= 0.3;
        }
        const name = pickWeighted(weights);
        this.lastPattern = name;

        const layout = PATTERNS[name]({ level: this.levelAt(this.frontier) });
        this.addChunk({ kind: 'play', zone: this.zone, layout });
        this.chunksInZone++;
    }

    addChunk(spec) {
        const chunk = new Chunk(this.world, { ...spec, zStart: this.frontier });
        this.chunks.push(chunk);
        this.ropes.push(...chunk.ropes);
        this.enemies.push(...chunk.enemies);
        this.frontier = chunk.zEnd;
    }

    removeChunk(chunk) {
        chunk.dispose();
        this.chunks.splice(this.chunks.indexOf(chunk), 1);

        // Ropes/enemies are shared arrays the Player and world read from,
        // so edit them IN PLACE rather than replacing them.
        for (const list of [this.ropes, this.enemies]) {
            for (let i = list.length - 1; i >= 0; i--) {
                if (chunk.ropes.includes(list[i]) || chunk.enemies.includes(list[i])) list.splice(i, 1);
            }
        }
    }

    // ---------------- PER FRAME ----------------

    update(playerZ, time) {
        // Plan the next chunk ahead once the previous one has finished
        // building - so unfinished work never piles up.
        const newest = this.chunks[this.chunks.length - 1];
        if (this.frontier > playerZ - AHEAD && (!newest || newest.ready)) this.spawnNext();

        // Spend a few milliseconds finishing chunks still being built.
        const deadline = performance.now() + BUILD_BUDGET_MS;
        for (const chunk of this.chunks) {
            if (!chunk.ready) chunk.work(deadline);
        }

        // Clear behind.
        const oldest = this.chunks[0];
        if (oldest && oldest.zEnd > playerZ + BEHIND) this.removeChunk(oldest);

        for (const chunk of this.chunks) chunk.update(time);
    }

    // ---------------- QUESTIONS ----------------

    gapAt(z) {
        for (const chunk of this.chunks) {
            if (z > chunk.zStart || z < chunk.zEnd) continue;
            for (const gap of chunk.gaps) {
                if (z < gap.start && z > gap.end) return gap;
            }
        }
        return null;
    }

    isSolidGround(z) {
        return !this.gapAt(z);
    }

    // How low you can fall at z before it counts as falling in.
    killHeightAt(z) {
        return this.gapAt(z)?.kill ?? -7;
    }

    // You can't run back past the oldest chunk still built.
    get backLimit() {
        return (this.chunks[0]?.zStart ?? START_Z + TRAILHEAD) - 2;
    }

    chunkAt(z) {
        return this.chunks.find((c) => z <= c.zStart && z > c.zEnd) ?? this.chunks[0];
    }

    // The zone you're in, and how far through a transition (0..1) you are.
    zoneInfoAt(z) {
        const chunk = this.chunkAt(z);
        if (!chunk) return { from: this.zone, to: null, t: 0 };

        if (!chunk.nextZone) return { from: chunk.zone, to: null, t: 0 };

        // Blend across the whole transition chunk, centred on the gate.
        const t = THREE.MathUtils.clamp((chunk.zStart - z) / chunk.length, 0, 1);
        return { from: chunk.zone, to: chunk.nextZone, t };
    }

    distanceAt(z) {
        return Math.max(0, START_Z - z);
    }
}
