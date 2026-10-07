---
name: add-sylva-hero
description: "Build Sylva from its verified authored source using Full HTML + DOM/CSS + local Three.js, including the complete renderer, interactions, and required assets. Use when Codex needs to implement, port, or adapt this effect without requiring the ThreeUI package or reconstructing the visual from an approximation."
---

# Build Sylva

## Description

The complete Sylva page with its living-world Three.js scene, local Lexend type, card imagery, and two native liquid-metal controls — plus three derived variants that re-dress the scene and retone the page chrome around it. Sylva Living World is the scene-only Three.js entry.

Recreate the authored behavior from the verified source, not from screenshots or the abbreviated orchestration sample in this skill. The implementation may live directly in the target project and does not require `@designcodeio/threeui`.

## Technologies

- React iframe host
- Byte-exact complete authored HTML document
- Same-project local source URL
- Local Three.js runtime, local Lexend web font, two local card images, and two native in-document liquid-metal controls

## Verified source material

- `src/shaders/landing-pages/LandingPages.tsx`
- `public/landing-pages/inner-green-3d.html — complete page with native controls`

Source revision: `SHA-256 05f359ce157a`

## Implementation steps

1. Open every verified source file listed above and identify the renderer, host lifecycle, styles, and assets before editing.
2. Copy the complete Sylva HTML file byte-for-byte to /landing-pages/inner-green-3d.html; do not extract, rewrite, shorten, or rebrand any section.
3. Preserve every embedded style, script, media payload, text string, interaction, responsive rule, and document-level lifecycle.
4. Keep every relative local asset at the exact path expected by the original document.
5. Load the local document in a full-size iframe whose permissions retain the authored forms, modals, downloads, popups, scripts, and same-origin resources.
6. Lazy-load only the React host bundle; do not import the complete HTML into the application JavaScript graph.
7. Give the local component a sized, overflow-controlled parent and verify desktop, mobile, reduced-motion, and context-loss behavior.

Asset handling: Copy inner-green-3d.html together with the four inner-green-assets files it needs — three.min.js, lexend-latin.woff2, card-ecostove.jpg, and card-ethos.jpg — at exactly those relative paths. Both liquid-metal controls are native buttons in the document, and the page makes no external network request.

## Local component example

Import the copied local component rather than a package entrypoint:

```tsx
import { SylvaHero } from "./effects/sylva-hero/SylvaHero";
import "./effects/sylva-hero/styles.css";

export function Scene() {
  return <div className="effect-frame"><SylvaHero /></div>;
}
```

## Core renderer pattern

This excerpt documents orchestration only. Copy the exact shader, geometry, pass, and interaction code from the verified source files.

```tsx
<LandingPageFrame title="Sylva" sourceUrl="/landing-pages/inner-green-3d.html" />
```

## Behavior contract

- Runtime: Full HTML + DOM/CSS + local Three.js
- Passes: 1 sandboxed full-document renderer
- Interaction: Original pointer, hover, scroll, and responsive scaling
- Assets: Four local assets are packaged at their authored relative paths; the page makes no external request
- **document** (fixed): Complete inner-green-3d.html with native in-document controls
- **sourceUrl** (fixed): /landing-pages/inner-green-3d.html
- **variant** (choice): Living Green | Sakura Sunset | Maple Autumn | Sequoia Mist
- **derived** (derived): The complete page with a scene transformation applied, its dock retoned, and frosted plates behind the two native controls
- **headingFont** (optional): Lexend | Instrument Serif | Newsreader | Geist
- **bodyFont** (optional): Lexend | Geist | Newsreader | Instrument Serif
- **headingWeight** (optional): 200 | 300 | 400 | 500 | 600
- **bodyWeight** (optional): 200 | 300 | 400 | 500
- **primaryColor** (optional): Hex color — the hero ink and the two tints derived from it
- **typography** (optional): Heading size 40–92u + body size + heading tracking, on the page's own design unit
- **layout** (responsive): Original full landing page inside the preview frame
- **interaction** (original): Scroll + pointer + hover
- **assets** (local): inner-green-assets kept at its authored relative path; no external request

## Verification

1. Compare the rendered composition, animation timing, pointer behavior, and state transitions with the source implementation.
2. Exercise resize, high-DPI, mobile/coarse-pointer, reduced-motion, tab visibility, and WebGL context-loss paths where applicable.
3. Confirm every animation frame, observer, listener, geometry, buffer, texture, framebuffer, material, and renderer is released on teardown.
4. Check the browser console and confirm the effect renders at native-or-better backing resolution.

## Guardrails

- Do not substitute a visually similar package, demo, shader, or runtime.
- Do not approximate, reconstruct, or simplify the authored GLSL, render passes, geometry, interaction state, or assets.
- Keep exact source and asset hashes under regression tests when the source project provides them.
- Adapt only the surrounding host boundary needed by the target project; keep renderer behavior intact.
