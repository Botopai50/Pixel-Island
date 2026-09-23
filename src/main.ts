import * as THREE from 'three';
import { WorldEngine } from './generation/worldEngine.ts';
import { PlayerController, CameraMode } from './player/playerController.ts';
import { SkyAtmosphere } from './atmosphere/skyAtmosphere.ts';
import { DropReticle } from './player/dropReticle.ts';
import { PegmanWidget } from './ui/pegmanWidget.ts';
import { TextureForgeWidget } from './ui/textureForgeWidget.ts';
import { TouchControlsWidget } from './ui/touchControlsWidget.ts';
import { CONFIG } from './config.ts';
import { setForgeTextureAnisotropy, DEFAULT_D } from './generation/terrain/terrainTextureForge.ts';

/**
 * Aplicação Principal: Procedural Island Explorer
 * Suporta modo contemplativo aéreo e exploração imersiva em 1ª Pessoa
 * acionada via Pegman do Google Maps (arrastar e soltar).
 */
class App {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;

  // 1. Subsistema do Mundo Procedural
  private worldEngine!: WorldEngine;

  // 2. Subsistema do Jogador (Aéreo + 1ª Pessoa)
  private playerController!: PlayerController;

  // 3. Atmosfera e Iluminação
  private atmosphere!: SkyAtmosphere;

  // 4. Pegman HUD e Retículo 3D de Pouso
  private dropReticle!: DropReticle;
  private pegmanWidget!: PegmanWidget;

  // 4.1. Widget de Ajuste e Exportação de Texturas Procedurais
  private textureForgeWidget!: TextureForgeWidget;

  // 4.2. Controles Touch para Celulares / Telas Sensíveis ao Toque
  private touchControlsWidget!: TouchControlsWidget;

  // 5. Render Target para o Pixel Water Shader (Refração, Profundidade e Espuma de Borda)
  private waterRenderTarget!: THREE.WebGLRenderTarget;
  private blitScene!: THREE.Scene;
  private blitCamera!: THREE.OrthographicCamera;
  private blitMaterial!: THREE.MeshBasicMaterial;

  // 6. Planar Reflection para o Pixel Water Shader de untitled
  private reflectionCameraPerspective!: THREE.PerspectiveCamera;
  private reflectionRenderTarget!: THREE.WebGLRenderTarget;
  private reflectTextureMatrix: THREE.Matrix4 = new THREE.Matrix4();
  private reflectionClipPlane: THREE.Plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private reflectionClipPlanes: THREE.Plane[] = [this.reflectionClipPlane];
  private noClipPlanes: THREE.Plane[] = [];
  private lastRipplePos: THREE.Vector3 | null = null;
  private shadowsNeedUpdate: boolean = true;
  private lastShadowSceneVersion: number = -1;
  private lastSceneShadowRefresh: number = 0;
  private lastShadowPos: THREE.Vector3 = new THREE.Vector3();

  private clock: THREE.Clock = new THREE.Clock();

  constructor() {
    this.init();
    (window as any).__app = this;
  }

  private init(): void {
    const container = document.getElementById('canvas-container')!;

    // Configuração do Renderizador WebGL otimizada para Pixel Art 60+ FPS
    this.renderer = new THREE.WebGLRenderer({
      antialias: false, // Cenário blitado via renderTarget - MSAA no canvas era redundante
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0)); // 1.0 nativo (alívio de 75% em telas Retina/4K)
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false; // Controle sob demanda (evita duplicação por rCam e poupa 40ms/frame)
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    container.appendChild(this.renderer.domElement);
    // Precisa vir antes do WorldEngine: o forge cria os atlas de parede no construtor.
    setForgeTextureAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    // Criação da Cena Three.js
    this.scene = new THREE.Scene();

    // Inicialização da Atmosfera e Luz Solar
    this.atmosphere = new SkyAtmosphere(this.scene);

    // Inicialização do Motor de Geração Procedural do Mundo
    this.worldEngine = new WorldEngine(this.scene);
    this.syncAtmosphereWithWorld();

    // Configuração do Render Target de Água com DepthTexture (1x nativo para máximo fillrate)
    const rw = window.innerWidth;
    const rh = window.innerHeight;

    this.waterRenderTarget = new THREE.WebGLRenderTarget(rw, rh, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(rw, rh, THREE.UnsignedIntType)
    });

