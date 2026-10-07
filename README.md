# WildPack

WildPack is a planned voice-first, offline-capable trail guide. This repository
is currently in **Phase 0: Foundations**. The running app is still the original
ThreeUI/Sylva landing-page starter; the trail catalog, offline packs, narration,
and AI features have not been implemented yet.

The implementation follows the [Software Requirements Specification](./WildPack%20Software%20Requirements%20Specification.md)
phase by phase. Laptop/browser and local Ollama support come before mobile work.
The product must not send a hiker's coordinates to a server.

## Current repository

- React 18, TypeScript, and Vite frontend.
- ThreeUI's Sylva hero and its local assets.
- Express 5 API in `server/index.ts`.
- `@wildpack/core` workspace with Zod pack schemas and geographic utilities.
- `GET /api/health` currently confirms only that the API process is running.
- `POST /api/contact` validates input but does not store or send submissions.

The SRS specifies Fastify, but the owner has chosen to keep the existing Express
server. This is an intentional stack deviation; no API framework migration is
planned unless the owner requests it.

See [the template map](./docs/template-map.md) for how the starter maps to the
planned screens and which work remains.

## Requirements

- Node.js 20.19+ or 22.12+
- npm

## Run locally

```sh
npm install
npm run dev
```

In a second terminal, start the API:

```sh
npm run dev:server
```

Vite serves the app at `http://localhost:5173` and proxies `/api` requests to
the Express server on port `3001`. `GET http://localhost:3001/api/health`
returns the API process status.

## Build and typecheck

```sh
npm run typecheck
npm run build
npm run test:core
```

## Configuration and services

Copy `.env.example` to `.env` when configuring local services. Never commit
`.env` or place server credentials in frontend variables. MongoDB, model
hosting, ElevenLabs, DigitalOcean Spaces, Render, and admin authoring are not
connected yet. Do not provision paid resources until the available credits,
balances, and expiry dates have been confirmed.

The first real region pack also needs a reference trail the owner can walk.
Model sizing needs the laptop's RAM and GPU/VRAM details. These choices are
recorded in the SRS owner checklist.

## Data and attribution

Planned packs will carry their own data for offline use and attribution for
OpenStreetMap, iNaturalist, Wikipedia, and other sources. Generated plant and
fungi content must never advise eating, touching, or using wildlife.
