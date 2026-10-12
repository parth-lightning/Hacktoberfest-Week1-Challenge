# WildPack implementation map

WildPack currently uses the repository's React 18, TypeScript, Vite, and
Express 5 stack. The SRS calls for Fastify, but the existing Express API is
retained as previously approved. The app is a desktop-first prototype; see the
README for setup, verified functionality, and limitations.

The ThreeUI `inner-green-3d.html` Sylva experience is restored as the root
landing page, inside a small responsive app-entry wrapper. `/app` renders the
WildPack product UI. The original ThreeUI files and styling are served as-is
from the installed package; the wrapper provides the product navigation
without replacing the template.

## Current product surfaces

| Screen | Current implementation | Important limitation |
| --- | --- | --- |
| Region packs | Synthetic demo pack plus `.wildpack` import, local storage, and integrity validation | No real-region catalog, hosting, or download/resume service |
| Walk guide | Browser geolocation, GPX replay, local geofence engine, stop progress, speech fallback | No real trail field test; GPX locations are synthetic/test input |
| Ask the guide | Pack-grounded retrieval and Ollama local chat; fixed safety refusal | No Whisper/offline STT or hosted fallback |
| Field notes | Camera/file photo entry and constrained local-vision candidate workflow | Not validated against a photo evaluation set |
| Observation journal | IndexedDB storage and local export | Darwin Core-style CSV is not verified with the current iNaturalist importer |
| Open Proof | Session metrics/export and fetch-byte accounting | Not a CI privacy test or field benchmark |
| Settings & privacy | Location/export settings and service disclosure | Browser storage persistence is best-effort |
| Build a pack | Local CLI using authored JSON, Ollama, and required ElevenLabs voice | No OSM/iNaturalist/GBIF/Wikipedia fetchers or reviewed reference pack |

## Main code locations

- `src/site/LandingPage.tsx` and `src/site/landing-page.css`: ThreeUI landing
  embed and WildPack entry action.
- `src/site/App.tsx` and `src/site/styles.css`: screens, controls, and
  responsive presentation.
- `src/lib/storage.ts`: IndexedDB pack/observation persistence.
- `src/lib/geofence.ts`: local geofence state machine and GPS quality gates.
- `src/lib/telemetry.ts`: browser network-byte accounting.
- `packages/core/src/`: Zod schemas, geography, archive validation, and
  retrieval/safety helpers.
- `packages/builder/src/cli.ts`: locally executed `.wildpack` pack builder.
- `server/index.ts`: Express routes for health, packs, Ollama, and TTS.
- `public/manifest.webmanifest` and `public/sw.js`: PWA metadata and offline
  app-shell/runtime caching.

## Runtime boundaries

- GPS coordinates and simulated GPX fixes are processed in the browser; they
  are not sent in requests to the local API.
- Ollama runs on localhost. Questions and retrieved pack passages are sent to
  that local process, not to a hosted inference provider.
- ElevenLabs is an online service and receives text only when narration is
  explicitly generated. Pack building requires its key and voice ID.
- MongoDB is optional and currently used only for health reporting.
- No DigitalOcean, Spaces, external pack hosting, or cloud inference is needed
  for the prototype.

## Remaining SRS gates

Real source ingestion and pack review, offline speech recognition, packaged
ElevenLabs audio in a real region pack, airplane-mode acceptance, complete
privacy request inspection in CI, evaluation sets, accessibility review,
mobile/on-device model validation, deployment, and a real field test remain
unverified or unimplemented. Do not describe the current prototype as passing
those criteria.
