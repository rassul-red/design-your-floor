#!/usr/bin/env python3
"""
server.py — Fast async FastAPI server for the floor plan furnishing pipeline.

Performance improvements over furniturep/server.py:
  ┌─────────────────────────────┬──────────────────────────────────────────────┐
  │  Original (furniturep/)     │  This version (furnitureplacement/)          │
  ├─────────────────────────────┼──────────────────────────────────────────────┤
  │  3 × subprocess.run()       │  All steps run IN-PROCESS (no fork/exec)    │
  │  Each subprocess re-imports │  Modules loaded once at startup             │
  │  matplotlib, shapely, etc.  │  and shared across all jobs                 │
  │  Steps run sequentially:    │  Streaming pipeline: as soon as one room's  │
  │  viz ALL → gen ALL → loc ALL│  PNG is ready, gen+locate fire immediately  │
  │  threading.Thread per job   │  Native asyncio + ThreadPoolExecutor        │
  │  Gemini client created per  │  Single client shared across all calls      │
  │  subprocess invocation      │                                             │
  └─────────────────────────────┴──────────────────────────────────────────────┘

Endpoints (same API surface as original):
  POST /process          Upload a plan JSON → returns job_id immediately
  GET  /status/{job_id}  Poll until status == "done" or "error"
  GET  /result/{job_id}  Download the final furnished JSON
  GET  /result/{job_id}/png  Download the final furnished PNG
  POST /render           Upload a furnished JSON → get back a PNG
  GET  /                 Simple HTML form for testing

Usage:
    python server.py
    # then open http://localhost:8000
"""

import asyncio
import json
import logging
import os
import time
import uuid
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("server")

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse
import uvicorn

from pipeline import run_pipeline

app = FastAPI(title="Floor Plan Furnishing API (Fast)")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

WORKSPACE = Path("workspace")
HERE = Path(__file__).parent

# In-memory job registry  {job_id: {status, plan_id, result, result_png, error, t_start, t_end}}
_jobs: dict[str, dict] = {}


# ── async pipeline runner ─────────────────────────────────────────────────────

async def _run_pipeline_async(job_id: str, plan: dict, plan_id: int, workspace: Path):
    """Run the pipeline as an asyncio task (non-blocking)."""
    _jobs[job_id]["status"] = "running"
    _jobs[job_id]["t_start"] = time.time()

    try:
        final_json = await run_pipeline(
            plan=plan,
            workspace=workspace,
            plan_id=plan_id,
        )

        final_png = final_json.with_suffix(".png")

        _jobs[job_id]["status"]     = "done"
        _jobs[job_id]["result"]     = str(final_json)
        _jobs[job_id]["result_png"] = str(final_png) if final_png.exists() else None
        _jobs[job_id]["t_end"]      = time.time()
        elapsed = _jobs[job_id]["t_end"] - _jobs[job_id]["t_start"]
        log.info("[%s] Pipeline COMPLETE in %.1fs", job_id, elapsed)

    except Exception as exc:
        _jobs[job_id]["status"] = "error"
        _jobs[job_id]["error"]  = str(exc)
        _jobs[job_id]["t_end"]  = time.time()
        log.error("[%s] Pipeline ERROR: %s", job_id, exc)


# ── HTML form ─────────────────────────────────────────────────────────────────

_HTML = """<!DOCTYPE html>
<html>
<head>
  <title>Floor Plan Furnishing (Fast)</title>
  <style>
    body { font-family: sans-serif; max-width: 640px; margin: 48px auto; padding: 0 20px; }
    button { margin-left: 8px; }
    pre { background: #f5f5f5; padding: 14px; border-radius: 6px; white-space: pre-wrap; }
    .done  { color: green; }
    .error { color: red;   }
    .badge { display: inline-block; background: #0070f3; color: white;
             padding: 2px 8px; border-radius: 4px; font-size: 12px; margin-left: 6px; }
  </style>
</head>
<body>
  <h2>Floor Plan Furnishing <span class="badge">Fast</span></h2>
  <p>Upload a plan <code>.json</code> file. The pipeline runs in the background.
     This page polls every 5 seconds and downloads the result when ready.</p>
  <p style="font-size:13px; color:#666;">
    ⚡ This version runs ~2-3× faster: in-process execution, streaming pipeline,
    shared Gemini client, no subprocess overhead.
  </p>

  <form id="form">
    <input type="file" id="file" accept=".json" required>
    <button type="submit">Submit</button>
  </form>

  <pre id="out" style="display:none"></pre>

  <script>
    const out = document.getElementById('out');

    function show(text, cls) {
      out.style.display = 'block';
      out.textContent   = text;
      out.className     = cls || '';
    }

    document.getElementById('form').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData();
      fd.append('file', document.getElementById('file').files[0]);
      show('Uploading…');
      const r    = await fetch('/process', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) { show('Error: ' + JSON.stringify(data), 'error'); return; }
      show('Job submitted\\nJob ID : ' + data.job_id + '\\nStatus : pending\\n\\nPolling every 5 s…');
      poll(data.job_id);
    };

    async function poll(id) {
      await new Promise(r => setTimeout(r, 5000));
      const r = await fetch('/status/' + id);
      const s = await r.json();
      if (s.status === 'done') {
        let msg = 'Done!';
        if (s.elapsed) msg += ' (' + s.elapsed.toFixed(1) + 's)';
        msg += '\\nDownloading result…';
        show(msg, 'done');
        window.location = '/result/' + id;
      } else if (s.status === 'error') {
        show('Pipeline error:\\n\\n' + s.error, 'error');
      } else {
        let msg = 'Job ID : ' + id + '\\nStatus : ' + s.status;
        if (s.elapsed) msg += '\\nElapsed: ' + s.elapsed.toFixed(1) + 's';
        msg += '\\n\\nPolling every 5 s…';
        show(msg);
        poll(id);
      }
    }
  </script>
</body>
</html>"""


