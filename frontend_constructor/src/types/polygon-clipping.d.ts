declare module 'polygon-clipping' {
  type Pair = [number, number];
  type Ring = Pair[];
  type Polygon = Ring[];
  type MultiPolygon = Polygon[];

  interface PolygonClipping {
    union(subject: Polygon, ...clips: Polygon[]): MultiPolygon;
    difference(subject: Polygon | MultiPolygon, clip: Polygon | MultiPolygon): MultiPolygon;
    intersection(subject: Polygon, ...clips: Polygon[]): MultiPolygon;
    xor(subject: Polygon, ...clips: Polygon[]): MultiPolygon;
  }

  const polygonClipping: PolygonClipping;
  export default polygonClipping;
}
