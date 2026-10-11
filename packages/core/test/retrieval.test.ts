import assert from "node:assert/strict";
import test from "node:test";
import {
  AskRequestSchema,
  isForagingOrMedicalQuestion,
  retrieveChunks,
  type Chunk,
} from "../src/index";

const chunks: Chunk[] = [
  {
    id: "water",
    text: "Water flows over dark volcanic rock.",
    source: { title: "Geology notes", license: "CC0" },
  },
  {
    id: "tree",
    text: "Oak leaves have rounded lobes.",
    source: { title: "Tree notes", license: "CC0" },
  },
];

test("retrieves the passage matching the query terms", () => {
  assert.equal(retrieveChunks("dark volcanic rock", chunks)[0]?.chunk.id, "water");
});

test("refuses eating and medical use questions", () => {
  assert.equal(isForagingOrMedicalQuestion("Can I eat this mushroom?"), true);
  assert.equal(isForagingOrMedicalQuestion("What is a basalt column?"), false);
});

test("rejects coordinates from question API requests", () => {
  const request = {
    packSlug: "demo",
    question: "What is this rock?",
    chunks: [{ id: "rock", text: "A sample passage." }],
    latitude: 51.5,
    longitude: -0.1,
  };
  assert.equal(AskRequestSchema.safeParse(request).success, false);
});
