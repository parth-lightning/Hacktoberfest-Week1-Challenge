import { distanceMeters } from "../../packages/core/src/index";
import type { Coordinates, Poi } from "../../packages/core/src/index";

export type LocationFix = {
  coordinates: Coordinates;
  accuracy: number;
  speedMps: number;
  timestamp: number;
};

export type GeofenceEvent =
  | { type: "trigger"; poi: Poi; distanceM: number }
  | { type: "ignored"; reason: "accuracy" | "speed" | "cooldown" | "outside" };

export class GeofenceEngine {
  private readonly played = new Set<string>();
  private readonly inside = new Set<string>();
  private lastNarrationAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly pois: Poi[],
    private readonly options: {
      cooldownMs?: number;
      maxSpeedMps?: number;
      accuracyLimitM?: number;
      hysteresisM?: number;
    } = {},
  ) {}

  process(fix: LocationFix): GeofenceEvent {
    const accuracyLimitM = this.options.accuracyLimitM ?? 50;
    const maxSpeedMps = this.options.maxSpeedMps ?? 2.5;
    if (fix.accuracy > accuracyLimitM) return { type: "ignored", reason: "accuracy" };
    if (fix.speedMps > maxSpeedMps) return { type: "ignored", reason: "speed" };

    const candidates = this.pois
      .filter((poi) => !this.played.has(poi.id))
      .map((poi) => ({
        poi,
        distanceM: distanceMeters(fix.coordinates, poi.coordinates),
      }))
      .sort((left, right) =>
        left.poi.priority - right.poi.priority || left.distanceM - right.distanceM,
      );

    const activeIds = new Set<string>();
    for (const candidate of candidates) {
      const exitRadius = candidate.poi.radiusM + (this.options.hysteresisM ?? 15);
      if (candidate.distanceM <= exitRadius) activeIds.add(candidate.poi.id);
    }
    for (const id of this.inside) {
      if (
        !this.played.has(id) &&
        !activeIds.has(id)
      ) this.inside.delete(id);
    }
    for (const id of activeIds) this.inside.add(id);

    const ready = candidates.find(
      ({ poi, distanceM }) =>
        distanceM <= poi.radiusM && !this.played.has(poi.id),
    );
    if (!ready) return { type: "ignored", reason: "outside" };

    const cooldownMs = this.options.cooldownMs ?? 20_000;
    if (fix.timestamp - this.lastNarrationAt < cooldownMs) {
      return { type: "ignored", reason: "cooldown" };
    }
    this.played.add(ready.poi.id);
    this.lastNarrationAt = fix.timestamp;
    return { type: "trigger", poi: ready.poi, distanceM: ready.distanceM };
  }

  markPlayed(poiId: string): void {
    this.played.add(poiId);
  }

  reset(): void {
    this.played.clear();
    this.inside.clear();
    this.lastNarrationAt = Number.NEGATIVE_INFINITY;
  }

  getPlayedIds(): string[] {
    return [...this.played];
  }
}
