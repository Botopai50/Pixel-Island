import * as THREE from 'three';
import { ShadowClipmap } from './shadowClipmap.ts';
import { CartoonSkybox } from './skybox.ts';
import { AERIAL } from './atmosphericFog.ts';

export interface TimePreset {
  name: string;
  sunElevation: number;
  sunAzimuth: number;
  sunColor: string;
  ambientColor: string;
  fogColor: string;
  skyColor: string;
  zenithColor?: string;
  horizonColor?: string;
  cloudColor?: string;
  cloudShadowColor?: string;
  sunDiskColor?: string;
  sunCoronaColor?: string;
  starVisibility?: number;
  moonVisibility?: number;
  cloudCoverage?: number;
}

export const TIME_PRESETS: Record<string, TimePreset> = {
  NOON: {
    name: 'Meio-dia Aberto (Demon\'s Mode 7)',
    sunElevation: 45,
    sunAzimuth: 140,
    sunColor: '#fff9ed',
    ambientColor: '#94b8e0',
    fogColor: '#88bce8',
    skyColor: '#6aa8ea',
    zenithColor: '#1a5ec4',
    horizonColor: '#8ec4f5',
    cloudColor: '#ffffff',
    cloudShadowColor: '#a0c4ea',
    sunDiskColor: '#fffef2',
    sunCoronaColor: '#ffe69c',
    starVisibility: 0.0,
    moonVisibility: 0.0,
    cloudCoverage: 0.50
  },
  GOLDEN_HOUR: {
    name: 'Pôr do Sol Dourado (Mode 7 Sunset)',
    sunElevation: 20,
    sunAzimuth: 230,
    sunColor: '#ffa048',
    // nuvens em tons quentes que combinam com o céu (antes: crista quase branca sobre sombra roxa
    // escura, um contraste frio e duro): crista laranja-pêssego, sombra rosa-malva; o alto do céu
    // em ameixa e a névoa num tom quente do horizonte (o relevo de longe não fica roxo-escuro)
    ambientColor: '#6a3448',
    fogColor: '#9a4a48',
    skyColor: '#c84428',
    zenithColor: '#4a1e48',
    horizonColor: '#ff6a30',
    cloudColor: '#ffb27a',
    cloudShadowColor: '#a8506a',
    sunDiskColor: '#fff2a8',
    sunCoronaColor: '#ff4c1c',
    starVisibility: 0.15,
    moonVisibility: 0.25,
    cloudCoverage: 0.48
  },
  DAWN: {
    name: 'Amanhecer Pastel',
    sunElevation: 16,
    sunAzimuth: 65,
    sunColor: '#ffdba8',
    // amanhecer pastel: crista pêssego-rosada, sombra lilás suave, alto do céu azul-lavanda e
    // névoa rosada (antes a sombra era quase preta e a crista quase branca)
    ambientColor: '#6a5a82',
    fogColor: '#9a7090',
    skyColor: '#7a6aa0',
    zenithColor: '#3a3470',
    horizonColor: '#f08070',
    cloudColor: '#ffc4a8',
    cloudShadowColor: '#8a6c9c',
    sunDiskColor: '#fff4d8',
    sunCoronaColor: '#f07452',
    starVisibility: 0.25,
    moonVisibility: 0.30,
    cloudCoverage: 0.48
  },
  TWILIGHT: {
    name: 'Crepúsculo Roxo',
    sunElevation: 4,
    sunAzimuth: 275,
    // crepúsculo roxo-rosado: escurecendo, mas com o terreno à vista (antes a luz ambiente e a
    // névoa eram quase pretas e tudo virava silhueta); névoa puxada do horizonte e nuvens sem a
    // sombra quase preta
    sunColor: '#d06a84',
    ambientColor: '#4c3466',
    fogColor: '#6a3462',
    skyColor: '#4a2a66',
    zenithColor: '#1e1644',
    horizonColor: '#b84a72',
    cloudColor: '#e08aa4',
    cloudShadowColor: '#5c3260',
    sunDiskColor: '#ff5c48',
    sunCoronaColor: '#dc2442',
    starVisibility: 0.70,
    moonVisibility: 0.75,
    cloudCoverage: 0.45
  },
  NIGHT: {
    name: 'Noite Estrelada de Mode 7',
    sunElevation: -20,
    sunAzimuth: 180,
    // noite de luar em azul-marinho, coesa como os outros horários: céu azul profundo, horizonte
    // um pouco mais claro, nuvens escuras (só um pouco mais claras que o céu), névoa da cor do
    // horizonte e luz azulada (antes: céu quase preto, nuvens claras destoando e chão roxo)
    sunColor: '#5a6ea8',
    ambientColor: '#16203c',
    fogColor: '#1a2648',
    skyColor: '#141e3e',
    zenithColor: '#0c1430',
    horizonColor: '#22305a',
    cloudColor: '#46567f',
    // sombra das nuvens um pouco mais clara que o horizonte (como de dia): mais escura que ele,
    // a base das nuvens de longe virava um corte escuro no céu
    cloudShadowColor: '#2a3864',
    sunDiskColor: '#000000',
    sunCoronaColor: '#000000',
    starVisibility: 0.95,
    moonVisibility: 1.0,
    cloudCoverage: 0.40
  }
};

