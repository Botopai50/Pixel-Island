import * as THREE from 'three';
import { TerrainGenerator } from '../terrain/terrainGenerator.ts';
import { clamp, smoothstep } from '../math/mathUtils.ts';

const RES = 128;
const CELL = 12; // metros por texel → cobre ~1.5km ao redor do jogador
const SPAN = RES * CELL;
const REBUILD_DISTANCE = SPAN * 0.2;

// Profundidade máxima codificada no canal A (metros): abaixo disso as ondas já estão no tamanho cheio
const MAX_ENCODED_DEPTH = 6;

/**
 * Mapa de tons da água (R = ártico, G = manguezal, B = tropical) calculado com o MESMO clima e a
 * mesma regra polar do BiomeManager, para a cor da água bater com o bioma real ao redor.
 * O canal A guarda a profundidade do fundo (0..MAX_ENCODED_DEPTH), usada para amortecer as ondas
 * em água rasa (senão a linha da costa anda metros para frente e para trás numa praia suave).
 * É reconstruído aos poucos (orçamento por frame) quando o jogador se afasta do centro.
 */
export class WaterBiomeMap {
  public readonly texture: THREE.DataTexture;
  public readonly origin = new THREE.Vector2(0, 0);
  public readonly span = SPAN;
  public ready = false;

  private terrainGen: TerrainGenerator;
  private buildData = new Uint8Array(RES * RES * 4);
  private buildRow = -1;
  private buildOriginX = 0;
  private buildOriginZ = 0;

  constructor(terrainGen: TerrainGenerator) {
    this.terrainGen = terrainGen;
    this.texture = new THREE.DataTexture(new Uint8Array(RES * RES * 4), RES, RES, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  /** Descarta o mapa atual (ex.: nova seed) e força uma reconstrução completa. */
  public invalidate(): void {
    this.ready = false;
    this.buildRow = -1;
  }

  public update(centerX: number, centerZ: number, budgetMs: number = 2.0): void {
    if (this.buildRow < 0) {
      const cx = this.origin.x + SPAN / 2, cz = this.origin.y + SPAN / 2;
      const far = Math.abs(centerX - cx) > REBUILD_DISTANCE || Math.abs(centerZ - cz) > REBUILD_DISTANCE;
      if (this.ready && !far) return;
      this.buildOriginX = Math.floor((centerX - SPAN / 2) / CELL) * CELL;
      this.buildOriginZ = Math.floor((centerZ - SPAN / 2) / CELL) * CELL;
      this.buildRow = 0;
    }

    const start = performance.now();
    while (this.buildRow < RES && performance.now() - start < budgetMs) {
      const z = this.buildOriginZ + (this.buildRow + 0.5) * CELL;
      for (let col = 0; col < RES; col++) {
        const x = this.buildOriginX + (col + 0.5) * CELL;
        this.writeTint((this.buildRow * RES + col) * 4, x, z);
      }
      this.buildRow++;
    }

    if (this.buildRow >= RES) {
      (this.texture.image.data as Uint8Array).set(this.buildData);
      this.texture.needsUpdate = true;
      this.origin.set(this.buildOriginX, this.buildOriginZ);
      this.ready = true;
      this.buildRow = -1;
    }
  }

  private writeTint(o: number, x: number, z: number): void {
    const biomeMgr = this.terrainGen.getBiomeManager();
    // A água assume o clima da margem que a cerca: altura média da terra num anel de 36m. Um lago
    // no nível do mar cercado de terreno mais alto (e mais frio) fica com o tom da floresta ao
    // redor, não com o de uma planície quente ao nível do mar. No mar aberto isso dá ~0.
    const r = 36;
    const shoreElevation = (
      Math.max(0, this.terrainGen.getHeight(x + r, z)) + Math.max(0, this.terrainGen.getHeight(x - r, z)) +
      Math.max(0, this.terrainGen.getHeight(x, z + r)) + Math.max(0, this.terrainGen.getHeight(x, z - r))
    ) / 4;
    const { temperature, moisture } = this.terrainGen.getClimate(x, z, shoreElevation);
    const polarZ = biomeMgr.polarLatitudeZ(x, z);
    const ice = this.terrainGen.getIceInfluence(x, z, 0);

    // Mesmos limiares das regras do BiomeManager (FROZEN_TUNDRA abaixo de 0.28-0.32 ou além da
    // latitude polar; MANGROVE_SWAMP e biomas tropicais acima de 0.60). As rampas suaves começam
    // exatamente no limiar, nunca antes: senão um lago em floresta temperada pegava tom de pântano.
    const arctic = Math.max(
      smoothstep(-440, -520, polarZ),
      1 - smoothstep(0.26, 0.34, temperature),
      smoothstep(0.05, 0.15, ice)
    );
    const warm = smoothstep(0.60, 0.68, temperature) * (1 - arctic);
    const swamp = warm * smoothstep(0.52, 0.62, moisture);
    const tropical = warm * (1 - swamp);

    const depth = clamp(-this.terrainGen.getHeight(x, z), 0, MAX_ENCODED_DEPTH);

    this.buildData[o] = Math.round(clamp(arctic, 0, 1) * 255);
    this.buildData[o + 1] = Math.round(clamp(swamp, 0, 1) * 255);
    this.buildData[o + 2] = Math.round(clamp(tropical, 0, 1) * 255);
    this.buildData[o + 3] = Math.round((depth / MAX_ENCODED_DEPTH) * 255);
  }
}
