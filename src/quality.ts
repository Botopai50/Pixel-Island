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
  renderScale: number;       // fração da resolução base (tela / PIXEL_SIZE) usada para renderizar
  shadowMapSize: number;     // lado de cada um dos 3 mapas de sombra
  maxViewRadius: number;     // raio de chunks no zoom mais afastado
  baseViewRadius: number;    // raio de chunks no zoom padrão
  vegetationRadius: number;  // raio (chunks) com árvores/pedras/arbustos
  shadowStep: number;        // metros andados antes de refazer as sombras
  reflectionSize: number;    // lado do render target do reflexo da água em 1ª pessoa
  textureDensityCap: number; // teto de texels/m das texturas de chunk (custo de geração ~ quadrado)
}

export const QUALITY_LEVELS: QualityLevel[] = [
  { name: 'alta',        renderScale: 1.00, shadowMapSize: 2048, maxViewRadius: 22, baseViewRadius: 12, vegetationRadius: 7, shadowStep: 2.4, reflectionSize: 256, textureDensityCap: Infinity },
  { name: 'alta-',       renderScale: 1.00, shadowMapSize: 2048, maxViewRadius: 20, baseViewRadius: 11, vegetationRadius: 6.5, shadowStep: 2.6, reflectionSize: 256, textureDensityCap: Infinity },
  { name: 'média',       renderScale: 1.00, shadowMapSize: 2048, maxViewRadius: 18, baseViewRadius: 10, vegetationRadius: 7, shadowStep: 2.2, reflectionSize: 192, textureDensityCap: Infinity },
  { name: 'média-',      renderScale: 1.00, shadowMapSize: 2048, maxViewRadius: 16, baseViewRadius: 10, vegetationRadius: 6, shadowStep: 2.8, reflectionSize: 192, textureDensityCap: 3 },
  { name: 'baixa',       renderScale: 1.00, shadowMapSize: 1024, maxViewRadius: 14, baseViewRadius: 9,  vegetationRadius: 6, shadowStep: 3.0, reflectionSize: 160, textureDensityCap: 2.5 },
  { name: 'muito baixa', renderScale: 1.00, shadowMapSize: 512,  maxViewRadius: 12, baseViewRadius: 8,  vegetationRadius: 5, shadowStep: 3.5, reflectionSize: 160, textureDensityCap: 2 },
];

const PREF_KEY = 'pie.quality';

/** Escolha salva no menu do jogo: 'auto' (o jogo decide) ou o índice fixo em QUALITY_LEVELS. */
export function loadQualityPref(): 'auto' | number {
  try {
    const v = localStorage.getItem(PREF_KEY);
    const n = Number(v);
    if (v !== null && v !== 'auto' && Number.isInteger(n) && n >= 0 && n < QUALITY_LEVELS.length) return n;
  } catch { /* armazenamento indisponível */ }
  return 'auto';
}
export function saveQualityPref(p: 'auto' | number): void {
  try { localStorage.setItem(PREF_KEY, String(p)); } catch { /* sem armazenamento: vale só nesta sessão */ }
}

/** Nível inicial pelo hardware (índice em QUALITY_LEVELS); a escolha salva no menu vale mais, a URL (?quality=) vale mais que ela. */
export function detectInitialQuality(gl: WebGLRenderingContext | WebGL2RenderingContext): number {
  const forced = new URLSearchParams(window.location.search).get('quality');
  const pref = loadQualityPref();
  if (!forced && pref !== 'auto') return pref;
  if (forced === 'high') return 0;
  if (forced === 'medium') return 2;
  if (forced === 'low') return 4;

  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as any).deviceMemory as number | undefined;
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && !/Windows/i.test(navigator.userAgent);
  let gpu = '';
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  if (dbg) gpu = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL));
  const software = /SwiftShader|llvmpipe|Software|Basic Render/i.test(gpu);
  const integrated = /Intel|UHD|Iris|HD Graphics|Mali|Adreno|PowerVR|Apple GPU|Vega \d+ Graphics|Radeon\(TM\) Graphics/i.test(gpu);

  if (software) return 5;
  let level = 0;
  if (integrated) level = 2;
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
  /** false = nível fixo escolhido no menu: a medição de FPS não troca mais de nível */
  public auto = true;

  constructor(public level: number, private readonly apply: (level: QualityLevel, index: number) => void) {
    apply(QUALITY_LEVELS[level], level);
    const forced = new URLSearchParams(window.location.search).get('quality');
    if (!forced && loadQualityPref() !== 'auto') this.auto = false;
  }

  /** Escolha do menu: um nível fixo, ou 'auto' para voltar a deixar o jogo decidir pelo FPS. */
  public choose(p: 'auto' | number): void {
    saveQualityPref(p);
    this.badWindows = 0; this.goodWindows = 0; this.samples = []; this.windowStart = 0;
    if (p === 'auto') { this.auto = true; return; }
    this.auto = false;
    if (p !== this.level) this.set(p, performance.now());
  }

  public frame(dtMs: number, generating: boolean = false): void {
    const now = performance.now();
    if (!this.auto) return;
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

    // (limiar de 33 ms e três janelas seguidas: antes bastava a mediana passar de 25 ms por 4 s para o jogo trocar de nível, e trocar o
    // tamanho dos mapas de sombra recria as texturas: por um instante todas as árvores ficavam sem sombra, claras)
    // (os degraus mexem no alcance da vegetação e das sombras: com a mediana perto do limiar o jogo ficava subindo e descendo de nível, e
    // as árvores apareciam e sumiam em ciclos. Agora só desce de verdade quando está muito lento, e só sobe com muita folga.)
    if (median > 45) { this.badWindows++; this.goodWindows = 0; }
    else if (median < 14) { this.goodWindows++; this.badWindows = 0; }
    else { this.badWindows = 0; this.goodWindows = 0; }

    if (this.badWindows >= 4 && this.level < QUALITY_LEVELS.length - 1) {
      this.set(this.level + 1, now);
    } else if (this.goodWindows >= 10 && this.level > 0 && now - this.lastChange > 40000) {
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
