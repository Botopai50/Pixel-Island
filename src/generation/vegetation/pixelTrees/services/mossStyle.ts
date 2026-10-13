// @ts-nocheck
/** Shared tree-bark moss: cushions eight texels across, broken into finer
 * tufts. Both shaders sample it at texel centres, keeping the ragged edges. */
export function pixelMossNoiseAt(x: number, y: number, z: number): number {
  const hash = (a: number, b: number, c: number) => {
    const value = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453123;
    return value - Math.floor(value);
  };
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const smooth = (v: number) => v * v * (3 - 2 * v);
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const plane = (k: number) => mix(mix(hash(ix, iy, k), hash(ix + 1, iy, k), fx),
    mix(hash(ix, iy + 1, k), hash(ix + 1, iy + 1, k), fx), fy);
  return mix(plane(iz), plane(iz + 1), fz);
}

export function pixelMossNoiseGLSL(seedUniform: string): string {
  return /* glsl */ `
    float mhash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123); }
    float mnoise3(vec3 p) {
      vec3 i = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(mix(mhash3(i), mhash3(i + vec3(1.0, 0.0, 0.0)), f.x),
            mix(mhash3(i + vec3(0.0, 1.0, 0.0)), mhash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
        mix(mix(mhash3(i + vec3(0.0, 0.0, 1.0)), mhash3(i + vec3(1.0, 0.0, 1.0)), f.x),
            mix(mhash3(i + vec3(0.0, 1.0, 1.0)), mhash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
        f.z);
    }
    float mossField(vec3 p) {
      return mnoise3(p / 8.0 + ${seedUniform}) * 0.75
        + mnoise3(p / 3.0 + 17.0 + ${seedUniform}) * 0.25;
    }
  `;
}
