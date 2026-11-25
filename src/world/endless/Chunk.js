import * as THREE from 'three';
import { Batcher } from '../batch.js';
import { getPrefab, cylinderBetween, SCENERY_MATERIALS as SM } from '../scenery/prefabs.js';
import { archVine } from '../scenery/flora.js';
import { zoneTextures } from '../scenery/textures.js';
import { addRiver, addWaterfall, animateFoam } from '../Water.js';
import { ROPE_ANCHOR_HEIGHT, ROPE_LENGTH } from '../../config.js';
import Rope from '../Rope.js';
import Snapjaw from '../../enemies/Snapjaw.js';
import Thornlash from '../../enemies/Thornlash.js';
import { rand, randomSide } from '../../utils/math.js';

// ---------------- CHUNK ----------------
// One stretch of the endless world: ground, scenery, and gameplay.
//
//    zStart (near)                                   zEnd (far)
//    |-------- pattern laid out along -z ---------------|
//
// A chunk is built from: a ZONE (how it looks), and a PATTERN (what you
// face). A TRANSITION chunk is half one zone, half the next, with a gate.
// When the player has passed it, dispose() removes everything it made.
//
// TIME-SLICING: building scenery is expensive (copying and merging lots
// of geometry), and doing a whole chunk in one frame causes a visible
// stutter. So a chunk PLANS everything immediately (cheap: deciding where
// things go), but queues the expensive work as small tasks. The Course
// runs a few milliseconds of tasks each frame. Chunks are built far ahead
// in the fog, so nobody sees them finishing.

const PATH_HALF = 3.5;           // keep scenery off the running path
const RAVINE_DEPTH = 10;
const RAVINE_RIVER_Y = -6.5;
const OPEN_WATER_Y = -0.6;       // river zone: water just below the boardwalk

// How low you may fall before it counts as "fell in".
const KILL_HEIGHT = { ravine: -7, water: -1.3 };


export default class Chunk {
    // spec: { zStart, zone, nextZone?, layout, kind: 'start'|'play'|'transition' }
    constructor(world, spec) {
        this.world = world;          // { scene, collectibles }
        this.zone = spec.zone;
        this.nextZone = spec.nextZone ?? null;
        this.kind = spec.kind;
        this.layout = spec.layout;

        this.zStart = spec.zStart;
        this.length = spec.layout.length;
        this.zEnd = this.zStart - this.length;
        // A transition switches zones halfway through.
        this.zSwitch = this.nextZone ? this.zStart - this.length / 2 : this.zEnd;

        this.group = new THREE.Group();
        this.batcher = new Batcher();
        this.tasks = [];     // expensive work, done a little each frame
        this.taskIndex = 0;

        this.gaps = [];     // absolute: { start (near z), end (far z), kill }
        this.ropes = [];
        this.enemies = [];
        this.foam = [];

        this.build();
        world.scene.add(this.group);
    }

    // ---------------- HELPERS ----------------

    z(d) {
        return this.zStart - d;
    }

    zoneAt(z) {
        return this.nextZone && z < this.zSwitch ? this.nextZone : this.zone;
    }

    // Is z over a RAVINE? (Boardwalk gaps over open water don't count:
    // the river banks and reeds carry on beside them.)
    overGap(z, margin = 0) {
        return this.gaps.some((g) => g.surface === 'ground' && z < g.start + margin && z > g.end - margin);
    }

    // Mark meshes this chunk created, so dispose() knows what to free.
    own(mesh, { material = false, map = false } = {}) {
        mesh.userData.owned = true;
        mesh.userData.ownMaterial = material;
        mesh.userData.ownMap = map;
        return mesh;
    }

    // ---------------- THE TASK QUEUE ----------------

    later(task) {
        this.tasks.push(task);
    }

    placeLater(prefab, x, y, z, rotationY = 0, scale = 1) {
        this.later(() => this.batcher.place(prefab, x, y, z, rotationY, scale));
    }

    // Build a one-off object later, then merge it into the batch.
    objectLater(makeObject) {
        this.later(() => this.batcher.addObject(makeObject()));
    }

    get ready() {
        return this.taskIndex >= this.tasks.length;
    }

