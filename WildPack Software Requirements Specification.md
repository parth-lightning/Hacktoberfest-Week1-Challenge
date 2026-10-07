# WildPack: Software Requirements Specification

*Voice-first, offline-capable trail guide built on open-weight Gemma. Hacktoberfest Week 1, Touch Grass. Version 1.0. WildPack is a working name; rename freely.*

## 0. How to use this document (read first, agent)

1. Build in the phases of Section 11, in order. A phase is done only when its acceptance criteria pass.
2. Requirement IDs (FR-, NFR-, API-) are for commit messages and test names.
3. Priorities: **P0** must ship, **P1** should ship, **P2** stretch. Cut P2 first.
4. **VERIFY** means check current official docs before coding (model names and sizes, API limits, browser support). Do not rely on memory.
5. A threeui design template is already in the repo. It is the presentation layer only. Keep logic in `src/lib` and `src/hooks`, and adapt template components to the screens in Section 5.9. Do not rewrite the template styling.
6. Optimise for a working, demoable, honest product over a broad one. Everything must work with the network disabled unless marked ONLINE.
7. Never send the user's coordinates to any server (NFR-PRIV-1).

**v1.1 rules from the owner (these override anything below that conflicts):**

- **Desktop first.** Build, test, and demo everything on a laptop (browser app plus Ollama on localhost, no internet needed) before touching mobile. Mobile is Phase 8.
- **ElevenLabs is compulsory.** It voices every story card and ships inside each pack. It is not optional.
- **Everything must be free to use**, through a free tier or the Hacktoberfest partner credits the owner has claimed (DigitalOcean, Render, ElevenLabs). See Section 4.1 for the audit.
- **Do not change the stack without asking the owner first.** If something turns out to be paid or unavailable, stop and report it.

## 1. Introduction

### 1.1 Purpose

This document defines the requirements, architecture, data model, APIs, AI behaviour, and build plan for WildPack, so a coding agent can build it phase by phase with minimal ambiguity.

### 1.2 Product vision

Before a hike, the user downloads a **Region Pack** for a trail or park while on wifi. On the trail, with the phone in a pocket and no signal, WildPack narrates what is around them as GPS crosses points of interest, answers spoken questions grounded in the pack, and lets them photograph a plant, insect, or bird to get an ID suggestion that becomes a citizen-science observation they can export later. The screen is the shortest part of the experience.

### 1.3 Challenge alignment

| Brief says | WildPack answer |
| --- | --- |
| Open-weight model at the core | Gemma runs on-device (offline) and on a DigitalOcean GPU Droplet (hosted fallback and pack building) |
| Gets people off the screen | Audio-first, pocket mode, value only appears on the trail |
| Why open matters | Works with no internet, location never leaves the device, swappable models, near-zero running cost. All measured live in the Open Proof panel |
| Bonus: take it outside | Phase 9 field test with documented results, including what broke |

### 1.4 Scope

**In scope:** pack builder, pack catalog and download, a desktop-first web app that runs fully offline on a laptop, then the mobile PWA, GPS-triggered narration, voice Q&A with retrieval, field-observation slice (photo ID, follow-up question, journal, export), Open Proof panel, deployment.

**Out of scope:** native apps, social feeds, payments, multiplayer, any advice about eating or using plants, mushrooms, or wildlife. The app must carry a clear disclaimer and refuse such questions.

### 1.5 Definitions

- **Region Pack (.wildpack):** a single downloadable file holding everything needed to guide a walk offline for one area.
- **POI:** point of interest (viewpoint, peak, historic site, water body, notable tree, geological feature).
- **Chunk:** a 200 to 400 token passage of source text with metadata, embedded for retrieval.
- **Story Card:** a 60 to 90 word spoken-style narration for one POI, generated at build time and grounded in chunks.
- **Geofence:** circular trigger zone around a POI.
- **Local mode:** all inference on the device. **Hosted mode:** inference on the DO droplet. **Open Proof:** the panel proving which mode ran and what left the device.

## 2. Users and scenarios

**Personas:** Hiker (primary), Family or curious beginner, Pack Author (a teacher, naturalist, or club leader who builds a pack for their own trail).

| ID | Scenario |
| --- | --- |
| S1 | On wifi, the hiker picks a pack, downloads it, and runs the readiness check. |
| S2 | On the trail, narration plays automatically as they pass POIs. Screen is off or dimmed. |
| S3 | In a dead zone, they ask by voice: what is that bird call, or why is this rock dark. They hear a grounded answer. |
| S4 | They photograph a plant. The app suggests an ID from species known in this region and asks one follow-up question. |
| S5 | At home, they export observations for iNaturalist. |
| S6 | An author runs one command or form to build a pack for another trail. |

## 3. System overview

```
[Pack Author] -> Render (web + API) -> MongoDB Atlas (packs, pois, chunks, species, jobs)
                      |
                      +--> DO GPU Droplet: Ollama or vLLM serving Gemma + embeddings + builder jobs
                      +--> DO Spaces + CDN: .wildpack files, audio cache
                      +--> ElevenLabs (ONLINE only, via server proxy)

[Hiker PWA] <-- pack download (Range, resumable) -- Spaces CDN
  PWA runtime: Service Worker, IndexedDB/OPFS, local Gemma (WebGPU), Whisper-tiny STT,
  in-memory vector search, geofence engine, media session, observation journal
```

