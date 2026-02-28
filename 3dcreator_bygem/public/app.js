// 3D Floor Plan Viewer Logic

let scene, camera, renderer;
let floorPlanGroup = new THREE.Group();
let currentData = null;
const SCALE = 0.05; // 1 pixel = 0.05 meters
const WALL_HEIGHT_M = 3.0;
const WALL_DEPTH = WALL_HEIGHT_M / SCALE;

const FURNITURE_CONFIG = {
    "bed":            { color: 0xffaaaa, height: 0.5 },
    "sofa":           { color: 0x555555, height: 0.6 },
    "dining table":   { color: 0x8b6914, height: 0.75 },
    "dining chair":   { color: 0xd2b48c, height: 0.45 },
    "coffee table":   { color: 0x8b6914, height: 0.4 },
    "tv unit":        { color: 0x444444, height: 0.5 },
    "wardrobe":       { color: 0x9b7653, height: 2.0 },
    "bedside table":  { color: 0xc4a882, height: 0.5 },
    "console":        { color: 0x888888, height: 0.8 },
    "counter":        { color: 0xeeeeee, height: 0.9 },
    "toilet":         { color: 0xffffff, height: 0.4 },
    "bathroom sink":  { color: 0xfafafa, height: 0.8 },
    "shower":         { color: 0xadd8e6, height: 0.1 },
    "kitchen sink":   { color: 0xc0c0c0, height: 0.9 },
    "stove":          { color: 0x333333, height: 0.9 },
    "fridge":         { color: 0xdddddd, height: 1.8 },
    "_default":       { color: 0xaaaaaa, height: 0.5 }
};

const ROOM_COLORS = {
    "living": 0xd9d9d9,
    "bedroom": 0x66c2a5,
    "bathroom": 0xfc8d62,
    "kitchen": 0x8da0cb,
    "balcony": 0xb3b3b3
};

const keys = {
    w: false, a: false, s: false, d: false, q: false, e: false
};
let flySpeed = 0.3;

// Mouse Look state
let isDragging = false;
let previousMousePosition = { x: 0, y: 0 };
let cameraYaw = 0; // Horizontal rotation
let cameraPitch = -Math.PI / 4; // Vertical rotation (looking down initially)

init();
animate();

