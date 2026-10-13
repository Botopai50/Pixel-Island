import { BiomeType } from '../generation/types.ts';
import type { TerrainGenerator } from '../generation/terrain/terrainGenerator.ts';
import { groveAt } from '../generation/vegetation/vegetationPlanner.ts';

/**
 * Painel de biomas (tecla B): lista todos os biomas do jogo e, ao clicar em um, teleporta o
 * jogador (em primeira pessoa) para o ponto mais próximo daquele bioma. O mapa é varrido uma vez,
 * aos poucos (sem travar o jogo), numa grade grossa; ao clicar escolhe-se o ponto mais próximo
 * cujo entorno é do mesmo bioma, para não cair numa fronteira.
 */
/** Destinos que não são biomas de verdade, mas manchas de uma árvore especial (cerejeiras e árvores ancestrais) */
const GROVES: { type: string; icon: string; label: string }[] = [
  { type: 'grove:korok', icon: '🍃', label: 'Bosque ancestral' },
];

const BIOMES: { type: string; icon: string; label: string }[] = [
  { type: BiomeType.BEACH, icon: '🏖️', label: 'Praia' },
  { type: BiomeType.SHALLOWS, icon: '🌊', label: 'Águas rasas' },
  { type: BiomeType.CORAL_LAGOON, icon: '🪸', label: 'Lagoa de coral' },
  { type: BiomeType.OCEAN, icon: '🐋', label: 'Oceano profundo' },
  { type: BiomeType.MANGROVE_SWAMP, icon: '🌿', label: 'Manguezal' },
  { type: BiomeType.COASTAL_MEADOW, icon: '🌾', label: 'Campos costeiros' },
  { type: BiomeType.TEMPERATE_FOREST, icon: '🌳', label: 'Floresta temperada' },
  { type: BiomeType.AUTUMN_FOREST, icon: '🍂', label: 'Bosque outonal' },
  { type: BiomeType.SAKURA_GROVE, icon: '🌸', label: 'Bosque de cerejeiras' },
  { type: BiomeType.TROPICAL_RAINFOREST, icon: '🌴', label: 'Selva tropical' },
  { type: BiomeType.SAVANNAH, icon: '🦒', label: 'Savana' },
  { type: BiomeType.DESERT_DUNES, icon: '🏜️', label: 'Deserto e dunas' },
  { type: BiomeType.CANYON_DESERT, icon: '🏞️', label: 'Cânions' },
  { type: BiomeType.BOREAL_TAIGA, icon: '🌲', label: 'Taiga' },
  { type: BiomeType.ALPINE_TUNDRA, icon: '⛰️', label: 'Tundra alpina' },
  { type: BiomeType.ROCKY_PEAKS, icon: '🪨', label: 'Penhascos' },
  { type: BiomeType.SNOW_SUMMIT, icon: '🏔️', label: 'Cumes nevados' },
  { type: BiomeType.FROZEN_TUNDRA, icon: '🧊', label: 'Planície de gelo' },
  { type: BiomeType.VOLCANIC_FIELD, icon: '🌋', label: 'Campo vulcânico' },
  { type: BiomeType.VOLCANIC_CALDERA, icon: '🔥', label: 'Caldeira vulcânica' },
  { type: BiomeType.GEOTHERMAL_VALLEY, icon: '♨️', label: 'Fontes termais' },
  ...GROVES,
];

const RANGE = 9600;     // metros em volta da origem que a busca cobre
const STEP = 140;       // espaçamento da grade da busca
const BUDGET_MS = 5;    // tempo de busca por quadro (o jogo respira entre as fatias)

export class BiomeWidget {
  private container: HTMLDivElement;
  private panel: HTMLDivElement;
  private toggleBtn: HTMLButtonElement;
  private status: HTMLDivElement;
  private btns = new Map<string, HTMLButtonElement>();
  private found = new Map<string, { x: number; z: number }[]>();
  private scanning = false;
  private scanned = false;

