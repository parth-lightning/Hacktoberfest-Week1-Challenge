import type { RegionPack } from "../../packages/core/src/index";

const demoNarration =
  "This is a WildPack demonstration stop, not a verified place or ecological record. " +
  "The bundled sample note describes how a guide can connect a point of interest " +
  "to a short passage without asking the model to invent local facts. In a real " +
  "region pack, this narration would be replaced with reviewed information from " +
  "cited sources and a pre-generated audio recording. For now, use this stop to " +
  "try the offline walk controls, then import a pack for a real trail.";

export const demoPack: RegionPack = {
  manifest: {
    formatVersion: 1,
    packId: "wildpack-demo",
    slug: "wildpack-demo",
    name: "WildPack Demo Loop",
    version: "1.0.0",
    createdAt: "2026-10-11T00:00:00.000Z",
    bbox: { west: -0.002, south: -0.002, east: 0.002, north: 0.002 },
    center: { type: "Point", coordinates: [0, 0] },
    embeddingModel: "lexical-demo",
    embeddingDim: 1,
    counts: { pois: 3, species: 0, chunks: 3, audio: 0 },
    files: {},
    attribution: [
      "WildPack demo fixture. All locations and content are synthetic.",
      "No real trail, species, or nature facts are represented.",
    ],
  },
  pois: [
    {
      id: "demo-start",
      name: "Demo trailhead",
      type: "other",
      coordinates: [0, 0],
      radiusM: 40,
      priority: 1,
      storyCard: {
        text: demoNarration,
        sources: ["demo-chunk-start"],
        wordCount: demoNarration.split(/\s+/).length,
        validated: true,
      },
      tags: ["demo", "synthetic"],
    },
    {
      id: "demo-view",
      name: "Demo viewpoint",
      type: "viewpoint",
      coordinates: [0.0007, 0],
      radiusM: 60,
      priority: 2,
      storyCard: {
        text: demoNarration,
        sources: ["demo-chunk-view"],
        wordCount: demoNarration.split(/\s+/).length,
        validated: true,
      },
      tags: ["demo", "synthetic"],
    },
    {
      id: "demo-water",
      name: "Demo water stop",
      type: "water",
      coordinates: [0.0014, 0],
      radiusM: 40,
      priority: 3,
      storyCard: {
        text: demoNarration,
        sources: ["demo-chunk-water"],
        wordCount: demoNarration.split(/\s+/).length,
        validated: true,
      },
      tags: ["demo", "synthetic"],
    },
  ],
  chunks: [
    {
      id: "demo-chunk-start",
      poiId: "demo-start",
      text: "This synthetic demo trailhead exists only to exercise WildPack's offline guide controls. It does not describe a real trail or contain verified local ecology.",
      source: { title: "WildPack synthetic demo fixture", license: "CC0" },
      tokenCount: 26,
    },
    {
      id: "demo-chunk-view",
      poiId: "demo-view",
      text: "This synthetic demo viewpoint exists only to exercise WildPack's offline guide controls. It does not describe a real landscape or contain verified local ecology.",
      source: { title: "WildPack synthetic demo fixture", license: "CC0" },
      tokenCount: 27,
    },
    {
      id: "demo-chunk-water",
      poiId: "demo-water",
      text: "This synthetic demo water stop exists only to exercise WildPack's offline guide controls. It does not describe a real water feature or contain verified local ecology.",
      source: { title: "WildPack synthetic demo fixture", license: "CC0" },
      tokenCount: 28,
    },
  ],
  species: [],
  attribution:
    "WildPack demo fixture. All locations and content are synthetic. No real trail, species, or nature facts are represented.",
  audio: {},
};

export const demoGpxReplay = demoPack.pois.map((poi, index) => ({
  coordinates: poi.coordinates,
  accuracy: 5,
  speedMps: 1,
  timestamp: Date.now() + index * 25_000,
}));