function init() {
    const container = document.getElementById('canvas-container');
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.rotation.order = 'YXZ'; // Important for FPS camera
    updateCameraRotation();
    camera.position.set(0, 20, 20);

    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // 3-Point Lighting & Hemisphere Setup for better depth perception
    // 1. Hemisphere Light adds a gradient (sky to ground) instead of flat ambient light
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemiLight.position.set(0, 200, 0);
    scene.add(hemiLight);

    // 2. Main Sun Light (Casts shadows)
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(100, 200, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.left = -30;
    dirLight.shadow.camera.right = 30;
    dirLight.shadow.camera.top = 30;
    dirLight.shadow.camera.bottom = -30;
    dirLight.shadow.bias = -0.0005;
    scene.add(dirLight);

    // 3. Fill Light (Cool tone, lights up shadowed areas from opposite angle)
    const fillLight1 = new THREE.DirectionalLight(0x90b0d0, 0.3);
    fillLight1.position.set(-100, 100, -50);
    scene.add(fillLight1);

    // 4. Back Light (Warm tone, defines edges opposite to the fill)
    const fillLight2 = new THREE.DirectionalLight(0xd0b090, 0.2);
    fillLight2.position.set(50, 50, -100);
    scene.add(fillLight2);

    // Group for the floor plan
    floorPlanGroup.rotation.x = -Math.PI / 2; // Make Z axis point up
    floorPlanGroup.scale.set(SCALE, SCALE, SCALE);
    scene.add(floorPlanGroup);

    // Event listeners
    window.addEventListener('resize', onWindowResize, false);
    
    document.getElementById('jsonInput').addEventListener('change', handleJSONUpload);
    document.getElementById('updateCamBtn').addEventListener('click', updateCameraFromUI);
    document.getElementById('resetCamBtn').addEventListener('click', () => {
        camera.position.set(0, 20, 20);
        cameraYaw = 0;
        cameraPitch = -Math.PI / 4;
        updateCameraRotation();
    });
    document.getElementById('exportBtn').addEventListener('click', exportImage);
    const exportViewBtn = document.getElementById('exportViewBtn');
    if (exportViewBtn) {
        exportViewBtn.addEventListener('click', exportScreenshot);
    }
    const solidDoorsCheck = document.getElementById('solidDoorsCheck');
    if (solidDoorsCheck) {
        solidDoorsCheck.addEventListener('change', () => {
            if (currentData) build3DModel(currentData);
        });
    }

    const flySpeedSlider = document.getElementById('flySpeedSlider');
    if (flySpeedSlider) {
        flySpeedSlider.addEventListener('input', (e) => {
            flySpeed = parseFloat(e.target.value);
        });
    }

    // Keyboard Listeners
    window.addEventListener('keydown', (e) => {
        const key = e.key.toLowerCase();
        if (keys.hasOwnProperty(key)) keys[key] = true;
    });
    window.addEventListener('keyup', (e) => {
        const key = e.key.toLowerCase();
        if (keys.hasOwnProperty(key)) keys[key] = false;
    });

    // Mouse Listeners for Looking Around (Right-Click Drag)
    renderer.domElement.addEventListener('mousedown', (e) => {
        if (e.button === 2 || e.button === 0) { // Right click (2) or Left click (0) to look
            isDragging = true;
            previousMousePosition = { x: e.offsetX, y: e.offsetY };
        }
    });

    // Modal Listeners
    const modalOverlay = document.getElementById('modal-overlay');
    if (modalOverlay) {
        document.getElementById('closeModalBtn').addEventListener('click', () => {
            modalOverlay.classList.add('hidden');
        });

        const settingsPanel = document.getElementById('settingsPanel');
        document.getElementById('toggleSettingsBtn').addEventListener('click', () => {
            settingsPanel.classList.toggle('visible');
        });

        // Default System Prompt
        const defaultSystemPrompt = `Transform this simple low-poly 3D scene into a realistic interior render while strictly preserving the exact camera angle, perspective, composition, room geometry, wall positions, openings, and spatial layout from the input image.

Some additional info:
- Walls are beige colored
- Blue half-transparent blocks are windows`;

        // Default Furniture Prompt
        const defaultFurniturePrompt = `Add modern, tasteful furniture appropriate for this room type. Include realistic furnishings with proper scale and placement. Use natural materials like wood, fabric, and metal.`;

        // Load saved system prompt or use default
        const savedSysPrompt = localStorage.getItem('geminiSystemPrompt');
        if (savedSysPrompt) {
            document.getElementById('geminiSystemPrompt').value = savedSysPrompt;
        } else {
            document.getElementById('geminiSystemPrompt').value = defaultSystemPrompt;
        }

        // Load saved furniture prompt or use default
        const savedFurniturePrompt = localStorage.getItem('geminiFurniturePrompt');
        document.getElementById('furniturePrompt').value = savedFurniturePrompt || defaultFurniturePrompt;

        // Furniture prompt checkbox toggle
        const furnitureCheck = document.getElementById('furniturePromptCheck');
        const furnitureTextarea = document.getElementById('furniturePrompt');
        furnitureCheck.addEventListener('change', () => {
            furnitureTextarea.disabled = !furnitureCheck.checked;
            furnitureTextarea.style.opacity = furnitureCheck.checked ? '1' : '0.5';
        });

        // Reference images state
        let referenceImages = []; // Array of { dataURL, name }
        const refContainer = document.getElementById('referenceImagesContainer');
        const refThumbnails = document.getElementById('referenceImageThumbnails');
        const refInput = document.getElementById('referenceImageInput');
        const clearRefBtn = document.getElementById('clearReferenceImages');
        const downloadBtn = document.getElementById('downloadResponseBtn');
        const iterateBtn = document.getElementById('iterateBtn');

        function renderRefThumbnails() {
            refThumbnails.innerHTML = '';
            referenceImages.forEach((img, idx) => {
                const wrapper = document.createElement('div');
                wrapper.style.cssText = 'position: relative; width: 80px; height: 80px;';
                const thumb = document.createElement('img');
                thumb.src = img.dataURL;
                thumb.style.cssText = 'width: 80px; height: 80px; object-fit: cover; border-radius: 4px; border: 1px solid #ccc;';
                thumb.title = img.name;
                const removeBtn = document.createElement('button');
                removeBtn.innerText = '×';
                removeBtn.style.cssText = 'position: absolute; top: -6px; right: -6px; background: #f44336; color: white; border: none; border-radius: 50%; width: 20px; height: 20px; font-size: 14px; cursor: pointer; line-height: 18px; padding: 0;';
                removeBtn.addEventListener('click', () => {
                    referenceImages.splice(idx, 1);
                    renderRefThumbnails();
                    if (referenceImages.length === 0) refContainer.classList.add('hidden');
                });
                wrapper.appendChild(thumb);
                wrapper.appendChild(removeBtn);
                refThumbnails.appendChild(wrapper);
            });
        }

        refInput.addEventListener('change', (e) => {
            Array.from(e.target.files).forEach(file => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    referenceImages.push({ dataURL: ev.target.result, name: file.name });
                    renderRefThumbnails();
                    refContainer.classList.remove('hidden');
                };
                reader.readAsDataURL(file);
            });
            refInput.value = '';
        });

        clearRefBtn.addEventListener('click', () => {
            referenceImages = [];
            renderRefThumbnails();
            refContainer.classList.add('hidden');
        });

        // Download the generated image
        downloadBtn.addEventListener('click', () => {
            const imgSrc = document.getElementById('geminiResponseImage').src;
            if (!imgSrc) return;
            const link = document.createElement('a');
            link.href = imgSrc;
            link.download = 'gemini_enhanced_' + Date.now() + '.png';
            link.click();
        });

        // Iterate: use the generated image as the new context image
        iterateBtn.addEventListener('click', () => {
            const generatedImg = document.getElementById('geminiResponseImage').src;
            if (!generatedImg) return;
            // Replace the screenshot preview with the generated image
            document.getElementById('screenshotPreview').src = generatedImg;
            // Show reference image upload area
            refContainer.classList.remove('hidden');
            // Clear the user prompt for new instructions
            document.getElementById('geminiUserPrompt').value = '';
            // Hide the response container
            document.getElementById('geminiResponseContainer').classList.add('hidden');
            // Scroll to top of modal
            document.getElementById('modal-content').scrollTop = 0;
        });

        document.getElementById('geminiEnhanceBtn').addEventListener('click', async () => {
            const sysPrompt = document.getElementById('geminiSystemPrompt').value;
            const userPrompt = document.getElementById('geminiUserPrompt').value;
            const imageSrc = document.getElementById('screenshotPreview').src;
            const btn = document.getElementById('geminiEnhanceBtn');
            const responseContainer = document.getElementById('geminiResponseContainer');
            const responseText = document.getElementById('geminiResponseText');
            const responseImage = document.getElementById('geminiResponseImage');

            // Save prompts
            localStorage.setItem('geminiSystemPrompt', sysPrompt);
            localStorage.setItem('geminiFurniturePrompt', furnitureTextarea.value);

            // Append furniture prompt if checked
            let fullSystemPrompt = sysPrompt;
            if (furnitureCheck.checked && furnitureTextarea.value.trim()) {
                fullSystemPrompt += '\n\nFurniture instructions:\n' + furnitureTextarea.value.trim();
            }

            btn.innerText = '✨ Enhancing...';
            btn.disabled = true;
            responseContainer.classList.add('hidden');
            responseText.classList.add('hidden');
            responseImage.classList.add('hidden');
            downloadBtn.classList.add('hidden');
            iterateBtn.classList.add('hidden');
            responseText.innerText = '';
            responseImage.src = '';

            try {
                const res = await fetch('/api/enhance', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        systemPrompt: fullSystemPrompt,
                        userPrompt: userPrompt,
                        image: imageSrc,
                        referenceImages: referenceImages.map(r => r.dataURL)
                    })
                });

                const data = await res.json();

                if (!res.ok) {
                    throw new Error(data.error || 'Server error occurred');
                }

                if (data.isImage) {
                    responseImage.src = data.result;
                    responseImage.classList.remove('hidden');
                    downloadBtn.classList.remove('hidden');
                    iterateBtn.classList.remove('hidden');
                } else {
                    responseText.innerText = data.result;
                    responseText.classList.remove('hidden');
                }
                responseContainer.classList.remove('hidden');

            } catch (error) {
                console.error("Error:", error);
                alert(`Failed: ${error.message}`);
            } finally {
                btn.innerText = '✨ Gemini Enhance';
                btn.disabled = false;
            }
        });
    }

    renderer.domElement.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const deltaX = e.offsetX - previousMousePosition.x;
            const deltaY = e.offsetY - previousMousePosition.y;

            const lookSpeed = 0.005;
            cameraYaw -= deltaX * lookSpeed;
            cameraPitch -= deltaY * lookSpeed;

            // Clamp pitch to avoid flipping over
            cameraPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, cameraPitch));

            updateCameraRotation();

            previousMousePosition = { x: e.offsetX, y: e.offsetY };
        }
    });

    window.addEventListener('mouseup', () => {
        isDragging = false;
    });
    
    // Prevent context menu on right click so we can use it to drag
    renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
}

