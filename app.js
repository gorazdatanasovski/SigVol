import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let playbackData = [];
let currentIndex = 0;
let totalEvents = 0;

// DOM Elements
const elTimestamp = document.getElementById('top-timestamp');
const elSpot = document.getElementById('val-spot');
const elVix = document.getElementById('val-vix');
const elDelta = document.getElementById('val-delta');
const elGamma = document.getElementById('val-gamma');
const elVega = document.getElementById('val-vega');
const consoleOutput = document.getElementById('console-output');
const elLogCount = document.getElementById('log-count');

// Voltage Bars
const barSpot = document.getElementById('bar-spot');
const barDelta = document.getElementById('bar-delta');
const barGamma = document.getElementById('bar-gamma');
const barVega = document.getElementById('bar-vega');

// Tooltip Elements
const tooltip = document.getElementById('custom-tooltip');
const ttStrike = document.getElementById('tt-strike');
const ttDte = document.getElementById('tt-dte');
const ttIv = document.getElementById('tt-iv');

const MAX_LOG_ENTRIES = 50;

// Three.js State
let scene, camera, renderer, controls;
let surfaceMesh;
let geometry;
let current_IV = [];
let target_IV = [];
let gridX = 0;
let gridY = 0;
let strikesList = [];
let dtesList = [];
let ripples = [];
let crosshair;
let surfaceGroup;
let floorMesh, backWallMesh, leftWallMesh;
let axisData = [];
let ticksMesh, gridsMesh;
let sparseMesh, spineMesh, spineGlowMesh, rimMesh, crosshairMesh;
let glowSpriteCore, glowSpriteCorona;
let particlesMesh, particlesData = [];

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const container = document.getElementById('surface-container');

fetch('market_playback.json')
    .then(response => response.json())
    .then(data => {
        playbackData = data;
        if (playbackData.length > 0) {
            initThreeJS();
            initDashboard();
        }
    });

function makeTextSprite(message) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext('2d');
    context.font = '500 36px "JetBrains Mono", monospace'; // Mono, precise
    context.fillStyle = 'rgba(255,255,255,0.35)'; // Muted
    context.textAlign = 'center';
    
    const spacedMessage = message.split('').join(' ');
    context.fillText(spacedMessage, 256, 75);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMaterial = new THREE.SpriteMaterial({ 
        map: texture, 
        transparent: true,
        depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    
    // Baseline anchored, tiny labels (9px equivalent)
    sprite.scale.set(0.25, 0.0625, 1.0);
    return sprite;
}

function makeAxisLabel(message) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const context = canvas.getContext('2d');
    context.font = '400 24px "JetBrains Mono", monospace';
    context.fillStyle = 'rgba(255, 255, 255, 0.35)'; // White at 35% opacity
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(message, 128, 32);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const spriteMaterial = new THREE.SpriteMaterial({ 
        map: texture, 
        transparent: true,
        depthWrite: false
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(0.25, 0.0625, 1.0); // 9px equivalent
    return sprite;
}

function createEdgeAlphaTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 512, 512);
    
    const edgeSize = 51; // Reduced to 10% from 15%
    
    let gLeft = ctx.createLinearGradient(0, 0, edgeSize, 0);
    gLeft.addColorStop(0, 'rgba(0,0,0,1)');
    gLeft.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gLeft;
    ctx.fillRect(0, 0, edgeSize, 512);
    
    let gRight = ctx.createLinearGradient(512-edgeSize, 0, 512, 0);
    gRight.addColorStop(0, 'rgba(0,0,0,0)');
    gRight.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gRight;
    ctx.fillRect(512-edgeSize, 0, edgeSize, 512);
    
    let gTop = ctx.createLinearGradient(0, 0, 0, edgeSize);
    gTop.addColorStop(0, 'rgba(0,0,0,1)');
    gTop.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gTop;
    ctx.fillRect(0, 0, 512, edgeSize);
    
    let gBot = ctx.createLinearGradient(0, 512-edgeSize, 0, 512);
    gBot.addColorStop(0, 'rgba(0,0,0,0)');
    gBot.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gBot;
    ctx.fillRect(0, 512-edgeSize, 512, edgeSize);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    return texture;
}

function createGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.2, 'rgba(255,255,255,0.8)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,64,64);
    return new THREE.CanvasTexture(canvas);
}

let meshColorsCache = [];
function generateMeshColorCache() {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 256, 0, 0);
    // DIRECTIVE 1: Re-anchored Floor
    gradient.addColorStop(0.00, '#1e4060'); 
    gradient.addColorStop(0.20, '#2a5c8a'); 
    gradient.addColorStop(0.40, '#3478b0'); 
    gradient.addColorStop(0.60, '#4a9fd4'); 
    // DIRECTIVE 4: Power-law Peak Approach
    gradient.addColorStop(0.70, '#4a9fd4'); 
    gradient.addColorStop(0.78, '#6cbde8'); 
    gradient.addColorStop(0.85, '#90d4f5'); 
    gradient.addColorStop(0.91, '#beeeff'); 
    gradient.addColorStop(0.96, '#e4f8ff'); 
    gradient.addColorStop(1.00, '#ffffff'); 
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 256);
    const data = ctx.getImageData(0, 0, 1, 256).data;
    for (let i = 0; i < 256; i++) {
        const idx = (255 - i) * 4; 
        let r = data[idx], g = data[idx+1], b = data[idx+2];
        // DIRECTIVE 3: Mesh Visibility Floor (#2a5878 -> 42, 88, 120)
        r = Math.max(r, 42);
        g = Math.max(g, 88);
        b = Math.max(b, 120);
        const c = new THREE.Color(`rgb(${r}, ${g}, ${b})`);
        meshColorsCache.push(c);
    }
}

function createIsolineTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    
    // DIRECTIVE 1 & 4: Floor and Power-law Peak
    const gradient = ctx.createLinearGradient(0, 1024, 0, 0);
    gradient.addColorStop(0.00, '#1e4060'); 
    gradient.addColorStop(0.20, '#2a5c8a'); 
    gradient.addColorStop(0.40, '#3478b0'); 
    gradient.addColorStop(0.60, '#4a9fd4'); 
    gradient.addColorStop(0.70, '#4a9fd4'); 
    gradient.addColorStop(0.78, '#6cbde8'); 
    gradient.addColorStop(0.85, '#90d4f5'); 
    gradient.addColorStop(0.91, '#beeeff'); 
    gradient.addColorStop(0.96, '#e4f8ff'); 
    gradient.addColorStop(1.00, '#ffffff'); 
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 1024);
    
    // DIRECTIVE 2: Skew Cyan Shift (Put Wing)
    const cyanGradient = ctx.createLinearGradient(0, 1024, 0, 0);
    cyanGradient.addColorStop(0.00, '#15324d'); 
    cyanGradient.addColorStop(0.20, '#204a6e'); 
    cyanGradient.addColorStop(0.40, '#2a8ab0'); // +12 Green hue shift
    cyanGradient.addColorStop(0.60, '#3aa6d4'); 
    cyanGradient.addColorStop(0.70, 'rgba(74, 159, 212, 0)'); 
    cyanGradient.addColorStop(1.00, 'rgba(255, 255, 255, 0)');

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 256;
    maskCanvas.height = 1024;
    const mCtx = maskCanvas.getContext('2d');
    mCtx.fillStyle = cyanGradient;
    mCtx.fillRect(0, 0, 256, 1024);
    
    mCtx.globalCompositeOperation = 'destination-in';
    const hGrad = mCtx.createLinearGradient(0, 0, 256, 0);
    hGrad.addColorStop(0.0, 'rgba(0,0,0,1)'); // Solid on put wing
    hGrad.addColorStop(0.35, 'rgba(0,0,0,0)'); // Fade before ATM
    hGrad.addColorStop(1.0, 'rgba(0,0,0,0)');
    mCtx.fillStyle = hGrad;
    mCtx.fillRect(0, 0, 256, 1024);
    
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(maskCanvas, 0, 0);
    
    // Topographic Contours (70th, 85th, 95th)
    ctx.fillStyle = 'rgba(160, 228, 255, 0.28)';
    ctx.fillRect(0, Math.floor(1024 * (1 - 0.70)), 256, 2);
    ctx.fillStyle = 'rgba(160, 228, 255, 0.38)';
    ctx.fillRect(0, Math.floor(1024 * (1 - 0.85)), 256, 2);
    ctx.fillStyle = 'rgba(160, 228, 255, 0.50)';
    ctx.fillRect(0, Math.floor(1024 * (1 - 0.95)), 256, 2);
    
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    return texture;
}

