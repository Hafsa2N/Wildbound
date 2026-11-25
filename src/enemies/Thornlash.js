import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { smoothstep } from '../utils/math.js';

// ---------------- THORNLASH ----------------
// A thorny vine rooted beside the path. Unlike Snapjaw it doesn't react
// to you - it runs on a RHYTHM you learn and time:
//
//   rest ──> rise ──> windup ──> sweep ──> lift ──> return ──> lower ──> rest
//
//   TELL      'rise' + 'windup': it rears up high over the path,
//             aims, shakes, and its thorns glow red
//   COUNTER   low lash  -> jump over it
//             high lash -> slide under it (or jump very well)
//   PUNISH    caught in the sweep: lose a heart, knocked aside
//   TOOL      once it has LIFTED (thorns turn green), jump into the vine
//             and it flings you up and forward
//
// Only the fast whip ACROSS is dangerous. Up high it can't touch you,
// and it sweeps a narrow fan, so each lash guards one clear stretch.

// ---------------- TUNING ----------------

const TIMELINE = [            // [phase, seconds]
    ['rest', 1.3],
    ['rise', 0.45],
    ['windup', 0.7],
    ['sweep', 0.3],
    ['lift', 0.25],
    ['return', 0.8],
    ['lower', 0.35]
];
const CYCLE = TIMELINE.reduce((sum, [, s]) => sum + s, 0);

const HEIGHTS = { low: 0.45, high: 1.15 };
const LIFTED = 2.9;           // above even a standing lemur
const RESTING = 0.15;         // lying on the ground beside the path
const FAN = 0.3;              // sweep ±0.3 rad (~17°) around "straight across"
const PIVOT_OFFSET = 4.6;     // root distance from the path centre
const SEGMENTS = 10;
const SEGMENT_LENGTH = 0.82;  // total reach ~8 m: right across the path
const HIT_DISTANCE = 0.5;     // how close the vine must pass to the body
const FLING_UP = 13.5;        // m/s upward when it flings you
const FLING_FORWARD = 5;      // m/s forward
const HAND_REACH = 1.7;       // hands are this far above the feet
const DANGER = new THREE.Color('#ff2a00');
const SAFE = new THREE.Color('#5dff9a');

// ---------------- SHARED GEOMETRY & MATERIALS ----------------

const vineMaterial = new THREE.MeshStandardMaterial({ color: '#4d6b22', roughness: 0.8 });
const moundMaterial = new THREE.MeshStandardMaterial({ color: '#4a3524', roughness: 1 });
const leafMaterial = new THREE.MeshStandardMaterial({ color: '#2f6e2a', roughness: 0.8 });

// Each segment lies along +z from its joint.
const segmentGeometry = new THREE.CylinderGeometry(0.1, 0.13, SEGMENT_LENGTH, 8)
    .rotateX(Math.PI / 2)
    .translate(0, 0, SEGMENT_LENGTH / 2);
const thornGeometry = new THREE.ConeGeometry(0.05, 0.24, 5);
const moundGeometry = new THREE.SphereGeometry(0.6, 12, 8);
const leafGeometry = new THREE.SphereGeometry(0.4, 10, 6);
const budGeometry = new THREE.IcosahedronGeometry(0.24, 0);


export default class Thornlash {
    // side: -1 = left of the path, 1 = right. height: 'low' | 'high'
    // `parent` is what it lives in (a chunk of the world).
    constructor(parent, { side, z, height = 'low', offset = 0 }) {
        this.side = side;
        this.height = HEIGHTS[height];
        this.offset = offset;  // start the rhythm at a different point
        this.pivot = new THREE.Vector3(side * PIVOT_OFFSET, 0, z);

        // Angles (rotation about y). At rest the vine lies along +z beside
        // the path, harmless. It sweeps a narrow fan across the path,
        // centred on "straight across" (-side * 90°).
        const across = -side * Math.PI / 2;
        this.restYaw = 0;
        this.startYaw = across + side * FAN;           // slightly back
        this.windupYaw = across + side * (FAN + 0.04); // a tiny pull back (it mostly shakes)
        this.endYaw = across - side * FAN;             // slightly forward

        // Own thorn material per vine, so it can glow on its own.
        this.thornMaterial = new THREE.MeshStandardMaterial({
            color: '#7a1f1f',
            emissive: '#ff2a00',
            emissiveIntensity: 0,
            roughness: 0.5
        });

        this.root = new THREE.Group();
        this.root.position.copy(this.pivot);
        this.ownGeometries = []; // made just for this vine: freed on dispose()
        this.build();
        parent.add(this.root);

        this.reset();
    }