**Mode selection logic:** default is Local when the local model is loaded. If the device cannot run the local model and the network is up, use Hosted. The user can force a mode in Settings. Whatever mode ran is shown in Open Proof.

**Desktop-first rule (v1.1):** build and prove the whole product on a laptop first: the app runs in the laptop browser and talks to Ollama on localhost with no internet. Mobile starts only after the laptop version passes its acceptance tests. If in-browser Gemma later proves unworkable on a phone, the laptop version stays the shipped offline story. The brief literally lists a laptop with no internet as a valid story. Do not silently fake offline.

## 4. Technology stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Frontend | React PWA using the framework of the threeui template, TypeScript | Service worker via Workbox or equivalent |
| API | Node.js 20, TypeScript, Fastify | Render Web Service |
| Builder | Node/TS package with CLI | Runs on the DO droplet (needs GPU access) and from CLI |
| Database | MongoDB Atlas, 2dsphere indexes, Atlas Vector Search | Used at build time and by hosted fallback only |
| Hosted LLM | Gemma on DO GPU Droplet via Ollama (OpenAI-compatible /v1) or vLLM | VERIFY newest Gemma tags and which have vision |
| On-device LLM | Smallest current Gemma with image input (Gemma 3n E2B class) via MediaPipe LLM Inference or WebLLM / transformers.js | VERIFY availability and download size |
| Embeddings | EmbeddingGemma, fallback all-MiniLM-L6-v2. Same model in builder and client | VERIFY a browser (ONNX) build exists |
| STT | Whisper tiny/base via transformers.js, runs offline | Open model |
| TTS (compulsory) | ElevenLabs through server proxy | Closed service, compulsory. Free tier or Hacktoberfest credits |
| TTS offline | Pre-generated MP3 in pack, plus browser speechSynthesis for dynamic answers | Stretch: Piper via WASM |
| Open data | OpenStreetMap Overpass, iNaturalist API, GBIF, Wikipedia/Wikidata | Respect rate limits and licences |
| Storage | DO Spaces + CDN | Range requests enabled |
| Hosting | Render (web + API), DigitalOcean (GPU, Spaces) |  |

**Open vs closed disclosure (put this in the README and the post):** Gemma, Whisper, EmbeddingGemma, OSM, iNaturalist, GBIF are open. ElevenLabs is closed but compulsory: it voices every story card at build time and the MP3s ship inside the pack, so narration still works offline. Gemma is open-weight under Google's terms of use, not an OSI licence; say so accurately.

### 4.1 Cost and licence audit (everything must be free to use)

Checked against current pricing pages on October 7, 2026. Re-verify amounts and credit expiry before relying on them.

| Component | Cost | Open source? | Notes |
| --- | --- | --- | --- |
| Gemma, EmbeddingGemma | Free | Open weights under Gemma terms, not OSI | Run locally through Ollama |
| Whisper, Ollama, vLLM, transformers.js, Fastify, React, zod, fflate, Playwright | Free | Yes (MIT or Apache style licences) | No concerns |
| OpenStreetMap, iNaturalist, GBIF, Wikipedia | Free | Open data | Attribution required (Section 17) |
| MongoDB Atlas | Free M0 tier, 512 MB, no time limit | No (server is source-available) | Holds builder output only. Packs carry their own data to clients |
| Render | Free tier or claimed credits | No | Free web services sleep after 15 minutes idle and share 750 free hours per month. Use credits for an always-on instance on demo day |
| DigitalOcean GPU Droplet | Paid, covered by claimed Hacktoberfest credits | n/a | List prices (July 2026): RTX 4000 $0.76/hr, L40S $1.57/hr, MI300X $1.99/hr, H100 $3.39/hr. Stop it when idle |
| DigitalOcean Spaces | Paid, $5 per month base, covered by credits | n/a | Stores .wildpack files and audio cache. If credits do not cover it, fall back to Render static hosting or GitHub Releases, but ask the owner first |
| ElevenLabs | Free tier is 10,000 characters per month, non-commercial with attribution. Claimed credits cover more | No | Compulsory. A full pack of 40 cards of about 500 characters is roughly 20,000 characters, so use credits for final builds and cap dev builds at about 10 POIs. Cache every clip by hash |

Credits the owner has confirmed as claimable: DigitalOcean, Render, ElevenLabs. Track remaining balances in `docs/credits.md`.

## 5. Functional requirements

### 5.1 Pack Builder

| ID | Pri | Requirement |
| --- | --- | --- |
| FR-PB-1 | P0 | Author supplies a name and either a bounding box or center plus radius. Enforce a max area (suggest 15 km2) to keep packs small. |
| FR-PB-2 | P0 | Fetch data: Overpass (paths, peaks, viewpoints, water, historic, natural features), iNaturalist research-grade species counts with a 12-month histogram, GBIF as fallback, Wikipedia geosearch articles inside the bbox, optional author-uploaded markdown notes. Cache raw responses on disk. Use polite delays and a custom User-Agent. |
| FR-PB-3 | P0 | Normalise into POIs (point, name, type, source id), Species, and Knowledge documents. |
| FR-PB-4 | P0 | Chunk text into 200 to 400 tokens. Each chunk carries poiId (if any), source title, URL, and licence. |
| FR-PB-5 | P0 | Embed every chunk with the configured embedding model. Store dim and model name in the manifest. |
| FR-PB-6 | P0 | Per POI (cap 40, ranked by priority) generate a Story Card with hosted Gemma using only that POI's chunks plus seasonally relevant species. Run the grounding validator (Section 9.3). Regenerate once on failure, then fall back to a plain templated card. |
| FR-PB-7 | P0 | ElevenLabs is compulsory: synthesise every Story Card to MP3 and bundle it in the pack, cached by sha256 of text + voice + model. The build fails fast with a clear message if ELEVENLABS\_API\_KEY is missing or credits run out. A dev flag may cap the build at about 10 POIs to save credits, but the shipped pack must contain real ElevenLabs audio for every card. |
| FR-PB-8 | P0 | Assemble the .wildpack file (Section 7), compute hashes, upload to Spaces, and write the pack record with status ready. |
| FR-PB-9 | P1 | Job progress available via polling (and SSE if time). |
| FR-PB-10 | P1 | CLI: `npx wildpack build --name <n> --bbox <w,s,e,n>` runs the same pipeline with no UI, so anyone can fork and build their own pack. |
| FR-PB-11 | P2 | Hindi and Marathi story cards and ElevenLabs multilingual voices. |