function updateCameraRotation() {
    camera.rotation.set(cameraPitch, cameraYaw, 0);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    
    // Fly Controls Logic (WASD relative to camera looking direction)
    if (keys.w || keys.a || keys.s || keys.d || keys.q || keys.e) {
        const dir = new THREE.Vector3(0, 0, -1);
        dir.applyQuaternion(camera.quaternion);
        
        // Flatten the forward vector for pure WASD walking (optional, but typical for FPS)
        // dir.y = 0; 
        // dir.normalize();

        const right = new THREE.Vector3(1, 0, 0);
        right.applyQuaternion(camera.quaternion);
        
        // right.y = 0;
        // right.normalize();

        const move = new THREE.Vector3();
        if (keys.w) move.addScaledVector(dir, flySpeed);
        if (keys.s) move.addScaledVector(dir, -flySpeed);
        if (keys.a) move.addScaledVector(right, -flySpeed); // A is left, right vector is positive X
        if (keys.d) move.addScaledVector(right, flySpeed);
        
        // Q/E move strictly on world Y axis
        if (keys.q) move.y += flySpeed;
        if (keys.e) move.y -= flySpeed;
        
        camera.position.add(move);
    }
    
    renderer.render(scene, camera);
}

function exportScreenshot() {
    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');
    
    const previewImg = document.getElementById('screenshotPreview');
    const modalOverlay = document.getElementById('modal-overlay');
    
    if (previewImg && modalOverlay) {
        previewImg.src = dataURL;
        modalOverlay.classList.remove('hidden');
    }
}

