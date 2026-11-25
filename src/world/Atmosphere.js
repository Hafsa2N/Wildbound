import * as THREE from 'three';
import { smoothstep } from '../utils/math.js';

// ---------------- ATMOSPHERE ----------------
// The things that make a scene feel like a PLACE: sky, distance, light in
// the air, things floating in it.
//
// In the endless run all of it travels WITH you (the sky, ridges and
// floating motes follow the player's z), and its colours BLEND between
// zones: walk from the jungle into the river crossing and the whole sky
// shifts. The palette is the zone's identity.

// Direction the sunlight TRAVELS (from the sun toward the ground).
// Matches the sun light's offset in Game.updateSun().
const SUN_DIRECTION = new THREE.Vector3(15, -25, -12).normalize();

// ---------------- DAY & NIGHT ----------------
// The further you run, the later it gets. The cycle repeats:
//   day -> sunset -> night -> dawn -> day ...
const DAY_CYCLE = {
    length: 1600,     // metres for one full day
    duskStart: 700,
    nightStart: 900,
    dawnStart: 1400
};

// The colours of night (blended in on top of the zone's own palette).
export const NIGHT_PALETTE = {
    zenith: '#0b1730',
    horizon: '#1c3340',
    below: '#0b1a17',
    sunGlow: '#9fb4ff',   // a cool moon glow
    ridgeNear: '#14261f',
    ridgeFar: '#1d3532'
};

// Warm sunset colours, strongest halfway through dusk and dawn.
export const SUNSET_TINT = {
    horizon: '#f2a37c',
    sunGlow: '#ffb36b',
    ridgeFar: '#c98a74'
};

// 0 = full day, 1 = full night, for a distance in metres.
export function nightAmount(distance) {
    const c = DAY_CYCLE;
    const d = ((distance % c.length) + c.length) % c.length;

    if (d < c.duskStart) return 0;
    if (d < c.nightStart) return smoothstep((d - c.duskStart) / (c.nightStart - c.duskStart));
    if (d < c.dawnStart) return 1;
    return 1 - smoothstep((d - c.dawnStart) / (c.length - c.dawnStart));
}

const SHAFT_COUNT = 16;
const SHAFT_SPACING = 7;
const SHAFT_SPAN = SHAFT_COUNT * SHAFT_SPACING; // shafts recycle over this length
const MOTE_SPAN = 120;                          // pollen/fireflies wrap over this

export default class Atmosphere {
    constructor(scene) {
        this.scene = scene;
        this.shafts = [];
        this.night = 0;   // 0 day .. 1 night (set by setNight)

        this.createSky();
        this.createRidges();
        this.createLightShafts();
        this.pollen = this.createMotes(800, '#fff4b8', 0.55, 0.6, 7, 30);
        // Fireflies: fewer, bigger, HDR-bright so bloom makes them glow.
        this.fireflies = this.createMotes(120, '#e5ff91', 2.2, 1.0, 6, 55);
    }

    // ---------------- SKY ----------------
    // A huge sphere seen from the inside, coloured by a tiny shader:
    // blend by how high you're looking, plus a glow toward the sun.

