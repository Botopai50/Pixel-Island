import * as THREE from 'three';
import { BiomeType } from '../generation/types.ts';
import type { TerrainGenerator } from '../generation/terrain/terrainGenerator.ts';
import { AERIAL, WET } from './atmosphericFog.ts';
import { BiomeParticles, type ParticleKind, PARTICLE_KINDS } from './biomeParticles.ts';
import { Wind, WIND_U } from './wind.ts';
import { WindStreaks } from './windStreaks.ts';
import { Rain } from './rain.ts';

/**
 * Clima escolhido no HUD (skyWidget.ts), por cima da ambientação do bioma: chuva, tempestade
 * (chuva forte, vento e relâmpagos), neve e neblina. Valores somados/multiplicados aos do bioma.
 */
export type WeatherKind = 'auto' | 'clear' | 'cloudy' | 'overcast' | 'rain' | 'storm' | 'snow' | 'fog';
interface WeatherParams { rain: number; snow: number; fog: number; dark: number; wind: number; lightning: number }
const WEATHER_PARAMS: Record<WeatherKind, WeatherParams> = {
  auto: { rain: 0, snow: 0, fog: 1, dark: 1, wind: 1, lightning: 0 },
  clear: { rain: 0, snow: 0, fog: 0.85, dark: 1, wind: 1, lightning: 0 },
  cloudy: { rain: 0, snow: 0, fog: 1.1, dark: 0.95, wind: 1.1, lightning: 0 },
  overcast: { rain: 0, snow: 0, fog: 1.25, dark: 0.88, wind: 1.2, lightning: 0 },
  rain: { rain: 0.5, snow: 0, fog: 1.45, dark: 0.8, wind: 1.4, lightning: 0 },
  storm: { rain: 0.85, snow: 0, fog: 1.7, dark: 0.62, wind: 2.4, lightning: 1 },
  snow: { rain: 0, snow: 1.0, fog: 1.55, dark: 0.9, wind: 0.9, lightning: 0 },
  fog: { rain: 0, snow: 0, fog: 2.8, dark: 0.92, wind: 0.6, lightning: 0 },
};

/**
 * Ambientação própria de cada bioma, misturada pelo que há em volta do jogador:
 *
 * - névoa: cor do ar (puxa a cor do horizonte/névoa do céu para um matiz mantendo o brilho, então
 *   vale de dia e de noite)
 *   e densidade (distância, névoa baixa dos vales, ar da proximidade): mata e taiga enevoadas,
 *   deserto aberto com o ar de perto quente e lavado, vulcão fechado e escuro;
 * - gradação de cor da imagem final (tom, saturação, contraste), sutil;
 * - nuvens: quantidade, cor e vento (deserto limpo, selva carregada, taiga encoberta, vulcão de
 *   cinzas); o céu é visto de longe, então muda bem mais devagar (~30s), como o tempo mudando;
 * - partículas no ar (biomeParticles.ts): neve, folhas, pólen, vaga-lumes, poeira, areia, cinzas.
 *
 * O bioma é amostrado em alguns pontos em volta do jogador (aos poucos, poucos por quadro) e os
 * valores andam devagar até o alvo: atravessar uma fronteira troca a atmosfera em alguns segundos.
 */

interface Profile {
  /** cor do ar: matiz (o brilho continua o do céu, vale de noite), quanto puxa para ela e brilho */
  fog: [string, number, number];
  /** densidade: [distância, névoa baixa, ar da proximidade] (1 = padrão) */
  dens: [number, number, number];
  /** gradação: tom (multiplica), saturação, contraste */
  tint: [number, number, number];
  sat: number;
  con: number;
  /** nuvens: cobertura (+/-), matiz e quanto puxa, brilho da parte iluminada e da sombra, vento, céu acinzentado */
  cloud?: { cov?: number; hue?: string; amt?: number; lit?: number; shade?: number; wind?: number; grey?: number };
  /** rastros de vento (windStreaks.ts), 0-1 */
  streaks?: number;
  particles: Partial<Record<ParticleKind, number>>;
}

const NEUTRAL: Profile = { fog: ['#ffffff', 0, 1], dens: [1, 1, 1], tint: [1, 1, 1], sat: 1, con: 1, particles: {} };

