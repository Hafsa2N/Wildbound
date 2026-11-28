import * as THREE from 'three';
import { GRAVITY } from '../config.js';
import Lemur, { HANDS_UP_HEIGHT } from './Lemur.js';
import { damp, wrapAngle } from '../utils/math.js';

// ---------------- TUNING ----------------
// Change these numbers to change how the game *feels*.

const RUN_SPEED = 7;           // m/s
const JUMP_HEIGHT = 2.2;       // metres — we design in metres, physics gives the velocity
const GROUND_ACCEL = 40;       // how quickly we reach full speed on the ground
const AIR_ACCEL = 15;          // less control while airborne
const COYOTE_TIME = 0.1;       // seconds you can still jump after leaving a ledge
const JUMP_BUFFER_TIME = 0.12; // seconds a jump press is remembered before landing

// Swinging
const HAND_HEIGHT = 1.7;       // hands are this far above the feet
const GRAB_RADIUS = 1.2;       // how close the hands must get to the rope end
const GRAB_X_RANGE = 1.6;      // sideways tolerance when grabbing
const REGRAB_COOLDOWN = 0.35;  // can't instantly re-catch the rope you let go of
const RELEASE_BOOST = 3;       // extra upward m/s on release (feels great, not realistic)

// Falling
const SAFE_MARGIN = 2.5;       // respawn points must be this far from any edge

// Sliding (S while running forward)
const SLIDE_TIME = 0.65;       // seconds low to the ground
const SLIDE_MIN_SPEED = 4;     // must be running forward at least this fast
const SLIDE_BOOST = 1.15;      // a little burst of speed when you drop
const SLIDE_FRICTION = 5;      // m/s² of slowdown during the slide

// Body size, used by hazards to decide if they touched you
const STAND_HEIGHT = 1.45;
const SLIDE_HEIGHT = 0.7;

// Health
export const MAX_HEARTS = 3;
const INVULNERABLE_TIME = 1.5; // seconds of flashing after a hit (no double hits)
const KNOCKBACK_SPEED = 6;     // m/s pushed away from what hit you
const KNOCKBACK_LIFT = 7;      // m/s upward, so you visibly get bounced

// The running path is 7 m wide; keep the lemur on it.
const PATH_HALF_WIDTH = 3.2;

// v = sqrt(2 * g * h): the launch speed that reaches exactly JUMP_HEIGHT
const JUMP_VELOCITY = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);

// Move `current` toward `target` by at most `maxStep` (never overshoots).
function moveTowards(current, target, maxStep) {
    if (Math.abs(target - current) <= maxStep) return target;
    return current + Math.sign(target - current) * maxStep;
}

// Scratch vectors, reused every frame instead of allocating new ones.
const _hand = new THREE.Vector3();
const _ropeEnd = new THREE.Vector3();
const _up = new THREE.Vector3();

export default class Player {
    // `course` answers: where is solid ground? which ropes exist? (see Course.js)
    constructor(scene, course) {
        // `position` is the player's FEET. The mesh is drawn from here.
        this.position = new THREE.Vector3(0, 0, 8);
        this.velocity = new THREE.Vector3();

        this.onGround = true;
        this.state = 'idle';       // idle | run | jump | fall | swing

        this.coyoteTimer = 0;
        this.jumpBuffer = 0;

        this.course = course;
        this.ropes = course.ropes; // a live list: chunks add and remove ropes
        this.rope = null;          // the rope we're holding, if any
        this.grabCooldown = 0;

        this.spawnPoint = this.position.clone();
        this.falls = 0;
        this.slideTimer = 0;
        this.inputEnabled = true; // the world turns this off on the title screen

        // SWING CHAINS: every rope catch, plant bounce or vine fling made
        // without touching the ground adds a link. Landing ends the chain.
        this.chain = 0;
        // Things that happened this frame, for the world to react to
        // (HUD popups, rewards). The world empties this list each frame.
        this.events = [];

        this.hearts = MAX_HEARTS;
        this.invulnerableTimer = 0;
        this.dead = false;

        this.facing = Math.PI;     // yaw; PI = facing down the path (-z)
        this.squash = 0;           // 0..1, set on landing, decays to 0
        this.runCycle = 0;         // drives the running bob

        this.createMesh(scene);
        this.createInput();
    }

