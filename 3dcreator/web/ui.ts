import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { parseResPlan, toMultiPolygon, type ResPlan } from '../src/plan/parseResplan';
import { inferMetersPerUnit, inferPlanExtent, type PlanExtent } from '../src/plan/scale';
import { furnitureFromJson } from '../src/furniture/fromDetections';
import type { FurnitureItem, MultiPolygon2, CameraSpec } from '../src/scene/types';

const WALL_HEIGHT_M = 3.0;
const FLOOR_THICKNESS_M = 0.1;

type Nullable<T> = T | null;

interface UiState {
  plan: Nullable<ResPlan>;
  furnitureJson: unknown;
  layoutImage: Nullable<HTMLImageElement>;
  mPerUnit: number;
  extent: Nullable<PlanExtent>;
  sceneGroup: Nullable<THREE.Group>;
}

const state: UiState = {
  plan: null,
  furnitureJson: null,
  layoutImage: null,
  mPerUnit: 0.05,
  extent: null,
  sceneGroup: null,
};

const viewport = document.getElementById('viewport') as HTMLDivElement;
const planFileInput = document.getElementById('planFile') as HTMLInputElement;
const furnitureFileInput = document.getElementById('furnitureFile') as HTMLInputElement;
const layoutImageFileInput = document.getElementById('layoutImageFile') as HTMLInputElement;
const buildBtn = document.getElementById('buildBtn') as HTMLButtonElement;
const centerCameraBtn = document.getElementById('centerCameraBtn') as HTMLButtonElement;
const exportBtn = document.getElementById('exportBtn') as HTMLButtonElement;
const cameraXInput = document.getElementById('cameraX') as HTMLInputElement;
const cameraYInput = document.getElementById('cameraY') as HTMLInputElement;
const headingDegInput = document.getElementById('headingDeg') as HTMLInputElement;
const pitchDegInput = document.getElementById('pitchDeg') as HTMLInputElement;
const fovDegInput = document.getElementById('fovDeg') as HTMLInputElement;
const cameraHeightInput = document.getElementById('cameraHeight') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const planCanvas = document.getElementById('planCanvas') as HTMLCanvasElement;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.setClearColor('#ece9df');
viewport.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#ece9df');

const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 2000);
camera.position.set(0, 10, 10);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.8, 0);
controls.update();

scene.add(new THREE.AmbientLight(0xffffff, 0.82));
const sun = new THREE.DirectionalLight(0xffffff, 0.85);
sun.position.set(10, 16, 8);
sun.castShadow = true;
scene.add(sun);

const ground = new THREE.GridHelper(80, 80, 0x777777, 0xb0b0b0);
scene.add(ground);

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function parseNumber(input: HTMLInputElement, fallback: number): number {
  const n = Number(input.value);
  return Number.isFinite(n) ? n : fallback;
}

function ensureClosedRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 3) return [];
  const out = [...ring];
  const first = out[0];
  const last = out[out.length - 1];
  if (Math.abs(first[0] - last[0]) > 1e-8 || Math.abs(first[1] - last[1]) > 1e-8) {
    out.push([first[0], first[1]]);
  }
  return out;
}

function ringToVec2(ring: [number, number][], mPerUnit: number): THREE.Vector2[] {
  const closed = ensureClosedRing(ring);
  if (closed.length < 4) return [];
  return closed.slice(0, -1).map(([x, y]) => new THREE.Vector2(x * mPerUnit, -y * mPerUnit));
}

function polygonToShape(polygon: [number, number][][], mPerUnit: number): Nullable<THREE.Shape> {
  if (polygon.length === 0) return null;
  const outer = ringToVec2(polygon[0], mPerUnit);
  if (outer.length < 3) return null;

  const shape = new THREE.Shape(outer);
  for (let i = 1; i < polygon.length; i += 1) {
    const hole = ringToVec2(polygon[i], mPerUnit);
    if (hole.length < 3) continue;
    shape.holes.push(new THREE.Path(hole));
  }
  return shape;
}