/**
 * Ciclo de dia e noite (modo automático do HUD): as cores misturam os horários prontos ao longo do
 * dia e o sol anda num arco de verdade (nasce no leste às 6h, alto ao meio-dia, põe no oeste às 18h).
 */
const DAY_KEYS: [number, keyof typeof TIME_PRESETS][] = [
  [0, 'NIGHT'], [4.6, 'NIGHT'], [5.9, 'DAWN'], [8.5, 'NOON'], [15.5, 'NOON'],
  [17.6, 'GOLDEN_HOUR'], [18.8, 'TWILIGHT'], [20.2, 'NIGHT'], [24, 'NIGHT'],
];
/** horário de cada preset fixo (o automático continua dali) */
export const PRESET_HOUR: Record<keyof typeof TIME_PRESETS, number> = {
  DAWN: 6.2, NOON: 12, GOLDEN_HOUR: 17.6, TWILIGHT: 18.8, NIGHT: 23,
};

function lerpHex(a: string, b: string, t: number): string {
  return '#' + new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString();
}

/** Preset misturado para uma hora do dia (0-24). */
export function presetAtHour(hour: number): TimePreset {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < DAY_KEYS.length - 2 && h >= DAY_KEYS[i + 1][0]) i++;
  const [h0, k0] = DAY_KEYS[i], [h1, k1] = DAY_KEYS[i + 1];
  const t = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
  const s = t * t * (3 - 2 * t);
  const a = TIME_PRESETS[k0], b = TIME_PRESETS[k1];
  const out: TimePreset = { ...a };
  for (const key of Object.keys(a) as (keyof TimePreset)[]) {
    const va = a[key], vb = b[key];
    if (typeof va === 'string' && typeof vb === 'string' && va.startsWith('#')) (out as any)[key] = lerpHex(va, vb, s);
    else if (typeof va === 'number' && typeof vb === 'number') (out as any)[key] = va + (vb - va) * s;
  }
  // sol num arco: leste (90°) às 6h, 180° ao meio-dia, oeste (270°) às 18h; abaixo do horizonte à noite
  out.sunElevation = Math.sin(((h - 6) / 12) * Math.PI) * 55;
  out.sunAzimuth = 90 + (h - 6) * 15;
  return out;
}

/** quanto as sombras puxam para o tom do ar do bioma (0-1) */
const SHADOW_TINT = 0.6;

