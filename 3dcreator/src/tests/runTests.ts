import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { polygonArea } from '../plan/geojsonArea';
import { parseResPlan } from '../plan/parseResplan';
import { inferMetersPerUnit } from '../plan/scale';

function testPolygonArea(): void {
  const square = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] as [number, number][][];
  const area = polygonArea(square);
  assert.equal(area, 100);
}

function testScaleInference(): void {
  const planPath = path.resolve(process.cwd(), 'json examples', 'plan_346.json');
  assert.ok(fs.existsSync(planPath), `Missing fixture file: ${planPath}`);
  const plan = parseResPlan(JSON.parse(fs.readFileSync(planPath, 'utf-8')));
  const scale = inferMetersPerUnit(plan);
  const expected = 0.0505;
  const tolerance = expected * 0.02;
  assert.ok(Math.abs(scale.mPerUnit - expected) <= tolerance, `Expected ${expected} +/- ${tolerance}, got ${scale.mPerUnit}`);
}

function run(): void {
  testPolygonArea();
  testScaleInference();
  console.log('All tests passed.');
}

run();
