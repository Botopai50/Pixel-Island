import * as THREE from 'three';
import { TerrainGenerator } from '../terrain/terrainGenerator.ts';
import { clamp } from '../math/mathUtils.ts';

const RES = 256;
const CELL = 3; // metros por texel → cobre ~770m ao redor do jogador
const SPAN = RES * CELL;
const REBUILD_DISTANCE = SPAN * 0.2;
/** Velocidade máxima codificada (m/s) */
export const FLOW_MAX_SPEED = 2.0;
/**
 * Período (s de viagem da água) da fase das linhas de correnteza. A fase vai como cos/sin: assim
 * a leitura interpolada entre texels nunca salta (o tempo de viagem cru passa de 1000s e não cabe
 * em 8 bits; guardado com "mod" ele saltaria de P para 0 e a interpolação criaria uma faixa errada).
 */
export const FLOW_PHASE_PERIOD = 24.0;
/** Distância lateral máxima codificada (m) */
const ACROSS_MAX = 16.0;

/**
 * Mapa da correnteza dos rios em volta do jogador, para o shader da água: RG = velocidade da
 * água (rio abaixo; 0.5 = parada), B = presença de rio (0 no mar, nos lagos e longe dos rios).
 * Reconstruído aos poucos (orçamento por quadro) quando o jogador se afasta do centro, como o
 * WaterBiomeMap. lineTexture (linhas de correnteza): RG = fase do tempo de viagem da água (cos,
 * sin), B = distância lateral ao eixo do rio.
 */
export class RiverFlowMap {
  public readonly texture: THREE.DataTexture;
  public readonly lineTexture: THREE.DataTexture;
  public readonly origin = new THREE.Vector2(0, 0);
  public readonly span = SPAN;
  public ready = false;

  private terrainGen: TerrainGenerator;
  private buildData = new Uint8Array(RES * RES * 4);
  private buildLine = new Uint8Array(RES * RES * 4);
  private buildRow = -1;
  private buildOriginX = 0;
  private buildOriginZ = 0;
  private flow: number[] = [0, 0, 0, 0, 0];

  constructor(terrainGen: TerrainGenerator) {
    this.terrainGen = terrainGen;
    const data = new Uint8Array(RES * RES * 4);
    for (let i = 0; i < RES * RES; i++) { data[i * 4] = 128; data[i * 4 + 1] = 128; }
    this.texture = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat);
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.colorSpace = THREE.NoColorSpace;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
    this.lineTexture = new THREE.DataTexture(new Uint8Array(RES * RES * 4), RES, RES, THREE.RGBAFormat);
    this.lineTexture.magFilter = THREE.LinearFilter;
    this.lineTexture.minFilter = THREE.LinearFilter;
    this.lineTexture.generateMipmaps = false;
    this.lineTexture.colorSpace = THREE.NoColorSpace;
    this.lineTexture.needsUpdate = true;
  }

  public invalidate(): void {
    this.ready = false;
    this.buildRow = -1;
  }

  public update(centerX: number, centerZ: number, budgetMs: number = 1.5): void {
    if (this.buildRow < 0) {
      const cx = this.origin.x + SPAN / 2, cz = this.origin.y + SPAN / 2;
      const far = Math.abs(centerX - cx) > REBUILD_DISTANCE || Math.abs(centerZ - cz) > REBUILD_DISTANCE;
      if (this.ready && !far) return;
      this.buildOriginX = Math.floor((centerX - SPAN / 2) / CELL) * CELL;
      this.buildOriginZ = Math.floor((centerZ - SPAN / 2) / CELL) * CELL;
      this.buildRow = 0;
    }

    const start = performance.now();
    const f = this.flow;
    while (this.buildRow < RES && performance.now() - start < budgetMs) {
      const z = this.buildOriginZ + (this.buildRow + 0.5) * CELL;
      for (let col = 0; col < RES; col++) {
        const x = this.buildOriginX + (col + 0.5) * CELL;
        this.terrainGen.riverFlowAt(x, z, f);
        const o = (this.buildRow * RES + col) * 4;
        this.buildData[o] = Math.round(clamp(f[0] / FLOW_MAX_SPEED * 0.5 + 0.5, 0, 1) * 255);
        this.buildData[o + 1] = Math.round(clamp(f[1] / FLOW_MAX_SPEED * 0.5 + 0.5, 0, 1) * 255);
        this.buildData[o + 2] = Math.round(clamp(f[2], 0, 1) * 255);
        this.buildData[o + 3] = 255;
        const ph = f[3] / FLOW_PHASE_PERIOD * Math.PI * 2;
        this.buildLine[o] = Math.round((Math.cos(ph) * 0.5 + 0.5) * 255);
        this.buildLine[o + 1] = Math.round((Math.sin(ph) * 0.5 + 0.5) * 255);
        this.buildLine[o + 2] = Math.round(clamp(f[4] / ACROSS_MAX * 0.5 + 0.5, 0, 1) * 255);
        this.buildLine[o + 3] = 255;
      }
      this.buildRow++;
    }

    if (this.buildRow >= RES) {
      (this.texture.image.data as Uint8Array).set(this.buildData);
      this.texture.needsUpdate = true;
      (this.lineTexture.image.data as Uint8Array).set(this.buildLine);
      this.lineTexture.needsUpdate = true;
      this.origin.set(this.buildOriginX, this.buildOriginZ);
      this.ready = true;
      this.buildRow = -1;
    }
  }
}
