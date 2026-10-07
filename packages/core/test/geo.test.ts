import assert from "node:assert/strict";
import test from "node:test";
import {
  boundingBoxAreaKm2,
  distanceMeters,
  BoundingBoxSchema,
  CoordinatesSchema,
  GeoJsonPointSchema,
} from "../src/index";

test("validates GeoJSON coordinates as longitude then latitude", () => {
  assert.deepEqual(CoordinatesSchema.parse([-73.9857, 40.7484]), [
    -73.9857,
    40.7484,
  ]);
  assert.equal(CoordinatesSchema.safeParse([181, 40]).success, false);
  assert.equal(GeoJsonPointSchema.safeParse({
    type: "Point",
    coordinates: [12, 91],
  }).success, false);
});

test("rejects inverted bounding boxes", () => {
  assert.equal(
    BoundingBoxSchema.safeParse({
      west: 2,
      south: 0,
      east: 1,
      north: 1,
    }).success,
    false,
  );
});

test("computes zero distance for the same point", () => {
  assert.equal(distanceMeters([0, 0], [0, 0]), 0);
});

test("computes a known approximate equatorial distance", () => {
  assert.ok(
    Math.abs(distanceMeters([0, 0], [1, 0]) - 111_195) < 10,
  );
});

test("computes spherical bounding-box area", () => {
  const area = boundingBoxAreaKm2({
    west: 0,
    south: 0,
    east: 1,
    north: 1,
  });
  assert.ok(area > 12_300 && area < 12_400);
});
