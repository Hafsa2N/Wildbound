import * as THREE from 'three';

// ---------------- PAINTED TEXTURES ----------------
// Textures drawn with the 2D canvas API at startup - no image files.
// Painted once, then shared (each mesh clones it only to set its own
// tiling; clones share the same image on the GPU).

const SIZE = 512;

function finish(canvas) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8; // stays sharp when seen at a low angle
    return texture;
}

// Soil / moss: a base colour with thousands of little speckles and blotches.
function speckleTexture(baseColor, colors, speckles = 18000) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, SIZE, SIZE);

    for (let i = 0; i < speckles; i++) {
        ctx.globalAlpha = 0.12 + Math.random() * 0.28;
        ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        ctx.beginPath();
        ctx.arc(Math.random() * SIZE, Math.random() * SIZE, 0.5 + Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
    }

    for (let i = 0; i < 250; i++) {
        ctx.globalAlpha = 0.08 + Math.random() * 0.12;
        ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
        ctx.beginPath();
        ctx.ellipse(
            Math.random() * SIZE, Math.random() * SIZE,
            3 + Math.random() * 12, 2 + Math.random() * 7,
            Math.random() * Math.PI, 0, Math.PI * 2
        );
        ctx.fill();
    }

    ctx.globalAlpha = 1;
    return finish(canvas);
}

// Old paving stones: irregular rectangles with dark mortar and moss.
function stoneTileTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#3b3f34'; // mortar
    ctx.fillRect(0, 0, SIZE, SIZE);

    const rows = 6;
    const rowHeight = SIZE / rows;

    for (let r = 0; r < rows; r++) {
        let x = r % 2 === 0 ? 0 : -rowHeight * 0.6;
        while (x < SIZE) {
            const w = rowHeight * (0.9 + Math.random() * 0.9);
            const shade = 105 + Math.floor(Math.random() * 40);
            ctx.fillStyle = `rgb(${shade}, ${shade + 6}, ${shade - 8})`;
            ctx.fillRect(x + 4, r * rowHeight + 4, w - 8, rowHeight - 8);

            // Moss creeping in from the cracks
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = '#5d7a3a';
            for (let k = 0; k < 6; k++) {
                ctx.beginPath();
                ctx.arc(x + Math.random() * w, r * rowHeight + (Math.random() < 0.5 ? 6 : rowHeight - 6),
                    3 + Math.random() * 7, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            x += w;
        }
    }

    return finish(canvas);
}

// Every zone's ground and path, painted once on first use.
let cache = null;

export function zoneTextures() {
    if (cache) return cache;

    cache = {
        jungleGround: speckleTexture('#53643b', ['#263f25', '#71804a', '#849052', '#40552e', '#9a9856']),
        dirtPath: speckleTexture('#806044', ['#493624', '#a17a4f', '#68482f', '#b18b5e', '#57412e'], 14000),
        riverBank: speckleTexture('#4c5e34', ['#2f4424', '#6b7a3f', '#5a4a30', '#3e5a2c'], 14000),
        ruinGround: speckleTexture('#4a5236', ['#2d3522', '#62703f', '#5b5a44', '#3a4a2a'], 14000),
        stonePath: stoneTileTexture(),
        cliff: speckleTexture('#4d3726', ['#2e2016', '#6b4e33', '#3d2c1e', '#5a6b36'], 9000),
        ruinCliff: speckleTexture('#575a4c', ['#3b3d33', '#73766a', '#4e5a3c', '#2f3129'], 9000)
    };

    return cache;
}