    build() {
        const mound = new THREE.Mesh(moundGeometry, moundMaterial);
        mound.scale.set(1, 0.55, 1);
        mound.castShadow = true;
        this.root.add(mound);

        this.leaves = [];
        for (let i = 0; i < 5; i++) {
            const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
            const a = (i / 5) * Math.PI * 2;
            leaf.scale.set(0.3, 0.9, 0.12);
            leaf.position.set(Math.sin(a) * 0.4, 0.45, Math.cos(a) * 0.4);
            leaf.rotation.set(Math.cos(a) * 0.5, a, -Math.sin(a) * 0.5);
            this.root.add(leaf);
            this.leaves.push(leaf);
        }

        // `arm` raises/lowers and turns; the segments ripple inside it.
        this.arm = new THREE.Group();
        this.root.add(this.arm);

        this.joints = [];
        let parent = this.arm;

        for (let i = 0; i < SEGMENTS; i++) {
            const joint = new THREE.Group();
            if (i > 0) joint.position.z = SEGMENT_LENGTH;

            const segment = new THREE.Mesh(segmentGeometry, vineMaterial);
            segment.castShadow = true;
            joint.add(segment);

            // Thorns sticking out in alternating directions, merged into
            // one mesh per segment (one draw call instead of three).
            const thorns = [];
            const place = new THREE.Object3D();
            for (let j = 0; j < 3; j++) {
                const a = j * 2.1 + i;
                place.position.set(Math.cos(a) * 0.13, Math.sin(a) * 0.13, 0.2 + j * 0.25);
                place.rotation.set(Math.sin(a) * 1.4, 0, -Math.cos(a) * 1.4);
                place.updateMatrix();
                thorns.push(thornGeometry.clone().applyMatrix4(place.matrix));
            }
            const mergedThorns = mergeGeometries(thorns);
            this.ownGeometries.push(mergedThorns);
            joint.add(new THREE.Mesh(mergedThorns, this.thornMaterial));

            parent.add(joint);
            parent = joint;
            this.joints.push(joint);
        }

        const bud = new THREE.Mesh(budGeometry, this.thornMaterial);
        bud.position.z = SEGMENT_LENGTH;
        parent.add(bud);
    }

    reset() {
        this.time = this.offset;
        this.flung = false;
    }

    // Which phase are we in, and how far through it (0..1)?
    phaseAt(t) {
        let local = ((t % CYCLE) + CYCLE) % CYCLE;

        for (const [name, duration] of TIMELINE) {
            if (local < duration) return { name, t: local / duration };
            local -= duration;
        }
        return { name: 'rest', t: 0 };
    }

