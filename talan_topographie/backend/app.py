"""
GeoViewer Pro – Python Backend (Flask + Mistral Pixtral Vision API)
--------------------------------------------------------------------
Endpoints:
  POST /save-screenshot   → Save base64 PNG to screenshots/ folder
  POST /analyze-image     → Send image to Mistral Pixtral for geographic analysis
  GET  /health            → Health check
  GET  /diagnose          → Test Mistral API connectivity

Run from the backend/ directory:
    pip install -r requirements.txt
    python app.py
"""

import os
import base64
import traceback
import datetime
import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ── Mistral Configuration ──────────────────────────────────
MISTRAL_API_KEY  = "ZeEnltC2SgdwysnvlvOmG2q8qhObvgoZ"
MISTRAL_API_URL  = "https://api.mistral.ai/v1/chat/completions"
MISTRAL_MODEL    = "pixtral-12b-latest"   # Vision model — sees images
SCREENSHOTS_DIR  = os.path.join(os.path.dirname(__file__), "..", "screenshots")
# ──────────────────────────────────────────────────────────

os.makedirs(SCREENSHOTS_DIR, exist_ok=True)


# ==========================================
# POST /save-screenshot
# ==========================================
@app.route("/save-screenshot", methods=["POST"])
def save_screenshot():
    """Receive base64 PNG image and save it to the screenshots/ folder."""
    try:
        body       = request.get_json(force=True)
        image_b64  = body.get("image_base64", "")
        map_type   = body.get("map_type", "map")
        zoom       = body.get("zoom", 0)

        if not image_b64:
            return jsonify({"error": "No image data received."}), 400

        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        filename  = f"{map_type}_{timestamp}_z{zoom}.png"
        filepath  = os.path.join(SCREENSHOTS_DIR, filename)

        image_bytes = base64.b64decode(image_b64)
        with open(filepath, "wb") as f:
            f.write(image_bytes)

        abs_path = os.path.abspath(filepath)
        print(f"[SAVED] {abs_path}  ({round(len(image_bytes)/1024, 1)} KB)")

        return jsonify({
            "status":   "saved",
            "filename": filename,
            "path":     abs_path,
            "size_kb":  round(len(image_bytes) / 1024, 1)
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"{type(e).__name__}: {str(e)}"}), 500


# ==========================================
# POST /analyze-image
# ==========================================
@app.route("/analyze-image", methods=["POST"])
def analyze_image():
    """Send the map screenshot to Mistral Pixtral Vision for expert geographic analysis."""
    try:
        body       = request.get_json(force=True)
        image_b64  = body.get("image_base64", "")
        map_type   = body.get("map_type", "Topographic Map")
        center_lat = float(body.get("center_lat", 0))
        center_lng = float(body.get("center_lng", 0))
        zoom       = body.get("zoom", 0)
        saved_file = body.get("saved_file", "unknown")
        scale      = body.get("scale_m_px", "Unknown")
        coords     = body.get("coordinates", [])

        if not image_b64:
            return jsonify({"error": "No image data received."}), 400

        # Format coordinates for the prompt
        coord_text = "\n".join([f"  - Point {i+1}: Lat {p['lat']:.5f}, Lng {p['lng']:.5f}" for i, p in enumerate(coords)]) if coords else "  - None provided"

        # Shared context for all models
        context = f"""
CRITICAL INSTRUCTION: The user has selected a specific area of interest. This area is enclosed within the bright **GREEN LINES** (the drawn polygon) on the map. You MUST focus your analysis specifically on the land INSIDE and immediately surrounding these green lines.

### Map Scale & Details:
- Map Center: {center_lat:.4f}°N, {center_lng:.4f}°E
- Zoom level: {zoom}
- Map Scale (Echelle): ~{scale} meters per pixel
- Selected Polygon Vertices (Coordinates):
{coord_text}
"""

        # Only Topo map is supported now
        prompt_text = f"""You are a world-class expert Topographer and Cartographer. You are analyzing a screenshot from an interactive **Topographic Map**.
{context}

STRICT RESTRICTION: You MUST ONLY discuss Topography. DO NOT discuss geology (rock types, faults) or hydrology (rivers, oceans) unless they directly impact the elevation or slope. Do not provide a general geographic overview. Stay strictly in your lane.

Carefully examine the terrain inside the green lines and provide an expert Topographical analysis:
## 1. Elevation & Relief
Analyze the contour lines (isolines). What is the estimated highest and lowest elevation? Are there steep cliffs or flat plains?
## 2. Slope Gradient & Stability
Assess the steepness of the terrain based on the scale (~{scale} meters/pixel). Identify areas with potential slope instability or landslide risks.
## 3. Natural Landforms
Describe mountains, ridges, valleys, and saddles visible within the polygon.
## 4. Cut-and-Fill Feasibility
If a city or large infrastructure were to be built here, how extensive would the earthwork (cut-and-fill) need to be?
## 5. Topographic Advantages
What natural defensive, aesthetic, or developmental advantages does this specific terrain offer?
"""

        # Format data URI for Mistral
        image_data_uri = f"data:image/png;base64,{image_b64}"

        headers = {
            "Authorization": f"Bearer {MISTRAL_API_KEY}",
            "Content-Type":  "application/json"
        }

        payload = {
            "model": MISTRAL_MODEL,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": prompt_text
                        },
                        {
                            "type": "image_url",
                            "image_url": image_data_uri
                        }
                    ]
                }
            ],
            "max_tokens": 2048,
            "temperature": 0.2
        }

        print(f"[ANALYZE] Sending to Mistral {MISTRAL_MODEL}...")
        resp = requests.post(MISTRAL_API_URL, json=payload, headers=headers, timeout=120)

        if resp.status_code != 200:
            error_detail = resp.text[:500]
            print(f"[ERROR] Mistral API: {resp.status_code} — {error_detail}")
            return jsonify({
                "error": f"Mistral API error {resp.status_code}: {error_detail}"
            }), 500

        data     = resp.json()
        analysis = data["choices"][0]["message"]["content"]
        tokens   = data.get("usage", {})
        print(f"[DONE] Tokens used: {tokens.get('total_tokens', '?')} | Length: {len(analysis)} chars")

        return jsonify({"analysis": analysis})

    except requests.exceptions.ConnectionError:
        return jsonify({"error": "No internet connection or Mistral API is unreachable."}), 503

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"{type(e).__name__}: {str(e)}"}), 500


