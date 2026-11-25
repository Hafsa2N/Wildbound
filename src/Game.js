import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import Player, { MAX_HEARTS } from './player/Player.js';
import Collectibles from './world/Collectibles.js';
import Atmosphere, { blendPalettes, nightAmount, NIGHT_PALETTE, SUNSET_TINT } from './world/Atmosphere.js';
import Course from './world/endless/Course.js';
import { ZONES } from './world/endless/zones.js';
import { windUniforms, sharedMaterials } from './world/batch.js';
import { warmPrefabs } from './world/scenery/prefabs.js';
import { zoneTextures } from './world/scenery/textures.js';
import { updateWater, waterMaterials } from './world/Water.js';
import { START_Z } from './config.js';
import Hud from './ui/Hud.js';
import TitleScreen from './ui/TitleScreen.js';
import { damp } from './utils/math.js';

// ---------------- THE GAME ----------------
// This class owns the "game" itself: renderer, camera, run state, menus,
// and the per-frame loop. The WORLD is built by the Course (endless/),
// chunk by chunk, ahead of the player.

const WALLET_KEY = 'wildbound.coins';
const MAX_COIN_MULTIPLIER = 5;
const CAMERA_CEILING = 8.0;  // the camera stays below the rope branches

// Scratch vectors reused every frame. Making "new" vectors 60 times a
// second creates garbage for the browser to clean up, which can cause
// small hitches; reusing a few avoids that.
const _look = new THREE.Vector3();
const _centre = new THREE.Vector3();
const _right = new THREE.Vector3();
const _popAt = new THREE.Vector3();
const BEST_KEY = 'wildbound.best.endless';

export default class Game {
    constructor(container) {
        this.container = container;
        this.clock = new THREE.Clock();
        this.time = 0; // our own running total; see animate()

        this.createScene();
        this.createCamera();
        this.createRenderer();
        this.createLights();
        this.createPostProcessing();

        // A small "photo studio" lighting environment, pre-blurred for
        // reflections. Shiny materials (gold, emerald) reflect it; without
        // something to reflect, metal looks flat black.
        const pmrem = new THREE.PMREMGenerator(this.renderer);
        this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        pmrem.dispose();

        // Build every scenery prefab now, behind the title screen, so the
        // first chunks don't stutter.
        warmPrefabs();

        this.collectibles = new Collectibles(this.scene, this.envMap);
        this.course = new Course(this.scene, this.collectibles);
        this.player = new Player(this.scene, this.course);
        this.atmosphere = new Atmosphere(this.scene);
        this.palette = {};
        this.tmpColor = new THREE.Color();
        this.timeOverride = null; // set 0..1 to force a time of day (testing)

        this.cameraTarget = new THREE.Vector3();
        this.cameraLook = new THREE.Vector3(0, 1.5, 4); // eased, so turns are smooth
        this.playerCenter = new THREE.Vector3();
        this.wallet = this.loadWallet();
        this.best = this.loadBest();

        this.hud = new Hud(MAX_HEARTS);
        this.title = new TitleScreen({
            worldNumber: '01',
            worldName: 'Emerald Jungle',
            tagline: 'Swing, leap and slide through a jungle that fights back.',
            onStart: () => this.startGame()
        });
        this.createDebugHud();
        this.showTitle();
        this.precompileShaders();

        // The game has MODES. Each key means something different in each.
        // The whole game needs only Space, the arrow keys and Esc:
        //   'title'                 - Space (or Enter) starts
        //   'playing'               - Space jumps (handled by the Player)
        //   'playing', run is over  - Space runs again
        //   any time while playing  - Esc goes back to the title
        // (R also restarts - handy, but not something you need to learn.)
        window.addEventListener('keydown', (e) => {
            if (this.mode === 'title') {
                if (e.code === 'Space' || e.code === 'Enter') {
                    e.preventDefault();
                    this.startGame();
                }
                return;
            }

            // Wait a moment after the run ends, so a Space you were
            // pressing to jump doesn't skip straight past the results.
            const resultsReady = this.run.over && this.time - this.run.overAt > 0.9;
            if ((e.code === 'Space' && resultsReady) || e.code === 'KeyR') {
                this.restart();
                this.player.pressed.clear(); // that Space was "run again", not a jump
            }
            if (e.code === 'Escape') this.showTitle();
            if (e.code === 'Backquote') {
                this.debugHud.hidden = !this.debugHud.hidden;
            }
        });

        window.addEventListener('resize', () => this.resize());

        this.animate();
    }

    // ---------------- SCENE ----------------

