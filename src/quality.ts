/**
 * Qualidade gráfica adaptativa.
 *
 * O nível inicial vem do hardware (núcleos, memória, GPU, celular) e pode ser forçado pela URL
 * (?quality=low|medium|high). Durante o jogo a mediana do tempo de frame é medida em janelas de
 * ~2s: abaixo de ~40 fps o jogo desce um degrau; com folga constante (60 fps cravados) sobe um.
 * Os degraus cortam sombras, alcance e vegetação; a resolução interna fica sempre a da tela
 * (renderizar abaixo dela deixava a imagem pixelada, o que incomodava mais que o ganho de FPS).
 */

export interface QualityLevel {
  name: string;
  renderScale: number;       // fração da resolução base usada para renderizar
  shadowMapSize: number;     // lado de cada um dos 3 mapas de sombra
  maxViewRadius: number;     // raio máximo de chunks no modo aéreo
  baseViewRadius: number;    // raio base de chunks no modo aéreo
  firstPersonRadius: number; // raio de chunks detalhados em 1ª pessoa
  vegetationRadius: number;  // raio (chunks) com árvores/pedras/arbustos
  grassRadius: number;       // raio (chunks) com grama 3D
  vegetationDensityScale: number;
  chunkSegments: number;     // subdivisões do terreno próximo
  shadowStep: number;        // metros andados antes de refazer sombras
  reflectionSize: number;    // lado do render target de reflexão
  reflectionFps: number;     // frequência máxima da reflexão planar
  textureDensityCap: number; // teto de texels/m fora do miolo
  nearTextureDensityCap: number; // teto também para os 3x3 chunks centrais
  horizonLevels: number;     // quantos anéis do horizonte ficam ativos
  horizonScale: number;      // escala do alcance dos anéis
  fogFirstPersonNear: number;
  fogFirstPersonFar: number;
  fogObserverMinFar: number;
  fogObserverExtra: number;
  fxaa: boolean;
}

export const QUALITY_LEVELS: QualityLevel[] = [
  { name: 'alta',          renderScale: 1.00, shadowMapSize: 2048, maxViewRadius: 22, baseViewRadius: 12, firstPersonRadius: 11, vegetationRadius: 8, grassRadius: 4, vegetationDensityScale: 1.00, chunkSegments: 32, shadowStep: 0.6, reflectionSize: 512, reflectionFps: 60, textureDensityCap: Infinity, nearTextureDensityCap: Infinity, horizonLevels: 3, horizonScale: 1.00, fogFirstPersonNear: 20, fogFirstPersonFar: 11000, fogObserverMinFar: 2400, fogObserverExtra: 2200, fxaa: true },
  { name: 'alta-',         renderScale: 1.00, shadowMapSize: 2048, maxViewRadius: 20, baseViewRadius: 11, firstPersonRadius: 10, vegetationRadius: 7, grassRadius: 4, vegetationDensityScale: 1.00, chunkSegments: 32, shadowStep: 0.8, reflectionSize: 512, reflectionFps: 45, textureDensityCap: Infinity, nearTextureDensityCap: Infinity, horizonLevels: 3, horizonScale: 1.00, fogFirstPersonNear: 20, fogFirstPersonFar: 10000, fogObserverMinFar: 2300, fogObserverExtra: 2100, fxaa: true },
  { name: 'média',         renderScale: 1.00, shadowMapSize: 1024, maxViewRadius: 18, baseViewRadius: 10, firstPersonRadius: 9,  vegetationRadius: 7, grassRadius: 3, vegetationDensityScale: 0.92, chunkSegments: 32, shadowStep: 1.0, reflectionSize: 384, reflectionFps: 30, textureDensityCap: Infinity, nearTextureDensityCap: Infinity, horizonLevels: 3, horizonScale: 1.00, fogFirstPersonNear: 20, fogFirstPersonFar: 9000, fogObserverMinFar: 2200, fogObserverExtra: 2000, fxaa: true },
  { name: 'média-',        renderScale: 0.95, shadowMapSize: 1024, maxViewRadius: 15, baseViewRadius: 9,  firstPersonRadius: 8,  vegetationRadius: 6, grassRadius: 3, vegetationDensityScale: 0.84, chunkSegments: 28, shadowStep: 1.5, reflectionSize: 320, reflectionFps: 22, textureDensityCap: 3, nearTextureDensityCap: 4, horizonLevels: 3, horizonScale: 0.90, fogFirstPersonNear: 18, fogFirstPersonFar: 7000, fogObserverMinFar: 2000, fogObserverExtra: 1700, fxaa: true },
  { name: 'baixa',         renderScale: 0.90, shadowMapSize: 768,  maxViewRadius: 12, baseViewRadius: 8,  firstPersonRadius: 7,  vegetationRadius: 5, grassRadius: 2, vegetationDensityScale: 0.74, chunkSegments: 24, shadowStep: 2.5, reflectionSize: 256, reflectionFps: 14, textureDensityCap: 2.3, nearTextureDensityCap: 3.0, horizonLevels: 2, horizonScale: 0.82, fogFirstPersonNear: 16, fogFirstPersonFar: 5000, fogObserverMinFar: 1700, fogObserverExtra: 1400, fxaa: true },
  { name: 'muito baixa',   renderScale: 0.82, shadowMapSize: 512,  maxViewRadius: 10, baseViewRadius: 7,  firstPersonRadius: 6,  vegetationRadius: 4, grassRadius: 2, vegetationDensityScale: 0.64, chunkSegments: 20, shadowStep: 4.0, reflectionSize: 192, reflectionFps: 8,  textureDensityCap: 1.8, nearTextureDensityCap: 2.4, horizonLevels: 2, horizonScale: 0.70, fogFirstPersonNear: 14, fogFirstPersonFar: 3200, fogObserverMinFar: 1400, fogObserverExtra: 1100, fxaa: false },
  { name: 'integrada fraca', renderScale: 0.72, shadowMapSize: 512, maxViewRadius: 8,  baseViewRadius: 6,  firstPersonRadius: 5,  vegetationRadius: 3, grassRadius: 1, vegetationDensityScale: 0.52, chunkSegments: 16, shadowStep: 5.5, reflectionSize: 128, reflectionFps: 5,  textureDensityCap: 1.25, nearTextureDensityCap: 1.75, horizonLevels: 1, horizonScale: 0.55, fogFirstPersonNear: 12, fogFirstPersonFar: 1400, fogObserverMinFar: 1000, fogObserverExtra: 700, fxaa: false },
];

