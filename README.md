# 🏝️ Pixel Island Explorer

> **An open-world 3D procedural island exploration game crafted with an authentic retro pixel-art aesthetic, vibrant cel-shaded visuals, and dynamic ecosystems.**

Built from the ground up using **Three.js**, **TypeScript**, **Vite**, and **custom GLSL shaders**.

---

## ✨ Features

### 🌍 1. Procedural Continental Geography & Biomes
- **Continuous Multi-Scale Terrain**: Tectonic simplex noise and domain warping generate natural coastlines, bays, peninsulas, mountain ranges, and deep ocean trenches without repetitive grid boundaries.
- **Living Biome Matrix**:
  - 🏖️ **Tropical Beach**: Warm golden sands with Caribbean turquoise waters.
  - 🌿 **Mangrove Swamp**: Estuarine coastal lagoons with rich emerald & jade green waters.
  - ❄️ **Frozen Arctic Tundra**: Glacial shorelines with crystalline pale ice-cyan water, snow cover, and floating ice floes.
  - 🏞️ **Temperate Forest & Mountain Lakes**: Serene freshwater bodies with progressive light-to-navy depth darkening.
  - 🌋 **Volcanic Caldera & Basalt Fields**: Lava lakes, cooled basalt, and sulfur deposits.
  - ♨️ **Geothermal Valley & Hot Springs**: Travertine terraces and mineral pools.
  - 🏜️ **Stratified Canyons**: Multi-layered desert red rock formations.

---

### 🌊 2. Custom Cel-Shaded Pixel Water Shader
- **Cascaded Ocean Geometry**: High-resolution central grid transitioning seamlessly into outer concentric rings up to 16 km diameter.
- **True Planar Pixel Reflections**: Real-time inverted rendering capturing island terrain, cliffs, trees, and skybox reflections across all camera angles.
- **Biome-Specific Chromatic Palettes**: Dynamic fragment evaluation maps water body hues in real time according to geographic and bioclimatic coordinates.
- **Progressive Depth Darkening**: Physical vertical depth attenuation (`verticalDepth`) creates crystal-clear shallows that progressively darken into deep oceanic/lake abyss.
- **Multi-Layer Stylized Foam**: Discrete cellular Voronoi patterns, animated wind wave drift, and crisp contact foam lining the shorelines.
- **Interactive Ripples**: Real-time concentric rings and surface displacement reacting to player clicks and interactions.

---

### 🌲 3. Procedural Botanical Vegetation
- **Diverse Flora Species**: Coastal Palms, Massive Oaks, Alpine Pines, White Birches, Savanna Acacias, and Mangroves.
- **Billowy Foliage Masses**: Procedurally generated leaf clusters with smooth cel-shaded normals (no origami faceting).
- **Procedural Canvas Textures**: Toroidal seamless leaf petal textures generated at runtime.
- **Wind Sway Dynamics**: GPU/CPU synchronized gentle wind movement across all forest canopies.

---

### 🌅 4. Pixelated Retro Skybox & Day/Night Cycle
- **Stepped Cel-Shaded Gradient**: 8 discrete atmospheric bands with stereographic 4x4 Bayer dithering, eliminating color banding and unwanted blur.
- **Pixel Sun & Moon**: Geometric pixelated celestial bodies synced with directional sunlight and dynamic shadows.
- **Cartoon Cumulus Clouds**: Pixel-art cloud clusters with directional 3-tone lighting and continuous wind animation.

---

### 🎮 5. Dual Camera & Exploration System
- **Observer Mode (Aerial / Isometric)**:
  - Pan across the archipelago.
  - Rotate and orbit with right-click drag.
  - Smooth mouse wheel zoom.
  - Interactive 3D Pegman widget for pinpoint landing.
- **First-Person Mode (Ground Level)**:
  - Immersive ground walk & sprint with authentic player height and collision handling.
  - Smooth mouse look (with optional Pointer Lock support).
  - Cinematic dive-in and ascend transitions between aerial and first-person views.

---

## 🕹️ Controls

### Observer Mode (Visão Aérea)
| Control | Action |
| :--- | :--- |
| **Left Click + Drag** | Pan camera across the island |
| **Right Click + Drag** | Rotate / orbit view horizontally |
| **Mouse Wheel** | Zoom in / Zoom out |
| **Click on Water** | Create interactive water ripples |
| **Drag Pegman HUD** | Drop player anywhere to enter First-Person Mode |

### First-Person Mode (Primeira Pessoa)
| Control | Action |
| :--- | :--- |
| **W, A, S, D** | Walk forward, left, backward, right |
| **Shift + W** | Sprint / Corrida rápida |
| **Mouse Drag / Click** | Look around (Mouse Look) |
| **Left Click on Water** | Generate interactive ripples |
| **Escape (ESC)** | Return to Aerial Observer Mode |

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.0 or higher recommended)
- Modern web browser with WebGL 2.0 support (Chrome, Edge, Firefox, Brave)

### Installation

```bash
# Clone the repository
git clone https://github.com/Botopai50/Pixel-Island.git

# Navigate into the project folder
cd Pixel-Island

# Install dependencies
npm install
```

### Running Locally

```bash
# Start Vite development server
npm run dev
```

Open `http://localhost:5173/` in your browser to explore the island!

### Building for Production

```bash
# Type check and build optimized bundle
npm run build

# Preview production build locally
npm run preview
```

---

## 📁 Project Structure

```text
src/
├── atmosphere/          # Pixelated Skybox, celestial bodies, clouds & lighting
├── generation/          # Procedural world generation engine
│   ├── aquatic/         # Coral reefs and underwater marine features
│   ├── caves/           # Cave openings and subterranean features
│   ├── ecology/         # Biome classification and climate matrices
│   ├── geography/       # Macro-geography and domain-warped landmasses
│   ├── geothermal/      # Hot springs, thermal pools, and travertine terraces
│   ├── hydrology/       # River carving, lake depressions, and water systems
│   ├── ice/             # Arctic ice floes and glacial features
│   ├── math/            # Simplex noise, PRNG, and procedural math utils
│   ├── shaders/         # Custom GLSL shaders (Water, Terrain, Lava)
│   ├── terrain/         # Chunk manager, heightmap, and mesh builders
│   ├── vegetation/      # Botanical geometries, tree generators, and foliage textures
│   └── volcanology/     # Volcano calderas, basalt fields, and lava fluids
├── player/              # Observer camera, first-person controller & input managers
├── ui/                  # HUD widgets, Pegman marker, and exploration UI
├── config.ts            # Global world, camera, and rendering configuration
└── main.ts              # Three.js scene orchestration, dual-pass rendering & loops
```

---

## 📄 License

This project is created by [Botopai50](https://github.com/Botopai50). All rights reserved.