const P: Record<string, Profile> = {
  coast: NEUTRAL,
  beach: { ...NEUTRAL, fog: ['#e0d8c0', 0.1, 1], tint: [1.02, 1.01, 0.98], sat: 1.04, cloud: { cov: -0.08 }, streaks: 0.5, particles: { pollen: 0.15 } },
  meadow: { fog: ['#d0e0c8', 0.1, 1], dens: [1, 1.1, 1], tint: [1.02, 1.02, 0.97], sat: 1.07, con: 1, streaks: 0.45, particles: { pollen: 1.0, fireflies: 0.35 } },
  temperate: { fog: ['#c8dcc8', 0.12, 1], dens: [1.05, 1.3, 1.05], tint: [1.0, 1.01, 0.98], sat: 1.04, con: 1.01, cloud: { cov: 0.05 }, streaks: 0, particles: { pollen: 0.55, fireflies: 0.6 } },
  autumn: { fog: ['#e8c8a0', 0.28, 1], dens: [1.1, 1.5, 1.08], tint: [1.05, 0.99, 0.91], sat: 1.12, con: 1.03, cloud: { cov: 0.12, hue: '#f0d0a8', amt: 0.2, shade: 0.95, grey: 0.1 }, streaks: 0, particles: { leaves: 1.0 } },
  taiga: { fog: ['#a8c4c8', 0.32, 0.97], dens: [1.35, 2.0, 1.12], tint: [0.95, 0.99, 1.03], sat: 0.86, con: 1.0, cloud: { cov: 0.3, hue: '#b8c8d0', amt: 0.35, lit: 0.92, shade: 0.85, wind: 1.2, grey: 0.3 }, streaks: 0, particles: { motes: 0.7, snow: 0.15 } },
  polar: { fog: ['#d8e6f4', 0.32, 1.03], dens: [1.3, 1.2, 1.25], tint: [0.95, 0.99, 1.06], sat: 0.82, con: 1.04, cloud: { cov: 0.3, hue: '#e0e8f0', amt: 0.3, shade: 0.92, wind: 1.8, grey: 0.35 }, streaks: 0.7, particles: { snow: 1.0 } },
  alpine: { fog: ['#c8d8e8', 0.15, 1], dens: [1.1, 0.8, 1.0], tint: [0.97, 1.0, 1.03], sat: 0.92, con: 1.03, cloud: { cov: 0.15, hue: '#d8e0ea', amt: 0.2, wind: 1.5, grey: 0.15 }, streaks: 0.8, particles: { snow: 0.35 } },
  desert: { fog: ['#e0b478', 0.78, 1.02], dens: [1.55, 0.6, 1.6], tint: [1.05, 1.0, 0.9], sat: 1.05, con: 1.06, cloud: { cov: -0.33, hue: '#fff0d8', amt: 0.2, wind: 0.6 }, streaks: 1, particles: { sand: 1.0 } },
  savanna: { fog: ['#e6cf9a', 0.38, 1.02], dens: [0.9, 0.5, 1.15], tint: [1.05, 1.0, 0.9], sat: 1.08, con: 1.03, cloud: { cov: -0.18, hue: '#f4dca8', amt: 0.3, wind: 0.8 }, streaks: 0.75, particles: { dust: 1.0, fireflies: 0.2 } },
  tropical: { fog: ['#b8d8c0', 0.32, 0.98], dens: [1.3, 2.0, 1.2], tint: [0.97, 1.02, 0.97], sat: 1.12, con: 1.02, cloud: { cov: 0.32, hue: '#c8d8cc', amt: 0.25, lit: 0.95, shade: 0.82, wind: 0.9, grey: 0.15 }, streaks: 0, particles: { motes: 0.5, fireflies: 1.0 } },
  mangrove: { fog: ['#b0c8b0', 0.38, 0.96], dens: [1.4, 2.4, 1.25], tint: [0.97, 1.01, 0.96], sat: 1.04, con: 1.0, cloud: { cov: 0.3, hue: '#c0d0c0', amt: 0.3, shade: 0.82, grey: 0.2 }, streaks: 0, particles: { motes: 0.7, fireflies: 0.8 } },
  volcanic: { fog: ['#a08078', 0.6, 0.78], dens: [1.6, 1.4, 1.4], tint: [1.04, 0.93, 0.88], sat: 0.85, con: 1.08, cloud: { cov: 0.35, hue: '#6a5a54', amt: 0.7, lit: 0.6, shade: 0.5, wind: 1.3, grey: 0.5 }, streaks: 0, particles: { ash: 1.0, embers: 0.6 } },
  geothermal: { fog: ['#e8ecec', 0.42, 1.05], dens: [1.3, 2.6, 1.2], tint: [1.0, 0.99, 0.98], sat: 0.9, con: 0.97, cloud: { cov: 0.2, hue: '#f0f0f0', amt: 0.3, grey: 0.2 }, streaks: 0, particles: { steam: 1.0 } },
};

