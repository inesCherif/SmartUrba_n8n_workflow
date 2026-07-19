// ==========================================
// Map Configuration Data
// ==========================================
const mapData = {
    topo: {
        title: "Topographic Map", icon: "🏔️"
    }
};

// ==========================================
// Map Initialization
// ==========================================
const map = L.map('map', { zoomControl: false }).setView([37.7749, -122.4194], 12); // San Francisco
L.control.zoom({ position: 'bottomright' }).addTo(map);

map.pm.addControls({
    position: 'bottomright',
    drawMarker: false, drawCircleMarker: false, drawPolyline: false,
    drawRectangle: false, drawCircle: false, editMode: false,
    dragMode: false, cutPolygon: false, removalMode: false, drawPolygon: false,
});

// ==========================================
// Tile Layers
// ==========================================
// Using a clean light map to match the dashboard
const positron = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 20
});
positron.addTo(map);

// ==========================================
// Chat UI Elements
// ==========================================
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const attachBtn = document.querySelector('.attach-btn');

let drawnPolygon = null;
let capturedDataURL = null;
let savedFilename = null;
let isWaitingForDraw = false;

// Format current time
function getCurrentTime() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Append a user message to the chat
function addUserMessage(text) {
    const msgHTML = `
        <div class="message-wrapper user">
            <div class="message">
                <div class="bubble">
                    <p>${text}</p>
                </div>
                <span class="time">${getCurrentTime()} <i class="ph-bold ph-check-circle" style="color: #3b82f6; font-size: 12px; margin-left:4px;"></i></span>
            </div>
        </div>
    `;
    chatMessages.insertAdjacentHTML('beforeend', msgHTML);
    scrollToBottom();
}

// Append an assistant message to the chat
function addAssistantMessage(htmlContent) {
    const msgHTML = `
        <div class="message-wrapper assistant">
            <div class="avatar ai-avatar"><i class="ph-fill ph-magic-wand"></i></div>
            <div class="message">
                <div class="bubble">
                    ${htmlContent}
                </div>
                <span class="time">${getCurrentTime()}</span>
            </div>
        </div>
    `;
    chatMessages.insertAdjacentHTML('beforeend', msgHTML);
    scrollToBottom();
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ==========================================
// Chat Interaction -> Start Drawing
// ==========================================
chatSendBtn.addEventListener('click', handleChatSubmit);
chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleChatSubmit();
});

function handleChatSubmit() {
    const text = chatInput.value.trim();
    if (!text) return;
    
    // Store the user's latest prompt for 3D generation context
    window.latestUserPrompt = text;
    
    addUserMessage(text);
    chatInput.value = '';
    
    // Simulate thinking then ask user to draw
    setTimeout(() => {
        addAssistantMessage(`<p>Great idea! To build <strong>"${text}"</strong>, I first need to analyze the terrain. Please <strong>draw a polygon</strong> on the map to define the construction area. (Click to place points, double-click to finish)</p>`);
        startDrawing();
    }, 600);
}

attachBtn.addEventListener('click', () => {
    addAssistantMessage('<p>Click on the map to draw the analysis area.</p>');
    startDrawing();
});

function startDrawing() {
    if (drawnPolygon) { map.removeLayer(drawnPolygon); drawnPolygon = null; }
    capturedDataURL = null;
    savedFilename = null;
    isWaitingForDraw = true;

    map.pm.enableDraw('Polygon', {
        snappable: true, snapDistance: 20, allowSelfIntersection: false,
        templineStyle:  { color: '#3b82f6', weight: 3, dashArray: '8, 6' },
        hintlineStyle:  { color: '#93c5fd', weight: 2, dashArray: '5, 5', opacity: 0.8 },
        pathOptions:    { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.15, weight: 3 }
    });
}

