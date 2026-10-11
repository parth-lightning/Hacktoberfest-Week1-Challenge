import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import express from "express";
import { MongoClient } from "mongodb";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import {
  AskRequestSchema,
  isForagingOrMedicalQuestion,
  readWildpack,
} from "../packages/core/src/index";
import type { PackManifest } from "../packages/core/src/index";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const maxNameLength = 100;
const maxEmailLength = 254;
const maxMessageLength = 5000;
const maxAnswerWords = 60;
const llmBaseUrl = (process.env.LLM_BASE_URL ?? "http://localhost:11434/v1")
  .replace(/\/+$/, "");
const llmModel = process.env.LLM_MODEL_HOSTED ?? "gemma3:4b";
const mongoUri = process.env.MONGODB_URI;
const packDirectory = resolve(process.env.WILDPACK_OUTPUT_DIR ?? "generated-packs");
const audioCacheDirectory = resolve(packDirectory, ".audio-cache");

const embeddingBodySchema = z.object({
  input: z.array(z.string().min(1).max(3000)).min(1).max(16),
  model: z.string().min(1).max(100).optional(),
}).strict();

const visionBodySchema = z.object({
  image: z.string().max(2_100_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  candidates: z.array(z.string().min(1).max(120)).max(150),
}).strict();

const ttsBodySchema = z.object({
  text: z.string().trim().min(1).max(600),
  voiceId: z.string().min(1).max(100).optional(),
}).strict();

type CitationAnswer = { answer: string; citations: string[] };
type VisionCandidate = {
  commonName: string;
  scientificName: string;
  confidence: number;
  visibleTraits: string[];
};
type VisionAnswer = {
  candidates: VisionCandidate[];
  observedTraits: string[];
  followUpQuestion: string;
  needsBetterPhoto: boolean;
};

const fixedSafetyResponse =
  "I can’t advise on eating, touching, foraging, or using plants, fungi, or wildlife. Please leave it undisturbed and consult a qualified local expert.";

let mongoClient: MongoClient | undefined;

function ollamaBaseUrl(): string {
  return llmBaseUrl.replace(/\/v1$/, "");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 5000,
): Promise<Response> {
  return fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function ollamaChat(
  messages: Array<{ role: "system" | "user"; content: string }>,
  options: { images?: string[]; json?: boolean } = {},
): Promise<string> {
  const llmResponse = await fetchWithTimeout(
    `${ollamaBaseUrl()}/api/chat`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: llmModel,
        messages: options.images
          ? [
              ...messages.slice(0, -1),
              {
                role: "user",
                content: messages[messages.length - 1]?.content ?? "",
                images: options.images,
              },
            ]
          : messages,
        stream: false,
        ...(options.json ? { format: "json" } : {}),
      }),
    },
    120_000,
  );

  if (!llmResponse.ok) {
    throw new Error(
      `Local model request failed (${llmResponse.status}). Check Ollama and the configured model.`,
    );
  }
  const payload: unknown = await llmResponse.json();
  const responseSchema = z.object({
    message: z.object({ content: z.string() }),
  });
  return responseSchema.parse(payload).message.content;
}

function parseJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("The model did not return JSON.");
  return JSON.parse(text.slice(start, end + 1)) as unknown;
}

function limitWords(text: string, limit: number): string {
  return text.trim().split(/\s+/).slice(0, limit).join(" ");
}

function logDependencyFailure(dependency: string, error: unknown): void {
  const reason = error instanceof Error ? error.name : "UnknownError";
  console.warn(JSON.stringify({ event: "dependency_unavailable", dependency, reason }));
}

app.disable("x-powered-by");
app.use(express.json({ limit: "3mb" }));
app.use((request, response, next) => {
  const origin = request.get("origin");
  const allowedOrigin = process.env.ALLOWED_ORIGIN;
  if (origin && allowedOrigin && origin !== allowedOrigin) {
    response.status(403).json({
      error: { code: "ORIGIN_NOT_ALLOWED", message: "This origin is not allowed." },
    });
    return;
  }
  next();
});

const publicLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error: { code: "RATE_LIMITED", message: "Too many requests. Please wait before trying again." },
    });
  },
});
const ttsLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error: { code: "TTS_RATE_LIMITED", message: "Narration generation is limited to 10 requests per minute." },
    });
  },
});
app.use("/api", publicLimiter);

