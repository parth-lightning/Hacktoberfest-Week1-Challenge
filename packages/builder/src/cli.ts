import "dotenv/config";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import {
  PackManifestSchema,
  SpeciesSchema,
  type BoundingBox,
  type Chunk,
  type Poi,
  type Species,
} from "../../core/src/index";
import { createWildpack } from "../../core/src/pack";

const inputSchema = z.object({
  name: z.string().min(1).max(100),
  bbox: z.object({
    west: z.number(),
    south: z.number(),
    east: z.number(),
    north: z.number(),
  }),
  pois: z.array(z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.enum(["viewpoint", "peak", "historic", "water", "natural", "other"]),
    coordinates: z.tuple([z.number(), z.number()]),
    radiusM: z.number().positive().optional(),
    priority: z.number().int().nonnegative().optional(),
    tags: z.array(z.string()).optional(),
  })).min(1).max(40),
  sources: z.array(z.object({
    id: z.string().min(1),
    poiId: z.string().optional(),
    title: z.string().min(1),
    text: z.string().min(1),
    url: z.string().url().optional(),
    license: z.string().min(1),
  })).min(1),
  species: z.array(SpeciesSchema).default([]),
  attribution: z.array(z.string().min(1)).min(1),
}).strict();

type BuilderInput = z.infer<typeof inputSchema>;
type GeneratedCard = { text: string; usedSourceIds: string[] };

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function slugify(text: string): string {
  const slug = text.toLocaleLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error("Pack name must contain at least one letter or number.");
  return slug;
}

function chunkText(text: string, maxWords = 300): string[] {
  const words = text.trim().split(/\s+/);
  const chunks: string[] = [];
  for (let index = 0; index < words.length; index += maxWords) {
    const part = words.slice(index, index + maxWords).join(" ");
    if (part) chunks.push(part);
  }
  return chunks;
}

function templateStory(poi: BuilderInput["pois"][number], source: string): string {
  const excerpt = source.trim().split(/\s+/).slice(0, 12).join(" ");
  return `At ${poi.name}, a ${poi.type} point in this pack, pause and take a moment to look around. The cited field note says: “${excerpt}.” This note has not been independently checked for current conditions, so treat it as context rather than a live report. Keep a respectful distance from wildlife, and do not touch plants, fungi, or animals. Notice one shape or texture nearby, then continue when you are ready.`;
}

function groundedStory(
  text: string,
  sourcePassages: Array<{ id: string; text: string }>,
): boolean {
  const sourceText = sourcePassages.map((source) => source.text).join(" ").toLocaleLowerCase();
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount < 60 || wordCount > 90) return false;
  const properWords = text.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
  const unexplainedNames = properWords.slice(1).filter(
    (word) => !sourceText.includes(word.toLocaleLowerCase()),
  );
  const numerals = text.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
  return unexplainedNames.length === 0 &&
    numerals.every((number) => sourceText.includes(number));
}

function parseJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model response did not contain JSON.");
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

async function callOllama(
  baseUrl: string,
  model: string,
  messages: Array<{ role: "system" | "user"; content: string }>,
  json = false,
): Promise<string> {
  const response = await fetch(`${baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      ...(json ? { format: "json" } : {}),
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Ollama request failed (${response.status}). Check the service and model.`);
  }
  const result: unknown = await response.json();
  return z.object({ message: z.object({ content: z.string() }) })
    .parse(result).message.content;
}