    // Cena de Blit em tela cheia para projetar o mundo opaco no canvas antes da água
    this.blitScene = new THREE.Scene();
    this.blitCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.blitMaterial = new THREE.MeshBasicMaterial({
      map: this.waterRenderTarget.texture,
      depthTest: false,
      depthWrite: false
    });
    const blitMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMaterial);
    this.blitScene.add(blitMesh);

    const aspect = window.innerWidth / window.innerHeight;

    // Configuração dos Render Targets e Câmeras de Reflexão Planar (LinearFilter para eliminar shimmer/flicker)
    this.reflectionRenderTarget = new THREE.WebGLRenderTarget(512, 512, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });
    this.reflectionCameraPerspective = new THREE.PerspectiveCamera(75, aspect, 0.1, 2500);

    // Semente opcional via parâmetro de URL (ex: ?seed=MinhaIlha)
    const urlSeed = new URLSearchParams(window.location.search).get('seed');
    if (urlSeed) {
      this.worldEngine.reseed(urlSeed);
    }

    // Inicialização do Controlador de Movimentação e Câmera do Jogador
    this.playerController = new PlayerController(aspect);

    // Posiciona o jogador nas coordenadas seguras de terra firme da ilha gerada
    this.spawnPlayer();

    // Inicialização do Retículo 3D de Pouso do Pegman
    this.dropReticle = new DropReticle();
    this.scene.add(this.dropReticle.group);

    // Inicialização do Widget HUD do Pegman (Google Maps)
    this.pegmanWidget = new PegmanWidget(this.dropReticle, {
      onDrop: (x, z) => {
        this.playerController.transitionToFirstPerson(x, z, this.worldEngine.getTerrainGenerator());
        this.worldEngine.addRipple(x, z, 2.0);
      },
      onExitFirstPerson: () => {
        this.playerController.transitionToObserver();
      },
      getActiveCamera: () => this.playerController.getCamera(),
      getTerrain: () => this.worldEngine.getTerrainGenerator()
    });

    // Inicialização dos Controles Touch para Celulares
    this.touchControlsWidget = new TouchControlsWidget(
      this.playerController,
      this.playerController.getInputManager()
    );

    // Sincroniza estados de HUD e raio de chunks com os modos de câmera do jogador
    this.playerController.onModeChange = (mode) => {
      this.pegmanWidget.onModeChange(mode);
      this.touchControlsWidget.onModeChange(mode);
      if (mode === CameraMode.FIRST_PERSON) {
        // Em primeira pessoa, raio adaptativo de 5 chunks (~320m) cobre perfeitamente a distância de névoa e poupa recursos
        this.worldEngine.setViewRadius(5);
      } else if (mode === CameraMode.OBSERVER) {
        // No modo aéreo panorâmico, restaura o raio amplo para visualização continental completa
        this.worldEngine.setViewRadius(CONFIG.VIEW_RADIUS_CHUNKS);
      }
    };

    // Inicialização do Widget de Ajuste e Exportação de Texturas
    this.textureForgeWidget = new TextureForgeWidget(this.worldEngine);

    // Globais para depuração e automação de testes
    (window as any).__WORLD__ = this.worldEngine;
    (window as any).__PLAYER__ = this.playerController;
    (window as any).__TEXTURE_WIDGET__ = this.textureForgeWidget;
    (window as any).__TOUCH_CONTROLS__ = this.touchControlsWidget;

    // Clique interativo na água para gerar ondas e ondulações (Ripples)
    container.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && !this.pegmanWidget.getIsDragging()) {
        const rect = container.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.playerController.getCamera());
        const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const hit = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(waterPlane, hit)) {
          this.worldEngine.addRipple(hit.x, hit.z, 1.2);
        }
      }
    });

    (window as any).__APP__ = this;
    (window as any).__WORLD__ = this.worldEngine;
    (window as any).__PLAYER__ = this.playerController;
    (window as any).__PEGMAN__ = this.pegmanWidget;
    (window as any).__RETICLE__ = this.dropReticle;
    (window as any).__ATMOSPHERE__ = this.atmosphere;

    window.addEventListener('resize', () => this.onWindowResize());

    // Inicia loop de renderização
    this.animate();
  }

  private spawnPlayer(): void {
    const spawn = this.worldEngine.getSpawnCoordinate();
    this.playerController.setPosition(spawn.x, spawn.z);
    this.worldEngine.updateObserverPosition(spawn.x, spawn.z);
  }

  private syncAtmosphereWithWorld(): void {
    this.worldEngine.syncLighting(
      this.atmosphere.getSunDirection(),
      this.atmosphere.getSunColor(),
      this.atmosphere.getAmbientColor(),
      this.atmosphere.getFogColor()
    );
  }

  private onWindowResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.0));
    this.playerController.onResize();

    this.waterRenderTarget.setSize(width, height);
    this.reflectionCameraPerspective.aspect = width / height;
    this.reflectionCameraPerspective.updateProjectionMatrix();
  }

  /**
   * Raio de chunks que cobre a tela no modo aéreo: a câmera é ortográfica, então a área visível
   * no chão depende só do zoom (largura da tela e profundidade projetada pela inclinação).
   */
  private observerViewRadius(): number {
    const frustum = this.playerController.getZoomFrustumSize();
    const halfWidth = (frustum * (window.innerWidth / window.innerHeight)) / 2;
    const halfDepth = frustum / 2 / Math.sin(CONFIG.CAMERA.DEFAULT_PITCH);
    const reach = Math.hypot(halfWidth, halfDepth);
    const r = Math.ceil(reach / CONFIG.CHUNK_SIZE) + 2;
    return Math.min(CONFIG.MAX_VIEW_RADIUS_CHUNKS, Math.max(CONFIG.VIEW_RADIUS_CHUNKS, r));
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const dt = Math.min(this.clock.getDelta(), 0.1);

    // 1. Atualização do Controlador de Câmera/Jogador (Aéreo / Primeira Pessoa / Transição)
    this.playerController.update(dt, this.worldEngine.getTerrainGenerator());
    const playerPos = this.playerController.getPosition();

    // Emissão de ondulações na água ao caminhar em águas rasas em Primeira Pessoa
    if (this.playerController.getMode() === CameraMode.FIRST_PERSON && playerPos.y <= 0.45) {
      if (!this.lastRipplePos) {
        this.lastRipplePos = playerPos.clone();
      } else if (this.lastRipplePos.distanceTo(playerPos) > 0.8) {
        this.worldEngine.addRipple(playerPos.x, playerPos.z, 0.85);
        this.lastRipplePos.copy(playerPos);
      }
    }

    // 2. Atualização dos Chunks Procedurais do Mundo ao redor do Observador
    if (this.playerController.getMode() === CameraMode.OBSERVER) {
      this.worldEngine.setViewRadius(this.observerViewRadius(), CONFIG.MAX_VIEW_RADIUS_CHUNKS);
    }
    this.worldEngine.updateObserverPosition(playerPos.x, playerPos.z);
    this.worldEngine.updateSimulation(dt);
    this.syncAtmosphereWithWorld();
    this.atmosphere.updateTarget(playerPos.x, playerPos.y, playerPos.z);
    this.atmosphere.update(dt, this.playerController.getCamera().position);
    // Pixels do céu acompanham a densidade de texels do chão (1.0 = densidade padrão)
    this.atmosphere.getSkybox().setPixelScale(this.worldEngine.getTexelDensity() / DEFAULT_D);

    // Verificação de histerese para atualização de sombras sob demanda
    const distSq = playerPos.distanceToSquared(this.lastShadowPos);
    if (distSq > 0.36) { // ~0.60m de deslocamento do jogador
      this.shadowsNeedUpdate = true;
      this.lastShadowPos.copy(playerPos);
    }

    // Relevo/vegetação terminam de carregar de forma assíncrona (texturas nos workers): mesmo
    // com o jogador parado, o shadow map precisa ser refeito quando algo novo entra na cena.
    // Limitado a ~6x/s para não refazer os 3 mapas a cada frame durante um carregamento em massa.
    const sceneVersion = this.worldEngine.getChunkManager().getSceneVersion();
    const now = performance.now();
    if (sceneVersion !== this.lastShadowSceneVersion && now - this.lastSceneShadowRefresh > 160) {
      this.shadowsNeedUpdate = true;
      this.lastShadowSceneVersion = sceneVersion;
      this.lastSceneShadowRefresh = now;
    }

    const activeCamera = this.playerController.getCamera();
    const isFirstPerson = this.playerController.getMode() === CameraMode.FIRST_PERSON;
    const seaLevel = 0.0;

    // 3. Renderização Multi-Pass para o Pixel Water Shader
    // No Modo 1ª Pessoa: Renderiza a reflexão a cada frame para sincronia total com o movimento do jogador (elimina 100% de flicadas e stutter ao andar)
    const shouldRenderReflection = isFirstPerson;

    if (shouldRenderReflection) {
      const camDir = new THREE.Vector3();
      activeCamera.getWorldDirection(camDir);
      const lookTarget = activeCamera.position.clone().add(camDir.multiplyScalar(100.0));

      const persp = activeCamera as THREE.PerspectiveCamera;
      const rPersp = this.reflectionCameraPerspective;
      rPersp.fov = persp.fov;
      rPersp.aspect = persp.aspect;
      rPersp.near = persp.near;
      rPersp.far = persp.far;
      rPersp.position.set(persp.position.x, 2.0 * seaLevel - persp.position.y, persp.position.z);
      rPersp.up.set(0, -1, 0);
      rPersp.lookAt(lookTarget.x, 2.0 * seaLevel - lookTarget.y, lookTarget.z);
      rPersp.updateMatrixWorld();
      rPersp.updateProjectionMatrix();

      // Passo 1: Renderizar reflexão do mundo (terreno, árvores, céu) na textura de reflexão
      this.worldEngine.setWaterVisible(false);
      this.renderer.shadowMap.enabled = false; // SOMBRAS DESATIVADAS NO PASSE DE REFLEXÃO
      this.renderer.setRenderTarget(this.reflectionRenderTarget);
      this.renderer.clear();
      // Só o que está ACIMA da água pode refletir: sem esse corte, a parte submersa de rochas e
      // o fundo do mar entravam no reflexo espelhado e apareciam "subindo" atrás dos objetos.
      this.reflectionClipPlane.constant = 0.05 - seaLevel;
      this.renderer.clippingPlanes = this.reflectionClipPlanes;
      this.renderer.render(this.scene, rPersp);
      this.renderer.clippingPlanes = this.noClipPlanes;
      this.renderer.shadowMap.enabled = true; // RESTAURA SOMBRAS

      // Atualiza matriz de projeção de textura de reflexão
      this.reflectTextureMatrix.set(
        0.5, 0.0, 0.0, 0.5,
        0.0, 0.5, 0.0, 0.5,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
      );
      this.reflectTextureMatrix.multiply(rPersp.projectionMatrix);
      this.reflectTextureMatrix.multiply(rPersp.matrixWorldInverse);
    }

    // Passo 2: Renderizar mundo opaco (sem água) com câmera principal e atualização sob demanda de sombras
    this.worldEngine.setWaterVisible(false);
    if (this.shadowsNeedUpdate) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowsNeedUpdate = false;
    }
    this.renderer.setRenderTarget(this.waterRenderTarget);
    this.renderer.clear();
    this.renderer.render(this.scene, activeCamera);

    // Passo 3: Blit em tela cheia da cena opaca para o canvas
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.blitScene, this.blitCamera);

    // Passo 4: Atualizar uniforms da água e renderizar água transparente por cima com blend analítico
    this.worldEngine.setWaterVisible(true);
    this.worldEngine.updateWaterUniforms(
      this.waterRenderTarget.depthTexture,
      this.reflectionRenderTarget.texture,
      this.reflectTextureMatrix,
      activeCamera,
      window.innerWidth,
      window.innerHeight
    );

    this.renderer.autoClear = false;
    this.renderer.render(this.worldEngine.getWaterGroup(), activeCamera);
    this.renderer.autoClear = true;
  };
}

window.addEventListener('DOMContentLoaded', () => {
  new App();
});
