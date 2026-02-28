#!/usr/bin/env python3
"""
server.py — FastAPI server wrapping the floor plan furnishing pipeline.

Endpoints:
  POST /process          Upload a plan JSON → returns job_id immediately
  GET  /status/{job_id}  Poll until status == "done" or "error"
  GET  /result/{job_id}  Download the final furnished JSON
  GET  /                 Simple HTML form (open in browser for testing)

The pipeline takes several minutes (Gemini API calls), so the server
returns a job_id straight away and you poll /status until it's done.

Usage:
    .venv/bin/python server.py
    # then open http://localhost:8000
"""

import json
import os
import subprocess
import sys
import threading
import uuid
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
import uvicorn

app = FastAPI(title="Floor Plan Furnishing API")

WORKSPACE = Path("workspace")   # all job files live here
HERE      = Path(__file__).parent

# in-memory job registry  {job_id: {status, plan_id, result, error}}
_jobs: dict[str, dict] = {}


# ── pipeline runner (background thread per job) ───────────────────────────────

def _run_pipeline(job_id: str, plan_path: Path, plan_id, workspace: Path):
    _jobs[job_id]["status"] = "running"

    py           = sys.executable
    rooms_dir    = workspace / "room_views"
    gen_dir      = workspace / "gen_output"
    furnished_dir = workspace / "furnished"

    steps = [
        # 1. per-room PNGs + JSONs
        [py, "visualize_rooms.py", str(plan_path), "--out-dir", str(rooms_dir)],
        # 2. Gemini image generation (reads rooms_dir, writes gen_dir)
        [py, "gen_run_rooms.py", str(rooms_dir) + "/", "--out-dir", str(gen_dir)],
        # 3. furniture localisation → per-room + full plan
        [py, "locate_furniture.py", str(plan_id),
         "--rooms-dir",  str(rooms_dir),
         "--images-dir", str(gen_dir),
         "--out-dir",    str(furnished_dir),
         "--plans-dir",  str(workspace)],
    ]

    try:
        for cmd in steps:
            proc = subprocess.run(
                cmd, capture_output=True, text=True, cwd=str(HERE)
            )
            if proc.returncode != 0:
                raise RuntimeError(
                    f"Step failed: {' '.join(cmd[1:2])}\n\n"
                    f"STDOUT:\n{proc.stdout}\n\nSTDERR:\n{proc.stderr}"
                )

        final = furnished_dir / f"plan_{plan_id}_furnished.json"
        if not final.exists():
            raise FileNotFoundError(f"Expected output not found: {final}")

        _jobs[job_id]["status"] = "done"
        _jobs[job_id]["result"] = str(final)

    except Exception as exc:
        _jobs[job_id]["status"] = "error"
        _jobs[job_id]["error"]  = str(exc)


# ── HTML form ─────────────────────────────────────────────────────────────────

_HTML = """<!DOCTYPE html>
<html>
<head>
  <title>Floor Plan Furnishing</title>
  <style>
    body { font-family: sans-serif; max-width: 640px; margin: 48px auto; padding: 0 20px; }
    button { margin-left: 8px; }
    pre { background: #f5f5f5; padding: 14px; border-radius: 6px; white-space: pre-wrap; }
    .done  { color: green; }
    .error { color: red;   }
  </style>
</head>
<body>
  <h2>Floor Plan Furnishing</h2>
  <p>Upload a plan <code>.json</code> file. The pipeline runs in the background
     (several minutes). This page polls every 8 seconds and downloads the result
     automatically when ready.</p>

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
      show('Job submitted\\nJob ID : ' + data.job_id + '\\nStatus : pending\\n\\nPolling every 8 s…');
      poll(data.job_id);
    };

    async function poll(id) {
      await new Promise(r => setTimeout(r, 8000));
      const r = await fetch('/status/' + id);
      const s = await r.json();
      if (s.status === 'done') {
        show('Done! Downloading result…', 'done');
        window.location = '/result/' + id;
      } else if (s.status === 'error') {
        show('Pipeline error:\\n\\n' + s.error, 'error');
      } else {
        show('Job ID : ' + id + '\\nStatus : ' + s.status + '\\n\\nPolling every 8 s…');
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

    # save the plan where locate_furniture's --plans-dir will find it
    (workspace / f"plan_{plan_id}.json").write_bytes(raw)

    _jobs[job_id] = {"status": "pending", "plan_id": plan_id}

    thread = threading.Thread(
        target=_run_pipeline,
        args=(job_id, workspace / f"plan_{plan_id}.json", plan_id, workspace),
        daemon=True,
    )
    thread.start()

    return {"job_id": job_id, "poll_url": f"/status/{job_id}"}


@app.get("/status/{job_id}")
async def status(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    resp = {"job_id": job_id, "status": job["status"], "plan_id": job["plan_id"]}
    if job["status"] == "done":
        resp["result_url"] = f"/result/{job_id}"
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
        path,
        media_type="application/json",
        filename=f"plan_{plan_id}_furnished.json",
    )


# ── entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