async function voiceCard(text: string, voiceId: string): Promise<Uint8Array> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new Error("ELEVENLABS_API_KEY is required: every shipped story card must include ElevenLabs audio.");
  }
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `ElevenLabs audio generation failed (${response.status}). Check the key, quota, and voice access.`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function embedChunks(
  baseUrl: string,
  model: string,
  chunks: Chunk[],
): Promise<{ chunks: Chunk[]; dimension: number }> {
  const response = await fetch(
    `${baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "")}/api/embed`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: chunks.map((chunk) => chunk.text) }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!response.ok) {
    throw new Error(`Ollama embedding request failed (${response.status}). Check the embedding model.`);
  }
  const parsed = z.object({ embeddings: z.array(z.array(z.number())) })
    .parse(await response.json());
  if (parsed.embeddings.length !== chunks.length) {
    throw new Error("The embedding model returned the wrong number of vectors.");
  }
  const dimension = parsed.embeddings[0]?.length ?? 0;
  if (!dimension || parsed.embeddings.some((vector) => vector.length !== dimension)) {
    throw new Error("The embedding model returned inconsistent vector dimensions.");
  }
  return {
    chunks: chunks.map((chunk, index) => ({
      ...chunk,
      embedding: parsed.embeddings[index],
    })),
    dimension,
  };
}

