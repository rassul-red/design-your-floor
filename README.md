<div align="center">

# 🏠 Floor Plan App

### *From blank canvas to fully furnished 3D model — powered by AI*

[![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite)](https://vitejs.dev)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python)](https://www.python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-latest-009688?style=flat-square&logo=fastapi)](https://fastapi.tiangolo.com)
[![Gemini](https://img.shields.io/badge/Google%20Gemini-AI-4285F4?style=flat-square&logo=google)](https://deepmind.google/technologies/gemini/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](./LICENSE)

---

**Draw a floor plan → Generate a 3D walkthrough → Auto-furnish every room → Find real products to buy**

[✏️ Floor Plan Editor](#-module-1--floor-plan-editor) · [🧊 3D Viewer](#-module-2--3d-creator--gemini-enhancer) · [🛋️ AI Furnishing](#-module-3--ai-furniture-placement) · [🛍️ Product Search](#-module-4--product-search)

</div>

---

## ✨ What is this?

Floor Plan App is an **end-to-end interior design pipeline** that turns a rough room sketch into a photorealistic, furnished space — with links to buy every piece of furniture shown.



https://github.com/user-attachments/assets/15f20ce7-7acb-449f-98fe-9361fa0615bb



```
   ✏️  Draw rooms          🧊  Walk through 3D        🛋️  AI furnishes rooms
  ┌─────────────┐         ┌──────────────────┐        ┌──────────────────────┐
  │  Browser    │──JSON──▶│  Three.js Viewer │──PNG──▶│  Gemini Vision API   │
  │  Floor Plan │         │  (first-person)  │        │  places furniture    │
  │  Editor     │         └──────────────────┘        └──────┬───────────────┘
  └─────────────┘                                            │ furnished JSON
                                                             ▼
                                                   🛍️  Product Search
                                                   (Google Shopping links)
```

---

## 🗂️ Project Structure

```
floor-plan-app/
├── 📐 frontend_constructor/     # React + TypeScript floor plan editor
├── 🧊 3dcreator_bygem/          # Three.js 3D viewer + Gemini screenshot enhancer
├── 🛋️ furniturep/               # AI furniture placement pipeline (original)
├── ⚡ furnitureplacement/        # AI furniture placement pipeline (2–3× faster)
├── 🛍️ product_search/           # Gemini-powered product search from room images
└── 📋 requirements.txt          # Shared Python dependencies
```

---

## 🧩 Modules

### ✏️ Module 1 — Floor Plan Editor

> `frontend_constructor/` · React 19 · TypeScript · Vite · Zustand · Canvas API

A **browser-based vector drawing tool** for creating floor plans from scratch. Click to place polygon vertices, add doors and windows, then export a ResPlan-compatible JSON ready for the rest of the pipeline.

#### Key Features

| Feature | Details |
|---|---|
| 🖊️ **Polygon rooms** | Click to place vertices; click near the start to close |
| 🚪 **Doors & Windows** | Drag along any wall edge to place openings (front door, door, window) |
| 🧱 **Auto wall geometry** | Walls generated automatically from room polygons with openings cut out |
| 🖱️ **Select & Move** | Click to select, drag to reposition, `Delete` to remove |
| ↩️ **Undo / Redo** | Full history with `Ctrl+Z` / `Ctrl+Shift+Z` |
| 🔍 **Pan & Zoom** | Middle-mouse drag or `Space+drag` to pan; scroll wheel to zoom |
| 📤 **Export JSON** | ResPlan-format with GeoJSON geometry and computed areas (m²) |
| 🖼️ **Export PNG** | Clean 512×512 plan image (no grid) |
| 📥 **Import JSON** | Reload any previously saved plan |

#### Room Categories

`Living` · `Bedroom` · `Bathroom` · `Kitchen` · `Balcony` · `Storage`

#### Quick Start

```bash
cd frontend_constructor
npm install
npm run dev
# → http://localhost:5173
```

---

### 🧊 Module 2 — 3D Creator & Gemini Enhancer

> `3dcreator_bygem/` · Node.js · Express · Three.js · Puppeteer · Google Gemini

Takes the JSON exported from the Floor Plan Editor and renders it as an **interactive first-person 3D environment** in the browser. Supports screenshotting any view and sending it to Gemini for photorealistic AI enhancement.

#### Key Features

| Feature | Details |
|---|---|
| 🏗️ **3D blockout** | Walls, floors, and openings extruded from plan JSON |
| 🎮 **First-person fly camera** | `WASD` to move, `Q/E` up/down, right-click drag to look |
| 📸 **Screenshot + Enhance** | Capture any view → send to Gemini with a custom prompt |
| ✨ **Gemini style prompts** | Saved to localStorage — set once, reuse every time |
| 🚪 **Solid doors toggle** | Render door openings as solid geometry |
| 🎬 **Standard render export** | One-click high-quality render export |

#### Controls

```
W / A / S / D   →  Move forward / left / backward / right
Q / E           →  Move up / down
Right-Click+Drag→  Look around
Scroll Wheel    →  Adjust fly speed
```

#### Quick Start

```bash
cd 3dcreator_bygem
npm install
cp .env.example .env   # add your GEMINI_API_KEY
npm run start
# → http://localhost:8000
```

---

### 🛋️ Module 3 — AI Furniture Placement

> `furniturep/` (original) · `furnitureplacement/` (optimized) · Python 3.11+ · FastAPI · Google Gemini

The most powerful part of the pipeline. Given a floor plan JSON, the system **automatically places furniture** in every room using a multi-step Gemini AI workflow.

#### Pipeline

```
plan_XXXX.json
      │
      ▼  Step 1: visualize_rooms.py
 room_views/              ← per-room PNGs annotated with wall lengths
      │
      ▼  Step 2: gen_run_rooms.py
 gen_output/              ← Gemini-generated photorealistic furnished room images
      │
      ▼  Step 3: locate_furniture.py
 furnished/               ← furniture items with real-world coordinates (metres)
      │
      ▼  Final output
 plan_XXXX_furnished.json ← original plan + furniture: center_x_m, center_y_m, width_m, height_m
```

#### API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/process` | Upload plan JSON → returns `job_id` immediately |
| `GET` | `/status/{job_id}` | Poll until `"done"` or `"error"` (includes elapsed time) |
| `GET` | `/result/{job_id}` | Download furnished JSON |
| `GET` | `/result/{job_id}/png` | Download furnished plan PNG |
| `POST` | `/render` | Upload furnished JSON → get PNG |

#### `furnitureplacement/` — Optimized Version (2–3× faster)

| Original `furniturep/` | Optimized `furnitureplacement/` |
|---|---|
| 3 subprocesses per job | All steps run **in-process** |
| Libraries reimported each run | Modules loaded **once** at startup |
| Sequential: viz ALL → gen ALL | **Streaming**: each room flows immediately |
| `threading.Thread` per job | Native **asyncio** + `ThreadPoolExecutor` |
| New Gemini client per subprocess | **Single shared client** for all calls |

#### Quick Start

```bash
cd furnitureplacement          # or furniturep for the original
pip install -r requirements.txt
echo "GEMINI_API_KEY=your_key_here" > .env
python server.py
# → http://localhost:8000
```

---

### 🛍️ Module 4 — Product Search

> `product_search/` · Python · Google Gemini 2.0 Flash · Google Search Grounding

Takes a furnished room image and uses Gemini to **detect every piece of furniture and decor**, then generates direct Google Shopping search links for each item.

#### How it works

1. Pass any room image to `find_products_in_room(image_path)`
2. Gemini identifies all furniture items with bounding boxes
3. Returns item names, bounding coordinates, search queries, and **direct Google Shopping links**

```bash
cd product_search
GEMINI_API_KEY=your_key python search.py
```

---

## 🔧 Full Setup

### Prerequisites

| Tool | Version |
|---|---|
| Node.js | 18+ |
| Python | 3.11+ |
| Google Gemini API Key | [Get one free](https://aistudio.google.com/app/apikey) |

### 1. Clone the repo

```bash
git clone https://github.com/dbekzhan/floor-plan-app.git
cd floor-plan-app
```

### 2. Install Python dependencies (shared)

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Install Node.js dependencies

```bash
cd frontend_constructor && npm install && cd ..
cd 3dcreator_bygem && npm install && cd ..
```

### 4. Set up API keys

Each Node/Python service reads from its own `.env` file:

```bash
echo "GEMINI_API_KEY=your_key_here" > 3dcreator_bygem/.env
echo "GEMINI_API_KEY=your_key_here" > furnitureplacement/.env
echo "GEMINI_API_KEY=your_key_here" > furniturep/.env
```

### 5. Run the full pipeline

```bash
# Terminal 1 — Floor Plan Editor
cd frontend_constructor && npm run dev

# Terminal 2 — 3D Viewer
cd 3dcreator_bygem && npm run start

# Terminal 3 — Furniture Placement API
cd furnitureplacement && python server.py
```

---

## 🔄 End-to-End Workflow

```
1. Open http://localhost:5173
   └─ Draw your floor plan (rooms, doors, windows)
   └─ Export as plan.json

2. Open http://localhost:8000 (3D Viewer)
   └─ Upload plan.json
   └─ Walk through in first-person
   └─ Screenshot views and prompt Gemini to style them

3. POST plan.json → http://localhost:8000/process (Furniture API)
   └─ Poll /status/{job_id} until done
   └─ Download plan_furnished.json

4. Run product_search/search.py on any furnished room image
   └─ Get shopping links for every visible furniture item
```

---

## 📦 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript 5.9, Vite 7, Zustand, Canvas API |
| **3D Rendering** | Three.js r128, OrbitControls |
| **Backend** | Node.js, Express 5, FastAPI, Uvicorn |
| **AI / Vision** | Google Gemini 2.0 Flash, Gemini 2.5 Pro |
| **Image Processing** | Pillow, OpenCV, Matplotlib, Shapely, GeoPandas |
| **Async** | Python asyncio, ThreadPoolExecutor, Puppeteer |
| **Data Format** | ResPlan JSON (GeoJSON geometry) |

---

## 📄 License

[MIT](./LICENSE) — free to use, modify, and distribute.

---

<div align="center">

Made with ☕ and a lot of Gemini API credits

</div>
