# 3D Floor Plan Creator & Gemini Enhancer

This is a local web application that converts 2D JSON layout files into interactive 3D blockout environments. It features a first-person fly camera and the ability to export screenshots to an AI vision model (like Gemini) to conceptually render the blockout into a realistic room.

## Setup

1. **Install Dependencies:**
   Make sure you have Node.js installed, then run:
   ```bash
   npm install
   ```

2. **Environment Variables:**
   If you plan to connect the "Gemini Enhance" feature to a real backend, you will need to set up your API keys.
   - Copy the `.env.example` file and rename it to `.env`.
   - Add your actual Gemini API key to the `.env` file.
   ```bash
   cp .env.example .env
   ```

3. **Start the Server:**
   ```bash
   npm run start
   ```
   The application will be available at `http://localhost:8000`.

## Usage

1. Open `http://localhost:8000` in your web browser.
2. Under "2. JSON Data", upload a valid layout JSON file (e.g., from the `json examples` folder).
3. Use `W, A, S, D` to fly around the 3D space, and `Right-Click + Drag` to look around. Use `Q` and `E` to move vertically up and down.
4. Click the blue **"Screenshot Current View"** button.
5. In the modal that appears:
   - Click the ⚙️ gear icon to set the **System Prompt** (e.g., "You are an expert interior designer..."). This prompt is saved to your browser's local storage so you don't have to type it every time.
   - Enter a specific **User Prompt** for the current view (e.g., "Make this a cozy wooden cabin").
   - Click **"✨ Gemini Enhance"** to send the payload. *(Note: Currently, this button just logs the payload to the console and shows an alert. You must connect it to your backend API route in `app.js` to perform the actual fetch request.)*