/** Nível inicial pelo hardware (índice em QUALITY_LEVELS). */
export function detectInitialQuality(gl: WebGLRenderingContext | WebGL2RenderingContext): number {
  const forced = new URLSearchParams(window.location.search).get('quality');
  if (forced === 'high') return 0;
  if (forced === 'medium') return 2;
  if (forced === 'low') return 4;
  if (forced === 'potato' || forced === 'weak') return 6;

  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as any).deviceMemory as number | undefined;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && !/Windows/i.test(navigator.userAgent);
  let gpu = '';
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  if (dbg) gpu = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
  const software = /SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu);
  const weakIntel = /Intel.*(?:UHD Graphics|HD Graphics)/i.test(gpu);
  const integrated = /Intel|UHD|Iris|HD Graphics|Mali|Adreno|PowerVR|Apple GPU|Vega \d+ Graphics|Radeon\(TM\) Graphics/i.test(gpu);

  if (software) return 6;
  let level = 0;
  if (weakIntel) level = 6;
  else if (integrated) level = 2;
  if (mobile) level = Math.max(level, 3);
  if (cores <= 4) level = Math.max(level, 2);
  if (cores <= 2 || (memory !== undefined && memory <= 2)) level = Math.max(level, 4);
  else if (memory !== undefined && memory <= 4) level = Math.max(level, 3);
  return level;
}

/**
 * Mede o tempo de frame e decide quando trocar de nível. Ignora os primeiros segundos e os
 * frames muito longos isolados (carregamento de chunks) usando a mediana da janela.
 */
export class AdaptiveQuality {
  private samples: number[] = [];
  private windowStart = 0;
  private goodWindows = 0;
  private badWindows = 0;
  private lastChange = 0;
  private startedAt = performance.now();

  constructor(public level: number, private readonly apply: (level: QualityLevel, index: number) => void) {
    apply(QUALITY_LEVELS[level], level);
  }

  public frame(dtMs: number, generating: boolean = false): void {
    const now = performance.now();
    if (now - this.startedAt < 4000) return; // carga inicial do mundo
    // geração de terreno em andamento (workers ocupando a CPU): a janela não conta
    if (generating) {
      this.samples = [];
      this.windowStart = 0;
      return;
    }
    // Aba oculta ou loop pausado/estrangulado pelo navegador (frames de segundos): não é o hardware.
    // Descarta a janela inteira para não confundir uma pausa com um PC fraco.
    if (document.hidden || dtMs > 500) {
      this.samples = [];
      this.windowStart = 0;
      return;
    }
    if (this.windowStart === 0) this.windowStart = now;
    this.samples.push(dtMs);
    if (now - this.windowStart < 2000) return;

    const sorted = this.samples.sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.samples = [];
    this.windowStart = now;

    if (median > 25) { this.badWindows++; this.goodWindows = 0; }
    else if (median < 18) { this.goodWindows++; this.badWindows = 0; }
    else { this.badWindows = 0; this.goodWindows = 0; }

    if (this.badWindows >= 2 && this.level < QUALITY_LEVELS.length - 1) {
      this.set(this.level + 1, now);
    } else if (this.goodWindows >= 6 && this.level > 0 && now - this.lastChange > 20000) {
      this.set(this.level - 1, now);
    }
  }

  private set(level: number, now: number): void {
    this.level = level;
    this.lastChange = now;
    this.badWindows = 0;
    this.goodWindows = 0;
    this.apply(QUALITY_LEVELS[level], level);
  }
}
