import * as THREE from 'three';
import { TerrainTextureForge, NB, WALL, DEFAULT_D } from '../terrain/terrainTextureForge.ts';
import { CONFIG } from '../../config.ts';

const GLSL_NOISE = `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  // Ruído de valor suave (para variar a linha rocha/terra das falésias)
  float vn2(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
  }
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

    // Projeção das falésias em 8 direções (a cada 45°): o eixo horizontal da textura segue a
    // direção da parede arredondada para o octante mais próximo. Com só 2 planos (X/Z) as
    // paredes na diagonal esticavam a textura até ~1.4x; com 8 o máximo é ~1.08x.
    float wAng = atan(wn.z, wn.x);
    // troca de octante com dither: a costura vira um recorte pixelado em vez de linha reta
    float wOct = floor(wAng / 0.78539816 + 0.5 + dth * 0.7) * 0.78539816;
    vec2 wTan = vec2(-sin(wOct), cos(wOct));
    vec2 uvW = vec2(dot(vWPos.xz, wTan), vWPos.y);
    uvW *= totalD / ${WALL.toFixed(1)};

    // Mesma ideia para o atlas das paredes: derivadas antes do fract() (que dá um salto a cada
    // repetição) e dos dois eixos biplanares, escolhendo o eixo sem depender dos vizinhos.
    float wallScale = totalD / ${WALL.toFixed(1)};
    vec2 wallRowScale = vec2(1.0, 1.0 / ${NB.toFixed(1)});
    vec3 dPX = dFdx(vWPos), dPY = dFdy(vWPos);
    vec2 dWallX = vec2(dot(dPX.xz, wTan), dPX.y) * wallScale * wallRowScale;
    vec2 dWallY = vec2(dot(dPY.xz, wTan), dPY.y) * wallScale * wallRowScale;

    // Faixa vertical do atlas correspondente ao bioma, guardado no alfa da textura escura.
    // texelFetch lê o valor exato do texel (sem filtro nem mipmap misturando índices).
    ivec2 topSize = textureSize(uTopD, 0);
    ivec2 bioTexel = clamp(ivec2(uvTop * vec2(topSize)), ivec2(0), topSize - 1);
    float bi = floor(texelFetch(uTopD, bioTexel, 0).a * 255.0 + 0.5);
    // Terra da encosta com as saliências esticadas na vertical: vista de cima a parede aparece
    // encurtada, e sem isso as saliências viravam listras finas ("veio de madeira").
    const float DIRT_V = 0.7;
    vec2 uvD = vec2(uvW.x, (fract(uvW.y * DIRT_V) + bi) / ${NB.toFixed(1)});
    vec2 dDirtX = dWallX * vec2(1.0, DIRT_V), dDirtY = dWallY * vec2(1.0, DIRT_V);
    uvW = vec2(uvW.x, (fract(uvW.y) + bi) / ${NB.toFixed(1)});

    // Rocha na base, solo/estratos acima — limite com dither
    // A rocha não termina numa linha reta: sobe em afloramentos largos e entra na terra em
    // "dentes" menores, como os blocos que brotam do barranco na referência.
    float rockVar = (vn2(vWPos.xz * 0.045) - 0.5) * 9.0 + (vn2(vWPos.xz * 0.21 + 7.3) - 0.5) * 3.0
                  + (vn2(vWPos.xz * 0.8 + 3.1) - 0.5) * 0.9;
    float yl = uRockY + rockVar + dth * 1.6;
    float bel = yl - vWPos.y;
    // Paredão com a altura conhecida (vWall: metros até a borda de cima e até o pé): rocha da
    // metade para baixo da PRÓPRIA parede, com a mesma linha recortada. Pela altura absoluta, as
    // paredes que começam acima de ~10m (mesas, degraus altos) ficavam só de terra.
    if (vWall.x > 0.5 && vWall.x < 90.0 && vWall.y > 0.5 && vWall.y < 90.0) {
      float rimW = vWall.x - 1.0, baseW = vWall.y - 1.0, wallH = rimW + baseW;
      // só paredões altos (12m+): encostas e degraus baixos seguem a regra antiga (terra, rocha só
      // perto do nível do mar); a faixa de rocha cresce até a metade da parede entre 12m e 20m
      // e só na face quase vertical (mais de ~60°): uma encosta longa também soma 12m de altura
      vec3 fN = normalize(cross(dPX, dPY));
      if (wallH > 12.0 && abs(fN.y) < 0.5) {
        float f = 0.5 * smoothstep(12.0, 20.0, wallH);
        // divisa irregular, proporcional à altura da parede: ondas largas (~14m, ±22% da altura),
        // recortes médios (~4m, ±7%) e dentes pequenos (~1m) - com só ±2m ela saía quase reta
        float rv = (vn2(vWPos.xz * 0.07 + 13.1) - 0.5) * 0.45 * wallH
                 + (vn2(vWPos.xz * 0.23 + 5.1) - 0.5) * 0.15 * wallH
                 + (vn2(vWPos.xz * 0.9 + 2.2) - 0.5) * 1.0;
        bel = wallH * f - baseW + rv + dth * 1.2;
      }
    }
    float rk = step(0.0, bel);

    // Sombra de contato ditherizada nas duas faces do vinco
    float ct  = rk * (1.0 - step(uCt * (1.0 + dth * 1.2), bel));
    float ctD = (1.0 - rk) * (1.0 - step(uCt * 0.85 * (1.0 + dth * 1.2), -bel));
    vec3 rockCol = mix(textureGrad(uWallB, uvW, dWallX, dWallY).rgb, textureGrad(uWallC, uvW, dWallX, dWallY).rgb, ct);
    vec3 dirtCol = mix(textureGrad(uWallA, uvD, dDirtX, dDirtY).rgb, textureGrad(uWallD, uvD, dDirtX, dDirtY).rgb, ctD);
    vec3 wall = mix(dirtCol, rockCol, rk);

    // Amostragem das texturas de topo
    vec4 topS = textureGrad(uTop, uvTop, dTopX, dTopY);
    vec4 topDarkS = textureGrad(uTopD, uvTop, dTopX, dTopY);

    // Transição de encosta: o topo manda nas partes planas, a falésia nas íngremes.
    // Onde a vegetação está marcada no canal alfa (topS.a > 0.5), o limiar sobe:
    // a grama escorre pela quebra da encosta (hang) em dentes pixelados irregulares.
    // Inclinação: a do normal interpolado ou, onde a malha traz (vWall.z), a inclinação máxima até
    // os vértices vizinhos, interpolada - suave entre triângulos (a do próprio triângulo deixava a
    // quina dos paredões em dentes de serra e pontilhava a grama) e que no pé do paredão já enxerga
    // a parede ao lado (com o normal, a grama esticava pela parede em triângulos verdes)
    float slope = 1.0 - abs(wn.y);
    if (vWall.x > 0.5) slope = max(slope, vWall.z);
    // Limiar estreito e com teto de 0.46 (~57°): com o pontilhado largo (±0.17) e a grama da quina
    // subindo o limiar até 0.55-1.0, encostas de ~55-60° ficavam com cada pixel escolhendo entre a
    // parede e a textura do chão esticada ~2x (manchas misturadas, fios verdes)
    float thr = min(0.46, 0.38 + dth * 0.12 + topS.a * (uHang * 0.4 + dth * 0.12));
    float m = step(thr, slope);

    // Borda de vinco escurecida na vegetação que desce a encosta
    // (a antiga "borda escura" da grama na quebra da encosta saiu: na quina arredondada das mesas
    // e degraus ela virava uma linha escura no meio da grama; a grama que escorre pela parede
    // - mais abaixo - já faz esse papel)
    float rim = 0.0;
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
    // Pontilhado leve: no estilo diorama as áreas lisas são limpas (o detalhe vem das formas)
    float detailStrength = clamp((uPixelScale - 0.6) * 1.1, 0.0, 1.0) * 0.35;
    vec3 topC = mix(topBase, subPixelCol, detailStrength);

    // Barranco baixo na beira d'água (até ~1.5m): segue a textura do chão (areia/terra da margem),
    // só um pouco mais escura na face íngreme. A textura de falésia num degrau desse tamanho virava
    // um recorte de losangos coloridos.
    // A face lê o chão uns 3m para dentro da terra: no próprio lugar dela a textura é a do fundo
    // debaixo d'água (escura e manchada).
    // até 3m: com a margem elevada (até 1.5m) e o vale em volta, os barrancos de lago passam de 1.5m
    float lowBank = 1.0 - step(3.0 + dth * 0.6, vWPos.y);
    // (vale também para faces que a grama da quina ainda cobriria - inclinação acima de ~0.3 -
    // senão a grama do chão esticava pela face do barranco)
    if (lowBank > 0.0 && (m > 0.0 || slope > 0.3)) {
      vec2 inland = -normalize(wn.xz + vec2(1e-5));
      vec2 uvBank = clamp((pixWorld + inland * 3.0 - uOrig) / uSize, 0.0, 1.0);
      vec4 bankS = textureLod(uTop, uvBank, 0.0);
      // chão de vegetação acima: a face vira areia (a grama esticada ficava em listras verdes, e a
      // terra das paredes em listras marrons) - a areia molhada 1m para dentro da margem, ou uma
      // areia fixa se ali ainda é grama
      if (bankS.a > 0.4) {
        vec2 uvNear = clamp((pixWorld + inland * 1.0 - uOrig) / uSize, 0.0, 1.0);
        bankS = textureLod(uTop, uvNear, 0.0);
        if (bankS.a > 0.4) bankS.rgb = vec3(0.78, 0.62, 0.42);
      }
      topC = bankS.rgb * 0.84;
    }
    m *= 1.0 - lowBank;

    // Paredões: grama escorrendo da borda de cima e terra subindo pelo pé. vWall = metros abaixo
    // da borda e acima do pé (+1; 0 = geometria sem a informação). O comprimento varia por coluna
    // de pixels ao longo da parede (fios de grama de tamanhos diferentes), com contorno pixelado.
    if (m > 0.0 && vWall.x > 0.5) {
      float rimD = vWall.x - 1.0, baseH = vWall.y - 1.0;
      float col = floor(dot(vWPos.xz, wTan) * totalD);
      float along = col / totalD;
      float colR = h21(vec2(floor(col / 2.0), 7.0));
      float drip = 0.5 + 1.6 * vn2(vec2(along * 0.55, 3.1)) + 1.4 * colR * colR + dth * 0.35;
      // em paredes baixas (barrancos de 2-3m) a grama e a terra de tamanho fixo cobriam a face toda,
      // misturadas e esticadas: no máximo ~30% da altura da parede, e nada abaixo de 2.5m
      float wallHt = (rimD < 90.0 && baseH < 90.0) ? rimD + baseH : 99.0;
      drip = wallHt < 2.5 ? -1.0 : min(drip, wallHt * 0.3);
      if (rimD < drip) {
        // cor da grama do topo, lida um pouco para dentro do platô
        vec2 inland = -normalize(wn.xz + vec2(1e-5));
        vec2 uvG = clamp((pixWorld + inland * (2.5 + rimD) - uOrig) / uSize, 0.0, 1.0);
        // nível 0 da textura: com as derivadas da parede (UV variando muito por pixel) caía num
        // mipmap borrado e a grama que escorre virava uma faixa verde lisa
        vec4 g = textureLod(uTop, uvG, 0.0);
        vec4 gd = textureLod(uTopD, uvG, 0.0);
        // só onde o topo tem vegetação; a ponta dos fios fica no tom escuro
        if (g.a > 0.4) wall = rimD > drip - 0.45 ? gd.rgb : g.rgb;
      }
      float creep = 0.4 + 1.5 * vn2(vec2(along * 0.4, 11.3)) + 0.8 * h21(vec2(floor(col / 3.0), 19.0)) + dth * 0.35;
      if (baseH < 90.0 && rimD < 90.0) creep = min(creep, (rimD + baseH) * 0.25);
      if (baseH < creep) {
        // terra do barranco subindo pelo pé, com a borda de cima um degrau mais escura
        vec3 soil = textureGrad(uWallA, uvD, dDirtX, dDirtY).rgb;
        vec3 soilD = textureGrad(uWallD, uvD, dDirtX, dDirtY).rgb;
        wall = baseH > creep - 0.35 ? soilD : soil;
      }
    }

    diffuseColor.rgb = mix(topC, wall, m);

    // Neve: o tonemapping deixava o branco puro acinzentado. Só os pixels quase brancos (neve e
    // gelo) ganham um leve brilho próprio, para ficarem brancos como na referência de inverno.
    float snowish = smoothstep(0.84, 0.95, min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b));
    totalEmissiveRadiance += diffuseColor.rgb * 0.30 * snowish;
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

    sh.vertexShader = 'attribute vec3 wallInfo;\nvarying vec3 vWall;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vWall = wallInfo;
       vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vWNrm = normalize((modelMatrix * vec4(normal, 0.0)).xyz);`
    );

    const uniformDecls = `
      uniform sampler2D uTop;
      uniform sampler2D uTopD;
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

    sh.fragmentShader = 'varying vec3 vWall;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n' +
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
  const mat = createChunkTerrainMaterial(forge, dummyTex, dummyTex, 0, 0, CONFIG.CHUNK_SIZE);
  return mat as unknown as THREE.ShaderMaterial;
}
