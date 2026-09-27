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
import { TerrainTextureForge } from './terrain/terrainTextureForge.ts';
import { getTextureWorkerPool } from './terrain/textureWorkerPool.ts';
import { WaterBiomeMap } from './hydrology/waterBiomeMap.ts';
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
  private terrainMaterial: THREE.Material;
  private waterMaterial: THREE.ShaderMaterial;
  private waterBiomeMap: WaterBiomeMap;
  public forge: TerrainTextureForge;

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

  private lastObserverX: number = 0;
  private lastObserverZ: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.seedManager = SeedManager.getInstance();

    const numericSeed = this.seedManager.getNumericSeed();
    this.terrainGen = new TerrainGenerator(numericSeed);
    // Hidrologia das ilhas: calculada nos workers dos chunks e instalada aqui (calcular na thread
    // principal travava o jogo por 0.3-1s ao chegar numa ilha nova)
    this.terrainGen.getHydrology().setDeferMissing(true);
    // (exposto para depuração/medição, como __WORLD__)
    (globalThis as any).__POOL__ = getTextureWorkerPool();
    getTextureWorkerPool().onHydrology = (seed, key, data) => {
      if (seed === this.terrainGen.getSeed()) this.terrainGen.getHydrology().installIsland(key, data);
    };
    this.vegetationMgr = new VegetationManager();

    this.forge = TerrainTextureForge.getInstance(numericSeed);
    this.terrainMaterial = createTerrainMaterial();
    this.waterMaterial = createWaterMaterial();
    this.waterBiomeMap = new WaterBiomeMap(this.terrainGen);
    this.waterMaterial.uniforms.uBiomeMap.value = this.waterBiomeMap.texture;
    this.waterMaterial.uniforms.uBiomeMapOrigin.value = this.waterBiomeMap.origin;
    this.waterMaterial.uniforms.uBiomeMapSpan.value = this.waterBiomeMap.span;

    this.chunkMgr = new ChunkManager(
      this.scene,
      this.terrainGen,
      this.vegetationMgr,
      this.terrainMaterial,
      this.waterMaterial,
      this.forge
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

  /** Ilhas cuja hidrologia já foi pedida aos workers (por seed) */
  private requestedIslands = new Set<string>();
  private islandsSentToWorkers = new Set<number>();

  /**
   * Pede com antecedência a hidrologia das ilhas em volta da câmera (3x3 células de ilha - as
   * que os chunks daqui consultam): um worker calcula e todos recebem, antes dos chunks chegarem.
   */
  private prefetchIslands(x: number, z: number): void {
    const G = CONFIG.ISLAND_GRID_SIZE;
    const cx = Math.round(x / G), cz = Math.round(z / G);
    const seed = this.terrainGen.getSeed();
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const k = seed + ':' + (cx + dx) + ':' + (cz + dz);
        if (this.requestedIslands.has(k)) continue;
        // só a ilha que os chunks em volta da câmera usam agora é pedida com antecedência; as
        // outras o pool pede sozinho quando um chunk precisar delas (na ordem dos chunks). Pedir as
        // 8 vizinhas logo no início ocupava todos os workers por ~1.5s antes dos chunks de perto
        const near = Math.abs(x - (cx + dx) * G) < 2300 && Math.abs(z - (cz + dz) * G) < 2300;
        if (!near) continue;
        this.requestedIslands.add(k);
        // já calculada aqui (ponto de nascimento) e mandada aos workers: não pede de novo
        if (this.terrainGen.getHydrology().hasIsland(cx + dx, cz + dz)) continue;
        getTextureWorkerPool().prefetchIsland(seed, cx + dx, cz + dz, -1);
      }
    }
  }

  public updateObserverPosition(x: number, z: number): void {
    this.lastObserverX = x;
    this.lastObserverZ = z;
    this.prefetchIslands(x, z);
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

  public updateTextureForgeParams(params: Partial<import('./terrain/terrainTextureForge.ts').ForgeParams>, density?: number): void {
    this.forge.updateParams(params, density);
    this.chunkMgr.clearAll();
    this.chunkMgr.update(this.lastObserverX, this.lastObserverZ, true);
  }

  /** Texels por metro efetivamente desenhados no chão (densidade do forge × escala do pixel). */
  public getTexelDensity(): number {
    return this.forge.density * (this.forge.params.pixelScale || 1.0);
  }

  public updatePixelScale(scale: number): void {
    this.forge.params.pixelScale = scale;
    this.chunkMgr.updatePixelScale(scale);
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
    // o ponto de nascimento precisa dos rios de verdade (senão nasce dentro d'água): aqui, no
    // carregamento, calcular a hidrologia na hora é aceitável
    const hydro = this.terrainGen.getHydrology();
    hydro.setDeferMissing(false);

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
    hydro.setDeferMissing(true);
    // as ilhas calculadas aqui vão prontas para os workers
    getTextureWorkerPool().broadcastIslands(this.terrainGen.getSeed(), hydro.exportIslands(this.islandsSentToWorkers));
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
    this.islandsSentToWorkers.clear();
    this.waterBiomeMap.invalidate();
    this.geothermalMgr.reseed(newSeed);
    this.lavaFluidMgr.rebuild(this.terrainGen.getVolcanoGenerator());
    this.inlandWaterMgr.rebuild(this.terrainGen.getHydrology());
    
    this.forge.dispose();
    this.forge = new TerrainTextureForge(newSeed);
    this.chunkMgr.setForge(this.forge);
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
    this.vegetationMgr.update(dt);
    this.waterMaterial.uniforms.uTime.value += dt;
    this.waterMaterial.uniforms.uTexelDensity.value = this.getTexelDensity();
    this.waterBiomeMap.update(this.lastObserverX, this.lastObserverZ);
    this.waterMaterial.uniforms.uBiomeMapReady.value = this.waterBiomeMap.ready ? 1.0 : 0.0;
    if ((this.terrainMaterial as any)?.uniforms?.uTime) {
      (this.terrainMaterial as any).uniforms.uTime.value += dt;
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
    const tm = this.terrainMaterial as any;
    if (tm?.uniforms) {
      if (tm.uniforms.uSunDirection) tm.uniforms.uSunDirection.value.copy(sunDirection);
      if (tm.uniforms.uSunColor) tm.uniforms.uSunColor.value.copy(sunColor);
      if (tm.uniforms.uAmbientColor) tm.uniforms.uAmbientColor.value.copy(ambientColor);
      if (tm.uniforms.uFogColor) tm.uniforms.uFogColor.value.copy(fogColor);
    }

    this.waterMaterial.uniforms.uLightDir.value.copy(sunDirection).normalize();

    this.lavaFluidMgr.syncLighting(sunDirection, sunColor, fogColor);
    this.inlandWaterMgr.syncLighting(sunDirection, sunColor, fogColor);
  }

  /** Personagem que afasta a grama 3D ao passar (radius = 0 desliga). */
  /** Envia à GPU só a vegetação dentro (ou perto) do campo de visão da câmera. */
  public cullVegetation(camera: THREE.Camera): boolean {
    return this.vegetationMgr.instances.cull(camera);
  }

  public setGrassBillboard(on: boolean): void {
    this.vegetationMgr.setGrassBillboard(on);
  }

  public setGrassPusher(x: number, y: number, z: number, radius: number): void {
    this.vegetationMgr.setGrassPusher(x, y, z, radius);
  }

  public setFogRange(near: number, far: number): void {
    this.lavaFluidMgr.setFogRange(near, far);
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

  public setViewRadius(radius: number, retainRadius: number = 0): void {
    this.chunkMgr.setViewRadius(radius, retainRadius);
  }

  public getChunkManager(): ChunkManager {
    return this.chunkMgr;
  }
}
