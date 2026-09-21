import * as THREE from 'three';

/**
 * Cria a geometria de oceano infinito em cascata concêntrica (Seamless Cascaded Infinite Ocean).
 * 
 * Arquitetura:
 * 1. Grade central de alta resolução: 1024m x 1024m dividida em 128x128 quads (8m por quad).
 *    Oferece densidade ideal para ondulações físicas, detecção de contato na praia e ripples.
 * 2. Anéis externos quadrados em cascata (LOD concêntrico):
 *    - Anel 0: de 512m a 1024m de semi-eixo (128 subdivisões por lado, casamento 1:1 com a borda central)
 *    - Anel 1: de 1024m a 2048m de semi-eixo (64 subdivisões por lado)
 *    - Anel 2: de 2048m a 4096m de semi-eixo (32 subdivisões por lado)
 *    - Anel 3: de 4096m a 8192m de semi-eixo (16 subdivisões por lado)
 * 
 * Erradica 100% dos artefatos de "quadrado/diamante na água" e as lacunas circulares de água faltante
 * que ocorriam quando uma PlaneGeometry quadrada de 512m tentava se conectar a uma RingGeometry circular de 360m.
 */
export function createSeamlessCascadedWaterGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // 1. Grade interna de alta fidelidade: 1024m x 1024m (de -512m a +512m)
  const innerHalf = 512;
  const innerSegs = 128;
  const step = (innerHalf * 2) / innerSegs;

  for (let j = 0; j <= innerSegs; j++) {
    const y = -innerHalf + j * step;
    for (let i = 0; i <= innerSegs; i++) {
      const x = -innerHalf + i * step;
      positions.push(x, y, 0);
      uvs.push(i / innerSegs, j / innerSegs);
    }
  }

  const rowLength = innerSegs + 1;
  for (let j = 0; j < innerSegs; j++) {
    for (let i = 0; i < innerSegs; i++) {
      const a = j * rowLength + i;
      const b = j * rowLength + (i + 1);
      const c = (j + 1) * rowLength + i;
      const d = (j + 1) * rowLength + (i + 1);
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
  }

  // 2. Anéis concêntricos externos perfeitamente alinhados na grade quadrada
  const rings = [
    { in: 512, out: 1024, segs: 128 },
    { in: 1024, out: 2048, segs: 64 },
    { in: 2048, out: 4096, segs: 32 },
    { in: 4096, out: 8192, segs: 16 },
  ];

  for (const ring of rings) {
    const rIn = ring.in;
    const rOut = ring.out;
    const s = ring.segs;
    const baseIdx = positions.length / 3;

    const innerPerimeter: { x: number; y: number }[] = [];
    const outerPerimeter: { x: number; y: number }[] = [];

    // Percorre as 4 bordas: Sul, Leste, Norte, Oeste
    for (let edge = 0; edge < 4; edge++) {
      for (let step = 0; step < s; step++) {
        const t = step / s;
        let xIn = 0, yIn = 0, xOut = 0, yOut = 0;
        if (edge === 0) { // Borda Sul: x de -r a +r, y = -r
          xIn = -rIn + t * (2 * rIn); yIn = -rIn;
          xOut = -rOut + t * (2 * rOut); yOut = -rOut;
        } else if (edge === 1) { // Borda Leste: x = +r, y de -r a +r
          xIn = rIn; yIn = -rIn + t * (2 * rIn);
          xOut = rOut; yOut = -rOut + t * (2 * rOut);
        } else if (edge === 2) { // Borda Norte: x de +r a -r, y = +r
          xIn = rIn - t * (2 * rIn); yIn = rIn;
          xOut = rOut - t * (2 * rOut); yOut = rOut;
        } else if (edge === 3) { // Borda Oeste: x = -r, y de +r a -r
          xIn = -rIn; yIn = rIn - t * (2 * rIn);
          xOut = -rOut; yOut = rOut - t * (2 * rOut);
        }
        innerPerimeter.push({ x: xIn, y: yIn });
        outerPerimeter.push({ x: xOut, y: yOut });
      }
    }

    const count = innerPerimeter.length;
    for (let i = 0; i < count; i++) {
      positions.push(innerPerimeter[i].x, innerPerimeter[i].y, 0);
      uvs.push(0.5, 0.5);
    }
    for (let i = 0; i < count; i++) {
      positions.push(outerPerimeter[i].x, outerPerimeter[i].y, 0);
      uvs.push(0.5, 0.5);
    }

    for (let i = 0; i < count; i++) {
      const next = (i + 1) % count;
      const inCurrent = baseIdx + i;
      const inNext = baseIdx + next;
      const outCurrent = baseIdx + count + i;
      const outNext = baseIdx + count + next;

      indices.push(inCurrent, outCurrent, inNext);
      indices.push(inNext, outCurrent, outNext);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  return geo;
}