    // Returns the point the hit came from, or null.
    update(dt, time, player) {
        this.time += dt;
        const phase = this.phaseAt(this.time);

        let yaw = this.restYaw;
        let y = RESTING;
        let glow = 0;
        let shake = 0;

        switch (phase.name) {
            case 'rise':
                // Rear up high and swing over to aim across the path.
                yaw = this.restYaw + (this.startYaw - this.restYaw) * smoothstep(phase.t);
                y = RESTING + (LIFTED - RESTING) * smoothstep(phase.t);
                glow = phase.t;
                break;
            case 'windup':
                yaw = this.startYaw + (this.windupYaw - this.startYaw) * smoothstep(phase.t);
                y = LIFTED;
                glow = 1 + 1.5 * phase.t;
                shake = phase.t;
                break;
            case 'sweep': {
                // Drop to its strike height fast, then whip across.
                // t² = it ACCELERATES: a whip, not a door.
                const drop = Math.min(phase.t / 0.25, 1);
                y = LIFTED + (this.height - LIFTED) * smoothstep(drop);
                yaw = this.windupYaw + (this.endYaw - this.windupYaw) * phase.t * phase.t;
                glow = 2.5;
                break;
            }
            case 'lift':
                yaw = this.endYaw;
                y = this.height + (LIFTED - this.height) * smoothstep(phase.t);
                glow = 2.5 * (1 - phase.t);
                break;
            case 'return':
                yaw = this.endYaw + (this.restYaw - this.endYaw) * smoothstep(phase.t);
                y = LIFTED;
                break;
            case 'lower':
                y = LIFTED + (RESTING - LIFTED) * smoothstep(phase.t);
                break;
        }
        // While lifted it's harmless - and usable. Thorns glow GREEN then
        // ("tool"), RED while winding up and sweeping ("danger").
        const lifted = (phase.name === 'lift' && phase.t > 0.3) || phase.name === 'return';
        this.thornMaterial.emissive.copy(lifted ? SAFE : DANGER);
        if (lifted) glow = 1.6;
        if (phase.name === 'rest') this.flung = false; // ready for the next cycle

        this.arm.rotation.y = yaw + Math.sin(time * 50) * 0.04 * shake;
        this.arm.position.y = y;
        this.thornMaterial.emissiveIntensity = glow;

        // A ripple travels down the vine (each joint a bit behind the last).
        const whip = phase.name === 'sweep' ? 0.12 : 0.04;
        this.joints.forEach((joint, i) => {
            joint.rotation.y = Math.sin(time * 4 - i * 0.6) * whip * this.side;
            joint.rotation.x = Math.sin(time * 3 - i * 0.5) * 0.02;
        });

        // Leaves on the mound rustle during the windup (a second tell).
        this.leaves.forEach((leaf, i) => {
            leaf.rotation.y += Math.sin(time * 40 + i) * 0.02 * shake;
        });

        if (phase.name === 'sweep' && this.touches(player, yaw, y)) {
            return this.pivot.clone();
        }

        // Tool: jump up into the lifted vine and it flings you.
        if (lifted && !this.flung && !player.onGround) {
            const hands = player.position.y + HAND_REACH;
            // Generous on purpose: the vine is moving, and a near-miss feels unfair.
            if (Math.abs(hands - y) < 0.9 && this.distanceTo(player, yaw) < 1.0) {
                this.flung = true;
                player.launch(FLING_UP, FLING_FORWARD, 'fling');
            }
        }

        return null;
    }

    // Remove from the world and free what this vine made for itself.
    dispose() {
        this.root.removeFromParent();
        this.thornMaterial.dispose();
        for (const g of this.ownGeometries) g.dispose();
    }

    // Is the vine (a straight line from the root at height y, pointing
    // along `yaw`) touching the player's body?
    touches(player, yaw, y) {
        // Vertical overlap: is the vine between the feet and the head?
        const feet = player.position.y;
        if (y < feet - 0.1 || y > feet + player.bodyHeight) return false;

        return this.distanceTo(player, yaw) < HIT_DISTANCE;
    }

    // Horizontal distance from the player to the vine's line.
    distanceTo(player, yaw) {
        const dirX = Math.sin(yaw);
        const dirZ = Math.cos(yaw);
        const px = player.position.x - this.pivot.x;
        const pz = player.position.z - this.pivot.z;

        const reach = SEGMENTS * SEGMENT_LENGTH;
        const along = THREE.MathUtils.clamp(px * dirX + pz * dirZ, 0, reach);
        return Math.hypot(px - dirX * along, pz - dirZ * along);
    }
}
