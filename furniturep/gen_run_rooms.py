"""
gen_run_rooms.py — Per-room Gemini image generation.

For every image found in the input folder, runs the generation pipeline
(MODEL_A and MODEL_B in parallel) using prompt_by_room.txt and saves one
output image per model per room image.

Usage:
    python gen_run_rooms.py                        # uses default folder: room_views
    python gen_run_rooms.py room_views/
    python gen_run_rooms.py my_rooms/ --out-dir results/
"""

import argparse
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
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

PROMPT_FILE = Path(__file__).parent / "prompt_by_room.txt"
IMAGE_EXTS = {".png", ".jpg", ".jpeg"}

IMAGE_CONFIG = types.ImageConfig(
    aspect_ratio=cfg.ASPECT_RATIO,
    image_size=cfg.IMAGE_SIZE,
)


def load_prompt(path: Path) -> str:
    if not path.exists():
        raise FileNotFoundError(f"Prompt file not found: {path}")
    return path.read_text(encoding="utf-8").strip()


def _pil_to_bytes(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _call(model: str, contents: list) -> Image.Image:
    """Call the model and return a PIL image."""
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
            return Image.open(io.BytesIO(part.inline_data.data))
    raise RuntimeError(f"No image returned by {model}")


def glob_images(folder: Path) -> list[Path]:
    """Return sorted list of image files in *folder*."""
    return sorted(
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    )


def run_one(image_path: Path, model: str, model_label: str,
            prompt: str, out_dir: Path) -> str:
    """Generate one furnished room image and save it. Returns output path."""
    pil_img = Image.open(image_path).convert("RGB")
    img_bytes = _pil_to_bytes(pil_img)
    contents = [
        types.Part.from_bytes(data=img_bytes, mime_type="image/png"),
        prompt,
    ]
    result = _call(model, contents)
    ext = "jpg" if cfg.OUTPUT_FORMAT == "image/jpeg" else "png"
    out_path = out_dir / f"{image_path.stem}_{model_label}.{ext}"
    result.save(str(out_path))
    return str(out_path)


def main():
    parser = argparse.ArgumentParser(
        description="Generate furnished room images from per-room floor plan PNGs."
    )
    parser.add_argument(
        "input_folder", nargs="?", default="room_views",
        help="Folder containing per-room images (default: room_views)",
    )
    parser.add_argument(
        "--out-dir", default=cfg.OUTPUT_DIR, metavar="DIR",
        help=f"Output directory (default: {cfg.OUTPUT_DIR})",
    )
    args = parser.parse_args()

    input_folder = Path(args.input_folder)
    out_dir = Path(args.out_dir)

    if not input_folder.is_dir():
        raise SystemExit(f"Error: input folder not found: {input_folder}")

    out_dir.mkdir(parents=True, exist_ok=True)

    prompt = load_prompt(PROMPT_FILE)
    images = glob_images(input_folder)

    if not images:
        print(f"No images found in {input_folder}")
        return

    total = len(images) * 2  # MODEL_A + MODEL_B per image
    print(f"Model A  : {cfg.MODEL_A}")
    print(f"Model B  : {cfg.MODEL_B}")
    print(f"Prompt   : {PROMPT_FILE}")
    print(f"Input    : {input_folder}/ ({len(images)} image(s))")
    print(f"Output   : {out_dir}/")
    print(f"Jobs     : {total} (all running in parallel)\n")

    # Submit all jobs at once so every room × every model runs concurrently.
    with ThreadPoolExecutor(max_workers=total) as pool:
        futures = {}
        for image_path in images:
            for model, model_label in [(cfg.MODEL_A, cfg.MODEL_A_LABEL),
                                       (cfg.MODEL_B, cfg.MODEL_B_LABEL)]:
                f = pool.submit(run_one, image_path, model, model_label, prompt, out_dir)
                futures[f] = (image_path.name, model_label)

        for future in as_completed(futures):
            img_name, label = futures[future]
            try:
                out_path = future.result()
                print(f"  [{label}] {img_name} → {out_path}")
            except Exception as e:
                print(f"  [{label}] {img_name} error: {e}")

    print("\nDone.")


if __name__ == "__main__":
    main()
