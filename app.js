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
    context.fillStyle = 'rgba(255, 255, 255, 0.50)'; // White at 50% opacity
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

function createIsolineTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    
    // V2.0 5-Stop Gradient Map
    const gradient = ctx.createLinearGradient(0, 1024, 0, 0);
    gradient.addColorStop(0.00, '#0A4275'); // Luminous cobalt base
    gradient.addColorStop(0.25, '#1A5276'); // Dark blue
    gradient.addColorStop(0.50, '#0E6655'); // Teal
    gradient.addColorStop(0.75, '#B7770D'); // Amber
    gradient.addColorStop(1.00, '#C0392B'); // Surgical red
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1, 1024);
    
    // 5 Contour Isolines at meaningful IV intervals
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    for (let i = 1; i <= 5; i++) {
        const y = 1024 - (i * 170); // spaced contour loops
        ctx.fillRect(0, y, 1, 2); // hair-thin
    }
    
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
    
    // Camera Directive: Aggressive low angle, looking across the floor at the asymptote
    camera.position.set(1.6, -2.5, 0.4); 
    camera.up.set(0, 0, 1);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = false;
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.05; // Prevent camera from dropping under the floor

    // DIRECTIVE 2.7: Kill the "Flashlight" Specular Highlight
    // Replace with distant DirectionalLight and soft AmbientLight
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(100, 200, 50); 
    scene.add(dirLight);

    const firstFrame = playbackData[0];
    strikesList = [...new Set(firstFrame.vol_surface.map(item => item.strike))].sort((a, b) => a - b);
    dtesList = [...new Set(firstFrame.vol_surface.map(item => item.dte))].sort((a, b) => a - b);
    
    gridX = strikesList.length;
    gridY = dtesList.length;

    geometry = new THREE.PlaneGeometry(2, 2, gridX - 1, gridY - 1);
    
    const pbrTexture = createIsolineTexture();
    
    // DIRECTIVE 2.7: Matte platinum sheen, not blinding plastic
    const material = new THREE.MeshPhysicalMaterial({ 
        map: pbrTexture,
        emissiveMap: pbrTexture,
        emissive: new THREE.Color(0xffffff),
        emissiveIntensity: 0.3, 
        side: THREE.DoubleSide,
        roughness: 0.35, // matte sheen
        metalness: 0.9,  // high metalness
        clearcoat: 0.0   // kill the plastic reflection
    });

    surfaceGroup = new THREE.Group();
    scene.add(surfaceGroup);

    surfaceMesh = new THREE.Mesh(geometry, material);
    surfaceGroup.add(surfaceMesh);

    // Bloomberg-style subtle wireframe overlay for structural readability
    const wireframeMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0.25 // Weaponize the wireframe
    });
    const wireframeMesh = new THREE.Mesh(geometry, wireframeMaterial);
    surfaceGroup.add(wireframeMesh);

    // DIRECTIVE 2.8: The Floor Grid (Standalone GridHelper, No Glass)
    floorMesh = new THREE.GridHelper(2, 20, 0xffffff, 0xffffff);
    floorMesh.material.opacity = 0.08;
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
            
            const rawZ = current_IV[i] + zRipple;
            const totalZ = rawZ * 1.8; // Exaggerate the asymptote vertically (Directive 2.13)
            positions[i * 3 + 2] = totalZ;

            // Map Z-height to V coordinate using the RAW height for the Isoline/Obsidian Texture
            let v = rawZ / 1.5;
            v = Math.max(0, Math.min(1, v));
            uvs[i * 2 + 1] = v;
        }

        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.uv.needsUpdate = true;
        geometry.computeVertexNormals(); 
        
        // DIRECTIVE 2.7: Dynamic Bounding Box Anchoring
        surfaceMesh.geometry.computeBoundingBox();
        const box = new THREE.Box3().setFromObject(surfaceMesh);
        
        // DIRECTIVE 2.9: Spatial Calibration & Exact Bounding Dimensions
        const widthX = box.max.x - box.min.x;
        const depthY = box.max.y - box.min.y;
        const heightZ = box.max.z - box.min.z;
        
        const horizPadding = widthX * 0.12; 
        const vertPadding = heightZ * 0.18; // Lowered even further based on user feedback
        
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

        // DIRECTIVE 2.12: The Obsidian Axes
        const tickPoints = [];
        const gridPoints = [];
        
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
                const xLeft = box.min.x;
                gridPoints.push(new THREE.Vector3(xLeft, backWallZ, z), new THREE.Vector3(xRight, backWallZ, z));
                tickPoints.push(new THREE.Vector3(xRight, backWallZ, z), new THREE.Vector3(xRight + tickLen, backWallZ, z));
                item.sprite.position.set(xRight + tickLen + gap + 0.125, backWallZ, z); 
            }
            else if (item.type === 'iv_left') {
                const z = wallBottomZ + item.ratio * (wallTopZ - wallBottomZ);
                const yBack = box.max.y;
                const yFront = box.min.y;
                gridPoints.push(new THREE.Vector3(leftWallX, yFront, z), new THREE.Vector3(leftWallX, yBack, z));
                tickPoints.push(new THREE.Vector3(leftWallX, yFront, z), new THREE.Vector3(leftWallX, yFront - tickLen, z));
                item.sprite.position.set(leftWallX, yFront - tickLen - gap - 0.125, z);
            }
            else if (item.type === 'strike') {
                const x = box.min.x + item.ratio * widthX;
                gridPoints.push(new THREE.Vector3(x, backWallZ, wallBottomZ), new THREE.Vector3(x, backWallZ, wallTopZ));
                tickPoints.push(new THREE.Vector3(x, backWallZ, wallBottomZ), new THREE.Vector3(x, backWallZ, wallBottomZ - tickLen));
                item.sprite.position.set(x, backWallZ, wallBottomZ - tickLen - gap - 0.03125);
            }
            else if (item.type === 'dte') {
                const y = box.min.y + item.ratio * depthY;
                gridPoints.push(new THREE.Vector3(leftWallX, y, wallBottomZ), new THREE.Vector3(leftWallX, y, wallTopZ));
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
            
            const gMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.04 });
            gridsMesh = new THREE.LineSegments(new THREE.BufferGeometry(), gMat);
            surfaceGroup.add(gridsMesh);
        }
        ticksMesh.geometry.setFromPoints(tickPoints);
        gridsMesh.geometry.setFromPoints(gridPoints);
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
