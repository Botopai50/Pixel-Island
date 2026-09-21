import * as THREE from 'three';
import { TerrainTextureForge, NB, WALL, DEFAULT_D } from '../terrain/terrainTextureForge.ts';
import { CONFIG } from '../../config.ts';

const GLSL_NOISE = `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  // Ruído em bloco para dither cel-shaded: clusters, não chiado de pixels soltos
  float clg(vec2 t){
    return h21(floor(t * 0.5)) * 0.30
         + h21(floor((t + vec2(1.0, 3.0)) / 3.0) + 17.0) * 0.32
         + h21(floor((t + vec2(5.0, 2.0)) / 5.0) + 53.0) * 0.22
         + h21(floor((t + vec2(3.0, 6.0)) / 9.0) + 91.0) * 0.16;
  }
`;

export interface ChunkMaterialUniforms {
  uTop: { value: THREE.DataTexture };
  uTopD: { value: THREE.DataTexture };
  uBio: { value: THREE.DataTexture };
  uWallA: { value: THREE.DataTexture };
  uWallB: { value: THREE.DataTexture };
  uWallC: { value: THREE.DataTexture };
  uWallD: { value: THREE.DataTexture };
  uD: { value: number };
  uSize: { value: number };
  uOrig: { value: THREE.Vector2 };
  uHang: { value: number };
  uCt: { value: number };
  uRockY: { value: number };
}

/**
 * Cria o material de terreno toon biplanar específico para um chunk,
 * vinculando os atlas globais e as texturas procedurais locais geradas pelo forge.
 */