### 5.2 Catalog and delivery

| ID | Pri | Requirement |
| --- | --- | --- |
| FR-PC-1 | P0 | List all packs (the list is small). The client sorts by distance locally, so no coordinates are sent. |
| FR-PC-2 | P0 | Download with progress, resume via HTTP Range, and sha256 verification. |
| FR-PC-3 | P1 | Pack versioning and an update-available indicator. |

### 5.3 Offline PWA

| ID | Pri | Requirement |
| --- | --- | --- |
| FR-OF-1 | P0 | Installable (manifest, icons). Service worker precaches the app shell. The app opens in airplane mode. |
| FR-OF-2 | P0 | Pack contents stored in IndexedDB (structured data) and OPFS or Cache Storage (audio, model weights). Call `navigator.storage.persist()` and show quota usage. |
| FR-OF-3 | P0 | Model download manager: user-triggered, shows sizes, recommends wifi, verifies integrity, resumable. |
| FR-OF-4 | P0 | **Readiness check screen:** green only when pack, local model, embeddings, and STT are all cached and a self-test query succeeds with the network off. |
| FR-OF-5 | P1 | Queue for observation sync or export that survives restarts. |

### 5.4 Guide runtime

| ID | Pri | Requirement |
| --- | --- | --- |
| FR-GR-1 | P0 | Start a walk: choose pack, mode, voice. Acquire Wake Lock, set Media Session metadata. |
| FR-GR-2 | P0 | `watchPosition` with high accuracy. Discard fixes with accuracy worse than 50 m. Light smoothing. |
| FR-GR-3 | P0 | Geofence engine using Haversine distance. Default radius 40 m (viewpoints 60 m). Hysteresis to prevent flapping, a per-session played set, 20 s cooldown between narrations, queue max 2, priority by type then distance, suppress above 2.5 m/s (configurable). |
| FR-GR-4 | P0 | Playback order: pre-generated ElevenLabs MP3 from the pack (always present), then live ElevenLabs streaming for dynamic answers when online, and only then `speechSynthesis` as an error fallback. |
| FR-GR-5 | P1 | Optional one-sentence live enrichment from local Gemma using month, time of day, and species likely this month (from pack data). Skip if not ready within 6 s. |
| FR-GR-6 | P0 | Controls: pause, skip, repeat, what is around me (nearest 3 POIs), volume. Headset buttons via Media Session. |
| FR-GR-7 | P0 | Breadcrumb trail stored locally only. End-of-walk summary: distance, POIs heard, species logged. |
| FR-GR-8 | P1 | Vibrate on new POI where supported. |
| FR-GR-9 | P0 | **GPX replay simulator** to test and demo without walking. |

### 5.5 Voice Q&A (retrieval-augmented)

| ID | Pri | Requirement |
| --- | --- | --- |
| FR-QA-1 | P0 | Push-to-talk (large button, also bindable to a headset button). Local Whisper transcribes. |
| FR-QA-2 | P0 | Embed the query locally. Cosine search top-5 in memory over the pack. Boost chunks tied to POIs within 300 m of the user (location used on-device only). |
| FR-QA-3 | P0 | Prompt Gemma with the system prompt, retrieved chunks, nearest POI name, and current month. Answer in 60 words or fewer, cite chunk ids, and say I don't know when the context lacks the answer. |
| FR-QA-4 | P0 | Speak the answer and show a transcript card. Use ElevenLabs when online. Dynamic answers cannot be pre-generated, so when offline use speechSynthesis and say so in Open Proof. |
| FR-QA-5 | P0 | Hosted fallback: if no local model and online, POST question plus retrieved chunk texts (no coordinates) to the API. |
| FR-QA-6 | P0 | Safety: refuse edibility, medicinal, and foraging questions with a fixed message. Wildlife safety answers come from curated static text, not generation. |
| FR-QA-7 | P1 | Log latency per stage (STT, retrieval, first token, total) for Open Proof. |

### 5.6 Field Agent (slice of the observation idea)

