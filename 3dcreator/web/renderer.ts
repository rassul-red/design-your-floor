import * as THREE from 'three';
import type { SceneDescription, FurnitureItem, MultiPolygon2 } from '../src/scene/types';

declare global {
  interface Window {
    __SCENE__?: SceneDescription;
    __RENDER_DONE__?: boolean;
    __RENDER_ERROR__?: string;
  }
}

function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

function normalizeRing(ring: [number, number][]): [number, number][] {
  if (ring.length < 4) {
    return [];
  }
  const out = [...ring];
  const first = out[0];
  const last = out[out.length - 1];
  if (!almostEqual(first[0], last[0]) || !almostEqual(first[1], last[1])) {
    out.push([first[0], first[1]]);
  }
  return out;
}

function toShapeRing(ring: [number, number][]): THREE.Vector2[] {
  const closed = normalizeRing(ring);
  if (closed.length < 4) {
    return [];
  }
  const trimmed = closed.slice(0, -1);
  return trimmed.map(([x, z]) => new THREE.Vector2(x, -z));
}

function polygonToShape(polygon: [number, number][][]): THREE.Shape | null {
  if (polygon.length === 0) {
    return null;
  }
  const outer = toShapeRing(polygon[0]);
  if (outer.length < 3) {
    return null;
  }

  const shape = new THREE.Shape(outer);
  for (let i = 1; i < polygon.length; i += 1) {
    const holePts = toShapeRing(polygon[i]);
    if (holePts.length < 3) {
      continue;
    }
    shape.holes.push(new THREE.Path(holePts));
  }

  return shape;
}

function addExtrudedPolygons(
  scene: THREE.Scene,
  multipolygon: MultiPolygon2,
  depth: number,
  material: THREE.Material,
  yOffset: number,
): void {
  for (const polygon of multipolygon) {
    const shape = polygonToShape(polygon);
    if (!shape) {
      continue;
    }

    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
    });
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = yOffset;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function furnitureColor(type: FurnitureItem['type']): string {
  switch (type) {
    case 'bed':
      return '#5f8dd3';
    case 'sofa':
      return '#8f9b6e';
    case 'wardrobe':
      return '#7f6f5c';
    case 'table':
    case 'dining_table':
      return '#b58b5c';
    case 'chair':
      return '#a68a6f';
    case 'cabinet':
    case 'kitchen_unit':
      return '#9e8d75';
    default:
      return '#90a4ae';
  }
}

function addFurniture(scene: THREE.Scene, furniture: FurnitureItem[]): void {
  for (const item of furniture) {
    const geom = new THREE.BoxGeometry(item.size_m.w, item.size_m.h, item.size_m.d);
    const mat = new THREE.MeshStandardMaterial({ color: furnitureColor(item.type), roughness: 0.9 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(item.center_m.x, item.size_m.h / 2, item.center_m.z);
    mesh.rotation.y = (item.rotY_deg * Math.PI) / 180;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function setupLights(scene: THREE.Scene): void {
  const ambient = new THREE.AmbientLight(0xffffff, 0.75);
  scene.add(ambient);

  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(8, 16, 10);
  dir.castShadow = true;
  scene.add(dir);
}

function renderScene(sceneData: SceneDescription): void {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(sceneData.render.width, sceneData.render.height);
  renderer.setPixelRatio(1);
  renderer.setClearColor(sceneData.render.background);
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(sceneData.render.background);

  setupLights(scene);

  const wallMaterial = new THREE.MeshStandardMaterial({ color: '#dddddd', roughness: 0.95 });
  const floorMaterial = new THREE.MeshStandardMaterial({ color: '#777777', roughness: 1.0 });
  const windowMaterial = new THREE.MeshStandardMaterial({
    color: '#4da3ff',
    roughness: 0.35,
    transparent: true,
    opacity: 0.5,
  });

  addExtrudedPolygons(scene, sceneData.floor, sceneData.floorThickness, floorMaterial, -sceneData.floorThickness);
  addExtrudedPolygons(scene, sceneData.walls, sceneData.wallHeight, wallMaterial, 0);
  addExtrudedPolygons(scene, sceneData.windows, 0.05, windowMaterial, 1.2);
  addFurniture(scene, sceneData.furniture);

  const camera = new THREE.PerspectiveCamera(
    sceneData.camera.fovDeg,
    sceneData.render.width / sceneData.render.height,
    0.05,
    1000,
  );
  camera.position.set(
    sceneData.camera.position.x,
    sceneData.camera.position.y,
    sceneData.camera.position.z,
  );
  camera.lookAt(sceneData.camera.lookAt.x, sceneData.camera.lookAt.y, sceneData.camera.lookAt.z);

  renderer.render(scene, camera);
  window.__RENDER_DONE__ = true;
}

try {
  const sceneData = window.__SCENE__;
  if (!sceneData) {
    throw new Error('No scene data found on window.__SCENE__.');
  }
  renderScene(sceneData);
} catch (error) {
  window.__RENDER_ERROR__ = error instanceof Error ? error.message : String(error);
  window.__RENDER_DONE__ = false;
  throw error;
}
