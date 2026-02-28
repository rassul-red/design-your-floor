import os
from google import genai
from google.genai import types
import PIL.Image

# 1. Setup: This looks for a variable named 'GEMINI_API_KEY' in your system
api_key = os.getenv('GEMINI_API_KEY')

if not api_key:
    raise ValueError("GEMINI_API_KEY not found. Please set it in your environment variables.")

client = genai.Client(api_key=api_key)
model_id = "gemini-2.0-flash"

def find_products_in_room(image_path):
    try:
        img = PIL.Image.open(image_path)
    except FileNotFoundError:
        print(f"Error: The file '{image_path}' was not found.")
        return

    prompt = """
    Exhaustively detect all furniture and decor items in this room. 
    For each item:
    1. Provide the object name.
    2. Provide [ymin, xmin, ymax, xmax] bounding box coordinates.
    3. Provide a specific 'Search Query' for shopping.
    4. Provide a direct Google Search link for that query.
    """

    response = client.models.generate_content(
        model=model_id,
        contents=[prompt, img],
        config=types.GenerateContentConfig(
            tools=[types.Tool(google_search=types.GoogleSearchRetrieval())]
        )
    )

    print("--- Room Analysis Results ---\n")
    print(response.text)

if __name__ == "__main__":
    find_products_in_room('image.png')