| ID | Pri | Requirement |
| --- | --- | --- |
| FR-FA-1 | P0 | Capture a photo through the camera input. Downscale to 1280 px longest side. |
| FR-FA-2 | P0 | Inject the pack's species list (names only, top \~150 by regional frequency and current month) into the prompt. The model must choose from the list or answer unknown. This cuts hallucination and is the key quality lever. |
| FR-FA-3 | P0 | Model returns strict JSON (Section 9.2). Validate with zod. One automatic repair attempt, else show Not sure. |
| FR-FA-4 | P0 | Speak the follow-up question that makes the user look closer (for example count the petals). Accept a voice answer and re-rank candidates. |
| FR-FA-5 | P0 | Save the observation locally: photo, timestamp, coordinates (exact or obscured to 0.1 degrees, user choice), model name, confidence, user confirmation. |
| FR-FA-6 | P0 | Export a zip containing the photos and a CSV in Darwin Core style. VERIFY iNaturalist's bulk-import column format and match it. |
| FR-FA-7 | P1 | Direct upload to iNaturalist via OAuth. |
| FR-FA-8 | P0 | Label every result as an AI suggestion, unverified. |
| FR-FA-9 | P2 | Bird-call audio ID. Only attempt if Phase 6 finishes early. |

### 5.7 Open Proof panel (the differentiator)

| ID | Pri | Requirement |
| --- | --- | --- |
| FR-OP-1 | P0 | Live badge: mode, model name and size, backend (WebGPU or WASM), tokens per second, last latency. |
| FR-OP-2 | P0 | Network meter: bytes sent and received this session, counted via a fetch wrapper and PerformanceObserver. Shows 0 B in a fully local session. |
| FR-OP-3 | P1 | Cost estimator: tokens used multiplied by configurable closed-API prices, versus zero for local. Constants live in config and are labelled as assumptions. |
| FR-OP-4 | P1 | Model swap: pick between available models and run the same question side by side. |
| FR-OP-5 | P0 | Export a session report as JSON for screenshots and the submission post. |

### 5.8 Accounts, privacy, settings

| ID | Pri | Requirement |
| --- | --- | --- |
| FR-AC-1 | P0 | No login for hikers. A random device id is stored locally. Authoring endpoints are protected by an admin key from env. |
| FR-AC-2 | P0 | Settings: ElevenLabs voice choice, narration verbosity, trigger radius, units, language, location precision for exports, forced mode. |
| FR-AC-3 | P0 | Privacy screen stating exactly what leaves the device in each mode. |

### 5.9 Screens (map these onto the threeui template)

1. Catalog (packs sorted by distance)
2. Pack detail and download
3. Readiness check
4. Walk screen: big status, current POI, giant mic button, pause, skip, and a **pocket mode** (near-black, minimal)
5. Q&A transcript
6. Camera and Field Agent result
7. Observation journal
8. Walk summary
9. Open Proof
10. Settings and privacy
11. Author: create pack and job progress (admin only)

### 5.10 Platform requirements (desktop first)

| ID | Pri | Requirement |
| --- | --- | --- |
| FR-PL-1 | P0 | Phases 0 to 7 target a laptop: Chrome or Edge on Windows, macOS, or Linux, app served from localhost, Ollama on localhost, no internet needed after setup. |
| FR-PL-2 | P0 | Laptop geolocation is coarse (Wi-Fi based), so the GPX replay simulator is the primary driver for desktop testing and demos. Browser geolocation stays wired in for the mobile phase. |
| FR-PL-3 | P0 | Microphone through getUserMedia and speaker through normal audio output. Push-to-talk works from the spacebar as well as a button. |
| FR-PL-4 | P0 | One codebase: layouts are responsive and logic lives in `src/lib`, so the same app becomes the mobile PWA in Phase 8 without rewrites. |
| FR-PL-5 | P0 | One command starts everything locally (app, API, Ollama health check). Document it in the README. |
| FR-PL-6 | P1 | Open Proof shows detected laptop specs (RAM, and GPU if exposed) and which model size fits. |

## 6. Data model (MongoDB Atlas)

Mongo is used at build time and by the hosted fallback. The hiker's phone never queries Mongo on the trail. Observations and breadcrumbs stay on the device.

| Collection | Key fields | Indexes |
| --- | --- | --- |
| `packs` | slug, name, description, center (GeoJSON Point), bbox, status (queued, building, ready, failed), version, sizeBytes, sha256, fileUrl, poiCount, speciesCount, embeddingModel, embeddingDim, llmModelUsed, languages, attribution\[\], createdAt, updatedAt | unique slug, 2dsphere on center |
| `pois` | packId, name, type, location (GeoJSON Point), radiusM, sourceId, priority, storyCard {text, sources\[\], audioHash, wordCount, validated}, tags | packId, 2dsphere on location |
| `chunks` | packId, poiId (optional), text, source {type, title, url, license}, tokenCount, embedding\[\], seasonMonths\[\] | packId, Atlas Vector Search index on embedding with packId as a filter field |
| `species` | packId, taxonId, commonName, scientificName, group (plant, bird, insect, fungi, other), observationCount, monthHistogram\[12\], summary, photoAttribution | packId, group |
| `jobs` | packId, type, status, progress (0 to 100), stage, log\[\], error, createdAt, finishedAt | status, createdAt |
| `audio_cache` | hash (\_id), storageKey, bytes, voiceId, model, createdAt | none beyond \_id |

All documents carry `createdAt`. Use zod schemas in `packages/core` as the single source of truth and derive TypeScript types from them.

## 7. Region Pack file format (.wildpack)

A zip archive (use fflate in the client).

```
manifest.json        formatVersion, packId, slug, name, version, createdAt, bbox, center,
                     embeddingModel, embeddingDim, counts, files{path: sha256}, attribution[]
pois.geojson         FeatureCollection of POIs with radius and priority
cards.json           story cards keyed by poiId, with audio file reference if present
chunks.jsonl         one JSON per line: id, poiId, text, source
embeddings.f16.bin   N x dim float16, same order as chunks.jsonl (client converts to Float32)
species.json         species list with month histograms and short descriptions
audio/<hash>.mp3     mono, about 64 kbps
ATTRIBUTION.md       required credits for OSM, iNaturalist, Wikipedia and others
```