function profileFor(t: BiomeType): Profile {
  switch (t) {
    case BiomeType.OCEAN: case BiomeType.SHALLOWS: case BiomeType.CORAL_LAGOON: return P.coast;
    case BiomeType.BEACH: return P.beach;
    case BiomeType.MANGROVE_SWAMP: return P.mangrove;
    case BiomeType.COASTAL_MEADOW: return P.meadow;
    case BiomeType.TEMPERATE_FOREST: return P.temperate;
    case BiomeType.AUTUMN_FOREST: return P.autumn;
    case BiomeType.SAVANNAH: return P.savanna;
    case BiomeType.DESERT_DUNES: case BiomeType.CANYON_DESERT: return P.desert;
    case BiomeType.TROPICAL_RAINFOREST: return P.tropical;
    case BiomeType.BOREAL_TAIGA: return P.taiga;
    case BiomeType.ALPINE_TUNDRA: case BiomeType.ROCKY_PEAKS: return P.alpine;
    case BiomeType.FROZEN_TUNDRA: case BiomeType.SNOW_SUMMIT: return P.polar;
    case BiomeType.VOLCANIC_FIELD: case BiomeType.VOLCANIC_CALDERA: return P.volcanic;
    case BiomeType.GEOTHERMAL_VALLEY: return P.geothermal;
    default: return NEUTRAL;
  }
}

/** Gradação de cor da imagem final, em cores da tela. Uniforms compartilhados pelos dois blits. */
export const GRADE = {
  uGradeTint: { value: { x: 1, y: 1, z: 1 } },
  uGradeSat: { value: 1 },
  uGradeCon: { value: 1 },
  /** clarão de relâmpago (0-1) */
  uFlash: { value: 0 },
};

export const GRADE_GLSL = /* glsl */ `
uniform vec3 uGradeTint;
uniform float uGradeSat;
uniform float uGradeCon;
uniform float uFlash;
vec3 biomeGrade(vec3 c) {
  c *= uGradeTint;
  // relâmpago: a cena inteira clareia e azula por um instante
  c = mix(c, vec3(0.92, 0.95, 1.0), uFlash * 0.55) + vec3(0.06, 0.07, 0.1) * uFlash;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uGradeSat);
  c = (c - 0.5) * uGradeCon + 0.5;
  return clamp(c, 0.0, 1.0);
}
`;

/** Pontos de amostragem: o jogador e dois anéis (~45m e ~110m) */
const SAMPLES: [number, number, number][] = (() => {
  const s: [number, number, number][] = [[0, 0, 3]];
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; s.push([Math.cos(a) * 45, Math.sin(a) * 45, 1.2]); }
  for (let i = 0; i < 8; i++) { const a = (i / 8 + 0.06) * Math.PI * 2; s.push([Math.cos(a) * 110, Math.sin(a) * 110, 0.6]); }
  return s;
})();
const SAMPLES_PER_FRAME = 3;

/** névoa = brilho * (mantém * cor do céu + luminância do céu * matiz): linear, então dá para misturar */
function fogTerms(p: Profile): number[] {
  const c = new THREE.Color(p.fog[0]);
  const l = Math.max(0.05, c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722);
  const a = p.fog[1], b = p.fog[2];
  return [b * (1 - a), b * a * c.r / l, b * a * c.g / l, b * a * c.b / l];
}
/** nuvens: [cobertura, mantém, matiz r g b, brilho iluminado, brilho sombra, vento, cinza] */
function cloudTerms(p: Profile): number[] {
  const k = p.cloud ?? {};
  const c = new THREE.Color(k.hue ?? '#ffffff');
  const l = Math.max(0.05, c.r * 0.2126 + c.g * 0.7152 + c.b * 0.0722);
  const a = k.amt ?? 0;
  return [k.cov ?? 0, 1 - a, a * c.r / l, a * c.g / l, a * c.b / l, k.lit ?? 1, k.shade ?? 1, k.wind ?? 1, k.grey ?? 0];
}
const CLOUD_TERMS = new Map<Profile, number[]>();
const cloudTermsOf = (p: Profile) => { let t = CLOUD_TERMS.get(p); if (!t) CLOUD_TERMS.set(p, t = cloudTerms(p)); return t; };
const FOG_TERMS = new Map<Profile, number[]>();
const fogTermsOf = (p: Profile) => { let t = FOG_TERMS.get(p); if (!t) FOG_TERMS.set(p, t = fogTerms(p)); return t; };

