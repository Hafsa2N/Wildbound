import * as THREE from 'three';
import { ease, damp } from '../utils/math.js';

// ---------------- THE LEMUR ----------------
// WILDBOUND's hero: a ring-tailed lemur in an emerald bandana.
// Built from simple shapes arranged as a HIERARCHY of joints:
//
//   root
//    └─ hips ─┬─ hipL ── kneeL ── (foot)
//             ├─ hipR ── kneeR ── (foot)
//             ├─ tail0 ── tail1 ── ... ── tail11   (a chain!)
//             └─ torso ─┬─ shoulderL ── elbowL ── (hand)
//                       ├─ shoulderR ── elbowR ── (hand)
//                       ├─ head (mask, eyes, ears)
//                       └─ bandana, satchel
//
// Rotating a joint moves everything below it. Animation is just
// "set each joint's angle every frame" - which is all a skeleton is.
//
// Angle conventions (the model faces +z):
//   limb.rotation.x > 0  swings a hanging limb BACKWARD
//   torso.rotation.x > 0 leans FORWARD

// ---------------- PROPORTIONS ----------------

const THIGH = 0.3;
const SHIN = 0.3;
const UPPER_ARM = 0.24;
const FOREARM = 0.22;
const HIP_Y = THIGH + SHIN + 0.06;   // foot soles touch y = 0
const TORSO_Y = 0.05;
const SHOULDER_Y = 0.38;
const SHOULDER_X = 0.2;
const ARM_REACH = UPPER_ARM + FOREARM + 0.05;

const TAIL_SEGMENTS = 12;
const TAIL_SEGMENT_LENGTH = 0.13;

// Arms angled inward so both hands meet above the head on the rope.
const GRIP_TILT = Math.asin(SHOULDER_X / ARM_REACH);

// How high the hands are when gripping a rope overhead.
// The Player uses this to line the hands up with the rope's knot.
export const HANDS_UP_HEIGHT =
    HIP_Y + TORSO_Y + SHOULDER_Y + ARM_REACH * Math.cos(GRIP_TILT);

// ---------------- MATERIALS ----------------

const material = (color, roughness = 0.85) =>
    new THREE.MeshStandardMaterial({ color, roughness });

const M = {
    fur: material('#9b8f86'),       // warm grey, so the green light doesn't tint it
    furLight: material('#d1c6bb'),
    belly: material('#f3efe6'),
    dark: material('#26262b'),
    ringWhite: material('#f2efe8'),
    eye: new THREE.MeshStandardMaterial({
        color: '#ffb000',
        emissive: '#7a4500',
        emissiveIntensity: 0.4,
        roughness: 0.25
    }),
    pupil: material('#111111', 0.2),
    bandana: material('#18a864', 0.7),  // Emerald Jungle green
    satchel: material('#7a4f2c'),
    strap: material('#4a2f1a')
};

// A capsule whose pivot is at its TOP joint, hanging down -y.
// The next joint then sits at y = -length.
function limbGeometry(radius, length) {
    return new THREE.CapsuleGeometry(radius, length, 4, 10)
        .translate(0, -length / 2, 0);
}

function part(geometry, mat, x = 0, y = 0, z = 0) {
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    return mesh;
}

// Ease `current` toward `target` at a frame-rate independent rate.

export default class Lemur {
    constructor() {
        this.root = new THREE.Group();

        this.time = 0;
        this.runPhase = 0;
        this.blinkTimer = 2;

        this.buildLegs();
        this.buildTail();
        this.buildTorso();

        // Joint angles we animate, eased toward targets every frame.
        this.joints = {
            hipL: this.hipL.rotation, hipR: this.hipR.rotation,
            kneeL: this.kneeL.rotation, kneeR: this.kneeR.rotation,
            shoulderL: this.shoulderL.rotation, shoulderR: this.shoulderR.rotation,
            elbowL: this.elbowL.rotation, elbowR: this.elbowR.rotation,
            torso: this.torso.rotation, head: this.head.rotation,
            bandanaTail: this.bandanaTail.rotation
        };
    }

    // ---------------- BUILD ----------------

    buildLegs() {
        this.hips = new THREE.Group();
        this.hips.position.y = HIP_Y;
        this.root.add(this.hips);

        // Round rump
        const rump = part(new THREE.SphereGeometry(0.2, 14, 10), M.fur, 0, 0, -0.02);
        rump.scale.set(1, 0.85, 1);
        this.hips.add(rump);

        const thighGeo = limbGeometry(0.085, THIGH);
        const shinGeo = limbGeometry(0.06, SHIN);
        const footGeo = new THREE.BoxGeometry(0.1, 0.06, 0.22);

        for (const side of [1, -1]) {
            const hip = new THREE.Group();
            hip.position.x = side * 0.11;
            hip.add(part(thighGeo, M.fur));

            const knee = new THREE.Group();
            knee.position.y = -THIGH;
            knee.add(part(shinGeo, M.furLight));
            knee.add(part(footGeo, M.dark, 0, -SHIN - 0.02, 0.05));
            hip.add(knee);

            this.hips.add(hip);

            if (side === 1) { this.hipL = hip; this.kneeL = knee; }
            else { this.hipR = hip; this.kneeR = knee; }
        }
    }