// ==========================================
// Map Drawing Completed -> Screenshot
// ==========================================
map.on('pm:create', async (e) => {
    if (e.shape !== 'Polygon' || !isWaitingForDraw) return;
    isWaitingForDraw = false;
    drawnPolygon = e.layer;
    map.pm.disableDraw();

    const bounds = drawnPolygon.getBounds();
    
    // Calculate pipeline data inline
    const center = bounds.getCenter();
    const northWest = bounds.getNorthWest();
    const northEast = bounds.getNorthEast();
    const southWest = bounds.getSouthWest();
    
    const widthMeters = Math.round(northWest.distanceTo(northEast));
    const lengthMeters = Math.round(northWest.distanceTo(southWest));

    map.fitBounds(bounds, { padding: [40, 40], animate: true, duration: 0.5 });

    addAssistantMessage('<div class="loading-dots"><span></span><span></span><span></span></div><p style="margin-top:8px; font-size:0.85rem; color:#6b7280;">Running Smart City Pipeline automatically...</p>');
    
    map.once('moveend', () => {
        setTimeout(() => {
            runN8nPipelineAutomatically(center.lat.toFixed(6), center.lng.toFixed(6), widthMeters, lengthMeters);
        }, 600);
    });
});

async function captureAndAnalyze(bounds) {
    try {
        // Hide right sidebar temporarily for cleaner screenshot if needed, 
        // but since we are taking screenshot of #map only, it's fine.
        const canvas = await html2canvas(document.getElementById('map'), {
            useCORS: true, allowTaint: true, scale: 1.5, logging: false
        });
        
        capturedDataURL = canvas.toDataURL('image/png');
        
        // Save to backend optionally, but directly proceed to analyze
        await saveScreenshotToFolder(capturedDataURL);
        await analyzeImage(capturedDataURL);
        
    } catch (err) {
        removeLastMessage();
        addAssistantMessage(`<p style="color: #ef4444;">Screenshot failed: ${err.message}</p>`);
    }
}

// ==========================================
// Save to Python Backend
// ==========================================
async function saveScreenshotToFolder(dataURL) {
    try {
        const base64Data = dataURL.split(',')[1];
        const center = map.getCenter();
        const resp = await fetch('http://localhost:5000/save-screenshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_base64: base64Data, map_type: 'dashboard',
                center_lat: center.lat.toFixed(4), center_lng: center.lng.toFixed(4), zoom: map.getZoom()
            })
        });
        if (resp.ok) {
            const data = await resp.json();
            savedFilename = data.filename;
        }
    } catch (err) {
        console.warn("Could not save to local folder, continuing without it.");
    }
}

