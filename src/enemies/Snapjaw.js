import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ease, damp, wrapAngle } from '../utils/math.js';

// ---------------- SNAPJAW ----------------
// A carnivorous plant that waits on the path. It REACTS to you:
//
//   idle ──(you come close)──> open ──> snap ──> recover ──> idle
//
// Every hazard needs three things, and this is how Snapjaw does them:
//   TELL      'open': jaws part slowly, the mouth glows, it leans back
//   COUNTER   wait for the snap, then dash past while it's 'recover'ing;
//             or sidestep - once it snaps it stops tracking you
//   PUNISH    caught in the bite: lose a heart, get knocked back
//   TOOL      while it's dazed (gold stars circle its head), land on its
//             head and it springs you high into the air

// ---------------- TUNING ----------------

const TRIGGER_RANGE = 4.8;   // starts opening when you're this close
const OPEN_TIME = 0.55;      // the tell. Running straight in = you arrive as it bites.
const BODY_RADIUS = 0.75;    // the stalk and leaves are solid: you can't run through
const BOUNCE_UP = 15;        // m/s upward from a head bounce (~3.7 m higher)
const BOUNCE_FORWARD = 3;    // m/s forward
const BOUNCE_RADIUS = 0.85;  // how close your feet must land to the head
const SNAP_TIME = 0.2;       // fast!
const RECOVER_TIME = 1.4;    // dazed: your window to get past
const REST_TIME = 0.6;       // can't re-trigger instantly
const BITE_RADIUS = 1.05;    // head-to-body distance that counts as bitten

const SEGMENTS = 3;
const SEGMENT_LENGTH = 0.55;

// ---------------- SHARED GEOMETRY & MATERIALS ----------------

const stalkMaterial = new THREE.MeshStandardMaterial({ color: '#3f7d2c', roughness: 0.8 });
const leafMaterial = new THREE.MeshStandardMaterial({ color: '#2b6b2a', roughness: 0.8, side: THREE.DoubleSide });
const jawMaterial = new THREE.MeshStandardMaterial({ color: '#b3124f', roughness: 0.55 });
const spotMaterial = new THREE.MeshStandardMaterial({ color: '#ffd166', roughness: 0.6 });
const toothMaterial = new THREE.MeshStandardMaterial({ color: '#fff6e0', roughness: 0.4 });

const segmentGeometry = new THREE.CylinderGeometry(0.085, 0.12, SEGMENT_LENGTH, 10)
    .translate(0, SEGMENT_LENGTH / 2, 0);
