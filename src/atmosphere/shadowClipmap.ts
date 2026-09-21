import * as THREE from 'three';

export interface ClipmapCascadeConfig {
  radius: number;        // Raio/extensão ortográfica em metros (ex: 35m, 120m, 450m)
  mapSize: number;       // Resolução da textura de sombra (2048x2048)
  bias: number;          // Depth bias para evitar auto-sombreamento
  normalBias: number;    // Normal bias para eliminar acne de sombra em superfícies curvas
  near: number;          // Plano de corte near da câmera de sombra
  far: number;           // Plano de corte far da câmera de sombra
  lightDistance: number; // Distância do emissor ao longo do vetor solar
}

export const DEFAULT_CLIPMAP_CONFIGS: ClipmapCascadeConfig[] = [
  // Nível 0: Detalhes próximos - texels ultra-nítidos de ~3.4cm (personagem, folhas, galhos, rochas)
  // normalBias calibrado para 0.005 (5mm) para ancoragem de contato rente ao solo (Peter Panning zero)
  {
    radius: 35,
    mapSize: 2048,
    bias: -0.00002,
    normalBias: 0.005,
    near: 5,
    far: 240,
    lightDistance: 120
  },
  // Nível 1: Detalhes intermediários - LOD balanceado (1024x1024, economia de 75% de texels)
  {
    radius: 120,
    mapSize: 1024,
    bias: -0.00005,
    normalBias: 0.012,
    near: 10,
    far: 480,
    lightDistance: 240
  },
  // Nível 2: Paisagem distante - LOD balanceado (1024x1024, economia de 75% de texels)
  {
    radius: 450,
    mapSize: 1024,
    bias: -0.00010,
    normalBias: 0.025,
    near: 10,
    far: 1200,
    lightDistance: 600
  }
];

/**
 * Sistema de Shadow Clipmap Concêntrico (Hierarchical Concentric Cascaded Shadow Maps).
 * Mantém 3 níveis de resolução de sombras centrados dinamicamente no observador/jogador,
 * aplicando Texel Snapping em tempo real para erradicar qualquer cintilação (swimming/shimmering).
 */
export class ShadowClipmap {
  private scene: THREE.Scene;
  private lights: THREE.DirectionalLight[] = [];
  private configs: ClipmapCascadeConfig[];
  private currentSunDir: THREE.Vector3 = new THREE.Vector3(0.5, 0.8, 0.35).normalize();
  private lastTargetPos: THREE.Vector3 = new THREE.Vector3();
  private sunIntensity: number = 1.35;

  constructor(scene: THREE.Scene, configs: ClipmapCascadeConfig[] = DEFAULT_CLIPMAP_CONFIGS) {
    this.scene = scene;
    this.configs = configs;

    this.initLights();
  }

  private initLights(): void {
    for (let i = 0; i < this.configs.length; i++) {
      const cfg = this.configs[i];

      // A luz 0 é a emissora de iluminação direta primária; as luzes 1 e 2 fornecem os mapas de sombra concêntricos.
      // Definimos intensidade total na luz 0 e 0.0 nas luzes secundárias para evitar duplicação de luz em shaders não customizados.
      const light = new THREE.DirectionalLight(0xffffff, i === 0 ? this.sunIntensity : 0.0);
      light.castShadow = true;
      light.shadow.mapSize.set(cfg.mapSize, cfg.mapSize);
      light.shadow.camera.near = cfg.near;
      light.shadow.camera.far = cfg.far;
      light.shadow.bias = cfg.bias;
      light.shadow.normalBias = cfg.normalBias;

      const d = cfg.radius;
      light.shadow.camera.left = -d;
      light.shadow.camera.right = d;
      light.shadow.camera.top = d;
      light.shadow.camera.bottom = -d;

      this.scene.add(light);
      this.scene.add(light.target);
      this.lights.push(light);
    }
  }

  public setSunDirection(sunDir: THREE.Vector3): void {
    this.currentSunDir.copy(sunDir).normalize();
    this.updatePositions(this.lastTargetPos.x, this.lastTargetPos.y, this.lastTargetPos.z);
  }

  public setSunColor(color: THREE.ColorRepresentation, intensity: number = 1.35): void {
    this.sunIntensity = intensity;
    for (let i = 0; i < this.lights.length; i++) {
      this.lights[i].color.set(color);
      if (i === 0) {
        this.lights[i].intensity = intensity;
      }
    }
  }

  /**
   * Atualiza a posição de foco das cascatas de sombra centradas no observador,
   * aplicando Texel Snapping para fixar os pixels de sombra no espaço de mundo.
   */
  public updateTarget(x: number, y: number, z: number): void {
    this.lastTargetPos.set(x, y, z);
    this.updatePositions(x, y, z);
  }

  private updatePositions(x: number, y: number, z: number): void {
    const sunDir = this.currentSunDir;

    // Vetores ortogonais U e V da câmera de luz perpendiculares ao raio solar
    const worldUp = Math.abs(sunDir.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(sunDir, worldUp).normalize();
    const up = new THREE.Vector3().crossVectors(right, sunDir).normalize();

    const target = new THREE.Vector3(x, y, z);

    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      const cfg = this.configs[i];

      // Tamanho do texel no espaço de mundo
      const worldTexelSize = (2 * cfg.radius) / cfg.mapSize;

      // Projeção do ponto alvo sobre os eixos ortogonais da sombra
      const u = target.dot(right);
      const v = target.dot(up);

      // Quantização (Texel Snapping) para múltiplos inteiros do tamanho do texel
      const uSnapped = Math.floor(u / worldTexelSize) * worldTexelSize;
      const vSnapped = Math.floor(v / worldTexelSize) * worldTexelSize;

      // Centro ajustado estritamente alinhado aos texels de mundo
      const snappedCenter = target.clone()
        .addScaledVector(right, uSnapped - u)
        .addScaledVector(up, vSnapped - v);

      light.target.position.copy(snappedCenter);
      light.target.updateMatrixWorld();

      light.position.copy(snappedCenter).addScaledVector(sunDir, cfg.lightDistance);
      light.updateMatrixWorld();
    }
  }

  public getPrimaryLight(): THREE.DirectionalLight {
    return this.lights[0];
  }

  public getLights(): THREE.DirectionalLight[] {
    return this.lights;
  }

  public getConfigs(): readonly ClipmapCascadeConfig[] {
    return this.configs;
  }

  public getCascadeCount(): number {
    return this.lights.length;
  }
}