async function readAvailablePacks(): Promise<Array<{
  manifest: PackManifest;
  sizeBytes: number;
  sha256: string;
  downloadUrl: string;
}>> {
  let filenames: string[];
  try {
    filenames = await readdir(packDirectory);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const packs = [];
  for (const filename of filenames.filter((name) => name.endsWith(".wildpack"))) {
    const slug = filename.slice(0, -".wildpack".length);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) continue;
    const path = join(packDirectory, filename);
    const archive = new Uint8Array(await readFile(path));
    const pack = await readWildpack(archive);
    packs.push({
      manifest: pack.manifest,
      sizeBytes: archive.byteLength,
      sha256: createHash("sha256").update(archive).digest("hex"),
      downloadUrl: `/api/packs/${slug}/download`,
    });
  }
  return packs;
}

app.get("/api/health", async (_request, response) => {
  const checks: Record<string, "ok" | "unavailable" | "unconfigured"> = {
    api: "ok",
    mongo: mongoUri ? "unavailable" : "unconfigured",
    llm: "unavailable",
  };

  if (mongoUri) {
    try {
      mongoClient ??= new MongoClient(mongoUri, {
        connectTimeoutMS: 2500,
        serverSelectionTimeoutMS: 2500,
      });
      await mongoClient.connect();
      await mongoClient.db().command({ ping: 1 });
      checks.mongo = "ok";
    } catch (error) {
      logDependencyFailure("mongo", error);
      if (mongoClient) {
        await mongoClient.close().catch(() => undefined);
        mongoClient = undefined;
      }
    }
  }

  try {
    const modelResponse = await fetchWithTimeout(
      `${ollamaBaseUrl()}/api/tags`,
      {},
      1500,
    );
    if (modelResponse.ok) {
      const models = z.object({
        models: z.array(z.object({ name: z.string() })),
      }).parse(await modelResponse.json()).models;
      checks.llm = models.some(({ name }) => name === llmModel)
        ? "ok"
        : "unavailable";
    }
  } catch {
    checks.llm = "unavailable";
  }

  const status = Object.values(checks).every(
    (check) => check === "ok" || check === "unconfigured",
  ) ? "ok" : "degraded";
  response.status(status === "ok" ? 200 : 503).json({ status, checks });
});

app.get("/api/packs", async (_request, response) => {
  const packs = await readAvailablePacks();
  response.json({
    packs: packs.map(({ manifest, sizeBytes, sha256, downloadUrl }) => ({
      slug: manifest.slug,
      name: manifest.name,
      version: manifest.version,
      counts: manifest.counts,
      sizeBytes,
      sha256,
      downloadUrl,
    })),
  });
});

app.get("/api/packs/:slug", async (request, response) => {
  const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .parse(request.params.slug);
  const pack = (await readAvailablePacks()).find(
    (entry) => entry.manifest.slug === slug,
  );
  if (!pack) {
    response.status(404).json({
      error: { code: "PACK_NOT_FOUND", message: "The requested region pack is not available." },
    });
    return;
  }
  response.json({
    slug: pack.manifest.slug,
    name: pack.manifest.name,
    version: pack.manifest.version,
    counts: pack.manifest.counts,
    sizeBytes: pack.sizeBytes,
    sha256: pack.sha256,
    downloadUrl: pack.downloadUrl,
  });
});