    // The signature tail: a chain of joints, each a child of the last,
    // so small rotations add up into a long curve. Black and white rings.
    buildTail() {
        this.tail = [];

        let parent = this.hips;

        for (let i = 0; i < TAIL_SEGMENTS; i++) {
            const joint = new THREE.Group();

            if (i === 0) joint.position.set(0, 0.02, -0.18);
            else joint.position.y = TAIL_SEGMENT_LENGTH;

            const t = i / TAIL_SEGMENTS;
            const radius = 0.075 - t * 0.035;

            joint.add(part(
                new THREE.CylinderGeometry(radius * 0.92, radius, TAIL_SEGMENT_LENGTH * 1.08, 10)
                    .translate(0, TAIL_SEGMENT_LENGTH / 2, 0),
                i % 2 === 0 ? M.dark : M.ringWhite
            ));

            parent.add(joint);
            parent = joint;
            this.tail.push(joint);
        }

        // Rounded black tip
        parent.add(part(new THREE.SphereGeometry(0.042, 10, 8), M.dark, 0, TAIL_SEGMENT_LENGTH, 0));
    }

    buildTorso() {
        const torso = new THREE.Group();
        torso.position.y = TORSO_Y;
        this.hips.add(torso);
        this.torso = torso;

        // Pear-shaped body with a pale belly
        const chest = part(new THREE.CapsuleGeometry(0.19, 0.22, 4, 12), M.fur, 0, 0.2, 0);
        chest.scale.z = 0.85;
        torso.add(chest);

        const belly = part(new THREE.SphereGeometry(0.16, 12, 10), M.belly, 0, 0.17, 0.1);
        belly.scale.set(0.95, 1.3, 0.6);
        torso.add(belly);

        this.buildSatchel(torso);
        this.buildArms(torso);
        this.buildHead(torso);
        this.buildBandana(torso);
    }

    buildSatchel(torso) {
        // Diagonal strap across the chest, bag on the hip
        const strap = part(new THREE.BoxGeometry(0.04, 0.5, 0.025), M.strap, 0, 0.2, 0.16);
        strap.rotation.z = 0.7;
        torso.add(strap);

        const backStrap = part(new THREE.BoxGeometry(0.04, 0.5, 0.025), M.strap, 0, 0.2, -0.16);
        backStrap.rotation.z = 0.7;
        torso.add(backStrap);

        torso.add(part(new THREE.BoxGeometry(0.16, 0.14, 0.09), M.satchel, -0.2, 0.02, 0.04));
    }

    buildArms(torso) {
        const upperGeo = limbGeometry(0.058, UPPER_ARM);
        const foreGeo = limbGeometry(0.048, FOREARM);
        const handGeo = new THREE.SphereGeometry(0.058, 10, 8);

        for (const side of [1, -1]) {
            const shoulder = new THREE.Group();
            shoulder.position.set(side * SHOULDER_X, SHOULDER_Y, 0);
            shoulder.add(part(upperGeo, M.fur));

            const elbow = new THREE.Group();
            elbow.position.y = -UPPER_ARM;
            elbow.add(part(foreGeo, M.furLight));
            elbow.add(part(handGeo, M.dark, 0, -FOREARM - 0.04, 0));
            shoulder.add(elbow);

            torso.add(shoulder);

            if (side === 1) { this.shoulderL = shoulder; this.elbowL = elbow; }
            else { this.shoulderR = shoulder; this.elbowR = elbow; }
        }
    }