// ==========================================
// Analyze via Python Backend
// ==========================================
async function analyzeImage(dataURL) {
    try {
        const base64Data = dataURL.split(',')[1];
        const center = map.getCenter();
        const bounds = map.getBounds();
        const mapWidthMeters = map.distance(bounds.getSouthWest(), bounds.getSouthEast());
        const metersPerPixel = (mapWidthMeters / map.getSize().x).toFixed(2);
        
        let coordList = [];
        if (drawnPolygon) {
            const latLngs = drawnPolygon.getLatLngs()[0];
            coordList = latLngs.map(p => ({ lat: p.lat, lng: p.lng }));
        }

        const resp = await fetch('http://localhost:5000/analyze-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                image_base64: base64Data, map_type: 'dashboard',
                center_lat: center.lat.toFixed(4), center_lng: center.lng.toFixed(4),
                zoom: map.getZoom(), saved_file: savedFilename || 'unknown',
                scale_m_px: metersPerPixel, coordinates: coordList
            })
        });

        if (!resp.ok) throw new Error(`Server error: ${resp.status}`);
        const data = await resp.json();
        if (data.error) throw new Error(data.error);

        window.latestAnalysisText = data.analysis;
        
        // Populate the Report View
        const reportContent = document.querySelector('#view-report .view-content');
        let html = data.analysis
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/^### (.+)$/gm, '<h4 style="font-size:1.1rem; color:#111827; margin:16px 0 8px;">$1</h4>')
            .replace(/^## (.+)$/gm,  '<h3 style="font-size:1.3rem; color:#4f46e5; margin:20px 0 12px;">$1</h3>')
            .replace(/^# (.+)$/gm,   '<h2 style="font-size:1.6rem; color:#4338ca; margin:24px 0 16px;">$1</h2>')
            .replace(/^- (.+)$/gm,   '<li style="margin-left: 20px; margin-bottom:6px;">$1</li>')
            .replace(/\n/g, '<br>');
        reportContent.innerHTML = `<div style="padding: 20px; line-height: 1.6; color:#4b5563;">${html}</div>`;

        // Populate the 2D Simulation View (Mockup with screenshot and grid)
        const view2dContent = document.querySelector('#view-2d .view-content');
        view2dContent.innerHTML = `
            <div style="display:flex; flex-direction:column; gap:20px; height:100%;">
                <div style="padding:16px; background:#eff6ff; border-radius:12px; border:1px solid #bfdbfe;">
                    <h3 style="color:#1e40af; margin-bottom:8px;">2D Infrastructure Zoning</h3>
                    <p style="color:#3b82f6; font-size:0.9rem;">Analysis overlay showing high-density commercial zones, residential areas, and critical infrastructure pathways.</p>
                </div>
                <div style="flex:1; border-radius:12px; overflow:hidden; border:2px dashed #93c5fd; position:relative; background:url('${dataURL}') center/cover;">
                    <div style="position:absolute; inset:0; background:rgba(59,130,246,0.2); mix-blend-mode: multiply;"></div>
                    <div style="position:absolute; inset:0; background-image:linear-gradient(#bfdbfe 1px, transparent 1px), linear-gradient(90deg, #bfdbfe 1px, transparent 1px); background-size:50px 50px; opacity:0.5;"></div>
                </div>
            </div>
        `;

        // Remove loading message
        removeLastMessage();
        
        // Render result in the style of the screenshot with the action cards
        const resultHTML = `
            <p>Analysis complete. Here are your results:</p>
            
            <div class="chat-action-card" id="gen-3d-card">
                <img src="https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?q=80&w=200&auto=format&fit=crop" class="card-image" alt="3D">
                <div class="card-text">
                    <h4>3D Simulation</h4>
                    <p>Explore the future development in 3D.</p>
                </div>
            </div>
            
            <div class="chat-action-card" onclick="document.getElementById('menu-2d').click()">
                <img src="${dataURL}" class="card-image" alt="2D" style="border: 1px solid #e2e8f0;">
                <div class="card-text">
                    <h4>2D Simulation</h4>
                    <p>2D zoning, land use & infrastructure.</p>
                </div>
            </div>
            
            <div class="chat-action-card" onclick="document.getElementById('menu-report').click()">
                <div class="card-image" style="display:flex; align-items:center; justify-content:center; background:#fee2e2;">
                    <i class="ph-fill ph-file-pdf card-icon"></i>
                </div>
                <div class="card-text">
                    <h4>Report</h4>
                    <p>Comprehensive analysis report.</p>
                </div>
            </div>
        `;
        
        addAssistantMessage(resultHTML);

        // Bind 3D generation to the card
        setTimeout(() => {
            const gen3dCard = document.getElementById('gen-3d-card');
            if(gen3dCard) {
                gen3dCard.addEventListener('click', generate3DSurface);
            }
        }, 100);

    } catch (err) {
        removeLastMessage();
        addAssistantMessage(`<p style="color: #ef4444;"><strong>Analysis Error:</strong> ${err.message}</p>
        <p style="font-size:0.8rem; margin-top:8px;">Ensure the Python backend is running.</p>`);
    }
}

function removeLastMessage() {
    const msgs = chatMessages.querySelectorAll('.message-wrapper');
    if (msgs.length > 0) {
        msgs[msgs.length - 1].remove();
    }
}

