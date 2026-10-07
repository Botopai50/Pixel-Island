import { FADE, FADE_GLSL } from './fadeDither.ts';
import * as THREE from 'three';
import { TerrainTextureForge, NB, WALL, DEFAULT_D } from '../terrain/terrainTextureForge.ts';
import { CONFIG } from '../../config.ts';
import { WET, SHADOW_GRID } from '../../atmosphere/atmosphericFog.ts';
import { THERMAL } from '../geothermal/geothermalManager.ts';
import { FOOTPRINTS, FOOTPRINT_GLSL } from '../../atmosphere/footprints.ts';

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
  /** dissolve da troca de LOD (0-1) e o sentido (0 = aparecendo, 1 = sumindo) */
  uReveal: { value: number };
  uRevealInv: { value: number };
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
    uReveal: { value: 1 },
    uRevealInv: { value: 0 },
  };

  mat.userData = { uniforms: customUniforms };

  const fragShaderPatch = `
    vec3 wn = normalize(vWNrm);
    float totalD = uD * uPixelScale;
    vec2 texel = vWPos.xz * totalD;
    vec2 pixCoord = floor(texel);
    // Anti-cintilação: quantos texels cabem num pixel da tela. O pontilhado por texel (dth, que
    // decide chão x paredão, a divisa da rocha, a grama que escorre) e o detalhe de micro-pixels
    // só valem enquanto o texel tem ~1 pixel ou mais; de longe eles viravam sorteio por pixel e as
    // bordas de neve/rocha das montanhas faiscavam com a câmera andando. Somem suave com a distância.
    vec2 texFw = fwidth(texel);
    float nearK = 1.0 - smoothstep(0.6, 1.6, max(texFw.x, texFw.y));
    float dth = (clg(texel) - 0.5) * nearK;
    // a grama que escorre da borda e a terra que sobe pelo pé do paredão somem MUITO mais longe que o
    // pontilhado (nearK): com nearK, a franja de grama da borda de cima só aparecia quando o texel
    // chegava a ~1 pixel (perto, e antes disso a janela pequena nem mostrava), e ia crescendo aos
    // poucos enquanto o jogador andava
    float nearD = 1.0 - smoothstep(3.5, 9.0, max(texFw.x, texFw.y));

    // UV local do CHUNK alinhada perfeitamente na grade de micro-pixels (sub-texels)
    vec2 pixWorld = (pixCoord + 0.5) / totalD;
    vec2 uvTop = clamp((pixWorld - uOrig) / uSize, 0.0, 1.0);

    // coordenadas de sombra no centro do pixel da textura (chão pouco inclinado; nos paredões e
    // de longe, onde o pixel some, o ponto exato). A altura acompanha a inclinação do terreno.
    #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 2
    gSC0 = vDirectionalShadowCoord[ 0 ]; gSC1 = vDirectionalShadowCoord[ 1 ]; gSC2 = vDirectionalShadowCoord[ 2 ];
    if (uShadowGrid > 0.5 && wn.y > 0.55 && nearK > 0.0) {
      vec2 dxz = pixWorld - vWPos.xz;
      vec3 sp = vec3(pixWorld.x, vWPos.y - (wn.x * dxz.x + wn.z * dxz.y) / wn.y, pixWorld.y);
      gSC0 = uSM[ 0 ] * vec4(sp + wn * uSNB.x, 1.0);
      gSC1 = uSM[ 1 ] * vec4(sp + wn * uSNB.y, 1.0);
      gSC2 = uSM[ 2 ] * vec4(sp + wn * uSNB.z, 1.0);
    }
    #endif

    // Derivadas do UV CONTÍNUO para escolher o nível de mipmap: o uvTop acima é em degraus
    // (encaixe pixel-art), e derivar ele faria a GPU pular de nível na borda de cada texel.
    vec2 uvTopSmooth = (vWPos.xz - uOrig) / uSize;
    vec2 dTopX = dFdx(uvTopSmooth), dTopY = dFdy(uvTopSmooth);

    // Projeção das falésias em 8 direções (a cada 45°): o eixo horizontal da textura segue a
    // direção da parede arredondada para o octante mais próximo. Com só 2 planos (X/Z) as
    // paredes na diagonal esticavam a textura até ~1.4x; com 8 o máximo é ~1.08x.
    float wAng = atan(wn.z, wn.x);
    // Octante da parede, SEM dither: perto da divisa entre dois octantes a parede mistura as duas
    // projeções (wBlend, mais abaixo). Antes a troca era dura (ou dithered, que some de longe com o
    // nearK): como a face de um paredão varia de direção de faceta para faceta, faixas verticais
    // estreitas caíam em outro octante e a textura "virava" - listras esticadas e claras.
    float wA = wAng / 0.78539816;
    float wOctI = floor(wA + 0.5);
    float wFr = wA - wOctI;
    float wOct = wOctI * 0.78539816;
    float wBlend = smoothstep(0.28, 0.5, abs(wFr)) * 0.5;
    float wSgn = wFr < 0.0 ? -1.0 : 1.0;
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
    if (wBlend > 0.002) {
      // mesma leitura com a projeção do octante vizinho, misturada na faixa da divisa
      float wOct2 = wOct + wSgn * 0.78539816;
      vec2 wTan2 = vec2(-sin(wOct2), cos(wOct2));
      vec2 uvW2 = vec2(dot(vWPos.xz, wTan2), vWPos.y) * (totalD / ${WALL.toFixed(1)});
      vec2 dWX2 = vec2(dot(dPX.xz, wTan2), dPX.y) * wallScale * wallRowScale;
      vec2 dWY2 = vec2(dot(dPY.xz, wTan2), dPY.y) * wallScale * wallRowScale;
      vec2 uvD2 = vec2(uvW2.x, (fract(uvW2.y * DIRT_V) + bi) / ${NB.toFixed(1)});
      vec2 dDX2 = dWX2 * vec2(1.0, DIRT_V), dDY2 = dWY2 * vec2(1.0, DIRT_V);
      uvW2 = vec2(uvW2.x, (fract(uvW2.y) + bi) / ${NB.toFixed(1)});
      vec3 rock2 = mix(textureGrad(uWallB, uvW2, dWX2, dWY2).rgb, textureGrad(uWallC, uvW2, dWX2, dWY2).rgb, ct);
      vec3 dirt2 = mix(textureGrad(uWallA, uvD2, dDX2, dDY2).rgb, textureGrad(uWallD, uvD2, dDX2, dDY2).rgb, ctD);
      wall = mix(wall, mix(dirt2, rock2, rk), wBlend);
    }

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
    // Paredões altos (6m+): a face inteira usa a textura de parede. Faixas verticais da face em que a
    // malha fica um pouco menos inclinada (facetas de ~40-52°) caíam no limiar do chão e mostravam a
    // textura do topo esticada morro abaixo, em listras
    if (vWall.x > 0.5 && vWall.x < 90.0 && vWall.y > 0.5 && vWall.y < 90.0 && vWall.x + vWall.y > 8.0 && slope > 0.22) m = 1.0;

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
    float detailStrength = clamp((uPixelScale - 0.6) * 1.1, 0.0, 1.0) * 0.35 * nearK;
    vec3 topC = mix(topBase, subPixelCol, detailStrength);

    // Barranco baixo na beira d'água (até ~1.5m): segue a textura do chão (areia/terra da margem),
    // só um pouco mais escura na face íngreme. A textura de falésia num degrau desse tamanho virava
    // um recorte de losangos coloridos.
    // A face lê o chão uns 3m para dentro da terra: no próprio lugar dela a textura é a do fundo
    // debaixo d'água (escura e manchada).
    // até 3m: com a margem elevada (até 1.5m) e o vale em volta, os barrancos de lago passam de 1.5m
    float lowBank = 1.0 - step(3.0 + dth * 0.6, vWPos.y);
    // paredão alto (cachoeira, mesa): a base não é barranco de beira d'água, segue a textura da parede
    if (vWall.x > 0.5 && vWall.x < 90.0 && vWall.y > 0.5 && vWall.y < 90.0 && vWall.x + vWall.y > 8.0) lowBank = 0.0;
    // (vale também para faces que a grama da quina ainda cobriria - inclinação acima de ~0.3 -
    // senão a grama do chão esticava pela face do barranco)
    if (lowBank > 0.0 && (m > 0.0 || slope > 0.3)) {
      vec2 inland = -normalize(wn.xz + vec2(1e-5));
      vec2 uvBank = clamp((pixWorld + inland * 3.0 - uOrig) / uSize, 0.0, 1.0);
      vec4 bankS = textureGrad(uTop, uvBank, dTopX, dTopY);
      // chão de vegetação acima: a face vira areia (a grama esticada ficava em listras verdes, e a
      // terra das paredes em listras marrons) - a areia molhada 1m para dentro da margem, ou uma
      // areia fixa se ali ainda é grama
      if (bankS.a > 0.4) {
        vec2 uvNear = clamp((pixWorld + inland * 1.0 - uOrig) / uSize, 0.0, 1.0);
        bankS = textureGrad(uTop, uvNear, dTopX, dTopY);
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
      drip = wallHt < 2.5 ? -1.0 : min(drip, wallHt * 0.3) * nearD;
      if (rimD < drip) {
        // cor da grama do topo, lida um pouco para dentro do platô
        vec2 inland = -normalize(wn.xz + vec2(1e-5));
        vec2 uvG = clamp((pixWorld + inland * (2.5 + rimD) - uOrig) / uSize, 0.0, 1.0);
        // derivadas do CHÃO (as da parede, com o UV variando muito por pixel, caíam num mipmap
        // borrado e a grama que escorre virava uma faixa verde lisa; o nível 0 fixo faiscava de longe)
        vec4 g = textureGrad(uTop, uvG, dTopX, dTopY);
        vec4 gd = textureGrad(uTopD, uvG, dTopX, dTopY);
        // só onde o topo tem vegetação; a ponta dos fios fica no tom escuro. Nas fontes termais
        // (bioma 9) o topo é a planície de travertino: lá não escorre "grama", senão a cor creme
        // descia pelo paredão em listras verticais esticadas
        float gBio = floor(texelFetch(uTopD, clamp(ivec2(uvG * vec2(topSize)), ivec2(0), topSize - 1), 0).a * 255.0 + 0.5);
        if (g.a > 0.4 && gBio < 8.5) { wall = rimD > drip - 0.45 ? gd.rgb : g.rgb; }
      }
      float creep = 0.4 + 1.5 * vn2(vec2(along * 0.4, 11.3)) + 0.8 * h21(vec2(floor(col / 3.0), 19.0)) + dth * 0.35;
      if (baseH < 90.0 && rimD < 90.0) creep = min(creep, (rimD + baseH) * 0.25);
      creep *= nearD;
      if (baseH < creep) {
        // terra do barranco subindo pelo pé, com a borda de cima um degrau mais escura
        vec3 soil = textureGrad(uWallA, uvD, dDirtX, dDirtY).rgb;
        vec3 soilD = textureGrad(uWallD, uvD, dDirtX, dDirtY).rgb;
        wall = baseH > creep - 0.35 ? soilD : soil;
      }
    }

    diffuseColor.rgb = mix(topC, wall, m);

    // Fontes termais (geothermalManager.ts): em volta de cada poça, anéis de mineral em pixels:
    // crosta branca de travertino, enxofre amarelo, laranja e ferrugem, se desfazendo para fora
    for (int si = 0; si < 4; si++) {
      vec4 sp = uSpr[si];
      if (sp.z <= 0.0) continue;
      float dn = length(pixWorld - sp.xy) / sp.z;
      if (dn > 1.6) continue;
      float rr = dn + (h21(floor(pixWorld) + float(si) * 13.0) - 0.5) * 0.05 + (vn2(pixWorld * 0.22 + float(si) * 5.0) - 0.5) * 0.06;
      if (m < 0.5) {
        vec3 mc = rr < 1.0 ? vec3(0.93, 0.90, 0.80)
                : rr < 1.13 ? vec3(0.98, 0.96, 0.88)
                : rr < 1.27 ? vec3(0.98, 0.82, 0.30)
                : rr < 1.42 ? vec3(0.92, 0.50, 0.18)
                : vec3(0.64, 0.30, 0.16);
        float mk = 1.0 - smoothstep(1.34, 1.58, rr);
        if (h21(floor(pixWorld) + 9.0) < mk) diffuseColor.rgb = pow(mc, vec3(2.2));
      }
    }

    // Respiradouros do vale (geothermalManager.ts, THERMAL.uVent: x, z, raio, tipo 0 = fumarola e
    // 1 = poça de lama), em pixels. Fumarola: buraco escuro, enxofre amarelo, crosta clara e halo de
    // ferrugem. Poça de lama: lama cinza-amarronzada com bolhas que crescem e estouram, crosta clara em volta.
    if (m < 0.5) {
      float vTime = floor(uWetTime * 6.0) / 6.0;
      for (int vi = 0; vi < 10; vi++) {
        vec4 vp = uVent[vi];
        if (vp.z <= 0.0) continue;
        float vd = length(pixWorld - vp.xy) / vp.z;
        if (vd > 1.7) continue;
        float vr = vd + (h21(floor(pixWorld) + float(vi) * 7.0) - 0.5) * 0.08;
        vec3 vc = vec3(-1.0);
        if (vp.w < 0.5) {
          vc = vr < 0.34 ? vec3(0.10, 0.09, 0.09)
             : vr < 0.62 ? vec3(0.96, 0.84, 0.22)
             : vr < 1.0 ? vec3(0.95, 0.92, 0.80)
             : vr < 1.3 ? vec3(0.90, 0.58, 0.22) : vec3(-1.0);
        } else {
          if (vr < 0.9) {
            vc = vr > 0.62 ? vec3(0.52, 0.45, 0.38) : vec3(0.41, 0.36, 0.31);
            // bolhas de lama: uma por célula de ~0.9m (relativa ao centro: não pisca ao andar)
            vec2 mb = (pixWorld - vp.xy) / 1.2;
            vec2 mc = floor(mb + 50.0);
            if (h21(mc + float(vi) * 3.1) < 0.62) {
              float per = 2.0 + 2.5 * h21(mc + 7.0);
              float mu = fract(vTime / per + h21(mc + 13.0));
              vec2 md = fract(mb + 50.0) - (0.35 + 0.3 * vec2(h21(mc + 3.0), h21(mc + 5.0)));
              float mdist = length(md);
              if (mu < 0.74) {
                float mr = mix(0.05, 0.24, smoothstep(0.0, 0.74, mu));
                if (mdist < mr) vc = mdist > mr - 0.075 ? vec3(0.88, 0.81, 0.69) : vec3(0.64, 0.56, 0.47);
              } else if (mu < 0.88) {
                float k = (mu - 0.74) / 0.14;
                if (abs(mdist - (0.24 + k * 0.12)) < 0.04) vc = vec3(0.74, 0.66, 0.54);
              }
            }
          } else if (vr < 1.2) vc = vec3(0.92, 0.88, 0.78);
          else if (vr < 1.4) vc = vec3(0.78, 0.52, 0.30);
        }
        if (vc.x >= 0.0) {
          // o halo de fora se desfaz em pixels; o miolo é sólido
          if (vr < 1.0 || h21(floor(pixWorld) + 11.0) < 1.0 - smoothstep(1.1, 1.34, vr)) diffuseColor.rgb = pow(vc, vec3(2.2));
        }
      }
    }

    // Chuva (WET em atmosphericFog.ts): o chão molhado escurece e, nos lugares planos, vão se
    // formando poças - uma mancha de ruído presa ao mundo, lida no pixel da textura (borda em
    // degraus de pixel art), que cresce com a umidade. A poça reflete um pouco a cor do céu.
    // poça neste pixel (0-1): vai no alfa da imagem e o passe de reflexo (puddleSSR.ts) usa
    float puddleMask = 0.0;
    // brilhos da poça (anéis, espuma, sol) e quanto ela está no sol: somados depois da luz, com a
    // sombra (na sombra a poça não brilha)
    vec3 puddleEmi = vec3(0.0);
    float puddleLit = 1.0;
    if (uWet > 0.001) {
      float flatG = smoothstep(0.82, 0.95, wn.y) * (1.0 - m);
      float snowPx = step(0.8, min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b));
      float wetK = uWet * (0.35 + 0.65 * flatG) * (1.0 - snowPx);
      float lw = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = mix(diffuseColor.rgb, max(mix(vec3(lw), diffuseColor.rgb, 1.25), 0.0) * 0.7, wetK * 0.75);
      // manchas pequenas (~2-4m), crescendo pouco
      float pn = vn2(pixWorld * 0.32 + 3.7) * 0.65 + vn2(pixWorld * 0.9 - 9.1) * 0.35;
      // perto da praia/mar a poça encolhe aos poucos (precisa de mais umidade), pelo próprio contorno
      // (antes um corte seco na altura de 1.2m cortava a poça em linha reta)
      float lim = 1.0 - uWet * 0.26 + (1.0 - smoothstep(0.6, 2.6, vWPos.y)) * 0.32;
      // fora da praia/mar (lá a areia já está molhada) e não na neve
      float dryLand = step(0.6, vWPos.y) * (1.0 - snowPx);
      if (pn > lim && flatG > 0.5 && dryLand > 0.5) {
        #ifdef USE_FOG
          vec3 skyC = fogColor;
        #else
          vec3 skyC = vec3(0.55, 0.62, 0.7);
        #endif
        // água rasa e transparente: o chão molhado aparece por baixo, levemente azulado, e o
        // reflexo cresce olhando de longe (como na superfície da água)
        vec3 V = normalize(cameraPosition - vWPos);
        float fres = 0.18 + 0.67 * pow(1.0 - clamp(V.y, 0.0, 1.0), 3.0);
        // o reflexo de verdade (copa, tronco, céu) vem depois, em espaço de tela (puddleSSR.ts);
        // aqui só a cor do céu para a espuma
        vec3 refl = skyC;
        // brilho do sol: pixels cintilando na direção do reflexo (piscam em passos, como a água)
        vec3 Rf = reflect(-V, vec3(0.0, 1.0, 0.0));
        float sunR = pow(max(dot(Rf, uFogSunDir), 0.0), 60.0) * clamp(uFogSunDir.y * 4.0, 0.0, 1.0);
        float glint = step(0.82, h21(floor(pixWorld * 2.0) + floor(uWetTime * 6.0)));
        vec3 ringC = refl * 1.15 + 0.04;
        // o fundo (chão molhado) é iluminado normalmente; brilho do sol e espuma como luz
        // própria (a luz da cena não pode escurecê-los)
        vec3 base = diffuseColor.rgb * vec3(0.55, 0.64, 0.72);
        vec3 emi = uFogSunColor * sunR * (0.35 + 1.4 * glint);
        // borda: pixels soltos na cor clara da água e, por fora, um degrau de lama
        float edgeIn = 1.0 - step(lim + 0.035, pn);
        float foam = edgeIn * step(0.35, h21(floor(pixWorld * 2.0) + 3.0));
        if (pn < lim + 0.012) {
          diffuseColor.rgb = mix(diffuseColor.rgb, base, 0.45);
          puddleEmi = emi * 0.45;
          puddleMask = 0.4;
        } else {
          diffuseColor.rgb = base;
          puddleEmi = foam > 0.5 ? ringC * 0.55 : emi;
          puddleMask = foam > 0.5 ? 0.3 : 1.0;
        }
      }
    }

    // Pegadas (footprints.ts): marca do pé em pixels (grade da textura), só em chão claro e plano
    // (areia e neve): na areia escurece, na neve vira uma sombra azulada
    {
      float fpr = footprintAt(pixWorld);
      if (fpr > 0.0 && wn.y > 0.6 && m < 0.5) {
        float fl = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        if (fl > 0.42) {
          bool snowy = min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b) > 0.72;
          diffuseColor.rgb = snowy ? mix(diffuseColor.rgb, vec3(0.62, 0.72, 0.88), 0.55 * fpr)
                                   : diffuseColor.rgb * mix(1.0, 0.64, fpr);
        }
      }
    }

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
    // Sombra na grade de pixels do chão: as coordenadas de sombra de cada faixa, calculadas no
    // centro do pixel da textura (pixWorld) em vez do ponto exato - cada pixel do chão fica
    // inteiro na sombra ou na luz e a borda da sombra vira degraus do tamanho dos pixels.
    uniform mat4 uSM[ 3 ];
    uniform vec3 uSNB;
    uniform float uShadowGrid;
    vec4 gSC0, gSC1, gSC2;
    float cascadeFade( vec4 sc ) {
      vec3 p = sc.xyz / sc.w;
      if ( p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0 ) return 0.0;
      float edge = min( min( p.x, 1.0 - p.x ), min( p.y, 1.0 - p.y ) );
      return smoothstep( 0.0, 0.15, edge );
    }
    float cascadeSample0() { return getShadow( directionalShadowMap[ 0 ], directionalLightShadows[ 0 ].shadowMapSize, directionalLightShadows[ 0 ].shadowIntensity, directionalLightShadows[ 0 ].shadowBias, directionalLightShadows[ 0 ].shadowRadius, gSC0 ); }
    float cascadeSample1() { return getShadow( directionalShadowMap[ 1 ], directionalLightShadows[ 1 ].shadowMapSize, directionalLightShadows[ 1 ].shadowIntensity, directionalLightShadows[ 1 ].shadowBias, directionalLightShadows[ 1 ].shadowRadius, gSC1 ); }
    float cascadeSample2() { return getShadow( directionalShadowMap[ 2 ], directionalLightShadows[ 2 ].shadowMapSize, directionalLightShadows[ 2 ].shadowIntensity, directionalLightShadows[ 2 ].shadowBias, directionalLightShadows[ 2 ].shadowRadius, gSC2 ); }
    float cascadedSunShadow() {
      float f0 = cascadeFade( gSC0 );
      if ( f0 >= 1.0 ) return cascadeSample0();
      float f1 = cascadeFade( gSC1 );
      float s;
      if ( f1 >= 1.0 ) {
        s = cascadeSample1();
      } else {
        float f2 = cascadeFade( gSC2 );
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
    puddleLit = ( directLight.visible && receiveShadow ) ? cascadedSunShadow() : 1.0;
    directLight.color *= puddleLit;
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
      uWet: WET.uWet,
      ...SHADOW_GRID,
      ...FOOTPRINTS,
      ...THERMAL,
      uRainNow: WET.uRainNow,
      uWetTime: WET.uWetTime,
      uFadeCam: FADE.uFadeCam,
      uChunkFade: FADE.uChunkFade,
      uReveal: customUniforms.uReveal,
      uRevealInv: customUniforms.uRevealInv,
    });

    sh.vertexShader = 'attribute vec3 wallInfo;\nattribute float morph;\nuniform vec2 uFadeCam;\nuniform vec2 uChunkFade;\nvarying vec3 vWall;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       // posição para as texturas ANTES do morph: presa ao relevo de verdade (com ela depois do
       // morph, a textura dos paredões deslizava enquanto a câmera andava)
       vWall = wallInfo;
       vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
       // geomorphing: no fim do raio o relevo vai tomando a forma do horizonte (que está logo
       // abaixo), e só então some com pontilhado - sem silhuetas fantasmas
       transformed.y += morph * smoothstep(uChunkFade.x - 140.0, uChunkFade.x + 20.0, distance(vWPos.xz, uFadeCam));
       vWNrm = normalize((modelMatrix * vec4(normal, 0.0)).xyz);`
    );

    const uniformDecls = `
      uniform float uWet;
      uniform vec4 uSpr[4];
      uniform vec4 uVent[10];
      uniform float uRainNow;
      uniform float uWetTime;
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
      uniform vec2 uFadeCam;
      uniform vec2 uChunkFade;
      uniform float uReveal;
      uniform float uRevealInv;
    `;

    sh.fragmentShader = 'varying vec3 vWall;\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\n' +
      uniformDecls + '\n' +
      GLSL_NOISE + '\n' + FADE_GLSL + '\n' + FOOTPRINT_GLSL + '\n' +
      sh.fragmentShader
        // fim do raio dos chunks: blocos de 4m (presos ao mundo) somem aos poucos e revelam o
        // horizonte por baixo (sem borda seca e sem o pontilhado "fervendo" com a câmera andando)
        .replace('void main() {', 'void main() {\n  if (fadeHash(floor(vWPos.xz / 4.0)) > 1.0 - smoothstep(uChunkFade.x, uChunkFade.y, distance(vWPos.xz, uFadeCam))) discard;' +
          // troca de LOD (textura/malha nova, bloco distante <-> chunks): a versão velha some e a
          // nova aparece nos mesmos blocos de 2m, em partes complementares (nunca as duas no mesmo
          // pixel: sem briga de profundidade e sem piscar)
          '\n  if (uReveal < 1.0 || uRevealInv > 0.5) {\n    bool rvShow = fadeHash(floor(vWPos.xz * 0.5) + 31.0) < uReveal;\n    if (uRevealInv > 0.5) rvShow = !rvShow;\n    if (!rvShow) discard;\n  }')
        .replace('#include <map_fragment>', fragShaderPatch)
        // poças no alfa da imagem (o resto da cena fica com alfa 1): a força do reflexo, que cai
        // na sombra; os brilhos da poça entram aqui, depois da luz, também com a sombra
        .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n  float puddleSun = mix(0.3, 1.0, puddleLit);\n  gl_FragColor.rgb += puddleEmi * puddleSun;\n  gl_FragColor.a = 1.0 - 0.5 * puddleMask * puddleSun;')
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