interface Mix {
  fog: number[]; dens: number[]; tint: number[]; sat: number; con: number; cloud: number[]; streaks: number;
  particles: Record<ParticleKind, number>;
}

function emptyMix(): Mix {
  const particles = {} as Record<ParticleKind, number>;
  for (const k of PARTICLE_KINDS) particles[k] = 0;
  return { fog: [1, 0, 0, 0], dens: [1, 1, 1], tint: [1, 1, 1], sat: 1, con: 1, cloud: cloudTerms(NEUTRAL), streaks: 0, particles };
}

/** O que a ambientação muda no céu (skybox.ts) */
export interface BiomeSky {
  setBiomeFog(keep: number, r: number, g: number, b: number): void;
  setBiomeClouds(cov: number, keep: number, r: number, g: number, b: number, lit: number, shade: number, wind: number, grey: number): void;
  /** direção do vento do mundo (as nuvens andam junto com as partículas) */
  setWindDirection(x: number, z: number): void;
}

export class BiomeAmbience {
  private samples: (Profile | null)[] = SAMPLES.map(() => null);
  private nextSample = 0;
  private anchorX = Infinity;
  private anchorZ = Infinity;
  private current = emptyMix();
  private target = emptyMix();
  private particles: BiomeParticles;
  private wind = new Wind();
  private streaks: WindStreaks;
  private rain: Rain;
  private weather: WeatherKind = 'auto';
  private wx: WeatherParams = { ...WEATHER_PARAMS.auto };
  private flash = 0;
  private nextBolt = 4;
  private hour = 12;
  private gfogX = 0;
  private gfogZ = 0;
  private boltEcho = -1;
  /** 0 na visão aérea, 1 em primeira pessoa (as partículas e a névoa extra só valem de perto) */
  private nearMode = 0;

  constructor(scene: THREE.Scene) {
    this.particles = new BiomeParticles(scene);
    this.streaks = new WindStreaks(scene);
    this.rain = new Rain(scene);
  }

  /** Hora do dia (0-24), para a névoa da manhã. */
  public setHour(h: number): void { this.hour = h; }

  /** Pingo de chuva caindo na água (main liga às ondulações da água do worldEngine). */
  public setRainRippleSink(fn: (x: number, z: number) => void): void {
    this.rain.splashes.onWaterHit = fn;
  }

  /** Clima do HUD (entra e sai em alguns segundos). */
  public setWeather(kind: WeatherKind): void {
    this.weather = kind;
  }

  /** Outra seed/teleporte: esquece as amostras (a mistura ainda transita suave). */
  public reset(): void {
    this.samples.fill(null);
    this.anchorX = Infinity;
  }

  public update(dt: number, terrainGen: TerrainGenerator, player: THREE.Vector3, camera: THREE.Camera,
    firstPerson: boolean, viewportWidth: number, viewportHeight: number, sky: BiomeSky): void {
    // amostras ancoradas no jogador; se ele andou muito, o anel inteiro é refeito aos poucos
    if (Math.hypot(player.x - this.anchorX, player.z - this.anchorZ) > 30) {
      this.anchorX = player.x; this.anchorZ = player.z;
    }
    for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
      const k = this.nextSample;
      this.nextSample = (k + 1) % SAMPLES.length;
      const [ox, oz] = SAMPLES[k];
      this.samples[k] = profileFor(terrainGen.getPointFast(this.anchorX + ox, this.anchorZ + oz).biome.type);
    }

