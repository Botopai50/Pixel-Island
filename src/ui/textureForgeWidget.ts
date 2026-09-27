import { WorldEngine } from '../generation/worldEngine.ts';
import { ForgeParams, DEFAULT_FORGE_PARAMS, DEFAULT_D } from '../generation/terrain/terrainTextureForge.ts';
import { CONFIG } from '../config.ts';

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
      <span class="forge-toggle-text">Texturas<span class="key-hint"> (T)</span></span>
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
              <label for="fg-grass">Quantidade de Grama (Temperado)</label>
              <b id="fg-grass-v">${(this.state.grass >= 0 ? '+' : '') + this.state.grass.toFixed(2)}</b>
            </div>
            <input id="fg-grass" type="range" min="-0.35" max="0.42" step="0.01" value="${this.state.grass}">
            <span class="forge-hint">Cada bioma tem seu próprio slider - subir este não afeta a neve</span>
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-grass-mountain">Quantidade de Grama (Vulcão)</label>
              <b id="fg-grass-mountain-v">${(this.state.grassMountain >= 0 ? '+' : '') + this.state.grassMountain.toFixed(2)}</b>
            </div>
            <input id="fg-grass-mountain" type="range" min="-0.35" max="0.42" step="0.01" value="${this.state.grassMountain}">
            <span class="forge-hint">Musgo/liquens no tálus alpino, independente do temperado</span>
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-grass-polar">Quantidade de Grama (Polar)</label>
              <b id="fg-grass-polar-v">${(this.state.grassPolar >= 0 ? '+' : '') + this.state.grassPolar.toFixed(2)}</b>
            </div>
            <input id="fg-grass-polar" type="range" min="-0.35" max="0.42" step="0.01" value="${this.state.grassPolar}">
            <span class="forge-hint">Tundra/musgo perto da neve - negativo preserva mais neve</span>
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
              <b id="fg-density-v">${this.state.density.toFixed(1)} tx/m (${Math.round(64 * this.state.density)}² px)</b>
            </div>
            <input id="fg-density" type="range" min="1.0" max="24.0" step="0.5" value="${this.state.density}">
            <span class="forge-hint">128px = 24 tx/un (HTML) | 512px = 8.0 tx/m (Padrão) | até 24.0 tx/m (1536² px)</span>
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-pixelscale">Escala Visual do Pixel (Shader)</label>
              <b id="fg-pixelscale-v">${(this.state.pixelScale || 1.0).toFixed(1)}x</b>
            </div>
            <input id="fg-pixelscale" type="range" min="0.5" max="4.0" step="0.1" value="${this.state.pixelScale || 1.0}">
            <span class="forge-hint">Subdivide e diminui o tamanho dos pixels no chão em tempo real (GPU)</span>
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-pixelation">Pixelização da cena (tecla P)</label>
              <input id="fg-pixelation" type="checkbox" ${CONFIG.PIXEL_SIZE > 1 ? 'checked' : ''}>
            </div>
            <span class="forge-hint">Desenha a cena em resolução menor e amplia sem suavizar (visual de diorama pixel-art; também deixa o jogo mais leve)</span>
          </div>
        </div>

        <!-- Grama 3D -->
        <div class="forge-group">
          <div class="forge-group-title">Grama 3D (Tufos)</div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-tuft-amount">Quantidade de Tufos</label>
              <b id="fg-tuft-amount-v">${this.state.tuftAmount.toFixed(2)}</b>
            </div>
            <input id="fg-tuft-amount" type="range" min="0.0" max="3.0" step="0.05" value="${this.state.tuftAmount}">
            <span class="forge-hint">0 = sem grama 3D. Na beirada das manchas nascem mais que no miolo</span>
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-tuft-clump">Concentração</label>
              <b id="fg-tuft-clump-v">${this.state.tuftClump.toFixed(2)}</b>
            </div>
            <input id="fg-tuft-clump" type="range" min="0.0" max="1.0" step="0.01" value="${this.state.tuftClump}">
            <span class="forge-hint">0 = espalhados por igual | 1 = moitas cheias com espaços vazios entre elas</span>
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-tuft-perm2">Tufos por m²</label>
              <b id="fg-tuft-perm2-v">${Math.round(this.state.tuftPerM2)}</b>
            </div>
            <input id="fg-tuft-perm2" type="range" min="1" max="6" step="1" value="${this.state.tuftPerM2}">
            <span class="forge-hint">Candidatos por metro quadrado (touceiras mais densas)</span>
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-tuft-size">Tamanho dos Tufos</label>
              <b id="fg-tuft-size-v">${this.state.tuftSize.toFixed(2)}x</b>
            </div>
            <input id="fg-tuft-size" type="range" min="0.4" max="2.5" step="0.05" value="${this.state.tuftSize}">
          </div>

          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-grass-billboard">Sempre de frente (1 plano)</label>
              <input id="fg-grass-billboard" type="checkbox" ${CONFIG.GRASS_BILLBOARD ? 'checked' : ''}>
            </div>
            <span class="forge-hint">Ligado: cada tufo é um plano que gira para a câmera | Desligado: dois planos cruzados</span>
          </div>
        </div>

        <!-- Personagem -->
        <div class="forge-group">
          <div class="forge-group-title">Personagem (1ª pessoa)</div>
          <div class="forge-row">
            <div class="forge-label-row">
              <label for="fg-player-scale">Altura do Personagem</label>
              <b id="fg-player-scale-v">${(CONFIG.PLAYER_SCALE * 1.75).toFixed(2)} m</b>
            </div>
            <input id="fg-player-scale" type="range" min="0.3" max="2.0" step="0.05" value="${CONFIG.PLAYER_SCALE}">
            <span class="forge-hint">Altura dos olhos; velocidade e passos acompanham a proporção</span>
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
            <button id="fg-btn-reset" class="forge-btn">🔄 Padrões</button>
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
        if (key === 'pixelScale') {
          this.worldEngine.updatePixelScale(val);
        } else {
          this.scheduleApply();
        }
      });
    };

    registerSlider('fg-pscale', 'pscale', (v) => v.toFixed(1));
    registerSlider('fg-grass', 'grass', (v) => (v >= 0 ? '+' : '') + v.toFixed(2));
    registerSlider('fg-grass-mountain', 'grassMountain', (v) => (v >= 0 ? '+' : '') + v.toFixed(2));
    registerSlider('fg-grass-polar', 'grassPolar', (v) => (v >= 0 ? '+' : '') + v.toFixed(2));
    registerSlider('fg-edge', 'edge', (v) => v.toFixed(2));
    registerSlider('fg-tuft', 'tuft', (v) => v.toFixed(2));
    registerSlider('fg-cluster', 'clusterSize', (v) => Math.round(v).toString());
    registerSlider('fg-spill', 'spill', (v) => v.toFixed(2));
    registerSlider('fg-greens', 'greens', (v) => Math.round(v).toString());
    registerSlider('fg-dirt', 'dirt', (v) => v.toFixed(2));
    registerSlider('fg-rock', 'rock', (v) => v.toFixed(2));
    registerSlider('fg-hang', 'hang', (v) => v.toFixed(2));
    registerSlider('fg-density', 'density', (v) => `${v.toFixed(1)} tx/m (${Math.round(64 * v)}² px)`);
    registerSlider('fg-pixelscale', 'pixelScale', (v) => `${v.toFixed(1)}x`);
    registerSlider('fg-tuft-amount', 'tuftAmount', (v) => v.toFixed(2));
    registerSlider('fg-tuft-clump', 'tuftClump', (v) => v.toFixed(2));
    registerSlider('fg-tuft-perm2', 'tuftPerM2', (v) => Math.round(v).toString());
    registerSlider('fg-tuft-size', 'tuftSize', (v) => `${v.toFixed(2)}x`);

    const playerScale = this.panel.querySelector('#fg-player-scale') as HTMLInputElement | null;
    const playerScaleLabel = this.panel.querySelector('#fg-player-scale-v') as HTMLElement | null;
    if (playerScale) {
      playerScale.addEventListener('input', () => {
        const v = parseFloat(playerScale.value);
        if (playerScaleLabel) playerScaleLabel.textContent = `${(v * 1.75).toFixed(2)} m`;
        window.dispatchEvent(new CustomEvent('player-scale-change', { detail: v }));
        this.updateJsonArea();
      });
    }

    const billboard = this.panel.querySelector('#fg-grass-billboard') as HTMLInputElement | null;
    if (billboard) {
      billboard.addEventListener('change', () => {
        window.dispatchEvent(new CustomEvent('grass-billboard-change', { detail: billboard.checked }));
        this.updateJsonArea();
      });
    }

    const pixelation = this.panel.querySelector('#fg-pixelation') as HTMLInputElement | null;
    if (pixelation) {
      pixelation.addEventListener('change', () => {
        window.dispatchEvent(new CustomEvent('pixelation-change', { detail: pixelation.checked }));
        this.updateJsonArea();
      });
      // Mantém o checkbox (e o JSON) em sincronia quando a tecla P alterna
      window.addEventListener('pixelation-changed', (e) => {
        pixelation.checked = (e as CustomEvent<boolean>).detail;
        this.updateJsonArea();
      });
    }

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
          pixelation: false,
          grassBillboard: true,
          playerHeight: 1.75,
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
      grassMountain: Number(this.state.grassMountain.toFixed(2)),
      grassPolar: Number(this.state.grassPolar.toFixed(2)),
      edge: Number(this.state.edge.toFixed(2)),
      tuft: Number(this.state.tuft.toFixed(2)),
      clusterSize: Math.round(this.state.clusterSize),
      spill: Number(this.state.spill.toFixed(2)),
      greens: Math.round(this.state.greens),
      dirt: Number(this.state.dirt.toFixed(2)),
      rock: Number(this.state.rock.toFixed(2)),
      hang: Number(this.state.hang.toFixed(2)),
      density: Number(this.state.density.toFixed(1)),
      pixelScale: Number((this.state.pixelScale || 1.0).toFixed(1)),
      pixelation: CONFIG.PIXEL_SIZE > 1,
      tuftAmount: Number(this.state.tuftAmount.toFixed(2)),
      tuftClump: Number(this.state.tuftClump.toFixed(2)),
      tuftPerM2: Math.round(this.state.tuftPerM2),
      tuftSize: Number(this.state.tuftSize.toFixed(2)),
      grassBillboard: CONFIG.GRASS_BILLBOARD,
      playerHeight: Number((CONFIG.PLAYER_SCALE * 1.75).toFixed(2)),
    };
    return JSON.stringify(exportable, null, 2);
  }

  private updateJsonArea(): void {
    if (this.jsonArea) {
      this.jsonArea.value = this.getExportJsonString();
    }
  }

  public applyExternalConfig(cfg: Partial<TextureControlsState> & { pixelation?: boolean; playerHeight?: number; grassBillboard?: boolean }): void {
    if (cfg.pscale !== undefined) this.state.pscale = cfg.pscale;
    if (cfg.grass !== undefined) this.state.grass = cfg.grass;
    if (cfg.grassMountain !== undefined) this.state.grassMountain = cfg.grassMountain;
    if (cfg.grassPolar !== undefined) this.state.grassPolar = cfg.grassPolar;
    if (cfg.edge !== undefined) this.state.edge = cfg.edge;
    if (cfg.tuft !== undefined) this.state.tuft = cfg.tuft;
    if (cfg.clusterSize !== undefined) this.state.clusterSize = cfg.clusterSize;
    if (cfg.spill !== undefined) this.state.spill = cfg.spill;
    if (cfg.greens !== undefined) this.state.greens = cfg.greens;
    if (cfg.dirt !== undefined) this.state.dirt = cfg.dirt;
    if (cfg.rock !== undefined) this.state.rock = cfg.rock;
    if (cfg.hang !== undefined) this.state.hang = cfg.hang;
    if (cfg.density !== undefined) this.state.density = cfg.density;
    if (cfg.pixelScale !== undefined) this.state.pixelScale = cfg.pixelScale;
    if (cfg.tuftAmount !== undefined) this.state.tuftAmount = cfg.tuftAmount;
    if (cfg.tuftClump !== undefined) this.state.tuftClump = cfg.tuftClump;
    if (cfg.tuftPerM2 !== undefined) this.state.tuftPerM2 = cfg.tuftPerM2;
    if (cfg.tuftSize !== undefined) this.state.tuftSize = cfg.tuftSize;
    // Opções fora das texturas: aplicadas pelos mesmos eventos que os controles do painel usam
    if (cfg.pixelation !== undefined && cfg.pixelation !== (CONFIG.PIXEL_SIZE > 1)) {
      window.dispatchEvent(new CustomEvent('pixelation-change', { detail: !!cfg.pixelation }));
    }
    if (cfg.grassBillboard !== undefined) {
      window.dispatchEvent(new CustomEvent('grass-billboard-change', { detail: !!cfg.grassBillboard }));
    }
    if (cfg.playerHeight !== undefined && cfg.playerHeight > 0) {
      window.dispatchEvent(new CustomEvent('player-scale-change', { detail: cfg.playerHeight / 1.75 }));
    }

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
    updateInput('fg-grass-mountain', this.state.grassMountain, (v) => (v >= 0 ? '+' : '') + v.toFixed(2));
    updateInput('fg-grass-polar', this.state.grassPolar, (v) => (v >= 0 ? '+' : '') + v.toFixed(2));
    updateInput('fg-edge', this.state.edge, (v) => v.toFixed(2));
    updateInput('fg-tuft', this.state.tuft, (v) => v.toFixed(2));
    updateInput('fg-cluster', this.state.clusterSize, (v) => Math.round(v).toString());
    updateInput('fg-spill', this.state.spill, (v) => v.toFixed(2));
    updateInput('fg-greens', this.state.greens, (v) => Math.round(v).toString());
    updateInput('fg-dirt', this.state.dirt, (v) => v.toFixed(2));
    updateInput('fg-rock', this.state.rock, (v) => v.toFixed(2));
    updateInput('fg-hang', this.state.hang, (v) => v.toFixed(2));
    updateInput('fg-density', this.state.density, (v) => `${v.toFixed(1)} tx/m (${Math.round(64 * v)}² px)`);
    updateInput('fg-pixelscale', this.state.pixelScale || 1.0, (v) => `${v.toFixed(1)}x`);
    updateInput('fg-tuft-amount', this.state.tuftAmount, (v) => v.toFixed(2));
    updateInput('fg-tuft-clump', this.state.tuftClump, (v) => v.toFixed(2));
    updateInput('fg-tuft-perm2', this.state.tuftPerM2, (v) => Math.round(v).toString());
    updateInput('fg-tuft-size', this.state.tuftSize, (v) => `${v.toFixed(2)}x`);
    updateInput('fg-player-scale', CONFIG.PLAYER_SCALE, (v) => `${(v * 1.75).toFixed(2)} m`);
    const pixelation = this.panel.querySelector('#fg-pixelation') as HTMLInputElement | null;
    if (pixelation) pixelation.checked = CONFIG.PIXEL_SIZE > 1;
    const billboard = this.panel.querySelector('#fg-grass-billboard') as HTMLInputElement | null;
    if (billboard) billboard.checked = CONFIG.GRASS_BILLBOARD;
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
