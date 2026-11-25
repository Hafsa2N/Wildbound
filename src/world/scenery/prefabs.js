import * as THREE from 'three';
import { makePrefab } from '../batch.js';
import {
    heliconia, blossomPatch, glowBells, hangingVine, vineAlong
} from './flora.js';
import { rand, pick } from '../../utils/math.js';

// ---------------- SCENERY PREFABS ----------------
// Every builder here makes ONE thing at the origin (base at y = 0) out of
// simple shapes. getPrefab(name) builds a few random VARIANTS of it once,
// collapses each into merged parts (see batch.js), and hands one back at
// random. Chunks then stamp copies around - cheap, and no two trees match.


const mat = (color, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 1, ...extra });

// ---------------- MATERIALS ----------------

const M = {
    bark: mat('#67452d'),
    canopy: ['#194c2a', '#246333', '#347a39', '#438744', '#285b2b'].map((c) => mat(c)),
    farCanopy: ['#1d5632', '#2a6a3a', '#22603a'].map((c) => mat(c)),
    bush: ['#1c5530', '#24653a', '#2e7440', '#1a4a2b'].map((c) => mat(c)),
    leaf: ['#145d30', '#287d3e', '#4b984c'].map((c) => mat(c, { side: THREE.DoubleSide, roughness: 0.9 })),
    grass: ['#527b35', '#6c9140', '#42632d', '#829b4a', '#38572c'].map((c) => mat(c)),
    rock: mat('#656b53'),
    pebble: mat('#8b8066'),
    moss: ['#657b3b', '#788b48', '#536c35', '#899451'].map((c) => mat(c)),
    fallenLeaf: ['#a75b32', '#bd873b', '#718442', '#8b4930', '#b6a04e'].map((c) => mat(c, { side: THREE.DoubleSide })),
    // River
    reed: ['#8a9a4a', '#6f8a3a', '#a3a35a'].map((c) => mat(c)),
    reedHead: mat('#6b4a2a'),
    lily: ['#3f8f3a', '#4ea345', '#367d34'].map((c) => mat(c, { side: THREE.DoubleSide, roughness: 0.6 })),
    lilyFlower: mat('#ff9ec8', { roughness: 0.6 }),
    wood: mat('#7a5534', { roughness: 0.9 }),
    woodDark: mat('#5a3d24', { roughness: 0.9 }),
    // Ruins
    stone: mat('#8a8c7a', { roughness: 0.95 }),
    stoneDark: mat('#6c6f60', { roughness: 0.95 }),
    stoneMoss: mat('#5d7a3a'),
    runeGlow: mat('#9dffe2', { emissive: '#3dffc2', emissiveIntensity: 1.4 })
};

// ---------------- SHARED HELPERS ----------------

// A broad tropical leaf: a curved, pointed sheet.
function leafSheet(length, width) {
    const rows = 10;
    const cols = 6;
    const positions = [];
    const indices = [];

    for (let i = 0; i <= rows; i++) {
        const t = i / rows;
        const w = Math.sin(Math.PI * t) * width;
        for (let j = 0; j <= cols; j++) {
            const side = (j / cols) * 2 - 1;
            positions.push(side * w, length * t, 0.3 * Math.sin(Math.PI * t) - side * side * 0.12);
        }
    }
    for (let i = 0; i < rows; i++) {
        for (let j = 0; j < cols; j++) {
            const a = i * (cols + 1) + j;
            const b = a + cols + 1;
            indices.push(a, b, a + 1, b, b + 1, a + 1);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
}

function cylinderBetween(start, end, radius, material) {
    const direction = new THREE.Vector3().subVectors(end, start);
    const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.65, radius, direction.length(), 8),
        material
    );
    mesh.position.copy(start).add(end).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    mesh.castShadow = true;
    return mesh;
}

// ---------------- JUNGLE ----------------