# ==========================================
# POST /generate-3d-surface
# ==========================================
@app.route("/generate-3d-surface", methods=["POST"])
def generate_3d_surface():
    """Generates Three.js Javascript code: topographic terrain + user-requested structures."""
    try:
        body          = request.get_json(force=True)
        analysis_text = body.get("analysis_text", "Flat terrain with gentle hills.")
        user_prompt   = body.get("user_prompt", "Build a smart city")

        CODING_MODEL = "mistral-large-latest"

        prompt = f"""You are an expert Three.js 3D generative AI coder. Your task is to write a single, self-contained, executable JavaScript script that:
1. Reads the TERRAIN ANALYSIS and generates a realistic 3D terrain mesh.
2. Reads the USER REQUEST and builds 3D building/structure geometries on top of the terrain.

=== TERRAIN ANALYSIS ===
{analysis_text}

=== USER REQUEST ===
{user_prompt}

=== STRICT TECHNICAL REQUIREMENTS ===

**SCENE SETUP:**
- Create a Three.js Scene, PerspectiveCamera (fov:60), and a WebGLRenderer.
- Attach the renderer to the element with id '3d-container'. Use `container.clientWidth` and `container.clientHeight` for dimensions.
- Set renderer background color to 0x0f172a (dark navy).
- Add OrbitControls so the user can orbit, zoom, pan.

**TERRAIN MESH:**
- Create a `THREE.PlaneGeometry(200, 200, 80, 80)` and rotate it -Math.PI/2 so it is flat (horizontal).
- Displace the Y position of each vertex using a multi-octave noise function based on the terrain description. If the analysis describes mountains, make high peaks. If it describes flat plains, keep Y near 0. Use `Math.sin` and `Math.cos` combinations with different frequencies to simulate natural terrain variation.
- Use a `THREE.MeshStandardMaterial` with:
  - `vertexColors: true` – color vertices by height (low = dark green 0x166534, mid = brown 0x78350f, high = white/grey 0xd1d5db).
  - `wireframe: false`
  - `flatShading: true`
- After modifying vertices, call `geometry.computeVertexNormals()`.

**BUILDINGS/STRUCTURES:**
- Based on the USER REQUEST, generate appropriate THREE.js geometry objects placed ON TOP of the terrain surface. The Y position of each building must be: `terrainHeightAtPosition + buildingHeight / 2`.
- To get terrain height at (x, z): re-compute the same noise formula used for terrain at those coordinates.
- Build a variety of structures matching the request. Examples:
  - For "smart city" or "city": build 8-15 buildings of varied heights (BoxGeometry), a central tower (CylinderGeometry, tall), roads (flat thin BoxGeometry), parks (flat green disc geometry).
  - For "hospital": a large cross-shaped building (3 BoxGeometry pieces forming a + shape), a helipad on the roof (flat cylinder), surrounded by smaller admin buildings.
  - For "residential": rows of house shapes (BoxGeometry for walls, a prism for roof using a custom shape or a flattened ConeGeometry).
  - For "park" or "forest": use ConeGeometry for trees in clusters, a flat circular platform for plazas.
  - For any other request, use your creativity to build relevant structures.
- Use `THREE.MeshStandardMaterial` with emissive color for buildings (e.g. neon teal 0x0ea5e9, purple 0x8b5cf6, warm white 0xfef9c3 for windows glow).
- Add glowing point lights inside the building cluster (color 0x38bdf8, intensity 2, distance 80) to simulate city lights at night.

**LIGHTING:**
- Add `THREE.AmbientLight(0x334155, 1.5)`.
- Add `THREE.DirectionalLight(0xffffff, 2.0)` positioned at (100, 200, 100), casting shadows.
- Add a subtle `THREE.FogExp2(0x0f172a, 0.005)` for depth.

**ANIMATION LOOP:**
- In the animation loop, slowly auto-rotate the entire scene: `scene.rotation.y += 0.001`.
- Call `controls.update()` and `renderer.render(scene, camera)`.

**RESIZE HANDLING:**
- Listen for `window.resize` and update camera aspect and renderer size.

CRITICAL OUTPUT RULES:
- Output ONLY raw, valid, executable JavaScript. NO markdown code fences. NO HTML. NO explanations.
- The code must be immediately runnable via `new Function(code)()`.
- Do NOT use import/export statements. Assume Three.js and OrbitControls are already globally available as `THREE` and `THREE.OrbitControls`.
"""

        headers = {
            "Authorization": f"Bearer {MISTRAL_API_KEY}",
            "Content-Type":  "application/json"
        }

        payload = {
            "model": CODING_MODEL,
            "messages": [
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 3000,
            "temperature": 0.3
        }

        print(f"[GEN 3D] user_prompt='{user_prompt}' | Sending to {CODING_MODEL}...")
        resp = requests.post(MISTRAL_API_URL, json=payload, headers=headers, timeout=120)

        if resp.status_code != 200:
            return jsonify({"error": f"Mistral API error: {resp.text[:300]}"}), 500

        data = resp.json()
        js_code = data["choices"][0]["message"]["content"]

        # Strip any markdown backticks the model may have added despite instructions
        for fence in ["```javascript", "```js", "```"]:
            js_code = js_code.replace(fence, "")
        js_code = js_code.strip()

        print(f"[GEN 3D] Generated {len(js_code)} chars of Three.js code.")
        return jsonify({"code": js_code})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"{type(e).__name__}: {str(e)}"}), 500


