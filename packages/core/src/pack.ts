import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { z } from "zod";
import {
  PackManifestSchema,
  type PackManifest,
} from "./schemas";

const sourceSchema = z.object({
  title: z.string().min(1),
  url: z.string().url().optional(),
  license: z.string().min(1),
});

export const StoryCardSchema = z.object({
  text: z.string().min(1),
  sources: z.array(z.string()),
  audioPath: z.string().optional(),
  wordCount: z.number().int().nonnegative(),
  validated: z.boolean(),
});

export const PoiSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: z.enum(["viewpoint", "peak", "historic", "water", "natural", "other"]),
  coordinates: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ]),
  radiusM: z.number().positive().default(40),
  priority: z.number().int().nonnegative().default(0),
  storyCard: StoryCardSchema,
  tags: z.array(z.string()).default([]),
});

export const ChunkSchema = z.object({
  id: z.string().min(1),
  poiId: z.string().optional(),
  text: z.string().min(1),
  source: sourceSchema,
  tokenCount: z.number().int().nonnegative().optional(),
  embedding: z.array(z.number()).optional(),
});

export const SpeciesSchema = z.object({
  taxonId: z.union([z.string(), z.number()]).optional(),
  commonName: z.string().min(1),
  scientificName: z.string().optional(),
  group: z.enum(["plant", "bird", "insect", "fungi", "other"]).default("other"),
  observationCount: z.number().int().nonnegative().default(0),
  monthHistogram: z.array(z.number().int().nonnegative()).length(12).default(
    () => Array.from({ length: 12 }, () => 0),
  ),
  summary: z.string().optional(),
});

export const CardsSchema = z.record(z.string(), StoryCardSchema);

const featureCollectionSchema = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      id: z.string(),
      geometry: z.object({
        type: z.literal("Point"),
        coordinates: z.tuple([z.number(), z.number()]),
      }),
      properties: z.record(z.string(), z.unknown()),
    }),
  ),
});

export type Poi = z.infer<typeof PoiSchema>;
export type Chunk = z.infer<typeof ChunkSchema>;
export type Species = z.infer<typeof SpeciesSchema>;
export type StoryCard = z.infer<typeof StoryCardSchema>;
export type RegionPack = {
  manifest: PackManifest;
  pois: Poi[];
  chunks: Chunk[];
  species: Species[];
  attribution: string;
  audio: Record<string, Uint8Array>;
};

function utf8(value: string): Uint8Array {
  return strToU8(value);
}

function jsonBytes(value: unknown): Uint8Array {
  return utf8(JSON.stringify(value));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer,
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function parseJson(bytes: Uint8Array): unknown {
  return JSON.parse(strFromU8(bytes)) as unknown;
}

function parseJsonLines(bytes: Uint8Array): unknown[] {
  const text = strFromU8(bytes).trim();
  if (!text) return [];
  return text.split(/\r?\n/).map((line) => JSON.parse(line) as unknown);
}

function encodeFloat16(value: number): number {
  const scratch = new Float32Array(1);
  scratch[0] = value;
  const bits = new Uint32Array(scratch.buffer)[0] ?? 0;
  const sign = (bits >>> 16) & 0x8000;
  let exponent = ((bits >>> 23) & 0xff) - 127 + 15;
  let mantissa = bits & 0x7fffff;

  if (exponent <= 0) {
    if (exponent < -10) return sign;
    mantissa = (mantissa | 0x800000) >>> (1 - exponent);
    return sign | ((mantissa + 0x1000) >>> 13);
  }
  if (exponent >= 31) return sign | 0x7c00;
  mantissa += 0x1000;
  if (mantissa & 0x800000) {
    mantissa = 0;
    exponent += 1;
    if (exponent >= 31) return sign | 0x7c00;
  }
  return sign | (exponent << 10) | (mantissa >>> 13);
}

function decodeFloat16(half: number): number {
  const sign = half & 0x8000 ? -1 : 1;
  const exponent = (half >>> 10) & 0x1f;
  const mantissa = half & 0x03ff;
  if (exponent === 0) return sign * mantissa * 2 ** -24;
  if (exponent === 0x1f) return mantissa === 0 ? sign * Infinity : Number.NaN;
  return sign * (1 + mantissa / 1024) * 2 ** (exponent - 15);
}

export async function createWildpack(
  input: Omit<RegionPack, "manifest"> & { manifest: PackManifest },
): Promise<Uint8Array> {
  const pois = input.pois.map((poi) => PoiSchema.parse(poi));
  const chunks = input.chunks.map((chunk) => ChunkSchema.parse(chunk));
  const species = input.species.map((entry) => SpeciesSchema.parse(entry));
  const files: Record<string, Uint8Array> = {
    "pois.geojson": jsonBytes({
      type: "FeatureCollection",
      features: pois.map((poi) => ({
        type: "Feature",
        id: poi.id,
        geometry: { type: "Point", coordinates: poi.coordinates },
        properties: {
          name: poi.name,
          poiType: poi.type,
          radiusM: poi.radiusM,
          priority: poi.priority,
          tags: poi.tags,
        },
      })),
    }),
    "cards.json": jsonBytes(
      Object.fromEntries(pois.map((poi) => [poi.id, poi.storyCard])),
    ),
    "chunks.jsonl": utf8(chunks.map(({ embedding: _embedding, ...chunk }) =>
      JSON.stringify(chunk),
    ).join("\n")),
    "species.json": jsonBytes(species),
    "ATTRIBUTION.md": utf8(input.attribution),
  };
  const embeddingBytes = new Uint8Array(
    chunks.length * input.manifest.embeddingDim * 2,
  );
  const embeddingView = new DataView(embeddingBytes.buffer);
  chunks.forEach((chunk, row) => {
    if (chunk.embedding && chunk.embedding.length !== input.manifest.embeddingDim) {
      throw new Error(`Chunk ${chunk.id} embedding dimension does not match the manifest.`);
    }
    for (let column = 0; column < input.manifest.embeddingDim; column += 1) {
      const value = chunk.embedding?.[column] ?? 0;
      if (!Number.isFinite(value)) {
        throw new Error(`Chunk ${chunk.id} has a non-finite embedding value.`);
      }
      embeddingView.setUint16(
        (row * input.manifest.embeddingDim + column) * 2,
        encodeFloat16(value),
        true,
      );
    }
  });
  files["embeddings.f16.bin"] = embeddingBytes;

  for (const [path, bytes] of Object.entries(input.audio)) {
    if (!/^audio\/[a-f0-9-]+\.mp3$/i.test(path)) {
      throw new Error(`Invalid audio path: ${path}`);
    }
    files[path] = bytes;
  }

  const hashes: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(files)) {
    hashes[path] = await sha256(bytes);
  }
  const manifest = PackManifestSchema.parse({
    ...input.manifest,
    counts: {
      pois: pois.length,
      species: species.length,
      chunks: chunks.length,
      audio: Object.keys(input.audio).length,
    },
    files: hashes,
  });
  files["manifest.json"] = jsonBytes(manifest);
  return zipSync(files, { level: 6 });
}

