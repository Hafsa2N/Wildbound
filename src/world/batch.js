import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------- BATCHING ----------------
// THE single biggest performance idea in this project.
//
// Every Mesh is one "draw call": the CPU telling the GPU "draw this".
// Thousands of little meshes (leaves, petals, grass) = thousands of draw
// calls = slow, even though the GPU could easily draw all the triangles.
//
// So static scenery is MERGED: everything sharing a material becomes one
// big mesh. Same triangles, a handful of draw calls.
//
// For the endless world we go one step further:
//
//   PREFAB  - a plant/tree/rock built ONCE from many meshes, then
//             collapsed into one geometry per material ("parts").
//   BATCHER - a chunk of the world stamps prefabs at positions
//             (just copying + moving geometry), then merges each
//             material's parts into a single mesh.
//
// Building from prefabs is fast enough to do while the game runs.
//
// Swaying plants can't be moved on the CPU once merged, so the sway is
// done on the GPU: a few lines added to the vertex shader.
// Mark a builder's group with `userData.sway = 'grass' | 'plant' | 'canopy'`.

// Shared by every swaying material. Update .value each frame.
export const windUniforms = { uTime: { value: 0 } };

// How each kind of plant moves: speed, variation across the world, and
// how far it bends per metre of height.
const SWAY = {
    grass: { speed: 1.8, spread: 0.6, bend: 0.22 },
    plant: { speed: 1.1, spread: 0.3, bend: 0.05 },
    canopy: { speed: 0.7, spread: 0.1, bend: 0.012 }
};

// Only plain colour materials can be merged.
function canMerge(mesh) {
    const m = mesh.material;
    return (
        mesh.isMesh &&
        !mesh.isInstancedMesh &&
        !Array.isArray(m) &&
        m.isMeshStandardMaterial &&
        !m.map &&
        !m.transparent
    );
}

// VERTEX COLOURS: instead of one material per colour (5 canopy greens,
// 5 grass greens... each its own draw call), every vertex carries its own
// colour, and all of them share ONE material. So the colour is left OUT
// of the key below - only things that really need a different shader or
// setting split a batch.
//
// Roughness is rounded to steps of 0.2: nobody can see 0.9 vs 1.0 on a
// leaf, but every distinct value would be another draw call.
const roughnessStep = (r) => Math.round(r * 5) / 5;

function materialKey(m) {
    return [
        m.emissive.getHexString(),
        m.emissiveIntensity.toFixed(2),
        roughnessStep(m.roughness).toFixed(1),
        m.metalness.toFixed(2),
        m.side,
        m.flatShading
    ].join('|');
}

// One shared material per look, reused by every chunk. Without this cache
// each chunk would make its own copies - wasted memory and GPU state.
const materialCache = new Map();

function sharedMaterial(sample, sway) {
    const key = materialKey(sample) + '#' + (sway ?? '');

    if (!materialCache.has(key)) {
        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,   // the colour comes from each vertex
            emissive: sample.emissive,
            emissiveIntensity: sample.emissiveIntensity,
            roughness: roughnessStep(sample.roughness),
            metalness: sample.metalness,
            side: sample.side,
            flatShading: sample.flatShading
        });

        if (sway) addWind(material, SWAY[sway]);
        materialCache.set(key, material);
    }

    return materialCache.get(key);
}

// Every shared material made so far (used to pre-compile shaders).
export function sharedMaterials() {
    return [...materialCache.values()];
}

// Inject wind into the standard vertex shader. Batched geometry is in
// world space, so `position.y` is height above the ground: the higher a
// vertex, the further it bends. Roots stay put, tips wave.
function addWind(material, { speed, spread, bend }) {
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = windUniforms.uTime;

        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uTime;')
            .replace(
                '#include <begin_vertex>',
                `#include <begin_vertex>
                float wave = uTime * ${speed.toFixed(2)}
                           + position.x * ${spread.toFixed(2)}
                           + position.z * ${(spread * 0.8).toFixed(2)};
                float h = max(position.y, 0.0);
                transformed.x += sin(wave) * h * ${bend.toFixed(3)};
                transformed.z += cos(wave * 0.7) * h * ${(bend * 0.5).toFixed(3)};`
            );
    };

    material.customProgramCacheKey = () => `wind-${speed}-${spread}-${bend}`;
}