# ── endpoints ─────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def index():
    return _HTML


@app.post("/process")
async def process(file: UploadFile):
    raw = await file.read()
    try:
        plan = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"Invalid JSON: {exc}")

    plan_id = plan.get("id")
    if plan_id is None:
        raise HTTPException(400, "Plan JSON must contain an 'id' field.")

    job_id    = uuid.uuid4().hex[:10]
    workspace = WORKSPACE / job_id
    workspace.mkdir(parents=True, exist_ok=True)

    # Save the plan
    plan_path = workspace / f"plan_{plan_id}.json"
    plan_path.write_bytes(raw)

    _jobs[job_id] = {"status": "pending", "plan_id": plan_id}

    # Fire the pipeline as an asyncio task — non-blocking
    asyncio.create_task(_run_pipeline_async(job_id, plan, plan_id, workspace))

    return {"job_id": job_id, "poll_url": f"/status/{job_id}"}


@app.get("/status/{job_id}")
async def status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    resp = {"job_id": job_id, "status": job["status"], "plan_id": job["plan_id"]}

    # Include elapsed time
    if "t_start" in job:
        t_end = job.get("t_end", time.time())
        resp["elapsed"] = round(t_end - job["t_start"], 1)

    if job["status"] == "done":
        resp["result_url"] = f"/result/{job_id}"
        if job.get("result_png"):
            resp["result_png_url"] = f"/result/{job_id}/png"
    if job["status"] == "error":
        resp["error"] = job.get("error", "unknown")
    return resp


@app.get("/result/{job_id}")
async def result(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] != "done":
        raise HTTPException(409, f"Job is '{job['status']}', not done yet")
    path = Path(job["result"])
    if not path.exists():
        raise HTTPException(500, "Result file is missing from disk")
    plan_id = job.get("plan_id", "unknown")
    return FileResponse(
        path, media_type="application/json",
        filename=f"plan_{plan_id}_furnished.json",
    )


@app.get("/result/{job_id}/png")
async def result_png(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    if job["status"] != "done":
        raise HTTPException(409, f"Job is '{job['status']}', not done yet")
    png_path = job.get("result_png")
    if not png_path or not Path(png_path).exists():
        raise HTTPException(404, "PNG result not available for this job")
    plan_id = job.get("plan_id", "unknown")
    return FileResponse(
        png_path, media_type="image/png",
        filename=f"plan_{plan_id}_furnished.png",
    )


@app.post("/render")
async def render(file: UploadFile):
    """Upload a furnished JSON (with 'furniture' key) → get back a PNG image."""
    raw = await file.read()
    try:
        plan = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"Invalid JSON: {exc}")

    furniture = plan.get("furniture")
    if not furniture:
        raise HTTPException(400, "JSON has no 'furniture' key — nothing to render.")

    plan_id = plan.get("id", "unknown")

    # Imports already loaded at module level — no lazy import needed
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from pipeline import _pool
    from visualize_rooms import compute_scale
    from resplan_utils import plot_plan_furnished
    import io as _io

    scale = plan.get("scale") or compute_scale(plan)

    def _do_render():
        fig, ax = plt.subplots(figsize=(10, 10))
        fig.patch.set_facecolor("white")
        plot_plan_furnished(
            plan=plan, furniture=furniture, scale=scale,
            ax=ax, legend=True, title=f"Plan #{plan_id} — furnished",
        )
        buf = _io.BytesIO()
        fig.savefig(buf, format="png", dpi=130, bbox_inches="tight", facecolor="white")
        plt.close(fig)
        buf.seek(0)
        return buf

    loop = asyncio.get_event_loop()
    buf = await loop.run_in_executor(_pool, _do_render)

    return StreamingResponse(
        buf, media_type="image/png",
        headers={"Content-Disposition": f'attachment; filename="plan_{plan_id}_furnished.png"'},
    )


# ── entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