async function build(): Promise<void> {
  const inputPath = option("input");
  const outputPath = option("out") ?? "generated-packs";
  const isDev = hasFlag("dev");
  if (!inputPath) {
    throw new Error(
      "Usage: npm run build:pack -- --input samples/reference-pack.json [--out dist/packs] [--dev]",
    );
  }
  const rawInput: unknown = JSON.parse(
    await readFile(resolve(inputPath), "utf8"),
  );
  const input = inputSchema.parse(rawInput);
  const bbox = input.bbox as BoundingBox;
  const slug = slugify(input.name);
  const outputDirectory = resolve(outputPath);
  const cacheDirectory = resolve(".wildpack-cache", "audio");
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const baseUrl = process.env.LLM_BASE_URL ?? "http://localhost:11434/v1";
  const model = process.env.LLM_MODEL_HOSTED ?? "gemma3:4b";
  const embeddingModel = process.env.EMBED_MODEL ?? "embeddinggemma";
  const sortedPois = [...input.pois].sort(
    (left, right) => (left.priority ?? 0) - (right.priority ?? 0),
  ).slice(0, isDev ? 10 : 40);
  if (!voiceId) {
    throw new Error("ELEVENLABS_VOICE_ID must be set; every shipped card needs ElevenLabs audio.");
  }

  const chunks: Chunk[] = [];
  for (const source of input.sources) {
    const textChunks = chunkText(source.text);
    textChunks.forEach((text, index) => {
      chunks.push({
        id: textChunks.length === 1 ? source.id : `${source.id}-${index + 1}`,
        ...(source.poiId ? { poiId: source.poiId } : {}),
        text,
        source: {
          title: source.title,
          ...(source.url ? { url: source.url } : {}),
          license: source.license,
        },
        tokenCount: text.split(/\s+/).length,
      });
    });
  }
  const embedded = await embedChunks(baseUrl, embeddingModel, chunks);
  const voicedPIs: Poi[] = [];
  const audio: Record<string, Uint8Array> = {};
  const cardSchema = z.object({
    text: z.string().min(1),
    usedSourceIds: z.array(z.string()),
  });

  for (const [index, rawPoi] of sortedPois.entries()) {
    const poiChunks = embedded.chunks.filter((chunk) => chunk.poiId === rawPoi.id);
    const availableChunks = poiChunks.length > 0 ? poiChunks : embedded.chunks;
    if (availableChunks.length === 0) {
      throw new Error(`POI ${rawPoi.id} has no source passages for a grounded card.`);
    }
    const allowedSourceIds = new Set(availableChunks.map((chunk) => chunk.id));
    const context = availableChunks.map((chunk) => `[${chunk.id}] ${chunk.text}`).join("\n\n");
    const system =
      "You are a precise nature trail guide. Write a 60 to 90 word spoken story card using ONLY the source passages. Do not invent facts, numbers, or proper nouns. No lists or markdown. Never advise eating, touching, or using plants, fungi, or animals. End with one thing to look at. Return JSON {\"text\": string, \"usedSourceIds\": string[]}.";
    const prompt = `POI: ${rawPoi.name} (${rawPoi.type})\nMonth: ${new Date().getMonth() + 1}\nSOURCE PASSAGES:\n${context}`;
    let text: string;
    let usedSourceIds: string[];
    let cardValidated = false;
    try {
      let raw = await callOllama(baseUrl, model, [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ], true);
      let generated = cardSchema.parse(parseJson(raw));
      if (
        generated.usedSourceIds.some((id) => !allowedSourceIds.has(id)) ||
        !groundedStory(generated.text, availableChunks.map((chunk) => ({
          id: chunk.id,
          text: chunk.text,
        })))
      ) {
        raw = await callOllama(baseUrl, model, [
          { role: "system", content: `${system} Be especially strict about source-only wording and 60 to 90 words.` },
          { role: "user", content: prompt },
        ], true);
        generated = cardSchema.parse(parseJson(raw));
      }
      const valid =
        generated.usedSourceIds.length > 0 &&
        generated.usedSourceIds.every((id) => allowedSourceIds.has(id)) &&
        groundedStory(generated.text, availableChunks.map((chunk) => ({
          id: chunk.id,
          text: chunk.text,
        })));
      text = valid
        ? generated.text
        : templateStory(rawPoi, availableChunks[0]?.text ?? "");
      usedSourceIds = valid
        ? generated.usedSourceIds
        : [availableChunks[0]?.id ?? ""].filter(Boolean);
      cardValidated = valid;
    } catch (error) {
      console.warn(
        `Could not validate a generated story for ${rawPoi.name}; using an unvalidated template. ${
          error instanceof Error ? error.message : "Unknown generation error."
        }`,
      );
      text = templateStory(rawPoi, availableChunks[0]?.text ?? "");
      usedSourceIds = [availableChunks[0]?.id ?? ""].filter(Boolean);
    }

    const hash = createHash("sha256")
      .update(text)
      .update(voiceId)
      .update("eleven_multilingual_v2")
      .digest("hex");
    const audioPath = `audio/${hash}.mp3`;
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(resolve(cacheDirectory, `${hash}.mp3`)));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      bytes = await voiceCard(text, voiceId);
      await mkdir(cacheDirectory, { recursive: true });
      await writeFile(resolve(cacheDirectory, `${hash}.mp3`), bytes);
    }
    audio[audioPath] = bytes;
    voicedPIs.push({
      id: rawPoi.id,
      name: rawPoi.name,
      type: rawPoi.type,
      coordinates: rawPoi.coordinates,
      radiusM: rawPoi.radiusM ?? (rawPoi.type === "viewpoint" ? 60 : 40),
      priority: rawPoi.priority ?? index,
      tags: rawPoi.tags ?? [],
      storyCard: {
        text,
        sources: usedSourceIds,
        audioPath,
        wordCount: text.split(/\s+/).length,
        validated: cardValidated,
      },
    });
    console.log(`Voiced story ${index + 1}/${sortedPois.length}: ${rawPoi.name}`);
  }

  const species = input.species.map((entry) => SpeciesSchema.parse(entry)) as Species[];
  const manifest = PackManifestSchema.parse({
    formatVersion: 1,
    packId: slug,
    slug,
    name: input.name,
    version: "1.0.0",
    createdAt: new Date().toISOString(),
    bbox,
    center: {
      type: "Point",
      coordinates: [
        (bbox.west + bbox.east) / 2,
        (bbox.south + bbox.north) / 2,
      ],
    },
    embeddingModel,
    embeddingDim: embedded.dimension,
    counts: {
      pois: voicedPIs.length,
      species: species.length,
      chunks: embedded.chunks.length,
      audio: Object.keys(audio).length,
    },
    files: {},
    attribution: input.attribution,
  });
  const packBytes = await createWildpack({
    manifest,
    pois: voicedPIs,
    chunks: embedded.chunks,
    species,
    attribution: input.attribution.join("\n"),
    audio,
  });
  await mkdir(outputDirectory, { recursive: true });
  const outputFile = resolve(outputDirectory, `${slug}.wildpack`);
  await writeFile(outputFile, packBytes);
  console.log(`Built ${outputFile} (${(packBytes.byteLength / 1024 / 1024).toFixed(2)} MB)`);
}

build().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Pack build failed.");
  process.exitCode = 1;
});
