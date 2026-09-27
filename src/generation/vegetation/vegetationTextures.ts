import * as THREE from 'three';
import { buildGrassTuftPixels, GRASS_TUFT_SHAPES, GRASS_SPRITE_W, GRASS_SPRITE_H } from './grassSprites.ts';

/**
 * Utilitário para geração de texturas procedurais estilizadas em Pixel Art
 * via HTML5 Canvas com filtragem THREE.NearestFilter (sem interpolação linear / sem blur),
 * garantindo que todas as texturas mantenham um aspecto pixelado autêntico.
 */
export class VegetationTextures {
  private static barkTex: THREE.CanvasTexture | null = null;
  private static birchBarkTex: THREE.CanvasTexture | null = null;
  private static palmBarkTex: THREE.CanvasTexture | null = null;
  private static foliageTex: THREE.CanvasTexture | null = null;
  private static palmFrondTex: THREE.CanvasTexture | null = null;
  private static cactusTex: THREE.CanvasTexture | null = null;
  private static snowFoliageTex: THREE.CanvasTexture | null = null;
  private static burntWoodTex: THREE.CanvasTexture | null = null;
  private static rockTex: THREE.CanvasTexture | null = null;
  private static weatheredWoodTex: THREE.CanvasTexture | null = null;

  /**
   * Pixel nítido de perto (magFilter Nearest) e mipmap de longe, para a textura não cintilar
   * quando cada pixel da tela cobre vários texels.
   */
  private static createPixelTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestMipmapLinearFilter;
    tex.generateMipmaps = true;
    return tex;
  }

  // =========================================================================
  // 1. CASCA AMADEIRADA PADRÃO (Carvalho, Pinheiro, Acácia, Mangue)
  // =========================================================================
  public static getBarkTexture(): THREE.CanvasTexture {
    if (this.barkTex) return this.barkTex;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Fundo base amadeirado quente e nobre (tons de carvalho e nogueira)
    ctx.fillStyle = '#6e4426';
    ctx.fillRect(0, 0, 256, 256);

    // Fibras e anéis de crescimento verticais com variação orgânica
    for (let x = 0; x < 256; x += 4) {
      const grain = Math.sin(x * 0.09) * 14 + Math.cos(x * 0.22) * 9 + Math.sin(x * 0.48) * 4;
      const r = Math.min(255, Math.max(0, 118 + grain));
      const g = Math.min(255, Math.max(0, 78 + grain * 0.72));
      const b = Math.min(255, Math.max(0, 48 + grain * 0.52));
      ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
      ctx.fillRect(x, 0, 4, 256);
    }

    // Fissuras verticais de casca madura com relevo e sombra quente (sem pretos artificiais)
    for (let i = 0; i < 65; i++) {
      const gx = ((i * 37) % 62) * 4;
      const gy = ((i * 47) % 54) * 4;
      const gw = 4 + ((i % 3) * 4);
      const gh = 24 + ((i % 7) * 4);
      // Fissura profunda em castanho escuro aquecido
      ctx.fillStyle = '#3a2012';
      ctx.fillRect(gx, gy, gw, gh);
      // Realce de luz dourada na borda da fenda
      ctx.fillStyle = '#b27c4c';
      ctx.fillRect(gx + gw, gy, 4, gh - 4);
      // Dithering sutil nas pontas
      ctx.fillStyle = '#54321c';
      ctx.fillRect(gx, gy - 4, gw, 4);
      ctx.fillRect(gx, gy + gh, gw, 4);
    }

    return (this.barkTex = this.createPixelTexture(canvas));
  }

  // =========================================================================
  // 2. CASCA DE BÉTULA BRANCA COM LENTICELAS
  // =========================================================================
  public static getBirchBarkTexture(): THREE.CanvasTexture {
    if (this.birchBarkTex) return this.birchBarkTex;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Fundo branco-creme perolado com dithering sutil
    ctx.fillStyle = '#f2efe6';
    ctx.fillRect(0, 0, 256, 256);

    for (let x = 0; x < 256; x += 4) {
      for (let y = 0; y < 256; y += 4) {
        if (((x + y) / 4) % 2 === 0 && Math.sin(x * 0.08) > 0.3) {
          ctx.fillStyle = '#e6e2d4';
          ctx.fillRect(x, y, 4, 4);
        }
      }
    }

    // Manchas pixeladas de líquen âmbar/cinza
    for (let i = 0; i < 25; i++) {
      const lx = ((i * 51) % 58) * 4;
      const ly = ((i * 67) % 58) * 4;
      ctx.fillStyle = '#c6b492';
      ctx.fillRect(lx, ly, 12, 8);
      ctx.fillRect(lx + 4, ly - 4, 8, 16);
    }

    // Lenticelas pretas horizontais em pixel art nítido
    ctx.fillStyle = '#1e1c18';
    for (let i = 0; i < 65; i++) {
      const x = ((i * 47) % 54) * 4;
      const y = ((i * 29) % 62) * 4;
      const w = 12 + ((i % 6) * 4);
      ctx.fillRect(x, y, w, 4);
      // Dithering nas pontas da lenticela
      ctx.fillStyle = '#4a443c';
      ctx.fillRect(x - 4, y, 4, 4);
      ctx.fillRect(x + w, y, 4, 4);
      ctx.fillStyle = '#1e1c18';
    }

    return (this.birchBarkTex = this.createPixelTexture(canvas));
  }

  // =========================================================================
  // 3. CASCA DE PALMEIRA / COQUEIRO COM ANÉIS HORIZONTAIS
  // =========================================================================
  public static getPalmBarkTexture(): THREE.CanvasTexture {
    if (this.palmBarkTex) return this.palmBarkTex;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Fundo marrom dourado
    ctx.fillStyle = '#7a5a3a';
    ctx.fillRect(0, 0, 256, 256);

    // Fibras verticais pixeladas
    for (let x = 0; x < 256; x += 4) {
      if ((x / 4) % 2 === 0) {
        ctx.fillStyle = '#6e5032';
        ctx.fillRect(x, 0, 4, 256);
      }
    }

    // Anéis cicatriciais horizontais com relevo em pixel art
    for (let y = 0; y < 256; y += 24) {
      // Sombra inferior escura do anel
      ctx.fillStyle = '#3c2414';
      ctx.fillRect(0, y, 256, 6);
      // Crista iluminada superior do anel
      ctx.fillStyle = '#ab8558';
      ctx.fillRect(0, y + 6, 256, 6);
      // Fibras cruzadas nos anéis
      ctx.fillStyle = '#2b1a0e';
      for (let x = 0; x < 256; x += 16) {
        ctx.fillRect(x + (y % 8), y, 4, 24);
      }
    }

    return (this.palmBarkTex = this.createPixelTexture(canvas));
  }

  // =========================================================================
  // 4. FOLHAGEM PIXEL ART (Árvores, Bordos, Arbustos e Bagas)
  // =========================================================================
  // 4. FOLHAGEM CEL-SHADED ESTILIZADA (Studio Ghibli / The Wind Waker)
  // =========================================================================
  public static getFoliageTexture(): THREE.CanvasTexture {
    if (this.foliageTex) return this.foliageTex;
    // Copa em pixel art de diorama: grupinhos de folhas com lado de cima iluminado, lado de baixo
    // em sombra e contorno quase preto nos vãos. Tons claros e neutros: a cor de cada espécie vem
    // do tint da instância (multiplicado), então aqui só vai a luz e a forma.
    const W = 64, H = 64;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(W, H);

    const TONES: [number, number, number][] = [
      [22, 30, 28],    // 0 contorno / vão
      [78, 104, 86],   // 1 sombra
      [140, 168, 136], // 2 médio
      [196, 222, 170], // 3 claro
      [244, 255, 196], // 4 brilho
    ];
    const buf = new Uint8Array(W * H); // começa tudo como vão (0)
    let s = 58219;
    const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
    const setPx = (x: number, y: number, v: number) => { buf[((y % H) + H) % H * W + (((x % W) + W) % W)] = v; };

    // Grupinhos de folhas (elipses pequenas), desenhados de cima para baixo: os de baixo cobrem a
    // base dos de cima, então cada grupinho mostra o topo claro e a borda de baixo em sombra.
    const clumps: { x: number; y: number; r: number }[] = [];
    for (let k = 0; k < 150; k++) clumps.push({ x: rnd() * W, y: rnd() * H, r: 2.2 + rnd() * 2.6 });
    clumps.sort((p, q) => p.y - q.y);
    for (const cl of clumps) {
      const R = Math.ceil(cl.r) + 1;
      for (let oy = -R; oy <= R; oy++) {
        for (let ox = -R; ox <= R; ox++) {
          const d = Math.hypot(ox, oy * 1.15);
          if (d > cl.r) continue;
          const x = Math.round(cl.x + ox), y = Math.round(cl.y + oy);
          let v = 2;
          const edge = cl.r - d;
          if (edge < 1.0 && oy >= 0) v = 1;                 // borda de baixo: sombra
          else if (oy < -cl.r * 0.35 && ox < cl.r * 0.4) v = 3; // topo à esquerda: luz
          if (v === 3 && ox < 0 && oy < -cl.r * 0.55 && rnd() > 0.55) v = 4;
          setPx(x, y, v);
        }
      }
    }
    // Contorno: vão (0) só onde encosta em folha - o resto dos vãos vira sombra funda
    const out = new Uint8Array(buf);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (buf[i] !== 0) continue;
      let near = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (buf[((y + dy + H) % H) * W + ((x + dx + W) % W)] > 0) near = true;
      out[i] = near ? 0 : 1;
    }
    for (let i = 0; i < W * H; i++) {
      const t = TONES[out[i]];
      img.data[i * 4] = t[0]; img.data[i * 4 + 1] = t[1]; img.data[i * 4 + 2] = t[2]; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return (this.foliageTex = this.createPixelTexture(canvas));
  }

  /**
   * Tufos de grama 3D em pixel art (fundo transparente, recortado por alphaTest), desenhados em
   * grassSprites.ts: os 5 formatos (moita, alta, rasteira, espiga, tombada) nas paletas verde
   * (a mesma da grama pintada no chão), nevada e seca.
   */
  private static grassSets: Record<string, THREE.CanvasTexture[]> = {};
  public static getGrassVariantTextures(kind: 'green' | 'snow' | 'dry'): THREE.CanvasTexture[] {
    if (this.grassSets[kind]) return this.grassSets[kind];
    const TONES: Record<string, number[][]> = {
      green: [[32, 56, 64], [48, 112, 64], [72, 140, 90], [90, 186, 50], [160, 194, 72], [206, 222, 110]],
      snow: [[104, 116, 146], [140, 156, 184], [172, 188, 212], [206, 218, 236], [230, 238, 248], [255, 255, 255]],
      dry: [[52, 38, 30], [84, 62, 44], [112, 86, 58], [158, 124, 78], [194, 160, 104], [222, 194, 138]],
    };
    const seeds: Record<string, number> = { green: 7919, snow: 4217, dry: 3301 };
    return (this.grassSets[kind] = GRASS_TUFT_SHAPES.map((shape, i) => {
      const canvas = document.createElement('canvas');
      canvas.width = GRASS_SPRITE_W; canvas.height = GRASS_SPRITE_H;
      const ctx = canvas.getContext('2d')!;
      const img = ctx.createImageData(GRASS_SPRITE_W, GRASS_SPRITE_H);
      img.data.set(buildGrassTuftPixels(TONES[kind], kind === 'snow', seeds[kind] + i * 131, shape));
      ctx.putImageData(img, 0, 0);
      return this.finishGrassTexture(canvas);
    }));
  }

  private static finishGrassTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
    const tex = this.createPixelTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.NearestFilter; // mipmap misturaria o recorte transparente
    tex.generateMipmaps = false;
    tex.colorSpace = THREE.SRGBColorSpace; // cores exatas da paleta do chão
    return tex;
  }

  // =========================================================================
  // 4B. TEXTURA DE ARBUSTO COM BAGAS (Berry Bush)
  // =========================================================================
  private static berryBushTex: THREE.CanvasTexture | null = null;
  public static getBerryBushTexture(): THREE.CanvasTexture {
    if (this.berryBushTex) return this.berryBushTex;
    const foliage = this.getFoliageTexture();
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(foliage.image as CanvasImageSource, 0, 0, 512, 512);

    // Quadrante reservado para bagas carmesim (X >= 416, Y >= 416)
    ctx.fillStyle = '#1c4a11';
    ctx.fillRect(416, 416, 96, 96);
    const berryCoords = [
      { x: 432, y: 432, r: 12 },
      { x: 472, y: 440, r: 14 },
      { x: 444, y: 472, r: 14 },
      { x: 484, y: 480, r: 10 }
    ];
    for (const b of berryCoords) {
      ctx.fillStyle = '#5c0214';
      ctx.fillRect(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      ctx.fillStyle = '#e81442';
      ctx.fillRect(b.x - b.r + 3, b.y - b.r + 3, b.r * 2 - 6, b.r * 2 - 6);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(b.x - b.r + 3, b.y - b.r + 3, 3, 3);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return (this.berryBushTex = tex);
  }

  // =========================================================================
  // 5. FRONDE DE PALMEIRA / COQUEIRO
  // =========================================================================
  public static getPalmFrondTexture(): THREE.CanvasTexture {
    if (this.palmFrondTex) return this.palmFrondTex;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Fundo verde tropical
    ctx.fillStyle = '#4a9c24';
    ctx.fillRect(0, 0, 256, 256);

    // Raque central (haste central verde clara)
    ctx.fillStyle = '#8ce034';
    ctx.fillRect(124, 0, 8, 256);

    // Nervuras finas transversais dos folíolos em pixel art
    for (let y = 0; y < 256; y += 8) {
      ctx.fillStyle = '#1c4e12';
      ctx.fillRect(0, y, 256, 2);
      ctx.fillStyle = '#6ec42c';
      ctx.fillRect(0, y + 2, 256, 2);
    }

    return (this.palmFrondTex = this.createPixelTexture(canvas));
  }

  // =========================================================================
  // 6. CACTO SAGUARO
  // =========================================================================
  public static getCactusTexture(): THREE.CanvasTexture {
    if (this.cactusTex) return this.cactusTex;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Verde desértico
    ctx.fillStyle = '#407a38';
    ctx.fillRect(0, 0, 256, 256);

    // Costelas e sulcos verticais em pixel art
    for (let x = 0; x < 256; x += 32) {
      // Sulco profundo
      ctx.fillStyle = '#22501c';
      ctx.fillRect(x, 0, 10, 256);
      // Crista iluminada
      ctx.fillStyle = '#64b256';
      ctx.fillRect(x + 10, 0, 12, 256);

      // Aréolas de espinhos dourados em pixel art
      for (let y = 12; y < 256; y += 24) {
        ctx.fillStyle = '#fff0a8';
        ctx.fillRect(x + 14, y, 4, 4);
        ctx.fillStyle = '#b89446';
        ctx.fillRect(x + 12, y + 1, 2, 2);
        ctx.fillRect(x + 18, y + 1, 2, 2);
      }
    }

    return (this.cactusTex = this.createPixelTexture(canvas));
  }

  // =========================================================================
  // 7. FOLHAGEM NEVADA DE PINHEIRO GLACIAL
  // =========================================================================
  public static getSnowFoliageTexture(): THREE.CanvasTexture {
    if (this.snowFoliageTex) return this.snowFoliageTex;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Gradiente vertical de neve pura para verde conífero gélido
    ctx.fillStyle = '#224a38';
    ctx.fillRect(0, 0, 256, 256);

    // Manto superior de neve em pixel art
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 90);

    // Dithering na transição da neve para as agulhas
    const pSize = 4;
    for (let x = 0; x < 256; x += pSize) {
      for (let y = 90; y < 140; y += pSize) {
        const prob = 1.0 - ((y - 90) / 50);
        if (Math.random() < prob) {
          ctx.fillStyle = '#e8f4fc';
          ctx.fillRect(x, y, pSize, pSize);
        }
      }
    }

    // Cristais de gelo pontilhados
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    for (let i = 0; i < 80; i++) {
      const x = ((i * 37) % 62) * 4;
      const y = ((i * 59) % 62) * 4;
      ctx.fillRect(x, y, 4, 4);
    }

    return (this.snowFoliageTex = this.createPixelTexture(canvas));
  }

  // =========================================================================
  // 8. TRONCO QUEIMADO VULCÂNICO COM BRASAS
  // =========================================================================
  public static getBurntWoodTexture(): THREE.CanvasTexture {
    if (this.burntWoodTex) return this.burntWoodTex;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Carvão vegetal preto-grafite
    ctx.fillStyle = '#141414';
    ctx.fillRect(0, 0, 256, 256);

    // Fissuras craqueladas de carvão
    for (let x = 0; x < 256; x += 16) {
      for (let y = 0; y < 256; y += 16) {
        ctx.strokeStyle = '#060606';
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, 16, 16);
      }
    }

    // Brasas alaranjadas incandescentes em pixel art
    ctx.fillStyle = '#ff4800';
    for (let i = 0; i < 30; i++) {
      const bx = ((i * 43) % 60) * 4;
      const by = ((i * 61) % 60) * 4;
      ctx.fillRect(bx, by, 4, 12);
      ctx.fillStyle = '#ffb020';
      ctx.fillRect(bx + 1, by + 2, 2, 8);
      ctx.fillStyle = '#ff4800';
    }

    return (this.burntWoodTex = this.createPixelTexture(canvas));
  }

  // =========================================================================
  // 9. ROCHA GRANÍTICA COM MUSGO FLORESTAL
  // =========================================================================
  public static getRockTexture(): THREE.CanvasTexture {
    if (this.rockTex) return this.rockTex;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Base cinza granito neutro
    ctx.fillStyle = '#7a8088';
    ctx.fillRect(0, 0, 256, 256);

    // Granulação mineral pixelada em blocos de 4px
    for (let x = 0; x < 256; x += 4) {
      for (let y = 0; y < 256; y += 4) {
        const n = Math.sin(x * 0.15) * Math.cos(y * 0.15) + Math.sin((x + y) * 0.2) * 0.5;
        if (n > 0.35) {
          ctx.fillStyle = '#9aa0a8';
          ctx.fillRect(x, y, 4, 4);
        } else if (n < -0.35) {
          ctx.fillStyle = '#5c6066';
          ctx.fillRect(x, y, 4, 4);
        }
      }
    }

    // Grânulos de quartzo brancos e feldspato escuro
    for (let i = 0; i < 200; i++) {
      const x = ((i * 47) % 64) * 4;
      const y = ((i * 71) % 64) * 4;
      ctx.fillStyle = (i % 2 === 0) ? '#d8dce2' : '#383a3e';
      ctx.fillRect(x, y, 4, 4);
    }

    // Quadrante reservado para musgo esmeralda vivo (X >= 180, Y >= 180)
    ctx.fillStyle = '#225a12';
    ctx.fillRect(180, 180, 76, 76);

    // Mosaico de musgo aveludado em pixel art
    for (let x = 180; x < 256; x += 4) {
      for (let y = 180; y < 256; y += 4) {
        const mn = Math.sin(x * 0.25) * Math.cos(y * 0.25);
        if (mn > 0.2) {
          ctx.fillStyle = '#7ed434';
          ctx.fillRect(x, y, 4, 4);
        } else if (mn > -0.2) {
          ctx.fillStyle = '#4ea422';
          ctx.fillRect(x, y, 4, 4);
        }
      }
    }

    return (this.rockTex = this.createPixelTexture(canvas));
  }

  // =========================================================================
  // 10. MADEIRA DESGASTADA / TRONCOS CAÍDOS COM ANÉIS
  // =========================================================================
  public static getWeatheredWoodTexture(): THREE.CanvasTexture {
    if (this.weatheredWoodTex) return this.weatheredWoodTex;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Fundo de madeira acinzentada
    ctx.fillStyle = '#645242';
    ctx.fillRect(0, 0, 256, 256);

    // Fibras longitudinais em pixel art
    for (let x = 0; x < 256; x += 4) {
      ctx.fillStyle = (x % 8 === 0) ? '#4a3a2e' : '#7c6856';
      ctx.fillRect(x, 0, 4, 256);
    }

    // Anéis de crescimento concêntricos em pixel art (quadrante superior esquerdo)
    const cx = 64;
    const cy = 64;
    for (let r = 8; r < 58; r += 6) {
      ctx.strokeStyle = (r % 12 === 0) ? '#38281c' : '#9c8470';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Manchas pixeladas de líquen
    ctx.fillStyle = '#6ea048';
    for (let i = 0; i < 20; i++) {
      const lx = ((i * 53) % 58) * 4;
      const ly = ((i * 73) % 58) * 4;
      ctx.fillRect(lx, ly, 8, 8);
      ctx.fillRect(lx + 2, ly - 2, 4, 12);
    }

    return (this.weatheredWoodTex = this.createPixelTexture(canvas));
  }
}