// ==========================================
// Generative 3D Simulation
// ==========================================
async function generate3DSurface() {
    addAssistantMessage('<div class="loading-dots"><span></span><span></span><span></span></div><p style="margin-top:8px; font-size:0.85rem; color:#6b7280;">Generating 3D Environment...</p>');
    
    try {
        const resp = await fetch('http://localhost:5000/generate-3d-surface', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                analysis_text: window.latestAnalysisText || 'Standard terrain',
                user_prompt: window.latestUserPrompt || 'Build a smart city'
            })
        });

        if (!resp.ok) throw new Error(`Server error: ${resp.status}`);
        const data = await resp.json();
        if (data.error) throw new Error(data.error);

        removeLastMessage();
        addAssistantMessage(`<p>3D Simulation generated successfully!</p>`);
        
        const container = document.getElementById('3d-simulation-content');
        container.innerHTML = `<div id="three-container-main" style="width:100%; height:100%; border-radius:12px; overflow:hidden;"></div>`;
        
        let code = data.code;
        code = code.replace(/'3d-container'/g, `'three-container-main'`);
        code = code.replace(/"3d-container"/g, `"three-container-main"`);
        
        const executeCode = new Function(code);
        executeCode();

        // Automatically switch to 3D View
        document.getElementById('menu-3d').click();

    } catch (err) {
        removeLastMessage();
        addAssistantMessage(`<p style="color: #ef4444;"><strong>3D Gen Error:</strong> ${err.message}</p>`);
    }
}

// ==========================================
// View Switching Logic
// ==========================================
const menuItems = document.querySelectorAll('.menu-item');
const viewContainers = document.querySelectorAll('.view-container');
let smartCityInitialized = false;

menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        
        menuItems.forEach(m => m.classList.remove('active'));
        viewContainers.forEach(v => v.style.display = 'none');
        
        item.classList.add('active');
        const targetViewId = item.id.replace('menu-', 'view-');
        const targetView = document.getElementById(targetViewId);
        if (targetView) {
            targetView.style.display = 'flex';
            if (targetViewId === 'view-map') {
                setTimeout(() => { map.invalidateSize(); }, 100);
            }
            // Auto-initialize the Smart City 3D scene when the 3D view is first opened
            if (targetViewId === 'view-3d' && !smartCityInitialized) {
                smartCityInitialized = true;
                const content = document.getElementById('3d-simulation-content');
                content.innerHTML = '<div id="three-container-main" style="width:100%;height:100%;border-radius:12px;overflow:hidden;"></div>';
                setTimeout(initSmartCity, 150);
            }
        }
    });
});

/* =========================================================
   PIPELINE AUTOMATIC TRIGGER
   ========================================================= */
const togglePipelineBtn = document.getElementById('toggle-pipeline-btn');

function removeLastMessage() {
    const msgs = document.querySelectorAll('.message-wrapper');
    if (msgs.length > 0) {
        msgs[msgs.length - 1].remove();
    }
}

