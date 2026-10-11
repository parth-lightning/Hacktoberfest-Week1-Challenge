# SRS phase status

This checklist records implementation status against Sections 11 and 13 of the
SRS. A phase is not marked complete solely because its UI or API endpoint
exists; acceptance work that requires an external account, reference data,
phone, or field walk is explicitly called out.

| Phase | Status | Implemented | Remaining acceptance / blocker |
| --- | --- | --- | --- |
| 0 — Foundations | Partial | React/TypeScript/Vite and Express workspace, shared Zod/geography core, `.env.example`, Apache-2.0 license, README and template map | No lint/format toolchain, Render deployment, or connected MongoDB acceptance. The SRS calls for Fastify; Express is intentionally retained by owner approval. |
| 1 — Hosted AI infrastructure | Partial (laptop only) | Local Ollama chat/embeddings/vision routes; Gemma and EmbeddingGemma were present and local Q&A returned a grounded demo answer | No hosted endpoint, TLS/bearer-token proxy, hosted fallback, droplet benchmark or vision evaluation. DigitalOcean is deliberately not assumed available. Local Q&A took about 32 seconds in one interactive test, over the SRS 8-second goal. |
| 2 — Pack builder | Partial | JSON-input CLI, local embeddings and story generation, grounding checks, required ElevenLabs generation/cache path, `.wildpack` hashes and schema example | No real data fetchers or reference trail, no 15-POI/30-species/150-chunk pack, no job/admin API, Spaces upload, hand review, or builder run. The current environment has no configured ElevenLabs credentials, which blocks generating a compliant real pack. |
| 3 — Catalog/offline desktop app | Partial | Demo/imported pack list, local IndexedDB, archive integrity verification, GPX sample, manifest, production static serving, and a service worker that precaches the build's hashed JS/CSS | The first airplane-mode check exposed uncached entry assets. The updated worker's cache contains the app shell and JS/CSS, but a final offline reload after that fix still needs confirmation. No real hosted catalog pack, resumable Range downloads/OPFS, or deployed HTTPS. |
| 4 — Guide runtime | Partial | Local geofence with accuracy/speed gates and cooldown, browser location, GPX replay, browser speech fallback, walk summary | No smoothing/hysteresis proof for out-and-back routes, wake lock/media-session/pocket mode, packaged real narration, one-hour real walk or battery test. |
| 5 — Local AI and voice Q&A | Partial | Local Ollama chat and embeddings, retrieval, transcript/citations, safety refusal, model status and latency | No offline Whisper, 20-question real-pack evaluation, 80% measured hit@5 result, <=8-second latency, or hosted fallback. |
| 6 — Field Agent | Partial | Image downscaling, local vision endpoint, candidate-list filtering, confidence cap, local journal and archive/CSV export | No 15-photo evaluation or iNaturalist import verification. No real species pack is available to test this workflow. |
| 7 — Open Proof and polish | Partial | Session report, external browser byte meter, location/schema protections, offline and error states, updated setup/limitations docs | No automated end-to-end privacy CI test or full screen-reader/accessibility audit. Local API request traffic and server-side TTS are not counted as external browser bytes. |
| 8 — Mobile PWA | Partial | Responsive/install metadata, service worker, offline shell, device geolocation code | No HTTPS deployment, phone install/device test, browser Gemma or Whisper, or client-side offline inference. Requires a target phone and deployed origin. |
| 9 — Field test/submission | Not complete | Synthetic desktop GPX replay and report export are available for preparation | Requires a real trail, phone, one-hour offline walk, at least 8 POI triggers, 5 spoken questions, 3 observations, battery/latency measurements, demo recording, and final human-reviewed submission. |

## Required owner inputs to close the remaining gates

1. A real trail/park the owner can walk and its allowed source data/attribution.
2. A rotated ElevenLabs key, chosen voice ID, and confirmation that the plan
   permits redistribution of generated audio. Put the key only in local
   `.env`; never send it in chat or commit it.
3. Target laptop hardware details (RAM/GPU) and, for Phase 8, a target Android
   phone with Chrome.
4. Fifteen representative, licensed/consented test photos and twenty
   hand-authored Q&A evaluation prompts for the real pack.
5. If deployment is desired: the Render configuration/permissions and any
   optional MongoDB URI. DigitalOcean credentials are not needed for the local
   path.

No live credentials are intentionally stored in the repository. Do not use the
synthetic builder fixture as field data.
