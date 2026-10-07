# ThreeUI starter map

## What is in the repository today

The current app is a single-page React 18 application built with TypeScript and
Vite. It does not have a routing library or an application component library.
`src/site/App.tsx` composes the page, `src/site/styles.css` contains the page
styles, and `src/main.tsx` imports ThreeUI's stylesheet and mounts React.
`SylvaHero` is the only ThreeUI component currently used. Vite copies the
package's HTML and local assets into `public/landing-pages` for the hero.

The Express API lives in `server/index.ts`; Vite proxies `/api` to port 3001.
The current health route checks only that the API responds. The contact route
validates submissions but deliberately does not persist or email them.
The `packages/core` npm workspace now contains the initial Zod schemas for
pack manifests and geographic primitives, plus pure distance and bounding-box
area calculations.

## Planned screen mapping (SRS Section 5.9)

| Planned screen | Current starter surface | Work still required |
| --- | --- | --- |
| Catalog | No catalog; the starter has a marketing landing page | Replace product-card placeholder content with locally available pack metadata and distance sorting |
| Pack detail and download | None | Pack metadata, download progress/resume, integrity verification, and local storage |
| Readiness check | None | Check app shell, pack, local model, embeddings, STT, and offline self-test |
| Walk screen and pocket mode | Sylva hero is visual-only and is not a walk UI | Walk controls, geofence state, narration, GPX replay, and low-distraction pocket view |
| Q&A transcript | None | Local retrieval, Ollama integration, transcript, citations, and safety refusals |
| Camera and Field Agent result | None | Camera capture, constrained species suggestions, follow-up, and unverified-result labels |
| Observation journal | None | Local persistence and observation export |
| Walk summary | None | Local breadcrumb summary and session metrics |
| Open Proof | None | Mode, model, latency, network byte counts, and session export |
| Settings and privacy | None | Local preferences and an accurate disclosure of data leaving the device |
| Pack authoring and job progress | Contact form is unrelated and is not an authoring surface | Admin-protected builder UI, progress, and job status |

## Phase 0 decisions and constraints

- Preserve the ThreeUI/Sylva styling as the presentation starting point; do not
  treat the landing-page template as product functionality.
- Keep the existing Express API instead of migrating to the Fastify API named
  in the SRS. This deviation was approved by the owner.
- Keep product logic in `src/lib` and `src/hooks` as those layers are added.
- No MongoDB connection or external AI/storage service is configured yet.
- Do not send coordinates to any server. Desktop GPX replay is the planned
  primary way to test location-triggered behavior.