    createScene() {
        this.scene = new THREE.Scene();

        // Fog = the horizon colour (set per zone by the Atmosphere), so
        // distant things melt into the sky - and hide where the world
        // hasn't been built yet.
        const mist = ZONES.trail.palette.horizon;
        this.scene.background = new THREE.Color(mist);
        this.scene.fog = new THREE.FogExp2(mist, 0.0105);
    }

    createCamera() {
        this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight || 16 / 9, 0.1, 200);
        this.camera.position.set(0, 4, 16);
        this.camera.lookAt(0, 1.5, 4);
    }

    createRenderer() {
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(window.innerWidth || 1280, window.innerHeight || 720);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.15;
        this.container.appendChild(this.renderer.domElement);
    }

    // ---------------- POST-PROCESSING ----------------
    // Instead of drawing straight to the screen, draw into an image, then
    // run effects over it:
    //   RenderPass  - draw the scene
    //   Bloom       - anything brighter than `threshold` bleeds soft light
    //   OutputPass  - tone mapping + colour space, done last
    // Bloom runs at half resolution: it's blurry anyway, and 4x cheaper.

    createPostProcessing() {
        const width = window.innerWidth || 1280;   // fallbacks if hidden at startup
        const height = window.innerHeight || 720;

        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloom = new UnrealBloomPass(new THREE.Vector2(width / 2, height / 2), 0.55, 0.5, 0.9);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
    }

    createLights() {
        // Sky light: cool jade from above, deep green bounced from below.
        this.skyLight = new THREE.HemisphereLight('#d8fff0', '#1f4a2c', 2.0);
        this.scene.add(this.skyLight);

        // Warm golden sun - the contrast with the green is the look.
        // It follows the player (updateSun), so shadows work everywhere.
        const sun = new THREE.DirectionalLight('#ffd98a', 3.6);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.left = -40;
        sun.shadow.camera.right = 40;
        sun.shadow.camera.top = 40;
        sun.shadow.camera.bottom = -40;
        this.scene.add(sun);
        this.scene.add(sun.target);
        this.sunlight = sun;

        const fill = new THREE.DirectionalLight('#9de3b0', 1.1);
        fill.position.set(15, 12, -25);
        this.scene.add(fill);
    }

    updateSun() {
        const p = this.player.position;
        this.sunlight.position.set(p.x - 15, p.y + 25, p.z + 12);
        this.sunlight.target.position.copy(p);
    }

    // ---------------- CAMERA ----------------

    updateCamera(dt) {
        if (this.mode === 'title') {
            this.updateTitleCamera(dt);
            return;
        }

        const p = this.player.position;

        // Desired spot: behind (+z), above, and slightly to the right
        // ("over the shoulder") so a rope right in front of the player
        // doesn't block the view. Pull back further while swinging.
        // During a long swing chain, pull back to show more of the flight.
        const swinging = this.player.state === 'swing';
        const chainPull = Math.min(this.player.chain, 4) * 0.6;
        const back = (swinging ? 9 : 6.5) + chainPull;
        const up = (swinging ? 4.5 : 3.2) + chainPull * 0.4;

        // Never rise to branch height: the branches that ropes hang from
        // are ~8.8-9.5 m up, and a camera among them sees only bark.
        this.cameraTarget.set(p.x * 0.6 + 1.6, Math.min(p.y + up, CAMERA_CEILING), p.z + back);

        // Frame-rate independent smoothing: same feel at 30 or 144 fps.
        this.camera.position.lerp(this.cameraTarget, damp(6, dt));

        // Look a little AHEAD of the player. The look point is eased too,
        // so leaving the title screen glides instead of cutting.
        _look.set(p.x, p.y + (swinging ? 0.5 : 1.5), p.z - 4);
        this.cameraLook.lerp(_look, damp(8, dt));
        this.camera.lookAt(this.cameraLook);
    }

    // Attract mode: a slow sweep in front of the lemur, which stands at the
    // trailhead facing us with the jungle behind it. The camera aims a
    // little to the LEFT so the lemur sits right of the title text.
    updateTitleCamera(dt) {
        const centre = _centre.copy(this.player.position);
        centre.y += 1.0;
        const angle = Math.sin(this.time * 0.15) * 0.75;
        const radius = 4.6;

        this.cameraTarget.set(
            centre.x + Math.sin(angle) * radius,
            centre.y + 0.7 + Math.sin(this.time * 0.23) * 0.3,
            centre.z + Math.cos(angle) * radius
        );
        this.camera.position.lerp(this.cameraTarget, damp(2, dt));

        // The camera's "right", flattened onto the ground (from its direction
        // to the lemur), then aim 1.5 m to the left of the lemur.
        _right.subVectors(centre, this.camera.position).setY(0).normalize();
        _right.set(-_right.z, 0, _right.x);
        _look.copy(centre).addScaledVector(_right, -1.5);

        this.cameraLook.lerp(_look, damp(4, dt));
        this.camera.lookAt(this.cameraLook);
    }

    // ---------------- RUN STATE ----------------
    // Everything about the current attempt lives here, so a restart is
    // just "reset these numbers and rebuild the course".

    resetRun() {
        this.run = {
            coins: 0,
            relics: 0,
            time: 0,
            distance: 0,     // furthest point reached
            bestChain: 0,    // longest swing chain this run
            started: false,  // the timer starts on your first move
            over: false      // out of hearts
        };
        this.lastHearts = MAX_HEARTS;
        this.currentZone = null;
    }

    restart() {
        this.resetRun();
        this.collectibles.clear();
        this.course.reset();   // a brand new random course every run
        this.player.reset(new THREE.Vector3(0, 0, START_Z));
        this.hud.hideResults();
    }

    // ---------------- MODES ----------------

    showTitle() {
        this.mode = 'title';
        this.restart();
        this.player.inputEnabled = false;
        this.player.facing = 0; // turn around to face the camera
        this.hud.setVisible(false);
        this.title.refresh(this.best, this.wallet);
        this.title.show();
    }

    startGame() {
        if (this.mode === 'playing') return;

        this.mode = 'playing';
        this.restart();
        // Still facing the camera from the title: the lemur turns round
        // naturally as soon as you start running.
        this.player.facing = 0;
        this.title.hide();
        this.hud.setVisible(true);
        clearTimeout(this.hintTimer);
        this.hud.showHint();

        this.player.inputEnabled = true;
        // The Space press that started the game was also recorded by the
        // player. Throw it away, or the lemur would jump straight away.
        this.player.pressed.clear();
    }

    // ---------------- SAVED DATA ----------------
    // localStorage lives only in this browser and can be blocked (private
    // mode, strict settings), so every access is wrapped.

    loadWallet() {
        try {
            return Number(localStorage.getItem(WALLET_KEY)) || 0;
        } catch {
            return 0;
        }
    }

    bankCoins(amount) {
        this.wallet += amount;
        try {
            localStorage.setItem(WALLET_KEY, String(this.wallet));
        } catch {
            // Not saved, but the game carries on.
        }
    }

    loadBest() {
        try {
            return JSON.parse(localStorage.getItem(BEST_KEY)) ?? null;
        } catch {
            return null;
        }
    }

    saveBest() {
        const best = this.best ?? { distance: 0, relics: 0 };
        best.distance = Math.max(best.distance, this.run.distance);
        best.relics = Math.max(best.relics, this.run.relics);
        this.best = best;

        try {
            localStorage.setItem(BEST_KEY, JSON.stringify(best));
        } catch {
            // Not saved, but the game carries on.
        }
    }

    endRun() {
        this.run.over = true;
        this.run.overAt = this.time;
        this.bankCoins(this.run.coins);
        const previousBest = this.best?.distance ?? 0;
        this.saveBest();
        this.hud.showResults(
            this.run,
            this.run.distance,
            Math.max(previousBest, this.run.distance),
            this.player.falls,
            this.wallet
        );
    }

    // ---------------- PICKUPS ----------------

    onCollect(item) {
        const isRelic = item.type === 'relic';

        // Mid-chain, every coin is worth more: x2 at a 2-link chain, up to x5.
        const worth = Math.min(Math.max(this.player.chain, 1), MAX_COIN_MULTIPLIER);

        if (isRelic) this.run.relics++;
        else this.run.coins += worth;

        // Where is the item on screen? project() turns a 3D point into
        // -1..1 screen coordinates; then convert those to pixels.
        const screen = item.position.clone().project(this.camera);
        const x = (screen.x + 1) / 2 * window.innerWidth;
        const y = (1 - screen.y) / 2 * window.innerHeight;

        if (isRelic) {
            this.hud.popText('EMERALD RELIC!', x, y, 'relic');
            this.hud.bump('relic');
        } else {
            this.hud.popText(`+${worth}`, x, y, worth > 1 ? 'chaincoin' : 'coin');
            this.hud.bump('coin');
        }
    }

    // ---------------- PER-FRAME RUN LOGIC ----------------

    updateRun(dt) {
        const run = this.run;
        const player = this.player;

        // Start the clock (and fade the hint) on the first move.
        if (!run.started && player.state !== 'idle' && this.mode === 'playing') {
            run.started = true;
            clearTimeout(this.hintTimer);
            this.hintTimer = setTimeout(() => this.hud.hideHint(), 6000);
        }

        if (run.started && !run.over) {
            run.time += dt;
            run.distance = Math.max(run.distance, this.course.distanceAt(player.position.z));
        }

        // Pick-ups are checked against the middle of the body.
        // (On a rope the body is tilted, so follow the mesh's tilt.)
        player.mesh.updateMatrixWorld();
        this.playerCenter.set(0, player.centerHeight, 0);
        player.mesh.localToWorld(this.playerCenter);

        if (!run.over) {
            this.collectibles.update(dt, this.time, this.playerCenter, (item) => this.onCollect(item));
        }

        // Plants: each returns where a hit came from, or null.
        for (const enemy of this.course.enemies) {
            const hitFrom = enemy.update(dt, this.time, player, this.playerCenter);
            if (hitFrom && !run.over && this.mode === 'playing') player.takeHit(hitFrom);
        }

        this.handlePlayerEvents();

        // Lost a heart this frame (fall or hit)? Flash the screen.
        if (player.hearts < this.lastHearts) this.hud.hurtFlash();
        this.lastHearts = player.hearts;

        if (!run.over && player.dead) this.endRun();

        // Entered a new zone? Announce it.
        const info = this.course.zoneInfoAt(player.position.z);
        const zone = info.to && info.t > 0.5 ? info.to : info.from;
        if (zone !== this.currentZone) {
            if (this.currentZone && this.mode === 'playing') this.hud.announceZone(zone.name);
            this.currentZone = zone;
        }

        this.hud.update(run, player.hearts, this.wallet, run.distance, zone.name);
    }

    // ---------------- CHAINS & TOOLS ----------------
    // The Player reports what happened this frame (a rope caught, a plant
    // bounce, a landing); here we turn that into rewards and popups.

    handlePlayerEvents() {
        const player = this.player;

        for (const event of player.events) {
            if (event.type === 'link') {
                if (event.kind === 'bounce') this.popAtPlayer('BOUNCE!', 'tool');
                if (event.kind === 'fling') this.popAtPlayer('FLING!', 'tool');

                if (event.count >= 2) this.hud.showChain(event.count);
                this.run.bestChain = Math.max(this.run.bestChain, event.count);
            }

            if (event.type === 'chainEnd') {
                this.hud.hideChain();

                // The payout grows fast: 2 links = 2, 3 = 6, 4 = 12, 5 = 20...
                if (event.count >= 2 && this.mode === 'playing') {
                    const bonus = event.count * (event.count - 1);
                    this.run.coins += bonus;
                    this.popAtPlayer(`CHAIN x${event.count}  +${bonus}`, 'chain');
                    this.hud.bump('coin');
                }
            }
        }

        // A chain broken by a hit or a fall pays nothing.
        if (player.chain === 0) this.hud.hideChain();

        player.events.length = 0;
    }

    popAtPlayer(text, type) {
        const screen = _popAt.copy(this.player.position).setY(this.player.position.y + 2.2).project(this.camera);
        this.hud.popText(text, (screen.x + 1) / 2 * window.innerWidth, (1 - screen.y) / 2 * window.innerHeight, type);
    }

    // The sky, fog and light: the zone's colours (blended across
    // transitions), then the time of day laid on top.
    updatePalette() {
        const info = this.course.zoneInfoAt(this.player.position.z);
        blendPalettes(info.from.palette, info.to?.palette, info.t, this.palette);

        const distance = this.course.distanceAt(this.player.position.z);
        const night = this.timeOverride ?? nightAmount(distance);
        // Sunset glow peaks halfway between day and night.
        const sunset = Math.sin(Math.PI * night) * 0.6;

        for (const [key, color] of Object.entries(SUNSET_TINT)) {
            this.palette[key].lerp(this.tmpColor.set(color), sunset);
        }
        for (const [key, color] of Object.entries(NIGHT_PALETTE)) {
            this.palette[key].lerp(this.tmpColor.set(color), night);
        }

        this.atmosphere.setPalette(this.palette);
        this.atmosphere.setNight(night);
        this.applyDaylight(night, sunset);
    }

    // Lights follow the time of day: warm sun -> orange sunset -> blue moon.
    applyDaylight(night, sunset) {
        const lerp = THREE.MathUtils.lerp;

        this.sunlight.intensity = lerp(3.6, 0.55, night);
        this.sunlight.color.set('#ffd98a')
            .lerp(this.tmpColor.set('#ff9a5a'), sunset)
            .lerp(this.tmpColor.set('#a9c4ff'), night);

        this.skyLight.intensity = lerp(2.0, 0.75, night);
        this.skyLight.color.set('#d8fff0').lerp(this.tmpColor.set('#5a78b0'), night);
        this.skyLight.groundColor.set('#1f4a2c').lerp(this.tmpColor.set('#0f2418'), night);

        this.scene.fog.density = lerp(0.0105, 0.0135, night);
        // Glowing things matter more in the dark: more bloom at night.
        this.bloom.strength = lerp(0.55, 0.85, night);
    }

    // ---------------- DEBUG HUD ----------------
    // Developer readout. Hidden by default; toggle with the ` key.

    createDebugHud() {
        this.debugHud = document.createElement('div');
        this.debugHud.className = 'debug-hud';
        this.debugHud.hidden = true;
        document.body.appendChild(this.debugHud);
    }

    updateDebugHud() {
        if (this.debugHud.hidden) return;
        const p = this.player;
        const info = this.renderer.info.render;

        this.debugHud.textContent =
            `state: ${p.state}   falls: ${p.falls}\n` +
            `pos:   ${p.position.x.toFixed(1)}, ${p.position.y.toFixed(1)}, ${p.position.z.toFixed(1)}\n` +
            `vel:   ${p.velocity.y.toFixed(1)} up, ${(-p.velocity.z).toFixed(1)} forward\n` +
            `chunks: ${this.course.chunks.length}   ropes: ${this.course.ropes.length}   plants: ${this.course.enemies.length}\n` +
            `draws: ${info.calls}   triangles: ${(info.triangles / 1000).toFixed(0)}k` +
            (p.rope ? `\nrope angle: ${THREE.MathUtils.radToDeg(p.rope.angle).toFixed(0)}°` : '');
    }

    // ---------------- SHADER WARM-UP ----------------
    // The GPU needs every material's shader COMPILED before drawing with
    // it, and three.js compiles in the background - an object whose
    // shader isn't ready is simply skipped that frame. So the first time
    // you entered the river, things could pop in (or stutter).
    // Fix: at load, put one tiny sample of every material in the scene,
    // compile them all, then take the samples away again.

    precompileShaders() {
        const samples = new THREE.Group();
        const geometry = new THREE.PlaneGeometry(0.01, 0.01);

        const materials = [
            ...sharedMaterials(),
            ...waterMaterials(),
            new THREE.MeshStandardMaterial({ map: zoneTextures().jungleGround, roughness: 1 })
        ];

        for (const material of materials) {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.frustumCulled = false;
            samples.add(mesh);
        }

        this.scene.add(samples);
        this.renderer.compile(this.scene, this.camera);
        this.scene.remove(samples);
        geometry.dispose();
    }

    // ---------------- LOOP ----------------

    animate() {
        requestAnimationFrame(() => this.animate());

        // dt = seconds since last frame, capped so a tab switch can't
        // produce one giant step.
        const dt = Math.min(this.clock.getDelta(), 0.05);

        this.step(dt);

        // Nothing to draw into while the window has no size (hidden tab).
        if (window.innerWidth && window.innerHeight) {
            this.composer.render(); // scene -> bloom -> screen
        }
    }

    // One tick of the game, separate from drawing.
    step(dt) {
        this.time += dt;
        const time = this.time;

        windUniforms.uTime.value = time;   // GPU wind on every swaying plant

        // Ropes first, then the player reads where the held rope is now.
        for (const rope of this.course.ropes) rope.simulate(dt, time);
        this.player.update(dt);

        // Build the world ahead / clear it behind.
        this.course.update(this.player.position.z, time);

        this.updateRun(dt);
        updateWater(dt, time);
        this.updatePalette();
        this.updateSun();
        this.updateCamera(dt);
        this.atmosphere.update(time, this.camera, this.player.position.z);
        this.updateDebugHud();
    }

    // ---------------- RESIZE ----------------

    resize() {
        // A hidden or collapsed window can report 0 x 0. Resizing the bloom
        // buffers to zero breaks WebGL, so wait for a real size.
        if (!window.innerWidth || !window.innerHeight) return;

        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.composer.setSize(window.innerWidth, window.innerHeight);
        this.bloom.setSize(window.innerWidth / 2, window.innerHeight / 2);
    }
}
