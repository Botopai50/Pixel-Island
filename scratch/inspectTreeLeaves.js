import puppeteer from 'file:///C:/Users/julia/.gemini/antigravity/scratch/procedural-island-explorer/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'path';
import fs from 'fs';

const ARTIFACT_DIR = 'C:/Users/julia/.gemini/antigravity/brain/40dbf106-75ff-492e-8c3f-30ec0fe98531';
const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function inspect() {
  console.log('Iniciando inspeção detalhada da folhagem das árvores...');
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err));

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await sleep(4000);

  // 1. Salvar a textura 2D do Canvas de FoliageTexture diretamente
  const foliageDataUrl = await page.evaluate(async () => {
    const { VegetationTextures } = await import('./src/generation/vegetation/vegetationTextures.ts');
    const tex = VegetationTextures.getFoliageTexture();
    return tex.image.toDataURL('image/png');
  });

  const base64Data = foliageDataUrl.replace(/^data:image\/png;base64,/, '');
  fs.writeFileSync(path.join(ARTIFACT_DIR, 'foliage_canvas_raw.png'), base64Data, 'base64');
  console.log('✓ Salvo foliage_canvas_raw.png');

  // 2. Posicionar a câmera bem de perto na copa de um carvalho (1.5m de distância)
  await page.evaluate(async () => {
    const { TIME_PRESETS } = await import('./src/atmosphere/skyAtmosphere.ts');
    window.__ATMOSPHERE__.applyPreset(TIME_PRESETS.NOON);

    const tg = window.__WORLD__.getTerrainGenerator();
    // Posição de um carvalho próximo
    const x = 32, z = -36;
    const groundH = tg.getHeight(x, z);

    const fp = window.__PLAYER__.firstPersonController;
    // Fica a 4m de distância do tronco, olhando para a copa a 7m de altura
    fp.position.set(x - 3.5, groundH + 5.5, z - 3.5);
    // Olhar diretamente para o centro da copa
    fp.yaw = Math.atan2(3.5, 3.5); // ~ 0.785 rad
    fp.pitch = 0.25;
    fp.camera.position.set(x - 3.5, groundH + 5.5, z - 3.5);
    fp.camera.rotation.y = fp.yaw;
    fp.camera.rotation.x = fp.pitch;

    window.__PLAYER__.mode = 'FIRST_PERSON';
    window.__PLAYER__.onModeChange?.('FIRST_PERSON');
    window.__WORLD__.updateObserverPosition(x, z);
  });
  await sleep(3000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'tree_leaves_macro.png') });
  console.log('✓ Salvo tree_leaves_macro.png');

  await browser.close();
}

inspect().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});