function initThreeJS() {
    const width = container.clientWidth;
    const height = container.clientHeight;

    scene = new THREE.Scene();
    scene.background = new THREE.Color('#07090F');

    camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    
    // DIRECTIVE 5: Camera Realignment (Pulled back 20%, Lowered 6deg)
    camera.position.set(3.77, -2.54, 2.42); 
    camera.up.set(0, 0, 1);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = false;
    controls.enableDamping = true;

    // DIRECTIVE 4: Introduce directional lighting / Phong shading
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.1); // Near black ambient
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(-100, -100, 100); // Upper-left conceptual
    scene.add(dirLight);

    const firstFrame = playbackData[0];
    strikesList = [...new Set(firstFrame.vol_surface.map(item => item.strike))].sort((a, b) => a - b);
    dtesList = [...new Set(firstFrame.vol_surface.map(item => item.dte))].sort((a, b) => a - b);
    
    gridX = strikesList.length;
    gridY = dtesList.length;

    geometry = new THREE.PlaneGeometry(2, 2, gridX - 1, gridY - 1);
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(gridX * gridY * 3).fill(1), 3));
    
    const pbrTexture = createIsolineTexture();
    
    // DIRECTIVE 4: Phong Shading and Edge Dissolve
    const material = new THREE.MeshPhongMaterial({ 
        map: pbrTexture,
        vertexColors: true,
        emissiveMap: pbrTexture,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.05, 
        specular: new THREE.Color('#e8edf5'), // Cold white highlight
        shininess: 60,
        alphaMap: createEdgeAlphaTexture(), // DIRECTIVE 5: Edge dissolve
        transparent: true,
        side: THREE.DoubleSide
    });

    surfaceGroup = new THREE.Group();
    scene.add(surfaceGroup);

    surfaceMesh = new THREE.Mesh(geometry, material);
    surfaceGroup.add(surfaceMesh);

    generateMeshColorCache();

    // DIRECTIVE 2: Peak Bloom as Property, not Object
    const coreMat = new THREE.SpriteMaterial({
        map: createGlowTexture(), color: 0xffffff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending
    });
    glowSpriteCore = new THREE.Sprite(coreMat);
    glowSpriteCore.scale.set(0.06, 0.06, 1); // 3px tight core
    surfaceGroup.add(glowSpriteCore);

    const coronaMat = new THREE.SpriteMaterial({
        map: createGlowTexture(), color: 0xe8f6ff, transparent: true, opacity: 0.09, depthWrite: false, blending: THREE.AdditiveBlending
    });
    glowSpriteCorona = new THREE.Sprite(coronaMat);
    glowSpriteCorona.scale.set(0.21, 0.21, 1); // 12px soft corona
    surfaceGroup.add(glowSpriteCorona);
    
    // LIGHT TRANSMISSION PARTICLES
    particlesMesh = new THREE.Group();
    surfaceGroup.add(particlesMesh);
    for (let i = 0; i < 20; i++) {
        const mat = new THREE.SpriteMaterial({
            map: createGlowTexture(), color: 0xb8e8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(0.02, 0.02, 1); // 1.5 - 2px
        particlesMesh.add(sprite);
        particlesData.push({
            sprite: sprite,
            active: false,
            life: 0,
            lifespan: 0,
            baseOpacity: 0,
            velocity: new THREE.Vector3()
        });
    }
    
    // DIRECTIVE 5: Crosshair at Peak
    const crossGeo = new THREE.BufferGeometry();
    const crossSize = 0.05; // visually small gunsight
    crossGeo.setAttribute('position', new THREE.Float32BufferAttribute([
        -crossSize, 0, 0,  crossSize, 0, 0,
        0, -crossSize, 0,  0, crossSize, 0
    ], 3));
    const crossMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4 });
    crosshairMesh = new THREE.LineSegments(crossGeo, crossMat);
    surfaceGroup.add(crosshairMesh);

    // DIRECTIVE 7: Floor to 4x4 maximum, near-invisible dark tone
    floorMesh = new THREE.GridHelper(2, 4, 0x1a1d24, 0x1a1d24);
    floorMesh.material.opacity = 1.0;
    floorMesh.material.transparent = true;
    floorMesh.rotation.x = Math.PI / 2; // Align to local XY plane
    surfaceGroup.add(floorMesh);

    // DIRECTIVE 2.8: The Panel Frames (Crisp Borders and Smoked Glass)
    const glassMaterial = new THREE.MeshPhysicalMaterial({
        color: 0x1A233A, // Smoked glass slate
        transparent: true,
        opacity: 0.35, // Hardcode the wall contrast
        roughness: 0.1,
        metalness: 0.2,
        side: THREE.DoubleSide
    });

    const wallGeo = new THREE.PlaneGeometry(1, 1);
    const edgesGeo = new THREE.EdgesGeometry(wallGeo);
    const edgesMat = new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.25, transparent: true }); // Crisp 1px solid white border

    // Back Wall
    backWallMesh = new THREE.Mesh(wallGeo, glassMaterial);
    backWallMesh.add(new THREE.LineSegments(edgesGeo, edgesMat)); // Crisp Perimeter
    backWallMesh.rotation.x = Math.PI / 2;
    surfaceGroup.add(backWallMesh);

    // Left Wall
    leftWallMesh = new THREE.Mesh(wallGeo, glassMaterial);
    leftWallMesh.add(new THREE.LineSegments(edgesGeo, edgesMat)); // Crisp Perimeter
    leftWallMesh.rotation.x = Math.PI / 2;
    leftWallMesh.rotation.y = Math.PI / 2;
    surfaceGroup.add(leftWallMesh);

    // Crosshair for tooltip
    const crosshairGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-0.05, 0, 0), new THREE.Vector3(0.05, 0, 0),
        new THREE.Vector3(0, -0.05, 0), new THREE.Vector3(0, 0.05, 0),
        new THREE.Vector3(0, 0, -0.05), new THREE.Vector3(0, 0, 0.05)
    ]);
    const crosshairMat = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
    crosshair = new THREE.LineSegments(crosshairGeo, crosshairMat);
    crosshair.visible = false;
    scene.add(crosshair);

    current_IV = new Array(gridX * gridY).fill(0);
    target_IV = new Array(gridX * gridY).fill(0);

    updateTargetIV(firstFrame);
    for(let i=0; i<current_IV.length; i++) {
        current_IV[i] = isNaN(target_IV[i]) ? 0 : target_IV[i];
    }
    
    window.addEventListener('resize', onWindowResize, false);
    container.addEventListener('mousemove', onMouseMove, false);
    container.addEventListener('mouseleave', () => { 
        tooltip.style.display = 'none'; 
        crosshair.visible = false;
    }, false);

    animate();
}

