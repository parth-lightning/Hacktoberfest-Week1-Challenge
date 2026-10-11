import assert from "node:assert/strict";
import test from "node:test";
import { GeofenceEngine } from "./geofence";
import { demoPack } from "./demo-pack";

test("triggers a nearby point once and ignores a repeated entry", () => {
  const poi = demoPack.pois[0];
  assert.ok(poi);
  const engine = new GeofenceEngine([poi]);
  const fix = {
    coordinates: poi.coordinates,
    accuracy: 5,
    speedMps: 1,
    timestamp: 100_000,
  };
  assert.equal(engine.process(fix).type, "trigger");
  assert.deepEqual(engine.process({ ...fix, timestamp: 130_000 }), {
    type: "ignored",
    reason: "outside",
  });
});

test("rejects inaccurate GPS and fast travel", () => {
  const poi = demoPack.pois[0];
  assert.ok(poi);
  const engine = new GeofenceEngine([poi]);
  assert.deepEqual(
    engine.process({
      coordinates: poi.coordinates,
      accuracy: 75,
      speedMps: 0,
      timestamp: 1,
    }),
    { type: "ignored", reason: "accuracy" },
  );
  assert.deepEqual(
    engine.process({
      coordinates: poi.coordinates,
      accuracy: 5,
      speedMps: 4,
      timestamp: 2,
    }),
    { type: "ignored", reason: "speed" },
  );
});

test("applies a cooldown between points", () => {
  const [first, second] = demoPack.pois;
  assert.ok(first);
  assert.ok(second);
  const engine = new GeofenceEngine([first, second]);
  assert.equal(
    engine.process({
      coordinates: first.coordinates,
      accuracy: 5,
      speedMps: 1,
      timestamp: 1_000,
    }).type,
    "trigger",
  );
  assert.deepEqual(
    engine.process({
      coordinates: second.coordinates,
      accuracy: 5,
      speedMps: 1,
      timestamp: 2_000,
    }),
    { type: "ignored", reason: "cooldown" },
  );
});
