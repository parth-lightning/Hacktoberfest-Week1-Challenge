# WildPack

WildPack is a desktop-first, local-first trail-guide prototype. It stores imported
`.wildpack` files and observations in this browser, can replay synthetic GPX
routes, and can use Ollama on the same computer for pack-grounded questions.
The bundled demo route and its natural-history text are synthetic: they are not
a real trail, species record, or source of outdoor-safety advice.

The implementation follows the accompanying
[Software Requirements Specification](./WildPack%20Software%20Requirements%20Specification.md),
but not every phase or acceptance criterion is complete. The current status and
limitations are listed in the [phase-status checklist](./docs/phase-status.md).
DigitalOcean is not required for the local prototype.

## Run the laptop prototype

Requirements: Node.js 20.19+ or 22.12+, npm, and (for local model features)
[Ollama](https://ollama.com/).

```sh
npm install
ollama pull gemma3:4b
ollama pull embeddinggemma
npm run dev:all
```

Open `http://localhost:5173`. `dev:all` starts Vite on port 5173 and the Express
API on port 3001. The app can load its synthetic demo pack without credentials.
Local Q&A requires the Ollama service and both models above. The API's
`/api/health` response reports each service status; MongoDB is optional for this
local prototype.

To enable ElevenLabs narration generation or build a voiced pack, copy
`.env.example` to `.env` and set `ELEVENLABS_API_KEY` and
`ELEVENLABS_VOICE_ID`. Never put secrets in `VITE_*` variables, commit `.env`,
or paste live credentials into tracked files. TTS sends narration text to
ElevenLabs when requested; location is not included.

## Current capabilities

- Import and locally store integrity-checked `.wildpack` archives; the local
  builder creates packs from authored JSON, Ollama embeddings/story text, and
  required ElevenLabs audio.
- Browse the synthetic demo pack, replay its stops, import/replay GPX routes,
  and use browser geolocation when explicitly enabled. Coordinates are handled
  in the browser and are not sent to the API.
- Ask questions against pack passages using local Ollama; requests contain the
  question and retrieved text, not GPS coordinates. Safety/foraging questions
  receive a fixed refusal.
- Save private observation notes/photos in IndexedDB, export a local archive,
  and download an Open Proof session report.
- Installable PWA manifest and a registered service worker for the app shell and
  same-origin runtime resources. The API is deliberately not cached.

## Not yet complete or verified

- There are no real-region data fetchers (OSM, iNaturalist, GBIF, or Wikipedia),
  reviewed nature packs, hosted inference, or real-world field-test results.
- Offline speech recognition, in-browser Gemma, and actual audio narration
  while offline are not implemented/verified. Browser speech synthesis is a
  fallback and is not a substitute for the required packaged ElevenLabs audio.
- The camera/species workflow is a local-model prototype and has not been
  validated against a photo evaluation set.
- The journal export is Darwin Core-style, not verified against iNaturalist's
  current import workflow.
- MongoDB is only an optional health check. There is no admin-authored API,
  cloud pack hosting, resumable download, deployment configuration, or tested
  airplane-mode/mobile acceptance.
- Browser storage can be evicted. Export important packs and notes.

## Build a pack

Prepare a JSON input with `name`, `bbox` (`west`, `south`, `east`, `north`),
`pois` (IDs, names, types, `[longitude, latitude]` coordinates), `sources`
(IDs, titles, source text, optional URL/POI ID, and licence), optional
`species`, and source `attribution`. Every POI needs at least one source
passage, either linked with `poiId` or available pack-wide. Use accurately
licensed, reviewed content and real coordinates only for a real pack; do not
use the synthetic fixture as field data.

```sh
npm run build:pack -- --input samples/my-trail.json --out generated-packs
```

The builder uses the local Ollama service (`LLM_BASE_URL`,
`LLM_MODEL_HOSTED`, and `EMBED_MODEL` in `.env`) and requires ElevenLabs
credentials to voice every card. It writes `generated-packs/<slug>.wildpack`.
For a small builder run, append `--dev`. Check all generated cards and source
attribution before distributing a pack. `samples/demo-builder-input.json` is a
synthetic schema/example fixture with placeholder coordinates, not a usable
trail pack.

## Checks

```sh
npm run typecheck
npm run test:core
npm run build
```

For production-style local serving, build first and then run `npm start`; the
Express server serves `dist` when that directory exists.

## Architecture and deliberate deviation

```text
React + Vite PWA
  ├─ IndexedDB: imported packs and observation journal
  ├─ browser-only geofence / GPX simulation
  └─ Express API (localhost:3001)
       ├─ Ollama: local chat, embeddings, and vision
       ├─ ElevenLabs: online TTS only when explicitly requested
       └─ optional MongoDB health check
```

The SRS specifies Fastify, but the repository's Express server is retained as
previously approved. There is no cloud host dependency or DigitalOcean-specific
code path in the working local prototype.

## Privacy, safety, and licences

Location is kept in the browser and excluded from API requests. The optional
session report records whether browser geolocation was used, but does not
include coordinates. Exported observations include coordinates only when the
user explicitly enables them. Ollama calls are to localhost; ElevenLabs
receives text for explicit TTS generation. The app is not an emergency,
navigation, medical, or foraging tool. Leave wildlife undisturbed.

Code is licensed under Apache-2.0. Pack authors are responsible for verifying
source and audio licences and including required attribution. See
[the template map](./docs/template-map.md) for the implemented screens and
remaining SRS work, and the
[phase-status checklist](./docs/phase-status.md) for acceptance gates and the
inputs still needed from the project owner.

### Open and closed components

| Component | Status in this prototype | Notes |
| --- | --- | --- |
| Gemma 3 (`gemma3:4b`) | Local inference implemented | Open weights under Google's Gemma terms; not an OSI-approved open-source licence. |
| EmbeddingGemma | Local embeddings supported | Use subject to its model terms; availability depends on the local Ollama install. |
| ElevenLabs | Optional online TTS and required by the pack builder | Closed service; check current plan terms and redistribution rights before shipping audio. |
| OSM, iNaturalist, GBIF, Wikipedia | Not integrated as fetchers | No real-world data is currently bundled in the synthetic demo. |
| Whisper / browser Gemma | Not implemented | Offline transcription and in-browser model inference are unfinished. |

The desktop prototype is the supported target today. Mobile installation has
not been tested on a device; iOS Safari may restrict background geolocation,
audio playback, storage persistence, and WebGPU/model execution.