function updateTargetIV(frame) {
    if (!frame || !frame.vol_surface) return;
    
    frame.vol_surface.forEach(item => {
        const xIdx = strikesList.indexOf(item.strike);
        const yIdx = dtesList.indexOf(item.dte);
        
        if (xIdx !== -1 && yIdx !== -1) {
            const index = yIdx * gridX + xIdx;
            target_IV[index] = parseFloat(item.iv);
        }
    });
}

function animate() {
    requestAnimationFrame(animate);

    if (geometry) {
        const positions = geometry.attributes.position.array;
        const uvs = geometry.attributes.uv.array;
        
        // Advance ripples
        for (let r = ripples.length - 1; r >= 0; r--) {
            ripples[r].time += 0.016; // approx 60fps delta
            if (ripples[r].time > 0.3) {
                ripples.splice(r, 1);
            }
        }

        let maxZ = -Infinity;
        let maxX = 0, maxY = 0;

        for (let i = 0; i < current_IV.length; i++) {
            const tIV = isNaN(target_IV[i]) ? 0 : target_IV[i];
            current_IV[i] += (tIV - current_IV[i]) * 0.08;
            if (isNaN(current_IV[i])) current_IV[i] = 0;
            
            const xIdx = i % gridX;
            const yIdx = Math.floor(i / gridX);
            
            // Volatility Ripple Physics
            let zRipple = 0;
            for (let r = 0; r < ripples.length; r++) {
                const rp = ripples[r];
                const dx = xIdx - rp.cx;
                const dy = yIdx - rp.cy;
                const dist = Math.sqrt(dx*dx + dy*dy);
                const waveRadius = rp.time * 60.0; // speed
                
                if (Math.abs(dist - waveRadius) < 2.0) {
                    const factor = 1.0 - (Math.abs(dist - waveRadius) / 2.0);
                    const life = (0.3 - rp.time) / 0.3;
                    zRipple += factor * 0.1 * life;
                }
            }
            
            const totalZ = current_IV[i] + zRipple;
            positions[i * 3 + 2] = totalZ;

            if (totalZ > maxZ) {
                maxZ = totalZ;
                maxX = positions[i * 3];
                maxY = positions[i * 3 + 1];
            }

            // Map Z-height to V coordinate for the Isoline/Obsidian Texture
            let v = totalZ / 1.5;
            v = Math.max(0, Math.min(1, v));
            uvs[i * 2 + 1] = v;
        }

        const orbZ = maxZ + 0.35;
        if (glowSpriteCore) glowSpriteCore.position.set(maxX, maxY, orbZ);
        if (glowSpriteCorona) glowSpriteCorona.position.set(maxX, maxY, orbZ);
        if (crosshairMesh) crosshairMesh.position.set(maxX, maxY, maxZ + 0.005);
        
        // Particle Physics
        for (let i = 0; i < particlesData.length; i++) {
            let p = particlesData[i];
            if (!p.active) {
                p.active = true;
                p.life = 0;
                p.lifespan = 3.5 + Math.random(); // 3.5 to 4.5 seconds
                p.baseOpacity = 0.35 + Math.random() * 0.30;
                // Origin within 6px radius of orb (approx 0.06 units)
                const r = Math.random() * 0.06;
                const theta = Math.random() * Math.PI * 2;
                p.sprite.position.set(maxX + r * Math.cos(theta), maxY + r * Math.sin(theta), orbZ);
                // Velocity: downward (-Z) and outward (15 to 75 deg from vertical)
                const outAngle = (15 + Math.random() * 60) * (Math.PI / 180);
                const outDir = Math.random() * Math.PI * 2;
                // Speed: ~0.3px per frame = approx 0.003 units per frame
                const speed = 0.003;
                p.velocity.set(
                    Math.sin(outAngle) * Math.cos(outDir) * speed,
                    Math.sin(outAngle) * Math.sin(outDir) * speed,
                    -Math.cos(outAngle) * speed
                );
                p.sprite.material.opacity = p.baseOpacity;
            }
            // Update
            p.life += 0.016; // approx 1 frame at 60fps
            p.sprite.position.add(p.velocity);
            
            // Dissolve over last 20%
            let alpha = p.baseOpacity;
            const dissolveStart = p.lifespan * 0.8;
            if (p.life > dissolveStart) {
                const f = 1.0 - ((p.life - dissolveStart) / (p.lifespan - dissolveStart));
                alpha = p.baseOpacity * Math.max(0, f);
            }
            p.sprite.material.opacity = alpha;
            
            if (p.life >= p.lifespan || p.sprite.position.z <= maxZ - 1.0) {
                p.active = false;
            }
        }

        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.uv.needsUpdate = true;
        geometry.computeVertexNormals(); 
        
        // DIRECTIVE 5: Material Weight (Face Normals) applied to Vertex Colors
        const normals = geometry.attributes.normal.array;
        const colors = geometry.attributes.color.array;
        const pPos = geometry.attributes.position.array;
        const lightDir = new THREE.Vector3(-1, 1, 1).normalize();
        const vNormal = new THREE.Vector3();
        for (let i = 0; i < geometry.attributes.position.count; i++) {
            vNormal.set(normals[i*3], normals[i*3+1], normals[i*3+2]);
            const dot = vNormal.dot(lightDir);
            let lum = 1.0;
            if (dot > 0) lum += dot * 0.10;
            else lum += dot * 0.06;
            
            // Surface Luminosity Response (+8%)
            const vx = pPos[i*3];
            const vy = pPos[i*3+1];
            const dx = vx - maxX;
            const dy = vy - maxY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < 0.4) {
                const factor = 1.0 - (dist / 0.4);
                const lift = factor * factor * 0.08; 
                lum += lift;
            }
            
            colors[i*3] = lum;
            colors[i*3+1] = lum;
            colors[i*3+2] = lum;
        }
        geometry.attributes.color.needsUpdate = true;
        
        // DIRECTIVE 2: Precision 10x10 Structural Mesh
        const sparsePoints = [];
        const xStep = Math.max(1, Math.floor(gridX / 10));
        const yStep = Math.max(1, Math.floor(gridY / 10));
        const atmStrikeIndex = Math.floor(gridX / 2); // Approximate ATM strike
        
        function addHierarchicalLine(idx1, idx2, weight) {
            const z1 = positions[idx1*3+2];
            const z2 = positions[idx2*3+2];
            for (let w = 0; w < weight; w++) {
                const offset = w * 0.0005; // tiny duplicate offset for thickness illusion
                sparsePoints.push(
                    new THREE.Vector3(positions[idx1*3] + offset, positions[idx1*3+1] + offset, z1),
                    new THREE.Vector3(positions[idx2*3] + offset, positions[idx2*3+1] + offset, z2)
                );
            }
        }

        for (let ix = 0; ix < gridX; ix += xStep) {
            const isATM = Math.abs(ix - atmStrikeIndex) <= (xStep / 2);
            const weight = isATM ? 3 : 1; // 35% pseudo-thickness for ATM
            for (let iy = 0; iy < gridY - 1; iy++) {
                addHierarchicalLine(iy * gridX + ix, (iy + 1) * gridX + ix, weight);
            }
        }
        for (let iy = 0; iy < gridY; iy += yStep) {
            const isFront = (iy === 0);
            const weight = isFront ? 2 : 1; // 30% pseudo-thickness for front
            for (let ix = 0; ix < gridX - 1; ix++) {
                addHierarchicalLine(iy * gridX + ix, iy * gridX + (ix + 1), weight);
            }
        }
        
        if (!sparseMesh) {
            const smat = new THREE.LineBasicMaterial({ color: 0x4a9fc4, transparent: true, opacity: 0.22 }); 
            sparseMesh = new THREE.LineSegments(new THREE.BufferGeometry(), smat);
            surfaceGroup.add(sparseMesh);
        }
        sparseMesh.geometry.setFromPoints(sparsePoints);
        
        // DIRECTIVE 1: ATM Spine Trace
        const spinePoints = [];
        const spineGlowPoints = [];
        for (let iy = 0; iy < gridY - 1; iy++) {
            const idx1 = iy * gridX + atmStrikeIndex;
            const idx2 = (iy + 1) * gridX + atmStrikeIndex;
            const z1 = positions[idx1*3+2] + 0.005; 
            const z2 = positions[idx2*3+2] + 0.005;
            spinePoints.push(
                new THREE.Vector3(positions[idx1*3], positions[idx1*3+1], z1),
                new THREE.Vector3(positions[idx2*3], positions[idx2*3+1], z2)
            );
            // Parallel soft blur strokes
            for (let g = -2; g <= 2; g++) {
                if (g === 0) continue;
                const offset = g * 0.002;
                spineGlowPoints.push(
                    new THREE.Vector3(positions[idx1*3] + offset, positions[idx1*3+1], z1),
                    new THREE.Vector3(positions[idx2*3] + offset, positions[idx2*3+1], z2)
                );
            }
        }
        
        if (!spineMesh) {
            const sMat = new THREE.LineBasicMaterial({ color: 0x7dd4f7, transparent: true, opacity: 0.65 });
            spineMesh = new THREE.LineSegments(new THREE.BufferGeometry(), sMat);
            surfaceGroup.add(spineMesh);
            
            const sgMat = new THREE.LineBasicMaterial({ color: 0x7dd4f7, transparent: true, opacity: 0.20 });
            spineGlowMesh = new THREE.LineSegments(new THREE.BufferGeometry(), sgMat);
            surfaceGroup.add(spineGlowMesh);
        }
        spineMesh.geometry.setFromPoints(spinePoints);
        spineGlowMesh.geometry.setFromPoints(spineGlowPoints);
        
        // DIRECTIVE 6: Lit Surface Edge Rim
        const rimPoints = [];
        const edgeOffset = 0.003;
        for (let ix = 0; ix < gridX - 1; ix++) {
            const idx1 = ix; // front edge (iy=0)
            const idx2 = ix + 1;
            rimPoints.push(
                new THREE.Vector3(positions[idx1*3], positions[idx1*3+1], positions[idx1*3+2] + edgeOffset),
                new THREE.Vector3(positions[idx2*3], positions[idx2*3+1], positions[idx2*3+2] + edgeOffset)
            );
        }
        for (let iy = 0; iy < gridY - 1; iy++) {
            const idx1 = iy * gridX; // left edge
            const idx2 = (iy + 1) * gridX;
            rimPoints.push(
                new THREE.Vector3(positions[idx1*3], positions[idx1*3+1], positions[idx1*3+2] + edgeOffset),
                new THREE.Vector3(positions[idx2*3], positions[idx2*3+1], positions[idx2*3+2] + edgeOffset)
            );
            
            const idx3 = iy * gridX + (gridX - 1); // right edge
            const idx4 = (iy + 1) * gridX + (gridX - 1);
            rimPoints.push(
                new THREE.Vector3(positions[idx3*3], positions[idx3*3+1], positions[idx3*3+2] + edgeOffset),
                new THREE.Vector3(positions[idx4*3], positions[idx4*3+1], positions[idx4*3+2] + edgeOffset)
            );
        }
        if (!rimMesh) {
            const rMat = new THREE.LineBasicMaterial({ color: 0x7dd4f7, transparent: true, opacity: 0.50 });
            rimMesh = new THREE.LineSegments(new THREE.BufferGeometry(), rMat);
            surfaceGroup.add(rimMesh);
        }
        rimMesh.geometry.setFromPoints(rimPoints);
        
        // DIRECTIVE 2.7: Dynamic Bounding Box Anchoring
        surfaceMesh.geometry.computeBoundingBox();
        const box = new THREE.Box3().setFromObject(surfaceMesh);
        
        // DIRECTIVE 2.9: Spatial Calibration & Exact Bounding Dimensions
        const widthX = box.max.x - box.min.x;
        const depthY = box.max.y - box.min.y;
        const heightZ = box.max.z - box.min.z;
        
        const horizPadding = widthX * 0.12; 
        const vertPadding = heightZ * 0.40; // Decisively lowered to create space beneath surface
        
        // Floor Position: Standalone grid pushed down further
        floorMesh.position.set((box.max.x + box.min.x) / 2, (box.max.y + box.min.y) / 2, box.min.z - vertPadding);
        
        // Wall Scales: Extend the wall height down to the floor grid, top edge stays at max.z
        const wallHeightZ = heightZ + vertPadding;
        backWallMesh.scale.set(widthX, wallHeightZ, 1);
        leftWallMesh.scale.set(depthY, wallHeightZ, 1);
        
        // Wall positions: Center Z is now halfway between max.z and (min.z - vertPadding)
        const centerZ = (box.max.z + (box.min.z - vertPadding)) / 2;
        
        // Back Wall: Pushed back by horizPadding.
        backWallMesh.position.set((box.max.x + box.min.x) / 2, box.max.y + horizPadding, centerZ);
        
        // Left Wall: Pushed left by horizPadding.
        leftWallMesh.position.set(box.min.x - horizPadding, (box.max.y + box.min.y) / 2, centerZ);

        // DIRECTIVE 2.12: The Obsidian Axes (Ticks only, no internal grids)
        const tickPoints = [];
        
        const backWallZ = box.max.y + horizPadding;
        const leftWallX = box.min.x - horizPadding;
        const wallBottomZ = box.min.z - vertPadding;
        const wallTopZ = box.max.z;
        const tickLen = 0.04; // 4px visual equivalent
        const gap = 0.04;
        
        axisData.forEach(item => {
            if (item.type === 'iv_back') {
                const z = wallBottomZ + item.ratio * (wallTopZ - wallBottomZ);
                const xRight = box.max.x; 
                tickPoints.push(new THREE.Vector3(xRight, backWallZ, z), new THREE.Vector3(xRight + tickLen, backWallZ, z));
                item.sprite.position.set(xRight + tickLen + gap + 0.125, backWallZ, z); 
            }
            else if (item.type === 'iv_left') {
                const z = wallBottomZ + item.ratio * (wallTopZ - wallBottomZ);
                const yFront = box.min.y;
                tickPoints.push(new THREE.Vector3(leftWallX, yFront, z), new THREE.Vector3(leftWallX, yFront - tickLen, z));
                item.sprite.position.set(leftWallX, yFront - tickLen - gap - 0.125, z);
            }
            else if (item.type === 'strike') {
                const x = box.min.x + item.ratio * widthX;
                tickPoints.push(new THREE.Vector3(x, backWallZ, wallBottomZ), new THREE.Vector3(x, backWallZ, wallBottomZ - tickLen));
                item.sprite.position.set(x, backWallZ, wallBottomZ - tickLen - gap - 0.03125);
            }
            else if (item.type === 'dte') {
                const y = box.min.y + item.ratio * depthY;
                tickPoints.push(new THREE.Vector3(leftWallX, y, wallBottomZ), new THREE.Vector3(leftWallX, y, wallBottomZ - tickLen));
                item.sprite.position.set(leftWallX, y, wallBottomZ - tickLen - gap - 0.03125);
            }
            else if (item.type === 'title_strike') {
                item.sprite.position.set((box.max.x + box.min.x)/2, backWallZ, wallBottomZ - tickLen - gap - 0.15);
            }
            else if (item.type === 'title_dte') {
                item.sprite.position.set(leftWallX, (box.max.y + box.min.y)/2, wallBottomZ - tickLen - gap - 0.15);
            }
            else if (item.type === 'title_iv') {
                item.sprite.position.set(box.max.x + tickLen + gap + 0.125, backWallZ, wallTopZ + 0.1);
            }
        });
        
        if (!ticksMesh) {
            const tMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 }); // Anchored ticks
            ticksMesh = new THREE.LineSegments(new THREE.BufferGeometry(), tMat);
            surfaceGroup.add(ticksMesh);
        }
        ticksMesh.geometry.setFromPoints(tickPoints);
    }

    controls.update(); 
    renderer.render(scene, camera);
}

