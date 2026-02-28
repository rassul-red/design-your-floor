// 3D Floor Plan Viewer Logic

let scene, camera, renderer, controls;
let floorPlanGroup = new THREE.Group();
let currentData = null;
const SCALE = 0.05; // 1 pixel = 0.05 meters
const WALL_HEIGHT_M = 3.0;
const WALL_DEPTH = WALL_HEIGHT_M / SCALE;

const ROOM_COLORS = {
    "living": 0xd9d9d9,
    "bedroom": 0x66c2a5,
    "bathroom": 0xfc8d62,
    "kitchen": 0x8da0cb,
    "balcony": 0xb3b3b3
};

init();
animate();

function init() {
    const container = document.getElementById('canvas-container');
    
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf0f0f0);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 20, 20);

    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    container.appendChild(renderer.domElement);

    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0, 0);

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
    dirLight.position.set(100, 200, 100);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.left = -20;
    dirLight.shadow.camera.right = 20;
    dirLight.shadow.camera.top = 20;
    dirLight.shadow.camera.bottom = -20;
    scene.add(dirLight);

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
        controls.target.set(0, 0, 0);
        controls.update();
    });
    document.getElementById('exportBtn').addEventListener('click', exportImage);
    const solidDoorsCheck = document.getElementById('solidDoorsCheck');
    if (solidDoorsCheck) {
        solidDoorsCheck.addEventListener('change', () => {
            if (currentData) build3DModel(currentData);
        });
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
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
            
            if (data.inner) {
                const polys = parsePolygons(data.inner);
                if (polys.length > 0) {
                    const c = computeCentroid(polys[0][0]);
                    document.getElementById('camX').value = Math.round(c.x);
                    document.getElementById('camY').value = Math.round(c.y);
                    controls.target.set(c.x * SCALE, 0, c.y * SCALE);
                    controls.update();
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
    const doorHeight = (isSolidDoors ? 2.0 : 0.05) / SCALE;
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

    const windowBase = 1.0 / SCALE;
    const windowDepth = 1.5 / SCALE;
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
                    // Furniture placement removed until explicit data is provided
                }
            });
        }
    });

    const box = new THREE.Box3().setFromObject(floorPlanGroup);
    const center = box.getCenter(new THREE.Vector3());
    
    floorPlanGroup.position.x = -center.x;
    floorPlanGroup.position.z = -center.z; 

    controls.target.set(0, 0, 0);
    camera.position.set(0, 15, 15);
    controls.update();
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
    
    const rad = angleDeg * Math.PI / 180;
    const lookDist = 5; 
    const lookX = camWorldX + Math.sin(rad) * lookDist;
    const lookZ = camWorldZ - Math.cos(rad) * lookDist; 
    
    controls.target.set(lookX, camWorldY, lookZ);
    controls.update();
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