    // alvo = média ponderada dos perfis amostrados
    const t = this.target;
    t.fog = [0, 0, 0, 0]; t.cloud = t.cloud.map(() => 0); t.dens = [0, 0, 0]; t.tint = [0, 0, 0]; t.sat = 0; t.con = 0; t.streaks = 0;
    for (const k of PARTICLE_KINDS) t.particles[k] = 0;
    let wSum = 0, pSum = 0;
    const share = new Map<Profile, number>();
    this.samples.forEach((p, i) => {
      if (!p) return;
      const w = SAMPLES[i][2];
      wSum += w;
      const ft = fogTermsOf(p);
      for (let c = 0; c < 4; c++) t.fog[c] += ft[c] * w;
      const ct = cloudTermsOf(p);
      for (let c = 0; c < ct.length; c++) t.cloud[c] += ct[c] * w;
      for (let c = 0; c < 3; c++) { t.dens[c] += p.dens[c] * w; t.tint[c] += p.tint[c] * w; }
      t.sat += p.sat * w; t.con += p.con * w; t.streaks += (p.streaks ?? 0) * w;
      // partículas: só o chão perto (jogador e anel de ~45m), não o anel distante
      if (i < 7) { pSum += w; share.set(p, (share.get(p) ?? 0) + w); }
    });
    if (wSum <= 0) return;
    const inv = 1 / wSum;
    for (let c = 0; c < 4; c++) t.fog[c] *= inv;
    for (let c = 0; c < t.cloud.length; c++) t.cloud[c] *= inv;
    for (let c = 0; c < 3; c++) { t.dens[c] *= inv; t.tint[c] *= inv; }
    t.sat *= inv; t.con *= inv; t.streaks *= inv;
    // só o bioma que domina em volta solta partículas: um pedaço pequeno de outono perto da neve
    // não espalha folhas coloridas no meio da nevasca
    for (const [p, w] of share) {
      const s = w / pSum;
      const k = THREE.MathUtils.smoothstep(s, 0.3, 0.7);
      for (const kind in p.particles) t.particles[kind as ParticleKind] += (p.particles[kind as ParticleKind] ?? 0) * k;
    }

    // transição de alguns segundos
    const a = 1 - Math.exp(-dt / 2.5);
    const cur = this.current;
    const lerp = (x: number, y: number) => x + (y - x) * a;
    for (let c = 0; c < 4; c++) cur.fog[c] = lerp(cur.fog[c], t.fog[c]);
    for (let c = 0; c < 3; c++) { cur.dens[c] = lerp(cur.dens[c], t.dens[c]); cur.tint[c] = lerp(cur.tint[c], t.tint[c]); }
    cur.sat = lerp(cur.sat, t.sat); cur.con = lerp(cur.con, t.con); cur.streaks = lerp(cur.streaks, t.streaks);
    for (const k of PARTICLE_KINDS) cur.particles[k] = lerp(cur.particles[k], t.particles[k]);
    // nuvens: o céu inteiro muda junto, então devagar (~30s para assentar)
    const ac = 1 - Math.exp(-dt / 9);
    for (let c = 0; c < cur.cloud.length; c++) cur.cloud[c] += (t.cloud[c] - cur.cloud[c]) * ac;
    this.nearMode += ((firstPerson ? 1 : 0) - this.nearMode) * (1 - Math.exp(-dt / 0.6));

    // clima do HUD: anda até o alvo em ~3s
    const wt = WEATHER_PARAMS[this.weather], aw = 1 - Math.exp(-dt / 3);
    for (const k of Object.keys(wt) as (keyof WeatherParams)[]) {
      if (k === 'rain' || k === 'snow') continue;
      this.wx[k] += (wt[k] - this.wx[k]) * aw;
    }
    // chuva e neve começam como garoa e vão engrossando (~20s até o máximo); param mais rápido
    for (const k of ['rain', 'snow'] as const) {
      const up = wt[k] > this.wx[k];
      this.wx[k] = up ? Math.min(wt[k], this.wx[k] + dt / 20) : this.wx[k] + (wt[k] - this.wx[k]) * (1 - Math.exp(-dt / 4));
    }
    const wx = this.wx;
    // em bioma gelado a chuva cai como neve
    const cold = Math.min(1, cur.particles.snow * 1.6);
    const rainAmt = wx.rain * (1 - cold);
    const snowAmt = Math.max(wx.snow, wx.rain * cold);