function onWindowResize() {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
}

function onMouseMove(event) {
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / container.clientWidth) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / container.clientHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);

    if (surfaceMesh) {
        const intersects = raycaster.intersectObject(surfaceMesh);
        if (intersects.length > 0) {
            const intersect = intersects[0];
            const face = intersect.face;
            
            const vertexIndex = face.a; 
            const xIdx = vertexIndex % gridX;
            const yIdx = Math.floor(vertexIndex / gridX);
            
            // Move Crosshair
            const vx = surfaceMesh.geometry.attributes.position.getX(vertexIndex);
            const vy = surfaceMesh.geometry.attributes.position.getY(vertexIndex);
            const vz = surfaceMesh.geometry.attributes.position.getZ(vertexIndex);
            crosshair.position.set(vx, vy, vz);
            crosshair.visible = true;

            if (xIdx < strikesList.length && yIdx < dtesList.length) {
                const strike = strikesList[xIdx];
                const dte = dtesList[yIdx];
                const iv = current_IV[vertexIndex];

                ttStrike.innerText = strike.toFixed(2);
                ttDte.innerText = dte + 'd';
                
                const ivPercentage = iv * 100;
                ttIv.innerText = ivPercentage.toFixed(1) + '%';
                
                // Re-enable semantic coloring for the tooltip IV value
                if (ivPercentage > 40) ttIv.style.color = 'var(--red)';
                else if (ivPercentage > 20) ttIv.style.color = 'var(--warn)';
                else ttIv.style.color = 'var(--text-primary)';

                tooltip.style.display = 'block';
                tooltip.style.left = (event.clientX - rect.left + 15) + 'px';
                tooltip.style.top = (event.clientY - rect.top + 15) + 'px';
            }
        } else {
            tooltip.style.display = 'none';
            crosshair.visible = false;
        }
    }
}

