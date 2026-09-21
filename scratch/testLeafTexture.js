import fs from 'fs';
import path from 'path';
import { createCanvas } from 'canvas';

const ARTIFACT_DIR = 'C:/Users/julia/.gemini/antigravity/brain/40dbf106-75ff-492e-8c3f-30ec0fe98531';

// Test creating pixel-art leaves texture
function generateLeafTexture() {
  const width = 256;
  const height = 256;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 1. Fundo profundo da copa: verde-escuro de sombra interna (profundidade entre as folhas)
  ctx.fillStyle = '#0f2b08';
  ctx.fillRect(0, 0, width, height);

  const pSize = 4; // Grid de pixel art autêntico (64x64 texels)
  const gridW = width / pSize;
  const gridH = height / pSize;

  // Grid buffer para construir camadas de folhas
  // 0: fundo/sombra profunda, 1: folha sombra, 2: folha meio-tom, 3: folha realce, 4: ponta dourada
  const buffer = new Uint8Array(gridW * gridH);

  // Função para desenhar no buffer com wrapping toroidal (perfeitamente contínuo/seamless)
  function setPixel(gx, gy, val) {
    const wx = ((gx % gridW) + gridW) % gridW;
    const wy = ((gy % gridH) + gridH) % gridH;
    buffer[wy * gridW + wx] = Math.max(buffer[wy * gridW + wx], val);
  }

  // Template de uma folha estilizada individual em formato de lóbulo/amêndoa (típico de carvalho/árvore)
  // Tamanho ~ 5x4 a 7x5 pixels
  function drawSingleLeaf(cx, cy, angle, scale) {
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const leafLen = Math.round(5 * scale);
    const leafWidth = Math.round(3 * scale);

    for (let dy = -leafWidth; dy <= leafWidth; dy++) {
      for (let dx = -1; dx <= leafLen; dx++) {
        // Equação de elipse apontando para a ponta da folha
        const nx = dx / leafLen;
        const ny = dy / (leafWidth * (1.0 - nx * 0.4)); // Afunila na ponta
        const distSq = nx * nx + ny * ny;

        if (distSq <= 1.0) {
          // Rotaciona para o espaço da folha
          const rx = Math.round(cx + dx * cosA - dy * sinA);
          const ry = Math.round(cy + dx * sinA + dy * cosA);

          let tone = 1; // Sombra/borda da folha
          if (distSq < 0.75) {
            tone = 2; // Meio-tom
          }
          if (distSq < 0.45 && ny < 0.2) {
            tone = 3; // Realce na face superior iluminada
          }
          if (distSq < 0.20 && dx > 1) {
            tone = 4; // Crista da nervura central e ponta luminosa
          }

          setPixel(rx, ry, tone);
        }
      }
    }
  }

  // Desenha um tufo/spray de folhas (3 a 5 folhas saindo de um broto central)
  function drawLeafSpray(cx, cy, baseAngle, scale) {
    const numLeaves = 4 + (Math.floor(Math.sin(cx * 7.1 + cy * 3.7) * 10) % 3);
    for (let i = 0; i < numLeaves; i++) {
      const spread = (i - (numLeaves - 1) / 2) * 0.45;
      const angle = baseAngle + spread;
      drawSingleLeaf(cx, cy, angle, scale);
    }
  }

  // 2. Distribuir tufos de folhas por toda a textura com sobreposição densa
  // Camada 1: Tufos de fundo com escala média (60 sprays)
  const prng = (seed) => {
    let s = seed;
    return () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
  };
  const rand = prng(42);

  // Malha de pontos jittered para cobertura uniforme sem buracos
  const step = 8;
  for (let gy = 0; gy < gridH; gy += step) {
    for (let gx = 0; gx < gridW; gx += step) {
      const cx = gx + Math.floor(rand() * step);
      const cy = gy + Math.floor(rand() * step);
      const angle = rand() * Math.PI * 2;
      const scale = 0.9 + rand() * 0.4;
      drawLeafSpray(cx, cy, angle, scale);
    }
  }

  // Camada 2: Tufos de primeiro plano mais destacados (30 sprays)
  for (let i = 0; i < 35; i++) {
    const cx = Math.floor(rand() * gridW);
    const cy = Math.floor(rand() * gridH);
    const angle = rand() * Math.PI * 2;
    const scale = 1.1 + rand() * 0.35;
    drawLeafSpray(cx, cy, angle, scale);
  }

  // 3. Paleta cromática exuberante de Pixel Art Botânica (Ghibli / Zelda Wind Waker / Secret of Mana)
  const palette = {
    0: '#14380a', // Sombra profunda interna entre os tufos
    1: '#265e14', // Borda e contorno da folha
    2: '#4a9c24', // Corpo e limbo da folha (verde floresta vivo)
    3: '#7ed432', // Face iluminada da folha (verde-maçã viçoso)
    4: '#aef04a'  // Ponta e crista iluminada pelo sol (chartreuse dourado)
  };

  // Renderizar o buffer na tela em blocos pSize x pSize
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const val = buffer[gy * gridW + gx];
      ctx.fillStyle = palette[val];
      ctx.fillRect(gx * pSize, gy * pSize, pSize, pSize);
    }
  }

  // Salvar imagem de teste
  const outPath = path.join(ARTIFACT_DIR, 'test_pixel_leaves.png');
  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  console.log('✓ Textura de folhas gerada com sucesso em:', outPath);
}

try {
  generateLeafTexture();
} catch (e) {
  console.error('Erro na geração:', e);
}
