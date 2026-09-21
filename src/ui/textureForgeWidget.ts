import { WorldEngine } from '../generation/worldEngine.ts';
import { ForgeParams, DEFAULT_FORGE_PARAMS, DEFAULT_D } from '../generation/terrain/terrainTextureForge.ts';

interface TextureControlsState extends ForgeParams {
  density: number;
}

export class TextureForgeWidget {
  private worldEngine: WorldEngine;
  private state: TextureControlsState;
  private container!: HTMLDivElement;
  private panel!: HTMLDivElement;
  private toggleBtn!: HTMLButtonElement;
  private jsonArea!: HTMLTextAreaElement;
  private isVisible: boolean = false;
  private debounceTimer: number | null = null;
  private valueLabels: Map<string, HTMLElement> = new Map();

  constructor(worldEngine: WorldEngine) {
    this.worldEngine = worldEngine;
    this.state = {
      ...DEFAULT_FORGE_PARAMS,
      seed: worldEngine.forge.params.seed,
      density: worldEngine.forge.density || DEFAULT_D,
    };

    this.createUI();
    this.attachEvents();
  }

  private createUI(): void {
    // Container Principal
    this.container = document.createElement('div');
    this.container.className = 'forge-widget-container';

    // Botão Flutuante de Abertura / Fechamento (Canto Superior Direito)
    this.toggleBtn = document.createElement('button');
    this.toggleBtn.className = 'forge-toggle-btn';
    this.toggleBtn.innerHTML = `
      <span class="forge-toggle-icon">🎨</span>
      <span class="forge-toggle-text">Texturas (T)</span>
    `;
    this.toggleBtn.title = 'Abrir painel de controle e exportação de texturas (Tecla T)';

    // Painel Flutuante Estilo Dark Glassmorphism
    this.panel = document.createElement('div');
    this.panel.className = 'forge-panel hidden';
    this.panel.innerHTML = `
      <div class="forge-header">
        <div class="forge-title-wrap">
          <span class="forge-title-icon">🎨</span>
          <div>
            <h3 class="forge-title">Pixel Terrain Forge</h3>
            <span class="forge-subtitle">Ajuste em tempo real, exporte e nos envie</span>
          </div>
        </div>
        <button class="forge-close-btn" title="Fechar painel (T)">✕</button>
      </div>

      <div class="forge-content">
        <!-- Grupo 1: Máscara Macro (Perlin) -->
        <div class="forge-group">
          <div class="forge-group-title">Máscara Macro (Perlin)</div>
          
          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-pscale">Escala do Perlin</label>
              <b id="fg-pscale-v">${this.state.pscale.toFixed(1)}</b>
            </div>
            <input id="fg-pscale" type="range" min="1.5" max="16.0" step="0.1" value="${this.state.pscale}">
            <span class="forge-hint">Tamanho das grandes regiões de vegetação</span>
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-grass">Quantidade de Grama</label>
              <b id="fg-grass-v">${(this.state.grass >= 0 ? '+' : '') + this.state.grass.toFixed(2)}</b>
            </div>
            <input id="fg-grass" type="range" min="-0.35" max="0.42" step="0.01" value="${this.state.grass}">
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-edge">Irregularidade das Bordas</label>
              <b id="fg-edge-v">${this.state.edge.toFixed(2)}</b>
            </div>
            <input id="fg-edge" type="range" min="0.0" max="1.5" step="0.01" value="${this.state.edge}">
            <span class="forge-hint">Warp + dither em cluster no limiar da grama</span>
          </div>
        </div>

        <!-- Grupo 2: Detalhe Pixel Art -->
        <div class="forge-group">
          <div class="forge-group-title">Detalhe Pixel Art</div>
          
          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-tuft">Densidade dos Tufos</label>
              <b id="fg-tuft-v">${this.state.tuft.toFixed(2)}</b>
            </div>
            <input id="fg-tuft" type="range" min="0.0" max="1.6" step="0.01" value="${this.state.tuft}">
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-cluster">Tamanho dos Clusters</label>
              <b id="fg-cluster-v">${this.state.clusterSize}</b>
            </div>
            <input id="fg-cluster" type="range" min="2" max="7" step="1" value="${this.state.clusterSize}">
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-spill">Invasão nas Bordas (Spill)</label>
              <b id="fg-spill-v">${this.state.spill.toFixed(2)}</b>
            </div>
            <input id="fg-spill" type="range" min="0.0" max="2.0" step="0.01" value="${this.state.spill}">
            <span class="forge-hint">Lâminas de grama que ultrapassam os limites</span>
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-greens">Variações de Verde</label>
              <b id="fg-greens-v">${this.state.greens}</b>
            </div>
            <input id="fg-greens" type="range" min="2" max="6" step="1" value="${this.state.greens}">
          </div>
        </div>

        <!-- Grupo 3: Solo & Rocha -->
        <div class="forge-group">
          <div class="forge-group-title">Solo & Rocha</div>
          
          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-dirt">Detalhes da Terra</label>
              <b id="fg-dirt-v">${this.state.dirt.toFixed(2)}</b>
            </div>
            <input id="fg-dirt" type="range" min="0.0" max="1.6" step="0.01" value="${this.state.dirt}">
            <span class="forge-hint">Pedrinhas, ranhuras e sulcos na terra</span>
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-rock">Quantidade de Rocha</label>
              <b id="fg-rock-v">${this.state.rock.toFixed(2)}</b>
            </div>
            <input id="fg-rock" type="range" min="0.0" max="1.0" step="0.01" value="${this.state.rock}">
          </div>
        </div>

        <!-- Grupo 4: Biomas & Relevo -->
        <div class="forge-group">
          <div class="forge-group-title">Biomas & Relevo</div>
          
          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-massif">Maciço Montanhoso</label>
              <b id="fg-massif-v">${this.state.massif.toFixed(2)}</b>
            </div>
            <input id="fg-massif" type="range" min="0.0" max="1.0" step="0.01" value="${this.state.massif}">
            <span class="forge-hint">Extensão da rocha viva e tálus montanhoso</span>
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-polar">Frente Polar (Neve)</label>
              <b id="fg-polar-v">${this.state.polar.toFixed(2)}</b>
            </div>
            <input id="fg-polar" type="range" min="0.0" max="1.0" step="0.01" value="${this.state.polar}">
            <span class="forge-hint">Avanço da neve e pinheiros polares</span>
          </div>
        </div>

        <!-- Grupo 5: Shader & Escala -->
        <div class="forge-group">
          <div class="forge-group-title">Shader & Escala</div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-hang">Saliência de Encosta (Hang)</label>
              <b id="fg-hang-v">${this.state.hang.toFixed(2)}</b>
            </div>
            <input id="fg-hang" type="range" min="0.0" max="0.60" step="0.01" value="${this.state.hang}">
            <span class="forge-hint">Grama escorrendo pelos despenhadeiros</span>
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-density">Densidade de Texels</label>
              <b id="fg-density-v">${this.state.density.toFixed(1)} tx/m</b>
            </div>
            <input id="fg-density" type="range" min="1.0" max="6.0" step="0.5" value="${this.state.density}">
            <span class="forge-hint">Maior = pixels menores, Menor = pixels mais graúdos</span>
          </div>
        </div>

        <!-- Ações & Exportação -->
        <div class="forge-group forge-export-group">
          <div class="forge-group-title">Exportar Configuração</div>
          <div class="forge-btn-grid">
            <button id="fg-btn-copy" class="forge-btn forge-btn-primary">📋 Copiar JSON</button>
            <button id="fg-btn-download" class="forge-btn">💾 Baixar JSON</button>
          </div>

          <div class="forge-json-wrap">
            <textarea id="fg-json" readonly rows="7" spellcheck="false"></textarea>
          </div>

          <div class="forge-btn-grid">
            <button id="fg-btn-import" class="forge-btn">📥 Importar JSON</button>
            <button id="fg-btn-reset" class="forge-btn forge-btn-danger">🔄 Restaurar Padrões</button>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(this.toggleBtn);
    this.container.appendChild(this.panel);
    document.body.appendChild(this.container);

    this.jsonArea = this.panel.querySelector('#fg-json') as HTMLTextAreaElement;
    this.updateJsonArea();
  }

  private attachEvents(): void {
    // Previne que cliques no painel travem o PointerLock do jogo em 1ª Pessoa
    this.panel.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.panel.addEventListener('mousedown', (e) => e.stopPropagation());
    this.panel.addEventListener('click', (e) => e.stopPropagation());

    this.toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePanel();
    });

    const closeBtn = this.panel.querySelector('.forge-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closePanel();
      });
    }

    // Atalho de teclado 'T' para alternar o painel
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 't' || e.key === 'T') {
        this.togglePanel();
      }
    });

    // Mapeamento dos inputs
    const registerSlider = (id: string, key: keyof TextureControlsState, format: (v: number) => string) => {
      const input = this.panel.querySelector(`#${id}`) as HTMLInputElement;
      const label = this.panel.querySelector(`#${id}-v`) as HTMLElement;
      if (!input || !label) return;

      this.valueLabels.set(key, label);

      input.addEventListener('input', () => {
        const val = parseFloat(input.value);
        (this.state as any)[key] = val;
        label.textContent = format(val);
        this.updateJsonArea();
        this.scheduleApply();
      });
    };

