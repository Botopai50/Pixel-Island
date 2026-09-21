import puppeteer from 'file:///C:/Users/julia/.gemini/antigravity/scratch/procedural-island-explorer/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/julia/.gemini/antigravity/brain/40dbf106-75ff-492e-8c3f-30ec0fe98531';
const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function capture() {
  console.log('Iniciando navegador para validação visual em primeira pessoa...');
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1600,1000']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err));

  console.log('Navegando para http://localhost:5173/ ...');
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded' });
  await sleep(4000);

  // 1. PRIMEIRA PESSOA REAL: Bosque e sombras cartoon no chão (Nível 0: 3.4cm/px)
  console.log('1. Posicionando em 1ª Pessoa no bosque...');
  await page.evaluate(() => {
    const tg = window.__WORLD__.getTerrainGenerator();
    const x = 30, z = -40; // Clareira no bosque próximo ao spawn
    const groundH = tg.getHeight(x, z);
    
    const fp = window.__PLAYER__.firstPersonController;
    fp.position.set(x, groundH + 1.75, z);
    fp.yaw = Math.PI * 0.45; // Olha na direção das árvores e sombras solares
    fp.pitch = -0.16; // Leve inclinação para o chão mostrando sombras e troncos
    fp.camera.position.set(x, groundH + 1.75, z);
    fp.camera.rotation.y = fp.yaw;
    fp.camera.rotation.x = fp.pitch;
    
    window.__PLAYER__.mode = 'FIRST_PERSON';
    window.__PLAYER__.onModeChange?.('FIRST_PERSON');
    window.__WORLD__.updateObserverPosition(x, z);
  });
  await sleep(3500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'cartoon_shadows_near_firstperson.png') });
  console.log('✓ Salvo cartoon_shadows_near_firstperson.png');

  // 2. PRIMEIRA PESSOA - PÔR DO SOL DOURADO COM SOMBRAS LONGAS
  console.log('2. 1ª Pessoa ao Pôr do Sol Dourado...');
  await page.evaluate(async () => {
    const { TIME_PRESETS } = await import('./src/atmosphere/skyAtmosphere.ts');
    window.__ATMOSPHERE__.applyPreset(TIME_PRESETS.GOLDEN_HOUR);
    
    const fp = window.__PLAYER__.firstPersonController;
    fp.yaw = Math.PI * 0.45; // Olha na direção perpendicular à luz do pôr do sol
    fp.pitch = -0.12;
    fp.camera.rotation.y = fp.yaw;
    fp.camera.rotation.x = fp.pitch;
  });
  await sleep(3000);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'cartoon_shadows_sunset_firstperson.png') });
  console.log('✓ Salvo cartoon_shadows_sunset_firstperson.png');

  // 3. VISTA AÉREA ZOOMADA - TRANSIÇÃO CLIPMAP (NÍVEL 0 PARA NÍVEL 1)
  console.log('3. Vista aérea detalhada...');
  await page.evaluate(async () => {
    const { TIME_PRESETS } = await import('./src/atmosphere/skyAtmosphere.ts');
    window.__ATMOSPHERE__.applyPreset(TIME_PRESETS.NOON);

    window.__PLAYER__.mode = 'OBSERVER';
    window.__PLAYER__.onModeChange?.('OBSERVER');
    window.__PLAYER__.setPosition(40, -50);
    window.__PLAYER__.setFrustumSize(95);
    window.__PLAYER__.setRotation(45 * (Math.PI / 180));
    window.__WORLD__.updateObserverPosition(40, -50);
  });
  await sleep(3500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'cartoon_shadows_aerial_detail.png') });
  console.log('✓ Salvo cartoon_shadows_aerial_detail.png');

  await browser.close();
  console.log('Todas as capturas finalizadas com sucesso!');
}

capture().catch(err => {
  console.error('Erro na captura:', err);
  process.exit(1);
});
