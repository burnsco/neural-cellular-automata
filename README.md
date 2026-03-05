# Neural Cellular Automata - Living Texture Lab

A WebGL2-powered interactive simulation where simple local rules create complex, evolving organic patterns in real time.

## Highlights
- Real-time neural/cellular texture evolution on the GPU
- Paint directly into the simulation with pointer input
- Live controls for speed, mutation, brush size, bloom, and palette
- Collapsible control menu so the canvas stays playable while tuning
- Keyboard shortcuts for fast iteration during exploration

## Tech Stack
- TypeScript
- WebGL2 + GLSL shaders
- Vite

## Quick Start
1. Install dependencies.
```bash
npm install
```

2. Start the dev server.
```bash
npm run dev
```

3. Open the local Vite URL (usually `http://localhost:5173`).

4. Build production assets when needed.
```bash
npm run build
```

5. Preview the production build locally.
```bash
npm run preview
```

## Controls
| Action | Input |
|---|---|
| Inject growth | Click + drag on canvas |
| Pause/Resume | `Space` |
| Reset simulation | `R` |
| New random seed | `N` |
| Minimize/Expand menu | `M` or menu toggle button |

## UI Parameters
- `Speed`: simulation updates per rendered frame
- `Mutation`: stochastic variation injected each step
- `Brush`: radius of pointer-driven growth injection
- `Bloom`: glow intensity in render pass
- `Palette`: color mapping preset for visual style

## Project Structure
- `index.html`: UI shell and control panel markup
- `src/main.ts`: simulation setup, WebGL pipeline, input and UI bindings
- `src/shaders.ts`: update/render GLSL shader sources
- `src/style.css`: visual styling and responsive/collapsible panel behavior

## Notes
- WebGL2 support is required.
- The app falls back to RGBA8 state textures if float render targets are unavailable.

## License
No license file is currently defined. Add one before public redistribution if needed.
