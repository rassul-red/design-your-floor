# furniturep — AI Furniture Placement Pipeline

Automatically furnishes floor plan JSONs using Google Gemini. Given a ResPlan-style floor plan JSON, the pipeline renders per-room images, generates photorealistic furnished room views with Gemini, then uses Gemini vision to locate each piece of furniture and map it back to real-world coordinates.

---

## Pipeline Overview

```
plan_XXXX.json
      │
      ▼  visualize_rooms.py
 room_views/              ← per-room PNGs + JSON metadata
      │
      ▼  gen_run_rooms.py
 gen_output/              ← Gemini-generated furnished room images (2 models × N rooms)
      │
      ▼  locate_furniture.py
 furnished/               ← per-room furnished JSONs + full plan_XXXX_furnished.json
```

---

## Scripts

| File | Purpose |
|---|---|
| `visualize_rooms.py` | Renders each room from a plan JSON as a cropped PNG with wall lengths annotated |
| `gen_run_rooms.py` | Sends each room PNG to Gemini image generation; saves one image per model per room |
| `locate_furniture.py` | Calls Gemini vision on generated images to identify furniture; converts image fractions → plan coordinates → metres |
| `resplan_utils.py` | Shared utilities: full-plan rendering, furnished JSON helpers |
| `gen_config.py` | Central config for Gemini models, image size, temperature, output format |
| `server.py` | FastAPI server wrapping all three steps as a single async job (upload JSON → poll → download result) |

---

## Setup

**Requirements:** Python 3.11+

```bash
cd furniturep
python -m venv .venv
source .venv/bin/activate
pip install -r ../requirements.txt
```

Create a `.env` file (see `.env.example` if present):

```
GEMINI_API_KEY=your_key_here
```

---

## Usage

### Option A — Run steps manually

**Step 1.** Render per-room images from a plan JSON:
```bash
python visualize_rooms.py examples/plan_7031.json --out-dir room_views/
```

**Step 2.** Generate furnished room images with Gemini:
```bash
python gen_run_rooms.py room_views/ --out-dir gen_output/
```

**Step 3.** Locate furniture and produce the furnished plan JSON:
```bash
python locate_furniture.py 7031 \
    --rooms-dir  room_views/ \
    --images-dir gen_output/ \
    --out-dir    furnished/ \
    --model      gemini-2.5-pro
```

Output: `furnished/plan_7031_furnished.json` — the original plan with furniture items added, each with `center_x_m`, `center_y_m`, `width_m`, `height_m` fields.

---

### Option B — FastAPI server (single upload → async job)

```bash
python server.py
# Open http://localhost:8000
```

| Endpoint | Description |
|---|---|
| `POST /process` | Upload a plan JSON; returns `{ "job_id": "..." }` immediately |
| `GET /status/{job_id}` | Poll for `"queued"` / `"running"` / `"done"` / `"error"` |
| `GET /result/{job_id}` | Download the finished `plan_XXXX_furnished.json` |

The three pipeline steps run sequentially in a background thread. Typical runtime is **3–8 minutes** depending on Gemini API latency.

---

## Configuration (`gen_config.py`)

| Setting | Default | Description |
|---|---|---|
| `MODEL_A` | `gemini-3-pro-image-preview` | Primary image generation model |
| `MODEL_B` | `gemini-3.1-flash-image-preview` | Secondary image generation model |
| `ASPECT_RATIO` | `1:1` | Output image aspect ratio |
| `IMAGE_SIZE` | `1K` | Output resolution (`512px`, `1K`, `2K`, `4K`) |
| `TEMPERATURE` | `0.75` | Sampling temperature (0.0–2.0) |

Both models run in parallel for every room. Use `MODEL_A_LABEL` / `MODEL_B_LABEL` to identify outputs.

---

## Workspace Layout

Each pipeline run creates a job directory under `workspace/`:

```
workspace/
└── <job_id>/
    ├── plan_XXXX.json          ← input copy
    ├── room_views/             ← per-room PNGs + JSONs (Step 1 output)
    ├── gen_output/             ← generated images (Step 2 output)
    └── furnished/              ← furnished JSONs + PNGs (Step 3 output)
        ├── plan_XXXX_bedroom.json
        ├── plan_XXXX_living.json
        └── plan_XXXX_furnished.json   ← final merged output
```

> **Note:** `workspace/` contains run artifacts and should be `.gitignore`d.

---

## Output Format

Each furniture item in the furnished JSON:

```json
{
  "type": "sofa",
  "label": "3-seat sofa",
  "x_frac": 0.45,
  "y_frac": 0.60,
  "center_x_m": 2.81,
  "center_y_m": 3.74,
  "width_m": 2.10,
  "height_m": 0.90,
  "bbox_m": { "x": 1.76, "y": 3.29, "w": 2.10, "h": 0.90 }
}
```

Coordinates use the same origin as the input plan JSON. The `bbox_m` gives the axis-aligned bounding box in metres.
