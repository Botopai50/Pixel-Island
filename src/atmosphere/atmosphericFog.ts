import * as THREE from 'three';

/**
 * Perspectiva atmosférica: troca a névoa linear do three.js (que só começava longe e mal
 * aparecia). Como numa paisagem pintada, cada camada de relevo/árvores mais distante fica mais
 * clara, menos saturada, com menos contraste e puxando para o azul do ar, e o fundo some no céu:
 *
 * - ar da proximidade: já se nota a ~50-100m e chega a ~50% por volta de 600m (com teto: as
 *   montanhas longe continuam como silhuetas claras);
 * - cores: dessaturam e achatam junto; o azul se espalha antes do verde e do vermelho;
 * - luz: olhando na direção do sol o ar fica mais claro e quente (a cor do brilho do sol).
 *
 * E a névoa de distância/vales:
 * - distância: exponencial a partir de fogNear (1 - e^(-d/D), D = 40% de fogFar - fogNear) e
 *   completa perto de fogFar, pela distância real da câmera (não muda ao girar a câmera);
 * - névoa baixa: mais densa perto do nível do mar e no fundo dos vales, rareia com a altura
 *   (~35m), e só conta depois de fogNear/2 (na visão aérea não lava o chão logo abaixo).
 *
 * A cor é a mesma do horizonte do céu (skyAtmosphere copia a do skybox a cada quadro), então o
 * relevo distante se funde com o céu. Vale para todos os materiais com fog = true; materiais
 * próprios (água) chamam fogAmountAt() direto. Precisa ser instalada antes de compilar qualquer
 * material.
 */

/**
 * Quantidade de névoa num ponto do mundo (0-1), com o início e o fim da névoa da cena. Separada
 * para a água (desenhada à parte, sem a névoa da cena) usar a mesma conta.
 */
export const FOG_AMOUNT_GLSL = /* glsl */ `
  uniform vec3 uFogSunDir;
  uniform vec3 uFogSunColor;
  // densidade do bioma (biomeAmbience.ts): x = distância, y = névoa baixa, z = ar da proximidade
  uniform vec3 uFogBiome;
  // névoa baixa da manhã (biomeAmbience.ts): x = quantidade (0-1), yz = deslocamento do desenho
  // (anda com o vento)
  uniform vec3 uGFog;

  float fogAmountAt(vec3 wpos, float fNear, float fFar) {
    float d = length(wpos - cameraPosition);
    float span = max(fFar - fNear, 1.0);
    float dd = max(d - fNear, 0.0);
    float fd = max(1.0 - exp(-dd * uFogBiome.x / (span * 0.4)), smoothstep(fNear + span * 0.7, fFar, d));
    float hf = min(0.55 * uFogBiome.y, 0.9) * exp(-max(wpos.y - 2.0, 0.0) / 35.0) * (1.0 - exp(-max(d - fNear * 0.5, 0.0) / 800.0));
    // névoa rasteira da manhã: uma camada rente ao mar, aos rios e ao fundo dos vales (some acima
    // de ~15m), em manchas que andam com o vento. A espessura vem da média da altura da câmera e
    // da do ponto: dentro da camada tudo à volta embranquece; de cima só o vale fica coberto.
    float gf = 0.0;
    if (uGFog.x > 0.001) {
      vec2 gp = wpos.xz - uGFog.yz;
      float gn = 0.5 + 0.5 * sin(gp.x * 0.011 + sin(gp.y * 0.017) * 1.7) * sin(gp.y * 0.013 + sin(gp.x * 0.009) * 1.3);
      float lay = 0.5 * ((1.0 - smoothstep(1.5, 15.0, wpos.y)) + (1.0 - smoothstep(1.5, 15.0, cameraPosition.y)));
      gf = min(1.0 - exp(-d * 0.022 * uGFog.x * (0.4 + 0.85 * gn) * lay), 0.8);
    }
    return 1.0 - (1.0 - fd) * (1.0 - hf) * (1.0 - gf);
  }

  // silK: quanto a cor de silhueta escurece a cor do ar. 0.6 nas cores lineares da cena; a água é
  // desenhada já nas cores da tela (depois do tonemapping), onde o mesmo escurecimento é ~0.8
  vec3 aerialPerspectiveK(vec3 col, vec3 wpos, vec3 fogCol, float fNear, float fFar, float silK) {
    vec3 rel = wpos - cameraPosition;
    float d = length(rel);
    // 1. Camadas (como num Minecraft enevoado): entre ~fNear e ~240m o relevo e a mata puxam para
    // uma COR DE SILHUETA (a cor do ar do bioma, mais escura e saturada) e param num teto alto: o
    // que está longe continua bem visível, recortado e escuro, tingido pelo bioma (verde-azulado na
    // selva, bege no deserto...), uma camada atrás da outra, em vez de lavar até o claro do céu.
    float nk = smoothstep(fNear, fNear + 240.0 / uFogBiome.z, d);
    float nh = min(0.84 * uFogBiome.z, 0.93) * nk * (2.0 - nk);
    float fl = dot(fogCol, vec3(0.2126, 0.7152, 0.0722));
    vec3 sil = max(mix(vec3(fl), fogCol, 1.6), 0.0) * silK;
    // 2. Névoa de distância e dos vales: só ela leva à cor do céu (fecha no horizonte)
    float t = fogAmountAt(wpos, fNear, fFar);
    // o azul se espalha primeiro
    vec3 tc = 1.0 - pow(vec3(1.0 - t), vec3(0.85, 1.0, 1.2));
    // cores lavadas: dessatura e achata o contraste
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, vec3(lum), clamp(max(t, nh) * 0.6, 0.0, 1.0));
    // luz do ar: mais clara e quente na direção do sol (só com o sol acima do horizonte)
    float sunUp = clamp(uFogSunDir.y * 4.0 + 0.2, 0.0, 1.0);
    float glow = pow(max(dot(rel / max(d, 1e-3), uFogSunDir), 0.0), 5.0) * sunUp;
    vec3 inscat = mix(fogCol, uFogSunColor, glow * 0.45);
    col = mix(col, mix(sil, inscat, glow * 0.35), nh);
    return mix(col, inscat, tc);
  }
  vec3 aerialPerspective(vec3 col, vec3 wpos, vec3 fogCol, float fNear, float fFar) {
    return aerialPerspectiveK(col, wpos, fogCol, fNear, fFar, 0.6);
  }
`;