// A big jungle tree: trunk, roots, branches, layered canopy.
function tree() {
    const group = new THREE.Group();

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.7, 9, 10), M.bark);
    trunk.position.y = 4.5;
    trunk.castShadow = true;
    group.add(trunk);

    for (let i = 0; i < 5; i++) {
        const a = i * 1.25 + rand(-0.2, 0.2);
        const root = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.22, 2, 6), M.bark);
        root.position.set(Math.cos(a) * 0.65, 0.35, Math.sin(a) * 0.65);
        root.rotation.set(Math.sin(a) * 0.7, 0, Math.cos(a) * 0.7);
        group.add(root);
    }

    for (let i = 0; i < 4; i++) {
        const a = i * 1.57 + rand(-0.3, 0.3);
        const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.24, 4, 6), M.bark);
        branch.position.set(Math.cos(a) * 1.5, 6.4 + i * 0.25, Math.sin(a) * 1.5);
        branch.rotation.set(Math.sin(a) * 0.65, 0, Math.cos(a) * 0.65);
        branch.castShadow = true;
        group.add(branch);
    }

    const canopy = new THREE.Group();
    canopy.userData.sway = 'canopy';
    group.add(canopy);

    for (let i = 0; i < 14; i++) {
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(1.2, 2.3), 1), pick(M.canopy));
        blob.position.set(rand(-2.5, 2.5), rand(7, 10), rand(-2, 2));
        blob.scale.y = rand(0.7, 1.2);
        blob.castShadow = true;
        canopy.add(blob);
    }

    return group;
}

// A cheaper tree for the far background: fewer, bigger blobs.
function farTree() {
    const group = new THREE.Group();

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.8, 10, 6), M.bark);
    trunk.position.y = 5;
    group.add(trunk);

    const canopy = new THREE.Group();
    canopy.userData.sway = 'canopy';
    group.add(canopy);

    for (let i = 0; i < 6; i++) {
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(2.2, 3.4), 1), pick(M.farCanopy));
        blob.position.set(rand(-2.5, 2.5), rand(8, 12), rand(-2.5, 2.5));
        blob.scale.y = rand(0.7, 1.1);
        canopy.add(blob);
    }

    return group;
}

// A dense leafy mound - the "jungle wall" that fills in beside the path.
function bush() {
    const group = new THREE.Group();
    group.userData.sway = 'plant';

    const count = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
        const r = rand(0.7, 1.4);
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), pick(M.bush));
        blob.position.set(rand(-1.4, 1.4), r * 0.6 + rand(0, 0.8), rand(-1.4, 1.4));
        blob.scale.y = rand(0.7, 1.0);
        blob.castShadow = true;
        group.add(blob);
    }

    return group;
}

// Big-leaf tropical plant (a fan of broad leaves).
function fern() {
    const group = new THREE.Group();
    group.userData.sway = 'plant';

    const count = 7 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
        const leaf = new THREE.Mesh(leafSheet(rand(1.5, 2.8), rand(0.35, 0.5)), M.leaf[i % 3]);
        leaf.rotation.y = (i / count) * Math.PI * 2;
        leaf.rotation.z = rand(-0.35, 0.35);
        leaf.position.y = 0.15;
        leaf.castShadow = true;
        group.add(leaf);
    }

    return group;
}

function grassTuft() {
    const group = new THREE.Group();
    group.userData.sway = 'grass';

    const blades = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < blades; i++) {
        const h = rand(0.2, 0.65);
        const blade = new THREE.Mesh(new THREE.ConeGeometry(rand(0.035, 0.06), h, 4), pick(M.grass));
        blade.position.set(rand(-0.1, 0.1), h / 2 - 0.07, rand(-0.1, 0.1));
        blade.rotation.z = rand(-0.2, 0.2);
        group.add(blade);
    }

    return group;
}

function rock() {
    const group = new THREE.Group();
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.3, 0.75), 1), M.rock);
    r.position.y = 0.15;
    r.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
    r.scale.y = rand(0.5, 1.2);
    r.castShadow = true;
    group.add(r);
    return group;
}

function pebbles() {
    const group = new THREE.Group();
    for (let i = 0; i < 4; i++) {
        const p = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.06, 0.18), 0), M.pebble);
        p.position.set(rand(-0.6, 0.6), 0.04, rand(-0.6, 0.6));
        p.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
        group.add(p);
    }
    return group;
}

function mossPatch() {
    const group = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CircleGeometry(rand(0.4, 1.1), 10), pick(M.moss));
    m.rotation.x = -Math.PI / 2;
    m.position.y = -0.04;
    group.add(m);
    return group;
}