function parsePolygons(data) {
    let polygons = [];
    if (data.type === 'MultiPolygon') {
        polygons = data.coordinates;
    } else if (data.type === 'Polygon') {
        polygons = [data.coordinates];
    }
    return polygons;
}

function createShape(polygon) {
    if (!polygon || polygon.length === 0) return null;
    
    const extRing = polygon[0];
    const shape = new THREE.Shape();
    
    extRing.forEach((pt, i) => {
        if (i === 0) shape.moveTo(pt[0], pt[1]);
        else shape.lineTo(pt[0], pt[1]);
    });

    for (let i = 1; i < polygon.length; i++) {
        const intRing = polygon[i];
        const hole = new THREE.Path();
        intRing.forEach((pt, j) => {
            if (j === 0) hole.moveTo(pt[0], pt[1]);
            else hole.lineTo(pt[0], pt[1]);
        });
        shape.holes.push(hole);
    }
    return shape;
}

function createPolygonOutline(polygon, depth, zOffset = 0) {
    const points = [];
    polygon.forEach(ring => {
        // Assume ring first and last points are the same, iterate to length - 1
        for (let i = 0; i < ring.length - 1; i++) {
            const p1 = ring[i];
            const p2 = ring[i + 1];
            // Bottom edge
            points.push(new THREE.Vector3(p1[0], p1[1], zOffset));
            points.push(new THREE.Vector3(p2[0], p2[1], zOffset));
            // Top edge
            points.push(new THREE.Vector3(p1[0], p1[1], zOffset + depth));
            points.push(new THREE.Vector3(p2[0], p2[1], zOffset + depth));
            // Vertical edge at p1
            points.push(new THREE.Vector3(p1[0], p1[1], zOffset));
            points.push(new THREE.Vector3(p1[0], p1[1], zOffset + depth));
        }
    });
    return new THREE.BufferGeometry().setFromPoints(points);
}

function computeCentroid(extRing) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    extRing.forEach(pt => {
        if (pt[0] < minX) minX = pt[0];
        if (pt[0] > maxX) maxX = pt[0];
        if (pt[1] < minY) minY = pt[1];
        if (pt[1] > maxY) maxY = pt[1];
    });
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

function handleJSONUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(evt) {
        try {
            const data = JSON.parse(evt.target.result);
            currentData = data;
            build3DModel(data);
            document.getElementById('controls').classList.remove('hidden');
            
            // Auto-populate furniture prompt if JSON has furniture data
            if (data.furniture) {
                const furnitureCheck = document.getElementById('furniturePromptCheck');
                const furnitureTextarea = document.getElementById('furniturePrompt');
                if (furnitureCheck && furnitureTextarea) {
                    furnitureCheck.checked = true;
                    furnitureTextarea.disabled = false;
                    furnitureTextarea.style.opacity = '1';
                    furnitureTextarea.value = 'Each object of image is furniture (besides walls, windows)\n' + JSON.stringify(data.furniture, null, 2);
                }
            }

            if (data.inner) {
                const polys = parsePolygons(data.inner);
                if (polys.length > 0) {
                    const c = computeCentroid(polys[0][0]);
                    document.getElementById('camX').value = Math.round(c.x);
                    document.getElementById('camY').value = Math.round(c.y);
                    
                    // Set initial look target if needed, but we use rotation now
                }
            }
            
        } catch (err) {
            alert('Error parsing JSON: ' + err.message);
            console.error(err);
        }
    };
    reader.readAsText(file);
}

function build3DModel(data) {
    while(floorPlanGroup.children.length > 0){ 
        floorPlanGroup.remove(floorPlanGroup.children[0]); 
    }

    const wallMat = new THREE.MeshStandardMaterial({ color: 0xffeebb, roughness: 0.8 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.6 });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x87ceeb, transparent: true, opacity: 0.5 });
    
    if (data.wall) {
        const polys = parsePolygons(data.wall);
        polys.forEach(poly => {
            const shape = createShape(poly);
            if (shape) {
                const extrudeSettings = { depth: WALL_DEPTH, bevelEnabled: false };
                const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                const mesh = new THREE.Mesh(geometry, wallMat);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                floorPlanGroup.add(mesh);
            }
        });
    }
    // 2. Build Doors
    const isSolidDoors = document.getElementById('solidDoorsCheck') ? document.getElementById('solidDoorsCheck').checked : false;
    const doorHeight = (isSolidDoors ? 2.5 : 0.05) / SCALE;
    if (data.door) {
        const polys = parsePolygons(data.door);
        polys.forEach(poly => {
            const shape = createShape(poly);
            if (shape) {
                const extrudeSettings = { depth: doorHeight, bevelEnabled: false };
                const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                const mesh = new THREE.Mesh(geometry, doorMat);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                floorPlanGroup.add(mesh);
            }
        });
    }

    // 2.5 Build Front Door (distinct from other doors)
    const frontDoorMat = new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.7 }); // Reddish, distinct color
    if (data.front_door) {
        const polys = parsePolygons(data.front_door);
        polys.forEach(poly => {
            const shape = createShape(poly);
            if (shape) {
                const extrudeSettings = { depth: doorHeight, bevelEnabled: false };
                const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                const mesh = new THREE.Mesh(geometry, frontDoorMat);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                floorPlanGroup.add(mesh);
            }
        });
    }
                // 3. Build Windows (from bottom to top)
                const windowBase = 0; // Start exactly at the floor
                const windowDepth = WALL_HEIGHT_M / SCALE; // Full height from floor to ceiling
                if (data.window) {
                const polys = parsePolygons(data.window);
                polys.forEach(poly => {
                const shape = createShape(poly);
                if (shape) {
                const extrudeSettings = { depth: windowDepth, bevelEnabled: false };
                const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                const mesh = new THREE.Mesh(geometry, windowMat);
                mesh.position.z = windowBase; 
                floorPlanGroup.add(mesh);
            }
        });
    }
                const rooms = ["living", "bedroom", "bathroom", "kitchen", "balcony"];
                rooms.forEach(roomType => {
                if (data[roomType]) {
                const color = ROOM_COLORS[roomType] || 0xdddddd;
                const floorMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.9 });
                const polys = parsePolygons(data[roomType]);

                polys.forEach(poly => {
                const shape = createShape(poly);
                if (shape) {
                    const extrudeSettings = { depth: 1, bevelEnabled: false };
                    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                    const mesh = new THREE.Mesh(geometry, floorMat);
                    mesh.position.z = -1; 
                    mesh.receiveShadow = true;
                    floorPlanGroup.add(mesh);
                }
            });
        }
    });

    // Build furniture from furnished JSON
    if (data.furniture) {
        Object.keys(data.furniture).forEach(roomKey => {
            const items = data.furniture[roomKey];
            items.forEach(item => {
                const config = FURNITURE_CONFIG[item.type] || FURNITURE_CONFIG["_default"];
                const heightPx = config.height / SCALE;
                const geo = new THREE.BoxGeometry(item.width_coord, item.height_coord, heightPx);
                const mat = new THREE.MeshStandardMaterial({ color: config.color, roughness: 0.7 });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.set(
                    item.x_coord,
                    item.y_coord,
                    heightPx / 2
                );
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                floorPlanGroup.add(mesh);
            });
        });
    }

    const box = new THREE.Box3().setFromObject(floorPlanGroup);
    const center = box.getCenter(new THREE.Vector3());
    
    floorPlanGroup.position.x = -center.x;
    floorPlanGroup.position.z = -center.z; 

    camera.position.set(0, 15, 15);
    cameraYaw = 0;
    cameraPitch = -Math.PI / 4;
    updateCameraRotation();
}

