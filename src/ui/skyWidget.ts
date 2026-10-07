import { SkyAtmosphere, TIME_PRESETS } from '../atmosphere/skyAtmosphere.ts';
import type { WeatherKind } from '../atmosphere/biomeAmbience.ts';

/**
 * HUD de horário e clima (tecla H): ciclo de dia e noite automático ou um preset fixo do céu
 * (amanhecer, meio-dia, pôr do sol, crepúsculo, noite) e o clima (automático pelo bioma, limpo, nublado, encoberto, chuva, tempestade,
 * neve, neblina).
 */
const TIMES: { key: keyof typeof TIME_PRESETS; label: string; icon: string }[] = [
  { key: 'DAWN', label: 'Amanhecer', icon: '🌅' },
  { key: 'NOON', label: 'Meio-dia', icon: '☀️' },
  { key: 'GOLDEN_HOUR', label: 'Pôr do sol', icon: '🌇' },
  { key: 'TWILIGHT', label: 'Crepúsculo', icon: '🌆' },
  { key: 'NIGHT', label: 'Noite', icon: '🌙' },
];

/** cobertura de nuvens (null = automático pelo bioma) e o quanto o céu fica cinza */
const WEATHER: { kind: WeatherKind; label: string; icon: string; cov: number | null; grey: number }[] = [
  { kind: 'auto', label: 'Automático', icon: '🧭', cov: null, grey: 0 },
  { kind: 'clear', label: 'Limpo', icon: '🔆', cov: 0.08, grey: 0 },
  { kind: 'cloudy', label: 'Nublado', icon: '⛅', cov: 0.72, grey: 0.12 },
  { kind: 'overcast', label: 'Encoberto', icon: '☁️', cov: 1.0, grey: 0.45 },
  { kind: 'rain', label: 'Chuva', icon: '🌧️', cov: 1.0, grey: 0.55 },
  { kind: 'storm', label: 'Tempestade', icon: '⛈️', cov: 1.0, grey: 0.8 },
  { kind: 'snow', label: 'Neve', icon: '🌨️', cov: 1.0, grey: 0.5 },
  { kind: 'fog', label: 'Neblina', icon: '🌫️', cov: 0.9, grey: 0.45 },
];

export class SkyWidget {
  private container: HTMLDivElement;
  private panel: HTMLDivElement;
  private toggleBtn: HTMLButtonElement;
  private timeBtns: HTMLButtonElement[] = [];
  private weatherBtns: HTMLButtonElement[] = [];

  /** onTimeChange: o sol mudou de lugar (refazer as sombras) */
  constructor(private atmosphere: SkyAtmosphere, private onTimeChange: () => void = () => {},
    private onWeather: (kind: WeatherKind) => void = () => {}) {
    this.container = document.createElement('div');
    this.container.className = 'sky-widget-container';

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.className = 'forge-toggle-btn';
    this.toggleBtn.innerHTML = `<span class="forge-toggle-icon">🌤️</span><span class="forge-toggle-text">Céu<span class="key-hint"> (H)</span></span>`;
    this.toggleBtn.title = 'Horário e clima (Tecla H)';
    this.toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggle(); });

    this.panel = document.createElement('div');
    this.panel.className = 'forge-panel sky-panel hidden';
    this.panel.innerHTML = `
      <div class="forge-header">
        <div class="forge-title-wrap">
          <span class="forge-title-icon">🌤️</span>
          <div><h3 class="forge-title">Horário e clima</h3><span class="forge-subtitle">Muda o céu, a luz e as nuvens</span></div>
        </div>
        <button class="forge-close-btn" title="Fechar (H)">✕</button>
      </div>
      <div class="forge-content">
        <div class="forge-group"><div class="forge-group-title">Horário</div><div class="sky-btn-grid" data-g="time"></div></div>
        <div class="forge-group"><div class="forge-group-title">Clima</div><div class="sky-btn-grid" data-g="weather"></div></div>
      </div>`;
    this.panel.querySelector('.forge-close-btn')!.addEventListener('click', () => this.toggle(false));

    const timeGrid = this.panel.querySelector('[data-g="time"]')!;
    for (const t of TIMES) {
      const b = this.makeBtn(t.icon, t.label);
      b.addEventListener('click', () => {
        this.atmosphere.setFixedTime(t.key);
        this.onTimeChange();
        this.mark(this.timeBtns, b);
      });
      timeGrid.appendChild(b);
      this.timeBtns.push(b);
    }
    // ciclo de dia e noite (continua a partir do horário atual)
    const autoBtn = this.makeBtn('🕒', 'Automático');
    autoBtn.addEventListener('click', () => {
      this.atmosphere.setAutoTime(true);
      this.mark(this.timeBtns, autoBtn);
    });
    timeGrid.insertBefore(autoBtn, timeGrid.firstChild);
    this.timeBtns.unshift(autoBtn);
    const weatherGrid = this.panel.querySelector('[data-g="weather"]')!;
    for (const w of WEATHER) {
      const b = this.makeBtn(w.icon, w.label);
      b.addEventListener('click', () => {
        this.atmosphere.getSkybox().setCloudOverride(w.cov, w.grey);
        this.onWeather(w.kind);
        this.mark(this.weatherBtns, b);
      });
      weatherGrid.appendChild(b);
      this.weatherBtns.push(b);
    }
    this.mark(this.timeBtns, this.timeBtns[2]);
    this.mark(this.weatherBtns, this.weatherBtns[0]);

    // não deixa o clique no painel virar arrasto/clique no mundo
    for (const ev of ['pointerdown', 'mousedown', 'touchstart', 'wheel']) {
      this.panel.addEventListener(ev, (e) => e.stopPropagation());
    }

    // relógio do jogo (hora do céu), sempre à vista ao lado do botão
    const clock = document.createElement('div');
    clock.className = 'sky-clock';
    clock.title = 'Hora do jogo';
    const tickClock = () => {
      const h = this.atmosphere.hour;
      const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
      const icon = h >= 6 && h < 18 ? '☀️' : '🌙';
      clock.textContent = `${icon} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    };
    tickClock();
    window.setInterval(tickClock, 250);

    this.container.appendChild(this.toggleBtn);
    this.container.appendChild(clock);
    this.container.appendChild(this.panel);
    document.body.appendChild(this.container);

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'h' || e.key === 'H') this.toggle();
    });
  }

  private makeBtn(icon: string, label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'sky-btn';
    b.innerHTML = `<span class="sky-btn-icon">${icon}</span><span>${label}</span>`;
    return b;
  }

  private mark(list: HTMLButtonElement[], active: HTMLButtonElement): void {
    for (const b of list) b.classList.toggle('active', b === active);
  }

  private toggle(open?: boolean): void {
    const show = open ?? this.panel.classList.contains('hidden');
    this.panel.classList.toggle('hidden', !show);
    this.toggleBtn.classList.toggle('active', show);
  }
}
