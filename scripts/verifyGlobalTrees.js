import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\julia\\.gemini\\antigravity\\brain\\40dbf106-75ff-492e-8c3f-30ec0fe98531';

async function run() {
  console.log('--- Verificando Geração de Árvores ao Mover a Câmera pelo Mundo ---');

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));
  await page.waitForFunction(() => !!window.__WORLD__ && !!window.__PLAYER__);

  const initialPos = await page.evaluate(() => window.__PLAYER__.getPosition());
  console.log('Posição inicial do jogador/spawn:', initialPos);

  // 1. Move a câmera 500 metros para o Leste (+X) para uma nova região
  console.log('Movendo a câmera 500m a Leste para explorar novo vale...');
  await page.evaluate((pos) => {
    const targetX = pos.x + 500;
    const targetZ = pos.z;
    window.__PLAYER__.setPosition(targetX, targetZ);
    window.__WORLD__.updateObserverPosition(targetX, targetZ);
    const cam = window.__PLAYER__.observerCamera;
    if (cam) {
      cam.targetFrustumSize = 350;
      cam.frustumSize = 350;
      cam.updateProjection();
    }
  }, initialPos);

  // Aguarda a construção dos chunks da nova região
  await new Promise((r) => setTimeout(r, 4500));

  const shot1 = path.join(ARTIFACT_DIR, 'screenshot_trees_moved_east.png');
  await page.screenshot({ path: shot1 });
  console.log(`Salvo foto Leste: ${shot1}`);

  // 2. Move a câmera 700 metros para o Norte (-Z) para outra região distante
  console.log('Movendo a câmera 700m ao Norte para outra região...');
  await page.evaluate((pos) => {
    const targetX = pos.x - 200;
    const targetZ = pos.z - 700;
    window.__PLAYER__.setPosition(targetX, targetZ);
    window.__WORLD__.updateObserverPosition(targetX, targetZ);
  }, initialPos);

  await new Promise((r) => setTimeout(r, 4500));

  const shot2 = path.join(ARTIFACT_DIR, 'screenshot_trees_moved_north.png');
  await page.screenshot({ path: shot2 });
  console.log(`Salvo foto Norte: ${shot2}`);

  // 3. Move a câmera 600 metros para o Sul (+Z) e Oeste (-X)
  console.log('Movendo a câmera para o Sul e Oeste...');
  await page.evaluate((pos) => {
    const targetX = pos.x - 450;
    const targetZ = pos.z + 550;
    window.__PLAYER__.setPosition(targetX, targetZ);
    window.__WORLD__.updateObserverPosition(targetX, targetZ);
  }, initialPos);

  await new Promise((r) => setTimeout(r, 4500));

  const shot3 = path.join(ARTIFACT_DIR, 'screenshot_trees_moved_southwest.png');
  await page.screenshot({ path: shot3 });
  console.log(`Salvo foto Sudoeste: ${shot3}`);

  await browser.close();
  console.log('--- Verificação finalizada com sucesso! ---');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
