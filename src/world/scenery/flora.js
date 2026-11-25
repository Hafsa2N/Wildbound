import * as THREE from 'three';
import { rand, pick } from '../../utils/math.js';

// ---------------- FLORA ----------------
// Vines and flowers: the detail that makes the Emerald Jungle feel lush
// and gives it colour beyond green.
//
// Each builder makes ONE plant at the origin. prefabs.js turns them into
// merged prefabs that chunks stamp around (see batch.js) - that's why we
// can afford hundreds of little flowers.
//
// Colour rule: the jungle is green, so flowers use its OPPOSITES (reds,
// pinks, violets) to pop - and a few glowing bulbs give it a magical,
// "emerald" signature.

// ---------------- MATERIALS ----------------
// Created once and shared. (Batching merges by material anyway.)

const mat = (color, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

const M = {
    vine: mat('#3b5f26'),
    vineLeaf: mat('#2f7a31', { side: THREE.DoubleSide }),
    stalk: mat('#3d7a2b'),
    leaf: mat('#2a6e33', { side: THREE.DoubleSide }),
    heliconiaRed: mat('#e0322b', { roughness: 0.5 }),
    heliconiaTip: mat('#ffcf3a', { roughness: 0.5 }),
    petalPink: mat('#ff7eb6', { roughness: 0.6 }),
    petalWhite: mat('#fff3ee', { roughness: 0.6 }),
    petalViolet: mat('#b38cff', { roughness: 0.6 }),
    flowerCentre: mat('#ffd23f', { roughness: 0.5 }),
    // Emissive above 1 -> bloom makes these glow softly.
    glowBulb: mat('#9dffe2', {
        emissive: '#3dffc2',
        emissiveIntensity: 1.6,
        roughness: 0.3
    })
};

const PETALS = [M.petalPink, M.petalWhite, M.petalViolet];

// Shared geometries. Tiny things get very few triangles: a 7 cm petal
// looks the same as 24 triangles or 96, but 450 flowers x 5 petals adds up.
const leafGeometry = new THREE.SphereGeometry(1, 5, 3);   // scaled into leaf shapes
const petalGeometry = new THREE.SphereGeometry(0.07, 5, 3);
const centreGeometry = new THREE.SphereGeometry(0.045, 5, 3);
const bractGeometry = new THREE.ConeGeometry(0.07, 0.34, 6);
const tipGeometry = new THREE.SphereGeometry(0.045, 5, 3);
const bulbGeometry = new THREE.SphereGeometry(0.085, 10, 8);


// A small leaf: a squashed sphere.
function leaf(material, length, width) {
    const mesh = new THREE.Mesh(leafGeometry, material);
    mesh.scale.set(width, 0.02, length);
    return mesh;
}

// ---------------- VINES ----------------

// A vine following a list of points, with leaves dotted along it.
export function vineAlong(points, radius) {
    const group = new THREE.Group();
    group.userData.sway = 'canopy';
    const curve = new THREE.CatmullRomCurve3(points);

    const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, points.length * 4, radius, 5, false),
        M.vine
    );
    group.add(tube); // no shadow: too thin to notice, costs a shadow draw

    const length = curve.getLength();
    const leafCount = Math.floor(length / 0.55);

    for (let i = 1; i < leafCount; i++) {
        const p = curve.getPointAt(i / leafCount);
        const l = leaf(M.vineLeaf, rand(0.14, 0.24), rand(0.07, 0.11));
        l.position.copy(p);
        l.rotation.set(rand(-1, 1), rand(0, Math.PI * 2), rand(-1, 1));
        group.add(l);
    }

    return group;
}

// Hanging straight-ish down from the canopy, with a lazy wiggle.
export function hangingVine(x = 0, z = 0, top = rand(8.5, 10.5), length = rand(3.5, 7)) {
    const seed = Math.random() * 10;
    const points = [];

    for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        points.push(new THREE.Vector3(
            x + Math.sin(t * 3 + seed) * 0.3 * t,
            top - length * t,
            z + Math.cos(t * 2.5 + seed) * 0.3 * t
        ));
    }

    return vineAlong(points, rand(0.035, 0.06));
}

// A vine slung between two trees, sagging in the middle (an arch
// over the path), with a few short strands dangling from it.
export function archVine(z = 0) {
    const group = new THREE.Group();
    const leftY = rand(9.5, 11);
    const rightY = rand(9.5, 11);
    const sag = rand(1.8, 2.8);
    const points = [];

    for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const y = leftY + (rightY - leftY) * t - sag * (1 - (2 * t - 1) ** 2);
        points.push(new THREE.Vector3(-9 + 18 * t, y, z + Math.sin(t * Math.PI) * 0.6));
    }

    group.add(vineAlong(points, 0.07));

    // Dangling strands - kept high enough to clear the camera
    for (let i = 0; i < 4; i++) {
        const t = rand(0.15, 0.85);
        const y = leftY + (rightY - leftY) * t - sag * (1 - (2 * t - 1) ** 2);
        group.add(hangingVine(-9 + 18 * t, z + Math.sin(t * Math.PI) * 0.6, y, rand(0.8, 1.8)));
    }

    return group;
}

