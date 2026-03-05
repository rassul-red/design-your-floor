<div align="center">

# 🔍 py_search

### *Structured furniture detection with direct Google Shopping links*

[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?style=flat-square&logo=python)](https://www.python.org)
[![Gemini](https://img.shields.io/badge/Gemini-2.0%20Flash-4285F4?style=flat-square&logo=google)](https://deepmind.google/technologies/gemini/)
[![JSON Mode](https://img.shields.io/badge/Output-JSON%20Mode-brightgreen?style=flat-square)](https://ai.google.dev/gemini-api/docs/json-mode)

A focused, **JSON-first** version of the product search. Identifies the **3 most prominent furniture items** in a room and returns structured data with precise shopping queries and direct Google Shopping URLs.

</div>

---

## ✨ What makes it different from `product_search/`

| | `product_search/` | `py_search/` |
|---|---|---|
| Detection scope | All furniture & decor (exhaustive) | Top 3 prominent items |
| Output format | Free-form text + bounding boxes | **Strict JSON** (machine-readable) |
| Search grounding | Google Search Grounding API | Manual Google Shopping URL construction |
| Use case | Comprehensive room inventory | Programmatic downstream use |

---

## 🚀 Usage

### Prerequisites

```bash
pip install google-genai Pillow
export GEMINI_API_KEY=your_key_here
```

### Run

```bash
cd py_search
# place your room image as image.png
python search.py
```

Or import as a module:

```python
from search import find_actual_products

find_actual_products("path/to/room.png")
```

### Example output

```
--- Found Items & Direct Search Links ---

Item: Sofa
Style: 3-seat, light grey fabric, mid-century modern legs
Direct Shopping Link: https://www.google.com/search?tbm=shop&q=3-seat+light+grey+fabric+sofa+mid-century+modern
------------------------------
Item: Coffee Table
Style: Round, solid oak, minimalist Scandinavian design
Direct Shopping Link: https://www.google.com/search?tbm=shop&q=round+solid+oak+coffee+table+Scandinavian
------------------------------
Item: Floor Lamp
Style: Brass arc lamp with white dome shade
Direct Shopping Link: https://www.google.com/search?tbm=shop&q=brass+arc+floor+lamp+white+dome+shade
------------------------------
```

---

## ⚙️ How it works

```python
# Forces Gemini to return strict JSON — no prose
config=types.GenerateContentConfig(
    response_mime_type="application/json"
)
```

Each item in the JSON response has:

```json
[
  {
    "item_name": "Sofa",
    "specific_description": "3-seat, light grey fabric, mid-century modern legs",
    "shopping_query": "3-seat light grey fabric sofa mid-century modern"
  }
]
```

The script then constructs `https://www.google.com/search?tbm=shop&q=<shopping_query>` to directly target Google Shopping results.

---

## 🗂️ Files

```
py_search/
├── search.py    # Main script — find_actual_products(image_path)
├── test         # Test runner / sample images
└── README.md
```

---

## 💡 Tips

- Use the output `shopping_query` strings to programmatically query e-commerce APIs
- Pair with the `furnitureplacement` pipeline to go from floor plan → furnished render → buy every item shown
- Switch to `gemini-2.5-pro` in `model_id` for more nuanced style descriptions