    buildHead(torso) {
        const head = new THREE.Group();
        head.position.y = 0.48;
        torso.add(head);
        this.head = head;

        // Big round head (cute = big head, big eyes)
        const skull = part(new THREE.SphereGeometry(0.2, 18, 14), M.furLight, 0, 0.16, 0);
        skull.scale.set(1, 0.92, 0.95);
        head.add(skull);

        // White face disc
        const face = part(new THREE.SphereGeometry(0.17, 16, 12), M.belly, 0, 0.14, 0.1);
        face.scale.set(1, 0.95, 0.6);
        head.add(face);

        // Black snout pointing forward
        const snout = part(new THREE.ConeGeometry(0.075, 0.18, 12), M.dark, 0, 0.09, 0.2);
        snout.rotation.x = Math.PI / 2;
        head.add(snout);
        head.add(part(new THREE.SphereGeometry(0.03, 8, 6), M.pupil, 0, 0.09, 0.29));

        // Dark eye patches, big amber eyes
        const patchGeo = new THREE.SphereGeometry(0.06, 10, 8);
        const eyeGeo = new THREE.SphereGeometry(0.042, 12, 10);
        const pupilGeo = new THREE.SphereGeometry(0.02, 8, 6);

        this.eyes = [1, -1].map((side) => {
            const patch = part(patchGeo, M.dark, side * 0.075, 0.18, 0.17);
            patch.scale.set(1.1, 1.15, 0.5);
            head.add(patch);

            const eye = new THREE.Group();
            eye.position.set(side * 0.075, 0.185, 0.19);
            eye.add(part(eyeGeo, M.eye));
            eye.add(part(pupilGeo, M.pupil, 0, 0, 0.032));
            head.add(eye);
            return eye;
        });

        // Pointed ears, angled outward
        const earGeo = new THREE.ConeGeometry(0.065, 0.14, 8);

        for (const side of [1, -1]) {
            const ear = part(earGeo, M.fur, side * 0.15, 0.32, -0.02);
            ear.rotation.z = -side * 0.5;
            head.add(ear);
        }
    }

    buildBandana(torso) {
        const ring = part(new THREE.TorusGeometry(0.13, 0.045, 8, 18), M.bandana, 0, 0.46, 0);
        ring.rotation.x = Math.PI / 2;
        torso.add(ring);

        // A knot tail that flutters with speed.
        this.bandanaTail = new THREE.Group();
        this.bandanaTail.position.set(0.05, 0.46, -0.12);
        this.bandanaTail.add(part(
            new THREE.BoxGeometry(0.08, 0.22, 0.025).translate(0, -0.11, 0),
            M.bandana
        ));
        torso.add(this.bandanaTail);
    }

    // ---------------- ANIMATE ----------------
    // info: { state, speed, verticalSpeed, swingSpeed, gripDrop }

    update(dt, info) {
        this.time += dt;
        const t = this.time;
        const pose = this.computePose(t, dt, info);

        // Blend toward the pose (fast enough to feel responsive,
        // smooth enough that state changes don't snap).
        const k = damp(16, dt);

        for (const [name, target] of Object.entries(pose)) {
            const rotation = this.joints[name];
            rotation.x = ease(rotation.x, target.x ?? 0, k);
            rotation.y = ease(rotation.y, target.y ?? 0, k);
            rotation.z = ease(rotation.z, target.z ?? 0, k);
        }

        this.animateTail(t, dt, info);

        // While gripping, shift the body so the hands sit on the rope knot.
        // While sliding, drop low to the ground.
        const targetShift =
            info.state === 'swing' ? info.gripDrop :
            info.state === 'slide' ? -0.42 : 0;
        this.root.position.y = ease(this.root.position.y, targetShift, k);

        this.blink(dt);
    }

    // The tail curls up into a question mark when relaxed and streams
    // out behind when moving fast. A wave travels from base to tip:
    // each segment uses the same sine, slightly DELAYED (- i * 0.45).
    // That delay is what makes it look like it has weight.
    animateTail(t, dt, { state, speed, swingSpeed }) {
        const run = Math.min(speed / 7, 1);
        const airborne = state === 'jump' || state === 'fall';

        // Base points backward and down; each segment curls upward.
        const baseAngle = -1.75 - run * 0.25;
        const curl = airborne ? 0.12 : 0.22 - run * 0.12;
        const waveSpeed = 3 + run * 6;
        const waveSize = 0.06 + run * 0.08;
        const swingPush = state === 'swing'
            ? THREE.MathUtils.clamp(swingSpeed * 0.02, -0.12, 0.12)
            : 0;

        const k = damp(10, dt);

        this.tail.forEach((joint, i) => {
            const wave = Math.sin(t * waveSpeed - i * 0.45);
            const targetX = (i === 0 ? baseAngle : curl + swingPush) + wave * waveSize;
            const targetZ = Math.sin(t * 1.3 - i * 0.35) * 0.05;

            joint.rotation.x = ease(joint.rotation.x, targetX, k);
            joint.rotation.z = ease(joint.rotation.z, targetZ, k);
        });
    }