app.get("/api/packs/:slug/download", async (request, response, next) => {
  const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .parse(request.params.slug);
  const packPath = join(packDirectory, `${slug}.wildpack`);
  try {
    await readFile(packPath);
    response.download(packPath, `${slug}.wildpack`, (error) => {
      if (error && !response.headersSent) next(error);
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      response.status(404).json({
        error: { code: "PACK_NOT_FOUND", message: "The requested region pack is not available." },
      });
      return;
    }
    next(error);
  }
});

app.post("/api/ask", async (request, response) => {
  const input = AskRequestSchema.parse(request.body);
  if (isForagingOrMedicalQuestion(input.question)) {
    response.json({
      answer: fixedSafetyResponse,
      citations: [],
      model: "fixed-safety-refusal",
      latencyMs: 0,
    });
    return;
  }
  if (input.chunks.length === 0) {
    response.status(400).json({
      error: { code: "NO_CONTEXT", message: "No pack passages were supplied." },
    });
    return;
  }

  const startedAt = performance.now();
  const context = input.chunks
    .map((chunk) => `[${chunk.id}] ${chunk.text}`)
    .join("\n\n");
  const prompt = [
    `Pack: ${input.packSlug}`,
    input.poiName ? `Nearest point of interest: ${input.poiName}` : "",
    input.month ? `Month: ${input.month}` : "",
    `CONTEXT:\n${context}`,
    `QUESTION: ${input.question}`,
    'Return JSON only: {"answer":"...","citations":["chunk-id"]}.',
  ].filter(Boolean).join("\n\n");
  const system =
    "You are a concise nature trail guide. Answer only from the provided CONTEXT, in 60 words or fewer. If the context does not answer the question, say you do not know and suggest something to observe. Cite only supplied passage ids. Never provide advice to eat, touch, forage, or medically use plants, fungi, or wildlife.";

  let raw: string;
  try {
    raw = await ollamaChat(
      [{ role: "system", content: system }, { role: "user", content: prompt }],
      { json: true },
    );
  } catch (error) {
    logDependencyFailure("llm_chat", error);
    response.status(503).json({
      error: {
        code: "LOCAL_MODEL_UNAVAILABLE",
        message: error instanceof Error ? error.message : "The local model is unavailable.",
      },
    });
    return;
  }

  let parsed: CitationAnswer;
  try {
    const resultSchema = z.object({
      answer: z.string().min(1),
      citations: z.array(z.string()),
    });
    parsed = resultSchema.parse(parseJsonObject(raw));
  } catch {
    try {
      raw = await ollamaChat([
        { role: "system", content: `${system} Return one valid JSON object only.` },
        { role: "user", content: prompt },
      ], { json: true });
      parsed = z.object({
        answer: z.string().min(1),
        citations: z.array(z.string()),
      }).parse(parseJsonObject(raw));
    } catch {
      response.status(502).json({
        error: {
          code: "INVALID_MODEL_RESPONSE",
          message: "The local model could not produce a valid grounded answer.",
        },
      });
      return;
    }
  }

  const allowedIds = new Set(input.chunks.map((chunk) => chunk.id));
  response.json({
    answer: limitWords(parsed.answer, maxAnswerWords),
    citations: parsed.citations.filter((id) => allowedIds.has(id)),
    model: llmModel,
    latencyMs: Math.round(performance.now() - startedAt),
  });
});

app.post("/api/embed", async (request, response) => {
  const input = embeddingBodySchema.parse(request.body);
  try {
    const embedResponse = await fetchWithTimeout(
      `${ollamaBaseUrl()}/api/embed`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: input.model ?? process.env.EMBED_MODEL ?? "embeddinggemma",
          input: input.input,
        }),
      },
      60_000,
    );
    if (!embedResponse.ok) {
      response.status(503).json({
        error: { code: "EMBEDDING_UNAVAILABLE", message: "The local embedding model is unavailable." },
      });
      return;
    }
    const result: unknown = await embedResponse.json();
    const embeddings = z.object({
      embeddings: z.array(z.array(z.number())),
    }).parse(result).embeddings;
    response.json({ embeddings });
  } catch (error) {
    logDependencyFailure("llm_embedding", error);
    response.status(503).json({
      error: { code: "EMBEDDING_UNAVAILABLE", message: "The local embedding model is unavailable." },
    });
  }
});

app.post("/api/vision", async (request, response) => {
  const input = visionBodySchema.parse(request.body);
  if (input.candidates.length === 0) {
    response.status(400).json({
      error: { code: "NO_CANDIDATES", message: "The pack has no species candidates." },
    });
    return;
  }
  const instruction =
    `Select at most 3 items ONLY from this candidate list: ${JSON.stringify(input.candidates)}. ` +
    'Return JSON: {"candidates":[{"commonName":"...","scientificName":"...","confidence":0.5,"visibleTraits":[]}],"observedTraits":[],"followUpQuestion":"...","needsBetterPhoto":false}. ' +
    "If no candidate is a convincing match, return an empty candidates array. This is an unverified suggestion.";
  try {
    const raw = await ollamaChat(
      [
        { role: "system", content: instruction },
        { role: "user", content: "Suggest a cautious identification for the visible subject." },
      ],
      { images: [input.image], json: true },
    );
    const parsed = z.object({
      candidates: z.array(z.object({
        commonName: z.string(),
        scientificName: z.string(),
        confidence: z.number().min(0).max(1),
        visibleTraits: z.array(z.string()),
      })).max(3),
      observedTraits: z.array(z.string()),
      followUpQuestion: z.string(),
      needsBetterPhoto: z.boolean(),
    }).parse(parseJsonObject(raw)) satisfies VisionAnswer;
    const allowed = new Set(input.candidates.map((candidate) => candidate.toLocaleLowerCase()));
    const filtered = parsed.candidates.filter((candidate) =>
      allowed.has(candidate.commonName.toLocaleLowerCase()),
    ).map((candidate) => ({
      ...candidate,
      confidence: Math.min(candidate.confidence, 0.85),
    }));
    response.json({ ...parsed, candidates: filtered, model: llmModel, verified: false });
  } catch (error) {
    logDependencyFailure("llm_vision", error);
    response.status(503).json({
      error: { code: "VISION_UNAVAILABLE", message: "The local vision model could not analyze this photo." },
    });
  }
});