    // ---------------- MESH ----------------

    createMesh(scene) {
        this.mesh = new THREE.Group();

        // The "body" group is what we squash/bob, so the root stays at the feet.
        this.body = new THREE.Group();
        this.mesh.add(this.body);

        // The visible character. It only LOOKS like the player: all the
        // physics above still treats the player as a point at the feet.
        this.lemur = new Lemur();
        this.body.add(this.lemur.root);

        scene.add(this.mesh);
    }

    // ---------------- INPUT ----------------
    // Events only RECORD key state; update() READS it once per frame.

    createInput() {
        this.keys = {};            // keys currently held
        this.pressed = new Set();  // keys pressed since the last update()

        window.addEventListener('keydown', (e) => {
            // Typing your name on the results card isn't playing.
            if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) return;

            // Arrow keys and Space would otherwise scroll the page.
            if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
                e.preventDefault(); // stop the page scrolling
            }

            // e.repeat is true for OS key-repeat; ignore those so
            // holding Space doesn't count as many presses.
            if (!e.repeat) this.pressed.add(e.code);
            this.keys[e.code] = true;
        });

        window.addEventListener('keyup', (e) => {
            this.keys[e.code] = false;
        });

        // If the window loses focus mid-press we never get keyup → stuck keys.
        window.addEventListener('blur', () => {
            this.keys = {};
        });
    }

    isHeld(...codes) {
        return codes.some((c) => this.keys[c]);
    }

    wasPressed(...codes) {
        return codes.some((c) => this.pressed.has(c));
    }

    // Normalised input direction. W = forward = -z.
    readInput() {
        // On the title screen the lemur just stands there looking around.
        if (!this.inputEnabled) return { x: 0, z: 0 };

        let x =
            (this.isHeld('KeyD', 'ArrowRight') ? 1 : 0) -
            (this.isHeld('KeyA', 'ArrowLeft') ? 1 : 0);
        let z =
            (this.isHeld('KeyS', 'ArrowDown') ? 1 : 0) -
            (this.isHeld('KeyW', 'ArrowUp') ? 1 : 0);

        // Normalize so diagonals aren't ~1.41x faster.
        const length = Math.hypot(x, z);
        if (length > 0) {
            x /= length;
            z /= length;
        }

        return { x, z };
    }

    // ---------------- UPDATE ----------------
    // The state machine: each state has its own rules for input and motion.

    update(dt) {
        if (!this.inputEnabled) this.pressed.clear(); // ignore presses too

        const input = this.readInput();
        this.grabCooldown -= dt;
        this.invulnerableTimer -= dt;

        if (this.dead) {
            // Out of hearts: no control. Still fall/settle under gravity.
            this.updateMovement(dt, { x: 0, z: 0 });
            this.state = 'dead';
        } else if (this.state === 'swing') {
            this.updateSwing(dt, input);
        } else {
            this.updateMovement(dt, input);
        }

        this.updateVisuals(dt);

        // Presses are consumed once per frame.
        this.pressed.clear();
    }

    // ---------------- RUN / JUMP / FALL ----------------

    updateMovement(dt, input) {
        // 0. Slide: press S (down) while running forward on the ground.
        //    S normally means "walk backward", so we only treat it as a
        //    slide when you're already moving forward fast.
        if (
            !this.dead &&
            this.onGround &&
            !this.sliding &&
            this.wasPressed('KeyS', 'ArrowDown') &&
            -this.velocity.z > SLIDE_MIN_SPEED
        ) {
            this.slideTimer = SLIDE_TIME;
            this.velocity.x *= SLIDE_BOOST;
            this.velocity.z *= SLIDE_BOOST;
        }

        // 1. Horizontal velocity.
        if (this.sliding) {
            // Committed: no steering, just momentum and friction.
            const speed = Math.hypot(this.velocity.x, this.velocity.z);
            const slowed = Math.max(0, speed - SLIDE_FRICTION * dt);
            if (speed > 0) {
                this.velocity.x *= slowed / speed;
                this.velocity.z *= slowed / speed;
            }
            this.slideTimer -= dt;
        } else {
            // Ease toward the target velocity.
            const accel = this.onGround ? GROUND_ACCEL : AIR_ACCEL;

            this.velocity.x = moveTowards(
                this.velocity.x, input.x * RUN_SPEED, accel * dt
            );
            this.velocity.z = moveTowards(
                this.velocity.z, input.z * RUN_SPEED, accel * dt
            );
        }

        // 2. Forgiveness timers
        if (this.onGround) this.coyoteTimer = COYOTE_TIME;
        else this.coyoteTimer -= dt;

        if (this.wasPressed('Space') && !this.dead) this.jumpBuffer = JUMP_BUFFER_TIME;
        else this.jumpBuffer -= dt;

        // 3. Jump: a remembered press + recently grounded
        if (this.jumpBuffer > 0 && this.coyoteTimer > 0) {
            this.velocity.y = JUMP_VELOCITY;
            this.jumpBuffer = 0;
            this.coyoteTimer = 0; // can't jump again until we land
            this.onGround = false;
            this.slideTimer = 0;  // jumping cancels a slide
        }

        // 4. Gravity
        this.velocity.y -= GRAVITY * dt;

        // 5. Move: position += velocity * dt
        const previousY = this.position.y;
        const previousZ = this.position.z;

        this.position.addScaledVector(this.velocity, dt);

        // 6. Ground check (AFTER moving, so we never sink for a frame).
        //    Ground only exists where there's no ravine.
        const wasOnGround = this.onGround;
        this.onGround = false;

        if (this.position.y <= 0 && this.course.isSolidGround(this.position.z)) {
            if (previousY >= -0.01) {
                // We came from above: land on it.
                this.position.y = 0;
                if (this.velocity.y < 0) this.velocity.y = 0;
                this.onGround = true;
            } else {
                // We're down in the ravine and ran into its wall: blocked.
                this.position.z = previousZ;
                this.velocity.z = 0;
            }
        }

        if (!wasOnGround && this.onGround) {
            this.squash = 1; // just landed

            // Touching the ground ends a chain - and pays it out.
            if (this.chain > 0) {
                this.events.push({ type: 'chainEnd', count: this.chain });
                this.chain = 0;
            }
        }

        // 7. Remember safe spots to respawn at (well away from any edge).
        if (
            this.onGround &&
            this.course.isSolidGround(this.position.z + SAFE_MARGIN) &&
            this.course.isSolidGround(this.position.z - SAFE_MARGIN)
        ) {
            this.spawnPoint.copy(this.position);
        }

        // 8. Stay on the path (and don't run back into cleared world)
        this.clampToBounds();

        // 9. Try to catch a rope while airborne
        if (!this.dead && !this.onGround && this.grabCooldown <= 0 && this.tryGrabRope()) {
            return;
        }

        // 10. Fell into the ravine?
        // How deep counts as fallen in depends on what's below: a ravine,
        // or open water (where you're out of it much sooner).
        if (this.position.y < this.course.killHeightAt(this.position.z)) {
            this.respawn();
            return;
        }

        if (this.dead) return;

        // 11. Pick the state from the physics this frame
        const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);

        if (!this.onGround) this.slideTimer = 0;

        if (this.sliding) {
            this.state = 'slide';
        } else if (this.onGround) {
            this.state = horizontalSpeed > 0.1 ? 'run' : 'idle';
        } else {
            this.state = this.velocity.y > 0 ? 'jump' : 'fall';
        }
    }

    // ---------------- ROPES ----------------

    tryGrabRope() {
        _hand.copy(this.position);
        _hand.y += HAND_HEIGHT;

        for (const rope of this.ropes) {
            rope.getEnd(_ropeEnd);

            if (Math.abs(_hand.x - _ropeEnd.x) > GRAB_X_RANGE) continue;

            const distance = Math.hypot(
                _hand.y - _ropeEnd.y,
                _hand.z - _ropeEnd.z
            );

            if (distance > GRAB_RADIUS) continue;

            // Caught it! The rope takes our momentum.
            rope.attach(_hand, this.velocity);
            this.addLink('rope');

            this.rope = rope;
            this.state = 'swing';
            this.onGround = false;
            return true;
        }

        return false;
    }

    updateSwing(dt, input) {
        const rope = this.rope;

        // W pumps forward (toward -z), S pumps backward.
        // The rope applies it on its next simulate().
        rope.pumpInput = -input.z;

        // Hang from the rope: hands at the rope end, feet HAND_HEIGHT
        // further along the rope direction.
        const x = this.position.x;

        rope.getEnd(_ropeEnd);
        rope.getUpDirection(_up);
        this.position.copy(_ropeEnd).addScaledVector(_up, -HAND_HEIGHT);

        // Slide sideways onto the rope instead of snapping.
        this.position.x = x + (rope.anchor.x - x) * damp(10, dt);

        // Our velocity IS the rope end's velocity. This is what we keep
        // when we let go - release at the right moment to fly far.
        rope.getEndVelocity(this.velocity);

        if (this.wasPressed('Space')) {
            this.releaseRope();
        }
    }

    releaseRope() {
        this.velocity.y += RELEASE_BOOST;

        this.rope.detach();
        this.rope = null;

        this.grabCooldown = REGRAB_COOLDOWN;
        this.jumpBuffer = 0; // that Space press was the release, not a jump
        this.coyoteTimer = 0;
        this.state = 'jump';
    }

    // Put the player at `point`, standing still, holding nothing.
    placeAt(point) {
        if (this.rope) {
            this.rope.detach();
            this.rope = null;
        }

        this.position.copy(point);
        this.velocity.set(0, 0, 0);
        this.chain = 0; // a respawn breaks the chain - no reward
        this.slideTimer = 0;
        this.onGround = true;
        this.state = 'idle';
        this.facing = Math.PI;
        this.jumpBuffer = 0;
        this.mesh.rotation.x = 0;
    }

    // Fell in: back to the last safe spot. Costs a heart.
    respawn() {
        this.placeAt(this.spawnPoint);
        this.falls++;

        if (!this.dead) {
            this.loseHeart();
            this.invulnerableTimer = INVULNERABLE_TIME;
        }
    }

    // Something hurt us (a plant, a trap). `from` is where the hit came
    // from, so we can knock the player AWAY from it.
    // Returns true if the hit landed.
    takeHit(from) {
        if (this.dead || this.invulnerableTimer > 0) return false;

        this.chain = 0; // getting hit breaks the chain - no reward

        if (this.rope) {
            this.rope.detach();
            this.rope = null;
            this.grabCooldown = REGRAB_COOLDOWN;
        }

        // Knockback: push away horizontally, and pop up into the air.
        const away = new THREE.Vector3(
            this.position.x - from.x, 0, this.position.z - from.z
        );
        if (away.lengthSq() < 0.001) away.set(0, 0, 1);
        away.normalize().multiplyScalar(KNOCKBACK_SPEED);

        this.velocity.set(away.x, KNOCKBACK_LIFT, away.z);
        this.onGround = false;
        this.state = 'fall';
        this.squash = 1;

        this.loseHeart();
        this.invulnerableTimer = INVULNERABLE_TIME;
        return true;
    }

    loseHeart() {
        this.hearts = Math.max(0, this.hearts - 1);
        if (this.hearts === 0) this.dead = true;
    }

    get invulnerable() {
        return this.invulnerableTimer > 0;
    }

    get sliding() {
        return this.slideTimer > 0;
    }

    // How tall the body is right now (hazards use this to test hits).
    get bodyHeight() {
        return this.sliding ? SLIDE_HEIGHT : STAND_HEIGHT;
    }

    // Height of the middle of the body above the feet.
    // ---------------- PLANTS AS TOOLS ----------------
    // A plant can throw you: a dazed Snapjaw's head is springy, a lifted
    // Thornlash flings you. `up` and `forward` are speeds in m/s.
    launch(up, forward, kind) {
        if (this.dead) return;

        if (this.rope) {
            this.rope.detach();
            this.rope = null;
        }

        this.velocity.y = up;
        this.velocity.z = Math.min(this.velocity.z, -forward); // forward = -z
        this.onGround = false;
        this.slideTimer = 0;
        this.jumpBuffer = 0;
        this.coyoteTimer = 0;
        this.grabCooldown = 0.15;
        this.state = 'jump';
        this.squash = 1;

        this.addLink(kind);
    }

    addLink(kind) {
        this.chain++;
        this.events.push({ type: 'link', kind, count: this.chain });
    }

    get centerHeight() {
        return this.sliding ? 0.4 : 0.9;
    }

    // Full restart of the run.
    reset(startPoint) {
        this.spawnPoint.copy(startPoint);
        this.placeAt(startPoint);
        this.falls = 0;
        this.hearts = MAX_HEARTS;
        this.invulnerableTimer = 0;
        this.dead = false;
        this.mesh.rotation.z = 0;
        this.mesh.visible = true;
    }

    clampToBounds() {
        if (Math.abs(this.position.x) > PATH_HALF_WIDTH) {
            this.position.x = Math.sign(this.position.x) * PATH_HALF_WIDTH;
            this.velocity.x = 0;
        }

        // No running back into the part of the world that's been cleared.
        const back = this.course.backLimit;
        if (this.position.z > back) {
            this.position.z = back;
            this.velocity.z = Math.min(this.velocity.z, 0);
        }
    }

    // ---------------- VISUALS ----------------

    updateVisuals(dt) {
        this.mesh.position.copy(this.position);

        const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);

        if (this.state === 'swing') {
            // Face down the path and lean along the rope.
            this.facing = Math.PI;
            this.mesh.rotation.x = this.rope.angle;
        } else {
            // Ease the lean back to upright after letting go.
            this.mesh.rotation.x *= Math.exp(-8 * dt);

            // Turn to face the direction of movement (smoothly, shortest way round).
            if (horizontalSpeed > 0.5) {
                const targetYaw = Math.atan2(this.velocity.x, this.velocity.z);
                this.facing += wrapAngle(targetYaw - this.facing) * damp(12, dt);
            }
        }

        this.mesh.rotation.y = this.facing;

        // Out of hearts: topple over onto one side.
        const targetTopple = this.dead ? 1.45 : 0;
        this.mesh.rotation.z += (targetTopple - this.mesh.rotation.z) * damp(6, dt);

        // Flash while invulnerable (the classic "you got hit" signal).
        this.mesh.visible = !this.invulnerable || Math.floor(this.invulnerableTimer * 14) % 2 === 0;

        // Landing squash: flatten and widen, then spring back.
        this.squash = Math.max(0, this.squash - dt * 6);
        const s = this.squash;
        this.body.scale.set(1 + 0.15 * s, 1 - 0.25 * s, 1 + 0.15 * s);

        // Little bounce while running.
        if (this.state === 'run') {
            this.runCycle += dt * horizontalSpeed * 2;
            this.body.position.y = Math.abs(Math.sin(this.runCycle)) * 0.06;
        } else {
            this.body.position.y = 0;
        }

        // Pose the character's limbs for the current state.
        this.lemur.update(dt, {
            state: this.state,
            speed: horizontalSpeed,
            verticalSpeed: this.velocity.y,
            swingSpeed: this.rope ? this.rope.angularVelocity * this.rope.length : 0,
            // How far to shift the model so its raised hands meet the rope.
            gripDrop: HAND_HEIGHT - HANDS_UP_HEIGHT
        });
    }
}
