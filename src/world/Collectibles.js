import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------- TUNING ----------------

const PICKUP_RADIUS = { coin: 1.1, relic: 0.95 }; // relics demand precision
const COLLECT_ANIM_TIME = { coin: 0.25, relic: 0.6 };

// ---------------- SHARED GEOMETRY & MATERIALS ----------------
// Built ONCE and shared by every item: 50 coins = 1 geometry, not 50.
// Materials are created in the constructor because they need the
// environment map (reflections), which needs the renderer.

// Coin: a disc standing upright (face along z), a raised rim and centre.
const coinDisc = new THREE.CylinderGeometry(0.26, 0.26, 0.05, 28).rotateX(Math.PI / 2);
// Rim and raised centre share a material, so they're one geometry (one draw).
const coinTrim = mergeGeometries([
    new THREE.TorusGeometry(0.255, 0.028, 8, 28).toNonIndexed(),
    new THREE.CylinderGeometry(0.13, 0.13, 0.075, 6).rotateX(Math.PI / 2).toNonIndexed()
]);

// Emerald Relic: a long six-sided crystal with pointed ends.
const crystalBody = new THREE.CylinderGeometry(0.2, 0.2, 0.42, 6);
const crystalTip = new THREE.ConeGeometry(0.2, 0.28, 6);
const relicBand = new THREE.TorusGeometry(0.215, 0.035, 8, 24).rotateX(Math.PI / 2);
const relicHalo = new THREE.SphereGeometry(0.75, 18, 12);
const relicBeam = new THREE.CylinderGeometry(0.06, 0.28, 7, 12, 1, true).translate(0, 3.5, 0);

function createMaterials(envMap) {
    return {
        gold: new THREE.MeshStandardMaterial({
            color: '#ffc531',
            emissive: '#7a4a00',
            emissiveIntensity: 0.35,
            metalness: 0.85,
            roughness: 0.28,
            envMap,              // without something to reflect, metal looks black
            envMapIntensity: 1.3
        }),
        goldDark: new THREE.MeshStandardMaterial({
            color: '#d99a12',
            emissive: '#5a3500',
            emissiveIntensity: 0.3,
            metalness: 0.85,
            roughness: 0.35,
            envMap
        }),
        emerald: new THREE.MeshStandardMaterial({
            color: '#19d27e',
            emissive: '#0a9a55',
            emissiveIntensity: 1.8,   // bright enough to trigger bloom
            metalness: 0.1,
            roughness: 0.08,
            flatShading: true,  // crisp facets
            envMap,
            envMapIntensity: 1.5
        }),
        halo: new THREE.MeshBasicMaterial({
            color: '#5dffb0',
            transparent: true,
            opacity: 0.16,
            depthWrite: false,
            blending: THREE.AdditiveBlending
        }),
        beam: new THREE.MeshBasicMaterial({
            color: '#5dffb0',
            transparent: true,
            opacity: 0.1,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending
        })
    };
}

function createRelicMesh(M) {
    const group = new THREE.Group();

    // The crystal spins inside; the beam stays put.
    const crystal = new THREE.Group();
    crystal.add(new THREE.Mesh(crystalBody, M.emerald));

    const top = new THREE.Mesh(crystalTip, M.emerald);
    top.position.y = 0.35;
    crystal.add(top);

    const bottom = new THREE.Mesh(crystalTip, M.emerald);
    bottom.position.y = -0.35;
    bottom.rotation.x = Math.PI;
    crystal.add(bottom);

    crystal.add(new THREE.Mesh(relicBand, M.gold));
    crystal.add(new THREE.Mesh(relicHalo, M.halo));
    group.add(crystal);

    // A faint beam of light rising from it, visible from far away -
    // so you can SEE a relic before you work out how to reach it.
    group.add(new THREE.Mesh(relicBeam, M.beam));

    group.userData.spinner = crystal;
    return group;
}

// ---------------- COIN INSTANCING ----------------
// There can be 60+ coins in view, each two meshes (disc + trim) - that
// was ~160 draw calls just for coins. An InstancedMesh draws MANY copies
// of one geometry in a single draw call: we just give it a list of
// positions/rotations (one matrix per copy). So all coins = 2 draw calls.
//
// Each coin owns a "slot" in that list. An unused slot is scaled to 0.

const MAX_COINS = 512;
const _matrix = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);

