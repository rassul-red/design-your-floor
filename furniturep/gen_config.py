# ─────────────────────────────────────────────
#  Edit this file to control image generation
# ─────────────────────────────────────────────

# Stage 1: input image(s) + prompt1 → intermediate image
PROMPT_FILE_1 = "prompt1.txt"

# Stage 2: intermediate image + prompt2 → final image
PROMPT_FILE_2 = "prompt2.txt"

# Optional input images (file paths relative to this directory).
# Leave empty for pure text-to-image.
# Example: INPUT_IMAGES = ["examples/plan_680.png", "other.jpg"]
INPUT_IMAGES = ["examples/plan_7031.png"]

# Models — one image will be generated from each
MODEL_A = "gemini-3-pro-image-preview"    # Nano Banana Pro
MODEL_B = "gemini-3.1-flash-image-preview"  # Nano Banana 2

MODEL_A_LABEL = "banana-pro"
MODEL_B_LABEL = "banana-2"

# Output
OUTPUT_DIR = "gen_output"

# Image generation quality / size settings
ASPECT_RATIO = "1:1"          # 1:1  3:4  4:3  9:16  16:9
IMAGE_SIZE    = "1K"           # "512px" | "1K" | "2K" | "4K" | None for model default
OUTPUT_FORMAT = "image/png"    # "image/png" or "image/jpeg"
JPEG_QUALITY  = None           # 0–100, only used when OUTPUT_FORMAT is image/jpeg; None = model default

# Sampling — lower = more literal/consistent, higher = more creative
# Range: 0.0 – 2.0. Try 0.5–0.8 for instruction-following, 1.0 for default.
TEMPERATURE = 0.75