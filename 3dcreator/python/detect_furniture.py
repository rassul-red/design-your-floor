#!/usr/bin/env python3
import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

import cv2
import numpy as np


@dataclass
class Detection:
    type: str
    x: int
    y: int
    w: int
    h: int
    score: float
    rot_deg: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Template-match furniture icons in a layout image.')
    parser.add_argument('--image', required=True)
    parser.add_argument('--templates', required=True)
    parser.add_argument('--targetW', type=int, required=True)
    parser.add_argument('--targetH', type=int, required=True)
    parser.add_argument('--threshold', type=float, default=0.80)
    parser.add_argument('--nmsIou', type=float, default=0.30)
    parser.add_argument('--outJson', required=True)
    parser.add_argument('--outDebug', required=True)
    return parser.parse_args()


def parse_rotation(template_name: str) -> int:
    match = re.search(r'_(\d+)(?=\.[^.]+$)', template_name)
    if not match:
        return 0
    try:
        return int(match.group(1))
    except ValueError:
        return 0


def iou(a: Detection, b: Detection) -> float:
    x1 = max(a.x, b.x)
    y1 = max(a.y, b.y)
    x2 = min(a.x + a.w, b.x + b.w)
    y2 = min(a.y + a.h, b.y + b.h)

    inter_w = max(0, x2 - x1)
    inter_h = max(0, y2 - y1)
    inter = inter_w * inter_h

    area_a = a.w * a.h
    area_b = b.w * b.h
    union = area_a + area_b - inter
    if union <= 0:
        return 0.0
    return inter / union


def nms(dets: List[Detection], iou_threshold: float) -> List[Detection]:
    if not dets:
        return []
    dets_sorted = sorted(dets, key=lambda d: d.score, reverse=True)
    kept: List[Detection] = []
    while dets_sorted:
        best = dets_sorted.pop(0)
        kept.append(best)
        dets_sorted = [d for d in dets_sorted if iou(best, d) < iou_threshold]
    return kept


def gather_templates(templates_dir: Path) -> Dict[str, List[Tuple[Path, int]]]:
    grouped: Dict[str, List[Tuple[Path, int]]] = {}
    if not templates_dir.exists():
        return grouped

    for category_dir in sorted(templates_dir.iterdir()):
        if not category_dir.is_dir():
            continue
        category = category_dir.name
        for img_path in sorted(category_dir.glob('*.png')):
            grouped.setdefault(category, []).append((img_path, parse_rotation(img_path.name)))

    return grouped


def match_templates(
    gray_image: np.ndarray,
    templates: Dict[str, List[Tuple[Path, int]]],
    threshold: float,
    nms_iou: float,
) -> List[Detection]:
    by_category: Dict[str, List[Detection]] = {}

    for category, items in templates.items():
        for template_path, rot in items:
            template = cv2.imread(str(template_path), cv2.IMREAD_GRAYSCALE)
            if template is None:
                continue
            th, tw = template.shape[:2]
            if tw > gray_image.shape[1] or th > gray_image.shape[0]:
                continue

            result = cv2.matchTemplate(gray_image, template, cv2.TM_CCOEFF_NORMED)
            ys, xs = np.where(result >= threshold)
            for y, x in zip(ys.tolist(), xs.tolist()):
                score = float(result[y, x])
                by_category.setdefault(category, []).append(
                    Detection(type=category, x=x, y=y, w=tw, h=th, score=score, rot_deg=rot)
                )

    output: List[Detection] = []
    for category, detections in by_category.items():
        output.extend(nms(detections, nms_iou))
    return output


def draw_debug(image_bgr: np.ndarray, detections: List[Detection]) -> np.ndarray:
    debug = image_bgr.copy()
    for det in detections:
        cv2.rectangle(debug, (det.x, det.y), (det.x + det.w, det.y + det.h), (0, 180, 255), 2)
        label = f"{det.type} {det.score:.2f} r{det.rot_deg}"
        cv2.putText(debug, label, (det.x, max(12, det.y - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (20, 20, 20), 2)
        cv2.putText(debug, label, (det.x, max(12, det.y - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)
    return debug


def main() -> int:
    args = parse_args()

    img = cv2.imread(args.image, cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError(f'Could not load image: {args.image}')

    resized = cv2.resize(img, (args.targetW, args.targetH), interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)

    templates = gather_templates(Path(args.templates))
    detections = match_templates(gray, templates, args.threshold, args.nmsIou)

    out_json = Path(args.outJson)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    payload = [
        {
            'type': d.type,
            'bbox': {'x': d.x, 'y': d.y, 'w': d.w, 'h': d.h},
            'score': d.score,
            'rotDeg': d.rot_deg,
        }
        for d in detections
    ]
    out_json.write_text(json.dumps(payload, indent=2), encoding='utf-8')

    out_debug = Path(args.outDebug)
    out_debug.parent.mkdir(parents=True, exist_ok=True)
    debug = draw_debug(resized, detections)
    cv2.imwrite(str(out_debug), debug)

    print(f'detections: {len(detections)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
