"""
gen_run.py — Two-stage Gemini image generation playground.

Pipeline (run in parallel for MODEL_A and MODEL_B):
  Stage 1: INPUT_IMAGES + prompt1 → intermediate image (saved)
  Stage 2: intermediate image + prompt2 → final image (saved)

API key is read from GEMINI_API_KEY in .env (or the environment).

Usage:
    python gen_run.py
"""

import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types
from PIL import Image
import io

import gen_config as cfg

load_dotenv()

API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    raise EnvironmentError("GEMINI_API_KEY not set. Add it to .env or export it.")

client = genai.Client(api_key=API_KEY)


def load_prompt(path_str: str) -> str:
    p = Path(path_str)
    if not p.exists():
        raise FileNotFoundError(f"Prompt file not found: {path_str}")
    return p.read_text(encoding="utf-8").strip()


PROMPT_1 = load_prompt(cfg.PROMPT_FILE_1)

os.makedirs(cfg.OUTPUT_DIR, exist_ok=True)

# Base name derived from first input image, e.g. "plan_7031"
INPUT_BASE = Path(cfg.INPUT_IMAGES[0]).stem if cfg.INPUT_IMAGES else "output"


def load_input_images() -> list:
    images = []
    for path in cfg.INPUT_IMAGES:
        p = Path(path)
        if not p.exists():
            print(f"  Warning: input image not found: {path}")
            continue
        images.append(Image.open(p).convert("RGB"))
        print(f"  Loaded input image: {path}")
    return images


def _pil_to_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


IMAGE_CONFIG = types.ImageConfig(
    aspect_ratio=cfg.ASPECT_RATIO,
    image_size=cfg.IMAGE_SIZE,
)


def _call(model: str, contents: list) -> tuple[Image.Image, object]:
    """Call the model and return (PIL image, raw response)."""
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=types.GenerateContentConfig(
            image_config=IMAGE_CONFIG,
            temperature=cfg.TEMPERATURE,
        ),
    )
    for part in response.candidates[0].content.parts:
        if part.inline_data:
            return Image.open(io.BytesIO(part.inline_data.data)), response
    raise RuntimeError(f"No image returned by {model}")


def save(img: Image.Image, model_label: str, stage: int) -> str:
    ext = "jpg" if cfg.OUTPUT_FORMAT == "image/jpeg" else "png"
    out_path = os.path.join(cfg.OUTPUT_DIR, f"{INPUT_BASE}_{model_label}_stage{stage}.{ext}")
    img.save(out_path)
    return out_path


def run_pipeline(label: str, model: str, model_label: str, input_images: list):
    print(f"  [{label}] — {model}")
    result, _ = _call(model, input_images + [PROMPT_1])
    out_path = save(result, model_label, stage=1)
    print(f"  [{label}] Saved → {out_path}")
    return out_path


def main():
    print(f"Model A : {cfg.MODEL_A}")
    print(f"Model B : {cfg.MODEL_B}")
    print(f"Prompt  : {cfg.PROMPT_FILE_1}")
    print(f"Output  : {cfg.OUTPUT_DIR}/\n")

    input_images = load_input_images()
    print()

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = {
            pool.submit(run_pipeline, "A", cfg.MODEL_A, cfg.MODEL_A_LABEL, input_images),
            pool.submit(run_pipeline, "B", cfg.MODEL_B, cfg.MODEL_B_LABEL, input_images),
        }
        for future in as_completed(futures):
            try:
                future.result()
            except Exception as e:
                print(f"  Error: {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