export class SkyAtmosphere {
  private scene: THREE.Scene;
  private shadowClipmap: ShadowClipmap;
  private hemiLight: THREE.HemisphereLight;
  private ambientLight: THREE.AmbientLight;
  private fogNear = 200;
  private fogFar = 2400;
  private skybox: CartoonSkybox;
  private currentPreset: TimePreset = TIME_PRESETS.NOON;
  private currentSunDir: THREE.Vector3 = new THREE.Vector3(0.5, 0.8, 0.35).normalize();
  /** cores das luzes uniformes do horário (antes do tom do bioma) */
  private baseSkyLight = new THREE.Color('#ffffff');
  private baseAmbient = new THREE.Color('#444444');
  /** relógio do jogo (0-24) e o ciclo automático: um dia em DAY_SECONDS segundos reais */
  public hour = 12;
  public autoTime = false;
  private static readonly DAY_SECONDS = 960;
  private cycleAcc = 0;
  /** de onde vem a luz direcional: o sol de dia, a lua de noite */
  private lightDir: THREE.Vector3 = new THREE.Vector3(0.5, 0.8, 0.35).normalize();

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Inicialização do sistema concêntrico de Shadow Clipmap (Níveis 0, 1 e 2 com Texel Snapping)
    this.shadowClipmap = new ShadowClipmap(this.scene);

    // Inicialização do CartoonSkybox estilizado
    this.skybox = new CartoonSkybox();
    this.scene.add(this.skybox.getMesh());

