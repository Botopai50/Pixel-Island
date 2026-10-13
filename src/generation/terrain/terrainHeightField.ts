import * as THREE from 'three';

/**
 * Mapa de alturas do relevo em volta do jogador (a altura REAL da malha que é desenhada), para as árvores
 * se adaptarem ao terreno: o shader da casca lê a altura do chão em cada vértice da base e leva as raízes
 * até lá. É uma foto do relevo vista de cima (câmera ortográfica, só a camada dos chunks de terreno), que
 * se refaz quando o jogador anda um pouco ou quando chega relevo novo.
 */
export const TERRAIN_LAYER = 5;

/** uniforms compartilhados com os shaders das árvores */
export const HF = {
  uHFTex: { value: null as THREE.Texture | null },
  /** canto (x, z) do mapa, em metros do mundo */
  uHFOrigin: { value: new THREE.Vector2(1e9, 1e9) },
  uHFSize: { value: 256 },
  /** 0 enquanto ainda não há mapa */
  uHFOn: { value: 0 },
};

const SIZE = 256;     // metros que o mapa cobre (±128 m: de sobra para as árvores de perto)
const RES = 512;      // 0,5 m por texel
const REDO_DIST = 24; // refaz quando o jogador anda tanto

export class TerrainHeightField {
  private rt: THREE.WebGLRenderTarget;
  private cam: THREE.OrthographicCamera;
  private mat: THREE.ShaderMaterial;
  private cx = 1e9;
  private cz = 1e9;
  private lastVersion = -1;
  private lastT = 0;
  private clear = new THREE.Color(0, 0, 0);

  constructor() {
    this.rt = new THREE.WebGLRenderTarget(RES, RES, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      generateMipmaps: false,
    });
    this.rt.texture.wrapS = this.rt.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.cam = new THREE.OrthographicCamera(-SIZE / 2, SIZE / 2, SIZE / 2, -SIZE / 2, 1, 3000);
    this.cam.up.set(0, 0, -1);
    this.cam.layers.set(TERRAIN_LAYER);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: `
        varying float vY;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vY = wp.y;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        varying float vY;
        void main() { gl_FragColor = vec4(vY, 0.0, 0.0, 1.0); }`,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
    });
    HF.uHFTex.value = this.rt.texture;
    HF.uHFSize.value = SIZE;
  }

  public update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, x: number, z: number, sceneVersion: number): void {
    const now = performance.now();
    const moved = Math.hypot(x - this.cx, z - this.cz) > REDO_DIST;
    const changed = sceneVersion !== this.lastVersion && now - this.lastT > 700;
    if (!moved && !changed) return;
    this.lastT = now;
    this.lastVersion = sceneVersion;
    // o centro anda em passos (o mapa não se mexe a cada quadro)
    if (moved) { this.cx = Math.round(x / 8) * 8; this.cz = Math.round(z / 8) * 8; }
    this.cam.position.set(this.cx, 1500, this.cz);
    this.cam.lookAt(this.cx, 0, this.cz);
    this.cam.updateMatrixWorld(true);

    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.enabled;
    const prevAuto = renderer.autoClear;
    const prevColor = new THREE.Color(); renderer.getClearColor(prevColor);
    const prevAlpha = renderer.getClearAlpha();
    const prevOverride = scene.overrideMaterial;
    renderer.shadowMap.enabled = false;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(this.clear, 0);
    scene.overrideMaterial = this.mat;
    renderer.render(scene, this.cam);
    scene.overrideMaterial = prevOverride;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.autoClear = prevAuto;
    renderer.shadowMap.enabled = prevShadow;

    HF.uHFOrigin.value.set(this.cx - SIZE / 2, this.cz - SIZE / 2);
    HF.uHFOn.value = 1;
  }
}
