import * as THREE from 'three';
import { SeedManager } from './seed/seedManager.ts';
import { TerrainGenerator } from './terrain/terrainGenerator.ts';
import { VegetationManager } from './vegetation/vegetationManager.ts';
import { ChunkManager } from './terrain/chunkManager.ts';
import { GeothermalManager } from './geothermal/geothermalManager.ts';
import { GlacialIceManager } from './ice/glacialIceManager.ts';
import { CaveFeatureManager } from './caves/caveFeatureManager.ts';
import { LavaFluidManager } from './volcanology/lavaFluidManager.ts';
import { InlandWaterManager } from './hydrology/inlandWaterManager.ts';
import { createTerrainMaterial } from './shaders/terrainShader.ts';
import { createWaterMaterial, WATER_PRESETS } from './shaders/waterShader.ts';
import { createSeamlessCascadedWaterGeometry } from './waterGeometry.ts';
import { TerrainPoint, WorldSpawnPoint } from './types.ts';
import { CONFIG } from '../config.ts';

interface RipplePoint {
  x: number;
  z: number;
  radius: number;
  maxRadius: number;
  strength: number;
  decay: number;
  age: number;
}

export class WorldEngine {
  private scene: THREE.Scene;
  private seedManager: SeedManager;
  private terrainGen: TerrainGenerator;
  private vegetationMgr: VegetationManager;
  private chunkMgr: ChunkManager;
  private terrainMaterial: THREE.ShaderMaterial;
  private waterMaterial: THREE.ShaderMaterial;

  // Novos Subsistemas Geológicos, Hidrológicos e Biológicos
  public geothermalMgr: GeothermalManager;
  public glacialIceMgr: GlacialIceManager;
  public caveFeatureMgr: CaveFeatureManager;
  public lavaFluidMgr: LavaFluidManager;
  public inlandWaterMgr: InlandWaterManager;

  // Grupo e malhas de água: malha local de alta densidade para ondas físicas 3D + saia oceânica para o horizonte
  private waterGroup: THREE.Group;
  private localWater: THREE.Mesh;
  private globalOcean: THREE.Mesh;

  // Sistema de ripples interativas portado de untitled
  private ripples: RipplePoint[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.seedManager = SeedManager.getInstance();

    const numericSeed = this.seedManager.getNumericSeed();
    this.terrainGen = new TerrainGenerator(numericSeed);
    this.vegetationMgr = new VegetationManager();

    this.terrainMaterial = createTerrainMaterial();
    this.waterMaterial = createWaterMaterial();

    this.chunkMgr = new ChunkManager(
      this.scene,
      this.terrainGen,
      this.vegetationMgr,
      this.terrainMaterial,
      this.waterMaterial
    );

    // Inicializa todos os subsistemas especiais do mundo de forma 100% procedural
    this.geothermalMgr = new GeothermalManager(this.scene, this.terrainGen.getGeothermalGenerator());
    this.glacialIceMgr = new GlacialIceManager(this.scene, numericSeed, this.terrainGen);
    this.caveFeatureMgr = new CaveFeatureManager(this.scene, numericSeed, this.terrainGen);
    this.lavaFluidMgr = new LavaFluidManager(this.scene, this.terrainGen.getVolcanoGenerator());
    this.inlandWaterMgr = new InlandWaterManager(this.scene, this.terrainGen.getHydrology());

    // Grupo de água dedicado para controle no passe de renderização
    this.waterGroup = new THREE.Group();
    this.waterGroup.name = 'pixel_water_system';

    // Malha unificada de água em cascata concêntrica (Cascaded Infinite Ocean):
    // Elimina 100% dos artefatos de "quadrado/diamante na água" e as 4 lacunas de água faltante.
    // Grade central de alta resolução (1024m x 1024m) com anéis externos contínuos até 8.192m (16km de diâmetro).
    const waterGeo = createSeamlessCascadedWaterGeometry();
    this.localWater = new THREE.Mesh(waterGeo, this.waterMaterial);
    this.localWater.rotation.x = -Math.PI / 2;
    this.localWater.position.set(0, CONFIG.SEA_LEVEL, 0);
    this.localWater.renderOrder = 2;
    this.globalOcean = this.localWater; // Alias para compatibilidade
    this.waterGroup.add(this.localWater);

    this.scene.add(this.waterGroup);
  }