app.post("/api/tts", ttsLimiter, async (request, response) => {
  const input = ttsBodySchema.parse(request.body);
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = input.voiceId ?? process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId) {
    response.status(503).json({
      error: {
        code: "TTS_NOT_CONFIGURED",
        message: "Configure ElevenLabs credentials in the server's local .env file.",
      },
    });
    return;
  }
  try {
    const hash = createHash("sha256")
      .update(input.text)
      .update(voiceId)
      .update("eleven_multilingual_v2")
      .digest("hex");
    const cachePath = join(audioCacheDirectory, `${hash}.mp3`);
    let audio: Uint8Array;
    try {
      audio = new Uint8Array(await readFile(cachePath));
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      const ttsResponse = await fetchWithTimeout(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_64`,
        {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text: input.text,
            model_id: "eleven_multilingual_v2",
          }),
        },
        30_000,
      );
      if (!ttsResponse.ok) {
        response.status(ttsResponse.status === 401 ? 503 : 502).json({
          error: {
            code: "TTS_PROVIDER_ERROR",
            message: "ElevenLabs did not return audio. Check credentials, quota, and voice access.",
          },
        });
        return;
      }
      audio = new Uint8Array(await ttsResponse.arrayBuffer());
      await mkdir(audioCacheDirectory, { recursive: true });
      await writeFile(cachePath, audio);
    }
    response.type("audio/mpeg").send(Buffer.from(audio));
  } catch (error) {
    logDependencyFailure("elevenlabs_tts", error);
    response.status(502).json({
      error: { code: "TTS_PROVIDER_ERROR", message: "ElevenLabs could not be reached." },
    });
  }
});

app.post("/api/contact", (request, response) => {
  const { name, email, message } = request.body ?? {};

  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof message !== "string"
  ) {
    response.status(400).json({ error: "Please complete all fields." });
    return;
  }

  const cleanName = name.trim();
  const cleanEmail = email.trim();
  const cleanMessage = message.trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail);

  if (
    !cleanName ||
    cleanName.length > maxNameLength ||
    cleanEmail.length > maxEmailLength ||
    !validEmail ||
    !cleanMessage ||
    cleanMessage.length > maxMessageLength
  ) {
    response.status(400).json({
      error: "Check your name, email, and message, then try again.",
    });
    return;
  }

  response.status(202).json({
    message:
      "Thanks for reaching out. This starter does not store or send messages yet.",
  });
});

app.use("/api", (request, response) => {
  response.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: `No route for ${request.method} ${request.path}.`,
    },
  });
});

if (existsSync(resolve("dist", "index.html"))) {
  app.use(express.static(resolve("dist"), { index: false }));
  app.get(/.*/, (_request, response, next) => {
    response.sendFile(resolve("dist", "index.html"), (error) => {
      if (error && !response.headersSent) next(error);
    });
  });
}

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({
        error: { code: "INVALID_REQUEST", message: "The request did not match the expected schema." },
      });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      response.status(400).json({
        error: { code: "INVALID_JSON", message: "The request body must be valid JSON." },
      });
      return;
    }
    if (
      error instanceof Error &&
      "type" in error &&
      error.type === "entity.too.large"
    ) {
      response.status(413).json({
        error: { code: "REQUEST_TOO_LARGE", message: "The request is too large." },
      });
      return;
    }
    console.error(JSON.stringify({
      event: "request_failed",
      error: error instanceof Error ? error.name : "UnknownError",
    }));
    if (!response.headersSent) {
      response.status(500).json({
        error: { code: "INTERNAL_ERROR", message: "The request could not be completed." },
      });
    }
  },
);

const server = app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

async function closeServer(): Promise<void> {
  server.close();
  await mongoClient?.close();
}

process.once("SIGINT", () => { void closeServer(); });
process.once("SIGTERM", () => { void closeServer(); });
