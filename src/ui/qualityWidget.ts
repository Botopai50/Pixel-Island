import { QUALITY_LEVELS, type AdaptiveQuality, loadQualityPref } from '../quality.ts';

/**
 * Menu de qualidade gráfica dentro do jogo (botão ⚙ no canto inferior esquerdo): "Automática" deixa o jogo subir e descer de nível
 * pelo FPS; qualquer outro item fixa o nível. A escolha fica salva no navegador.
 */
export class QualityWidget {
  private readonly button: HTMLButtonElement;
  private readonly panel: HTMLDivElement;
  private readonly select: HTMLSelectElement;
  private readonly info: HTMLDivElement;

  constructor(private readonly quality: AdaptiveQuality) {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.textContent = '⚙ Qualidade';
    this.button.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:41;background:rgba(0,0,0,.55);color:#fff;font:12px monospace;padding:4px 8px;border:0;border-radius:6px;cursor:pointer';
    this.panel = document.createElement('div');
    this.panel.style.cssText = 'position:fixed;left:10px;bottom:40px;z-index:41;display:none;background:rgba(0,0,0,.8);color:#fff;font:12px/1.4 monospace;padding:8px 10px;border-radius:6px;min-width:220px';
    const label = document.createElement('div');
    label.textContent = 'Qualidade gráfica';
    label.style.marginBottom = '4px';
    this.select = document.createElement('select');
    this.select.style.cssText = 'width:100%;font:12px monospace;background:#222;color:#fff;border:1px solid #555;border-radius:4px;padding:2px';
    const opt = (value: string, text: string) => { const o = document.createElement('option'); o.value = value; o.textContent = text; this.select.appendChild(o); };
    opt('auto', 'Automática (pelo FPS)');
    QUALITY_LEVELS.forEach((l, i) => opt(String(i), l.name[0].toUpperCase() + l.name.slice(1)));
    this.info = document.createElement('div');
    this.info.style.cssText = 'margin-top:6px;opacity:.75;white-space:pre-wrap';
    this.panel.append(label, this.select, this.info);
    document.body.append(this.button, this.panel);

    const pref = loadQualityPref();
    this.select.value = pref === 'auto' ? 'auto' : String(pref);
    this.button.addEventListener('click', () => { this.panel.style.display = this.panel.style.display === 'none' ? 'block' : 'none'; this.refresh(); });
    this.select.addEventListener('change', () => {
      this.quality.choose(this.select.value === 'auto' ? 'auto' : Number(this.select.value));
      this.refresh();
    });
    // (os cliques no menu não podem virar clique no mundo, e as teclas digitadas nele não andam o personagem)
    for (const el of [this.button, this.panel]) {
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
      el.addEventListener('keydown', (e) => e.stopPropagation());
    }
    this.refresh();
    setInterval(() => { if (this.panel.style.display !== 'none') this.refresh(); }, 1000);
  }

  private refresh(): void {
    const l = QUALITY_LEVELS[this.quality.level];
    this.info.textContent = `Agora: ${l.name}${this.quality.auto ? ' (automática)' : ' (fixa)'}
Sombras ${l.shadowMapSize}px, alcance ${l.maxViewRadius} chunks,
vegetação ${l.vegetationRadius} chunks`;
  }
}