const leafGeometry = new THREE.SphereGeometry(0.5, 10, 6);
// Top and bottom halves of a sphere = the two jaws.
const upperDome = new THREE.SphereGeometry(0.42, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
const lowerDome = new THREE.SphereGeometry(0.42, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
const innerUpper = new THREE.SphereGeometry(0.39, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2);
const innerLower = new THREE.SphereGeometry(0.39, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
const toothGeometry = new THREE.ConeGeometry(0.035, 0.12, 5);
const spotGeometry = new THREE.SphereGeometry(0.05, 8, 6);

const starMaterial = new THREE.MeshStandardMaterial({
    color: '#ffe680', emissive: '#ffc21a', emissiveIntensity: 1.6
});
const starGeometry = new THREE.OctahedronGeometry(0.08, 0);

const _head = new THREE.Vector3();

export default class Snapjaw {
    // `parent` is what it lives in (a chunk of the world).
    constructor(parent, { x, z }) {
        this.home = new THREE.Vector3(x, 0, z);
        this.root = new THREE.Group();
        this.root.position.copy(this.home);

        // Each plant gets its OWN mouth material, so its glow can
        // change without making every other Snapjaw glow too.
        this.mouthMaterial = new THREE.MeshStandardMaterial({
            color: '#ff8fb1',
            emissive: '#ff2d6f',
            emissiveIntensity: 0,
            roughness: 0.6,
            side: THREE.BackSide  // we see the INSIDE of the dome
        });

        this.ownGeometries = []; // made just for this plant: freed on dispose()
        this.build();
        parent.add(this.root);

        this.phase = Math.random() * 10; // idle sway offset
        this.reset();
    }

    build() {
        // Base leaves fanning out
        for (let i = 0; i < 6; i++) {
            const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
            const a = (i / 6) * Math.PI * 2;
            leaf.scale.set(0.35, 0.08, 1.1);
            leaf.position.set(Math.sin(a) * 0.45, 0.06, Math.cos(a) * 0.45);
            leaf.rotation.y = a;
            leaf.castShadow = true;
            this.root.add(leaf);
        }

        // `yaw` turns the whole plant to face you.
        this.yaw = new THREE.Group();
        this.root.add(this.yaw);

        // Stalk: a chain of joints, so it can lean back and lunge.
        this.joints = [];
        let parent = this.yaw;

        for (let i = 0; i < SEGMENTS; i++) {
            const joint = new THREE.Group();
            joint.position.y = i === 0 ? 0.05 : SEGMENT_LENGTH;
            const segment = new THREE.Mesh(segmentGeometry, stalkMaterial);
            segment.castShadow = true;
            joint.add(segment);
            parent.add(joint);
            parent = joint;
            this.joints.push(joint);
        }

        // Head sits on top of the stalk. Mouth faces +z (toward you).
        this.head = new THREE.Group();
        this.head.position.y = SEGMENT_LENGTH + 0.2;
        this.head.rotation.x = 0.15; // tip the mouth slightly downward
        parent.add(this.head);

        this.upperJaw = this.buildJaw(upperDome, innerUpper, 1);
        this.lowerJaw = this.buildJaw(lowerDome, innerLower, -1);

        // Dizzy stars: shown only while dazed - "safe to bounce on me".
        this.stars = new THREE.Group();
        this.stars.position.y = 0.55;
        for (let i = 0; i < 3; i++) {
            const star = new THREE.Mesh(starGeometry, starMaterial);
            const a = (i / 3) * Math.PI * 2;
            star.position.set(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35);
            this.stars.add(star);
        }
        this.stars.visible = false;
        this.head.add(this.stars);
    }

    // A jaw hinges at the back of the head. Rotating the hinge opens it.
    buildJaw(outer, inner, dir) {
        const hinge = new THREE.Group();
        hinge.position.z = -0.3;
        this.head.add(hinge);

        const shell = new THREE.Group();
        shell.position.z = 0.3;
        shell.scale.set(1, 0.75, 1.25);
        hinge.add(shell);

        // The top half of a sphere IS an upper jaw (open side facing down);
        // the bottom half is a lower jaw. Together they close into a ball.
        const dome = new THREE.Mesh(outer, jawMaterial);
        dome.castShadow = true;
        shell.add(dome);

        const mouth = new THREE.Mesh(inner, this.mouthMaterial);
        shell.add(mouth);

        // Teeth around the rim (the sphere's equator), pointing at the
        // other jaw: down for the upper jaw, up for the lower.
        // All 12 are MERGED into one mesh: one draw call instead of twelve.
        const teeth = [];
        const place = new THREE.Object3D();
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            place.position.set(Math.cos(a) * 0.36, -dir * 0.04, Math.sin(a) * 0.36);
            place.rotation.set(dir === 1 ? Math.PI : 0, 0, 0);
            place.updateMatrix();
            teeth.push(toothGeometry.clone().applyMatrix4(place.matrix));
        }
        const teethGeometry = mergeGeometries(teeth);
        this.ownGeometries.push(teethGeometry);
        shell.add(new THREE.Mesh(teethGeometry, toothMaterial));

        // Warning spots on the outside (also merged)
        const spots = [];
        for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + 0.4;
            spots.push(spotGeometry.clone().translate(Math.cos(a) * 0.22, dir * 0.34, Math.sin(a) * 0.22));
        }
        const spotsGeometry = mergeGeometries(spots);
        this.ownGeometries.push(spotsGeometry);
        shell.add(new THREE.Mesh(spotsGeometry, spotMaterial));

        // The upper jaw opens "up" (negative hinge.x), the lower "down".
        hinge.userData.dir = dir;
        return hinge;
    }

    reset() {
        this.state = 'idle';
        this.timer = REST_TIME;
        this.jawOpen = 0.08;
        this.lean = 0;
        this.glow = 0;
        this.lungeLean = 0.6;
        this.bitThisSnap = false;
        this.bounced = false;
        this.headSquash = 0;
    }

    // Returns the point the hit came from, or null.
    update(dt, time, player, playerCenter) {
        this.blockPlayer(player);

        const dx = player.position.x - this.home.x;
        const dz = player.position.z - this.home.z;
        const distance = Math.hypot(dx, dz);

        this.timer -= dt;

        // ---- State machine ----
        switch (this.state) {
            case 'idle':
                if (this.timer <= 0 && distance < TRIGGER_RANGE && !player.dead) {
                    this.enter('open', OPEN_TIME);
                }
                break;
            case 'open':
                if (this.timer <= 0) {
                    // COMMIT: aim exactly where you are right now, and lunge
                    // further the further away you are. From here on it can't
                    // re-aim - so dodging has to happen during the tell.
                    this.yaw.rotation.y = Math.atan2(dx, dz);
                    this.lungeLean = THREE.MathUtils.clamp(0.4 + distance * 0.12, 0.45, 0.75);
                    this.enter('snap', SNAP_TIME);
                }
                break;
            case 'snap':
                if (this.timer <= 0) this.enter('recover', RECOVER_TIME);
                break;
            case 'recover':
                if (this.timer <= 0) this.enter('idle', REST_TIME);
                break;
        }

        // ---- Pose targets for each state ----
        let jaw = 0.08, lean = 0, glow = 0, rate = 8;

        if (this.state === 'open') {
            const t = 1 - this.timer / OPEN_TIME;  // 0..1 through the tell
            jaw = 0.95 * t;
            lean = -0.18 * t;                      // ANTICIPATION: rear back
            glow = 2.2 * t;
        } else if (this.state === 'snap') {
            jaw = 0;
            lean = this.lungeLean;                 // lunge!
            rate = 30;                             // fast
        } else if (this.state === 'recover') {
            lean = 0.6 * Math.max(0, this.timer / RECOVER_TIME - 0.3);
            rate = 3;                              // slow, dazed droop
        }

        const k = damp(rate, dt);
        this.jawOpen = ease(this.jawOpen, jaw, k);
        this.lean = ease(this.lean, lean, k);
        this.glow = ease(this.glow, glow, damp(10, dt));

        // Track the player - but only BEFORE it commits to the bite.
        if (this.state === 'idle' || this.state === 'open') {
            const targetYaw = Math.atan2(dx, dz);
            const diff = wrapAngle(targetYaw - this.yaw.rotation.y);
            this.yaw.rotation.y += diff * damp(8, dt);
        }

        // ---- Apply pose ----
        const sway = this.state === 'idle' ? Math.sin(time * 1.6 + this.phase) * 0.06 : 0;
        const tremble = this.state === 'open' ? Math.sin(time * 45) * 0.03 * (1 - this.timer / OPEN_TIME) : 0;

        for (const joint of this.joints) {
            joint.rotation.x = this.lean + sway;
            joint.rotation.z = tremble;
        }

        // Dizzy stars spin round the head while it's dazed.
        this.stars.visible = this.state === 'recover' && !this.bounced;
        this.stars.rotation.y = time * 4;

        // A squash when you bounce on it, springing back.
        this.headSquash = Math.max(0, this.headSquash - dt * 4);
        const sq = this.headSquash;
        this.head.scale.set(1 + 0.35 * sq, 1 - 0.45 * sq, 1 + 0.35 * sq);

        this.upperJaw.rotation.x = -this.jawOpen * 0.75;
        this.lowerJaw.rotation.x = this.jawOpen * 0.4;
        this.mouthMaterial.emissiveIntensity = this.glow;

        // ---- Tool: bounce on the dazed head ----
        if (this.state === 'recover' && !this.bounced && !player.onGround && player.velocity.y < 0) {
            this.root.updateMatrixWorld(true);
            this.head.getWorldPosition(_head);

            const across = Math.hypot(player.position.x - _head.x, player.position.z - _head.z);
            const aboveTop = player.position.y - (_head.y + 0.25);

            if (across < BOUNCE_RADIUS && aboveTop > -0.5 && aboveTop < 0.6) {
                this.bounced = true;
                this.headSquash = 1;
                player.launch(BOUNCE_UP, BOUNCE_FORWARD, 'bounce');
            }
        }

        // ---- Did the bite land? ----
        if (this.state === 'snap' && !this.bitThisSnap) {
            this.root.updateMatrixWorld(true);
            this.head.getWorldPosition(_head);

            if (_head.distanceTo(playerCenter) < BITE_RADIUS) {
                this.bitThisSnap = true;
                return _head.clone();
            }
        }

        return null;
    }

    // Simple circle collision: if the player is inside the plant's base
    // (and not jumping over it), push them back out to the edge and
    // cancel the part of their velocity heading inward.
    blockPlayer(player) {
        if (player.position.y > 1.2) return; // high enough to clear it

        const dx = player.position.x - this.home.x;
        const dz = player.position.z - this.home.z;
        const distance = Math.hypot(dx, dz);

        if (distance >= BODY_RADIUS || distance < 1e-4) return;

        const nx = dx / distance;
        const nz = dz / distance;

        player.position.x = this.home.x + nx * BODY_RADIUS;
        player.position.z = this.home.z + nz * BODY_RADIUS;

        const inward = player.velocity.x * nx + player.velocity.z * nz;
        if (inward < 0) {
            player.velocity.x -= inward * nx;
            player.velocity.z -= inward * nz;
        }
    }

    // Remove from the world and free what this plant made for itself.
    dispose() {
        this.root.removeFromParent();
        this.mouthMaterial.dispose();
        for (const g of this.ownGeometries) g.dispose();
    }

    enter(state, duration) {
        this.state = state;
        this.timer = duration;
        if (state === 'snap') {
            this.bitThisSnap = false;
            this.bounced = false;
        }
    }
}