function initDashboard() {
    logAction("SYSTEM ONLINE", "", true);
    
    renderTick(playbackData[currentIndex]);
    
    setInterval(() => {
        currentIndex++;
        if (currentIndex >= playbackData.length) {
            currentIndex = 0;
            logAction("PLAYBACK LOOP RESTARTED", "", true);
        }
        renderTick(playbackData[currentIndex]);
        updateLogFading();
    }, 1000);
}

function renderTick(frame) {
    updateLedger(frame);
    updateTargetIV(frame);
    evaluateHedging(frame);
    updateAxes();
}

function updateAxes() {
    if (!axisData) return;
    axisData.forEach(item => surfaceGroup.remove(item.sprite));
    axisData = [];
    
    const maxIV = Math.max(...target_IV);
    const minIV = Math.min(...target_IV);
    
    // Vertical Density: 4 labels max
    const ivSteps = maxIV > 0 ? [minIV, minIV + (maxIV - minIV)*0.33, minIV + (maxIV - minIV)*0.66, maxIV] : [0, 0.3, 0.6, 1.0];
    
    ivSteps.forEach(val => {
        const text = (val * 100).toFixed(1);
        const spriteBack = makeAxisLabel(text); 
        const spriteLeft = makeAxisLabel(text); 
        const ratio = maxIV > 0 ? (val - minIV) / (maxIV - minIV) : val;
        
        surfaceGroup.add(spriteBack);
        surfaceGroup.add(spriteLeft);
        axisData.push({ sprite: spriteBack, type: 'iv_back', ratio: ratio });
        axisData.push({ sprite: spriteLeft, type: 'iv_left', ratio: ratio });
    });
    
    // Horizontal Density: 5 labels
    const numStrikes = 5;
    for(let i=0; i<numStrikes; i++) {
        const idx = Math.floor(i * (strikesList.length - 1) / (numStrikes - 1));
        const strike = strikesList[idx] || 0;
        const sprite = makeAxisLabel(strike.toFixed(1));
        surfaceGroup.add(sprite);
        axisData.push({ sprite: sprite, type: 'strike', ratio: i / (numStrikes - 1) });
    }
    
    const numDtes = 5;
    for(let i=0; i<numDtes; i++) {
        const idx = Math.floor(i * (dtesList.length - 1) / (numDtes - 1));
        const dte = dtesList[idx] || 0;
        const sprite = makeAxisLabel(dte + 'd');
        surfaceGroup.add(sprite);
        axisData.push({ sprite: sprite, type: 'dte', ratio: i / (numDtes - 1) });
    }
    
    const titleStrike = makeTextSprite("STRIKE"); 
    surfaceGroup.add(titleStrike);
    axisData.push({ sprite: titleStrike, type: 'title_strike' });

    const titleDte = makeTextSprite("DTE");
    surfaceGroup.add(titleDte);
    axisData.push({ sprite: titleDte, type: 'title_dte' });
    
    const titleIv = makeTextSprite("IMPLIED VOL");
    surfaceGroup.add(titleIv);
    axisData.push({ sprite: titleIv, type: 'title_iv' });
}