# ==========================================
# GET /health
# ==========================================
@app.route("/health", methods=["GET"])
def health():
    screenshots = os.listdir(SCREENSHOTS_DIR) if os.path.exists(SCREENSHOTS_DIR) else []
    return jsonify({
        "status":          "ok",
        "model":           MISTRAL_MODEL,
        "screenshots_dir": os.path.abspath(SCREENSHOTS_DIR),
        "saved_count":     len(screenshots)
    })


# ==========================================
# GET /diagnose
# ==========================================
@app.route("/diagnose", methods=["GET"])
def diagnose():
    """Test connectivity to the Mistral API."""
    try:
        headers = {
            "Authorization": f"Bearer {MISTRAL_API_KEY}",
            "Content-Type":  "application/json"
        }
        # Lightweight test call — list available models
        r = requests.get("https://api.mistral.ai/v1/models", headers=headers, timeout=10)
        if r.status_code == 200:
            models = [m["id"] for m in r.json().get("data", [])]
            return jsonify({
                "flask":          "ok",
                "mistral_api":    "connected",
                "model":          MISTRAL_MODEL,
                "available":      models,
                "model_ready":    MISTRAL_MODEL in models
            })
        else:
            return jsonify({
                "flask":       "ok",
                "mistral_api": f"error {r.status_code}",
                "detail":      r.text[:300]
            })
    except Exception as e:
        return jsonify({"flask": "ok", "mistral_api": f"cannot connect: {e}"})


# ==========================================
# POST /run-n8n-pipeline
# ==========================================
@app.route("/run-n8n-pipeline", methods=["POST"])
def run_n8n_pipeline():
    """Forward the form payload directly to the user's n8n webhook."""
    try:
        body = request.get_json(force=True)
        webhook_url = body.pop("webhook_url", "").strip()
        
        if not webhook_url:
            return jsonify({"error": "No n8n webhook URL provided in the form."}), 400

        print(f"[N8N] Forwarding payload to {webhook_url}...")
        
        # We pass the data in so n8n's webhook node can receive it
        resp = requests.post(webhook_url, json=body, timeout=180) # 3 min timeout for multi-agent
        
        print(f"[N8N] Response status: {resp.status_code}")
        
        # Return whatever n8n returned back to the frontend
        try:
            return jsonify(resp.json()), resp.status_code
        except Exception:
            return jsonify({"message": "Pipeline triggered successfully, but n8n didn't return JSON.", "raw": resp.text}), resp.status_code

    except requests.exceptions.RequestException as e:
        print(f"[ERROR] n8n Webhook Error: {e}")
        return jsonify({"error": f"Failed to reach n8n webhook: {e}"}), 502
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": f"{type(e).__name__}: {str(e)}"}), 500


# ==========================================
# Main
# ==========================================
if __name__ == "__main__":
    abs_screenshots = os.path.abspath(SCREENSHOTS_DIR)
    print("=" * 60)
    print("  GeoViewer Pro — Mistral Vision Backend")
    print("=" * 60)
    print(f"  Model        : {MISTRAL_MODEL}")
    print(f"  Screenshots  : {abs_screenshots}")
    print(f"  Server       : http://localhost:5000")
    print(f"  Diagnose     : http://localhost:5000/diagnose")
    print("=" * 60)
    print("  No local Ollama needed! Uses Mistral cloud API.")
    print("=" * 60)
    app.run(port=5000, debug=False)
