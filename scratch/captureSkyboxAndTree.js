import puppeteer from 'file:///C:/Users/julia/.gemini/antigravity/scratch/procedural-island-explorer/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/julia/.gemini/antigravity/brain/40dbf106-75ff-492e-8c3f-30ec0fe98531';
const EDGE_PATH = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function capture() {
  console.log('Iniciando captura de validação de alta fidelidade do Skybox e Árvores...');
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
  await sleep(4500);

  // 1. TEXTURA DAS ÁRVORES - CLOSE-UP (Tronco iluminado + folhagem orgânica)
  console.log('1. Capturando close-up de árvore para auditar textura da copa e tronco...');
  await page.evaluate(async () => {
    const { TIME_PRESETS } = await import('./src/atmosphere/skyAtmosphere.ts');
    window.__ATMOSPHERE__.applyPreset(TIME_PRESETS.NOON);

    const tg = window.__WORLD__.getTerrainGenerator();
    const x = 32, z = -36;
    const groundH = tg.getHeight(x, z);

    const fp = window.__PLAYER__.firstPersonController;
    fp.position.set(x, groundH + 1.8, z);
    fp.yaw = Math.PI * 0.35;
    fp.pitch = 0.15;
    fp.camera.position.set(x, groundH + 1.8, z);
    fp.camera.rotation.y = fp.yaw;
    fp.camera.rotation.x = fp.pitch;

    window.__PLAYER__.mode = 'FIRST_PERSON';
    window.__PLAYER__.onModeChange?.('FIRST_PERSON');
    window.__WORLD__.updateObserverPosition(x, z);
  });
  await sleep(3500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'tree_texture_closeup.png') });
  console.log('✓ Salvo tree_texture_closeup.png');

  // 2. SKYBOX - MEIO-DIA (NOON): Sol, Auréola Anime, Nuvens Fofas Cel-Shaded, Gradiente Azul
  console.log('2. Capturando Skybox ao Meio-Dia com Sol e Nuvens...');
  await page.evaluate(async () => {
    const { TIME_PRESETS } = await import('./src/atmosphere/skyAtmosphere.ts');
    window.__ATMOSPHERE__.applyPreset(TIME_PRESETS.NOON);

    const fp = window.__PLAYER__.firstPersonController;
    fp.yaw = -0.70;
    fp.pitch = 0.82;
    fp.camera.rotation.y = fp.yaw;
    fp.camera.rotation.x = fp.pitch;
  });
  await sleep(2500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'skybox_noon.png') });
  console.log('✓ Salvo skybox_noon.png');

  // 3. SKYBOX - PÔR DO SOL (GOLDEN_HOUR): Disco Solar Poente, Corona Radiante, Nuvens Pêssego/Lilás
  console.log('3. Capturando Skybox ao Pôr do Sol Dourado...');
  await page.evaluate(async () => {
    const { TIME_PRESETS } = await import('./src/atmosphere/skyAtmosphere.ts');
    window.__ATMOSPHERE__.applyPreset(TIME_PRESETS.GOLDEN_HOUR);

    const fp = window.__PLAYER__.firstPersonController;
    fp.yaw = 0.785;
    fp.pitch = 0.32;
    fp.camera.rotation.y = fp.yaw;
    fp.camera.rotation.x = fp.pitch;
  });
  await sleep(2500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'skybox_golden_hour.png') });
  console.log('✓ Salvo skybox_golden_hour.png');

  // 4. SKYBOX - NOITE ENLUARADA (NIGHT): Lua Heroica de Desenho, Campo de Estrelas, Cúpula Índigo
  console.log('4. Capturando Skybox Noturno com Lua Heroica e Estrelas...');
  await page.evaluate(async () => {
    const { TIME_PRESETS } = await import('./src/atmosphere/skyAtmosphere.ts');
    window.__ATMOSPHERE__.applyPreset(TIME_PRESETS.NIGHT);

    const fp = window.__PLAYER__.firstPersonController;
    // Olha para cima no céu noturno em direção à lua
    fp.yaw = 3.14159;
    fp.pitch = 0.65;
    fp.camera.rotation.y = fp.yaw;
    fp.camera.rotation.x = fp.pitch;
  });
  await sleep(2500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'skybox_night.png') });
  console.log('✓ Salvo skybox_night.png');

  // 5. SKYBOX - HORIZONTE PANORÂMICO COM NUVENS E MAR (NOON)
  console.log('5. Capturando Horizonte Panorâmico...');
  await page.evaluate(async () => {
    const { TIME_PRESETS } = await import('./src/atmosphere/skyAtmosphere.ts');
    window.__ATMOSPHERE__.applyPreset(TIME_PRESETS.NOON);

    const fp = window.__PLAYER__.firstPersonController;
    fp.yaw = -0.70;
    fp.pitch = 0.18;
    fp.camera.rotation.y = fp.yaw;
    fp.camera.rotation.x = fp.pitch;
  });
  await sleep(2500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'skybox_horizon_panorama.png') });
  console.log('✓ Salvo skybox_horizon_panorama.png');

  await browser.close();
  console.log('Todas as capturas atualizadas com sucesso!');
}

capture().catch(err => {
  console.error('Erro na captura:', err);
  process.exit(1);
});
