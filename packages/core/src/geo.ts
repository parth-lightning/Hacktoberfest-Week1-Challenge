import type { BoundingBox, Coordinates } from "./schemas";

const earthRadiusMeters = 6_371_008.8;
const degreesToRadians = Math.PI / 180;

export function distanceMeters(
  from: Coordinates,
  to: Coordinates,
): number {
  const [fromLongitude, fromLatitude] = from;
  const [toLongitude, toLatitude] = to;
  const latitudeDelta = (toLatitude - fromLatitude) * degreesToRadians;
  const longitudeDelta = (toLongitude - fromLongitude) * degreesToRadians;
  const fromLatitudeRadians = fromLatitude * degreesToRadians;
  const toLatitudeRadians = toLatitude * degreesToRadians;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitudeRadians) *
      Math.cos(toLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2;

  return (
    2 *
    earthRadiusMeters *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

export function boundingBoxAreaKm2(box: BoundingBox): number {
  const longitudeWidth =
    (box.east - box.west) * degreesToRadians;
  const northSine = Math.sin(box.north * degreesToRadians);
  const southSine = Math.sin(box.south * degreesToRadians);

  return (
    (earthRadiusMeters / 1000) ** 2 *
    longitudeWidth *
    (northSine - southSine)
  );
}
