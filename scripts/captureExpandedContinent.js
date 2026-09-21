import puppeteer from 'puppeteer-core';
import path from 'path';

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const ARTIFACT_DIR = 'C:\\Users\\julia\\.gemini\\antigravity\\brain\\40dbf106-75ff-492e-8c3f-30ec0fe98531';

async function run() {
  console.log('--- Capturando Vistas do Continente com Geração Expandida ---');

  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: 'new',
    args: [
      '--use-gl=angle',
      '--use-angle=d3d11',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });

  page.on('console', (msg) => console.log(`[Browser]: ${msg.text()}`));
  page.on('pageerror', (err) => console.error(`[PageError]: ${err.toString()}`));

  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  
  // Wait for initial load and chunk builds
  console.log('Aguardando carregamento e streaming inicial dos chunks...');
  await new Promise((r) => setTimeout(r, 6000));

  await page.waitForFunction(() => !!window.__WORLD__ && !!window.__PLAYER__);

  // Diagnóstico dos chunks
  const stats = await page.evaluate(() => {
    const world = window.__WORLD__;
    const chunkMgr = world?.chunkManager;
    return {
      totalChunks: chunkMgr?.chunks?.size || 0,
      buildQueueLength: chunkMgr?.buildQueue?.length || 0,
      playerPos: window.__PLAYER__?.getPosition()
    };
  });
  console.log('Estatísticas iniciais do mundo:', stats);

  // Aguarda a fila de construção esvaziar para carregar os chunks do horizonte
  let queueLength = stats.buildQueueLength;
  for (let i = 0; i < 15 && queueLength > 5; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    queueLength = await page.evaluate(() => window.__WORLD__?.chunkManager?.buildQueue?.length || 0);
    console.log(`Fila de construção de chunks restantes: ${queueLength}`);
  }

  // 1. Visão Ampla Panorâmica Continental (Frustum 1100)
  console.log('Capturando Visão Ampla Panorâmica (Frustum 1100)...');
  await page.evaluate(() => {
    const cam = window.__PLAYER__.observerCamera;
    if (cam) {
      cam.targetFrustumSize = 1100;
      cam.frustumSize = 1100;
      cam.updateProjection();
    }
  });
  await new Promise((r) => setTimeout(r, 3000));
  const shot1 = path.join(ARTIFACT_DIR, 'screenshot_continent_expanded_wide.png');
  await page.screenshot({ path: shot1 });
  console.log(`Salvo: ${shot1}`);

  // 2. Visão Ultra Ampla Macro-Continental (Frustum 1800)
  console.log('Capturando Visão Ultra Ampla Macro-Continental (Frustum 1800)...');
  await page.evaluate(() => {
    const cam = window.__PLAYER__.observerCamera;
    if (cam) {
      cam.targetFrustumSize = 1800;
      cam.frustumSize = 1800;
      cam.updateProjection();
    }
  });
  await new Promise((r) => setTimeout(r, 3000));
  const shot2 = path.join(ARTIFACT_DIR, 'screenshot_continent_expanded_ultra_wide.png');
  await page.screenshot({ path: shot2 });
  console.log(`Salvo: ${shot2}`);

  // 3. Visão Média com horizonte estendido e profundidade
  console.log('Capturando Visão Média (Frustum 450)...');
  await page.evaluate(() => {
    const cam = window.__PLAYER__.observerCamera;
    if (cam) {
      cam.targetFrustumSize = 450;
      cam.frustumSize = 450;
      cam.updateProjection();
    }
  });
  await new Promise((r) => setTimeout(r, 2000));
  const shot3 = path.join(ARTIFACT_DIR, 'screenshot_continent_expanded_medium.png');
  await page.screenshot({ path: shot3 });
  console.log(`Salvo: ${shot3}`);

  await browser.close();
  console.log('--- Captura finalizada com sucesso! ---');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
