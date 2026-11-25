import * as THREE from 'three';
import { GRAVITY } from '../config.js';

// ---------------- TUNING ----------------

const PUMP_STRENGTH = 2.2;  // rad/s² added while pumping WITH the swing
const HELD_DAMPING = 0.05;  // tiny energy loss while held (so pumping matters)
const FREE_DAMPING = 0.35;  // an empty rope settles down after you let go
const WIND = 0.25;          // gentle idle sway
const MAX_ANGLE = 1.3;      // ~75°, never swing over the branch

// Materials are shared by every rope (one material, many meshes = cheaper).
const coreMaterial = new THREE.MeshStandardMaterial({ color: '#49301d', roughness: 1 });
const strandMaterials = ['#b08a51', '#806039', '#c39b5e'].map(
    (color) => new THREE.MeshStandardMaterial({ color, roughness: 1 })
);
const knotMaterial = new THREE.MeshStandardMaterial({ color: '#76502d', roughness: 1 });

// A rope is a PENDULUM: a point mass on a rigid rod of length L.
//
//   angle  θ = 0 hanging straight down, positive = swung forward (-z)
//   end    = anchor + (0, -L·cosθ, -L·sinθ)
//   accel  θ'' = -(g / L) · sinθ          <- the whole physics model
//
// Everything is in the y-z plane, since the path runs along z.

export default class Rope {
    // `parent` is what it hangs in (a chunk of the world).
    constructor(parent, anchor, length, phase = 0) {
        this.anchor = anchor.clone();
        this.length = length;
        this.phase = phase;

        this.angle = 0.1 * Math.sin(phase);
        this.angularVelocity = 0;

        this.held = false;
        this.pumpInput = 0; // -1..1, set by the player while holding on

        this.group = this.createMesh();
        this.group.position.copy(this.anchor);
        parent.add(this.group);
    }

    // ---------------- PHYSICS ----------------

    simulate(dt, time) {
        // Gravity pulls the rope back toward hanging straight down.
        let accel = -(GRAVITY / this.length) * Math.sin(this.angle);

        if (this.held) {
            // Pumping only adds energy when you push the SAME way you're
            // already swinging - just like on a playground swing.
            if (this.pumpInput * this.angularVelocity >= 0) {
                accel += PUMP_STRENGTH * this.pumpInput;
            }
        } else {
            accel += WIND * Math.sin(time * 0.9 + this.phase);
        }

        // Semi-implicit Euler: update velocity first, then position.
        // (Doing it in the other order makes pendulums gain energy and explode.)
        this.angularVelocity += accel * dt;
        this.angularVelocity *= Math.exp(
            -(this.held ? HELD_DAMPING : FREE_DAMPING) * dt
        );
        this.angle += this.angularVelocity * dt;

        if (Math.abs(this.angle) > MAX_ANGLE) {
            this.angle = Math.sign(this.angle) * MAX_ANGLE;
            this.angularVelocity = 0;
        }

        // Rotating the group about x by θ moves its tip to exactly `end`.
        this.group.rotation.x = this.angle;
    }

    // Called when the player catches the rope at `hand` moving at `velocity`.
    attach(hand, velocity) {
        // The rope snaps to point at the hand.
        const dy = this.anchor.y - hand.y;
        const dz = this.anchor.z - hand.z;

        this.angle = THREE.MathUtils.clamp(
            Math.atan2(dz, dy), -MAX_ANGLE, MAX_ANGLE
        );

        // Keep only the part of the player's velocity that runs ALONG the
        // swing arc (the tangent). The part pulling on the rope is lost.
        const tangentY = Math.sin(this.angle);
        const tangentZ = -Math.cos(this.angle);

        this.angularVelocity =
            (velocity.y * tangentY + velocity.z * tangentZ) / this.length;

        this.held = true;
    }

    detach() {
        this.held = false;
        this.pumpInput = 0;
    }

    // Remove from the world. (Geometry and materials are shared by every
    // rope, so there's nothing of its own to free.)
    dispose() {
        this.group.removeFromParent();
    }

    // ---------------- GEOMETRY HELPERS ----------------

    getEnd(target) {
        return target.set(
            this.anchor.x,
            this.anchor.y - this.length * Math.cos(this.angle),
            this.anchor.z - this.length * Math.sin(this.angle)
        );
    }

    // Unit vector from the rope end back up to the anchor.
    getUpDirection(target) {
        return target.set(0, Math.cos(this.angle), Math.sin(this.angle));
    }

    // Velocity of the rope end: tangent × (ω · L).
    getEndVelocity(target) {
        const speed = this.angularVelocity * this.length;

        return target.set(
            0,
            Math.sin(this.angle) * speed,
            -Math.cos(this.angle) * speed
        );
    }

    // ---------------- MESH ----------------
    // Braided rope built pointing DOWN from the group origin (the anchor).

    createMesh() {
        const group = new THREE.Group();
        const shapes = ropeGeometry(this.length);

        group.add(new THREE.Mesh(shapes.core, coreMaterial));

        shapes.strands.forEach((geometry, strand) => {
            const mesh = new THREE.Mesh(geometry, strandMaterials[strand]);
            mesh.castShadow = true;
            group.add(mesh);
        });

        // Knot at the end: this is the grab point.
        const knot = new THREE.Mesh(shapes.knot, knotMaterial);
        knot.position.y = -this.length;
        group.add(knot);

        return group;
    }
}

// ---------------- SHARED ROPE GEOMETRY ----------------
// Every rope of the same length looks identical, so the (fairly heavy)
// braided tubes are built ONCE and shared. A new rope then costs almost
// nothing - important when the endless course adds ropes as you run.

const geometryCache = new Map();

function ropeGeometry(length) {
    if (geometryCache.has(length)) return geometryCache.get(length);

    const core = new THREE.TubeGeometry(
        new THREE.LineCurve3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -length, 0)),
        8, 0.11, 10, false
    );

    // Three strands twisted around the core.
    const strands = [0, 1, 2].map((strand) => {
        const phase = (strand * Math.PI * 2) / 3;
        const points = [];

        for (let i = 0; i <= 100; i++) {
            const t = i / 100;
            const twist = t * Math.PI * 13 + phase;
            points.push(new THREE.Vector3(Math.cos(twist) * 0.105, -length * t, Math.sin(twist) * 0.105));
        }

        return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 150, 0.035, 6, false);
    });

    const shapes = { core, strands, knot: new THREE.SphereGeometry(0.2, 12, 12) };
    geometryCache.set(length, shapes);
    return shapes;
}
