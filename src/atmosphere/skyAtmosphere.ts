import * as THREE from 'three';
import { ShadowClipmap } from './shadowClipmap.ts';
import { CartoonSkybox } from './skybox.ts';

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
    sunElevation: 62,
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
    ambientColor: '#5c2d44',
    fogColor: '#301224',
    skyColor: '#c84428',
    zenithColor: '#2b123c',
    horizonColor: '#ff6228',
    cloudColor: '#ffe4b8',
    cloudShadowColor: '#582442',
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
    ambientColor: '#5a486e',
    fogColor: '#221430',
    skyColor: '#625488',
    zenithColor: '#1e143c',
    horizonColor: '#e0685c',
    cloudColor: '#f8b8ac',
    cloudShadowColor: '#38224c',
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
    sunColor: '#c84868',
    ambientColor: '#2c1840',
    fogColor: '#140a22',
    skyColor: '#281846',
    zenithColor: '#100824',
    horizonColor: '#8c1c4c',
    cloudColor: '#c0648c',
    cloudShadowColor: '#220e2c',
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
    sunColor: '#62589e',
    ambientColor: '#140c24',
    fogColor: '#060410',
    skyColor: '#0a081a',
    zenithColor: '#080c1e',
    horizonColor: '#121c38',
    cloudColor: '#6a7c9e',
    cloudShadowColor: '#0e1628',
    sunDiskColor: '#000000',
    sunCoronaColor: '#000000',
    starVisibility: 0.95,
    moonVisibility: 1.0,
    cloudCoverage: 0.40
  }
};

export class SkyAtmosphere {
  private scene: THREE.Scene;
  private shadowClipmap: ShadowClipmap;
  private hemiLight: THREE.HemisphereLight;
  private ambientLight: THREE.AmbientLight;
  private skybox: CartoonSkybox;
  private currentPreset: TimePreset = TIME_PRESETS.NOON;
  private currentSunDir: THREE.Vector3 = new THREE.Vector3(0.5, 0.8, 0.35).normalize();

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    // Inicialização do sistema concêntrico de Shadow Clipmap (Níveis 0, 1 e 2 com Texel Snapping)
    this.shadowClipmap = new ShadowClipmap(this.scene);

    // Inicialização do CartoonSkybox estilizado
    this.skybox = new CartoonSkybox();
    this.scene.add(this.skybox.getMesh());

    this.hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.95);
    this.scene.add(this.hemiLight);

    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.70);
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
    this.shadowClipmap.setSunColor(preset.sunColor, 1.35);

    this.hemiLight.color.set(preset.skyColor);
    this.hemiLight.groundColor.set(preset.ambientColor);
    this.ambientLight.color.set(preset.ambientColor);

    // O fundo da cena é gerenciado pelo CartoonSkybox mesh
    this.scene.background = null;
    this.scene.fog = new THREE.Fog(preset.fogColor, 200, 2400);

    // Sincroniza parâmetros celestes do Skybox
    this.skybox.syncWithPreset(preset, sunDir);
  }

  public updateTarget(x: number, y: number, z: number): void {
    this.shadowClipmap.updateTarget(x, y, z);
  }

  public update(delta: number, cameraPosition: THREE.Vector3): void {
    this.skybox.update(delta, cameraPosition);
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
