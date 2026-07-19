# AI Urbain (GeoViewer Pro)

AI Urbain is an intelligent, web-based platform designed to assist in smart city planning and topographical analysis. By combining interactive maps with powerful AI vision models and procedural 3D generation, it allows users to analyze real-world terrain and simulate smart city structures on top of it.

## Features

- **Interactive 2D Map (Leaflet & Geoman)**: Search for locations globally, zoom in, and draw polygonal zones to select specific areas of interest.
- **Points of Interest (POIs)**: Automatically fetches and overlays nearby amenities (hospitals, schools, cafes, banks) using the Overpass API.
- **Topographical AI Analysis**: Captures the selected map area and sends it to the Mistral Pixtral Vision API to perform an expert topographical analysis (elevation, slopes, landforms, cut-and-fill feasibility).
- **Procedural 3D Smart City Generation**: Generates a stunning 3D visualization (using Three.js) of a smart city based on the topographical data and user prompts. Includes varied terrain, skyscrapers, residential zones, parks, and atmospheric lighting.
- **AI Chat Assistant**: An integrated chat interface to guide you through the process, request specific builds (e.g., "Build a hospital here"), and provide analytical feedback.

## Architecture

The project follows a decoupled client-server architecture:

### 1. Frontend (Vanilla Web Stack)
- **`index.html`**: The main entry point structuring the UI into three main panels: the Left Sidebar (Navigation), the Center View (Map/3D), and the Right Sidebar (AI Chat).
- **`style.css` & `style-expert.css`**: Provides a modern, glassmorphic, and responsive dark-mode design system.
- **`script.js`**: Handles all client-side logic:
  - **Leaflet.js** for map rendering and interactions.
  - **html2canvas** for capturing map screenshots.
  - **Three.js** for rendering the 3D smart city scene (`initSmartCity()`).
  - View switching, chat UI state, and API requests to the backend.

### 2. Backend (Python Flask)
Located in the `/backend` directory, the backend acts as an orchestrator and AI proxy.
- **`app.py`**: The main Flask server containing endpoints:
  - `POST /save-screenshot`: Saves the captured map region locally.
  - `POST /analyze-image`: Sends the image and map coordinates to the **Mistral Pixtral Vision API** (`pixtral-12b-latest`) for expert geographic and topographic analysis.
  - `POST /generate-3d-surface`: Passes the topographical analysis and user prompt to a coding LLM (`mistral-large-latest`) to generate dynamic Three.js code.

## Prerequisites

- Python 3.8+
- Modern Web Browser (Chrome, Edge, Firefox, Safari)

## How to Run

### 1. Start the Backend Server

Open a terminal, navigate to the `backend` folder, install the dependencies, and start the Flask app:

```bash
cd backend
pip install -r requirements.txt
python app.py
```

*Note: The server will start on `http://localhost:5000`. Ensure you have a valid Mistral API key configured in `app.py` (`MISTRAL_API_KEY`).*

### 2. Open the Frontend Application

Simply open the `index.html` file in your preferred web browser. No frontend build step or local server is strictly necessary for the UI, though serving it via a simple HTTP server is recommended for best performance (e.g., via VS Code Live Server).

```bash
# Optional: run a local server for the frontend
python -m http.server 8000
```
Then visit `http://localhost:8000/index.html`.

## Usage Guide

1. **Search**: Use the search bar in the map view to find a city or region.
2. **Draw**: Click the "Magic Wand" in the chat or the polygon tool on the map to draw a selection over the terrain.
3. **Analyze**: Double-click to finish drawing. The app will capture the area and the AI will provide a detailed topographical report in the chat.
4. **Simulate**: Tell the AI what you want to build (e.g., "Build a modern smart city"), then click the **3D Simulation** tab on the left. The app will generate a 3D scene with terrain and structures based on your request.