    createSky() {
        this.skyMaterial = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
            uniforms: {
                uZenith: { value: new THREE.Color() },
                uHorizon: { value: new THREE.Color() },
                uBelow: { value: new THREE.Color() },
                uSunGlow: { value: new THREE.Color() },
                uToSun: { value: SUN_DIRECTION.clone().negate() }
            },
            vertexShader: /* glsl */ `
                varying vec3 vDirection;
                void main() {
                    vDirection = normalize(position);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform vec3 uZenith, uHorizon, uBelow, uSunGlow, uToSun;
                varying vec3 vDirection;
                void main() {
                    float h = vDirection.y;
                    vec3 color = h > 0.0
                        ? mix(uHorizon, uZenith, pow(h, 0.55))
                        : mix(uHorizon, uBelow, pow(-h, 0.5));
                    float sun = max(dot(vDirection, uToSun), 0.0);
                    color += uSunGlow * (pow(sun, 8.0) * 0.35 + pow(sun, 64.0) * 0.6);
                    gl_FragColor = vec4(color, 1.0);
                    #include <colorspace_fragment>
                }
            `
        });

        this.sky = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), this.skyMaterial);
        this.sky.renderOrder = -1;
        this.scene.add(this.sky);
    }

    // ---------------- DISTANT RIDGES ----------------
    // Flat silhouettes with bumpy tops. Fog fades the far ones more,
    // which is exactly what makes them read as "far away". They travel
    // with the player, so they always sit on the horizon.

    createRidges() {
        this.ridges = new THREE.Group();
        this.scene.add(this.ridges);
        this.ridgeNear = new THREE.MeshBasicMaterial({ fog: true });
        this.ridgeFar = new THREE.MeshBasicMaterial({ fog: true });

        const ridge = (width, height, seed, material, x, z, rotationY) => {
            const shape = new THREE.Shape();
            const steps = 60;
            shape.moveTo(-width / 2, -10);
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                const bumps =
                    Math.sin(t * 9 + seed) * 0.35 +
                    Math.sin(t * 23 + seed * 2) * 0.15 +
                    Math.sin(t * 4.3 + seed * 3) * 0.5;
                shape.lineTo(-width / 2 + t * width, height * (0.65 + bumps * 0.45));
            }
            shape.lineTo(width / 2, -10);

            const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
            mesh.position.set(x, 0, z);
            mesh.rotation.y = rotationY;
            this.ridges.add(mesh);
        };

        // Positions RELATIVE to the player
        ridge(320, 26, 1.0, this.ridgeNear, 0, -136, 0);
        ridge(380, 40, 4.2, this.ridgeFar, 0, -166, 0);
        ridge(260, 22, 2.5, this.ridgeNear, -72, -50, Math.PI / 2);
        ridge(260, 24, 6.1, this.ridgeNear, 72, -50, -Math.PI / 2);
    }

    // ---------------- LIGHT SHAFTS ----------------
    // Cones of additive light angled along the sun, faded at the ends
    // and edges by a small shader. They recycle: one that falls behind
    // the player jumps ahead again.

    createLightShafts() {
        const geometry = new THREE.CylinderGeometry(0.7, 2.4, 16, 20, 1, true).translate(0, -8, 0);
        const tilt = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), SUN_DIRECTION);

        for (let i = 0; i < SHAFT_COUNT; i++) {
            const material = new THREE.ShaderMaterial({
                transparent: true,
                depthWrite: false,
                side: THREE.DoubleSide,
                blending: THREE.AdditiveBlending,
                uniforms: {
                    uColor: { value: new THREE.Color('#ffe7a6') },
                    uOpacity: { value: 0.12 }
                },
                vertexShader: /* glsl */ `
                    varying vec2 vUv;
                    varying vec3 vNormal;
                    varying vec3 vView;
                    void main() {
                        vUv = uv;
                        vec4 mv = modelViewMatrix * vec4(position, 1.0);
                        vNormal = normalize(normalMatrix * normal);
                        vView = normalize(-mv.xyz);
                        gl_Position = projectionMatrix * mv;
                    }
                `,
                fragmentShader: /* glsl */ `
                    uniform vec3 uColor;
                    uniform float uOpacity;
                    varying vec2 vUv;
                    varying vec3 vNormal;
                    varying vec3 vView;
                    void main() {
                        float edge = abs(dot(normalize(vNormal), normalize(vView)));
                        float ends = smoothstep(0.0, 0.45, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
                        float a = edge * edge * ends * uOpacity;
                        gl_FragColor = vec4(uColor * a, a);
                    }
                `
            });

            const shaft = new THREE.Mesh(geometry, material);
            shaft.position.set((Math.random() - 0.5) * 14 - 4, 15, 6 - i * SHAFT_SPACING - Math.random() * 3);
            shaft.quaternion.copy(tilt);
            this.scene.add(shaft);

            this.shafts.push({ mesh: shaft, material, phase: Math.random() * 10, base: 0.16 + Math.random() * 0.1 });
        }
    }

    // ---------------- FLOATING MOTES ----------------
    // Hundreds of points in ONE draw call. Drift AND wrap-around are both
    // done in the shader: each mote's z is folded into a 120 m window
    // centred on the player, so the cloud never runs out.

    createMotes(count, color, brightness, size, height, width) {
        const positions = new Float32Array(count * 3);
        const seeds = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            positions[i * 3] = (Math.random() - 0.5) * width;
            positions[i * 3 + 1] = 0.3 + Math.random() * height;
            positions[i * 3 + 2] = Math.random() * MOTE_SPAN;
            seeds[i] = Math.random() * 100;
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));

        const material = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
                uTime: { value: 0 },
                uCentreZ: { value: 0 },
                uSpan: { value: MOTE_SPAN },
                uSize: { value: size },
                // Above 1.0 = "HDR": bloom makes it glow
                uColor: { value: new THREE.Color(color).multiplyScalar(brightness) },
                uGlow: { value: 1 },   // scaled by time of day
                uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }
            },
            vertexShader: /* glsl */ `
                uniform float uTime, uCentreZ, uSpan, uSize, uPixelRatio;
                attribute float seed;
                varying float vTwinkle;
                void main() {
                    vec3 p = position;
                    p.x += sin(uTime * 0.3 + seed) * 0.6;
                    p.y += sin(uTime * 0.2 + seed * 1.7) * 0.5;
                    // Fold z into a window around the player (wrap-around)
                    float start = uCentreZ - uSpan * 0.75;
                    p.z = start + mod(p.z + cos(uTime * 0.25 + seed * 0.9) * 0.6 - start, uSpan);
                    vec4 mv = modelViewMatrix * vec4(p, 1.0);
                    gl_Position = projectionMatrix * mv;
                    gl_PointSize = (0.6 + fract(seed) * 0.9) * 30.0 * uSize * uPixelRatio / -mv.z;
                    vTwinkle = 0.55 + 0.45 * sin(uTime * 2.0 + seed * 5.0);
                }
            `,
            fragmentShader: /* glsl */ `
                uniform vec3 uColor;
                uniform float uGlow;
                varying float vTwinkle;
                void main() {
                    float d = length(gl_PointCoord - 0.5);
                    float a = smoothstep(0.5, 0.0, d) * 0.55 * vTwinkle * uGlow;
                    gl_FragColor = vec4(uColor * a, a);
                }
            `
        });

        const points = new THREE.Points(geometry, material);
        points.frustumCulled = false;
        this.scene.add(points);
        return material;
    }

    // ---------------- PALETTE ----------------
    // Apply a set of colours (already blended between zones by the caller).

    setPalette(palette) {
        const u = this.skyMaterial.uniforms;
        u.uZenith.value.copy(palette.zenith);
        u.uHorizon.value.copy(palette.horizon);
        u.uBelow.value.copy(palette.below);
        u.uSunGlow.value.copy(palette.sunGlow);

        this.ridgeNear.color.copy(palette.ridgeNear);
        this.ridgeFar.color.copy(palette.ridgeFar);

        // Fog = horizon colour, so distant things melt into the sky.
        this.scene.fog.color.copy(palette.horizon);
        this.scene.background.copy(palette.horizon);
    }

    // Night: fireflies shine brighter, pollen fades, sun shafts vanish.
    setNight(n) {
        this.night = n;
        this.fireflies.uniforms.uGlow.value = 1 + n * 2.5;
        this.pollen.uniforms.uGlow.value = 1 - n * 0.7;
    }

    // ---------------- UPDATE ----------------

    update(time, camera, focusZ) {
        this.sky.position.copy(camera.position);
        this.ridges.position.z = focusZ;

        for (const material of [this.pollen, this.fireflies]) {
            material.uniforms.uTime.value = time;
            material.uniforms.uCentreZ.value = focusZ;
        }

        for (const shaft of this.shafts) {
            // Recycle shafts that fell behind to the far end
            if (shaft.mesh.position.z > focusZ + 20) shaft.mesh.position.z -= SHAFT_SPAN;

            shaft.material.uniforms.uOpacity.value =
                shaft.base * (0.7 + 0.3 * Math.sin(time * 0.4 + shaft.phase)) * (1 - this.night);
        }
    }
}

// Blend two zone palettes (hex strings) into Colors. t = 0..1.
const _a = new THREE.Color();
const _b = new THREE.Color();

export function blendPalettes(from, to, t, out = {}) {
    for (const key of Object.keys(from)) {
        out[key] = out[key] ?? new THREE.Color();
        _a.set(from[key]);
        _b.set(to ? to[key] : from[key]);
        out[key].copy(_a).lerp(_b, t);
    }
    return out;
}