    registerSlider('fg-pscale', 'pscale', (v) => v.toFixed(1));
    registerSlider('fg-grass', 'grass', (v) => (v >= 0 ? '+' : '') + v.toFixed(2));
    registerSlider('fg-edge', 'edge', (v) => v.toFixed(2));
    registerSlider('fg-tuft', 'tuft', (v) => v.toFixed(2));
    registerSlider('fg-cluster', 'clusterSize', (v) => Math.round(v).toString());
    registerSlider('fg-spill', 'spill', (v) => v.toFixed(2));
    registerSlider('fg-greens', 'greens', (v) => Math.round(v).toString());
    registerSlider('fg-dirt', 'dirt', (v) => v.toFixed(2));
    registerSlider('fg-rock', 'rock', (v) => v.toFixed(2));
    registerSlider('fg-massif', 'massif', (v) => v.toFixed(2));
    registerSlider('fg-polar', 'polar', (v) => v.toFixed(2));
    registerSlider('fg-hang', 'hang', (v) => v.toFixed(2));
    registerSlider('fg-density', 'density', (v) => v.toFixed(1) + ' tx/m');

    // Botão Copiar JSON
    const copyBtn = this.panel.querySelector('#fg-btn-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const json = this.getExportJsonString();
        navigator.clipboard.writeText(json).then(() => {
          const originalText = copyBtn.textContent;
          copyBtn.textContent = '✅ Copiado!';
          setTimeout(() => {
            copyBtn.textContent = originalText;
          }, 2000);
        }).catch(() => {
          this.jsonArea.select();
        });
      });
    }

    // Botão Baixar JSON
    const downloadBtn = this.panel.querySelector('#fg-btn-download');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        const json = this.getExportJsonString();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pixel-terrain-config-seed-${this.state.seed}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    // Botão Importar JSON
    const importBtn = this.panel.querySelector('#fg-btn-import');
    if (importBtn) {
      importBtn.addEventListener('click', () => {
        const input = prompt('Cole aqui o JSON de configuração das texturas:');
        if (!input) return;
        try {
          const parsed = JSON.parse(input);
          this.applyExternalConfig(parsed);
        } catch {
          alert('JSON inválido. Certifique-se de colar o formato correto.');
        }
      });
    }

    // Botão Resetar Padrões
    const resetBtn = this.panel.querySelector('#fg-btn-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        this.applyExternalConfig({
          ...DEFAULT_FORGE_PARAMS,
          density: DEFAULT_D,
        });
      });
    }
  }

  private scheduleApply(): void {
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.applyToWorld();
      this.debounceTimer = null;
    }, 120);
  }

  private applyToWorld(): void {
    const { density, ...forgeParams } = this.state;
    this.worldEngine.updateTextureForgeParams(forgeParams, density);
  }

  private getExportJsonString(): string {
    const exportable = {
      pscale: Number(this.state.pscale.toFixed(2)),
      grass: Number(this.state.grass.toFixed(2)),
      edge: Number(this.state.edge.toFixed(2)),
      tuft: Number(this.state.tuft.toFixed(2)),
      clusterSize: Math.round(this.state.clusterSize),
      spill: Number(this.state.spill.toFixed(2)),
      greens: Math.round(this.state.greens),
      dirt: Number(this.state.dirt.toFixed(2)),
      rock: Number(this.state.rock.toFixed(2)),
      massif: Number(this.state.massif.toFixed(2)),
      polar: Number(this.state.polar.toFixed(2)),
      hang: Number(this.state.hang.toFixed(2)),
      density: Number(this.state.density.toFixed(1)),
    };
    return JSON.stringify(exportable, null, 2);
  }

  private updateJsonArea(): void {
    if (this.jsonArea) {
      this.jsonArea.value = this.getExportJsonString();
    }
  }

  public applyExternalConfig(cfg: Partial<TextureControlsState>): void {
    if (cfg.pscale !== undefined) this.state.pscale = cfg.pscale;
    if (cfg.grass !== undefined) this.state.grass = cfg.grass;
    if (cfg.edge !== undefined) this.state.edge = cfg.edge;
    if (cfg.tuft !== undefined) this.state.tuft = cfg.tuft;
    if (cfg.clusterSize !== undefined) this.state.clusterSize = cfg.clusterSize;
    if (cfg.spill !== undefined) this.state.spill = cfg.spill;
    if (cfg.greens !== undefined) this.state.greens = cfg.greens;
    if (cfg.dirt !== undefined) this.state.dirt = cfg.dirt;
    if (cfg.rock !== undefined) this.state.rock = cfg.rock;
    if (cfg.massif !== undefined) this.state.massif = cfg.massif;
    if (cfg.polar !== undefined) this.state.polar = cfg.polar;
    if (cfg.hang !== undefined) this.state.hang = cfg.hang;
    if (cfg.density !== undefined) this.state.density = cfg.density;

    this.syncInputsFromState();
    this.updateJsonArea();
    this.applyToWorld();
  }

  private syncInputsFromState(): void {
    const updateInput = (id: string, val: number, format: (v: number) => string) => {
      const input = this.panel.querySelector(`#${id}`) as HTMLInputElement;
      const label = this.panel.querySelector(`#${id}-v`) as HTMLElement;
      if (input) input.value = val.toString();
      if (label) label.textContent = format(val);
    };

    updateInput('fg-pscale', this.state.pscale, (v) => v.toFixed(1));
    updateInput('fg-grass', this.state.grass, (v) => (v >= 0 ? '+' : '') + v.toFixed(2));
    updateInput('fg-edge', this.state.edge, (v) => v.toFixed(2));
    updateInput('fg-tuft', this.state.tuft, (v) => v.toFixed(2));
    updateInput('fg-cluster', this.state.clusterSize, (v) => Math.round(v).toString());
    updateInput('fg-spill', this.state.spill, (v) => v.toFixed(2));
    updateInput('fg-greens', this.state.greens, (v) => Math.round(v).toString());
    updateInput('fg-dirt', this.state.dirt, (v) => v.toFixed(2));
    updateInput('fg-rock', this.state.rock, (v) => v.toFixed(2));
    updateInput('fg-massif', this.state.massif, (v) => v.toFixed(2));
    updateInput('fg-polar', this.state.polar, (v) => v.toFixed(2));
    updateInput('fg-hang', this.state.hang, (v) => v.toFixed(2));
    updateInput('fg-density', this.state.density, (v) => v.toFixed(1) + ' tx/m');
  }

  public togglePanel(): void {
    if (this.isVisible) {
      this.closePanel();
    } else {
      this.openPanel();
    }
  }

  public openPanel(): void {
    this.isVisible = true;
    this.panel.classList.remove('hidden');
    this.toggleBtn.classList.add('active');
  }

  public closePanel(): void {
    this.isVisible = false;
    this.panel.classList.add('hidden');
    this.toggleBtn.classList.remove('active');
  }
}