// ---------------- FLOWERS ----------------

// Heliconia ("lobster claw"): a zig-zag of bold red bracts with yellow
// tips on a tall stalk. A big, bright landmark plant.
export function heliconia(x = 0, z = 0) {
    const group = new THREE.Group();
    group.userData.sway = 'plant';
    const height = rand(1.1, 1.6);

    const stalk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.035, height, 6).translate(0, height / 2, 0),
        M.stalk
    );
    group.add(stalk);

    // Bracts alternate left/right down the top of the stalk
    const count = 6;
    for (let i = 0; i < count; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const y = height - i * 0.13;
        const size = 1 - i * 0.08;

        const bract = new THREE.Mesh(bractGeometry, M.heliconiaRed);
        bract.position.set(side * 0.1, y, 0);
        bract.rotation.z = -side * 1.15;
        bract.scale.setScalar(size);
        group.add(bract);

        const tip = new THREE.Mesh(tipGeometry, M.heliconiaTip);
        tip.position.set(side * 0.24 * size, y + 0.08 * size, 0);
        tip.scale.setScalar(size);
        group.add(tip);
    }

    // Long paddle leaves from the base
    for (let i = 0; i < 3; i++) {
        const l = leaf(M.leaf, rand(0.55, 0.8), 0.16);
        const a = rand(0, Math.PI * 2);
        l.position.set(Math.sin(a) * 0.35, rand(0.4, 0.7), Math.cos(a) * 0.35);
        l.rotation.set(0.6, a, 0);
        group.add(l);
    }

    group.position.set(x, 0, z);
    group.rotation.y = rand(0, Math.PI * 2);
    return group;
}

// A single five-petal flower on a short stem.
function blossom(material) {
    const group = new THREE.Group();
    const height = rand(0.15, 0.4);

    group.add(new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.014, height, 4).translate(0, height / 2, 0),
        M.stalk
    ));

    const head = new THREE.Group();
    head.position.y = height;
    head.rotation.set(rand(-0.4, 0.4), 0, rand(-0.4, 0.4));
    group.add(head);

    head.add(new THREE.Mesh(centreGeometry, M.flowerCentre));

    for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const petal = new THREE.Mesh(petalGeometry, material);
        petal.position.set(Math.cos(a) * 0.075, 0, Math.sin(a) * 0.075);
        petal.rotation.y = -a;
        petal.rotation.z = 0.35;  // tilt up, like a cup
        petal.scale.set(1, 0.25, 0.6);
        head.add(petal);
    }

    return group;
}

// A clump of blossoms of one colour.
export function blossomPatch(x = 0, z = 0) {
    const group = new THREE.Group();
    group.userData.sway = 'plant';
    const material = pick(PETALS);
    const count = 3 + Math.floor(Math.random() * 4);

    for (let i = 0; i < count; i++) {
        const flower = blossom(material);
        flower.position.set(rand(-0.4, 0.4), 0, rand(-0.4, 0.4));
        group.add(flower);
    }

    group.position.set(x, 0, z);
    return group;
}

// Glowing "emerald bells": drooping bulbs that softly light up.
// They're the Emerald Jungle's signature plant.
export function glowBells(x = 0, z = 0) {
    const group = new THREE.Group();
    group.userData.sway = 'plant';
    const count = 2 + Math.floor(Math.random() * 3);

    for (let i = 0; i < count; i++) {
        const height = rand(0.45, 0.95);
        const lean = rand(0.15, 0.45);
        const turn = rand(0, Math.PI * 2);

        // A curved stem built from a short curve, drooping at the top
        const points = [
            new THREE.Vector3(0, 0, 0),
            new THREE.Vector3(0, height * 0.6, 0),
            new THREE.Vector3(Math.sin(turn) * lean, height, Math.cos(turn) * lean),
            new THREE.Vector3(Math.sin(turn) * lean * 1.4, height - 0.12, Math.cos(turn) * lean * 1.4)
        ];
        const curve = new THREE.CatmullRomCurve3(points);

        group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 8, 0.015, 4, false), M.stalk));

        const bulb = new THREE.Mesh(bulbGeometry, M.glowBulb);
        bulb.position.copy(points[3]).add(new THREE.Vector3(0, -0.06, 0));
        bulb.scale.set(1, 1.35, 1);
        group.add(bulb);
    }

    group.position.set(x + rand(-0.3, 0.3), 0, z + rand(-0.3, 0.3));
    return group;
}

