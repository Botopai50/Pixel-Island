import * as THREE from 'three';

/**
 * O plano de vegetação de um chunk (vegetationPlanner.ts) feito num worker: matrizes e cores do three.js perdem a classe ao atravessar o
 * postMessage, então elas viram dados simples aqui (toWire) e voltam a ser Matrix4 e Color na thread principal (fromWire). As cores guardam os
 * valores internos (lineares) e voltam do mesmo jeito, sem nova conversão de sRGB.
 */
export function toWire(v: unknown): unknown {
  if (v && typeof v === 'object') {
    const o = v as { isMatrix4?: boolean; isColor?: boolean; isVector3?: boolean; elements?: number[]; r?: number; g?: number; b?: number; x?: number; y?: number; z?: number };
    if (o.isMatrix4) return { __m: Array.from(o.elements!) };
    if (o.isColor) return { __c: [o.r, o.g, o.b] };
    if (o.isVector3) return { __v: [o.x, o.y, o.z] };
    if (Array.isArray(v)) return v.map(toWire);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object)) out[k] = toWire((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

export function fromWire<T>(v: unknown): T {
  if (v && typeof v === 'object') {
    if (Array.isArray(v)) return v.map((x) => fromWire(x)) as unknown as T;
    const o = v as { __m?: number[]; __c?: number[]; __v?: number[] };
    if (o.__m) return new THREE.Matrix4().fromArray(o.__m) as unknown as T;
    if (o.__c) return new THREE.Color().setRGB(o.__c[0], o.__c[1], o.__c[2], THREE.LinearSRGBColorSpace) as unknown as T;
    if (o.__v) return new THREE.Vector3(o.__v[0], o.__v[1], o.__v[2]) as unknown as T;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as object)) out[k] = fromWire((v as Record<string, unknown>)[k]);
    return out as T;
  }
  return v as T;
}
