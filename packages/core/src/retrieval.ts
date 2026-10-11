import type { Chunk } from "./pack";
import type { Coordinates } from "./schemas";
import { distanceMeters } from "./geo";

const stopWords = new Set([
  "about", "after", "again", "could", "does", "from", "have", "into",
  "just", "more", "that", "them", "there", "these", "they", "this",
  "what", "when", "where", "which", "while", "with", "would", "your",
]);

function terms(text: string): Set<string> {
  return new Set(
    text.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu)?.filter(
      (term) => !stopWords.has(term),
    ) ?? [],
  );
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

export function retrieveChunks(
  query: string,
  chunks: Chunk[],
  options: {
    queryEmbedding?: number[];
    pois?: Array<{ id: string; coordinates: Coordinates }>;
    location?: Coordinates;
    limit?: number;
  } = {},
): Array<{ chunk: Chunk; score: number }> {
  const queryTerms = terms(query);
  const poiDistances = new Map<string, number>();
  if (options.location && options.pois) {
    for (const poi of options.pois) {
      poiDistances.set(
        poi.id,
        distanceMeters(options.location, poi.coordinates),
      );
    }
  }

  return chunks
    .map((chunk) => {
      let score = 0;
      if (options.queryEmbedding && chunk.embedding) {
        score = cosineSimilarity(options.queryEmbedding, chunk.embedding);
      } else {
        const chunkTerms = terms(`${chunk.text} ${chunk.source.title}`);
        let overlap = 0;
        for (const term of queryTerms) {
          if (chunkTerms.has(term)) overlap += 1;
        }
        score = queryTerms.size === 0 ? 0 : overlap / queryTerms.size;
      }
      const poiDistance = chunk.poiId
        ? poiDistances.get(chunk.poiId)
        : undefined;
      if (poiDistance !== undefined && poiDistance <= 300) {
        score += 0.15 * (1 - poiDistance / 300);
      }
      return { chunk, score };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, options.limit ?? 5);
}

export function isForagingOrMedicalQuestion(question: string): boolean {
  return /\b(eat(?:ing)?|edible|safe to eat|forag(?:e|ing)|medicinal|medicine|remed(?:y|ies)|cure|treat(?:ment)?|poisonous|toxic)\b/i.test(
    question,
  );
}
