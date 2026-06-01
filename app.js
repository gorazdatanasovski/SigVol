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
let shadowMesh, originCrossMesh;
let sparseMeshStrikes, sparseMeshExpiries;
let glowSpriteCore;

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
    
    const edgeSize = 41; // 8% of 512px
    
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

function createIsolineTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    
    // Cold Plasma progression
    const gradient = ctx.createLinearGradient(0, 1024, 0, 0);
    gradient.addColorStop(0.00, '#0e1e30'); // Base floor
    gradient.addColorStop(0.20, '#15344f'); // Cold body
    gradient.addColorStop(0.40, '#1e6898'); // Steel blue
    gradient.addColorStop(0.60, '#30a0d4'); // Bright electric ice
    gradient.addColorStop(0.80, '#72d4f4'); // Ice blue
    gradient.addColorStop(0.95, '#d0f8ff'); // Incandescent ice
    gradient.addColorStop(1.00, '#ffffff'); // Blown-out apex
    
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
    
    // DIRECTIVE 5: Camera Realignment (Pulled back 15%, Elevation 30deg, Rule of Thirds offset)
    camera.position.set(3.63, -3.63, 2.97); 
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
    
    const pbrTexture = createIsolineTexture();
    
    // DIRECTIVE 4: Phong Shading and Edge Dissolve
    const material = new THREE.MeshPhongMaterial({ 
        map: pbrTexture,
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

    // DIRECTIVE 4: Floor Shadow Plane
    shadowMesh = new THREE.Mesh(geometry, material.clone());
    shadowMesh.material.opacity = 0.08;
    shadowMesh.material.transparent = true;
    shadowMesh.material.depthWrite = false;
    surfaceGroup.add(shadowMesh);

    // DIRECTIVE 2: Peak Bloom Tightening
    const coreMat = new THREE.SpriteMaterial({
        map: createGlowTexture(), color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending
    });
    glowSpriteCore = new THREE.Sprite(coreMat);
    glowSpriteCore.scale.set(0.12, 0.12, 1); // 6px tight core
    surfaceGroup.add(glowSpriteCore);

    // DIRECTIVE 3: Floor Origin Cross
    const crossGeo = new THREE.BufferGeometry();
    const crossMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.20 });
    originCrossMesh = new THREE.LineSegments(crossGeo, crossMat);
    surfaceGroup.add(originCrossMesh);

    // Side/Back walls entirely removed as per directive

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

        if (glowSpriteCore) glowSpriteCore.position.set(maxX, maxY, maxZ);

        geometry.attributes.position.needsUpdate = true;
        geometry.attributes.uv.needsUpdate = true;
        geometry.computeVertexNormals(); 
        
        // DIRECTIVE 3: Mesh Restructuring (White Surgical Lines with Split Opacities)
        const strikePoints = [];
        const expiryPoints = [];
        const xStep = Math.max(1, Math.floor(gridX / 8));
        const yStep = Math.max(1, Math.floor(gridY / 8));
        
        for (let ix = 0; ix < gridX; ix += xStep) {
            for (let iy = 0; iy < gridY - 1; iy++) {
                const idx1 = iy * gridX + ix;
                const idx2 = (iy + 1) * gridX + ix;
                strikePoints.push(
                    new THREE.Vector3(positions[idx1*3], positions[idx1*3+1], positions[idx1*3+2]),
                    new THREE.Vector3(positions[idx2*3], positions[idx2*3+1], positions[idx2*3+2])
                );
            }
        }
        for (let iy = 0; iy < gridY; iy += yStep) {
            for (let ix = 0; ix < gridX - 1; ix++) {
                const idx1 = iy * gridX + ix;
                const idx2 = iy * gridX + (ix + 1);
                expiryPoints.push(
                    new THREE.Vector3(positions[idx1*3], positions[idx1*3+1], positions[idx1*3+2]),
                    new THREE.Vector3(positions[idx2*3], positions[idx2*3+1], positions[idx2*3+2])
                );
            }
        }
        
        if (!sparseMeshStrikes) {
            const smatStrikes = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14 }); 
            sparseMeshStrikes = new THREE.LineSegments(new THREE.BufferGeometry(), smatStrikes);
            surfaceGroup.add(sparseMeshStrikes);
        }
        sparseMeshStrikes.geometry.setFromPoints(strikePoints);

        if (!sparseMeshExpiries) {
            const smatExpiries = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 }); 
            sparseMeshExpiries = new THREE.LineSegments(new THREE.BufferGeometry(), smatExpiries);
            surfaceGroup.add(sparseMeshExpiries);
        }
        sparseMeshExpiries.geometry.setFromPoints(expiryPoints);
        
        // DIRECTIVE 2.7: Dynamic Bounding Box Anchoring
        surfaceMesh.geometry.computeBoundingBox();
        const box = new THREE.Box3().setFromObject(surfaceMesh);
        
        // DIRECTIVE 2.9: Spatial Calibration
        const widthX = box.max.x - box.min.x;
        const depthY = box.max.y - box.min.y;
        const heightZ = box.max.z - box.min.z;
        const vertPadding = heightZ * 0.18;
        
        const floorZ = box.min.z - vertPadding;
        
        // DIRECTIVE 4: Update shadow floor plane dynamically
        if (shadowMesh) {
            shadowMesh.scale.z = 0.0001; 
            shadowMesh.position.z = floorZ;
        }

        // DIRECTIVE 4: The Floor Cross (ATM / Near-DTE origin)
        const crossPts = [];
        const atmX = (box.max.x + box.min.x) / 2;
        const nearDteY = box.min.y;
        
        crossPts.push(new THREE.Vector3(atmX, box.min.y, floorZ), new THREE.Vector3(atmX, box.max.y, floorZ));
        crossPts.push(new THREE.Vector3(box.min.x, nearDteY, floorZ), new THREE.Vector3(box.max.x, nearDteY, floorZ));
        
        if (originCrossMesh) originCrossMesh.geometry.setFromPoints(crossPts);
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
