# furnitureplacement — Fast Floor Plan Furnishing Server

> Drop-in replacement for `furniturep/server.py` — same API, **~2–3× faster**.

## What changed

| Original (`furniturep/`)              | This version (`furnitureplacement/`)                |
|---------------------------------------|-----------------------------------------------------|
| 3 × `subprocess.run()` per job        | All steps run **in-process** (no fork/exec)         |
| Each subprocess re-imports matplotlib, shapely, genai | Modules loaded **once** at startup |
| Pipeline: viz ALL → gen ALL → loc ALL | **Streaming pipeline**: room PNG ready → gen+locate fires immediately |
| `threading.Thread` per job            | Native **asyncio** + `ThreadPoolExecutor`           |
| Gemini client created per subprocess  | **Single shared client** across all calls           |
| Polls every 8 s                       | Polls every 5 s (status includes elapsed time)      |

### Where the time savings come from

1. **No subprocess overhead** — The original spawns 3 Python processes per job. Each one loads ~20 MB of libraries (matplotlib, shapely, geopandas, google-genai). That's ~5–10 s wasted on imports alone, eliminated here.

2. **Streaming pipeline** — Instead of waiting for *all* room PNGs before starting image generation, each room flows through viz → gen → locate as soon as its PNG is ready. All rooms run concurrently.

3. **Shared Gemini client** — One `genai.Client()` is created at module load and reused for every API call, avoiding repeated authentication overhead.

4. **Async-native** — Uses `asyncio.create_task()` instead of `threading.Thread`, so jobs integrate cleanly with FastAPI's event loop. CPU-bound work (matplotlib rendering) runs in a shared `ThreadPoolExecutor`.

## API (identical to original)

| Endpoint               | Method | Description                          |
|------------------------|--------|--------------------------------------|
| `/`                    | GET    | HTML upload form                     |
| `/process`             | POST   | Upload plan JSON → returns `job_id`  |
| `/status/{job_id}`     | GET    | Poll status (now includes `elapsed`) |
| `/result/{job_id}`     | GET    | Download furnished JSON              |
| `/result/{job_id}/png` | GET    | Download furnished PNG               |
| `/render`              | POST   | Upload furnished JSON → get PNG      |

## Quick start

```bash
cd furnitureplacement
pip install -r requirements.txt
# Make sure .env has GEMINI_API_KEY
python server.py
# → http://localhost:8000
```

## File structure

```
furnitureplacement/
├── server.py                    # FastAPI server (async, same API as original)
├── pipeline.py                  # In-process async pipeline (viz → gen → locate)
├── gen_config.py                # Model / image generation settings
├── visualize_rooms.py           # Per-room PNG + JSON generation
├── resplan_utils.py             # Plan plotting & geometry helpers
├── prompt_by_room.txt           # Prompt for Gemini image generation
├── locate_furniture_prompt.txt  # Prompt for Gemini furniture location
├── requirements.txt             # Python dependencies
└── README.md                    # This file
```

This folder is fully self-contained — no imports from other directories.

## Environment

Requires a `.env` file in this directory:

```
GEMINI_API_KEY=your_key_here
```
