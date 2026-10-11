import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, unzipSync, zipSync } from "fflate";
import {
  createWildpack,
  readWildpack,
  type RegionPack,
} from "../src/index";

const fixture: RegionPack = {
  manifest: {
    formatVersion: 1,
    packId: "demo-pack",
    slug: "demo-pack",
    name: "Demo loop",
    version: "1.0.0",
    createdAt: "2026-10-11T00:00:00.000Z",
    bbox: { west: -0.01, south: -0.01, east: 0.01, north: 0.01 },
    center: { type: "Point", coordinates: [0, 0] },
    embeddingModel: "demo",
    embeddingDim: 1,
    counts: { pois: 0, species: 0, chunks: 0, audio: 0 },
    files: {},
    attribution: ["Demo data"],
  },
  pois: [{
    id: "poi-1",
    name: "Sample viewpoint",
    type: "viewpoint",
    coordinates: [0, 0],
    radiusM: 40,
    priority: 1,
    storyCard: {
      text: "Sample narration for pack format verification.",
      sources: ["chunk-1"],
      wordCount: 7,
      validated: true,
    },
    tags: ["demo"],
  }],
  chunks: [{
    id: "chunk-1",
    poiId: "poi-1",
    text: "Sample source passage for pack round-trip tests.",
    source: { title: "Fixture", license: "CC0" },
    tokenCount: 8,
  }],
  species: [],
  attribution: "Demo fixture; not a real trail guide.",
  audio: {},
};

test("round trips a pack and verifies file hashes", async () => {
  const archive = await createWildpack(fixture);
  const restored = await readWildpack(archive);
  assert.equal(restored.manifest.slug, "demo-pack");
  assert.equal(restored.pois[0]?.name, "Sample viewpoint");
  assert.equal(restored.chunks[0]?.id, "chunk-1");
});

test("rejects a pack with a tampered data file", async () => {
  const archive = await createWildpack(fixture);
  const entries = unzipSync(archive);
  const poiFile = entries["pois.geojson"];
  assert.ok(poiFile);
  entries["pois.geojson"] = strToU8("tampered data");
  const corrupted = zipSync(entries);
  await assert.rejects(readWildpack(corrupted));
});
