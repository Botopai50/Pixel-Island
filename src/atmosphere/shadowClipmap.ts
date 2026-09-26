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
  // normalBias ~1.5 texel: o terreno projeta sombra pelas faces da frente (shadowSide
  // FrontSide), então sem essa folga o chão iluminado se auto-sombrearia em listras (acne).
  {
    radius: 35,
    mapSize: 2048,
    bias: -0.00002,
    normalBias: 0.05,
    near: 1,
    far: 1050,
    lightDistance: 800
  },
  // Nível 1: Detalhes intermediários (2048 → ~0.2m/texel). Com 1024 (~0.4m) e a folga
  // necessária contra acne, ondulações de poucos metros perdiam a sombra nessa faixa, e a
  // mesma sombra aparecia/sumia conforme a câmera trocava de faixa.
  {
    radius: 200,
    mapSize: 2048,
    bias: -0.00005,
    normalBias: 0.25,
    near: 1,
    far: 1200,
    lightDistance: 800
  },
  // Nível 2: Paisagem distante - agora efetivamente usado (antes renderizava sem nenhum efeito
  // visual, pois a luz ficava com intensidade 0 e o resultado nunca era lido pelo shader).
  // Raio ampliado para cobrir todo o raio de desenho padrão (~512m) e além.
  {
    radius: 600,
    mapSize: 2048,
    bias: -0.00010,
    normalBias: 0.75,
    near: 1,
    far: 2000,
    lightDistance: 1000
  }
];
// lightDistance grande em todas as faixas: a câmera do sol precisa começar ANTES de qualquer
// obstáculo alto na direção da luz. Com 120m (faixa 0) um vulcão a ~150m do lado do sol ficava
// atrás do plano near, e a sombra dele sumia justamente perto do jogador.

const CORNERS: ReadonlyArray<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
/**
 * Folga do raio ajustado à tela: a última faixa desvanece nos ~3% de borda (ver cascadeFade
 * no terrainShader) e o relevo acima do plano do chão projeta um pouco além dos cantos.
 */
const VIEW_FIT_MARGIN = 1.12;

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
  /** Configuração original de cada faixa: referência do tamanho de texel em que o normalBias foi calibrado */
  private readonly baseConfigs: readonly ClipmapCascadeConfig[];
  private readonly ndc = new THREE.Vector3();
  private readonly rayDir = new THREE.Vector3();

  constructor(scene: THREE.Scene, configs: ClipmapCascadeConfig[] = DEFAULT_CLIPMAP_CONFIGS) {
    this.scene = scene;
    this.configs = configs.map((cfg) => ({ ...cfg }));
    this.baseConfigs = configs;

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
    const { right, up } = this.lightAxes();

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

  /**
   * Muda a resolução dos mapas de sombra (qualidade adaptativa). O raio de cada faixa não muda,
   * só o tamanho do texel; o Three recria o mapa no próximo render de sombra.
   */
  public setMapSize(size: number): void {
    for (let i = 0; i < this.lights.length; i++) {
      const light = this.lights[i];
      this.configs[i].mapSize = size;
      this.applyCascadeShape(i);
      if (light.shadow.mapSize.x === size) continue;
      light.shadow.mapSize.set(size, size);
      light.shadow.map?.dispose();
      (light.shadow as any).map = null;
    }
    this.updatePositions(this.lastTargetPos.x, this.lastTargetPos.y, this.lastTargetPos.z);
  }

  /**
   * Ajusta a última faixa para cobrir toda a área de chão visível pela câmera aérea.
   *
   * A caixa da sombra é alinhada ao sol, e a área visível gira com a câmera: com a faixa fixa
   * em 600m (sombra plena só até ~420m, por causa da rampa de borda), dependendo do ângulo e
   * do zoom a borda da faixa atravessava a tela e a sombra do vulcão sumia pela metade.
   * `camera` = null (1ª pessoa, horizonte infinito) volta ao raio base.
   * Devolve true quando o raio mudou (os mapas precisam ser redesenhados).
   */
  public fitLastCascadeToView(camera: THREE.Camera | null, groundY: number): boolean {
    const i = this.lights.length - 1;
    const base = this.baseConfigs[i];
    let needed = base.radius;
    if (camera && (camera as THREE.OrthographicCamera).isOrthographicCamera) {
      const { right, up } = this.lightAxes();
      const t = this.lastTargetPos;
      const tu = t.dot(right), tv = t.dot(up);
      camera.updateMatrixWorld();
      camera.getWorldDirection(this.rayDir);
      if (this.rayDir.y < -0.05) {
        let reach = 0;
        for (const [x, y] of CORNERS) {
          // Canto da tela projetado no plano do chão (câmera ortográfica: raios paralelos)
          const o = this.ndc.set(x, y, -1).unproject(camera);
          o.addScaledVector(this.rayDir, (groundY - o.y) / this.rayDir.y);
          reach = Math.max(reach, Math.abs(o.dot(right) - tu), Math.abs(o.dot(up) - tv));
        }
        needed = Math.max(needed, reach * VIEW_FIT_MARGIN);
      }
    }
    const current = this.configs[i].radius;
    // Degraus de 50m com histerese: o raio só encolhe quando sobra bastante, evitando refazer
    // os mapas (e mudar o tamanho do texel) a cada quadro de zoom.
    if (needed <= current && needed > current * 0.8) return false;
    const radius = Math.ceil(needed / 50) * 50;
    if (radius === current) return false;
    this.configs[i].radius = radius;
    this.applyCascadeShape(i);
    this.updatePositions(this.lastTargetPos.x, this.lastTargetPos.y, this.lastTargetPos.z);
    return true;
  }

  /**
   * Aplica raio/resolução atuais da faixa `i` à câmera de sombra. O normalBias acompanha o
   * tamanho do texel (foi calibrado no texel da configuração original); a distância do
   * emissor e o far crescem com o raio para a caixa continuar englobando o relevo nas bordas.
   */
  private applyCascadeShape(i: number): void {
    const cfg = this.configs[i];
    const base = this.baseConfigs[i];
    const texelRatio = (cfg.radius / cfg.mapSize) / (base.radius / base.mapSize);
    cfg.normalBias = base.normalBias * texelRatio;
    const grow = Math.max(0, cfg.radius - base.radius);
    cfg.lightDistance = base.lightDistance + grow;
    cfg.far = base.far + 2 * grow;

    const cam = this.lights[i].shadow.camera;
    cam.left = -cfg.radius;
    cam.right = cfg.radius;
    cam.top = cfg.radius;
    cam.bottom = -cfg.radius;
    cam.far = cfg.far;
    cam.updateProjectionMatrix();
    this.lights[i].shadow.normalBias = cfg.normalBias;
  }

  private lightAxes(): { right: THREE.Vector3; up: THREE.Vector3 } {
    const sunDir = this.currentSunDir;
    const worldUp = Math.abs(sunDir.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(sunDir, worldUp).normalize();
    const up = new THREE.Vector3().crossVectors(right, sunDir).normalize();
    return { right, up };
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