**Size targets:** at most 10 MB without audio, at most 60 MB with audio. The client must verify every file hash against the manifest before marking the pack ready.

## 8. API specification

All errors use `{ "error": { "code": "...", "message": "..." } }`. Validate every body with zod. Rate-limit public routes per IP.

**Public**

| ID | Route | Behaviour |
| --- | --- | --- |
| API-1 | `GET /api/health` | Returns status of API, Mongo, and LLM droplet (without exposing addresses). |
| API-2 | `GET /api/packs` | All ready packs with metadata. No coordinates accepted. |
| API-3 | `GET /api/packs/:slug` | Pack detail. |
| API-4 | `GET /api/packs/:slug/download` | 302 to the Spaces/CDN URL. Must support Range. |
| API-5 | `POST /api/ask` | Body: packSlug, question, chunks\[{id,text}\], month, poiName. Returns answer, citations\[\], model, latencyMs. Hosted fallback only. No coordinates. |
| API-6 | `POST /api/vision` | Body: image (base64, max 1.5 MB), candidates\[\] (species names). Returns the strict JSON from Section 9.2. |
| API-7 | `POST /api/tts` | Body: text (max 600 chars), voiceId optional. Streams audio/mpeg. Cached by hash. Strict rate limit, because it spends credits. |

**Admin (header `x-admin-key`)**

| ID | Route | Behaviour |
| --- | --- | --- |
| API-8 | `POST /api/admin/packs` | Body: name and bbox, or center plus radiusKm, plus options. Returns packId and jobId. |
| API-9 | `GET /api/admin/jobs/:id` | Status, stage, progress, log tail. |
| API-10 | `POST /api/admin/packs/:id/rebuild` | Re-run the pipeline. |
| API-11 | `DELETE /api/admin/packs/:id` | Remove pack record and files. |

**LLM droplet:** the API talks to an OpenAI-compatible endpoint (`LLM_BASE_URL`, `LLM_API_KEY`). Wrap it in a small provider interface so the model name and backend can change by config only. That is itself an open-weight selling point.

## 9. AI specification

### 9.1 Models and roles

| Role | Where | Model |
| --- | --- | --- |
| Story cards, hosted Q&A, hosted vision | DO droplet | Largest Gemma that fits the GPU (VERIFY tags, vision support) |
| On-device Q&A and vision | Phone/laptop browser | Smallest current Gemma with image input (VERIFY) |
| Embeddings | Builder and client | EmbeddingGemma, fallback MiniLM |
| Speech to text | Client | Whisper tiny or base |
| Speech | Server (online), client (offline) | ElevenLabs, pre-generated MP3, speechSynthesis |

### 9.2 Prompts and schemas

**Story card (builder).** System: You are a warm, precise nature and heritage guide narrating to a walker wearing earbuds. Use ONLY the SOURCE passages provided. If a fact is not in them, do not say it. Write 60 to 90 words, spoken style, no lists, no emojis, no markdown. End with one thing to look at right now. Never advise eating or touching plants, fungi, or animals. User: POI name and type, month, SOURCE passages with ids, species likely this month. Output JSON: `{ "text": string, "usedSourceIds": string[] }`. Temperature 0.3.

**Voice Q&A (client or hosted).** System: You answer questions for a hiker using ONLY the CONTEXT passages. Maximum 60 words. If the context does not contain the answer, say you do not know and suggest what to look at instead. Cite passage ids in `citations`. Refuse edibility, medicinal, and foraging questions. Output JSON: `{ "answer": string, "citations": string[] }`. Temperature 0.2.

**Vision (Field Agent).** System: You help identify a living thing in a photo. Choose ONLY from CANDIDATES or answer unknown. Describe visible traits first. Output strict JSON:

```
{ "candidates": [ { "commonName": string, "scientificName": string,
                   "confidence": number (0-1), "visibleTraits": string[] } ],
  "observedTraits": string[],
  "followUpQuestion": string,
  "needsBetterPhoto": boolean }
```

Maximum 3 candidates. The follow-up question must be answerable by looking closely (count, colour, shape, location on plant). Temperature 0.2.

### 9.3 Guardrails

- **Grounding validator (builder):** every capitalised proper noun and number in a story card must appear in the cited source chunks, otherwise the card fails and is regenerated once.
- **Candidate constraint:** if a returned species is not in the candidate list, drop it. If nothing remains, show Not sure.
- **Confidence honesty:** cap displayed confidence at 0.85, and always show the unverified label.
- **JSON handling:** parse, validate with zod, one repair attempt, then fail gracefully with spoken apology.
- **Refusals:** fixed text for edibility and medical questions. Never generated.

### 9.4 Evaluation (do this, it feeds the post)

- 20 hand-written questions per reference pack with expected chunk ids. Record retrieval hit@5.
- 15 test photos for the field agent. Record top-1 and top-3 correct, schema validity, and latency.
- Record numbers for local versus hosted. Publish them honestly, including failures.

## 10. Non-functional requirements