function leafLitter() {
    const group = new THREE.Group();
    for (let i = 0; i < 5; i++) {
        const l = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 3), pick(M.fallenLeaf));
        l.scale.set(1.5, 0.12, 0.65);
        l.position.set(rand(-0.8, 0.8), -0.02, rand(-0.8, 0.8));
        l.rotation.y = rand(0, Math.PI);
        group.add(l);
    }
    return group;
}

// A vine draped down a cliff face from its top edge (y = 0), bulging
// out toward +z. Chunks turn it around for the opposite wall.
function cliffVine() {
    const length = rand(2, 5);
    const seed = rand(0, 10);
    const points = [];
    for (let k = 0; k <= 5; k++) {
        const t = k / 5;
        points.push(new THREE.Vector3(
            Math.sin(t * 4 + seed) * 0.15,
            0.05 - length * t,
            0.08 + Math.sin(t * Math.PI) * 0.12
        ));
    }
    return vineAlong(points, 0.04);
}

// ---------------- RIVER ----------------

function reeds() {
    const group = new THREE.Group();
    group.userData.sway = 'grass';

    const count = 6 + Math.floor(Math.random() * 6);
    for (let i = 0; i < count; i++) {
        const h = rand(0.9, 1.9);
        const x = rand(-0.4, 0.4);
        const z = rand(-0.4, 0.4);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.025, h, 4), pick(M.reed));
        stem.position.set(x, h / 2 - 0.3, z);
        stem.rotation.z = rand(-0.12, 0.12);
        group.add(stem);

        if (Math.random() < 0.4) {
            const head = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.18, 2, 6), M.reedHead);
            head.position.set(x, h - 0.25, z);
            group.add(head);
        }
    }

    return group;
}

function lilyPads() {
    const group = new THREE.Group();

    const count = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < count; i++) {
        const r = rand(0.3, 0.6);
        // A circle with a notch cut out
        const pad = new THREE.Mesh(new THREE.CircleGeometry(r, 14, 0.3, Math.PI * 2 - 0.3), pick(M.lily));
        pad.rotation.x = -Math.PI / 2;
        pad.rotation.z = rand(0, Math.PI * 2);
        pad.position.set(rand(-1, 1), 0.01, rand(-1, 1));
        group.add(pad);

        if (Math.random() < 0.3) {
            const flower = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.14, 6), M.lilyFlower);
            flower.position.set(pad.position.x, 0.08, pad.position.z);
            group.add(flower);
        }
    }

    return group;
}

// A 1 m length of boardwalk: planks across, with posts every few metres.
function boardwalkSection() {
    const group = new THREE.Group();

    for (let i = 0; i < 4; i++) {
        const plank = new THREE.Mesh(new THREE.BoxGeometry(7, 0.12, 0.23), Math.random() < 0.5 ? M.wood : M.woodDark);
        plank.position.set(rand(-0.05, 0.05), -0.06, -0.125 - i * 0.25);
        plank.rotation.y = rand(-0.02, 0.02);
        plank.receiveShadow = true;
        group.add(plank);
    }

    return group;
}

function boardwalkPosts() {
    const group = new THREE.Group();
    for (const x of [-3.3, 3.3]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 2.2, 7), M.woodDark);
        post.position.set(x, -1.0, 0);
        post.castShadow = true;
        group.add(post);
    }
    // Rope rail posts sticking up
    for (const x of [-3.4, 3.4]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.0, 6), M.wood);
        rail.position.set(x, 0.5, 0);
        group.add(rail);
    }
    return group;
}

// ---------------- RUINS ----------------

function column() {
    const group = new THREE.Group();
    const h = rand(4.5, 6.5);

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 1.3), M.stoneDark);
    base.position.y = 0.2;
    group.add(base);

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.5, h, 10), M.stone);
    shaft.position.y = 0.4 + h / 2;
    shaft.castShadow = true;
    group.add(shaft);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.4, 1.25), M.stoneDark);
    cap.position.y = 0.6 + h;
    cap.castShadow = true;
    group.add(cap);

    // Moss creeping up the shaft
    for (let i = 0; i < 4; i++) {
        const moss = new THREE.Mesh(new THREE.SphereGeometry(rand(0.2, 0.35), 6, 4), M.stoneMoss);
        const a = rand(0, Math.PI * 2);
        moss.position.set(Math.cos(a) * 0.45, rand(0.4, h * 0.6), Math.sin(a) * 0.45);
        moss.scale.set(1, 1.6, 0.5);
        group.add(moss);
    }

    return group;
}

