<div align="center">

# 🛍️ product_search

### *Identify every furniture item in a room — get direct Google Shopping links*

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python)](https://www.python.org)
[![Gemini](https://img.shields.io/badge/Gemini-2.0%20Flash-4285F4?style=flat-square&logo=google)](https://deepmind.google/technologies/gemini/)
[![Google Search](https://img.shields.io/badge/Google%20Search-Grounding-EA4335?style=flat-square&logo=google)](https://cloud.google.com/vertex-ai/generative-ai/docs/grounding)

Point it at any room image — furnished or otherwise — and get back an **exhaustive list of every furniture and decor item** with bounding boxes and direct Google Shopping search links.

</div>

---

## ✨ What it does

1. Accepts any room image (JPG, PNG, or a Gemini-generated furnished room)
2. Sends it to **Gemini 2.0 Flash** with Google Search Grounding enabled
3. Gemini exhaustively detects all furniture and decor items
4. Returns for each item:
   - Object name
   - Bounding box coordinates `[ymin, xmin, ymax, xmax]`
   - A precise **shopping search query**
   - A **direct Google search link** for that query

---

## 🚀 Usage

### Prerequisites

```bash
pip install google-genai Pillow
export GEMINI_API_KEY=your_key_here
```

### Run

```bash
cd product_search
# place your room image as image.png
python search.py
```

Or import in your own code:

```python
from search import find_products_in_room

find_products_in_room("path/to/furnished_room.png")
```

### Example output

```
--- Room Analysis Results ---

1. Sofa
   Bounding box: [120, 80, 310, 520]
   Search Query: "3-seat grey linen sofa mid-century modern"
   🔗 https://www.google.com/search?q=3-seat+grey+linen+sofa+mid-century+modern

2. Coffee Table
   Bounding box: [280, 200, 370, 420]
   Search Query: "round oak coffee table Scandinavian"
   🔗 https://www.google.com/search?q=round+oak+coffee+table+Scandinavian
...
```

---

## ⚙️ Configuration

| Variable | Default | Description |
|---|---|---|
| `GEMINI_API_KEY` | env var | Google Gemini API key |
| `model_id` | `gemini-2.0-flash` | Gemini model used |
| `image_path` | `image.png` | Input image path |

---

## 🔧 How it works

```python
# Uses Google Search Grounding for real product links
config=types.GenerateContentConfig(
    tools=[types.Tool(google_search=types.GoogleSearchRetrieval())]
)
```

The `GoogleSearchRetrieval` tool enables Gemini to ground its output in live Google Search results, generating accurate, real shopping queries rather than generic descriptions.

---

## 🗂️ Files

```
product_search/
├── search.py    # Main script — find_products_in_room(image_path)
└── README.md
```

---

## 💡 Tips

- Works best with **top-down 2D furnished room images** from the `furnitureplacement` pipeline
- Also works on **photos of real rooms** or **3D rendered interiors**
- Pass the path to a `plan_XXXX_furnished.png` for fully automated end-to-end shopping