| ID | Requirement |
| --- | --- |
| NFR-PRIV-1 | No request from the client may contain latitude or longitude. An automated test replays a GPX walk and asserts the network log contains no coordinates. No third-party analytics or fonts loaded at runtime. |
| NFR-PERF-1 | App shell loads offline in 3 s or less. Narration starts within 2 s of geofence entry. |
| NFR-PERF-2 | Local Q&A first spoken word within 8 s on the target device (measure and report real numbers). Hosted Q&A within 3 s. |
| NFR-BAT-1 | Load models lazily and never run continuous inference while walking. Measure battery drain over a 1 hour session and report it honestly. |
| NFR-REL-1 | Every feature degrades gracefully: no ElevenLabs falls back to speechSynthesis, no local model falls back to hosted or shows a clear message, GPS loss pauses triggers with a spoken notice. |
| NFR-A11Y-1 | Audio-first with captions for every spoken line, large touch targets, works with screen reader. |
| NFR-SEC-1 | Secrets only in server env. Admin key on authoring routes. CORS locked to the app origin. Droplet reachable only with a bearer token over TLS. Input size limits everywhere. |
| NFR-COMP-1 | Primary target Chrome on Android. Desktop Chrome and Edge for the laptop story. iOS Safari is best effort. Document known iOS limits (background geolocation, WebGPU) in the README instead of hiding them. |
| NFR-COST-1 | Everything must be free to use: free tiers or the claimed Hacktoberfest credits (DigitalOcean, Render, ElevenLabs). Track credit burn per service in docs/credits.md, shut the GPU droplet down when idle, and cache ElevenLabs audio so no text is synthesised twice. |
| NFR-OBS-1 | Structured logs with no personal data. Per-stage latency recorded for AI calls. |

## 11. Phased build plan

Order is desktop first (Phases 0 to 7 on a laptop), then mobile (Phase 8), then the field test (Phase 9). Week 1 of the challenge was listed as October 5 to October 11, so confirm the deadline on the challenge page and plan backwards. If time is short, ship Phases 0 to 7 and describe mobile as next steps. If time runs short, cut in this order: P2 items, Open Proof model swap, live enrichment, direct iNaturalist upload, local vision (keep hosted vision).

### Phase 0: Foundations (0.5 day)

**Goal:** a deployable skeleton.

1. Audit the threeui template. Note its framework, routing, and component library. Write a short `docs/template-map.md` mapping template pages to the screens in Section 5.9.
2. Set up the monorepo from Section 12 with TypeScript, ESLint, Prettier, and a shared `packages/core` for zod schemas and geo utilities.
3. Create accounts and resources: MongoDB Atlas cluster, Render service, DigitalOcean project, ElevenLabs key. Request DO GPU access **today**, since quota can take time.
4. Add `.env.example`, Apache-2.0 LICENSE, and a README skeleton.
5. Deploy hello world to Render with `/api/health`.

**Acceptance:** Render URL serves the template app. `/api/health` reports Mongo connected.

### Phase 1: Hosted AI infrastructure (0.5 to 1 day)

**Goal:** Gemma reachable from the API, first locally through Ollama on the laptop (free), then on a DigitalOcean droplet funded by credits.

1. Laptop first: install Ollama, pull the chosen Gemma and the embedding model, and point LLM\_BASE\_URL at localhost. Phases 2 to 7 must pass against this endpoint. Then, using the claimed DigitalOcean credits, provision the GPU Droplet (or, if GPU is unavailable, a CPU droplet with a small quantised Gemma, slower but enough for the builder).
2. Install Docker and Ollama (or vLLM). Pull the chosen Gemma and the embedding model. VERIFY tags.
3. Put Caddy in front with TLS and a bearer token. Firewall everything except 80 and 443 and SSH from your IP.
4. Build `packages/core/llm` with a provider interface: `chat`, `chatJson`, `vision`, `embed`. Config-only model switching.
5. Benchmark tokens per second and time to first token. Record in `docs/benchmarks.md`.
6. Set a billing alert and a script to stop the droplet.

**Acceptance:** from Render, one chat call, one embedding call, and one vision call with a sample image all return correctly.

### Phase 2: Pack Builder (1.5 days)

**Goal:** build one real pack end to end.

1. Pick a **reference region you can physically walk** (a local hill or park, small enough for a 1 to 2 hour walk). Record its bbox in `samples/`.
2. Implement fetchers with disk caching and polite rate limits: Overpass, iNaturalist, GBIF fallback, Wikipedia geosearch.
3. Normalise to POIs, species, and knowledge docs. Rank POIs by priority (viewpoint, peak, historic, water, then others).
4. Chunker, then embedder, then write chunks and vectors to Mongo and to the pack.
5. Story card generator, then grounding validator, then fallback templated card.
6. ElevenLabs step with hash cache. Skip cleanly when no key.
7. Assembler: build the zip, hashes, manifest, ATTRIBUTION.md. Upload to Spaces.
8. Job runner with progress, admin endpoints API-8 to API-11, and the CLI (FR-PB-10).
9. Hand-read at least five story cards and fix prompt problems.

**Acceptance:** reference pack builds in under 15 minutes with at least 15 POIs, 30 species, and 150 chunks. Manifest hashes verify. At least 90 percent of cards pass the validator. Pack size within targets.

### Phase 3: Catalog and offline desktop web app (1 day)

**Goal:** run the desktop web app on localhost, load the pack, and reopen both with the network off. Use a service worker and IndexedDB so the same code becomes the mobile PWA later.