export async function readWildpack(archive: Uint8Array): Promise<RegionPack> {
  const files = unzipSync(archive);
  const manifestFile = files["manifest.json"];
  if (!manifestFile) throw new Error("Pack is missing manifest.json.");

  const manifest = PackManifestSchema.parse(parseJson(manifestFile));
  for (const [path, expectedHash] of Object.entries(manifest.files)) {
    const bytes = files[path];
    if (!bytes) throw new Error(`Pack is missing ${path}.`);
    const actualHash = await sha256(bytes);
    if (actualHash !== expectedHash.toLowerCase()) {
      throw new Error(`Integrity check failed for ${path}.`);
    }
  }

  const poiFile = files["pois.geojson"];
  const cardsFile = files["cards.json"];
  const chunksFile = files["chunks.jsonl"];
  const speciesFile = files["species.json"];
  const attributionFile = files["ATTRIBUTION.md"];
  if (!poiFile || !cardsFile || !chunksFile || !speciesFile || !attributionFile) {
    throw new Error("Pack is missing a required data file.");
  }

  const geojson = featureCollectionSchema.parse(parseJson(poiFile));
  const cards = CardsSchema.parse(parseJson(cardsFile));
  const pois = geojson.features.map((feature) =>
    PoiSchema.parse({
      id: feature.id,
      name: feature.properties.name,
      type: feature.properties.poiType,
      coordinates: feature.geometry.coordinates,
      radiusM: feature.properties.radiusM,
      priority: feature.properties.priority,
      tags: feature.properties.tags,
      storyCard: cards[feature.id],
    }),
  );
  const chunks = parseJsonLines(chunksFile).map((chunk) =>
    ChunkSchema.parse(chunk),
  );
  const embeddingFile = files["embeddings.f16.bin"];
  if (!embeddingFile) throw new Error("Pack is missing embeddings.f16.bin.");
  const expectedEmbeddingBytes =
    chunks.length * manifest.embeddingDim * 2;
  if (embeddingFile.byteLength !== expectedEmbeddingBytes) {
    throw new Error("Pack embedding data does not match the manifest dimensions.");
  }
  const embeddingView = new DataView(
    embeddingFile.buffer,
    embeddingFile.byteOffset,
    embeddingFile.byteLength,
  );
  const chunksWithEmbeddings = chunks.map((chunk, row) => ({
    ...chunk,
    embedding: Array.from(
      { length: manifest.embeddingDim },
      (_, column) =>
        decodeFloat16(
          embeddingView.getUint16(
            (row * manifest.embeddingDim + column) * 2,
            true,
          ),
        ),
    ),
  }));
  const species = z.array(SpeciesSchema).parse(parseJson(speciesFile));
  const audio: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(files)) {
    if (path.startsWith("audio/")) audio[path] = bytes;
  }

  if (
    pois.length !== manifest.counts.pois ||
    chunks.length !== manifest.counts.chunks ||
    species.length !== manifest.counts.species ||
    Object.keys(audio).length !== manifest.counts.audio
  ) {
    throw new Error("Pack manifest counts do not match its contents.");
  }

  return {
    manifest,
    pois,
    chunks: chunksWithEmbeddings,
    species,
    attribution: strFromU8(attributionFile),
    audio,
  };
}
