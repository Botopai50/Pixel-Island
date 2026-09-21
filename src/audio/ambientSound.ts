// Gerador procedural de áudio ambiental contemplativo (Vento suave e ondas do oceano)
export class AmbientSound {
  private ctx: AudioContext | null = null;
  private isPlaying: boolean = false;
  private masterGain: GainNode | null = null;
  private waveGain: GainNode | null = null;
  private windGain: GainNode | null = null;

  public toggle(): boolean {
    if (this.isPlaying) {
      this.stop();
      return false;
    } else {
      this.start();
      return true;
    }
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public start(): void {
    if (this.isPlaying) return;

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.35, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      // 1. Gerador de som de vento suave (Ruído Rosa com filtro passa-baixa modulado)
      this.createWindSynthesizer();

      // 2. Gerador de ondas suaves do oceano
      this.createOceanWaveSynthesizer();

      this.isPlaying = true;
    } catch {
      console.warn('Web Audio API não inicializada');
    }
  }

  public stop(): void {
    if (!this.isPlaying || !this.ctx) return;
    try {
      this.ctx.close();
    } catch {
      // Ignora
    }
    this.ctx = null;
    this.isPlaying = false;
  }

  private createWindSynthesizer(): void {
    if (!this.ctx || !this.masterGain) return;

    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      output[i] = (b0 + b1 + b2) * 0.12;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(320, this.ctx.currentTime);

    // Modulação lenta da frequência para rajadas de brisa
    const lfo = this.ctx.createOscillator();
    lfo.frequency.setValueAtTime(0.15, this.ctx.currentTime);
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.setValueAtTime(140, this.ctx.currentTime);

    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.setValueAtTime(0.4, this.ctx.currentTime);

    whiteNoise.connect(filter);
    filter.connect(this.windGain);
    this.windGain.connect(this.masterGain);

    whiteNoise.start();
    lfo.start();
  }

  private createOceanWaveSynthesizer(): void {
    if (!this.ctx || !this.masterGain) return;

    const bufferSize = this.ctx.sampleRate * 4;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * 0.1;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(180, this.ctx.currentTime);
    filter.Q.setValueAtTime(1.8, this.ctx.currentTime);

    // Modulação periódica que simula o ciclo de vai-e-vem das ondas
    const waveLfo = this.ctx.createOscillator();
    waveLfo.frequency.setValueAtTime(0.1, this.ctx.currentTime); // ~10 segundos por ciclo
    const waveLfoGain = this.ctx.createGain();
    waveLfoGain.gain.setValueAtTime(0.18, this.ctx.currentTime);

    this.waveGain = this.ctx.createGain();
    this.waveGain.gain.setValueAtTime(0.2, this.ctx.currentTime);

    waveLfo.connect(waveLfoGain);
    waveLfoGain.connect(this.waveGain.gain);

    source.connect(filter);
    filter.connect(this.waveGain);
    this.waveGain.connect(this.masterGain);

    source.start();
    waveLfo.start();
  }
}