function brokenColumn() {
    const group = new THREE.Group();
    const h = rand(1.2, 3);

    const base = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.4, 1.3), M.stoneDark);
    base.position.y = 0.2;
    group.add(base);

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.5, h, 10), M.stone);
    shaft.position.y = 0.4 + h / 2;
    shaft.rotation.z = rand(-0.05, 0.05);
    shaft.castShadow = true;
    group.add(shaft);

    // The fallen top lying beside it
    const fallen = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.45, rand(1.5, 2.5), 10), M.stone);
    fallen.rotation.z = Math.PI / 2;
    fallen.rotation.y = rand(0, Math.PI);
    fallen.position.set(rand(1, 1.6), 0.4, rand(-0.8, 0.8));
    fallen.castShadow = true;
    group.add(fallen);

    return group;
}

function ruinBlocks() {
    const group = new THREE.Group();
    const count = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
        const s = rand(0.6, 1.2);
        const block = new THREE.Mesh(new THREE.BoxGeometry(s * 1.4, s, s), Math.random() < 0.5 ? M.stone : M.stoneDark);
        block.position.set(rand(-1, 1), s / 2 + (i > 1 ? s : 0) * 0.9, rand(-1, 1));
        block.rotation.y = rand(0, Math.PI);
        block.castShadow = true;
        group.add(block);
    }
    return group;
}

// A weathered stone face half sunk in the ground, with glowing eyes -
// a hint that the temple world is coming.
function stoneHead() {
    const group = new THREE.Group();

    const head = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.6, 2), M.stone);
    head.position.y = 1.1;
    head.rotation.x = -0.08;
    head.castShadow = true;
    group.add(head);

    const brow = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.35, 0.4), M.stoneDark);
    brow.position.set(0, 1.85, 1.02);
    group.add(brow);

    for (const x of [-0.5, 0.5]) {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.18, 0.1), M.runeGlow);
        eye.position.set(x, 1.55, 1.03);
        group.add(eye);
    }

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.7, 0.35), M.stoneDark);
    nose.position.set(0, 1.0, 1.1);
    group.add(nose);

    const moss = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 5), M.stoneMoss);
    moss.position.set(0.3, 2.4, -0.2);
    moss.scale.set(1, 0.35, 1);
    group.add(moss);

    return group;
}

// ---------------- REGISTRY ----------------

const BUILDERS = {
    tree, farTree, bush, fern, grassTuft, rock, pebbles, mossPatch, leafLitter,
    heliconia, blossomPatch, glowBells, hangingVine, cliffVine,
    reeds, lilyPads, boardwalkSection, boardwalkPosts,
    column, brokenColumn, ruinBlocks, stoneHead
};

// How many random variants to pre-build of each.
const VARIANTS = {
    tree: 6, farTree: 4, bush: 5, fern: 4, grassTuft: 6, rock: 4, pebbles: 3,
    mossPatch: 4, leafLitter: 3, heliconia: 4, blossomPatch: 6, glowBells: 4,
    hangingVine: 5, cliffVine: 6, reeds: 4, lilyPads: 4, boardwalkSection: 3, boardwalkPosts: 1,
    column: 3, brokenColumn: 3, ruinBlocks: 3, stoneHead: 1
};

const cache = new Map();

export function getPrefab(name) {
    if (!cache.has(name)) {
        const variants = [];
        for (let i = 0; i < (VARIANTS[name] ?? 3); i++) {
            variants.push(makePrefab(BUILDERS[name]()));
        }
        cache.set(name, variants);
    }
    return pick(cache.get(name));
}

// Building every prefab takes a moment - do it up front (behind the
// title screen) so the first chunks don't stutter.
export function warmPrefabs() {
    for (const name of Object.keys(BUILDERS)) getPrefab(name);
}

export { cylinderBetween, M as SCENERY_MATERIALS };
