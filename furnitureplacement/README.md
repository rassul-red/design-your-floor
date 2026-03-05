<div align="center">

# ⚡ furnitureplacement

### *AI furniture placement pipeline — 2–3× faster than the original*

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python)](https://www.python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-latest-009688?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com)
[![Gemini](https://img.shields.io/badge/Google%20Gemini-AI-4285F4?style=flat-square&logo=google)](https://deepmind.google/technologies/gemini/)
[![asyncio](https://img.shields.io/badge/asyncio-native-blue?style=flat-square)](https://docs.python.org/3/library/asyncio.html)

Drop-in replacement for `furniturep/server.py` — **same REST API**, dramatically faster. Upload a floor plan JSON, receive a fully furnished plan with real-world furniture coordinates.

</div>

---

## 🚀 What changed vs. `furniturep/`

| Original (`furniturep/`) | This version (`furnitureplacement/`) |
|---|---|
| 3 × `subprocess.run()` per job | All steps run **in-process** — no fork/exec |
| Libraries re-imported each subprocess | Modules loaded **once** at startup |
| Sequential: viz ALL → gen ALL → loc ALL | **Streaming pipeline**: each room flows immediately |
| `threading.Thread` per job | Native **asyncio** + `ThreadPoolExecutor` |
| New Gemini client per subprocess | **Single shared client** reused for all calls |
| Polls every 8 s | Polls every 5 s + elapsed time in response |

### Where the speed comes from

1. **No subprocess overhead** — Original spawns 3 Python processes per job. Each re-imports ~20 MB of libraries (matplotlib, shapely, geopandas, google-genai). That's 5–10 s of pure import cost, eliminated here.
2. **Streaming pipeline** — Each room's PNG flows directly into gen + locate as soon as it's ready, not after *all* rooms finish rendering.
3. **Shared Gemini client** — One `genai.Client()` created at module load and reused across every API call.
4. **Async-native** — `asyncio.create_task()` instead of threads; CPU-bound matplotlib work runs in a `ThreadPoolExecutor`.

---

## 🔄 Pipeline

```
plan_XXXX.json
      │
      ▼  visualize_rooms.py  (ThreadPoolExecutor)
 room PNG + metadata          ← per-room annotated PNG with wall lengths
      │  ← fires immediately for each room as it completes
      ▼  gen_config.py + Gemini image generation
 furnished room image          ← photorealistic 2D furnished room (2 models)
      │
      ▼  locate_furniture_prompt.txt + Gemini vision
 furniture coordinates         ← x_frac, y_frac, w_frac, h_frac per item
      │
      ▼  resplan_utils.py
 plan_XXXX_furnished.json      ← original plan + furniture with real-world metres
```

Each furniture item in the output carries:

```json
{
  "type": "sofa",
  "center_x_m": 2.45,
  "center_y_m": 1.80,
  "width_m": 2.2,
  "height_m": 0.9
}
```

---

## 🌐 REST API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | HTML upload form for browser testing |
| `POST` | `/process` | Upload plan JSON → returns `job_id` immediately |
| `GET` | `/status/{job_id}` | Poll job status — includes `elapsed` seconds |
| `GET` | `/result/{job_id}` | Download furnished JSON |
| `GET` | `/result/{job_id}/png` | Download furnished plan PNG |
| `POST` | `/render` | Upload furnished JSON → get PNG |

### Example workflow

```bash
# 1. Submit a job
curl -X POST http://localhost:8000/process \
  -F "file=@plan_7031.json" 
# → {"job_id": "abc123"}

# 2. Poll until done
curl http://localhost:8000/status/abc123
# → {"status": "running", "elapsed": 42.1}
# → {"status": "done",    "elapsed": 118.3}

# 3. Download result
curl -O http://localhost:8000/result/abc123
# → plan_7031_furnished.json

# 4. Download PNG
curl -O http://localhost:8000/result/abc123/png
# → furnished plan image
```

---

## 🚀 Quick Start

```bash
cd furnitureplacement
pip install -r requirements.txt
echo "GEMINI_API_KEY=your_key_here" > .env
python server.py
# → http://localhost:8000
```

---

## ⚙️ Configuration

Edit `gen_config.py` to control image generation:

```python
MODEL_A = "gemini-3-pro-image-preview"    # Model A label
MODEL_B = "gemini-3.1-flash-image-preview" # Model B label (faster)

ASPECT_RATIO  = "1:1"
IMAGE_SIZE    = "1K"
OUTPUT_FORMAT = "image/png"
TEMPERATURE   = 0.75
```

---

## 🗂️ Project Structure

```
furnitureplacement/
├── server.py                    # FastAPI server (async, identical API to furniturep)
├── pipeline.py                  # In-process async pipeline (viz → gen → locate)
├── gen_config.py                # Model & image generation settings
├── visualize_rooms.py           # Per-room PNG + JSON metadata generation
├── resplan_utils.py             # Plan plotting & geometry helpers
├── prompt_by_room.txt           # Prompt for Gemini image generation (metre-aware)
├── locate_furniture_prompt.txt  # Prompt for Gemini furniture coordinate extraction
├── requirements.txt             # Python dependencies
├── workspace/                   # Job working directories (auto-created)
│   └── {job_id}/
│       ├── plan_XXXX.json
│       ├── room_views/          # Per-room PNGs + metadata
│       ├── gen_output/          # Gemini-generated furnished images
│       └── furnished/           # Per-room + full furnished JSONs
└── README.md
```

---

## 📋 Gemini Prompting Details

### Image generation prompt (`prompt_by_room.txt`)

- Instructs Gemini to produce a **top-down 2D architectural layout** with furniture
- Provides real-world wall lengths from the annotated room PNG
- Enforces furniture must stay **strictly inside the colored room polygon**
- Enforces **minimum 0.9 m clearance** in front of every door
- Includes realistic furniture size reference table (bed, sofa, wardrobe, etc.)

### Furniture location prompt (`locate_furniture_prompt.txt`)

- Provides room dimensions, door/window counts as context
- Defines a **fractional coordinate frame** relative to the room polygon bounding box
- Requires explicit **wall-contact reasoning** before committing to numbers
- Enforces snap rules (e.g. *"touching left wall → x_frac − w_frac/2 = 0.0"*)
- Returns structured JSON: `type`, `x_frac`, `y_frac`, `w_frac`, `h_frac`

---

## 🔧 Tech Stack

| Library | Purpose |
|---|---|
| **FastAPI + Uvicorn** | Async REST API server |
| **google-genai** | Gemini image generation & vision |
| **Matplotlib + Agg** | Headless per-room PNG rendering |
| **Shapely + GeoPandas** | GeoJSON polygon geometry |
| **Pillow + OpenCV** | Image I/O and processing |
| **asyncio + ThreadPoolExecutor** | Non-blocking concurrent pipeline |
| **python-dotenv** | Environment variable management |