function updateLedger(frame) {
    elTimestamp.innerText = frame.timestamp;
    elVix.innerText = frame.vix_level.toFixed(2);
    
    elSpot.innerText = frame.spot_price.toFixed(2);
    elSpot.className = 'metric-value hero'; 
    updateVoltageBar(barSpot, frame.spot_price, 600);
    
    updateSemanticMetric(elDelta, barDelta, frame.greeks.net_delta, 1000000);
    updateSemanticMetric(elGamma, barGamma, frame.greeks.total_gamma, 5000000, 'compact');
    updateSemanticMetric(elVega, barVega, frame.greeks.total_vega, 5000000, 'compact');
}

function updateSemanticMetric(el, bar, value, maxMagnitude, extraClass = '') {
    el.innerText = value.toLocaleString();
    
    // V2.0 Semantic color logic
    let colorClass = '';
    if (value < 0) colorClass = 'negative';
    else if (value > 0) colorClass = 'positive';
    
    el.className = `metric-value ${extraClass} ${colorClass}`;
    
    const percentage = Math.min((Math.abs(value) / maxMagnitude) * 100, 100);
    bar.style.width = percentage + '%';
    bar.className = `voltage-bar-fill ${colorClass}`;
}

function updateVoltageBar(bar, magnitude, maxMagnitude) {
    const percentage = Math.min((magnitude / maxMagnitude) * 100, 100);
    bar.style.width = percentage + '%';
    bar.className = 'voltage-bar-fill';
}