  public updateObserverPosition(x: number, z: number): void {
    this.chunkMgr.update(x, z);
    // Move a malha de água com snap na grade de 8m (tamanho exato dos quads centrais).
    // Isso mantém os vértices 100% estáticos no espaço de mundo durante a caminhada,
    // eliminando qualquer deslizamento de triângulos e a trepidação nas margens.
    const snap = 8.0;
    const snapX = Math.floor(x / snap) * snap;
    const snapZ = Math.floor(z / snap) * snap;
    this.localWater.position.x = snapX;
    this.localWater.position.z = snapZ;
  }

  public queryPoint(x: number, z: number): TerrainPoint {
    return this.terrainGen.getPoint(x, z);
  }

  // Algoritmo de busca por ponto de nascimento seguro em terra firme com vista panorâmica
  public getSpawnCoordinate(): WorldSpawnPoint {
    // Inicia a busca a partir da origem do continente inicial (0, 0)
    const startX = 0;
    const startZ = 0;

    // Varredura em espiral procurando o melhor local: terra firme continental, altitude cênica, baixa inclinação
    let bestX = startX;
    let bestZ = startZ;
    let bestScore = -9999;

    const maxR = 650;
    const stepR = 25;

    for (let r = 0; r <= maxR; r += stepR) {
      const angleSteps = Math.max(8, Math.floor((r * 2 * Math.PI) / 30));
      for (let a = 0; a < angleSteps; a++) {
        const theta = (a / angleSteps) * Math.PI * 2;
        const testX = startX + Math.cos(theta) * r;
        const testZ = startZ + Math.sin(theta) * r;

        const pt = this.terrainGen.getPoint(testX, testZ);

        if (!pt.isWater && pt.height > CONFIG.BEACH_HEIGHT + 2.0 && pt.slope < 0.35) {
          // Pontuação: prefere altitude entre 10m e 35m em prados ou bosques
          const altScore = 50.0 - Math.abs(pt.height - 18.0);
          const slopePenalty = pt.slope * 40.0;
          const score = altScore - slopePenalty;

          if (score > bestScore) {
            bestScore = score;
            bestX = testX;
            bestZ = testZ;
          }
        }
      }

      // Se encontrou uma posição excelente, pode parar
      if (bestScore > 35.0) {
        break;
      }
    }

    const finalElevation = this.terrainGen.getHeight(bestX, bestZ);
    return {
      x: bestX,
      z: bestZ,
      elevation: finalElevation
    };
  }

  public reseed(seedString?: string): void {
    if (seedString !== undefined) {
      this.seedManager.setSeed(seedString);
    }
    const newSeed = this.seedManager.getNumericSeed();
    this.terrainGen.reseed(newSeed);
    this.geothermalMgr.reseed(newSeed);
    this.lavaFluidMgr.rebuild(this.terrainGen.getVolcanoGenerator());
    this.inlandWaterMgr.rebuild(this.terrainGen.getHydrology());
    this.chunkMgr.clearAll();

    const spawn = this.getSpawnCoordinate();
    this.chunkMgr.update(spawn.x, spawn.z, true);
    this.localWater.position.x = spawn.x;
    this.localWater.position.z = spawn.z;
    this.globalOcean.position.x = spawn.x;
    this.globalOcean.position.z = spawn.z;
  }

  public addRipple(worldX: number, worldZ: number, strength = 1.0): void {
    this.ripples.push({
      x: worldX,
      z: worldZ,
      radius: 0.05,
      maxRadius: 2.8,
      strength: strength * 0.9,
      decay: 0.88,
      age: 0,
    });
    if (this.ripples.length > 8) {
      this.ripples.shift();
    }
  }

