import os, pickle, json
import numpy as np
import matplotlib.pyplot as plt
from shapely.geometry import mapping

from resplan_utils import normalize_keys, plot_plan

DATA_PATH = 'ResPlan.pkl'
OUTPUT_DIR = 'examples'
TARGET_AREAS = [30, 50, 80]  # find the N closest plans to each target area (m²)
N_PER_TARGET = 5

with open(DATA_PATH, 'rb') as f:
    plans = pickle.load(f)

print(f'Loaded {len(plans)} plans')

for p in plans:
    normalize_keys(p)

GEOM_FIELDS = [
    'living', 'bedroom', 'bathroom', 'kitchen',
    'door', 'window', 'wall', 'front_door',
    'balcony', 'inner', 'garden', 'parking',
    'pool', 'stair', 'veranda', 'land', 'storage',
]
META_FIELDS = ['id', 'unitType', 'area', 'net_area', 'wall_depth']


def plan_to_dict(plan: dict) -> dict:
    out = {}
    for key in META_FIELDS:
        val = plan.get(key)
        if val is None:
            out[key] = None
        elif isinstance(val, (np.floating, np.integer)):
            out[key] = val.item()
        else:
            out[key] = val
    for key in GEOM_FIELDS:
        geom = plan.get(key)
        if geom is None or geom.is_empty:
            out[key] = None
        else:
            out[key] = mapping(geom)
    neighbor = plan.get('neighbor')
    if neighbor is None:
        out['neighbor'] = None
    else:
        out['neighbor'] = [
            (None if g is None or g.is_empty else mapping(g))
            for g in neighbor
        ]
    return out


os.makedirs(OUTPUT_DIR, exist_ok=True)

selected = []
for target in TARGET_AREAS:
    closest = sorted(plans, key=lambda p: abs(p.get('area', 0) - target))[:N_PER_TARGET]
    selected.extend(closest)

for plan in selected:
    data = plan_to_dict(plan)
    plan_id = data.get('id')
    area = data.get('area', 0)
    unit_type = data.get('unitType', '')

    # JSON
    json_path = os.path.join(OUTPUT_DIR, f'plan_{plan_id}.json')
    with open(json_path, 'w') as f:
        json.dump(data, f, indent=2)

    # Image
    fig, ax = plt.subplots(figsize=(8, 8))
    plot_plan(plan, ax=ax, title=f'Plan #{plan_id}  |  {unit_type}  |  {area:.1f} m²', tight=False)
    img_path = os.path.join(OUTPUT_DIR, f'plan_{plan_id}.png')
    fig.savefig(img_path, dpi=150, bbox_inches='tight')
    plt.close(fig)

    print(f'Saved {json_path} + {img_path}  (area={area:.1f} m²)')

print(f'\nDone — {len(selected)} plans written to ./{OUTPUT_DIR}/')
