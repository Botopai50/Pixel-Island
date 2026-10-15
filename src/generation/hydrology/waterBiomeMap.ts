import * as THREE from 'three';
import { TerrainGenerator } from '../terrain/terrainGenerator.ts';
import { getTextureWorkerPool } from '../terrain/textureWorkerPool.ts';
import { WB_RES as RES, WB_CELL as CELL, WB_SPAN as SPAN, writeWaterTint } from './waterBiomeCompute.ts';

const REBUILD_DISTANCE = SPAN * 0.2;

/**
 * Mapa de tons da água (R = ártico, G = manguezal, B = tropical) calculado com o MESMO clima e a
 * mesma regra polar do BiomeManager, para a cor da água bater com o bioma real ao redor.
 * O canal A guarda a profundidade do fundo (0..MAX_ENCODED_DEPTH), usada para amortecer as ondas
 * em água rasa (senão a linha da costa anda metros para frente e para trás numa praia suave).
 * É reconstruído quando o jogador se afasta do centro: a conta (uns 82 mil consultas de altura) é feita num worker (waterBiomeCompute.ts); só se o worker
 * falhar ela volta para a thread principal, aos poucos (orçamento por frame).
 */
export class WaterBiomeMap {
  public readonly texture: THREE.DataTexture;
  public readonly origin = new THREE.Vector2(0, 0);
  public readonly span = SPAN;
  public ready = false;

  private terrainGen: TerrainGenerator;
  private buildData = new Uint8Array(RES * RES * 4);
  private buildRow = -1;
  private buildCol = 0;
  private buildOriginX = 0;
  private buildOriginZ = 0;
  /** pedido em andamento no worker (e o número dele: respostas antigas, de antes de um invalidate, são descartadas) */
  private pending = false;
  private seq = 0;

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
    this.pending = false;
    this.seq++;
  }

  public update(centerX: number, centerZ: number, budgetMs: number = 2.0): void {
    if (this.pending) return;
    if (this.buildRow < 0) {
      const cx = this.origin.x + SPAN / 2, cz = this.origin.y + SPAN / 2;
      const far = Math.abs(centerX - cx) > REBUILD_DISTANCE || Math.abs(centerZ - cz) > REBUILD_DISTANCE;
      if (this.ready && !far) return;
      const originX = Math.floor((centerX - SPAN / 2) / CELL) * CELL;
      const originZ = Math.floor((centerZ - SPAN / 2) / CELL) * CELL;
      // no worker: o primeiro mapa (sem ele a água sai com o tom padrão) vai na frente de tudo; as reconstruções depois, depois dos chunks
      this.pending = true;
      const seq = this.seq;
      getTextureWorkerPool().requestWaterBiome(this.terrainGen.getSeed(), originX, originZ, SPAN, this.ready ? 3 : -2).promise.then((r) => {
        if (seq !== this.seq || !r.waterBiome) return;
        this.pending = false;
        (this.texture.image.data as Uint8Array).set(r.waterBiome);
        this.texture.needsUpdate = true;
        this.origin.set(originX, originZ);
        this.ready = true;
      }).catch((e) => {
        if (seq !== this.seq) return;
        this.pending = false;
        if (e instanceof Error && e.message === 'cancelled') return;
        // plano B: o mesmo mapa na thread principal, aos poucos
        this.buildOriginX = originX;
        this.buildOriginZ = originZ;
        this.buildRow = 0;
        this.buildCol = 0;
      });
      return;
    }

    const start = performance.now();
    // (o orçamento é conferido a cada 8 texels, e a linha continua de onde parou: antes uma linha inteira de 128 texels
    // custava 4 a 8 ms de uma vez e estourava o orçamento de 2 ms por quadro)
    while (this.buildRow < RES && performance.now() - start < budgetMs) {
      const z = this.buildOriginZ + (this.buildRow + 0.5) * CELL;
      for (let col = this.buildCol; col < RES; col++) {
        const x = this.buildOriginX + (col + 0.5) * CELL;
        writeWaterTint(this.terrainGen, this.buildData, (this.buildRow * RES + col) * 4, x, z);
        if (col === RES - 1) { this.buildCol = 0; break; }
        if ((col & 1) === 1 && performance.now() - start >= budgetMs) { this.buildCol = col + 1; break; }
      }
      if (this.buildCol === 0) this.buildRow++;
      else break;
    }

    if (this.buildRow >= RES) {
      (this.texture.image.data as Uint8Array).set(this.buildData);
      this.texture.needsUpdate = true;
      this.origin.set(this.buildOriginX, this.buildOriginZ);
      this.ready = true;
      this.buildRow = -1;
    }
  }
}