  constructor(
    private terrain: TerrainGenerator,
    private getPlayer: () => { x: number; z: number },
    private teleport: (x: number, z: number) => void,
  ) {
    this.container = document.createElement('div');
    this.container.className = 'sky-widget-container biome-widget-container';

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.className = 'forge-toggle-btn';
    this.toggleBtn.innerHTML = `<span class="forge-toggle-icon">🗺️</span><span class="forge-toggle-text">Biomas<span class="key-hint"> (B)</span></span>`;
    this.toggleBtn.title = 'Teleportar para um bioma (Tecla B)';
    this.toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });

    this.panel = document.createElement('div');
    this.panel.className = 'forge-panel sky-panel biome-panel hidden';
    this.panel.innerHTML = `
      <div class="forge-header">
        <div class="forge-title-wrap">
          <span class="forge-title-icon">🗺️</span>
          <div><h3 class="forge-title">Biomas</h3><span class="forge-subtitle">Clique para ir ao bioma mais próximo</span></div>
        </div>
        <button class="forge-close-btn" title="Fechar (B)">✕</button>
      </div>
      <div class="forge-content">
        <div class="biome-status"></div>
        <div class="sky-btn-grid" data-g="biomes"></div>
      </div>`;
    this.panel.querySelector('.forge-close-btn')!.addEventListener('click', () => this.toggle(false));
    this.status = this.panel.querySelector('.biome-status') as HTMLDivElement;

    const grid = this.panel.querySelector('[data-g="biomes"]')!;
    for (const b of BIOMES) {
      const btn = document.createElement('button');
      btn.className = 'sky-btn';
      btn.disabled = true;
      btn.innerHTML = `<span class="sky-btn-icon">${b.icon}</span><span>${b.label}</span>`;
      btn.addEventListener('click', () => this.go(b.type));
      grid.appendChild(btn);
      this.btns.set(b.type, btn);
    }

    for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'wheel']) {
      this.panel.addEventListener(ev, (e) => e.stopPropagation());
    }
    this.container.appendChild(this.toggleBtn);
    this.container.appendChild(this.panel);
    document.body.appendChild(this.container);

    // coordenadas do jogador (tecla K): para anotar um lugar e voltar a ele depois
    const coords = document.createElement('div');
    coords.className = 'coords-readout hidden';
    document.body.appendChild(coords);
    window.setInterval(() => {
      if (coords.classList.contains('hidden')) return;
      const p = this.getPlayer();
      coords.textContent = `x ${Math.round(p.x)}  z ${Math.round(p.z)}  ·  ${this.terrain.getPointFast(p.x, p.z).biome.type}`;
    }, 300);

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'k' || e.key === 'K') coords.classList.toggle('hidden');
      if (e.key === 'b' || e.key === 'B') this.toggle();
    });
  }

  private toggle(open?: boolean): void {
    const show = open ?? this.panel.classList.contains('hidden');
    this.panel.classList.toggle('hidden', !show);
    this.toggleBtn.classList.toggle('active', show);
    if (show && !this.scanned && !this.scanning) this.scan();
  }

  /** Varre a grade em fatias; os botões vão acendendo à medida que cada bioma aparece. */
  private scan(): void {
    this.scanning = true;
    const n = Math.floor((RANGE * 2) / STEP) + 1;
    // ordem do grosso para o fino (a cada 8, 4, 2, 1 pontos da grade): os biomas grandes aparecem
    // logo e o resto vai sendo refinado
    const order: number[] = [];
    for (const level of [8, 4, 2, 1]) {
      for (let iz = 0; iz < n; iz += level) {
        for (let ix = 0; ix < n; ix += level) {
          if (level < 8 && ix % (level * 2) === 0 && iz % (level * 2) === 0) continue;
          order.push(iz * n + ix);
        }
      }
    }
    let i = 0;
    const total = order.length;
    const tick = () => {
      const start = performance.now();
      for (; i < total && performance.now() - start < BUDGET_MS; i++) {
        const k = order[i];
        const x = -RANGE + (k % n) * STEP, z = -RANGE + Math.floor(k / n) * STEP;
        const bio = this.terrain.getPointFast(x, z).biome;
        const t: string = bio.type;
        const g = groveAt(x, z, bio.type, bio.moisture);
        for (const key of g ? [t, 'grove:' + g] : [t]) {
          let list = this.found.get(key);
          if (!list) {
            this.found.set(key, list = []);
            const b = this.btns.get(key);
            if (b) b.disabled = false;
          }
          list.push({ x, z });
        }
      }
      this.status.textContent = i < total ? `Procurando biomas… ${Math.round((i / total) * 100)}%` : '';
      if (i < total) requestAnimationFrame(tick);
      else { this.scanning = false; this.scanned = true; this.markMissing(); }
    };
    tick();
  }

  private markMissing(): void {
    const missing = BIOMES.filter((b) => !this.found.has(b.type)).map((b) => b.label);
    if (missing.length) this.status.textContent = `Não encontrados neste mundo: ${missing.join(', ')}`;
  }

  private go(type: string): void {
    const list = this.found.get(type);
    if (!list || !list.length) return;
    const p = this.getPlayer();
    const sorted = list.slice().sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    // o mais próximo cujo entorno (40 m) é do mesmo bioma; se nenhum, o mais próximo mesmo
    const same = (x: number, z: number) => {
      const bio = this.terrain.getPointFast(x, z).biome;
      if (type.startsWith('grove:')) return groveAt(x, z, bio.type, bio.moisture) === type.slice(6);
      return bio.type === type;
    };
    let pick = sorted[0];
    for (let k = 0; k < Math.min(sorted.length, 40); k++) {
      const c = sorted[k];
      if (same(c.x + 40, c.z) && same(c.x - 40, c.z) && same(c.x, c.z + 40) && same(c.x, c.z - 40)) { pick = c; break; }
    }
    this.teleport(pick.x, pick.z);
    this.toggle(false);
  }
}
