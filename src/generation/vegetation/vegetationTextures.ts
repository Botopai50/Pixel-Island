import * as THREE from 'three';

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
    const W = 512, H = 512;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    // 1. Fundo base: Verde esmeralda viçoso de alta luminosidade (estilo Studio Ghibli)
    ctx.fillStyle = '#4ea628';
    ctx.fillRect(0, 0, W, H);

    // Gerador determinístico baseado em sementes para reprodutibilidade
    let s = 58219;
    function rnd() {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    }

    // Função de desenho de tufos e pétalas com wrapping toroidal 100% sem emendas (seamless)
    function drawTiledBlob(cx: number, cy: number, rx: number, ry: number, angle: number, color: string) {
      ctx.save();
      ctx.fillStyle = color;

      for (const ox of [-W, 0, W]) {
        for (const oy of [-H, 0, H]) {
          const x = cx + ox;
          const y = cy + oy;
          if (x + rx * 2 < 0 || x - rx * 2 > W || y + ry * 2 < 0 || y - ry * 2 > H) continue;

          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(angle);
          ctx.beginPath();

          // Contorno de massa foliar lobada orgânica estilo anime
          const steps = 14;
          for (let i = 0; i <= steps; i++) {
            const th = (i / steps) * Math.PI * 2;
            const rOffset = 1.0 + Math.sin(th * 3.0) * 0.16 + Math.cos(th * 2.0) * 0.10;
            const px = Math.cos(th) * rx * rOffset;
            const py = Math.sin(th) * ry * rOffset;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.restore();
    }

    // Camada 1: Sombras de profundidade do dossel arbóreo (verde quente profundo - #2a6616)
    for (let i = 0; i < 90; i++) {
      const cx = rnd() * W;
      const cy = rnd() * H;
      const rx = 24 + rnd() * 26;
      const ry = 18 + rnd() * 20;
      const ang = rnd() * Math.PI;
      drawTiledBlob(cx, cy, rx, ry, ang, '#2a6616');
    }

    // Camada 2: Verde médio de floresta temperada viçosa (#449b22)
    for (let i = 0; i < 180; i++) {
      const cx = rnd() * W;
      const cy = rnd() * H;
      const rx = 18 + rnd() * 22;
      const ry = 14 + rnd() * 18;
      const ang = rnd() * Math.PI;
      drawTiledBlob(cx, cy, rx, ry, ang, '#449b22');
    }

    // Camada 3: Tufos ensolarados vibrantes (#66c62c)
    for (let i = 0; i < 160; i++) {
      const cx = rnd() * W;
      const cy = rnd() * H;
      const rx = 14 + rnd() * 18;
      const ry = 10 + rnd() * 15;
      const ang = rnd() * Math.PI;
      drawTiledBlob(cx, cy, rx, ry, ang, '#66c62c');
    }

    // Camada 4: Cristas solares douradas / folhas iluminadas pelo sol (#9de83a)
    for (let i = 0; i < 120; i++) {
      const cx = rnd() * W;
      const cy = rnd() * H;
      const rx = 10 + rnd() * 14;
      const ry = 7 + rnd() * 10;
      const ang = rnd() * Math.PI;
      drawTiledBlob(cx, cy, rx, ry, ang, '#9de83a');
    }

    // Camada 5: Pontos de brilho solar máximo estilo Ghibli / Wind Waker (#c8f856)
    for (let i = 0; i < 60; i++) {
      const cx = rnd() * W;
      const cy = rnd() * H;
      const rx = 6 + rnd() * 8;
      const ry = 4 + rnd() * 6;
      const ang = rnd() * Math.PI;
      drawTiledBlob(cx, cy, rx, ry, ang, '#c8f856');
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return (this.foliageTex = tex);
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
    ctx.drawImage(foliage.image, 0, 0);

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
