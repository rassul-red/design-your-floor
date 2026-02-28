declare module 'polygon-clipping' {
  const polygonClipping: {
    union: (...geometries: unknown[]) => unknown;
    difference: (...geometries: unknown[]) => unknown;
    intersection: (...geometries: unknown[]) => unknown;
  };

  export default polygonClipping;
}
