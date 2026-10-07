import * as THREE from 'three';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { installAtmosphericFog } from './atmosphere/atmosphericFog.ts';
import { getTextureWorkerPool } from './generation/terrain/textureWorkerPool.ts';
import { WorldEngine } from './generation/worldEngine.ts';
import { PlayerController, CameraMode } from './player/playerController.ts';
import { SkyAtmosphere } from './atmosphere/skyAtmosphere.ts';
import { BiomeAmbience, GRADE, GRADE_GLSL } from './atmosphere/biomeAmbience.ts';
import { SunFX } from './atmosphere/sunFX.ts';
import { VolumetricLight } from './atmosphere/volumetricLight.ts';
import { Footprints } from './atmosphere/footprints.ts';
import { WakeTrail } from './atmosphere/wake.ts';
import { WakeSim } from './atmosphere/wakeSim.ts';
import { Splash } from './atmosphere/splash.ts';
import { Bloom } from './atmosphere/bloom.ts';
import { WET, SHADOW_GRID } from './atmosphere/atmosphericFog.ts';
import { PuddleSSR } from './atmosphere/puddleSSR.ts';
import { WaterVisibility } from './generation/hydrology/waterVisibility.ts';
import { DropReticle } from './player/dropReticle.ts';
import { PegmanWidget } from './ui/pegmanWidget.ts';
import { TextureForgeWidget } from './ui/textureForgeWidget.ts';
import { SkyWidget } from './ui/skyWidget.ts';
import { TouchControlsWidget } from './ui/touchControlsWidget.ts';
import { CONFIG } from './config.ts';
import { setForgeTextureAnisotropy, DEFAULT_D } from './generation/terrain/terrainTextureForge.ts';
import { AdaptiveQuality, QualityLevel, QUALITY_LEVELS, detectInitialQuality } from './quality.ts';

// névoa atmosférica (da cor do horizonte): antes de compilar qualquer material
installAtmosphericFog();

/**
 * Aplicação Principal: Procedural Island Explorer
 * Suporta modo contemplativo aéreo e exploração imersiva em 1ª Pessoa
 * acionada via Pegman do Google Maps (arrastar e soltar).
 */
/**
 * Pixels reais da tela por pixel CSS. Antes era limitado a 1.0: em telas com escala do Windows
 * (125%, 150%) ou Retina o jogo renderizava abaixo da resolução da tela e o navegador ampliava a
 * imagem (borrada/pixelada). Teto de 2 para telas 4K não pesarem demais.
 */
function nativePixelRatio(): number {
  return Math.min(window.devicePixelRatio || 1, 2);
}

class App {
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;

  // 1. Subsistema do Mundo Procedural
  private worldEngine!: WorldEngine;

  // 2. Subsistema do Jogador (Aéreo + 1ª Pessoa)
  private playerController!: PlayerController;

  // 3. Atmosfera e Iluminação
  private atmosphere!: SkyAtmosphere;
  /** oclusão de contato estilizada (mapa visto de cima da base da vegetação) */
  private ambience!: BiomeAmbience;
  private sunFX = new SunFX();
  private volLight = new VolumetricLight();
  private footprints = new Footprints();
  private wake = new WakeTrail();
  private wakeSim = new WakeSim();
  private splash: Splash | null = null;
  private prevFeetY = NaN;
  private fallHigh = false;
  private fallSpeed = 0;
  private wakeLastX = NaN;
  private wakeLastZ = NaN;
  private wakeSpeed = 0;
  private wakeDirX = 0;
  private wakeDirZ = 0;
  private bloom = new Bloom();
  private puddleSSR = new PuddleSSR();
  private _sunCol = new THREE.Color();
  private _feet = new THREE.Vector3();
  private waterVis = new WaterVisibility();

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
  // FXAA: a cena opaca (já com tonemapping e sRGB, pelo blitToDisplay) e a água vão para
  // fxaaTarget; o passe de FXAA suaviza as bordas e desenha na tela
  private fxaaTarget!: THREE.WebGLRenderTarget;
  private fxaaScene!: THREE.Scene;
  private fxaaMaterial!: THREE.ShaderMaterial;
  private blitToDisplayScene!: THREE.Scene;
  private blitToDisplayMaterial!: THREE.ShaderMaterial;
  // encaixe da câmera na grade de pixels (modo P)
  private _bufSize = new THREE.Vector2();
  private _camSaved = new THREE.Vector3();
  private _snapRight = new THREE.Vector3();
  private _snapUp = new THREE.Vector3();

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
  private lastVegShadowRefresh: number = 0;
  private lastShadowPos: THREE.Vector3 = new THREE.Vector3();