    computePose(t, dt, { state, speed, verticalSpeed, swingSpeed }) {
        const run = Math.min(speed / 7, 1); // 0..1 how hard we're running
        const flap = 0.25 + run * 0.9 + Math.sin(t * 14) * 0.12 * run;

        if (state === 'swing') {
            // Both arms up, hands together on the rope.
            // Legs trail behind the direction of travel.
            const trail = THREE.MathUtils.clamp(swingSpeed * 0.06, -0.5, 0.5);
            return {
                shoulderL: { x: Math.PI, z: -GRIP_TILT },
                shoulderR: { x: Math.PI, z: GRIP_TILT },
                elbowL: {}, elbowR: {},
                hipL: { x: -0.25 + trail }, hipR: { x: 0.05 + trail },
                kneeL: { x: 0.6 }, kneeR: { x: 0.4 },
                torso: {}, head: { x: -0.25 },
                bandanaTail: { x: 0.4 + Math.abs(trail) * 1.5 }
            };
        }

        if (state === 'slide') {
            // Feet-first slide: legs out front, leaning back, arms trailing.
            return {
                hipL: { x: -1.45 }, kneeL: { x: 0.15 },
                hipR: { x: -1.2 }, kneeR: { x: 0.5 },
                shoulderL: { x: 0.9, z: -0.5 }, shoulderR: { x: 0.9, z: 0.5 },
                elbowL: { x: -0.3 }, elbowR: { x: -0.3 },
                torso: { x: -0.75 }, head: { x: 0.45 },
                bandanaTail: { x: 1.6 }
            };
        }

        if (state === 'jump') {
            // A lemur leap: legs tucked, arms flung forward.
            return {
                hipL: { x: -1.2 }, kneeL: { x: 1.6 },
                hipR: { x: -0.7 }, kneeR: { x: 1.3 },
                shoulderL: { x: -2.4, z: -0.3 }, shoulderR: { x: -2.4, z: 0.3 },
                elbowL: { x: -0.2 }, elbowR: { x: -0.2 },
                torso: { x: 0.25 }, head: { x: -0.2 },
                bandanaTail: { x: 1.2 }
            };
        }

        if (state === 'fall') {
            // Arms out for balance, feet reaching for the ground.
            const flail = Math.sin(t * 11) * 0.25;
            const panic = verticalSpeed < -12 ? 1 : 0.4;
            return {
                hipL: { x: -0.5 }, kneeL: { x: 0.8 },
                hipR: { x: -0.2 }, kneeR: { x: 0.5 },
                shoulderL: { x: -1.2 * panic, z: -1.1 + flail },
                shoulderR: { x: -1.2 * panic, z: 1.1 - flail },
                elbowL: { x: -0.4 }, elbowR: { x: -0.4 },
                torso: { x: 0.05 }, head: { x: 0.1 },
                bandanaTail: { x: 2.2 }
            };
        }

        if (state === 'run') {
            // The run cycle: legs swing opposite each other, each arm
            // swings opposite its own leg. One sine wave drives it all.
            this.runPhase += dt * (5 + speed * 1.5);
            const s = Math.sin(this.runPhase);
            const kneeLift = (phase) => 0.3 + Math.max(0, Math.sin(phase)) * 1.4;

            return {
                hipL: { x: -s * 0.95 * run }, hipR: { x: s * 0.95 * run },
                kneeL: { x: kneeLift(this.runPhase + 1.4) * run },
                kneeR: { x: kneeLift(this.runPhase + 1.4 + Math.PI) * run },
                shoulderL: { x: s * 0.9 * run, z: -0.15 },
                shoulderR: { x: -s * 0.9 * run, z: 0.15 },
                elbowL: { x: -0.9 * run - 0.2 }, elbowR: { x: -0.9 * run - 0.2 },
                torso: { x: 0.3 * run, y: s * 0.12 * run },
                head: { x: -0.2 * run, y: -s * 0.1 * run },
                bandanaTail: { x: flap }
            };
        }

        // Idle: breathe, look around curiously.
        const breathe = Math.sin(t * 2.4);
        return {
            hipL: { x: -0.1 }, hipR: { x: -0.1 },
            kneeL: { x: 0.25 }, kneeR: { x: 0.25 },
            shoulderL: { x: -0.2 + breathe * 0.03, z: -0.15 },
            shoulderR: { x: -0.2 + breathe * 0.03, z: 0.15 },
            elbowL: { x: -0.5 }, elbowR: { x: -0.5 },
            torso: { x: 0.06 + breathe * 0.015 },
            head: { x: Math.sin(t * 0.7) * 0.06, y: Math.sin(t * 0.45) * 0.4 },
            bandanaTail: { x: 0.12 + breathe * 0.05 }
        };
    }

    blink(dt) {
        this.blinkTimer -= dt;
        const closed = this.blinkTimer < 0.12;

        for (const eye of this.eyes) eye.scale.y = closed ? 0.12 : 1;

        if (this.blinkTimer <= 0) this.blinkTimer = 2 + Math.random() * 3;
    }
}
