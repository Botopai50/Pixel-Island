import * as THREE from 'three';

/**
 * Cena mais leve para as imagens de reflexo (256 x 256, borradas): o mesmo corte que o reflexo do mar faz em main.ts, para os outros reflexos que
 * desenham a cena inteira (o da cachoeira, em inlandWaterManager.ts, redesenhava TUDO: 563 chamadas de desenho e ~9 ms de CPU por quadro).
 *  - capim, plantas pequenas e as árvores de 150 m em diante não aparecem (viram menos de um pixel);
 *  - as árvores de perto entram com o desenho simplificado (o degrau 2);
 *  - os chunks distantes ficam de fora (o horizonte, por baixo deles, cobre a terra distante).
 * begin() liga, end() desfaz; sempre em par.
 */
export class ReflectionLod {
  private list: THREE.InstancedMesh[] = [];
  private version = -1;
  private age = 0;
  private swapped: [THREE.InstancedMesh, THREE.BufferGeometry][] = [];
  private hidden: THREE.Object3D[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly sceneVersion: () => number,
    private readonly farChunks: () => THREE.Object3D,
  ) {}

  /** maxLod: o maior degrau de detalhe das árvores que entra (1 = até ~150 m, como o reflexo do mar; 0 = só as de até ~70 m) */
  public begin(maxLod = 1): void {
    const ver = this.sceneVersion();
    // (a lista das malhas de vegetação é refeita quando o mundo muda, e não a cada quadro: percorrer a cena custava ~2 ms)
    if (ver !== this.version || ++this.age > 120) {
      this.version = ver; this.age = 0; this.list = [];
      this.scene.traverse((o) => {
        const im = o as THREE.InstancedMesh;
        if (im.isInstancedMesh && (im.name === 'pixelTree' || im.name === 'grass' || im.name.startsWith('pt:'))) this.list.push(im);
      });
    }
    for (const im of this.list) {
      if (!im.visible) continue;
      if (im.name === 'grass' || im.name.startsWith('pt:') || (im.name === 'pixelTree' && (im.geometry.userData.lodIdx as number) > maxLod)) {
        im.visible = false; this.hidden.push(im); continue;
      }
      if (im.name === 'pixelTree') {
        const rg = im.geometry.userData.reflGeo as THREE.BufferGeometry | null | undefined;
        if (rg && rg !== im.geometry) { this.swapped.push([im, im.geometry]); im.geometry = rg; }
      }
    }
    const far = this.farChunks();
    if (far.visible) { far.visible = false; this.hidden.push(far); }
  }

  public end(): void {
    for (const [im, g] of this.swapped) im.geometry = g;
    for (const o of this.hidden) o.visible = true;
    this.swapped.length = 0;
    this.hidden.length = 0;
  }
}