function placeFurniture(roomType, extRing) {
    const c = computeCentroid(extRing);
    
    let geo, mat, heightM = 0;
    
    if (roomType === "bedroom") {
        geo = new THREE.BoxGeometry(2.0/SCALE, 1.6/SCALE, 0.5/SCALE);
        mat = new THREE.MeshStandardMaterial({ color: 0xffaaaa });
        heightM = 0.5;
    } else if (roomType === "living") {
        geo = new THREE.BoxGeometry(2.0/SCALE, 0.8/SCALE, 0.8/SCALE);
        mat = new THREE.MeshStandardMaterial({ color: 0x555555 });
        heightM = 0.8;
    } else if (roomType === "bathroom") {
        geo = new THREE.BoxGeometry(1.5/SCALE, 0.8/SCALE, 0.6/SCALE);
        mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
        heightM = 0.6;
    } else if (roomType === "kitchen") {
        geo = new THREE.BoxGeometry(2.0/SCALE, 0.6/SCALE, 0.9/SCALE);
        mat = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
        heightM = 0.9;
    }

    if (geo && mat) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(c.x, c.y, (heightM / SCALE) / 2); 
        floorPlanGroup.add(mesh);
    }
}

function updateCameraFromUI() {
    const h = parseFloat(document.getElementById('camHeight').value);
    const x = parseFloat(document.getElementById('camX').value);
    const y = parseFloat(document.getElementById('camY').value);
    const angleDeg = parseFloat(document.getElementById('camAngle').value);
    
    const offsetX = floorPlanGroup.position.x;
    const offsetZ = floorPlanGroup.position.z;

    const camWorldX = x * SCALE + offsetX;
    const camWorldZ = y * SCALE + offsetZ;
    const camWorldY = h;

    camera.position.set(camWorldX, camWorldY, camWorldZ);
    
    // UI angle typically assumes 0 is "up" on the 2D map. 
    // In our 3D space, mapping that to yaw:
    cameraYaw = angleDeg * Math.PI / 180;
    cameraPitch = 0; // Look straight ahead when using UI
    updateCameraRotation();
}

function exportImage() {
    renderer.render(scene, camera);
    const dataURL = renderer.domElement.toDataURL('image/png');
    
    const link = document.createElement('a');
    link.href = dataURL;
    link.download = 'floor_plan_render.png';
    link.click();
}

// Headless entry point for Puppeteer
window.renderHeadless = function(jsonData, camConfig) {
    build3DModel(jsonData);
    
    // Config: { height, x, y, angle }
    const h = camConfig.height || 1.8;
    const x = camConfig.x || 128;
    const y = camConfig.y || 128;
    const angleDeg = camConfig.angle || 0;
    
    const offsetX = floorPlanGroup.position.x;
    const offsetZ = floorPlanGroup.position.z;

    const camWorldX = x * SCALE + offsetX;
    const camWorldZ = y * SCALE + offsetZ;
    const camWorldY = h;

    camera.position.set(camWorldX, camWorldY, camWorldZ);
    
    const rad = angleDeg * Math.PI / 180;
    const lookDist = 5;
    const lookX = camWorldX + Math.sin(rad) * lookDist;
    const lookZ = camWorldZ - Math.cos(rad) * lookDist;
    
    controls.target.set(lookX, camWorldY, lookZ);
    controls.update();
    
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
};