// A LIVE list of pickups. In the endless world, chunks add their coins
// and relics as they're built and take them away when they're removed.
export default class Collectibles {
    constructor(scene, envMap) {
        this.materials = createMaterials(envMap);
        this.items = [];
        this.counter = 0;

        this.discs = new THREE.InstancedMesh(coinDisc, this.materials.gold, MAX_COINS);
        this.trims = new THREE.InstancedMesh(coinTrim, this.materials.goldDark, MAX_COINS);
        this.discs.castShadow = true;

        for (const mesh of [this.discs, this.trims]) {
            // Copies are spread along the whole course, so never cull the batch.
            mesh.frustumCulled = false;
            mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); // updated every frame
            for (let i = 0; i < MAX_COINS; i++) mesh.setMatrixAt(i, HIDDEN);
            scene.add(mesh);
        }

        // Free slots, used like a stack.
        this.freeSlots = Array.from({ length: MAX_COINS }, (_, i) => MAX_COINS - 1 - i);
    }

    // Add pickups for a chunk. `layout` items are {type, x, y, z}.
    spawn(layout, parent, owner) {
        for (const data of layout) {
            const item = {
                ...data,
                owner,                           // which chunk it belongs to
                position: new THREE.Vector3(data.x, data.y, data.z),
                phase: (this.counter++) * 0.7,   // so they don't all bob in sync
                collected: false,
                anim: 0,                         // 0..1 progress of the pickup pop
                done: false                      // finished popping: invisible
            };

            if (data.type === 'relic') {
                item.mesh = createRelicMesh(this.materials);
                item.mesh.position.copy(item.position);
                item.spinner = item.mesh.userData.spinner;
                parent.add(item.mesh);
            } else {
                item.slot = this.freeSlots.pop();
                if (item.slot === undefined) continue; // full (never happens in practice)
            }

            this.items.push(item);
        }
    }

    // Forget every pickup owned by a removed chunk, freeing coin slots.
    // (Relic meshes go away with the chunk; their geometry is shared.)
    removeOwner(owner) {
        this.items = this.items.filter((item) => {
            if (item.owner !== owner) return true;
            this.release(item);
            return false;
        });
    }

    clear() {
        for (const item of this.items) this.release(item);
        this.items = [];
    }

    release(item) {
        if (item.slot === undefined) return;
        this.discs.setMatrixAt(item.slot, HIDDEN);
        this.trims.setMatrixAt(item.slot, HIDDEN);
        this.freeSlots.push(item.slot);
        this.markDirty();
    }

    markDirty() {
        this.discs.instanceMatrix.needsUpdate = true;
        this.trims.instanceMatrix.needsUpdate = true;
    }

    // `playerCenter` = middle of the player's body.
    // Calls onCollect(item) once for every item picked up this frame.
    update(dt, time, playerCenter, onCollect) {
        for (const item of this.items) {
            if (item.done) continue;

            let spin;
            let scale = 1;

            if (!item.collected) {
                // Idle: bob and spin, so it reads as "pick me up".
                item.position.y = item.y + Math.sin(time * 2.2 + item.phase) * 0.12;
                spin = time * (item.type === 'relic' ? 1.2 : 3) + item.phase;

                // Pickup is just a distance check. No physics engine needed.
                if (item.position.distanceTo(playerCenter) < PICKUP_RADIUS[item.type]) {
                    item.collected = true;
                    item.anim = 0;
                    onCollect(item);
                }
            } else {
                // Pop: swell, then shrink to nothing while rising and spinning.
                item.anim += dt / COLLECT_ANIM_TIME[item.type];
                const t = Math.min(item.anim, 1);
                scale = (1 + t * 0.9) * (1 - t);
                item.position.y += dt * 3;
                spin = time * 3 + item.phase + t * 12;
                if (t >= 1) item.done = true;
            }

            if (item.slot !== undefined) {
                // Coin: write this frame's matrix into its instance slot.
                _quat.setFromAxisAngle(_up, spin);
                _matrix.compose(item.position, _quat, _scale.setScalar(item.done ? 0 : scale));
                this.discs.setMatrixAt(item.slot, _matrix);
                this.trims.setMatrixAt(item.slot, _matrix);
            } else {
                item.mesh.position.copy(item.position);
                item.mesh.scale.setScalar(scale);
                item.spinner.rotation.y = spin;
                if (item.done) item.mesh.visible = false;
            }
        }

        this.markDirty();
    }
}