    // Run queued tasks until the deadline (a performance.now() time).
    work(deadline) {
        while (this.taskIndex < this.tasks.length && performance.now() < deadline) {
            this.tasks[this.taskIndex++]();
        }
        // All done: let go of the task list (and what its closures hold).
        if (this.taskIndex >= this.tasks.length) {
            this.tasks = [];
            this.taskIndex = 0;
        }
    }

    finishNow() {
        this.work(Infinity);
    }

    // Place a prefab if the spot is on solid ground.
    stamp(name, x, z, { y = 0, margin = 1, scale = 1, rotate = true } = {}) {
        if (this.overGap(z, margin)) return;
        this.placeLater(getPrefab(name), x, y, z, rotate ? rand(0, Math.PI * 2) : 0, scale);
    }

    // Scatter `count` of a prefab across a band beside the path.
    scatter(name, count, minX, maxX, zFrom, zTo, options = {}) {
        for (let i = 0; i < count; i++) {
            const x = randomSide() * rand(minX, maxX);
            const z = rand(zTo, zFrom);
            this.stamp(name, x, z, { scale: rand(options.minScale ?? 0.85, options.maxScale ?? 1.15), ...options });
        }
    }

    // ---------------- BUILD ----------------

    build() {
        const L = this.layout;

        for (const gap of L.gaps) {
            const zone = this.zoneAt(this.z(gap.from));
            this.gaps.push({
                start: this.z(gap.from),
                end: this.z(gap.to),
                kill: zone.surface === 'water' ? KILL_HEIGHT.water : KILL_HEIGHT.ravine,
                surface: zone.surface
            });
        }

        // Each half (or the whole, if not a transition) gets its surface.
        this.buildSurface(this.zone, this.zStart, this.zSwitch);
        if (this.nextZone) {
            this.buildSurface(this.nextZone, this.zSwitch, this.zEnd);
            this.buildGate();
        }

        for (const gap of this.gaps) this.buildGapDetail(gap);

        this.decorate(this.zone, this.zStart, this.zSwitch);
        if (this.nextZone) this.decorate(this.nextZone, this.zSwitch, this.zEnd);

        this.buildGameplay();

        // Last task: merge all the stamped scenery into a few meshes.
        this.later(() => {
            for (const mesh of this.batcher.build(this.group)) this.own(mesh);
        });
    }

    // ---------------- SURFACES ----------------

    // Solid pieces of [zFrom..zTo] between the gaps.
    solidRanges(zFrom, zTo) {
        const ranges = [];
        let cursor = zFrom;

        const gaps = this.gaps
            .filter((g) => g.end < zFrom && g.start > zTo)
            .sort((a, b) => b.start - a.start);

        for (const g of gaps) {
            if (g.start < cursor) ranges.push([cursor, Math.max(g.start, zTo)]);
            cursor = Math.min(cursor, g.end);
        }
        if (cursor > zTo) ranges.push([cursor, zTo]);

        return ranges;
    }