export function createChunkTerrainMaterial(
  forge: TerrainTextureForge,
  topTex: THREE.DataTexture,
  topDarkTex: THREE.DataTexture,
  bioTex: THREE.DataTexture,
  originX: number,
  originZ: number,
  chunkSize: number = CONFIG.CHUNK_SIZE
): THREE.MeshToonMaterial {
  const density = forge.density || DEFAULT_D;
  const hang = forge.params.hang || 0.20;

  const mat = new THREE.MeshToonMaterial({
    gradientMap: forge.gradMap,
    color: 0xffffff,
  });

  const customUniforms: ChunkMaterialUniforms = {
    uTop:   { value: topTex },
    uTopD:  { value: topDarkTex },
    uBio:   { value: bioTex },
    uWallA: { value: forge.wallA },
    uWallB: { value: forge.wallB },
    uWallC: { value: forge.wallC },
    uWallD: { value: forge.wallD },
    uD:     { value: density },
    uSize:  { value: chunkSize },
    uOrig:  { value: new THREE.Vector2(originX, originZ) },
    uHang:  { value: hang },
    uCt:    { value: 2.2 / density },
    uRockY: { value: 9.5 },
  };

  mat.userData = { uniforms: customUniforms };

  const fragShaderPatch = `
    vec3 wn = normalize(vWNrm);
    vec2 texel = vWPos.xz * uD;
    float dth = clg(texel) - 0.5;

    // UV local do CHUNK: cada chunk tem sua textura no topo
    vec2 uvTop = (vWPos.xz - uOrig) / uSize;
    uvTop = clamp(uvTop, 0.0, 1.0);

    // Mapeamento biplanar nas falésias e paredes verticais
    vec2 uvW = (abs(wn.x) > abs(wn.z) ? vec2(vWPos.z, vWPos.y) : vec2(vWPos.x, vWPos.y));
    uvW *= uD / ${WALL.toFixed(1)};

    // Faixa vertical do atlas correspondente ao bioma lido da textura de bioma
    float bi = floor(texture2D(uBio, uvTop).r * 255.0 + 0.5);
    uvW = vec2(uvW.x, (fract(uvW.y) + bi) / ${NB.toFixed(1)});

    // Rocha na base, solo/estratos acima — limite com dither
    float yl = uRockY + dth * 1.6;
    float bel = yl - vWPos.y;
    float rk = step(0.0, bel);

    // Sombra de contato ditherizada nas duas faces do vinco
    float ct  = rk * (1.0 - step(uCt * (1.0 + dth * 1.2), bel));
    float ctD = (1.0 - rk) * (1.0 - step(uCt * 0.85 * (1.0 + dth * 1.2), -bel));
    vec3 rockCol = mix(texture2D(uWallB, uvW).rgb, texture2D(uWallC, uvW).rgb, ct);
    vec3 dirtCol = mix(texture2D(uWallA, uvW).rgb, texture2D(uWallD, uvW).rgb, ctD);
    vec3 wall = mix(dirtCol, rockCol, rk);

    // Transição de encosta: o topo manda nas partes planas, a falésia nas íngremes.
    // Onde a vegetação está marcada no canal alfa (topS.a > 0.5), o limiar sobe:
    // a grama escorre pela quebra da encosta (hang) em dentes pixelados irregulares.
    vec4 topS = texture2D(uTop, uvTop);
    float slope = 1.0 - abs(wn.y);
    float thr = 0.40 + dth * 0.34 + topS.a * (uHang + dth * 0.60);
    float m = step(thr, slope);

    // Borda de vinco escurecida na vegetação que desce a encosta
    float rim = topS.a * (1.0 - m) * step(thr - 0.10 * (1.0 + dth * 1.4), slope);
    vec3 topC = mix(topS.rgb, texture2D(uTopD, uvTop).rgb, rim);

    diffuseColor.rgb = mix(topC, wall, m);
  `;

  mat.onBeforeCompile = (sh) => {
    // Vincula os uniforms locais por referência
    Object.assign(sh.uniforms, {
      uTop: customUniforms.uTop,
      uTopD: customUniforms.uTopD,
      uBio: customUniforms.uBio,
      uWallA: customUniforms.uWallA,
      uWallB: customUniforms.uWallB,
      uWallC: customUniforms.uWallC,
      uWallD: customUniforms.uWallD,
      uD: customUniforms.uD,
      uSize: customUniforms.uSize,
      uOrig: customUniforms.uOrig,
      uHang: customUniforms.uHang,
      uCt: customUniforms.uCt,
      uRockY: customUniforms.uRockY,
    });

    sh.vertexShader = 'varying vec3 vWPos;\nvarying vec3 vWNrm;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vWNrm = normalize((modelMatrix * vec4(normal, 0.0)).xyz);`
    );

    const uniformDecls = `
      uniform sampler2D uTop;
      uniform sampler2D uTopD;
      uniform sampler2D uBio;
      uniform sampler2D uWallA;
      uniform sampler2D uWallB;
      uniform sampler2D uWallC;
      uniform sampler2D uWallD;
      uniform float uD;
      uniform float uSize;
      uniform vec2 uOrig;
      uniform float uHang;
      uniform float uCt;
      uniform float uRockY;
    `;

    sh.fragmentShader = 'varying vec3 vWPos;\nvarying vec3 vWNrm;\n' +
      uniformDecls + '\n' +
      GLSL_NOISE + '\n' +
      sh.fragmentShader.replace('#include <map_fragment>', fragShaderPatch);
  };

  // Garante que todos os chunks compartilhem o mesmo WebGLProgram compilado na GPU
  mat.customProgramCacheKey = () => 'pixel_terrain_forge_toon_program';

  return mat;
}

/**
 * Fallback padrão caso necessário em algum teste estático
 */
export function createTerrainMaterial(): THREE.ShaderMaterial {
  const forge = TerrainTextureForge.getInstance(42);
  const dummyTex = forge.gradMap;
  const mat = createChunkTerrainMaterial(forge, dummyTex, dummyTex, dummyTex, 0, 0, CONFIG.CHUNK_SIZE);
  return mat as unknown as THREE.ShaderMaterial;
}