    // Luz uniforme (hemisférica + ambiente) bem abaixo da luz do sol: é a razão sol/uniforme
    // que dá contraste entre encostas iluminadas e de costas, e não o brilho total.
    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.50);
    this.scene.add(this.hemiLight);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.28);
    this.scene.add(this.ambientLight);

    this.applyPreset(TIME_PRESETS.NOON);
  }

  public applyPreset(preset: TimePreset): void {
    this.currentPreset = preset;

    const phi = THREE.MathUtils.degToRad(90 - preset.sunElevation);
    const theta = THREE.MathUtils.degToRad(preset.sunAzimuth);

    const sunDir = new THREE.Vector3(
      Math.sin(phi) * Math.sin(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.cos(theta)
    ).normalize();
    this.currentSunDir.copy(sunDir);

    // Sincroniza luz solar e cascatas do clipmap com o preset atual
    this.shadowClipmap.setSunDirection(sunDir);
    this.shadowClipmap.setSunColor(preset.sunColor, 2.0);

    this.hemiLight.color.set(preset.skyColor);
    this.hemiLight.groundColor.set(preset.ambientColor);
    this.ambientLight.color.set(preset.ambientColor);
    this.baseSkyLight.set(preset.skyColor);
    this.baseAmbient.set(preset.ambientColor);

    // O fundo da cena é gerenciado pelo CartoonSkybox mesh
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(preset.fogColor, this.fogNear, this.fogFar);

    // Sincroniza parâmetros celestes do Skybox
    this.skybox.syncWithPreset(preset, sunDir);

    // Sol abaixo do horizonte: a luz direcional (e as sombras) vêm da lua, alta no céu. Com a
    // direção do sol (de baixo, rasante) a sombra de cada tronco e morro virava uma faixa preta
    // enorme atravessando o chão.
    this.lightDir.copy(sunDir.y < 0.0 ? this.skybox.getMoonDirection() : sunDir);
    this.shadowClipmap.setSunDirection(this.lightDir);
  }

  /**
   * A neblina conta a partir da câmera. Na visão aérea a câmera fica centenas de metros acima do
   * ponto focado, então com o início fixo em 200m tudo na tela (até o chão logo abaixo) ficava
   * ~30% lavado de azul-claro. Aqui ela começa um pouco depois do ponto focado.
   */
  public setFocusDistance(focusDistance: number, firstPerson: boolean = false): void {
    // Em primeira pessoa a paisagem vai até o horizonte (~12km): a névoa (atmosphericFog.ts)
    // começa logo, cresce com a distância e fecha antes do fim do horizonte
    this.fogNear = firstPerson ? 20 : Math.max(200, focusDistance + 150);
    this.fogFar = firstPerson ? 11000 : Math.max(2400, focusDistance + 2200);
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = this.fogNear;
      this.scene.fog.far = this.fogFar;
    }
  }

  public getFogRange(): [number, number] {
    return [this.fogNear, this.fogFar];
  }

  public updateTarget(x: number, y: number, z: number): void {
    this.shadowClipmap.updateTarget(x, y, z);
  }

  public update(delta: number, cameraPosition: THREE.Vector3): void {
    this.skybox.update(delta, cameraPosition);
    // Sombras coloridas pelo bioma: na sombra só chega a luz uniforme (céu/ambiente), então
    // puxá-la para o tom do ar do bioma (o mesmo da névoa) tinge as sombras de leve; a parte no
    // sol muda pouco (lá o sol domina).
    this.skybox.tintTowardBiome(this.hemiLight.color.copy(this.baseSkyLight), SHADOW_TINT);
    this.skybox.tintTowardBiome(this.hemiLight.groundColor.copy(this.baseAmbient), SHADOW_TINT);
    this.skybox.tintTowardBiome(this.ambientLight.color.copy(this.baseAmbient), SHADOW_TINT);
    // névoa da cena com a mesma cor (e a mesma transição) do horizonte do céu
    if (this.scene.fog) this.scene.fog.color.copy(this.skybox.getCurrentFogColor());
    // luz do ar (perspectiva atmosférica): direção do sol e a cor do brilho em volta dele
    const sd = this.currentSunDir, sc = this.skybox.getCurrentCoronaColor();
    Object.assign(AERIAL.uFogSunDir.value, { x: sd.x, y: sd.y, z: sd.z });
    Object.assign(AERIAL.uFogSunColor.value, { x: sc.r, y: sc.g, z: sc.b });
  }

  /** Direção da luz direcional (sol de dia, lua de noite) - a que ilumina e faz sombra. */
  public getLightDirection(): THREE.Vector3 {
    return this.lightDir.clone();
  }

  /** Liga o ciclo automático (a partir da hora atual). */
  public setAutoTime(on: boolean): void {
    this.autoTime = on;
    this.cycleAcc = 1;
  }

  /** Preset fixo do HUD: também acerta o relógio (o automático continua dali). */
  public setFixedTime(key: keyof typeof TIME_PRESETS): void {
    this.autoTime = false;
    this.hour = PRESET_HOUR[key];
    this.applyPreset(TIME_PRESETS[key]);
  }

  /**
   * Avança o relógio no modo automático e, a cada meio segundo, aplica o céu daquela hora.
   * Devolve true quando o sol mudou de lugar (refazer as sombras).
   */
  public tickCycle(dt: number): boolean {
    if (!this.autoTime) return false;
    this.hour = (this.hour + (dt * 24) / SkyAtmosphere.DAY_SECONDS) % 24;
    this.cycleAcc += dt;
    if (this.cycleAcc < 0.5) return false;
    this.cycleAcc = 0;
    this.applyPreset(presetAtHour(this.hour));
    return true;
  }

  public getSunDirection(): THREE.Vector3 {
    return this.currentSunDir.clone();
  }

  public getMoonDirection(): THREE.Vector3 {
    return this.skybox.getMoonDirection();
  }

  public getSunColor(): THREE.Color {
    return this.shadowClipmap.getPrimaryLight().color;
  }

  public getAmbientColor(): THREE.Color {
    return this.hemiLight.groundColor;
  }

  public getFogColor(): THREE.Color {
    return new THREE.Color(this.currentPreset.fogColor);
  }

  public getCurrentPreset(): TimePreset {
    return this.currentPreset;
  }

  public getShadowClipmap(): ShadowClipmap {
    return this.shadowClipmap;
  }

  public getSkybox(): CartoonSkybox {
    return this.skybox;
  }
}