// Make a geometry mergeable with any other: moved into place, not
// indexed, with exactly position + normal + colour (painted with `color`).
function normalise(geometry, matrix, color) {
    let g = geometry.clone();
    if (matrix) g.applyMatrix4(matrix);

    for (const name of Object.keys(g.attributes)) {
        if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (g.index) g = g.toNonIndexed();
    if (!g.attributes.normal) g.computeVertexNormals();

    const count = g.attributes.position.count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return g;
}

// ---------------- PREFABS ----------------
// Collapse a built Group into "parts": one geometry per material look.
// Meshes that can't be merged (textured, transparent) are kept as-is.

export function makePrefab(root) {
    root.updateMatrixWorld(true);
    const parts = new Map();

    const visit = (object, sway) => {
        const mySway = object.userData.sway ?? sway;

        if (object.isMesh && canMerge(object)) {
            const key = [materialKey(object.material), mySway ?? '', object.castShadow].join('#');

            if (!parts.has(key)) {
                parts.set(key, {
                    geometries: [],
                    sample: object.material,
                    sway: mySway,
                    castShadow: object.castShadow
                });
            }
            parts.get(key).geometries.push(normalise(object.geometry, object.matrixWorld, object.material.color));
        }

        for (const child of object.children) visit(child, mySway);
    };

    visit(root, undefined);

    return [...parts.values()].map((part) => ({
        key: [materialKey(part.sample), part.sway ?? '', part.castShadow].join('#'),
        geometry: mergeGeometries(part.geometries),
        material: sharedMaterial(part.sample, part.sway),
        castShadow: part.castShadow
    }));
}

// ---------------- BATCHER ----------------

const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();

export class Batcher {
    constructor() {
        this.buckets = new Map(); // key -> { geometries, material, castShadow }
    }

    // Stamp a prefab at a position / rotation (around y) / scale.
    place(prefab, x, y, z, rotationY = 0, scale = 1) {
        _pos.set(x, y, z);
        _quat.setFromEuler(_euler.set(0, rotationY, 0));
        _scale.setScalar(scale);
        _matrix.compose(_pos, _quat, _scale);

        for (const part of prefab) {
            this.bucket(part.key, part.material, part.castShadow)
                .geometries.push(part.geometry.clone().applyMatrix4(_matrix));
        }
    }

    // Add a one-off built object (e.g. a branch made for this spot).
    addObject(object) {
        for (const part of makePrefab(object)) {
            this.bucket(part.key, part.material, part.castShadow).geometries.push(part.geometry);
        }
    }

    bucket(key, material, castShadow) {
        if (!this.buckets.has(key)) {
            this.buckets.set(key, { geometries: [], material, castShadow });
        }
        return this.buckets.get(key);
    }

    // Throw away gathered (not yet merged) geometry.
    dispose() {
        for (const bucket of this.buckets.values()) {
            for (const g of bucket.geometries) g.dispose();
        }
        this.buckets.clear();
    }

    // Merge each bucket into one mesh and add them all to `parent`.
    build(parent) {
        const meshes = [];

        for (const bucket of this.buckets.values()) {
            const mesh = new THREE.Mesh(mergeGeometries(bucket.geometries), bucket.material);

            for (const g of bucket.geometries) g.dispose();

            mesh.castShadow = bucket.castShadow;
            mesh.receiveShadow = true;
            mesh.matrixAutoUpdate = false; // never moves
            parent.add(mesh);
            meshes.push(mesh);
        }

        this.buckets.clear();
        return meshes;
    }
}
