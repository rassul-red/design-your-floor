# ─────────────────────────────────────────────
#  Edit this file to control image generation
# ─────────────────────────────────────────────

# Models — one image will be generated from each
MODEL_A = "gemini-3-pro-image-preview"
MODEL_B = "gemini-3.1-flash-image-preview"

MODEL_A_LABEL = "banana-pro"
MODEL_B_LABEL = "banana-2"

# Output
OUTPUT_DIR = "gen_output"

# Image generation quality / size settings
ASPECT_RATIO = "1:1"
IMAGE_SIZE   = "1K"
OUTPUT_FORMAT = "image/png"
JPEG_QUALITY  = None

# Sampling
TEMPERATURE = 0.75