1. Catalog and detail screens using template components, API-2 to API-4.
2. Download manager with Range resume and sha256 verify. Unzip with fflate. Store in IndexedDB and OPFS.
3. Service worker precache. Manifest and icons. Request persistent storage.
4. Partial Readiness check (app shell and pack).
5. Deploy the app to Render with the claimed credits so the mobile phase can install it later.

**Acceptance:** with the network off the app still opens in the laptop browser, and the pack loads and lists POIs on a map or list.

### Phase 4: Guide runtime (1 day)

**Goal:** a GPS-driven narrated walk.

1. Geolocation hook with accuracy filter and smoothing.
2. Geofence engine as a pure, unit-tested module (hysteresis, cooldown, priority queue, speed gate).
3. GPX replay simulator and a sample GPX of the reference trail. On desktop this is the primary driver, since laptop geolocation is coarse.
4. Narration player: pack audio, then speechSynthesis, plus ElevenLabs streaming when online.
5. Wake Lock, Media Session, vibration, pocket mode screen.
6. Walk summary with local breadcrumb.

**Acceptance:** GPX replay triggers the expected POIs in order, no duplicates, none during the speed gate. Unit tests pass. Works with the network off.

### Phase 5: Local AI and voice Q&A (1.5 days)

**Goal:** ask questions in a dead zone.

1. Call local Gemma through Ollama on the laptop (the in-browser runtime is deferred to Phase 8). Show model status and latency.
2. Client embedding model and in-memory vector search over the pack with the proximity boost.
3. Whisper STT with push-to-talk.
4. Q&A prompt, JSON parsing, safety refusals, spoken answer and transcript card.
5. Hosted fallback via API-5. Mode selector.
6. Per-stage latency logging.
7. **Decision gate:** this gate moved to Phase 8. In this phase, local inference means Ollama on the laptop.
8. Full Readiness check (FR-OF-4).

**Acceptance:** with the network off, the eval set reaches at least 80 percent retrieval hit@5 and answers start within the NFR-PERF-2 target on the laptop. Hosted fallback also works.

### Phase 6: Field Agent slice (1 day)

**Goal:** photo to grounded ID to exportable observation.

1. Camera capture and downscale.
2. Vision call (hosted first, local if Phase 5 went well) with the candidate species list.
3. zod validation, repair, drop-unknown-candidate logic.
4. Follow-up question spoken, voice answer re-ranks.
5. Local journal in IndexedDB and journal screen.
6. Export zip with CSV. Check the CSV against iNaturalist's current import format.

**Acceptance:** 15 test photos run. Schema validity 100 percent. Export file imports into iNaturalist without manual column fixes (or documented exceptions).

### Phase 7: Open Proof and polish (0.5 to 1 day)

1. Open Proof panel and network meter, session export.
2. Privacy test (NFR-PRIV-1) in CI or as a script.
3. Error and offline states for every screen. Spoken feedback for failures.
4. README: one-command quickstart, architecture diagram, open versus closed table, how to build your own pack.
5. Accessibility pass and a final template styling pass.

**Acceptance:** all P0 requirements verified against Section 13. A fresh clone builds a pack from the README alone.

### Phase 8: Mobile PWA and on-device AI (1 day, only after Phases 0 to 7 pass on the laptop)

**Goal:** the same app, installed on a phone, working in airplane mode.

1. Responsive and touch pass: large controls, pocket mode, audio-first flow.
2. Verify manifest, service worker, and HTTPS on the Render URL. Install on the phone.
3. Wire browser geolocation to the geofence engine and test with a real walk near home.
4. On-device Gemma in the browser (MediaPipe or WebLLM; VERIFY runtime, size, and phone support). Show download progress and cache weights.
5. Whisper in the browser for offline speech input, and client-side embeddings matching the builder's embedding model.
6. **Decision gate:** if on-device Gemma is too slow or too large on the target phone, either keep the phone as a thin client over the hosted endpoint (online only) or run the field test with the laptop. Say which in the post.
7. Run the full readiness check (FR-OF-4) on the phone.

**Acceptance:** the installed PWA opens in airplane mode, the pack loads, narration triggers on a real walk, and either on-device Q&A answers offline or the fallback is documented.

### Phase 9: Field test and submission (1 day)

1. Run the field checklist (Section 15) on the real trail with airplane mode on.
2. Record the walk and the dead-zone moment. Note what broke.
3. Capture Open Proof exports, battery drain, latency, and cost numbers.
4. Write the post and film a 90 second demo.
5. Final deploy, tag a release, then stop the GPU droplet unless judges need it live.

## 12. Repository layout and environment

```
/apps/web          PWA built on the threeui template
/apps/api          Fastify API
/packages/core     zod schemas, geo utils, pack format, LLM provider interface
/packages/builder  pack builder and CLI
/infra             droplet setup scripts, docker-compose, Caddyfile, render.yaml
/samples           GPX files, test photos, eval sets, reference bbox
/docs              template-map, benchmarks, field-test log
```

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | Atlas connection string |
| `LLM_BASE_URL`, `LLM_API_KEY` | Droplet OpenAI-compatible endpoint and bearer token |
| `LLM_MODEL_HOSTED`, `EMBED_MODEL` | Model names, config-only swap |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Online TTS (optional) |
| `SPACES_KEY`, `SPACES_SECRET`, `SPACES_BUCKET`, `SPACES_REGION`, `CDN_BASE_URL` | Pack and audio storage |
| `ADMIN_KEY` | Authoring routes |
| `ALLOWED_ORIGIN` | CORS |
| `INAT_USER_AGENT` | Contact string for polite API use |

