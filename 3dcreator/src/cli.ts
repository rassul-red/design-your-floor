import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseResPlan, toMultiPolygon } from './plan/parseResplan';
import { inferMetersPerUnit, inferPlanExtent } from './plan/scale';
import { buildScene } from './scene/buildScene';
import { furnitureFromJson, detectionsToFurniture, type Detection } from './furniture/fromDetections';
import type { CameraSpec, FurnitureItem } from './scene/types';
import { renderWithPlaywright } from './render/renderWithPlaywright';

type ArgMap = Record<string, string | boolean>;

function parseArgs(argv: string[]): ArgMap {
  const out: ArgMap = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }

    const eqIndex = arg.indexOf('=');
    if (eqIndex >= 0) {
      const key = arg.slice(2, eqIndex);
      out[key] = arg.slice(eqIndex + 1);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function asString(args: ArgMap, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' ? value : undefined;
}

function asNumber(args: ArgMap, key: string, fallback?: number): number {
  const value = asString(args, key);
  if (value === undefined) {
    if (fallback !== undefined) {
      return fallback;
    }
    throw new Error(`Missing required argument --${key}`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Argument --${key} must be a number`);
  }
  return parsed;
}

function parsePair(value: string, name: string): { x: number; y: number } {
  const parts = value.split(',').map((part) => Number(part.trim()));
  if (parts.length !== 2 || !parts.every((n) => Number.isFinite(n))) {
    throw new Error(`Expected ${name} in format x,y`);
  }
  return { x: parts[0], y: parts[1] };
}

function parseRenderSize(value: string | undefined): { width: number; height: number } {
  if (!value) {
    return { width: 1024, height: 1024 };
  }
  const pair = parsePair(value, '--renderSize');
  return {
    width: Math.max(64, Math.round(pair.x)),
    height: Math.max(64, Math.round(pair.y)),
  };
}

function usage(): string {
  return [
    'Usage:',
    '  npm run pipeline -- --plan <plan.json> --headingDeg <deg> --cameraPx x,y [options]',
    '',
    'Required:',
    '  --plan <path>         Path to ResPlan JSON',
    '  --headingDeg <num>    Camera heading in degrees (clockwise, 0 = +X)',
    '  --cameraPx <x,y>      Camera point in plan/image coordinates',
    '',
    'Optional:',
    '  --image <path>        Layout image used for furniture detection',
    '  --templates <dir>     Template root folder for detector',
    '  --furniture <path>    Furniture JSON file (overrides image detection)',
    '  --cameraWorld <x,z>   Alternative camera point directly in meters',
    '  --pitchDeg <num>      Default -10',
    '  --fovDeg <num>        Default 60',
    '  --renderSize <w,h>    Default 1024,1024',
    '  --out <dir>           Default out',
    '  --threshold <num>     Template threshold default 0.8',
    '  --nmsIou <num>        NMS IoU default 0.3',
    '  --noDoorCutouts       Disable wall door subtraction',
  ].join('\n');
}

function buildCamera(
  args: ArgMap,
  mPerUnit: number,
  headingDeg: number,
  pitchDeg: number,
  fovDeg: number,
): CameraSpec {
  const cameraPx = asString(args, 'cameraPx');
  const cameraWorld = asString(args, 'cameraWorld');

  let x: number;
  let z: number;

  if (cameraWorld) {
    const point = parsePair(cameraWorld, '--cameraWorld');
    x = point.x;
    z = point.y;
  } else if (cameraPx) {
    const point = parsePair(cameraPx, '--cameraPx');
    x = point.x * mPerUnit;
    z = point.y * mPerUnit;
  } else {
    throw new Error('Either --cameraPx or --cameraWorld is required.');
  }

  const headingRad = (headingDeg * Math.PI) / 180;
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const cosPitch = Math.cos(pitchRad);
  const dirX = Math.cos(headingRad) * cosPitch;
  const dirY = Math.sin(pitchRad);
  const dirZ = Math.sin(headingRad) * cosPitch;

  return {
    position: { x, y: 1.8, z },
    lookAt: {
      x: x + dirX * 10,
      y: 1.8 + dirY * 10,
      z: z + dirZ * 10,
    },
    fovDeg,
  };
}

function loadJsonFile(filePath: string): unknown {
  const text = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(text);
}

function runDetection(
  pythonScript: string,
  imagePath: string,
  templatesDir: string,
  targetW: number,
  targetH: number,
  threshold: number,
  nmsIou: number,
  outJson: string,
  outDebug: string,
): Detection[] {
  const proc = spawnSync(
    'python3',
    [
      pythonScript,
      '--image',
      imagePath,
      '--templates',
      templatesDir,
      '--targetW',
      String(targetW),
      '--targetH',
      String(targetH),
      '--threshold',
      String(threshold),
      '--nmsIou',
      String(nmsIou),
      '--outJson',
      outJson,
      '--outDebug',
      outDebug,
    ],
    { encoding: 'utf-8' },
  );

  if (proc.status !== 0) {
    throw new Error(
      [
        'Python furniture detection failed.',
        proc.stdout?.trim() ?? '',
        proc.stderr?.trim() ?? '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  const raw = loadJsonFile(outJson);
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw as Detection[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || args.h) {
    console.log(usage());
    return;
  }

  const planPathArg = asString(args, 'plan');
  if (!planPathArg) {
    throw new Error(`Missing --plan\n\n${usage()}`);
  }

  const planPath = path.resolve(planPathArg);
  const outDir = path.resolve(asString(args, 'out') ?? 'out');
  const headingDeg = asNumber(args, 'headingDeg');
  const pitchDeg = asNumber(args, 'pitchDeg', -10);
  const fovDeg = asNumber(args, 'fovDeg', 60);
  const threshold = asNumber(args, 'threshold', 0.8);
  const nmsIou = asNumber(args, 'nmsIou', 0.3);
  const renderSize = parseRenderSize(asString(args, 'renderSize'));
  const enableDoorCutouts = !Boolean(args.noDoorCutouts);

  fs.mkdirSync(outDir, { recursive: true });

  const planRaw = loadJsonFile(planPath);
  const plan = parseResPlan(planRaw);
  const scale = inferMetersPerUnit(plan);
  for (const warning of scale.warnings) {
    console.warn(`[scale] ${warning}`);
  }

  const camera = buildCamera(args, scale.mPerUnit, headingDeg, pitchDeg, fovDeg);

  let furniture: FurnitureItem[] = [];
  const furniturePathArg = asString(args, 'furniture');
  if (furniturePathArg) {
    furniture = furnitureFromJson(loadJsonFile(path.resolve(furniturePathArg)), scale.mPerUnit);
  } else {
    furniture = furnitureFromJson(plan.furniture, scale.mPerUnit);
  }

  if (furniture.length === 0) {
    const imagePathArg = asString(args, 'image');
    const templatesArg = asString(args, 'templates');
    if (imagePathArg && templatesArg) {
      const imagePath = path.resolve(imagePathArg);
      const templatesPath = path.resolve(templatesArg);
      const pythonScript = path.resolve(process.cwd(), 'python', 'detect_furniture.py');

      const extent = inferPlanExtent(plan);
      const targetW = Math.max(256, extent.width);
      const targetH = Math.max(256, extent.height);
      const detectionsPath = path.join(outDir, 'detections.json');
      const detectionsDebugPath = path.join(outDir, 'detections.png');

      const detections = runDetection(
        pythonScript,
        imagePath,
        templatesPath,
        targetW,
        targetH,
        threshold,
        nmsIou,
        detectionsPath,
        detectionsDebugPath,
      );

      furniture = detectionsToFurniture(detections, scale.mPerUnit, toMultiPolygon(plan.inner));
      console.log(`[detect] kept ${furniture.length} furniture items after inner-boundary filter.`);
    } else {
      console.log('[detect] no furniture JSON found and image/templates were not both provided; furniture remains empty.');
    }
  }

  const scene = buildScene({
    plan,
    mPerUnit: scale.mPerUnit,
    furniture,
    camera,
    wallHeight: 3.0,
    floorThickness: 0.1,
    renderWidth: renderSize.width,
    renderHeight: renderSize.height,
    enableDoorCutouts,
  });

  const scenePath = path.join(outDir, 'scene.json');
  fs.writeFileSync(scenePath, JSON.stringify(scene, null, 2), 'utf-8');
  console.log(`[scene] wrote ${scenePath}`);

  const rendererHtmlPath = path.resolve(process.cwd(), 'dist', 'renderer.html');
  if (!fs.existsSync(rendererHtmlPath)) {
    throw new Error('Renderer bundle not found. Run npm run build first.');
  }

  const renderPath = path.join(outDir, 'render.png');
  await renderWithPlaywright(scene, rendererHtmlPath, renderPath);
  console.log(`[render] wrote ${renderPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[error] ${message}`);
  process.exit(1);
});
