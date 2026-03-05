<div align="center">

# 🧊 3D Floor Plan Creator & Gemini Enhancer

### *Walk through your floor plan in 3D — then let Gemini redecorate it*

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-5-000000?style=flat-square&logo=express)](https://expressjs.com)
[![Three.js](https://img.shields.io/badge/Three.js-r128-black?style=flat-square&logo=three.js)](https://threejs.org)
[![Puppeteer](https://img.shields.io/badge/Puppeteer-24-40B5A4?style=flat-square&logo=puppeteer)](https://pptr.dev)
[![Gemini](https://img.shields.io/badge/Google%20Gemini-AI-4285F4?style=flat-square&logo=google)](https://deepmind.google/technologies/gemini/)

Upload a **ResPlan JSON** floor plan → explore it in first-person 3D → screenshot any view → send to Gemini with a style prompt to get a photorealistic render.

</div>

---

## ✨ Features

| Feature | Details |
|---|---|
| 🏗️ **3D blockout** | Walls (3 m tall), floors, openings extruded from plan JSON via Three.js |
| 🎮 **First-person fly camera** | `WASD` to move, `Q/E` up/down, click + drag to look |
| 📸 **Screenshot & Gemini Enhance** | Capture any view → modal with prompts → AI-generated image |
| 🖼️ **Reference images** | Attach reference images to guide Gemini's style (shown as thumbnails) |
| 🔁 **Iterate** | Use the generated image as the new base and prompt again |
| 💾 **Persistent prompts** | System prompt and furniture prompt saved to `localStorage` |
| 🛋️ **Search Furniture** | After generation, sends the image to Gemini to identify furniture items with Google Shopping links |
| 🚪 **Solid doors toggle** | Render door openings as solid geometry |
| 🎬 **Headless CLI render** | `node render.js` — scriptable camera-positioned PNG export via Puppeteer |

---

## 🚀 Getting Started

### 1. Install dependencies

```bash
cd 3dcreator_bygem
npm install
```

### 2. Configure your API key

```bash
cp .env.example .env
```

Edit `.env`:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### 3. Start the server

```bash
npm run start
# → http://localhost:8005
```

Open **http://localhost:8005** in your browser.

---

## 🖱️ Usage

### Loading a floor plan

1. Under **"2. JSON Data"** in the sidebar, click the file input and upload a `.json` file.
   - Use the plans in `json examples/` to get started, or export one from `frontend_constructor`.
2. The 3D model builds automatically — walls, floors, and door/window openings appear.

### Navigating the scene

| Control | Action |
|---|---|
| `W / A / S / D` | Move forward / left / backward / right |
| `Q / E` | Move up / down |
| `Click + Drag` | Look around (yaw + pitch) |
| Speed slider | Adjust fly speed (0.05 – 1.5) |
| **Render Solid Doors** checkbox | Toggle door geometry on/off |

### Camera presets (sidebar)

Set an exact camera position without navigating manually:

| Field | Description |
|---|---|
| Height (m) | Camera height above the floor (default `1.8 m`) |
| X / Y pos | Camera X and Y position in plan pixel coordinates |
| Look Angle (deg) | Horizontal look direction in degrees |

Click **Set Camera View** to apply, or **Reset Orbit** to return to the default overhead view.

### Screenshot & Gemini Enhance

1. Click the blue **"Screenshot Current View"** button.
2. A modal opens showing a preview of the captured frame.
3. In the modal:

   | Control | Description |
   |---|---|
   | ⚙️ Settings panel | Set the **System Prompt** (e.g. *"You are an expert interior designer"*). Saved to `localStorage`. |
   | Furniture prompt checkbox | Optionally append a furniture-specific instruction to the system prompt. Also saved to `localStorage`. |
   | User Prompt field | Describe what you want (e.g. *"Make this a cozy wooden cabin"*). |
   | Reference images | Upload one or more reference images — thumbnails shown, each removable. Gemini will incorporate their visual style into the output. |
   | **✨ Gemini Enhance** | Sends everything to `POST /api/enhance` and displays the AI-generated image. |
   | ⬇️ Download | Downloads the generated image as a PNG. |
   | 🔁 Iterate | Replaces the screenshot preview with the generated image so you can refine further. |
   | 🔍 Search Furniture | Sends the generated image to `POST /api/search-furniture` → returns item names, descriptions, and direct Google Shopping links. |

---

## ⚡ Headless CLI Render

Render a specific camera view to a PNG file without opening a browser:

```bash
node render.js <json_file> <output.png> <height_m> <x_px> <y_px> <angle_deg>

# Example:
node render.js "json examples/plan_346.json" output.png 1.8 128 128 45
```

Uses **Puppeteer** to spin up a headless Chromium instance, loads the Three.js scene, sets the camera to the specified position, and saves the canvas as PNG. Fully scriptable for batch rendering.

---

## 🌐 API Endpoints

Both endpoints are served by the Express server at **http://localhost:8005**.

---

### `POST /api/enhance`

Sends a screenshot + prompts to **Gemini** (`gemini-3-pro-image-preview`) and returns a generated image.

**Request body:**

```json
{
  "systemPrompt": "You are an expert interior designer...",
  "userPrompt": "Make this a cozy wooden cabin",
  "image": "data:image/png;base64,<main_scene_base64>",
  "referenceImages": [
    "data:image/jpeg;base64,<ref1_base64>"
  ]
}
```

> `referenceImages` is optional. Each item must be a base64 data URL.

**Success response:**

```json
{ "result": "data:image/png;base64,<generated_image>", "isImage": true, "text": "" }
```

> When Gemini returns text instead of an image, `isImage` is `false` and `result` holds the text.

**Error responses:**

| Status | Reason |
|---|---|
| `401` | `GEMINI_API_KEY` is not set or is the placeholder value in `.env` |
| `400` | `image` field is missing or not a valid base64 data URL |
| `500` | Gemini API error — message returned in `error` field |

---

### `POST /api/search-furniture`

Takes a furnished room image (typically the output of `/api/enhance`) and uses **Gemini** (`gemini-3-flash-preview`) in JSON mode to identify the 3 most prominent furniture items, then builds direct Google Shopping links.

**Request body:**

```json
{ "image": "data:image/png;base64,<room_image_base64>" }
```

**Success response:**

```json
{
  "results": [
    {
      "name": "Sofa",
      "description": "3-seat, light grey fabric, mid-century modern legs",
      "shoppingUrl": "https://www.google.com/search?tbm=shop&q=..."
    }
  ]
}
```

---

## 🗂️ Project Structure

```
3dcreator_bygem/
├── server.js                    # Express server (port 8005) — /api/enhance + /api/search-furniture
├── render.js                    # Headless Puppeteer CLI renderer
├── list_models.js               # Utility: list available Gemini models
├── public/
│   ├── index.html               # App UI — Three.js canvas + sidebar + Gemini modal
│   └── app.js                   # 3D scene, fly camera, screenshot, modal, Gemini calls
├── json examples/
│   ├── plan_346.json            # Small apartment
│   ├── plan_4165.json           # Mid-size apartment
│   └── plan_7742.json           # Large apartment
├── furnished_ex/
│   ├── plan_7031.json           # Unfurnished plan example
│   └── plan_7031_furnished.json # AI-furnished plan example
├── package.json
└── .env.example                 # Copy to .env and add GEMINI_API_KEY
```

---

## 🔧 Tech Stack

| Library | Purpose |
|---|---|
| **Node.js + Express 5** | HTTP server, static files, API routes |
| **Three.js r128** | WebGL 3D scene rendering |
| **@google/genai** | Google Gemini SDK for image generation & furniture search |
| **Puppeteer 24** | Headless Chromium for CLI renders |
| **dotenv** | `.env` environment variable loading |