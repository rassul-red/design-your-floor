import os
import json
from google import genai
from google.genai import types
import PIL.Image

# 1. Setup API Key
api_key = os.getenv('GEMINI_API_KEY')
client = genai.Client(api_key=api_key)
model_id = "gemini-2.0-flash"

def find_actual_products(image_path):
    img = PIL.Image.open(image_path)
    
    # We tell Gemini to act as a JSON generator. 
    # This prevents it from writing "Generic Sections" and forces specific data.
    prompt = """
    Analyze this room. Identify the 3 most prominent furniture items.
    Return ONLY a JSON list of objects with these keys:
    "item_name": name of the object
    "specific_description": colors, materials, style
    "shopping_query": a precise search string to find this exact item on Google Shopping
    """

    response = client.models.generate_content(
        model=model_id,
        contents=[prompt, img],
        config=types.GenerateContentConfig(
            # We use JSON mode to ensure the output is programmable
            response_mime_type="application/json"
        )
    )

    products = json.loads(response.text)
    
    print("--- Found Items & Direct Search Links ---\n")
    for item in products:
        # We manually construct a 'Search' URL that forces Google to show Products
        # This mimics the 'Google Shopping' experience
        search_url = f"https://www.google.com/search?tbm=shop&q={item['shopping_query'].replace(' ', '+')}"
        
        print(f"Item: {item['item_name']}")
        print(f"Style: {item['specific_description']}")
        print(f"Direct Shopping Link: {search_url}")
        print("-" * 30)

if __name__ == "__main__":
    find_actual_products('image.png')