  public updateSimulation(dt: number): void {
    this.waterMaterial.uniforms.uTime.value += dt;
    if (this.terrainMaterial && this.terrainMaterial.uniforms.uTime) {
      this.terrainMaterial.uniforms.uTime.value += dt;
    }

    // Atualização física das ondulações interativas portadas de untitled
    const activeRipples = this.ripples;
    const rippleData = new Float32Array(8 * 4);
    for (let i = 0; i < activeRipples.length; i++) {
      const rip = activeRipples[i];
      rip.age += dt;
      rip.radius += dt * 4.2; // Expansão snappier
      rip.strength *= Math.pow(rip.decay, dt * 60);

      rippleData[i * 4 + 0] = rip.x;
      rippleData[i * 4 + 1] = rip.z;
      rippleData[i * 4 + 2] = rip.radius;
      rippleData[i * 4 + 3] = rip.strength;
    }
    this.ripples = activeRipples.filter((r) => r.strength > 0.06 && r.radius < r.maxRadius);
    this.waterMaterial.uniforms.uRipples.value = rippleData;
    this.waterMaterial.uniforms.uActiveRipples.value = this.ripples.length;

    this.geothermalMgr.update(dt);
    this.lavaFluidMgr.update(dt);
    this.inlandWaterMgr.update(dt);
  }

  public syncLighting(
    sunDirection: THREE.Vector3,
    sunColor: THREE.Color,
    ambientColor: THREE.Color,
    fogColor: THREE.Color
  ): void {
    this.terrainMaterial.uniforms.uSunDirection.value.copy(sunDirection);
    this.terrainMaterial.uniforms.uSunColor.value.copy(sunColor);
    this.terrainMaterial.uniforms.uAmbientColor.value.copy(ambientColor);
    this.terrainMaterial.uniforms.uFogColor.value.copy(fogColor);

    this.waterMaterial.uniforms.uLightDir.value.copy(sunDirection).normalize();

    this.lavaFluidMgr.syncLighting(sunDirection, sunColor, fogColor);
    this.inlandWaterMgr.syncLighting(sunDirection, sunColor, fogColor);
  }

  public getWaterGroup(): THREE.Group {
    return this.waterGroup;
  }

  public getWaterMaterial(): THREE.ShaderMaterial {
    return this.waterMaterial;
  }

  public setWaterVisible(visible: boolean): void {
    this.waterGroup.visible = visible;
  }

  public setWaterPreset(presetKey: string): void {
    const p = WATER_PRESETS[presetKey];
    if (!p) return;
    const u = this.waterMaterial.uniforms;
    u.uDeepColor.value.set(p.waterDeepColor);
    u.uShallowColor.value.set(p.waterShallowColor);
    u.uFoamColor.value.set(p.foamColor);
    u.uCrestColor.value.set(p.crestColor);
    u.uOpacity.value = p.waterOpacity;
    u.uFoamAmount.value = p.foamAmount;
    u.uFoamDistance.value = p.foamDistance;
    if (presetKey === 'toxic' || presetKey === 'magma') {
      u.uBiomeColorEnabled.value = 0.0;
    } else {
      u.uBiomeColorEnabled.value = 1.0;
    }
  }

  public updateWaterUniforms(
    sceneDepth: THREE.DepthTexture | null,
    planarReflection: THREE.Texture | null,
    reflectMatrix: THREE.Matrix4,
    camera: THREE.Camera,
    resX: number,
    resY: number
  ): void {
    const u = this.waterMaterial.uniforms;
    if (sceneDepth) {
      u.tDepth.value = sceneDepth;
    }
    if (planarReflection) {
      u.tPlanarReflection.value = planarReflection;
    }
    u.uReflectTextureMatrix.value.copy(reflectMatrix);
    u.uResolution.value.set(resX, resY);

    if (camera instanceof THREE.PerspectiveCamera) {
      u.uIsOrthographic.value = 0.0;
      u.uCameraNear.value = camera.near;
      u.uCameraFar.value = camera.far;
    } else if (camera instanceof THREE.OrthographicCamera) {
      u.uIsOrthographic.value = 1.0;
      u.uCameraNear.value = camera.near;
      u.uCameraFar.value = camera.far;
    }
  }

  public getSeedManager(): SeedManager {
    return this.seedManager;
  }

  public getTerrainGenerator(): TerrainGenerator {
    return this.terrainGen;
  }

  public getChunkManager(): ChunkManager {
    return this.chunkMgr;
  }
}