Never commit secrets. Only variables prefixed for the client may reach the browser, and none of the above should.

## 13. Testing and acceptance

- **Unit:** geofence engine, chunker, pack validator, zod schemas, grounding validator, vector search.
- **Integration:** builder against a recorded fixture of API responses (no network), pack round trip (build, load, query).
- **End to end (Playwright):** load app, download fixture pack, switch the browser context offline, walk a GPX, ask a question, confirm answers still work.
- **Privacy:** replay a GPX session and assert no request body, URL, or header contains coordinates.
- **AI evals:** Section 9.4 sets, results stored in `docs/` and quoted in the post.
- **Manual:** the field checklist below, on a real phone.

## 14. Deployment

- **Render:** one Web Service for the API and the built PWA, defined in `render.yaml`. The free tier sleeps after inactivity, so use the claimed Render credits for an always-on instance on demo day (or a warm-up ping). All secrets as environment variables.
- **MongoDB Atlas:** create the vector index and 2dsphere indexes from a setup script, not by hand. Restrict network access to Render's outbound addresses where possible. If you open it broadly for the hackathon, use a strong unique password and say so in the README.
- **DigitalOcean:** GPU Droplet with Docker, Ollama or vLLM, Caddy, firewall. Spaces bucket with CDN, CORS allowing Range and the app origin. Billing alert set.
- **Cost discipline:** start the GPU droplet only for building packs and demos. Record the actual credit burn per service for the post.

## 15. Field test, demo, and submission

**Field checklist:** phone charged to a known level, pack and models downloaded and readiness green, airplane mode on before the trailhead, screen locked or in pocket mode, walk at least 1 hour, trigger at least 8 POIs, ask at least 5 spoken questions, log at least 3 observations, note every failure and its cause, note battery used.

**Metrics to record:** model names and sizes, local and hosted latency, tokens per second, retrieval hit@5, vision top-1 and top-3, battery per hour, bytes sent in a local session (target 0), pack size, cost per hour versus a closed-API estimate.

**Post outline (the brief asks why open innovation matters):**

1. Hook: a guide that works where the signal does not.
2. What WildPack does in three sentences.
3. Why open mattered, with numbers: ran offline, location never left the device, model and embeddings swappable by config, running cost.
4. How it is built (stack diagram, honest open versus closed table).
5. The outdoor story: where you walked, what worked, what broke.
6. Try it and fork it: repo link, one-command pack builder.

**90 second demo:** airplane mode on, walk past a POI and hear narration, ask a spoken question, photograph a plant and answer the follow-up, show the Open Proof panel at 0 bytes sent.

## 16. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| GPU quota or availability on DO | Request early. CPU fallback with a small quantised model for building packs. |
| On-device Gemma too large or slow in a browser | Decision gate in Phase 8. The laptop version is built first and is the fallback. State it honestly. |
| iOS limits on background geolocation, audio, and WebGPU | Primary target Android Chrome. Document iOS limits. |
| Overpass or iNaturalist rate limits | Cache on disk, back off, fixture-based tests. |
| Hallucinated facts in narration | Grounded prompts, validator, hand review of cards, species constrained to the pack. |
| Wrong species IDs | Candidate-list constraint, unverified label, confidence cap, follow-up question. |
| ElevenLabs credits run out | Cache by hash, pre-generate only, offline fallback voice. |
| Render cold start on demo day | Paid instance or warm-up ping. |
| Browser evicts stored data | Request persistent storage, show quota, readiness check before walking. |
| Poor GPS under tree cover | Accuracy filter, generous radii, spoken notice when GPS is lost. |
| Battery drain | Lazy model load, no continuous inference, measure and report. |

## 17. Licensing and attribution

- **Code:** Apache-2.0.
- **Gemma:** open weights under Google's Gemma terms of use. Link the terms in the README and do not call it OSI open source.
- **OpenStreetMap:** ODbL. Credit it in the app and in ATTRIBUTION.md.
- **iNaturalist:** photos have per-photo licences. Use only CC0 or CC BY content, store the attribution, or skip photos entirely.
- **Wikipedia:** CC BY-SA text. Story cards derived from it must credit the source.
- **ElevenLabs:** follow its terms. Generated audio is shipped inside packs, so check that redistribution is allowed on your plan. The free plan is non-commercial and requires attribution, so credit ElevenLabs in the app and README and confirm the terms that apply to the Hacktoberfest credits.

## Appendix A: Decisions the owner should confirm

1. Reference region for the first pack and the trail you will walk for the field test.
2. Laptop specs (RAM, GPU, and VRAM) so the right Gemma size is chosen, and later the phone model for the mobile phase.
3. Which Gemma variants to use for hosted and on-device (check what is current).
4. ElevenLabs voice for narration.
5. Whether to include Hindi or Marathi story cards if time allows.

## Appendix B: Change log v1.1 (October 7, 2026)

- **Desktop first:** new Section 5.10, Phase 8 is now mobile, Phase 9 is the field test.
- **ElevenLabs compulsory:** FR-PB-7, FR-GR-4, FR-QA-4, and Sections 4 and 17 updated.
- **Cost and licence audit:** new Section 4.1. The owner confirmed that DigitalOcean, Render, and ElevenLabs credits can be claimed.
- **Deadline:** Week 1 was listed as October 5 to October 11. Confirm it.
- **Still open:** laptop specs, credit amounts and expiry dates, reference trail.
