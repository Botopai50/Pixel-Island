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
  // Matriz Bayer 4x4 exata para quantização e dithering de micro-pixels cel-shaded
  float bayer4(vec2 p){
    vec2 b = floor(mod(p, 4.0));
    float v = 0.0;
    if (b.y < 1.0) {
      v = (b.x < 1.0) ? 0.0 : (b.x < 2.0) ? 8.0 : (b.x < 3.0) ? 2.0 : 10.0;
    } else if (b.y < 2.0) {
      v = (b.x < 1.0) ? 12.0 : (b.x < 2.0) ? 4.0 : (b.x < 3.0) ? 14.0 : 6.0;
    } else if (b.y < 3.0) {
      v = (b.x < 1.0) ? 3.0 : (b.x < 2.0) ? 11.0 : (b.x < 3.0) ? 1.0 : 9.0;
    } else {
      v = (b.x < 1.0) ? 15.0 : (b.x < 2.0) ? 7.0 : (b.x < 3.0) ? 13.0 : 5.0;
    }
    return (v / 16.0) - 0.46875;
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
  uPixelScale: { value: number };
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
  chunkSize: number = CONFIG.CHUNK_SIZE,
  textureDensity?: number
): THREE.MeshToonMaterial {
  // Densidade real das texturas deste chunk (pode ser menor que a do forge, por LOD de distância)
  const density = textureDensity || forge.density || DEFAULT_D;
  const hang = forge.params.hang || 0.20;
  const pixelScale = forge.params.pixelScale || 1.0;

  const mat = new THREE.MeshToonMaterial({
    gradientMap: forge.gradMap,
    color: 0xffffff,
  });
  // O padrão do Three (shadowSide null + FrontSide) desenha as faces de TRÁS no shadow map.
  // Num heightfield aberto isso deixa só as encostas de costas pro sol projetando sombra,
  // gerando sombras descoladas da base das montanhas. Aqui o relevo projeta pela silhueta.
  mat.shadowSide = THREE.FrontSide;

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
    uPixelScale: { value: pixelScale },
  };

  mat.userData = { uniforms: customUniforms };

  const fragShaderPatch = `
    vec3 wn = normalize(vWNrm);
    float totalD = uD * uPixelScale;
    vec2 texel = vWPos.xz * totalD;
    vec2 pixCoord = floor(texel);
    float dth = clg(texel) - 0.5;

    // UV local do CHUNK alinhada perfeitamente na grade de micro-pixels (sub-texels)
    vec2 pixWorld = (pixCoord + 0.5) / totalD;
    vec2 uvTop = clamp((pixWorld - uOrig) / uSize, 0.0, 1.0);

    // Derivadas do UV CONTÍNUO para escolher o nível de mipmap: o uvTop acima é em degraus
    // (encaixe pixel-art), e derivar ele faria a GPU pular de nível na borda de cada texel.
    vec2 uvTopSmooth = (vWPos.xz - uOrig) / uSize;
    vec2 dTopX = dFdx(uvTopSmooth), dTopY = dFdy(uvTopSmooth);

    // Mapeamento biplanar nas falésias e paredes verticais
    bool wallOnX = abs(wn.x) > abs(wn.z);
    vec2 uvW = (wallOnX ? vec2(vWPos.z, vWPos.y) : vec2(vWPos.x, vWPos.y));
    uvW *= totalD / ${WALL.toFixed(1)};

    // Mesma ideia para o atlas das paredes: derivadas antes do fract() (que dá um salto a cada
    // repetição) e dos dois eixos biplanares, escolhendo o eixo sem depender dos vizinhos.
    float wallScale = totalD / ${WALL.toFixed(1)};
    vec2 wallRowScale = vec2(1.0, 1.0 / ${NB.toFixed(1)});
    vec2 dWallX = (wallOnX ? dFdx(vWPos.zy) : dFdx(vWPos.xy)) * wallScale * wallRowScale;
    vec2 dWallY = (wallOnX ? dFdy(vWPos.zy) : dFdy(vWPos.xy)) * wallScale * wallRowScale;

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
    vec3 rockCol = mix(textureGrad(uWallB, uvW, dWallX, dWallY).rgb, textureGrad(uWallC, uvW, dWallX, dWallY).rgb, ct);
    vec3 dirtCol = mix(textureGrad(uWallA, uvW, dWallX, dWallY).rgb, textureGrad(uWallD, uvW, dWallX, dWallY).rgb, ctD);
    vec3 wall = mix(dirtCol, rockCol, rk);

    // Amostragem das texturas de topo
    vec4 topS = textureGrad(uTop, uvTop, dTopX, dTopY);
    vec4 topDarkS = textureGrad(uTopD, uvTop, dTopX, dTopY);

    // Transição de encosta: o topo manda nas partes planas, a falésia nas íngremes.
    // Onde a vegetação está marcada no canal alfa (topS.a > 0.5), o limiar sobe:
    // a grama escorre pela quebra da encosta (hang) em dentes pixelados irregulares.
    float slope = 1.0 - abs(wn.y);
    float thr = 0.40 + dth * 0.34 + topS.a * (uHang + dth * 0.60);
    float m = step(thr, slope);

    // Borda de vinco escurecida na vegetação que desce a encosta
    float rim = topS.a * (1.0 - m) * step(thr - 0.10 * (1.0 + dth * 1.4), slope);
    vec3 topBase = mix(topS.rgb, topDarkS.rgb, rim);

    // Detalhamento em micro-pixels nos caminhos, grama e solo sob os pés do jogador
    float byr = bayer4(pixCoord);
    float microRnd = h21(pixCoord);
    float shadeShift = byr * 0.38 + (microRnd - 0.5) * 0.26;

    vec3 topLight = min(vec3(1.0), topS.rgb * 1.24 + vec3(0.02, 0.03, 0.01));
    vec3 subPixelCol = topBase;
    if (topS.a > 0.4) {
      if (shadeShift > 0.10) {
        subPixelCol = mix(topBase, topLight, clamp((shadeShift - 0.10) * 2.5, 0.0, 1.0));
      } else if (shadeShift < -0.10) {
        subPixelCol = mix(topBase, topDarkS.rgb, clamp((-shadeShift - 0.10) * 2.5, 0.0, 1.0));
      }
    } else {
      if (shadeShift > 0.12) {
        subPixelCol = mix(topBase, topLight, clamp((shadeShift - 0.12) * 2.2, 0.0, 0.8));
      } else if (shadeShift < -0.12) {
        subPixelCol = mix(topBase, topDarkS.rgb, clamp((-shadeShift - 0.12) * 2.2, 0.0, 0.85));
      }
    }

    // Intensidade do detalhamento proporcional ao pixelScale
    float detailStrength = clamp((uPixelScale - 0.6) * 1.1, 0.0, 1.0);
    vec3 topC = mix(topBase, subPixelCol, detailStrength);

    diffuseColor.rgb = mix(topC, wall, m);
  `;

  // Sombra do sol em cascata: as 3 faixas do ShadowClipmap entram no MESMO cálculo de luz
  // direta (em vez de uma delas escurecer só o albedo, o que deixava a sombra de longe mais
  // clara que a de perto). Perto da borda de cada faixa há uma rampa suave para a faixa
  // seguinte, eliminando o degrau visível na troca de resolução.
  const cascadeShadowFns = `
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 2
    float cascadeFade( vec4 sc ) {
      vec3 p = sc.xyz / sc.w;
      if ( p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0 ) return 0.0;
      float edge = min( min( p.x, 1.0 - p.x ), min( p.y, 1.0 - p.y ) );
      return smoothstep( 0.0, 0.15, edge );
    }
    float cascadeSample0() { return getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, vDirectionalShadowCoord[ 0 ] ); }
    float cascadeSample1() { return getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, directionalLightShadows[ 1 ].shadowIntensity, directionalLightShadows[ 1 ].shadowBias, directionalLightShadows[ 1 ].shadowRadius, vDirectionalShadowCoord[ 1 ] ); }
    float cascadeSample2() { return getShadow( directionalShadowMap[ 2 ], directionalLightShadows[ 2 ].shadowMapSize, directionalLightShadows[ 2 ].shadowIntensity, directionalLightShadows[ 2 ].shadowBias, directionalLightShadows[ 2 ].shadowRadius, vDirectionalShadowCoord[ 2 ] ); }
    float cascadedSunShadow() {
      float f0 = cascadeFade( vDirectionalShadowCoord[ 0 ] );
      if ( f0 >= 1.0 ) return cascadeSample0();
      float f1 = cascadeFade( vDirectionalShadowCoord[ 1 ] );
      float s;
      if ( f1 >= 1.0 ) {
        s = cascadeSample1();
      } else {
        float f2 = cascadeFade( vDirectionalShadowCoord[ 2 ] );
        s = f2 > 0.0 ? mix( 1.0, cascadeSample2(), f2 ) : 1.0;
        if ( f1 > 0.0 ) s = mix( s, cascadeSample1(), f1 );
      }
      if ( f0 > 0.0 ) s = mix( s, cascadeSample0(), f0 );
      return s;
    }
    #endif
  `;

  // Só a luz 0 ilumina (as luzes 1 e 2 existem apenas para gerar os shadow maps, com cor
  // zero), então ela recebe a sombra em cascata e as demais pulam a leitura de sombra.
  const dirShadowLine = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
  const cascadedDirShadowLine = `
    #if NUM_DIR_LIGHT_SHADOWS > 2
    #if UNROLLED_LOOP_INDEX == 0
    directLight.color *= ( directLight.visible && receiveShadow ) ? cascadedSunShadow() : 1.0;
    #endif
    #else
    ${dirShadowLine}
    #endif
  `;
  const lightsFragmentBegin = THREE.ShaderChunk.lights_fragment_begin.replace(dirShadowLine, cascadedDirShadowLine);
  if (lightsFragmentBegin === THREE.ShaderChunk.lights_fragment_begin) {
    console.warn('terrainShader: chunk lights_fragment_begin mudou nesta versão do Three; sombra em cascata desativada.');
  }

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
      uPixelScale: customUniforms.uPixelScale,
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
      uniform float uPixelScale;
    `;

    sh.fragmentShader = 'varying vec3 vWPos;\nvarying vec3 vWNrm;\n' +
      uniformDecls + '\n' +
      GLSL_NOISE + '\n' +
      sh.fragmentShader
        .replace('#include <map_fragment>', fragShaderPatch)
        .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n' + cascadeShadowFns)
        .replace('#include <lights_fragment_begin>', lightsFragmentBegin);
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