/**
 * Direção e cor do sol para a luz do ar, compartilhadas por TODOS os materiais: o valor é um
 * objeto comum (não Vector3), que o three.js copia por referência ao montar os uniforms de cada
 * material, então mudar x/y/z aqui vale para todos. skyAtmosphere atualiza a cada quadro.
 */
export const AERIAL = {
  uFogSunDir: { value: { x: 0, y: 1, z: 0 } },
  uFogSunColor: { value: { x: 1, y: 0.9, z: 0.7 } },
  uFogBiome: { value: { x: 1, y: 1, z: 1 } },
  uGFog: { value: { x: 0, y: 0, z: 0 } },
};

/**
 * Umidade do chão pela chuva (0 seco - 1 encharcado): sobe aos poucos enquanto chove e seca
 * devagar depois (biomeAmbience.ts). O terreno escurece e ganha poças (terrainShader.ts).
 * Compartilhado por referência (o shader do terreno liga o mesmo objeto).
 */
/**
 * Sombra na grade de pixels do chão (terrainShader.ts): as matrizes das 3 faixas de sombra do
 * clipmap (as mesmas Matrix4 das luzes, por referência) e o normalBias de cada uma. main.ts liga.
 */
export const SHADOW_GRID = {
  uSM: { value: [new THREE.Matrix4(), new THREE.Matrix4(), new THREE.Matrix4()] },
  uSNB: { value: new THREE.Vector3() },
  uShadowGrid: { value: 0 },
};

export const WET = {
  uWet: { value: 0 },
  /** chuva caindo agora (0-1): os aneizinhos nas poças */
  uRainNow: { value: 0 },
  /** relógio das poças (s) */
  uWetTime: { value: 0 },
};

const PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif
`;

const VERTEX = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  // posição no mundo a partir da de câmera (vale para malhas instanciadas e quadros virados para a câmera)
  vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif
`;

const PARS_FRAGMENT = /* glsl */ `
${FOG_AMOUNT_GLSL}
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif

  float fogAmount(vec3 wpos) {
    #ifdef FOG_EXP2
      float d = length(wpos - cameraPosition);
      return 1.0 - exp(-fogDensity * fogDensity * d * d);
    #else
      return fogAmountAt(wpos, fogNear, fogFar);
    #endif
  }
#endif
`;

const FRAGMENT = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogAmount(vFogWorld));
  #else
    gl_FragColor.rgb = aerialPerspective(gl_FragColor.rgb, vFogWorld, fogColor, fogNear, fogFar);
  #endif
#endif
`;

/**
 * Cor linear da cena -> cor final da tela (o mesmo ACES + sRGB do blit em main.ts). A água é
 * desenhada por cima da imagem já convertida, então as cores da névoa dela precisam passar por
 * aqui (senão a névoa na água saía azul-escura e saturada em vez de clara como no relevo).
 */
export function linearToDisplay(r: number, g: number, b: number, exposure: number, out: THREE.Vector3): THREE.Vector3 {
  const e = exposure / 0.6;
  r *= e; g *= e; b *= e;
  // ACESInputMat (colunas como no GLSL)
  const ir = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const ig = 0.07600 * r + 0.90834 * g + 0.01566 * b;
  const ib = 0.02840 * r + 0.13383 * g + 0.83777 * b;
  const rrt = (v: number) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
  const fr = rrt(ir), fg = rrt(ig), fb = rrt(ib);
  const or = 1.60475 * fr - 0.53108 * fg - 0.07367 * fb;
  const og = -0.10208 * fr + 1.10813 * fg - 0.00605 * fb;
  const ob = -0.00327 * fr - 0.07276 * fg + 1.07602 * fb;
  const srgb = (v: number) => {
    const t = Math.min(1, Math.max(0, v));
    return t <= 0.0031308 ? t * 12.92 : Math.pow(t, 0.41666) * 1.055 - 0.055;
  };
  return out.set(srgb(or), srgb(og), srgb(ob));
}

let installed = false;

export function installAtmosphericFog(): void {
  if (installed) return;
  installed = true;
  const chunks = THREE.ShaderChunk as unknown as Record<string, string>;
  chunks.fog_pars_vertex = PARS_VERTEX;
  chunks.fog_vertex = VERTEX;
  chunks.fog_pars_fragment = PARS_FRAGMENT;
  chunks.fog_fragment = FRAGMENT;
  // uniforms da luz do ar em todos os materiais prontos do three.js que têm névoa
  for (const lib of Object.values(THREE.ShaderLib) as { uniforms: Record<string, unknown> }[]) {
    if (lib.uniforms && 'fogColor' in lib.uniforms) Object.assign(lib.uniforms, AERIAL);
  }
}
