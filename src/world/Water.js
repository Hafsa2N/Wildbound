import * as THREE from 'three';

// ---------------- WATER ----------------
// Rivers and waterfalls, added piece by piece as chunks are built.
//
// The trick: water doesn't need to MOVE to look like it's flowing. We
// paint a streaky texture once, then slide it across the surface every
// frame (texture.offset). Every river in the world shares the same few
// textures, so sliding them once moves all the water at once.

const RIVER_SPEED = 0.12;   // texture widths per second
const FALL_SPEED = 1.1;

// ---------------- PAINTED TEXTURES ----------------

function riverTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#1f9d8f';
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 160; i++) {
        ctx.globalAlpha = 0.08 + Math.random() * 0.2;
        ctx.fillStyle = Math.random() < 0.7 ? '#7fe8d6' : '#0f6f66';
        ctx.beginPath();
        ctx.ellipse(Math.random() * 256, Math.random() * 256,
            10 + Math.random() * 40, 1 + Math.random() * 3, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

function fallTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = 'rgba(200, 255, 245, 0.55)';
    ctx.fillRect(0, 0, 128, 256);

    for (let i = 0; i < 90; i++) {
        const x = Math.random() * 128;
        const width = 1 + Math.random() * 4;
        const top = Math.random() * 256;
        const length = 30 + Math.random() * 120;

        ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + Math.random() * 0.6})`;
        ctx.fillRect(x, top, width, length);
        if (top + length > 256) ctx.fillRect(x, top - 256, width, length); // tile seamlessly
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

// ---------------- SHARED KIT ----------------
// Created on first use, then shared by every river and waterfall.

let kit = null;

function getKit() {
    if (kit) return kit;

    const riverMap = riverTexture();
    riverMap.repeat.set(10, 4);

    const fallMap = fallTexture();
    fallMap.repeat.set(1, 2);

    const streamMap = fallMap.clone();
    streamMap.repeat.set(1, 1);
    streamMap.needsUpdate = true;

    kit = {
        riverMap,
        fallMap,
        streamMap,
        river: new THREE.MeshStandardMaterial({
            map: riverMap,
            color: '#9fd8cc',
            roughness: 0.12,
            metalness: 0.1
        }),
        // Unlit, so falling water stays bright even in a shady ravine.
        fall: new THREE.MeshBasicMaterial({
            map: fallMap, transparent: true, depthWrite: false, side: THREE.DoubleSide
        }),
        stream: new THREE.MeshBasicMaterial({
            map: streamMap, color: '#9ff0e0', transparent: true, depthWrite: false
        }),
        foam: new THREE.MeshStandardMaterial({
            color: '#f2fffb', roughness: 0.9, transparent: true, opacity: 0.85
        }),
        foamGeometry: new THREE.SphereGeometry(0.5, 10, 6),
        mist: createMistMaterial()
    };

    return kit;
}

// Rising spray: points drift up and fade, looping forever, all on the GPU.
function createMistMaterial() {
    return new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
            uniform float uTime;
            attribute float seed;
            varying float vLife;
            void main() {
                float life = fract(uTime * 0.35 + seed);
                vec3 p = position;
                p.y += life * 2.5;
                p.x += sin(seed + uTime) * 0.3 * life;
                p.z += life * 0.8;
                vLife = life;
                vec4 mv = modelViewMatrix * vec4(p, 1.0);
                gl_Position = projectionMatrix * mv;
                gl_PointSize = (40.0 + 80.0 * life) / -mv.z;
            }
        `,
        fragmentShader: /* glsl */ `
            varying float vLife;
            void main() {
                float d = length(gl_PointCoord - 0.5);
                float a = smoothstep(0.5, 0.0, d) * (1.0 - vLife) * 0.35;
                gl_FragColor = vec4(vec3(0.92, 1.0, 0.97), a);
            }
        `
    });
}

// The water materials (used to pre-compile shaders).
export function waterMaterials() {
    const k = getKit();
    return [k.river, k.fall, k.stream, k.foam];
}

// ---------------- BUILDING BLOCKS ----------------

// A flat strip of flowing water between two z values.
export function addRiver(parent, zFrom, zTo, y, width = 160) {
    const length = Math.abs(zFrom - zTo);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), getKit().river);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, y, (zFrom + zTo) / 2);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
}

// A waterfall pouring down a cliff face at `wallZ` (the face looks toward
// +z, at the player). Returns the foam blobs so the chunk can animate them.
export function addWaterfall(parent, x, wallZ, width, top = 0.02, bottom = -6.5) {
    const k = getKit();
    const height = top - bottom;

    // The falling sheet, bowed slightly out from the rock
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(width, height, 1, 8), k.fall);
    const pos = sheet.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const t = (pos.getY(i) + height / 2) / height; // 0 bottom .. 1 top
        pos.setZ(i, Math.sin(t * Math.PI) * 0.35 + (1 - t) * 0.5);
    }
    sheet.geometry.computeVertexNormals();
    sheet.position.set(x, bottom + height / 2, wallZ + 0.12);
    sheet.userData.owned = true; // its geometry is its own: freed with the chunk
    parent.add(sheet);

    // The stream on top, flowing toward the edge
    const stream = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.9, 4), k.stream);
    stream.rotation.x = -Math.PI / 2;
    stream.position.set(x, top + 0.01, wallZ - 2);
    stream.userData.owned = true;
    parent.add(stream);

    // Churning foam where it lands
    const foam = [];
    for (let i = 0; i < 5; i++) {
        const blob = new THREE.Mesh(k.foamGeometry, k.foam);
        blob.position.set(x + (Math.random() - 0.5) * width, bottom + 0.05, wallZ + 0.7 + Math.random() * 0.8);
        parent.add(blob);
        foam.push({ mesh: blob, phase: Math.random() * 10, size: 0.6 + Math.random() * 0.6 });
    }

    // Mist
    const count = 60;
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        positions[i * 3] = x + (Math.random() - 0.5) * 3;
        positions[i * 3 + 1] = bottom;
        positions[i * 3 + 2] = wallZ + 0.8 + Math.random() * 1.5;
        seeds[i] = Math.random() * 100;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
    const mist = new THREE.Points(geometry, k.mist);
    mist.frustumCulled = false;
    mist.userData.owned = true;
    parent.add(mist);

    return foam;
}

// Churn the foam blobs a chunk owns.
export function animateFoam(foam, time) {
    for (const f of foam) {
        const pulse = 1 + Math.sin(time * 6 + f.phase) * 0.18;
        f.mesh.scale.set(f.size * pulse, f.size * 0.45 * pulse, f.size * pulse);
    }
}

// Once per frame: slide the shared textures. This IS the flowing.
export function updateWater(dt, time) {
    const k = getKit();
    k.riverMap.offset.x -= RIVER_SPEED * dt;
    k.fallMap.offset.y += FALL_SPEED * dt;
    k.streamMap.offset.y += 0.5 * dt;
    k.mist.uniforms.uTime.value = time;
}
