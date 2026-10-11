import { z } from "zod";

export const CoordinatesSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

export const GeoJsonPointSchema = z.object({
  type: z.literal("Point"),
  coordinates: CoordinatesSchema,
});

export const BoundingBoxSchema = z
  .object({
    west: z.number().min(-180).max(180),
    south: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
  })
  .refine(
    ({ west, south, east, north }) => west < east && south < north,
    "Bounding box must have west < east and south < north.",
  );

export const PackCountsSchema = z.object({
  pois: z.number().int().nonnegative(),
  species: z.number().int().nonnegative(),
  chunks: z.number().int().nonnegative(),
  audio: z.number().int().nonnegative(),
});

export const PackManifestSchema = z.object({
  formatVersion: z.number().int().positive(),
  packId: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  version: z.string().min(1),
  createdAt: z.iso.datetime(),
  bbox: BoundingBoxSchema,
  center: GeoJsonPointSchema,
  embeddingModel: z.string().min(1),
  embeddingDim: z.number().int().positive(),
  counts: PackCountsSchema,
  files: z.record(z.string().min(1), z.string().regex(/^[a-f0-9]{64}$/i)),
  attribution: z.array(z.string().min(1)),
});

export const AskRequestSchema = z.object({
  packSlug: z.string().min(1).max(100),
  question: z.string().trim().min(1).max(1000),
  chunks: z.array(
    z.object({
      id: z.string().min(1).max(100),
      text: z.string().min(1).max(3000),
    }).strict(),
  ).max(5),
  month: z.number().int().min(1).max(12).optional(),
  poiName: z.string().max(200).optional(),
}).strict();

export type Coordinates = z.infer<typeof CoordinatesSchema>;
export type GeoJsonPoint = z.infer<typeof GeoJsonPointSchema>;
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;
export type PackManifest = z.infer<typeof PackManifestSchema>;
export type AskRequest = z.infer<typeof AskRequestSchema>;