function addExtrudedPolygons(
  target: THREE.Group,
  multipolygon: MultiPolygon2,
  depth: number,
  material: THREE.Material,
  yOffset: number,
  mPerUnit: number,
): void {
  for (const polygon of multipolygon) {
    const shape = polygonToShape(polygon, mPerUnit);
    if (!shape) continue;
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = yOffset;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    target.add(mesh);
  }
}

function furnitureColor(type: FurnitureItem['type']): string {
  switch (type) {
    case 'bed':
      return '#4670c9';
    case 'sofa':
      return '#6f8b4b';
    case 'wardrobe':
      return '#8c6b55';
    case 'table':
    case 'dining_table':
      return '#ac7a45';
    case 'chair':
      return '#967557';
    case 'cabinet':
    case 'kitchen_unit':
      return '#8f8f84';
    case 'toilet':
    case 'sink':
    case 'bathtub':
      return '#7190a1';
    default:
      return '#8ea1af';
  }
}

function addFurniture(target: THREE.Group, furniture: FurnitureItem[]): void {
  for (const item of furniture) {
    const geometry = new THREE.BoxGeometry(item.size_m.w, item.size_m.h, item.size_m.d);
    const material = new THREE.MeshStandardMaterial({ color: furnitureColor(item.type), roughness: 0.92 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(item.center_m.x, item.size_m.h / 2, item.center_m.z);
    mesh.rotation.y = (item.rotY_deg * Math.PI) / 180;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    target.add(mesh);
  }
}

function computeCameraFromInputs(mPerUnit: number): CameraSpec {
  const camX = parseNumber(cameraXInput, 120);
  const camY = parseNumber(cameraYInput, 180);
  const headingDeg = parseNumber(headingDegInput, 45);
  const pitchDeg = parseNumber(pitchDegInput, -10);
  const fovDeg = parseNumber(fovDegInput, 60);
  const cameraHeight = parseNumber(cameraHeightInput, 1.8);

  const headingRad = (headingDeg * Math.PI) / 180;
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const cosPitch = Math.cos(pitchRad);
  const dirX = Math.cos(headingRad) * cosPitch;
  const dirY = Math.sin(pitchRad);
  const dirZ = Math.sin(headingRad) * cosPitch;

  const x = camX * mPerUnit;
  const z = camY * mPerUnit;

  return {
    position: { x, y: cameraHeight, z },
    lookAt: {
      x: x + dirX * 10,
      y: cameraHeight + dirY * 10,
      z: z + dirZ * 10,
    },
    fovDeg,
  };
}

function readJsonFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsText(file);
  });
}

function readImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read image ${file.name}`));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Invalid image ${file.name}`));
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function resizeRenderer(): void {
  const width = Math.max(1, viewport.clientWidth);
  const height = Math.max(1, viewport.clientHeight);
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate(): void {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function extentSpan(extent: PlanExtent): { sx: number; sy: number } {
  return {
    sx: Math.max(1, extent.maxX - extent.minX),
    sy: Math.max(1, extent.maxY - extent.minY),
  };
}

function mapPlanToCanvas(x: number, y: number, extent: PlanExtent): { x: number; y: number } {
  const { sx, sy } = extentSpan(extent);
  return {
    x: ((x - extent.minX) / sx) * planCanvas.width,
    y: ((y - extent.minY) / sy) * planCanvas.height,
  };
}

function mapCanvasToPlan(x: number, y: number, extent: PlanExtent): { x: number; y: number } {
  const { sx, sy } = extentSpan(extent);
  return {
    x: extent.minX + (x / planCanvas.width) * sx,
    y: extent.minY + (y / planCanvas.height) * sy,
  };
}

function drawPolygonPath(ctx: CanvasRenderingContext2D, polygon: [number, number][][], extent: PlanExtent): void {
  for (const ring of polygon) {
    if (ring.length === 0) continue;
    ctx.beginPath();
    ring.forEach(([x, y], idx) => {
      const pt = mapPlanToCanvas(x, y, extent);
      if (idx === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawPlanCanvas(): void {
  const ctx = planCanvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, planCanvas.width, planCanvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, planCanvas.width, planCanvas.height);

  if (!state.extent) return;

  if (state.layoutImage) {
    ctx.globalAlpha = 0.55;
    ctx.drawImage(state.layoutImage, 0, 0, planCanvas.width, planCanvas.height);
    ctx.globalAlpha = 1;
  }

  if (state.plan) {
    const inner = toMultiPolygon(state.plan.inner);
    const walls = toMultiPolygon(state.plan.wall);

    ctx.strokeStyle = '#8f8a80';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(120,120,120,0.14)';
    for (const poly of walls) drawPolygonPath(ctx, poly, state.extent);

    ctx.strokeStyle = '#005f73';
    ctx.fillStyle = 'rgba(0, 95, 115, 0.16)';
    for (const poly of inner) drawPolygonPath(ctx, poly, state.extent);
  }

  const camX = parseNumber(cameraXInput, 120);
  const camY = parseNumber(cameraYInput, 180);
  const heading = (parseNumber(headingDegInput, 45) * Math.PI) / 180;
  const camPt = mapPlanToCanvas(camX, camY, state.extent);

  ctx.beginPath();
  ctx.fillStyle = '#d62828';
  ctx.arc(camPt.x, camPt.y, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.strokeStyle = '#d62828';
  ctx.lineWidth = 2;
  ctx.moveTo(camPt.x, camPt.y);
  ctx.lineTo(camPt.x + Math.cos(heading) * 24, camPt.y + Math.sin(heading) * 24);
  ctx.stroke();
}

function buildSceneGroup(plan: ResPlan, mPerUnit: number, furniture: FurnitureItem[]): THREE.Group {
  const group = new THREE.Group();

  const floorMat = new THREE.MeshStandardMaterial({ color: '#7d7d7d', roughness: 1.0 });
  const wallMat = new THREE.MeshStandardMaterial({ color: '#d8d8d4', roughness: 0.94 });
  const windowMat = new THREE.MeshStandardMaterial({
    color: '#4da3ff',
    transparent: true,
    opacity: 0.52,
    roughness: 0.35,
  });

  addExtrudedPolygons(group, toMultiPolygon(plan.inner), FLOOR_THICKNESS_M, floorMat, -FLOOR_THICKNESS_M, mPerUnit);
  addExtrudedPolygons(group, toMultiPolygon(plan.wall), WALL_HEIGHT_M, wallMat, 0, mPerUnit);
  addExtrudedPolygons(group, toMultiPolygon(plan.window), 0.05, windowMat, 1.2, mPerUnit);
  addFurniture(group, furniture);

  return group;
}

function applyCamera(cameraSpec: CameraSpec): void {
  camera.fov = cameraSpec.fovDeg;
  camera.updateProjectionMatrix();
  camera.position.set(cameraSpec.position.x, cameraSpec.position.y, cameraSpec.position.z);
  controls.target.set(cameraSpec.lookAt.x, cameraSpec.lookAt.y, cameraSpec.lookAt.z);
  controls.update();
}

function removeCurrentGroup(): void {
  if (!state.sceneGroup) return;
  scene.remove(state.sceneGroup);
  state.sceneGroup.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[];
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
  state.sceneGroup = null;
}

function setCameraToCenter(): void {
  if (!state.extent) return;
  cameraXInput.value = ((state.extent.minX + state.extent.maxX) / 2).toFixed(1);
  cameraYInput.value = ((state.extent.minY + state.extent.maxY) / 2).toFixed(1);
  drawPlanCanvas();
}

async function refreshScene(): Promise<void> {
  if (!state.plan) {
    setStatus('Load a plan JSON first.');
    return;
  }

  const plan = state.plan;
  const furnitureData = state.furnitureJson ?? plan.furniture;
  const furniture = furnitureFromJson(furnitureData, state.mPerUnit);

  removeCurrentGroup();
  state.sceneGroup = buildSceneGroup(plan, state.mPerUnit, furniture);
  scene.add(state.sceneGroup);

  const cameraSpec = computeCameraFromInputs(state.mPerUnit);
  applyCamera(cameraSpec);
  drawPlanCanvas();

  const innerCount = toMultiPolygon(plan.inner).length;
  const wallCount = toMultiPolygon(plan.wall).length;
  setStatus(
    [
      `scale m_per_unit: ${state.mPerUnit.toFixed(6)}`,
      `floor polygons: ${innerCount}`,
      `wall polygons: ${wallCount}`,
      `furniture boxes: ${furniture.length}`,
      `camera(plan): ${parseNumber(cameraXInput, 0).toFixed(1)}, ${parseNumber(cameraYInput, 0).toFixed(1)}`,
    ].join('\n'),
  );
}

async function onPlanSelected(): Promise<void> {
  const file = planFileInput.files?.[0];
  if (!file) return;

  const raw = await readJsonFile(file);
  state.plan = parseResPlan(raw);
  state.mPerUnit = inferMetersPerUnit(state.plan).mPerUnit;
  state.extent = inferPlanExtent(state.plan);

  setCameraToCenter();
  drawPlanCanvas();
  await refreshScene();
}

async function onFurnitureSelected(): Promise<void> {
  const file = furnitureFileInput.files?.[0];
  if (!file) {
    state.furnitureJson = null;
    await refreshScene();
    return;
  }
  state.furnitureJson = await readJsonFile(file);
  await refreshScene();
}

async function onLayoutImageSelected(): Promise<void> {
  const file = layoutImageFileInput.files?.[0];
  if (!file) {
    state.layoutImage = null;
    drawPlanCanvas();
    return;
  }
  state.layoutImage = await readImageFile(file);
  drawPlanCanvas();
}

function exportViewportPng(): void {
  const a = document.createElement('a');
  a.href = renderer.domElement.toDataURL('image/png');
  a.download = 'ui_render.png';
  a.click();
}

planCanvas.addEventListener('click', (event) => {
  if (!state.extent) return;
  const rect = planCanvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const planPt = mapCanvasToPlan((x / rect.width) * planCanvas.width, (y / rect.height) * planCanvas.height, state.extent);
  cameraXInput.value = planPt.x.toFixed(1);
  cameraYInput.value = planPt.y.toFixed(1);
  drawPlanCanvas();
});

planFileInput.addEventListener('change', () => {
  onPlanSelected().catch((error) => setStatus(`Plan load failed: ${String(error)}`));
});
furnitureFileInput.addEventListener('change', () => {
  onFurnitureSelected().catch((error) => setStatus(`Furniture load failed: ${String(error)}`));
});
layoutImageFileInput.addEventListener('change', () => {
  onLayoutImageSelected().catch((error) => setStatus(`Image load failed: ${String(error)}`));
});

buildBtn.addEventListener('click', () => {
  refreshScene().catch((error) => setStatus(`Build failed: ${String(error)}`));
});
centerCameraBtn.addEventListener('click', () => {
  setCameraToCenter();
  refreshScene().catch((error) => setStatus(`Camera update failed: ${String(error)}`));
});
exportBtn.addEventListener('click', exportViewportPng);

[cameraXInput, cameraYInput, headingDegInput, pitchDegInput, fovDegInput, cameraHeightInput].forEach((input) => {
  input.addEventListener('input', () => {
    drawPlanCanvas();
    if (!state.plan) return;
    const cam = computeCameraFromInputs(state.mPerUnit);
    applyCamera(cam);
  });
});

window.addEventListener('resize', resizeRenderer);
resizeRenderer();
animate();