    // névoa: cor sempre; densidade extra mais contida na visão aérea (lá a névoa já começa longe)
    sky.setBiomeFog(cur.fog[0], cur.fog[1], cur.fog[2], cur.fog[3]);
    const cl = cur.cloud;
    sky.setBiomeClouds(cl[0], cl[1], cl[2], cl[3], cl[4], cl[5], cl[6], cl[7], cl[8]);
    const dk = 0.5 + 0.5 * this.nearMode;
    Object.assign(AERIAL.uFogBiome.value, {
      x: (1 + (cur.dens[0] - 1) * dk) * wx.fog,
      y: (1 + (cur.dens[1] - 1) * dk) * wx.fog,
      z: (1 + (cur.dens[2] - 1) * dk) * Math.sqrt(wx.fog),
    });
    // chuva/tempestade: tudo mais escuro e um pouco mais frio
    Object.assign(GRADE.uGradeTint.value, { x: cur.tint[0] * wx.dark * 0.98, y: cur.tint[1] * wx.dark, z: cur.tint[2] * Math.min(1, wx.dark * 1.06) });
    GRADE.uGradeSat.value = cur.sat * (0.6 + 0.4 * wx.dark);
    GRADE.uGradeCon.value = cur.con;

    // vento: força pelo bioma (o mesmo multiplicador das nuvens)
    this.wind.update(dt, cl[7] * wx.wind);
    WIND_U.uWindDir.value.set(this.wind.x, this.wind.z);
    WIND_U.uWindStr.value = this.wind.strength;
    WIND_U.uWindT.value = (WIND_U.uWindT.value + dt) % 3600;
    sky.setWindDirection(this.wind.x, this.wind.z);
    const parts = snowAmt > 0.01 ? { ...cur.particles, snow: Math.max(cur.particles.snow, snowAmt) } : cur.particles;
    this.particles.update(dt, camera, parts, this.nearMode, viewportHeight, this.wind);
    this.rain.update(dt, camera, this.wind, rainAmt * this.nearMode, viewportWidth, viewportHeight, (x, z) => {
      const p = terrainGen.getPointFast(x, z);
      const water = p.isWater || p.waterSurfaceY > p.height;
      return { y: water ? Math.max(p.height, p.waterSurfaceY) : p.height, water };
    });

    // relâmpagos: de vez em quando (a cada 4-14s), às vezes com um segundo clarão logo depois
    this.flash = Math.max(0, this.flash - dt * 4.5);
    if (wx.lightning > 0.5) {
      this.nextBolt -= dt;
      if (this.boltEcho >= 0) {
        this.boltEcho -= dt;
        if (this.boltEcho < 0) this.flash = 0.7;
      }
      if (this.nextBolt <= 0) {
        this.flash = 1;
        this.nextBolt = 4 + Math.random() * 10;
        this.boltEcho = Math.random() < 0.55 ? 0.12 + Math.random() * 0.15 : -1;
      }
    }
    GRADE.uFlash.value = this.flash * wx.lightning;

    // névoa baixa da manhã: sobe de madrugada (~4h30), é máxima ao nascer do sol (~6h) e some até
    // ~9h30; mais forte em bioma úmido (a "névoa baixa" do perfil), quase nada no deserto; garoa e
    // chuva já fecham o tempo sozinhas
    {
      const h = this.hour;
      const morning = THREE.MathUtils.smoothstep(h, 4.5, 6.0) * (1 - THREE.MathUtils.smoothstep(h, 6.6, 9.6));
      const humid = THREE.MathUtils.clamp((cur.dens[1] - 0.3) / 0.7, 0, 1.4);
      const g = AERIAL.uGFog.value;
      g.x = morning * humid * (1 - Math.min(1, wx.rain * 1.5)) * (0.6 + 0.4 * this.nearMode);
      this.gfogX += this.wind.x * dt * 1.2;
      this.gfogZ += this.wind.z * dt * 1.2;
      g.y = this.gfogX; g.z = this.gfogZ;
    }

    // umidade do chão: enche em ~40s de chuva forte (mais devagar na garoa) e seca em ~2min
    const rainNorm = Math.min(1, rainAmt / 0.5);
    WET.uRainNow.value = rainNorm;
    WET.uWetTime.value = (WET.uWetTime.value + dt) % 3600;
    const wet = WET.uWet.value;
    WET.uWet.value = rainNorm > 0.05
      ? Math.min(1, wet + dt * rainNorm / 40)
      : Math.max(0, wet - dt / 120);
    this.streaks.update(dt, camera, this.wind, cur.streaks * this.nearMode, viewportWidth, viewportHeight);
  }

  /** Para depuração: quanto de cada partícula e os valores atuais. */
  public debug(): Mix {
    return this.current;
  }
}