    // A flat textured strip (ground or path). Texture tiles every `tile` m.
    strip(textureName, width, zFrom, zTo, x, y, tile) {
        const length = zFrom - zTo;
        if (length <= 0.01) return;

        const texture = zoneTextures()[textureName].clone();
        texture.repeat.set(width / tile, length / tile);
        texture.offset.y = zFrom / tile; // continuous across chunks
        texture.needsUpdate = true;

        const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(width, length),
            new THREE.MeshStandardMaterial({ map: texture, color: '#d2d8b0', roughness: 1 })
        );
        mesh.rotation.x = -Math.PI / 2;
        mesh.position.set(x, y, (zFrom + zTo) / 2);
        mesh.receiveShadow = true;
        this.group.add(this.own(mesh, { material: true, map: true }));
    }

    buildSurface(zone, zFrom, zTo) {
        if (zone.surface === 'ground') {
            for (const [a, b] of this.solidRanges(zFrom, zTo)) {
                this.strip(zone.ground, 160, a, b, 0, -0.1, 20);
                this.strip(zone.path, 7, a, b, 0, 0, 8.7);
            }
        } else {
            // River: open water everywhere, grassy banks out to the sides,
            // and a boardwalk down the middle (with gaps).
            this.own(addRiver(this.group, zFrom, zTo, OPEN_WATER_Y));
            this.strip(zone.ground, 70, zFrom, zTo, -45, 0.05, 20);
            this.strip(zone.ground, 70, zFrom, zTo, 45, 0.05, 20);

            for (const [a, b] of this.solidRanges(zFrom, zTo)) {
                for (let z = a; z > b + 0.5; z -= 1) {
                    this.placeLater(getPrefab('boardwalkSection'), 0, 0, z);
                }
                for (let z = a - 1; z > b; z -= 3) {
                    this.placeLater(getPrefab('boardwalkPosts'), 0, 0, z);
                }
            }
        }

        // Where solid ground meets water (a riverbank), add an earth bank so
        // the ground doesn't just end in thin air.
        if (this.nextZone && zone === this.zone && zone.surface !== this.nextZone.surface) {
            this.bankWall(this.zSwitch, zone.surface === 'ground' ? -1 : 1);
        }
    }

    // A low earth wall across the world at z, facing `dir` (+1 = toward +z).
    bankWall(z, dir) {
        const texture = zoneTextures().cliff.clone();
        texture.repeat.set(16, 0.3);
        texture.needsUpdate = true;

        const wall = new THREE.Mesh(
            new THREE.BoxGeometry(160, 1.2, 0.6),
            new THREE.MeshStandardMaterial({ map: texture, color: '#b8a58c', roughness: 1 })
        );
        wall.position.set(0, -0.55, z - dir * 0.3);
        this.group.add(this.own(wall, { material: true, map: true }));
    }

    // A ravine in solid ground: cliff walls, a floor, a river, vines,
    // glowing bells on the edges, and sometimes a waterfall.
    buildGapDetail(gap) {
        if (gap.surface !== 'ground') {
            // Open water: a few lily pads drifting in the boardwalk gap
            this.placeLater(getPrefab('lilyPads'), rand(-2, 2), OPEN_WATER_Y + 0.02, (gap.start + gap.end) / 2);
            return;
        }

        const zone = this.zoneAt(gap.start);
        const texture = zoneTextures()[zone.cliff].clone();
        texture.repeat.set(16, 1);
        texture.needsUpdate = true;
        const wallMaterial = new THREE.MeshStandardMaterial({ map: texture, color: '#b8a58c', roughness: 1 });

        // Walls sit just OUTSIDE the gap, so their faces line up with the
        // edges the player collides with.
        for (const [z, dir] of [[gap.start, 1], [gap.end, -1]]) {
            const wall = new THREE.Mesh(new THREE.BoxGeometry(160, RAVINE_DEPTH, 0.6), wallMaterial);
            wall.position.set(0, -RAVINE_DEPTH / 2 - 0.05, z + dir * 0.3);
            wall.receiveShadow = true;
            this.group.add(this.own(wall, { map: true }));
        }
        this.ownedMaterials = [...(this.ownedMaterials ?? []), wallMaterial];

        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(160, gap.start - gap.end),
            new THREE.MeshStandardMaterial({ color: '#1f2a1b', roughness: 1 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(0, -RAVINE_DEPTH, (gap.start + gap.end) / 2);
        this.group.add(this.own(floor, { material: true }));

        this.own(addRiver(this.group, gap.start, gap.end, RAVINE_RIVER_Y));

        // Vines draped down both cliff faces. The prefab bulges toward +z;
        // turning it half a circle makes it face the other wall.
        for (const [z, dir] of [[gap.start, -1], [gap.end, 1]]) {
            for (let i = 0; i < 10; i++) {
                this.placeLater(getPrefab('cliffVine'), rand(-30, 30), 0, z, dir > 0 ? 0 : Math.PI);
            }
        }

        // Glowing bells mark both edges - you can see where the drop is.
        for (const z of [gap.start + 0.6, gap.end - 0.6]) {
            for (let i = 0; i < 4; i++) {
                this.placeLater(getPrefab('glowBells'), randomSide() * rand(3.8, 12), 0, z);
            }
        }

        // A waterfall off the far cliff, half the time
        if (Math.random() < 0.5) {
            const x = randomSide() * rand(6, 15);
            this.foam.push(...addWaterfall(this.group, x, gap.end, rand(2.5, 4.5), 0.02, RAVINE_RIVER_Y));
        }
    }

    // ---------------- GATES (transitions) ----------------

    buildGate() {
        this.objectLater(() => this.makeGate());
    }

    makeGate() {
        const z = this.zSwitch;
        const g = new THREE.Group();
        const to = this.nextZone.id;

        if (to === 'river') {
            // A rope-lashed wooden archway onto the boardwalk, with lanterns
            for (const x of [-4.3, 4.3]) {
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 6, 8), SM.woodDark);
                post.position.set(x, 3, z);
                post.castShadow = true;
                g.add(post);

                const lantern = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), SM.runeGlow);
                lantern.position.set(x * 0.8, 4.6, z + 0.2);
                g.add(lantern);
            }
            const beam = new THREE.Mesh(new THREE.BoxGeometry(10, 0.45, 0.45), SM.wood);
            beam.position.set(0, 5.9, z);
            beam.castShadow = true;
            g.add(beam);
        } else if (to === 'ruins') {
            // The ruin gate: two stone pillars, a heavy lintel, glowing runes
            for (const x of [-4.4, 4.4]) {
                const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 7, 1.2), SM.stone);
                pillar.position.set(x, 3.5, z);
                pillar.castShadow = true;
                g.add(pillar);

                for (let i = 0; i < 3; i++) {
                    const rune = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.05), SM.runeGlow);
                    rune.position.set(x, 1.5 + i * 1.6, z + 0.63);
                    g.add(rune);
                }
            }
            const lintel = new THREE.Mesh(new THREE.BoxGeometry(11, 1.1, 1.5), SM.stoneDark);
            lintel.position.set(0, 7.5, z);
            lintel.castShadow = true;
            g.add(lintel);
        } else {
            // Back into the jungle: a broken, root-wrapped arch
            for (const [x, h] of [[-4.4, 6], [4.4, 3.5]]) {
                const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, h, 1.2), SM.stone);
                pillar.position.set(x, h / 2, z);
                pillar.castShadow = true;
                g.add(pillar);
            }
            const fallen = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.9, 1.2), SM.stoneDark);
            fallen.position.set(-2.2, 6.2, z);
            fallen.rotation.z = -0.18;
            g.add(fallen);
            g.add(archVine(z));
        }

        return g;
    }

    // ---------------- SCENERY ----------------
    // The jungle WALLS: lots of plants, layered by distance from the path,
    // so the screen is full right out to the horizon.

    decorate(zone, zFrom, zTo) {
        const length = zFrom - zTo;
        if (length <= 0) return;

        if (zone.id === 'river') {
            this.decorateRiver(zFrom, zTo, length);
        } else if (zone.id === 'ruins') {
            this.decorateRuins(zFrom, zTo, length);
        } else {
            this.decorateTrail(zFrom, zTo, length);
        }
    }

    // Shared: trees and plants filling the space beyond `inner` metres.
    jungleBands(zFrom, zTo, length, inner, density = 1) {
        const n = (per) => Math.round((length / per) * density);

        // Near wall: kept LOW so it never blocks the camera's view of the path
        this.scatter('bush', n(1.4), inner + 0.4, inner + 5, zFrom, zTo, { margin: 1.5, minScale: 0.5, maxScale: 0.8 });
        this.scatter('tree', n(4.5), inner + 3, inner + 11, zFrom, zTo, { margin: 2.5, minScale: 0.9, maxScale: 1.5 });
        this.scatter('bush', n(2), inner + 5, inner + 25, zFrom, zTo, { margin: 1.5, minScale: 1, maxScale: 1.6 });
        this.scatter('farTree', n(2.2), inner + 12, 50, zFrom, zTo, { margin: 3, minScale: 0.9, maxScale: 1.4 });
        this.scatter('fern', n(3.5), inner, inner + 9, zFrom, zTo, { margin: 1.5 });
        this.scatter('grassTuft', n(0.18), inner - 0.2, inner + 16, zFrom, zTo, { margin: 0.3 });
        this.scatter('mossPatch', n(1.5), inner, inner + 20, zFrom, zTo, { margin: 1 });
        this.scatter('hangingVine', n(7), inner + 0.5, inner + 6, zFrom, zTo, { margin: 0 });
    }

    decorateTrail(zFrom, zTo, length) {
        this.jungleBands(zFrom, zTo, length, PATH_HALF + 0.3);

        this.scatter('heliconia', Math.round(length / 7), 3.8, 7, zFrom, zTo);
        this.scatter('blossomPatch', Math.round(length / 3), 3.6, 12, zFrom, zTo, { margin: 0.5 });
        this.scatter('glowBells', Math.round(length / 10), 3.7, 8, zFrom, zTo);
        this.scatter('rock', Math.round(length / 6), 4.5, 9, zFrom, zTo);
        this.scatter('leafLitter', Math.round(length / 3), 0, 8, zFrom, zTo, { margin: 0.5 });
        this.scatter('pebbles', Math.round(length / 4), 0, 2.8, zFrom, zTo, { margin: 0.3 });
        this.maybeArch(zFrom, zTo);
    }

    decorateRuins(zFrom, zTo, length) {
        // A colonnade along both sides, some fallen
        for (let z = zFrom - rand(1, 4); z > zTo; z -= 6) {
            for (const s of [-1, 1]) {
                this.stamp(Math.random() < 0.6 ? 'column' : 'brokenColumn', s * rand(5.2, 6.2), z,
                    { margin: 1.5, rotate: false });
            }
        }

        this.scatter('ruinBlocks', Math.round(length / 4), 4.5, 14, zFrom, zTo, { margin: 1.5 });
        if (Math.random() < 0.35) {
            const s = randomSide();
            const z = rand(zTo + 2, zFrom - 2);
            if (!this.overGap(z, 2)) {
                this.placeLater(getPrefab('stoneHead'), s * rand(9, 13), -0.6, z, s > 0 ? -1.2 : 1.2, rand(1, 1.4));
            }
        }

        this.jungleBands(zFrom, zTo, length, 7, 0.7);
        this.scatter('glowBells', Math.round(length / 6), 3.7, 10, zFrom, zTo);
        this.scatter('blossomPatch', Math.round(length / 5), 3.6, 10, zFrom, zTo, { margin: 0.5 });
    }

    decorateRiver(zFrom, zTo, length) {
        // In the water: reeds and lily pads either side of the boardwalk
        this.scatter('reeds', Math.round(length / 2), 4, 9.5, zFrom, zTo, { margin: -100, y: OPEN_WATER_Y });
        for (let i = 0; i < Math.round(length / 2); i++) {
            this.placeLater(getPrefab('lilyPads'), randomSide() * rand(3.8, 14), OPEN_WATER_Y + 0.02, rand(zTo, zFrom));
        }

        // On the banks: the jungle starts at 10 m out
        this.jungleBands(zFrom, zTo, length, 10.5, 0.9);
        this.scatter('heliconia', Math.round(length / 8), 10.5, 13, zFrom, zTo, { margin: -100 });
        this.scatter('blossomPatch', Math.round(length / 4), 10.5, 16, zFrom, zTo, { margin: -100 });
    }

    // Occasionally a vine slung over the path - but never right before a
    // ravine, where the swinging camera rises and would clip through it.
    maybeArch(zFrom, zTo) {
        if (Math.random() > 0.5) return;
        const z = rand(zTo + 6, zFrom - 2);
        const nearSwing = this.gaps.some((g) => z < g.start + 12 && z > g.end - 3);
        // The next chunk might open with a ravine, so stay clear of our end.
        if (nearSwing || z < this.zEnd + 10) return;
        this.objectLater(() => archVine(z));
    }

    // ---------------- GAMEPLAY ----------------

    buildGameplay() {
        const L = this.layout;
        const { collectibles } = this.world;

        // Ropes, each hung from something sturdy across the path
        L.ropes.forEach((r, i) => {
            const z = this.z(r.d);
            this.buildRopeAnchor(z, this.zoneAt(z));
            const rope = new Rope(this.group, new THREE.Vector3(0, ROPE_ANCHOR_HEIGHT, z), ROPE_LENGTH, i * 1.7 + z);
            this.ropes.push(rope);
        });

        for (const e of L.enemies) {
            const z = this.z(e.d);
            this.enemies.push(e.type === 'snapjaw'
                ? new Snapjaw(this.group, { x: e.x, z })
                : new Thornlash(this.group, { side: e.side, z, height: e.height, offset: e.offset }));
        }

        const pickups = L.coins.map((c) => ({ type: 'coin', x: c.x, y: c.y, z: this.z(c.d) }));
        if (L.relic) pickups.push({ type: 'relic', x: L.relic.x, y: L.relic.y, z: this.z(L.relic.d) });
        collectibles.spawn(pickups, this.group, this);
    }

    // Jungle/river: two big trees and a branch across. Ruins: a stone gateway.
    buildRopeAnchor(z, zone) {
        // A rope hanging over the MIDDLE of a ravine (the second rope of a
        // chain) has nothing beside it to stand on. Hang it from a long
        // diagonal branch between a tree on each cliff instead.
        const ravine = this.gaps.find((g) => g.surface === 'ground' && z < g.start && z > g.end);
        if (ravine) {
            this.buildDiagonalAnchor(z, zone, ravine);
            return;
        }

        if (zone.id !== 'ruins') {
            this.placeLater(getPrefab('tree'), -10, 0, z, rand(0, 6), 1.15);
            this.placeLater(getPrefab('tree'), 10, 0, z, rand(0, 6), 1.15);
        }
        this.objectLater(() => this.makeRopeAnchor(z, zone));
    }

    buildDiagonalAnchor(z, zone, gap) {
        // Symmetric about the rope, so the branch passes right above it,
        // with both ends safely back on solid ground.
        const reach = Math.max(gap.start + 1.5 - z, z - (gap.end - 1.5));
        const near = z + reach;
        const far = z - reach;

        if (zone.id !== 'ruins') {
            this.placeLater(getPrefab('tree'), -10, 0, near, rand(0, 6), 1.2);
            this.placeLater(getPrefab('tree'), 10, 0, far, rand(0, 6), 1.2);
        }

        this.objectLater(() => {
            const g = new THREE.Group();

            if (zone.id === 'ruins') {
                for (const [x, pz] of [[-6.5, near], [6.5, far]]) {
                    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 10.2, 1.3), SM.stone);
                    pillar.position.set(x, 5.1, pz);
                    pillar.castShadow = true;
                    g.add(pillar);
                }
                const beam = cylinderBetween(
                    new THREE.Vector3(-6.5, ROPE_ANCHOR_HEIGHT + 0.5, near),
                    new THREE.Vector3(6.5, ROPE_ANCHOR_HEIGHT + 0.5, far),
                    0.5, SM.stoneDark
                );
                g.add(beam);
            } else {
                g.add(cylinderBetween(
                    new THREE.Vector3(-9.6, ROPE_ANCHOR_HEIGHT + 0.5, near),
                    new THREE.Vector3(9.6, ROPE_ANCHOR_HEIGHT + 0.3, far),
                    0.45, SM.bark
                ));
            }
            return g;
        });
    }

    makeRopeAnchor(z, zone) {
        const g = new THREE.Group();

        if (zone.id === 'ruins') {
            for (const x of [-6, 6]) {
                const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.3, 9.8, 1.3), SM.stone);
                pillar.position.set(x, 4.9, z);
                pillar.castShadow = true;
                g.add(pillar);
            }
            const lintel = new THREE.Mesh(new THREE.BoxGeometry(13.5, 0.9, 1.2), SM.stoneDark);
            lintel.position.set(0, ROPE_ANCHOR_HEIGHT + 0.45, z);
            lintel.castShadow = true;
            g.add(lintel);
            return g;
        }

        g.add(cylinderBetween(
            new THREE.Vector3(-9.6, ROPE_ANCHOR_HEIGHT + 0.55, z),
            new THREE.Vector3(9.6, ROPE_ANCHOR_HEIGHT + 0.25, z),
            0.42, SM.bark
        ));
        for (let i = 0; i < 7; i++) {
            const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), SM.canopy[i % 2]);
            leaf.scale.set(0.45, 1.5, 0.3);
            leaf.position.set(rand(-1.1, 1.1), ROPE_ANCHOR_HEIGHT + 0.2 - rand(0, 0.6), z + rand(-0.2, 0.2));
            leaf.rotation.z = rand(-0.6, 0.6);
            g.add(leaf);
        }
        return g;
    }

    // ---------------- PER FRAME ----------------

    update(time) {
        if (this.foam.length) animateFoam(this.foam, time);
    }

    // ---------------- CLEAN UP ----------------

    dispose() {
        this.tasks.length = 0;      // drop unfinished work
        this.batcher.dispose();     // and any geometry it had gathered
        for (const rope of this.ropes) rope.dispose();
        for (const enemy of this.enemies) enemy.dispose();
        this.world.collectibles.removeOwner(this);

        this.group.traverse((o) => {
            if (!o.userData.owned) return;
            o.geometry?.dispose();
            if (o.userData.ownMap) o.material.map?.dispose();
            if (o.userData.ownMaterial) o.material.dispose();
        });
        for (const m of this.ownedMaterials ?? []) m.dispose();

        this.group.removeFromParent();
    }
}