async function runN8nPipelineAutomatically(lat, lng, width, length) {
    const payload = {
        "Latitude": parseFloat(lat),
        "Longitude": parseFloat(lng),
        "Region name": "Prototype Selection",
        "Site width (m)": parseFloat(width),
        "Site length (m)": parseFloat(length),
        "Population estimate": 15000,
        "Budget (USD)": 50000000,
        "Notes": window.latestUserPrompt || "Auto-generated from map interface"
    };

    try {
        const resp = await fetch('https://inescherif.app.n8n.cloud/webhook/smart-city-api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        removeLastMessage();
        
        if (!resp.ok) {
            addAssistantMessage(`<p style="color: #ef4444;">n8n Pipeline failed: ${resp.status} ${resp.statusText}</p>`);
            return;
        }
        
        const htmlContent = await resp.text();
        
        // Populate the Report View with the HTML iframe
        const reportContent = document.querySelector('#view-report .view-content');
        if(reportContent) reportContent.innerHTML = `<iframe srcdoc="${htmlContent.replace(/"/g, '&quot;')}" style="width:100%; height:100%; border:none;"></iframe>`;
        
        // Populate 2D/3D Simulation View with the same report iframe since n8n generates both natively
        const view2dContent = document.querySelector('#view-2d .view-content');
        if(view2dContent) view2dContent.innerHTML = `<iframe srcdoc="${htmlContent.replace(/"/g, '&quot;')}" style="width:100%; height:100%; border:none;"></iframe>`;

        const view3dContent = document.querySelector('#view-3d .view-content');
        if(view3dContent) view3dContent.innerHTML = `<iframe srcdoc="${htmlContent.replace(/"/g, '&quot;')}" style="width:100%; height:100%; border:none;"></iframe>`;

        addAssistantMessage(`
            <p>Analysis complete. Your Smart City plan has been generated by the n8n pipeline.</p>
            <div class="chat-action-card" onclick="document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active')); document.querySelectorAll('.view-pane').forEach(v=>v.classList.remove('active')); document.querySelector('.tab[data-target=\\'view-report\\']').classList.add('active'); document.getElementById('view-report').classList.add('active');">
                <div class="card-icon"><i class="ph-fill ph-file-text" style="color: #4f46e5;"></i></div>
                <div class="card-text">View Full Smart City Plan</div>
            </div>
        `);
        
    } catch (err) {
        removeLastMessage();
        addAssistantMessage(`<p style="color: #ef4444;">Connection failed: ${err.message}</p>`);
    }
}

// ==========================================
// Map Location Search
// ==========================================
const mapSearchInput = document.getElementById('map-search-input');
if(mapSearchInput) {
    mapSearchInput.addEventListener('keypress', async (e) => {
        if (e.key === 'Enter') {
            const query = mapSearchInput.value.trim();
            if (!query) return;
            
            try {
                const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
                const data = await res.json();
                if (data && data.length > 0) {
                    const lat = parseFloat(data[0].lat);
                    const lon = parseFloat(data[0].lon);
                    map.flyTo([lat, lon], 14, { animate: true, duration: 1.5 });
                }
            } catch (err) {
                console.error("Geocoding error", err);
            }
        }
    });
}

// ==========================================
// Points of Interest (POI) via Overpass API
// ==========================================
let poiLayerGroup = L.layerGroup().addTo(map);
let isFetchingPOIs = false;
let poiDebounceTimer = null;

// Only fetch POIs when the map view is actually visible
function isMapVisible() {
    const mapView = document.getElementById('view-map');
    return mapView && mapView.style.display !== 'none';
}

async function fetchPOIs() {
    // Guard: don't fetch if map container is hidden (e.g. 3D/Report view is active)
    if (!isMapVisible()) return;
    // Guard: don't fetch at low zoom (too many results, slow API)
    if (map.getZoom() < 13) {
        poiLayerGroup.clearLayers();
        return;
    }
    // Guard: don't fetch if already in progress
    if (isFetchingPOIs) return;

    isFetchingPOIs = true;
    const bounds = map.getBounds();
    const s = bounds.getSouth(), w = bounds.getWest(), n = bounds.getNorth(), e = bounds.getEast();

    const query = `[out:json][timeout:25];(
  node["amenity"~"restaurant|hospital|cafe|school|fast_food|pharmacy|bank"](${s},${w},${n},${e});
  node["shop"](${s},${w},${n},${e});
);out body;>;out skel qt;`;

    try {
        const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
        if (!res.ok) throw new Error(`Overpass API returned ${res.status}`);
        const data = await res.json();
        poiLayerGroup.clearLayers();
        if (data.elements) {
            data.elements.forEach(el => {
                if (el.type === 'node' && el.tags && (el.tags.amenity || el.tags.shop)) {
                    createPOIMarker(el);
                }
            });
        }
    } catch (err) {
        // Silent fail — POIs are a convenience feature, not critical
        console.warn('[POI] Fetch skipped or failed:', err.message);
    } finally {
        isFetchingPOIs = false;
    }
}

// Debounced listener — waits 800ms after the map stops moving before fetching
map.on('moveend', () => {
    clearTimeout(poiDebounceTimer);
    poiDebounceTimer = setTimeout(fetchPOIs, 800);
});

function createPOIMarker(el) {
    const type = el.tags.amenity || el.tags.shop || 'default';
    let iconClass = 'ph-map-pin';
    let colorClass = 'poi-default';
    let title = el.tags.name || type;
    
    if (type.includes('restaurant') || type.includes('fast_food')) { iconClass = 'ph-fork-knife'; colorClass = 'poi-restaurant'; }
    else if (type.includes('hospital') || type.includes('pharmacy')) { iconClass = 'ph-first-aid'; colorClass = 'poi-hospital'; }
    else if (type.includes('cafe')) { iconClass = 'ph-coffee'; colorClass = 'poi-cafe'; }
    else if (type.includes('school')) { iconClass = 'ph-graduation-cap'; colorClass = 'poi-school'; }
    else if (el.tags.shop) { iconClass = 'ph-shopping-cart-simple'; colorClass = 'poi-shop'; }
    else if (type.includes('bank')) { iconClass = 'ph-bank'; colorClass = 'poi-default'; }

    const iconHtml = `<div class="poi-marker ${colorClass}" style="width:24px; height:24px;"><i class="ph ${iconClass}"></i></div>`;
    
    const icon = L.divIcon({
        html: iconHtml,
        className: '',
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
    });

    const popupHtml = `<strong>${title.charAt(0).toUpperCase() + title.slice(1)}</strong><p style="text-transform: capitalize;">${type.replace('_',' ')}</p>`;

    L.marker([el.lat, el.lon], {icon: icon})
        .bindPopup(popupHtml)
        .addTo(poiLayerGroup);
}

// ==========================================
// SMART CITY 3D SCENE (Three.js)
// ==========================================
function initSmartCity() {
    const container = document.getElementById('three-container-main');
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x0b1120);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0b1120, 0.0035);

    const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 2000);
    camera.position.set(0, 120, 200);
    camera.lookAt(0, 0, 0);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 30;
    controls.maxDistance = 500;
    controls.maxPolarAngle = Math.PI / 2.1;

    // Lighting
    scene.add(new THREE.AmbientLight(0x1e3a5f, 2.0));
    const sun = new THREE.DirectionalLight(0x8ab4f8, 2.5);
    sun.position.set(100, 200, 100);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.far = 600;
    sun.shadow.camera.left = -200; sun.shadow.camera.right = 200;
    sun.shadow.camera.top = 200; sun.shadow.camera.bottom = -200;
    scene.add(sun);
    scene.add(new THREE.HemisphereLight(0x0ea5e9, 0x0f172a, 0.6));

    // Noise / terrain height
    function noise(x, z) {
        return Math.sin(x*0.05)*Math.cos(z*0.05)*8
             + Math.sin(x*0.12+1.3)*Math.cos(z*0.1)*4
             + Math.sin(x*0.25+0.7)*Math.cos(z*0.22)*2
             + Math.cos(x*0.08-0.5)*Math.sin(z*0.09)*3;
    }
    function getY(x, z) { return noise(x, z); }

    // Terrain
    const tGeo = new THREE.PlaneGeometry(400, 400, 100, 100);
    tGeo.rotateX(-Math.PI / 2);
    const cArr = [];
    const pA = tGeo.attributes.position;
    const col = new THREE.Color();
    for (let i = 0; i < pA.count; i++) {
        const x = pA.getX(i), z = pA.getZ(i), y = noise(x, z);
        pA.setY(i, y);
        const t = (y + 8) / 20;
        if (t < 0.35) col.setHex(0x14532d);
        else if (t < 0.6) col.setHex(0x166534);
        else if (t < 0.8) col.setHex(0x78350f);
        else col.setHex(0xd6d3d1);
        cArr.push(col.r, col.g, col.b);
    }
    tGeo.setAttribute('color', new THREE.Float32BufferAttribute(cArr, 3));
    tGeo.computeVertexNormals();
    const tMesh = new THREE.Mesh(tGeo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true }));
    tMesh.receiveShadow = true;
    scene.add(tMesh);

    // Helpers
    function addBuilding(x, z, w, d, h, color, emissive) {
        const mat = new THREE.MeshStandardMaterial({ color, emissive: emissive||0x000000, emissiveIntensity: 0.4, metalness: 0.6, roughness: 0.3 });
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.castShadow = true; m.receiveShadow = true;
        m.position.set(x, getY(x,z)+h/2, z);
        scene.add(m);
        // Window glow overlay
        const wm = new THREE.Mesh(
            new THREE.BoxGeometry(w*1.01, h*1.01, d*1.01),
            new THREE.MeshStandardMaterial({ emissive: emissive||0xfef08a, emissiveIntensity: 0.12, wireframe: true, transparent: true, opacity: 0.2 })
        );
        wm.position.copy(m.position);
        scene.add(wm);
    }

    function addLight(x, z, color, intensity, distance) {
        const pl = new THREE.PointLight(color, intensity, distance);
        pl.position.set(x, getY(x,z)+5, z);
        scene.add(pl);
        const b = new THREE.Mesh(
            new THREE.SphereGeometry(0.4, 6, 6),
            new THREE.MeshStandardMaterial({ emissive: color, emissiveIntensity: 2, color: 0xffffff })
        );
        b.position.copy(pl.position);
        scene.add(b);
    }

    function addRoad(x, z, w, l, horiz) {
        const m = new THREE.Mesh(
            horiz ? new THREE.BoxGeometry(l,0.3,w) : new THREE.BoxGeometry(w,0.3,l),
            new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 })
        );
        m.receiveShadow = true;
        m.position.set(x, getY(x,z)+0.15, z);
        scene.add(m);
    }

    function addTree(x, z) {
        const ty = getY(x,z);
        const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3,0.5,3,6), new THREE.MeshStandardMaterial({ color: 0x92400e }));
        trunk.position.set(x, ty+1.5, z); trunk.castShadow = true; scene.add(trunk);
        [3, 2.5, 2].forEach((r, i) => {
            const c = new THREE.Mesh(new THREE.ConeGeometry(r,3.5,8), new THREE.MeshStandardMaterial({ color: i===0?0x166534:0x15803d, flatShading:true }));
            c.position.set(x, ty+3+i*2.2, z); c.castShadow = true; scene.add(c);
        });
    }

    // Roads
    addRoad(0, 0, 8, 200, true);   addRoad(0, 0, 8, 200, false);
    [-50, 50].forEach(o => { addRoad(o,0,5,200,false); addRoad(0,o,5,200,true); });

    // Central Tower District
    [
        [0,   0,  10, 10, 80, 0x0ea5e9],
        [15,  5,   7,  7, 55, 0x8b5cf6],
        [-15, 5,   7,  7, 50, 0x06b6d4],
        [5,   18,  6,  8, 45, 0xa78bfa],
        [-5, -18,  8,  6, 48, 0x38bdf8],
        [22, -10,  5,  5, 35, 0x7c3aed],
        [-22,-10,  5,  5, 38, 0x0284c7],
        [12, -22,  6,  6, 42, 0x6d28d9],
        [-12, 22,  6,  6, 40, 0x2563eb],
    ].forEach(([x,z,w,d,h,c]) => { addBuilding(x,z,w,d,h,c,c); addLight(x+2,z+2,c,1.5,60); });

    // Residential
    for (let r=0;r<4;r++) for (let c=0;c<4;c++)
        addBuilding(55+c*16, -80+r*16, 10, 10, 8+Math.abs(Math.sin(r*c))*10+6, 0xfef9c3, 0xfde68a);

    // Hospital (cross shape)
    addBuilding(60, 60, 24, 10, 18, 0xf1f5f9, 0xe0f2fe);
    addBuilding(60, 60, 10, 24, 18, 0xf1f5f9, 0xe0f2fe);
    const heli = new THREE.Mesh(
        new THREE.CylinderGeometry(5,5,0.5,32),
        new THREE.MeshStandardMaterial({ color:0xef4444, emissive:0xef4444, emissiveIntensity:0.7 })
    );
    heli.position.set(60, getY(60,60)+18.5, 60); scene.add(heli);
    addLight(60, 60, 0xef4444, 2.5, 80);
    addBuilding(78, 60, 8, 12, 12, 0xe2e8f0, 0xbfdbfe);
    addBuilding(42, 60, 8, 12, 12, 0xe2e8f0, 0xbfdbfe);

    // Park / green zone
    const pGeo = new THREE.CircleGeometry(28, 32); pGeo.rotateX(-Math.PI/2);
    const park = new THREE.Mesh(pGeo, new THREE.MeshStandardMaterial({ color: 0x166534, roughness:0.9 }));
    park.receiveShadow = true;
    park.position.set(-70, getY(-70,-70)+0.2, -70);
    scene.add(park);
    [[-60,-60],[-65,-75],[-75,-60],[-80,-80],[-55,-80],
     [-70,-65],[-85,-65],[-60,-85],[-75,-85],[-90,-70]].forEach(([tx,tz]) => addTree(tx,tz));

    // Tech / industrial district
    for (let i=0;i<6;i++) {
        const bx=-60-i*14, bz=50+(i%3)*20;
        addBuilding(bx,bz,14,18,12+i*3,0x334155,0x38bdf8);
        const ant = new THREE.Mesh(
            new THREE.CylinderGeometry(0.2,0.2,8,6),
            new THREE.MeshStandardMaterial({ color:0x94a3b8, emissive:0xf97316, emissiveIntensity:1 })
        );
        ant.position.set(bx, getY(bx,bz)+12+i*3+4, bz); scene.add(ant);
        addLight(bx, bz, 0x38bdf8, 1, 50);
    }

    // Street lights
    for (let o=-90;o<=90;o+=20) {
        addLight(o, 6, 0xfef08a, 0.8, 30);
        addLight(o,-6, 0xfef08a, 0.8, 30);
        addLight(6, o, 0xfef08a, 0.8, 30);
        addLight(-6,o, 0xfef08a, 0.8, 30);
    }

    // Water tower
    const wtB = new THREE.Mesh(new THREE.CylinderGeometry(0.8,0.8,25,8), new THREE.MeshStandardMaterial({ color:0x64748b, metalness:0.8 }));
    wtB.position.set(-40, getY(-40,-20)+12.5, -20); wtB.castShadow=true; scene.add(wtB);
    const wtT = new THREE.Mesh(new THREE.CylinderGeometry(5,5,6,16), new THREE.MeshStandardMaterial({ color:0x0ea5e9, metalness:0.6 }));
    wtT.position.set(-40, getY(-40,-20)+27, -20); scene.add(wtT);

    // Stars
    const sGeo = new THREE.BufferGeometry();
    const sPos = new Float32Array(2000*3);
    for (let i=0; i<2000*3; i++) sPos[i] = (Math.random()-0.5)*2000;
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color:0xffffff, size:0.7, sizeAttenuation:true })));

    // Resize
    function onResize() {
        if (!container.clientWidth) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    }
    window.addEventListener('resize', onResize);

    // Animate
    let frameId;
    function animate() {
        frameId = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }
    animate();

    // Cleanup
    window._smartCity3DCleanup = function() {
        cancelAnimationFrame(frameId);
        renderer.dispose();
        window.removeEventListener('resize', onResize);
    };

    setTimeout(onResize, 150);
}