  private clock: THREE.Clock = new THREE.Clock();

  // Qualidade adaptativa (resolução interna, sombras, alcance, vegetação)
  private quality!: AdaptiveQuality;
  private renderScale: number = 1.0;
  private shadowStepSq: number = 0.36;

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
    this.renderer.setPixelRatio(nativePixelRatio());
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false; // Controle sob demanda (evita duplicação por rCam e poupa 40ms/frame)
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    container.appendChild(this.renderer.domElement);
    // Ampliação do canvas pelo navegador: sem suavizar só no modo pixelizado (P); fora dele, se a
    // qualidade automática reduzir a resolução, a imagem é suavizada em vez de virar blocos
    this.renderer.domElement.style.imageRendering = CONFIG.PIXEL_SIZE > 1 ? 'pixelated' : 'auto';
    // Precisa vir antes do WorldEngine: o forge cria os atlas de parede no construtor.
    setForgeTextureAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    // Criação da Cena Three.js
    this.scene = new THREE.Scene();

    // Inicialização da Atmosfera e Luz Solar
    this.atmosphere = new SkyAtmosphere(this.scene);
    this.ambience = new BiomeAmbience(this.scene);

    // Inicialização do Motor de Geração Procedural do Mundo
    this.worldEngine = new WorldEngine(this.scene);
    // pingos de chuva na água viram anelzinhos (as mesmas ondulações do clique, bem menores)
    this.ambience.setRainRippleSink((x, z) => this.worldEngine.addRipple(x, z, 0.7, 0.8, 1.8, 0.955));
    this.worldEngine.initTreeImpostors(this.renderer);
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
    // gradação de cor do bioma (biomeAmbience.ts), em cores da tela
    this.blitMaterial.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, GRADE);
      shader.fragmentShader = GRADE_GLSL + shader.fragmentShader.replace(
        '#include <colorspace_fragment>', '#include <colorspace_fragment>\n  gl_FragColor.rgb = biomeGrade(gl_FragColor.rgb);');
    };
    const blitMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitMaterial);
    this.blitScene.add(blitMesh);

    // FXAA. Num render target o Three não aplica tonemapping nem a conversão para sRGB (só na
    // tela), e o shader da água escreve a cor final sem conversão: então a cena opaca entra no
    // alvo já convertida (o mesmo ACES + sRGB do blit normal) e a água por cima, como no canvas.
    this.fxaaTarget = new THREE.WebGLRenderTarget(rw, rh, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      depthBuffer: true,
    });
    this.blitToDisplayMaterial = new THREE.ShaderMaterial({
      uniforms: { tScene: { value: this.waterRenderTarget.texture }, uExposure: { value: 1.0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: `
        uniform sampler2D tScene;
        uniform float uExposure;
        varying vec2 vUv;
        vec3 RRTAndODTFitD(vec3 v) {
          vec3 a = v * (v + 0.0245786) - 0.000090537;
          vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
          return a / b;
        }
        vec3 acesD(vec3 color) {
          const mat3 ACESInputMat = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
          const mat3 ACESOutputMat = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
          color *= uExposure / 0.6;
          color = ACESInputMat * color;
          color = RRTAndODTFitD(color);
          color = ACESOutputMat * color;
          return clamp(color, 0.0, 1.0);
        }
        void main() {
          vec3 t = acesD(texture2D(tScene, vUv).rgb);
          vec3 srgb = mix(pow(t, vec3(0.41666)) * 1.055 - vec3(0.055), t * 12.92, vec3(lessThanEqual(t, vec3(0.0031308))));
          gl_FragColor = vec4(srgb, 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    this.blitToDisplayScene = new THREE.Scene();
    this.blitToDisplayScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blitToDisplayMaterial));
    this.fxaaMaterial = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
      vertexShader: FXAAShader.vertexShader,
      fragmentShader: GRADE_GLSL + FXAAShader.fragmentShader.replace(
        'gl_FragColor = ApplyFXAA( tDiffuse, resolution.xy, vUv );',
        'gl_FragColor = ApplyFXAA( tDiffuse, resolution.xy, vUv );\n\t\t\tgl_FragColor.rgb = biomeGrade(gl_FragColor.rgb);'),
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    Object.assign(this.fxaaMaterial.uniforms, GRADE);
    this.fxaaMaterial.uniforms.tDiffuse.value = this.fxaaTarget.texture;
    this.fxaaMaterial.uniforms.resolution.value.set(1 / rw, 1 / rh);
    this.fxaaScene = new THREE.Scene();
    this.fxaaScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.fxaaMaterial));

    const aspect = window.innerWidth / window.innerHeight;

    // Configuração dos Render Targets e Câmeras de Reflexão Planar (LinearFilter para eliminar shimmer/flicker)
    this.reflectionRenderTarget = new THREE.WebGLRenderTarget(512, 512, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });
    this.reflectionCameraPerspective = new THREE.PerspectiveCamera(75, aspect, 0.1, 14000);

    if (new URLSearchParams(window.location.search).get('pixel') === '1') {
      CONFIG.PIXEL_SIZE = CONFIG.PIXELATION_SIZE;
      this.renderer.domElement.style.imageRendering = 'pixelated';
    }
    this.quality = new AdaptiveQuality(detectInitialQuality(this.renderer.getContext()), (level) => this.applyQuality(level));

    // Pixelização da cena: painel de Texturas (evento) ou tecla P
    window.addEventListener('pixelation-change', (e) => this.setPixelation((e as CustomEvent<boolean>).detail));
    window.addEventListener('player-scale-change', (e) => this.playerController.setPlayerScale((e as CustomEvent<number>).detail));
    window.addEventListener('fxaa-change', (e) => {
      CONFIG.FXAA = (e as CustomEvent<boolean>).detail;
    });
    window.addEventListener('grass-billboard-change', (e) => {
      CONFIG.GRASS_BILLBOARD = (e as CustomEvent<boolean>).detail;
      this.worldEngine.setGrassBillboard(CONFIG.GRASS_BILLBOARD);
    });
    this.worldEngine.setGrassBillboard(CONFIG.GRASS_BILLBOARD);
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'v' || e.key === 'V') {
        this.volLight.enabled = !this.volLight.enabled;
        console.info('[luz volumétrica] ' + (this.volLight.enabled ? 'ligada' : 'desligada'));
      }
      if (e.key === 'p' || e.key === 'P') {
        this.setPixelation(CONFIG.PIXEL_SIZE === 1);
        window.dispatchEvent(new CustomEvent('pixelation-changed', { detail: CONFIG.PIXEL_SIZE > 1 }));
      }
    });

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
        // Em primeira pessoa: 11 chunks (~700m) de terreno detalhado; além disso o horizonte (malha
        // grossa até ~12km) continua a paisagem
        this.worldEngine.setViewRadius(11);
      } else if (mode === CameraMode.OBSERVER) {
        // No modo aéreo panorâmico, restaura o raio amplo para visualização continental completa
        this.worldEngine.setViewRadius(CONFIG.VIEW_RADIUS_CHUNKS);
      }
    };

    // Inicialização do Widget de Ajuste e Exportação de Texturas
    this.textureForgeWidget = new TextureForgeWidget(this.worldEngine);
    new SkyWidget(this.atmosphere, () => { this.shadowsNeedUpdate = true; }, (kind) => this.ambience.setWeather(kind));

    // Globais para depuração e automação de testes
    const waterfallView=new URLSearchParams(location.search).get('waterfall');
    if(waterfallView==='close'||waterfallView==='spring'){
      const f=this.worldEngine.getTerrainGenerator().getHydrology().getWaterfalls()[0];
      if(f){
        const spring=waterfallView==='spring',side=f.width*.5+2;
        const x=spring?f.x+f.fz*side-f.fx*18:f.x-f.fz*f.width*.25+f.fx*(f.radius+10);
        const z=spring?f.z-f.fx*side-f.fz*18:f.z+f.fx*f.width*.25+f.fz*(f.radius+10);
        this.playerController.teleportToFirstPerson(x,z,this.worldEngine.getTerrainGenerator(),spring?Math.atan2(f.fz,-f.fx):Math.atan2(f.fx,f.fz),spring?-.40:.15);
        this.worldEngine.updateObserverPosition(x,z);
      }
    }
    (window as any).__WORLD__ = this.worldEngine;
    (window as any).__PLAYER__ = this.playerController;
    (window as any).__TEXTURE_WIDGET__ = this.textureForgeWidget;
    (window as any).__TOUCH_CONTROLS__ = this.touchControlsWidget;
    (window as any).__QUALITY__ = this.quality;

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
    if(new URLSearchParams(location.search).has('waterfall')){
      const f=this.worldEngine.getTerrainGenerator().getHydrology().getWaterfalls()[0];
      if(f){spawn.x=f.x+f.fx*8;spawn.z=f.z+f.fz*8;this.playerController.setFrustumSize(65);this.playerController.setObserverOrientation(Math.atan2(f.fx,f.fz)+.45,Math.PI*.23);}
    }
    this.playerController.setPosition(spawn.x, spawn.z);
    this.worldEngine.updateObserverPosition(spawn.x, spawn.z);
  }

  private syncAtmosphereWithWorld(): void {
    this.worldEngine.syncLighting(
      this.atmosphere.getLightDirection(),
      this.atmosphere.getSunColor(),
      this.atmosphere.getAmbientColor(),
      this.atmosphere.getFogColor()
    );
  }

  /** Liga/desliga a pixelização da cena (render em resolução menor, ampliado sem suavizar). */
  private setPixelation(on: boolean): void {
    CONFIG.PIXEL_SIZE = on ? CONFIG.PIXELATION_SIZE : 1;
    this.renderer.domElement.style.imageRendering = on ? 'pixelated' : 'auto';
    this.applyQuality(QUALITY_LEVELS[this.quality.level]);
  }

  private resizeFxaa(w: number, h: number): void {
    if (!this.fxaaTarget) return;
    this.fxaaTarget.setSize(w, h);
    this.fxaaMaterial.uniforms.resolution.value.set(1 / w, 1 / h);
  }

  private applyQuality(level: QualityLevel): void {
    this.renderScale = level.renderScale;
    this.renderer.setPixelRatio(nativePixelRatio() * level.renderScale / CONFIG.PIXEL_SIZE);
    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.waterRenderTarget.setSize(buf.x, buf.y);
    this.resizeFxaa(buf.x, buf.y);
    this.reflectionRenderTarget.setSize(level.reflectionSize, level.reflectionSize);
    this.atmosphere.getShadowClipmap().setMapSize(level.shadowMapSize);
    CONFIG.MAX_VIEW_RADIUS_CHUNKS = level.maxViewRadius;
    CONFIG.VIEW_RADIUS_CHUNKS = level.baseViewRadius;
    CONFIG.VEGETATION_RADIUS_CHUNKS = level.vegetationRadius;
    CONFIG.TEXTURE_DENSITY_CAP = level.textureDensityCap;
    this.shadowStepSq = level.shadowStep * level.shadowStep;
    this.shadowsNeedUpdate = true;
    console.info(`[qualidade] ${level.name}: resolução ${Math.round(level.renderScale * 100)}%, sombras ${level.shadowMapSize}px, alcance ${level.maxViewRadius} chunks`);
  }

  private onWindowResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(nativePixelRatio() * this.renderScale / CONFIG.PIXEL_SIZE);
    this.playerController.onResize();

    const buf = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.waterRenderTarget.setSize(buf.x, buf.y);
    this.resizeFxaa(buf.x, buf.y);
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

  /** Efeitos do vale termal sobre o personagem (lama, água quente, baforadas, gêiser) e a névoa de vapor. */
  private hazeEl: HTMLDivElement | null = null;
  private hazeLevel = 0;
  private applyThermalFx(dt: number): void {
    const fpc = this.playerController.getFirstPersonController();
    const fx = this.worldEngine.geothermalMgr.interact(dt, this._feet.x, this._feet.y, this._feet.z);
    fpc.speedMul = fx.speedMul;
    fpc.minFloor = fx.floorY;
    this.inThermalPool = fx.floorY > -1e8;
    if (fx.pushX !== 0 || fx.pushZ !== 0) fpc.addVelocity(fx.pushX * dt, fx.pushZ * dt);
    if (fx.launch > 0) fpc.launch(fx.launch);
    if (fx.ripple) this.worldEngine.addRipple(this._feet.x, this._feet.z, 0.7, 1.4, 1.8, 0.95);
    this.setHaze(dt, fx.haze);
  }
  /** Rastro d'água: vale na superfície do mar, de rios e lagos e das poças termais. */
  private inThermalPool = false;
  private updateWake(dt: number): void {
    const p = this.worldEngine.getTerrainGenerator().getPointFast(this._feet.x, this._feet.z);
    const surf = p.isWater || p.waterSurfaceY > p.height ? p.waterSurfaceY : -1e9;
    // Splash: caiu na água vindo de cima (pulo, gêiser, queda de um barranco)
    const fpcS = this.playerController.getFirstPersonController();
    const surfY = this.inThermalPool ? fpcS.minFloor + 0.3 : surf;
    // na água = com os pés na superfície (voando por cima ou na areia seca não deixa rastro)
    const inWater = surfY > -1e8 && this._feet.y <= surfY + 0.12;
    if (!this.splash) this.splash = new Splash(this.scene);
    // a queda é acompanhada por vários quadros: enquanto os pés estão acima da água guarda a maior
    // velocidade de descida; ao tocar a superfície, estoura com essa força (comparar só o quadro
    // anterior perdia a queda quando ela passava pela faixa de 0.2m entre dois quadros)
    if (!Number.isNaN(this.prevFeetY) && surfY > -1e8 && dt > 0) {
      const vy = (this._feet.y - this.prevFeetY) / dt;
      if (this._feet.y > surfY + 0.2) {
        this.fallHigh = true;
        this.fallSpeed = Math.max(this.fallSpeed, -vy);
      }
      if (this.fallHigh && this._feet.y <= surfY + 0.05) {
        const fs = Math.max(this.fallSpeed, -vy);
        this.fallHigh = false;
        this.fallSpeed = 0;
        if (fs < 2.0) { this.prevFeetY = this._feet.y; }
        // força pela ALTURA da queda (v² / 2g): ~1m de um pulo dá um splash pequeno, ~13m do gêiser
        // um enorme; em escala logarítmica, para quedas médias também crescerem de forma visível
        const fallH = (fs * fs) / 36;
        const s = Math.min(1, Math.max(0.08, Math.log2(1 + fallH) / 3.9));
        if (fs >= 2.0) {
        this.splash.burst(this._feet.x, surfY, this._feet.z, s);
        this.wakeSim.splash(this._feet.x, this._feet.z, s);
        this.worldEngine.addRipple(this._feet.x, this._feet.z, 1.0, 2.8, 4.2, 0.9);
        }
      }
    } else if (surfY <= -1e8) {
      this.fallHigh = false; this.fallSpeed = 0;
    }
    this.prevFeetY = this._feet.y;
    this.splash.update(dt, this.waterRenderTarget.height);
    this.wake.update(dt, this._feet.x, this._feet.z, inWater);
    // simulação de ondas: quem anda na água empurra a superfície (mais forte quanto mais rápido)
    const wdx = Number.isNaN(this.wakeLastX) ? 0 : this._feet.x - this.wakeLastX;
    const wdz = Number.isNaN(this.wakeLastZ) ? 0 : this._feet.z - this.wakeLastZ;
    this.wakeLastX = this._feet.x; this.wakeLastZ = this._feet.z;
    const wd = Math.hypot(wdx, wdz);
    const inst = wd > 5 || dt <= 0 ? 0 : wd / dt;
    this.wakeSpeed += (inst - this.wakeSpeed) * Math.min(1, dt * 14);
    const push = inWater && this.wakeSpeed > 0.25 ? Math.min(1.0, 0.3 + this.wakeSpeed * 0.1) : 0;
    // a onda leva um instante para se formar e aparece atrás: a fonte vai um pouco à frente do
    // personagem (mais quanto mais rápido), para o vértice do V nascer embaixo dele
    if (wd > 1e-4 && wd < 5) { this.wakeDirX = wdx / wd; this.wakeDirZ = wdz / wd; }
    const lead = Math.min(1.4, this.wakeSpeed * 0.22);
    this.wakeSim.update(this.renderer, dt, this._feet.x + this.wakeDirX * lead, this._feet.z + this.wakeDirZ * lead, push);

  }
  private resetThermalFx(): void {
    this.playerController.getFirstPersonController().speedMul = 1;
    this.playerController.getFirstPersonController().minFloor = -1e9;
    this.setHaze(0.016, 0);
  }
  /** Névoa branca de vapor por cima da imagem: sobe depressa e some devagar. */
  private setHaze(dt: number, target: number): void {
    if (!this.hazeEl) {
      const el = document.createElement('div');
      el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;opacity:0;'
        + 'background:radial-gradient(ellipse at center, rgba(240,248,250,0.55) 0%, rgba(236,244,247,0.85) 100%);';
      document.body.appendChild(el);
      this.hazeEl = el;
    }
    const k = target > this.hazeLevel ? 1 - Math.exp(-dt * 6) : 1 - Math.exp(-dt * 1.2);
    this.hazeLevel += (target - this.hazeLevel) * k;
    this.hazeEl.style.opacity = this.hazeLevel < 0.01 ? '0' : this.hazeLevel.toFixed(3);
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);

    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.1);
    // enquanto os workers geram terreno a CPU fica cheia e o FPS cai de propósito: não é o PC fraco
    this.quality.frame(rawDt * 1000, getTextureWorkerPool().isBusy());

    // 1. Atualização do Controlador de Câmera/Jogador (Aéreo / Primeira Pessoa / Transição)
    this.playerController.update(dt, this.worldEngine.getTerrainGenerator());
    const playerPos = this.playerController.getPosition();

    // Grama 3D se afasta do personagem em 1ª pessoa (pés = olhos - altura dos olhos)
    if (this.playerController.getMode() === CameraMode.FIRST_PERSON) {
      const eye = 1.75 * CONFIG.PLAYER_SCALE;
      this.worldEngine.setGrassPusher(playerPos.x, playerPos.y - eye, playerPos.z, 0.45 + 0.9 * CONFIG.PLAYER_SCALE);
      // pegadas: só no chão e fora d'água (o shader só marca areia e neve)
      this._feet.set(playerPos.x, playerPos.y - eye, playerPos.z);
      this.footprints.update(dt, this._feet, this._feet.y > 0.25);
      this.applyThermalFx(dt);
      this.updateWake(dt);
    } else {
      this.wake.update(dt, 0, 0, false);
      this.resetThermalFx();
      this.worldEngine.setGrassPusher(0, -9999, 0, 0);
    }

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
    // sombra na grade do chão: as matrizes das 3 faixas de sombra (as próprias Matrix4 das luzes)
    const sLights = this.atmosphere.getShadowClipmap().getLights();
    if (sLights.length >= 3) {
      for (let i = 0; i < 3; i++) SHADOW_GRID.uSM.value[i] = sLights[i].shadow.matrix;
      SHADOW_GRID.uSNB.value.set(sLights[0].shadow.normalBias, sLights[1].shadow.normalBias, sLights[2].shadow.normalBias);
      SHADOW_GRID.uShadowGrid.value = 1;
      // sombras na água (o shader próprio da água lê os mapas de sombra direto)
      const wu = this.worldEngine.getWaterMaterial().uniforms;
      const m0 = sLights[0].shadow.map, m1 = sLights[1].shadow.map, m2 = sLights[2].shadow.map;
      wu.tWShadow0.value = m0 ? m0.texture : null;
      wu.tWShadow1.value = m1 ? m1.texture : null;
      wu.tWShadow2.value = m2 ? m2.texture : null;
      wu.uWShadowOn.value = m0 && m1 && m2 && this.renderer.shadowMap.enabled ? 1 : 0;
    }
    // ciclo de dia e noite (HUD Céu > Automático): o sol andou, refaz as sombras
    if (this.atmosphere.tickCycle(dt)) this.shadowsNeedUpdate = true;
    this.atmosphere.update(dt, this.playerController.getCamera().position);
    // Neblina a partir do ponto focado (na visão aérea a câmera fica centenas de metros acima)
    this.atmosphere.setFocusDistance(
      this.playerController.getCamera().position.distanceTo(playerPos),
      this.playerController.getMode() === CameraMode.FIRST_PERSON
    );
    const [fogNear, fogFar] = this.atmosphere.getFogRange();
    this.worldEngine.setFogRange(fogNear, fogFar);
    // Pixels do céu acompanham a densidade de texels do chão (1.0 = densidade padrão)
    this.atmosphere.getSkybox().setPixelScale(this.worldEngine.getTexelDensity() / DEFAULT_D);

    // Verificação de histerese para atualização de sombras sob demanda
    const distSq = playerPos.distanceToSquared(this.lastShadowPos);
    if (distSq > this.shadowStepSq) { // ~0.60m de deslocamento do jogador
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
    // Vegetação recortada pela câmera: quando o conjunto visível muda, as sombras são refeitas
    // (no máximo ~6x/s, como no carregamento de chunks)
    if (this.worldEngine.cullVegetation(activeCamera) && now - this.lastVegShadowRefresh > 160) {
      this.shadowsNeedUpdate = true;
      this.lastVegShadowRefresh = now;
    }
    // ambientação do bioma em volta do jogador: névoa, gradação de cor e partículas
    const skybox = this.atmosphere.getSkybox();
    this.ambience.setHour(this.atmosphere.hour);
    this.worldEngine.thermalViewH = this.waterRenderTarget.height;
    this.ambience.update(dt, this.worldEngine.getTerrainGenerator(), playerPos, activeCamera,
      this.playerController.getMode() === CameraMode.FIRST_PERSON, this.waterRenderTarget.width, this.waterRenderTarget.height,
      skybox);
    const isFirstPerson = this.playerController.getMode() === CameraMode.FIRST_PERSON;
    const seaLevel = 0.0;

    // 3. Renderização Multi-Pass para o Pixel Water Shader
    // No Modo 1ª Pessoa: Renderiza a reflexão a cada frame para sincronia total com o movimento do jogador (elimina 100% de flicadas e stutter ao andar)
    // ... e só com água à vista (waterVisibility.ts): sem água na tela, o reflexo (que redesenha a
    // cena inteira) não é desenhado
    const shouldRenderReflection = isFirstPerson &&
      this.waterVis.update(activeCamera as THREE.PerspectiveCamera, this.worldEngine.getTerrainGenerator(), now / 1000);

    if (shouldRenderReflection) {
      this.worldEngine.renderCascadeSurfaceReflection(this.renderer,activeCamera as THREE.PerspectiveCamera);
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
      this.worldEngine.renderWaterfallReflection(this.renderer,rPersp);
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

    // Estabilidade da pixelização (modo P, câmera aérea): a câmera anda só em passos inteiros de um
    // pixel da imagem reduzida - com frações de pixel cada pixel grande trocava de cor a cada frame
    // (cintilação). A fração que sobra é compensada movendo o canvas na tela, e o movimento
    // continua suave. Devolvida à posição real no fim do quadro.
    const snapCam = CONFIG.PIXEL_SIZE > 1 && (activeCamera as THREE.OrthographicCamera).isOrthographicCamera
      ? activeCamera as THREE.OrthographicCamera : null;
    const canvasStyle = this.renderer.domElement.style;
    if (snapCam) {
      const bufH = this.renderer.getDrawingBufferSize(this._bufSize).y;
      const wpp = (snapCam.top - snapCam.bottom) / snapCam.zoom / bufH; // metros por pixel reduzido
      this._camSaved.copy(snapCam.position);
      this._snapRight.set(1, 0, 0).applyQuaternion(snapCam.quaternion);
      this._snapUp.set(0, 1, 0).applyQuaternion(snapCam.quaternion);
      const r = snapCam.position.dot(this._snapRight), u = snapCam.position.dot(this._snapUp);
      const dr = Math.round(r / wpp) * wpp - r, du = Math.round(u / wpp) * wpp - u;
      snapCam.position.addScaledVector(this._snapRight, dr).addScaledVector(this._snapUp, du);
      snapCam.updateMatrixWorld();
      // a imagem saiu deslocada de (dr, du): o canvas anda o mesmo tanto em pixels CSS
      const css = CONFIG.PIXEL_SIZE / nativePixelRatio() / this.renderScale;
      canvasStyle.transform = `translate(${(dr / wpp) * css}px, ${(-du / wpp) * css}px)`;
    } else if (canvasStyle.transform) {
      canvasStyle.transform = '';
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

    // God rays + lens flare (sunFX.ts): raios a partir do depth da cena opaca; somados no fim
    if (this.waterRenderTarget.depthTexture) {
      this.sunFX.cloudCover = this.atmosphere.getSkybox().getCloudCoverage();
      this._sunCol.copy(this.atmosphere.getSkybox().getCurrentCoronaColor()).lerp(new THREE.Color(1, 0.97, 0.88), 0.5).convertLinearToSRGB();
      // luz volumétrica: sol acima do horizonte, primeira pessoa (o céu encoberto apaga no overlay)
      const sunD = this.atmosphere.getSunDirection();
      const volStrength = isFirstPerson ? THREE.MathUtils.smoothstep(sunD.y, -0.02, 0.12) : 0;
      this.volLight.render(this.renderer, this.waterRenderTarget.depthTexture, activeCamera,
        this.atmosphere.getShadowClipmap().getLights(), sunD, this.waterRenderTarget.width, this.waterRenderTarget.height, volStrength);
      // bloom suave do que brilha (lava, vaga-lumes, brasas, sol)
      this.bloom.render(this.renderer, this.waterRenderTarget.texture, this.waterRenderTarget.width, this.waterRenderTarget.height);
      this.sunFX.volTex = this.volLight.texture;
      this.sunFX.volAmt = this.volLight.amount;
      this.sunFX.render(this.renderer, this.waterRenderTarget.depthTexture, this.waterRenderTarget.texture, activeCamera, this.atmosphere.getSunDirection(),
        this._sunCol, this.waterRenderTarget.width, this.waterRenderTarget.height, isFirstPerson, dt);
    }

    // Reflexo das poças (puddleSSR.ts): só com poças e câmera em perspectiva; a imagem refletida
    // substitui a cena opaca nos blits
    const sceneTex = (WET.uWet.value > 0.01 && isFirstPerson && this.waterRenderTarget.depthTexture)
      ? this.puddleSSR.render(this.renderer, this.waterRenderTarget, activeCamera, this.atmosphere.getSkybox().getCurrentFogColor())
      : this.waterRenderTarget.texture;
    this.blitMaterial.map = sceneTex;
    this.blitToDisplayMaterial.uniforms.tScene.value = sceneTex;

    // Passo 3: Blit em tela cheia da cena opaca para o canvas (ou, com FXAA, para o alvo do FXAA,
    // já convertida para as cores da tela). Com a pixelização ligada o FXAA não entra: borraria
    // os pixels grandes de propósito.
    const useFxaa = CONFIG.FXAA && CONFIG.PIXEL_SIZE <= 1;
    if (useFxaa) {
      this.blitToDisplayMaterial.uniforms.uExposure.value = this.renderer.toneMappingExposure;
      this.renderer.setRenderTarget(this.fxaaTarget);
      this.renderer.render(this.blitToDisplayScene, this.blitCamera);
    } else {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.blitScene, this.blitCamera);
    }

    // Passo 4: Atualizar uniforms da água e renderizar água transparente por cima com blend analítico
    this.worldEngine.setWaterVisible(true);
    this.worldEngine.updateWaterUniforms(
      this.waterRenderTarget.depthTexture,
      this.reflectionRenderTarget.texture,
      this.reflectTextureMatrix,
      activeCamera,
      this.waterRenderTarget.width,
      this.waterRenderTarget.height,
      this.renderer.toneMappingExposure,
      this.waterRenderTarget.texture
    );

    this.renderer.autoClear = false;
    this.renderer.render(this.worldEngine.getWaterGroup(), activeCamera);
    this.renderer.autoClear = true;

    // Passo 5: FXAA da imagem final para a tela
    if (useFxaa) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(this.fxaaScene, this.blitCamera);
    }

    // Passo 6: god rays e lens flare por cima de tudo (pixels grandes, sem passar pelo FXAA)
    this.renderer.setRenderTarget(null);
    this.sunFX.overlay(this.renderer);
    this.bloom.composite(this.renderer);

    if (snapCam) {
      snapCam.position.copy(this._camSaved);
      snapCam.updateMatrixWorld();
    }
  };
}

window.addEventListener('DOMContentLoaded', () => {
  new App();
});