function evaluateHedging(frame) {
    const delta = frame.greeks.net_delta;
    const threshold = 50000; 
    
    let routed = false;
    if (delta > threshold) {
        const qty = Math.round(Math.abs(delta) / 100);
        logAction(`Hedge routed &middot; <span>SELL ${qty} SPY</span>`, frame.spot_price.toFixed(2), true, frame.timestamp);
        routed = true;
    } else if (delta < -threshold) {
        const qty = Math.round(Math.abs(delta) / 100);
        logAction(`Hedge routed &middot; <span>BUY ${qty} SPY</span>`, frame.spot_price.toFixed(2), true, frame.timestamp);
        routed = true;
    }
    
    if (routed) {
        // Trigger ripple near ATM
        const atmIdxX = Math.floor(gridX / 2);
        const atmIdxY = 0; // Short DTE
        ripples.push({ cx: atmIdxX, cy: atmIdxY, time: 0 });
    }
}

function logAction(htmlAction, priceStr = '', isExecute = false, timestamp = null) {
    const div = document.createElement('div');
    div.className = 'log-entry recent';
    
    const tstamp = timestamp ? timestamp : new Date().toLocaleTimeString('en-US', { hour12: false }).substring(0,5);
    
    // Only green for execute. Everything else is muted.
    div.innerHTML = `
        <span class="log-time">${tstamp}</span>
        <span class="log-indicator ${isExecute ? 'ok' : ''}" style="${!isExecute ? 'background: rgba(255,255,255,0.1)' : ''}"></span>
        <span class="log-text">${htmlAction}</span>
        <span class="log-price">${priceStr}</span>
    `;
    
    consoleOutput.prepend(div);
    totalEvents++;
    elLogCount.innerText = `${totalEvents} events`;
    
    while (consoleOutput.children.length > MAX_LOG_ENTRIES) {
        consoleOutput.removeChild(consoleOutput.lastChild);
    }
    
    updateLogFading();
}

function updateLogFading() {
    const logs = consoleOutput.children;
    for (let i = 0; i < logs.length; i++) {
        if (i === 0) logs[i].className = 'log-entry recent';
        else if (i < 8 && i % 2 === 1) logs[i].className = 'log-entry row-a';
        else if (i < 8 && i % 2 === 0) logs[i].className = 'log-entry row-b';
        else logs[i].className = 'log-entry historical';
    }
}
